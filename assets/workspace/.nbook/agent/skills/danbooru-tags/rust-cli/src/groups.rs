use anyhow::{Result, anyhow};

const MAX_LIMIT: usize = 100;
const BASE_CATEGORIES: [&str; 5] = ["artists", "general", "characters", "series", "meta"];

#[derive(Debug, Clone)]
pub struct GroupSpec {
    pub canonical: String,
    pub source_category: String,
}

pub fn resolve_group(group: &str) -> Result<GroupSpec> {
    let key = normalize_key(group);
    if key.is_empty() {
        return Ok(GroupSpec {
            canonical: String::new(),
            source_category: String::new(),
        });
    }

    let canonical = match key.as_str() {
        "artist" | "artists" => "artists",
        "character" | "characters" => "characters",
        "series" | "ip" | "copyright" => "series",
        "meta" => "meta",
        "appearance" | "look" | "feature" | "features" => "appearance",
        "body" | "figure" => "body",
        "expression" | "emotion" | "face" => "expression",
        "pose" => "pose",
        "action" | "movement" => "action",
        "camera" | "view" | "angle" | "framing" => "camera",
        "clothing" | "outfit" => "clothing",
        "clothing_detail" | "detail" => "clothing_detail",
        "handwear" => "handwear",
        "accessory" | "accessories" => "accessory",
        "scene" | "background" | "composition" => "scene",
        "lighting" | "light" => "lighting",
        "atmosphere" | "mood" => "atmosphere",
        "prop" | "object" => "prop",
        _ => return Err(anyhow!("未知 group: {group}")),
    };

    let source_category = match canonical {
        "artists" => "artists",
        "characters" => "characters",
        "series" => "series",
        "meta" => "meta",
        _ => "general",
    };

    Ok(GroupSpec {
        canonical: canonical.to_string(),
        source_category: source_category.to_string(),
    })
}

pub fn normalize_category(category: &str) -> Result<String> {
    let value = category.trim().to_lowercase();
    if value.is_empty() {
        return Ok(String::new());
    }
    if BASE_CATEGORIES.contains(&value.as_str()) {
        return Ok(value);
    }
    Err(anyhow!("未知 category: {category}"))
}

pub fn query_categories(group_name: &str, category: &str, _has_query: bool) -> Vec<String> {
    if group_name == "series" {
        return vec!["series".to_string()];
    }
    if group_name == "characters" {
        return vec!["characters".to_string()];
    }
    if !category.is_empty() {
        return vec![category.to_string()];
    }
    BASE_CATEGORIES
        .iter()
        .map(|item| (*item).to_string())
        .collect()
}

pub fn clamp_limit(limit: usize) -> usize {
    if limit == 0 { 20 } else { limit.min(MAX_LIMIT) }
}

fn normalize_key(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .replace('-', "_")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_aliases() {
        let group = resolve_group("ip").unwrap();
        assert_eq!(group.canonical, "series");
        assert_eq!(group.source_category, "series");
        let group = resolve_group("face").unwrap();
        assert_eq!(group.canonical, "expression");
        assert_eq!(group.source_category, "general");
    }
}
