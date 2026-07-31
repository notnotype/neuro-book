use crate::text_match::collapse_ws;
use crate::types::ResultItem;

pub fn make_result(
    tag: &str,
    count: i64,
    aliases: &str,
    source_category: &str,
    group_name: &str,
    match_score: Option<i64>,
) -> ResultItem {
    let anima_tag = if source_category == "artists" {
        format_artist_for_anima(tag)
    } else {
        String::new()
    };
    ResultItem {
        tag: tag.to_string(),
        prompt_tag: if anima_tag.is_empty() {
            format_prompt_tag(tag, source_category)
        } else {
            anima_tag.clone()
        },
        anima_tag,
        category: category_bucket(group_name, source_category).to_string(),
        source_category: source_category.to_string(),
        count,
        aliases: aliases.to_string(),
        aliases_short: trim_aliases(aliases, 4),
        group: group_name.to_string(),
        match_score,
        match_layer: None,
    }
}

pub fn mark_group_general_fallback(item: &mut ResultItem) {
    item.match_layer = Some("group_general_fallback".to_string());
}

pub fn mark_match_layer(item: &mut ResultItem, layer: &str) {
    item.match_layer = Some(layer.to_string());
}

pub fn format_artist_for_anima(raw: &str) -> String {
    let mut s = raw.trim().to_string();
    if s.is_empty() {
        return "@fkey".to_string();
    }
    if s.starts_with('@') {
        s = s[1..].trim().to_string();
    }
    s = s.replace('_', " ");
    s = s.replace('(', r"\(").replace(')', r"\)");
    format!("@{}", collapse_ws(&s))
}

fn format_prompt_tag(raw: &str, category: &str) -> String {
    let s = raw.trim();
    if s.is_empty() {
        return String::new();
    }
    if category == "artists" || s.starts_with('@') {
        return format_artist_for_anima(s);
    }
    if s.starts_with("score_") && s[6..].chars().all(|ch| ch.is_ascii_digit()) {
        return s.to_string();
    }
    collapse_ws(&s.replace('_', " "))
}

fn trim_aliases(aliases: &str, max_items: usize) -> String {
    aliases
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .take(max_items)
        .collect::<Vec<_>>()
        .join(",")
}

fn category_bucket<'a>(group_name: &'a str, source_category: &'a str) -> &'a str {
    if matches!(group_name, "characters" | "series") {
        group_name
    } else {
        source_category
    }
}
