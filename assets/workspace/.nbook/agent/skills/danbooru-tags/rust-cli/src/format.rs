use std::collections::BTreeMap;

use crate::search::{LayeredPrompt, SearchResults};

pub fn format_results(results: &SearchResults, verbose: bool) -> String {
    let mut lines = Vec::new();
    let total: usize = results.values().map(Vec::len).sum();
    lines.push(format!("找到 {total} 个标签"));
    lines.push(String::new());

    for (cat, items) in results {
        lines.push(format!("[{cat}] ({}个)", items.len()));
        for item in items {
            let aliases = if verbose {
                &item.aliases
            } else {
                &item.aliases_short
            };
            let alias_str = if aliases.is_empty() {
                String::new()
            } else {
                format!(" | 别名: {aliases}")
            };
            let display_tag = if item.anima_tag.is_empty() {
                item.prompt_tag.as_str()
            } else {
                item.anima_tag.as_str()
            };
            let source_str = if item.source_category != *cat {
                format!(" | 源: {}", item.source_category)
            } else {
                String::new()
            };
            lines.push(format!(
                "  {display_tag} ({}){alias_str}{source_str}",
                format_count(item.count)
            ));
        }
        lines.push(String::new());
    }

    lines.join("\n")
}

fn format_count(count: i64) -> String {
    let chars = count.abs().to_string().chars().rev().collect::<Vec<_>>();
    let mut grouped = String::new();
    for (idx, ch) in chars.iter().enumerate() {
        if idx > 0 && idx % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(*ch);
    }
    let mut result = grouped.chars().rev().collect::<String>();
    if count < 0 {
        result.insert(0, '-');
    }
    result
}

pub fn format_layered_prompt_results(results: &LayeredPrompt) -> String {
    let mut lines = Vec::new();
    lines.push("可回填标签（分层候选）".to_string());
    lines.push(String::new());
    append_layer(&mut lines, "confirmed_tags", &results.confirmed_tags);
    append_layer(&mut lines, "candidate_tags", &results.candidate_tags);
    lines.push("[nltags_hint] CSV 没覆盖或组合关系不完整时，用英文自然语言补足，可写成短段落或多句，只要不与硬锚点冲突即可.".to_string());
    lines.join("\n")
}

fn append_layer(
    lines: &mut Vec<String>,
    title: &str,
    groups: &BTreeMap<String, Vec<crate::search::PromptItem>>,
) {
    if groups.is_empty() {
        return;
    }
    lines.push(format!("[{title}]"));
    for (cat, items) in groups {
        let values = items
            .iter()
            .map(|item| item.prompt_tag.as_str())
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>();
        if !values.is_empty() {
            lines.push(format!("  {cat}: {}", values.join(", ")));
        }
    }
    lines.push(String::new());
}
