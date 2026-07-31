use std::env;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow};
use rusqlite::{Connection, OpenFlags, params_from_iter};

#[derive(Debug, Clone)]
pub struct DbRow {
    pub tag: String,
    pub count: i64,
    pub aliases: String,
}

pub fn db_exists() -> bool {
    find_asset("tags_index.sqlite").is_some()
}

pub fn load_extended_artists() -> Result<Vec<String>> {
    let Some(path) = find_asset("artists_extended.txt") else {
        return Ok(Vec::new());
    };
    let data = std::fs::read_to_string(&path)
        .with_context(|| format!("failed to read {}", path.display()))?;
    Ok(data
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect())
}

pub fn query_artist_tags() -> Result<Vec<String>> {
    let conn = open_connection()?;
    let mut stmt = conn.prepare(
        "SELECT tag FROM tags WHERE category = 'artists' AND tag LIKE '@%' ORDER BY count DESC, tag ASC",
    )?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn query_random_pool(category: &str, group_name: &str, min_count: i64) -> Result<Vec<DbRow>> {
    if !db_exists() || category.is_empty() {
        return Ok(Vec::new());
    }

    let mut sql = String::from("SELECT t.tag, t.count, t.aliases FROM tags t");
    let mut clauses = vec!["t.category = ?".to_string()];
    let mut params: Vec<String> = vec![category.to_string()];

    if should_join_group(group_name) {
        sql.push_str(" JOIN tag_groups g ON g.category = t.category AND g.tag = t.tag");
        clauses.push("g.group_name = ?".to_string());
        params.push(group_name.to_string());
    }
    if min_count > 0 {
        clauses.push("t.count >= ?".to_string());
        params.push(min_count.to_string());
    }

    let sql = format!(
        "{sql} WHERE {} ORDER BY t.count DESC, t.tag ASC",
        clauses.join(" AND ")
    );

    let conn = open_connection()?;
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params_from_iter(params.iter()), |row| {
            Ok(DbRow {
                tag: row.get(0)?,
                count: row.get(1)?,
                aliases: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn query_rows(
    category: &str,
    group_name: &str,
    min_count: i64,
    prefix_norm: &str,
    keyword_terms: &[String],
    limit: usize,
) -> Result<Vec<DbRow>> {
    if !db_exists() || category.is_empty() {
        return Ok(Vec::new());
    }

    let mut sql = String::from("SELECT t.tag, t.count, t.aliases FROM tags t");
    let mut clauses = vec!["t.category = ?".to_string()];
    let mut params: Vec<String> = vec![category.to_string()];

    if should_join_group(group_name) {
        sql.push_str(" JOIN tag_groups g ON g.category = t.category AND g.tag = t.tag");
        clauses.push("g.group_name = ?".to_string());
        params.push(group_name.to_string());
    }
    if min_count > 0 {
        clauses.push("t.count >= ?".to_string());
        params.push(min_count.to_string());
    }
    if !prefix_norm.is_empty() {
        clauses.push("t.tag_norm LIKE ?".to_string());
        params.push(format!("{prefix_norm}%"));
    }
    if !keyword_terms.is_empty() {
        let mut term_clauses = Vec::new();
        for term in keyword_terms {
            term_clauses.push("(t.tag_norm LIKE ? OR t.aliases_norm LIKE ?)".to_string());
            let like = format!("%{}%", normalize_for_sql(term));
            params.push(like.clone());
            params.push(like);
        }
        clauses.push(format!("({})", term_clauses.join(" OR ")));
    }

    let candidate_limit = std::cmp::max(limit.saturating_mul(20), 200);
    let sql = format!(
        "{sql} WHERE {} ORDER BY t.count DESC, t.tag ASC LIMIT ?",
        clauses.join(" AND ")
    );
    params.push(candidate_limit.to_string());

    let conn = open_connection()?;
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params_from_iter(params.iter()), |row| {
            Ok(DbRow {
                tag: row.get(0)?,
                count: row.get(1)?,
                aliases: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn query_exact_rows(
    category: &str,
    group_name: &str,
    min_count: i64,
    prefix_norm: &str,
    primary_norm: &str,
    limit: usize,
) -> Result<Vec<DbRow>> {
    if !db_exists() || category.is_empty() {
        return Ok(Vec::new());
    }

    let mut sql = String::from("SELECT t.tag, t.count, t.aliases FROM tags t");
    let mut clauses = vec!["t.category = ?".to_string()];
    let mut params: Vec<String> = vec![category.to_string()];

    if should_join_group(group_name) {
        sql.push_str(" JOIN tag_groups g ON g.category = t.category AND g.tag = t.tag");
        clauses.push("g.group_name = ?".to_string());
        params.push(group_name.to_string());
    }
    if min_count > 0 {
        clauses.push("t.count >= ?".to_string());
        params.push(min_count.to_string());
    }
    if !prefix_norm.is_empty() {
        clauses.push("t.tag_norm LIKE ?".to_string());
        params.push(format!("{prefix_norm}%"));
    } else if !primary_norm.is_empty() {
        clauses.push("(t.tag_norm = ? OR t.aliases_norm LIKE ?)".to_string());
        params.push(normalize_for_sql(primary_norm));
        params.push(format!("%{}%", normalize_for_sql(primary_norm)));
    } else {
        return Ok(Vec::new());
    }

    let sql = format!(
        "{sql} WHERE {} ORDER BY t.count DESC, t.tag ASC LIMIT ?",
        clauses.join(" AND ")
    );
    params.push(std::cmp::max(limit.saturating_mul(4), 20).to_string());

    let conn = open_connection()?;
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params_from_iter(params.iter()), |row| {
            Ok(DbRow {
                tag: row.get(0)?,
                count: row.get(1)?,
                aliases: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn open_connection() -> Result<Connection> {
    let path = find_asset("tags_index.sqlite")
        .ok_or_else(|| anyhow!("tags_index.sqlite not found near the executable"))?;
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .context("failed to open tags_index.sqlite")
}

fn find_asset(file_name: &str) -> Option<PathBuf> {
    for dir in search_dirs() {
        let candidate = dir.join(file_name);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

fn search_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            dirs.push(dir.to_path_buf());
            if let Some(parent) = dir.parent() {
                dirs.push(parent.to_path_buf());
            }
        }
    }
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    if let Some(parent) = manifest_dir.parent() {
        dirs.push(parent.to_path_buf());
    }
    dirs
}

fn should_join_group(group_name: &str) -> bool {
    !group_name.is_empty() && group_name != "characters" && group_name != "series"
}

fn normalize_for_sql(value: &str) -> String {
    let mut s = value.trim().to_lowercase();
    if s.starts_with('@') {
        s = s[1..].trim().to_string();
    }
    s = s.replace(r"\(", "(").replace(r"\)", ")");
    s = s.replace('-', " ").replace('_', " ");
    collapse_ws(&s)
}

fn collapse_ws(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}
