use std::collections::{BTreeMap, HashSet};

use anyhow::Result;
use rand::prelude::SliceRandom;

use crate::db::{
    DbRow, load_extended_artists, query_artist_tags, query_exact_rows, query_random_pool,
    query_rows,
};
use crate::groups::{clamp_limit, normalize_category, query_categories, resolve_group};
use crate::result_item::{
    format_artist_for_anima, make_result, mark_group_general_fallback, mark_match_layer,
};
use crate::text_match::{
    expand_keyword_terms, match_score, matches_query, normalize_search_text, result_identity,
};

pub use crate::prompt::{layered_for_prompt, prompt_item};
pub use crate::types::{
    BatchCompactPromptOutput, BatchInput, BatchPromptOutput, CompactLayeredPrompt, LayeredPrompt,
    PromptItem, ResultItem, SearchRequest, SearchResults, Usage,
};

const SERIES_SOURCE_CATEGORIES: [&str; 1] = ["series"];
const CHARACTER_SOURCE_CATEGORIES: [&str; 1] = ["characters"];
const GROUP_FALLBACK_MIN_SCORE: i64 = 100;
const FUZZY_MIN_SCORE: i64 = 60;

pub fn batch_layered_for_prompt(input: &BatchInput) -> Result<BatchPromptOutput> {
    validate_batch_input(input)?;

    let worker_count = input
        .max_workers
        .unwrap_or(4)
        .clamp(1, 16)
        .min(input.queries.len().max(1));

    if worker_count <= 1 || input.queries.len() <= 1 {
        return batch_layered_for_prompt_sequential(input);
    }

    let mut results = BTreeMap::new();
    let mut missing = Vec::new();
    let mut found = false;
    let mut first_error: Option<anyhow::Error> = None;

    for chunk in input.queries.chunks(worker_count) {
        let mut handles = Vec::new();
        for query in chunk {
            let query = query.clone();
            handles.push(std::thread::spawn(move || run_batch_query(query)));
        }

        for handle in handles {
            match handle.join() {
                Ok(Ok((id, layered))) => {
                    merge_batch_result(&mut results, &mut missing, &mut found, id, layered)
                }
                Ok(Err(err)) => {
                    if first_error.is_none() {
                        first_error = Some(err);
                    }
                }
                Err(_) => {
                    if first_error.is_none() {
                        first_error = Some(anyhow::anyhow!("batch worker panicked"));
                    }
                }
            }
        }
    }

    if let Some(err) = first_error {
        return Err(err);
    }

    Ok(BatchPromptOutput {
        found,
        results,
        missing,
        usage: prompt_usage(),
    })
}

pub fn batch_compact_layered_for_prompt(input: &BatchInput) -> Result<BatchCompactPromptOutput> {
    let layered = batch_layered_for_prompt(input)?;
    let results = layered
        .results
        .into_iter()
        .map(|(id, item)| {
            (
                id,
                CompactLayeredPrompt {
                    found: item.found,
                    confirmed_tags: item.confirmed_tags,
                    candidate_tags: item.candidate_tags,
                },
            )
        })
        .collect();
    Ok(BatchCompactPromptOutput {
        found: layered.found,
        results,
        missing: layered.missing,
        usage: layered.usage,
    })
}

fn run_batch_query(query: crate::types::BatchQuery) -> Result<(String, LayeredPrompt)> {
    let request = SearchRequest {
        keyword: query.keyword,
        prefix: query.prefix,
        category: query.category,
        group: query.group,
        min_count: query.min_count,
        limit: query.limit,
        extended: query.extended,
        match_mode: query.match_mode,
    };
    let search_results = search_tags(&request)?;
    Ok((query.id, layered_for_prompt(&search_results)))
}

fn merge_batch_result(
    results: &mut BTreeMap<String, LayeredPrompt>,
    missing: &mut Vec<String>,
    found: &mut bool,
    id: String,
    layered: LayeredPrompt,
) {
    if layered.found {
        *found = true;
    } else {
        missing.push(id.clone());
    }
    results.insert(id, layered);
}

fn validate_batch_input(input: &BatchInput) -> Result<()> {
    let mut seen = HashSet::new();
    for query in &input.queries {
        let id = query.id.trim();
        if id.is_empty() {
            anyhow::bail!("batch query id cannot be empty");
        }
        if !seen.insert(id.to_string()) {
            anyhow::bail!("duplicate batch query id: {id}");
        }
    }
    Ok(())
}

fn batch_layered_for_prompt_sequential(input: &BatchInput) -> Result<BatchPromptOutput> {
    validate_batch_input(input)?;

    let mut results = BTreeMap::new();
    let mut missing = Vec::new();
    let mut found = false;

    for query in &input.queries {
        let request = SearchRequest {
            keyword: query.keyword.clone(),
            prefix: query.prefix.clone(),
            category: query.category.clone(),
            group: query.group.clone(),
            min_count: query.min_count,
            limit: query.limit,
            extended: query.extended,
            match_mode: query.match_mode.clone(),
        };
        let search_results = search_tags(&request)?;
        let layered = layered_for_prompt(&search_results);
        if layered.found {
            found = true;
        } else {
            missing.push(query.id.clone());
        }
        results.insert(query.id.clone(), layered);
    }

    Ok(BatchPromptOutput {
        found,
        results,
        missing,
        usage: prompt_usage(),
    })
}

fn prompt_usage() -> Usage {
    Usage {
        confirmed_tags: "各 query 的 confirmed_tags 来自直接命中、别名精确命中或 artist prefix 命中，可作为 Danbooru 硬锚点。".to_string(),
        candidate_tags: "各 query 的 candidate_tags 来自模糊补查或回退，只作备选，不要整组塞进 prompt。".to_string(),
        nltags_hint: "批量查询缺失或组合关系不完整时，用英文自然语言补足；不要继续无限补查。"
            .to_string(),
        empty_result: "missing 中的 query 表示本地 Anima CSV 没有可确认 tag，不要弱匹配冒充命中。"
            .to_string(),
    }
}

pub fn search_tags(request: &SearchRequest) -> Result<SearchResults> {
    let match_mode = normalize_match_mode(&request.match_mode)?;
    let category = normalize_category(&request.category)?;
    let group = resolve_group(&request.group)?;
    let query_category = if group.canonical.is_empty() {
        category.as_str()
    } else {
        group.source_category.as_str()
    };
    let limit = clamp_limit(request.limit);
    let prefix_norm = normalize_search_text(&request.prefix);
    let keyword_terms = expand_keyword_terms(&request.keyword);
    let has_query = !prefix_norm.is_empty() || !keyword_terms.is_empty();
    let categories = query_categories(&group.canonical, query_category, has_query);

    if matches!(match_mode.as_str(), "auto" | "exact") && has_query {
        let exact_results = search_exact_tags(
            &categories,
            &group.canonical,
            request.min_count,
            limit,
            &prefix_norm,
            &keyword_terms,
        )?;
        if !exact_results.is_empty() || match_mode == "exact" {
            return Ok(exact_results);
        }
    }

    let mut results: SearchResults = BTreeMap::new();
    let mut shared_results = Vec::new();

    for source_category in categories {
        let rows = query_rows(
            &source_category,
            &group.canonical,
            request.min_count,
            &prefix_norm,
            &keyword_terms,
            limit,
        )?;
        let items = search_category(
            &rows,
            &source_category,
            &group.canonical,
            request.min_count,
            limit,
            &prefix_norm,
            &keyword_terms,
        );

        if group.canonical == "series" || group.canonical == "characters" {
            shared_results.extend(items);
        } else if !items.is_empty() {
            results.insert(source_category, items);
        }
    }

    store_shared_results(&mut results, shared_results, &group.canonical, limit);
    merge_general_fallback(
        &mut results,
        &group.canonical,
        request.min_count,
        limit,
        &prefix_norm,
        &keyword_terms,
    )?;

    if request.extended && (category.is_empty() || category == "artists") {
        merge_extended_artists(&mut results, &category, &prefix_norm, &keyword_terms, limit)?;
    }

    Ok(results)
}

fn normalize_match_mode(mode: &str) -> Result<String> {
    let mode = mode.trim().to_lowercase();
    if mode.is_empty() {
        return Ok("auto".to_string());
    }
    if matches!(mode.as_str(), "auto" | "exact" | "fuzzy") {
        Ok(mode)
    } else {
        anyhow::bail!("invalid match_mode: {mode}; expected auto, exact, or fuzzy")
    }
}

fn search_exact_tags(
    categories: &[String],
    group_name: &str,
    min_count: i64,
    limit: usize,
    prefix_norm: &str,
    keyword_terms: &[String],
) -> Result<SearchResults> {
    let mut results: SearchResults = BTreeMap::new();
    let mut shared_results = Vec::new();
    let primary_norm = keyword_terms.first().map(String::as_str).unwrap_or("");

    for source_category in categories {
        let rows = query_exact_rows(
            source_category,
            group_name,
            min_count,
            prefix_norm,
            primary_norm,
            limit,
        )?;
        let items = exact_category(
            &rows,
            source_category,
            group_name,
            min_count,
            limit,
            prefix_norm,
            primary_norm,
        );

        if group_name == "series" || group_name == "characters" {
            shared_results.extend(items);
        } else if !items.is_empty() {
            results.insert(source_category.clone(), items);
        }
    }

    store_shared_results(&mut results, shared_results, group_name, limit);
    Ok(results)
}

fn merge_general_fallback(
    results: &mut SearchResults,
    group_name: &str,
    min_count: i64,
    limit: usize,
    prefix_norm: &str,
    keyword_terms: &[String],
) -> Result<()> {
    if !should_try_general_fallback(results, group_name, prefix_norm, keyword_terms) {
        return Ok(());
    }

    let rows = query_rows("general", "", min_count, "", keyword_terms, limit.min(3))?;
    let mut fallback_items = search_category(
        &rows,
        "general",
        group_name,
        min_count,
        limit.min(3),
        "",
        keyword_terms,
    )
    .into_iter()
    .filter(|item| item.match_score.unwrap_or_default() >= GROUP_FALLBACK_MIN_SCORE)
    .map(|mut item| {
        mark_group_general_fallback(&mut item);
        item
    })
    .collect::<Vec<_>>();

    if fallback_items.is_empty() {
        return Ok(());
    }

    fallback_items.truncate(limit.min(3));
    results.insert("general".to_string(), fallback_items);
    Ok(())
}

fn should_try_general_fallback(
    results: &SearchResults,
    group_name: &str,
    prefix_norm: &str,
    keyword_terms: &[String],
) -> bool {
    if !results.is_empty() || group_name.is_empty() || !prefix_norm.is_empty() {
        return false;
    }
    let primary_keyword = keyword_terms.first().map(String::as_str).unwrap_or("");
    if primary_keyword.len() < 3 {
        return false;
    }
    !matches!(group_name, "artists" | "characters" | "series" | "meta")
}

pub fn random_artists(count: usize, extended: bool) -> Result<Vec<String>> {
    if count == 0 {
        return Ok(Vec::new());
    }
    let mut pool = if extended {
        load_extended_artists()?
    } else {
        query_artist_tags()?
    };
    if pool.is_empty() {
        return Ok(Vec::new());
    }

    let mut rng = rand::rng();
    pool.shuffle(&mut rng);
    pool.truncate(count.min(pool.len()));
    Ok(pool
        .into_iter()
        .map(|artist| format_artist_for_anima(&artist))
        .collect())
}

pub fn random_tags(request: &SearchRequest) -> Result<Vec<ResultItem>> {
    let category = normalize_category(&request.category)?;
    let group = resolve_group(&request.group)?;
    let query_category = if group.canonical.is_empty() {
        if category.is_empty() {
            "general".to_string()
        } else {
            category.clone()
        }
    } else {
        query_categories(&group.canonical, group.source_category.as_str(), false)
            .into_iter()
            .next()
            .unwrap_or_else(|| group.source_category.clone())
    };
    let mut rows = query_random_pool(&query_category, &group.canonical, request.min_count)?;
    if rows.is_empty() {
        return Ok(Vec::new());
    }

    let mut rng = rand::rng();
    rows.shuffle(&mut rng);
    Ok(rows
        .into_iter()
        .take(request.limit)
        .map(|row| {
            make_result(
                &row.tag,
                row.count,
                &row.aliases,
                &query_category,
                &group.canonical,
                None,
            )
        })
        .collect())
}

fn store_shared_results(
    results: &mut SearchResults,
    shared_results: Vec<ResultItem>,
    group_name: &str,
    limit: usize,
) {
    if shared_results.is_empty() {
        return;
    }
    let target_bucket = match group_name {
        "series" => "series",
        "characters" => "characters",
        _ => return,
    };
    results.insert(
        target_bucket.to_string(),
        shared_results.into_iter().take(limit).collect(),
    );
}

fn merge_extended_artists(
    results: &mut SearchResults,
    category: &str,
    prefix_norm: &str,
    keyword_terms: &[String],
    limit: usize,
) -> Result<()> {
    if !category.is_empty() && category != "artists" {
        return Ok(());
    }

    let mut ext_results = Vec::new();
    for artist in load_extended_artists()? {
        let artist_norm = normalize_search_text(&artist);
        if !prefix_norm.is_empty() && !artist_norm.starts_with(prefix_norm) {
            continue;
        }
        if !keyword_terms.is_empty()
            && !keyword_terms
                .iter()
                .any(|term| artist_norm.contains(&normalize_search_text(term)))
        {
            continue;
        }
        ext_results.push(make_result(
            &artist,
            0,
            "",
            "artists",
            "artists_extended",
            None,
        ));
        if ext_results.len() >= limit {
            break;
        }
    }

    let existing = results.entry("artists".to_string()).or_default();
    if existing.len() >= limit {
        existing.truncate(limit);
        return Ok(());
    }
    let mut seen: HashSet<String> = existing
        .iter()
        .map(|item| result_identity(&item.source_category, &item.tag))
        .collect();
    for item in ext_results {
        let key = result_identity(&item.source_category, &item.tag);
        if seen.insert(key) {
            existing.push(item);
        }
        if existing.len() >= limit {
            break;
        }
    }
    existing.truncate(limit);
    Ok(())
}

fn exact_category(
    rows: &[DbRow],
    source_category: &str,
    group_name: &str,
    min_count: i64,
    limit: usize,
    prefix_norm: &str,
    primary_norm: &str,
) -> Vec<ResultItem> {
    let mut results = Vec::new();
    let mut seen = HashSet::new();

    for row in rows {
        if !row_allowed(row, source_category, group_name, min_count) {
            continue;
        }
        let tag_norm = normalize_search_text(&row.tag);
        let layer = if !prefix_norm.is_empty() && tag_norm.starts_with(prefix_norm) {
            "prefix"
        } else if !primary_norm.is_empty() && tag_norm == primary_norm {
            "exact_tag"
        } else if !primary_norm.is_empty() && alias_exact_match(&row.aliases, primary_norm) {
            "exact_alias"
        } else {
            continue;
        };

        let mut item = make_result(
            &row.tag,
            row.count,
            &row.aliases,
            source_category,
            group_name,
            Some(if layer == "exact_tag" { 1000 } else { 900 }),
        );
        mark_match_layer(&mut item, layer);
        let key = result_identity(&item.source_category, &item.tag);
        if !seen.insert(key) {
            continue;
        }
        results.push(item);
        if results.len() >= limit {
            break;
        }
    }

    results
}

fn alias_exact_match(aliases: &str, primary_norm: &str) -> bool {
    aliases
        .split(',')
        .map(normalize_search_text)
        .any(|alias| alias == primary_norm)
}

fn search_category(
    rows: &[DbRow],
    source_category: &str,
    group_name: &str,
    min_count: i64,
    limit: usize,
    prefix_norm: &str,
    keyword_terms: &[String],
) -> Vec<ResultItem> {
    let mut results = Vec::new();
    let mut scored = Vec::new();
    let mut seen = HashSet::new();

    for row in rows {
        if !row_allowed(row, source_category, group_name, min_count) {
            continue;
        }
        let tag_norm = normalize_search_text(&row.tag);
        let aliases_norm = normalize_search_text(&row.aliases);
        if !matches_query(
            &tag_norm,
            &aliases_norm,
            prefix_norm,
            keyword_terms,
            group_name,
        ) {
            continue;
        }

        let mut item = make_result(
            &row.tag,
            row.count,
            &row.aliases,
            source_category,
            group_name,
            keyword_match_score(&tag_norm, &aliases_norm, keyword_terms),
        );
        if !keyword_terms.is_empty() {
            mark_match_layer(&mut item, "fuzzy");
        }
        let key = result_identity(&item.source_category, &item.tag);
        if !seen.insert(key) {
            continue;
        }

        if keyword_terms.is_empty() {
            results.push(item);
            if results.len() >= limit {
                break;
            }
        } else {
            let score = item.match_score.unwrap_or_default();
            if score >= FUZZY_MIN_SCORE {
                scored.push((score, item));
            }
        }
    }

    if keyword_terms.is_empty() {
        results
    } else {
        scored.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.count.cmp(&a.1.count)));
        scored
            .into_iter()
            .take(limit)
            .map(|(_, item)| item)
            .collect()
    }
}

fn row_allowed(row: &DbRow, source_category: &str, group_name: &str, min_count: i64) -> bool {
    if group_name == "characters" && !CHARACTER_SOURCE_CATEGORIES.contains(&source_category) {
        return false;
    }
    if group_name == "series" && !SERIES_SOURCE_CATEGORIES.contains(&source_category) {
        return false;
    }
    row.count >= min_count
}

fn keyword_match_score(
    tag_norm: &str,
    aliases_norm: &str,
    keyword_terms: &[String],
) -> Option<i64> {
    if keyword_terms.is_empty() {
        None
    } else {
        Some(match_score(tag_norm, aliases_norm, keyword_terms))
    }
}
