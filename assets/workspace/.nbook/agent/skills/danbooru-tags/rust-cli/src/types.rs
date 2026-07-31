use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct BatchInput {
    pub queries: Vec<BatchQuery>,
    #[serde(default)]
    pub max_workers: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BatchQuery {
    pub id: String,
    #[serde(default)]
    pub keyword: String,
    #[serde(default)]
    pub prefix: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub group: String,
    #[serde(default)]
    pub min_count: i64,
    #[serde(default = "default_batch_limit")]
    pub limit: usize,
    #[serde(default)]
    pub extended: bool,
    #[serde(default)]
    pub match_mode: String,
}

fn default_batch_limit() -> usize {
    5
}

#[derive(Debug, Clone, Serialize)]
pub struct BatchPromptOutput {
    pub found: bool,
    pub results: BTreeMap<String, LayeredPrompt>,
    pub missing: Vec<String>,
    pub usage: Usage,
}

#[derive(Debug, Clone, Serialize)]
pub struct BatchCompactPromptOutput {
    pub found: bool,
    pub results: BTreeMap<String, CompactLayeredPrompt>,
    pub missing: Vec<String>,
    pub usage: Usage,
}

#[derive(Debug, Clone)]
pub struct SearchRequest {
    pub keyword: String,
    pub prefix: String,
    pub category: String,
    pub group: String,
    pub min_count: i64,
    pub limit: usize,
    pub extended: bool,
    pub match_mode: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResultItem {
    pub tag: String,
    pub prompt_tag: String,
    pub anima_tag: String,
    pub category: String,
    pub source_category: String,
    pub count: i64,
    pub aliases: String,
    pub aliases_short: String,
    pub group: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub match_score: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub match_layer: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PromptItem {
    pub tag: String,
    pub prompt_tag: String,
    pub category: String,
    pub source_category: String,
    pub count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub match_score: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub match_layer: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Usage {
    pub confirmed_tags: String,
    pub candidate_tags: String,
    pub nltags_hint: String,
    pub empty_result: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LayeredPrompt {
    pub found: bool,
    pub confirmed_tags: BTreeMap<String, Vec<PromptItem>>,
    pub candidate_tags: BTreeMap<String, Vec<PromptItem>>,
    pub usage: Usage,
}

impl LayeredPrompt {
    pub fn compact(self) -> CompactLayeredPrompt {
        CompactLayeredPrompt {
            found: self.found,
            confirmed_tags: self.confirmed_tags,
            candidate_tags: self.candidate_tags,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct CompactLayeredPrompt {
    pub found: bool,
    pub confirmed_tags: BTreeMap<String, Vec<PromptItem>>,
    pub candidate_tags: BTreeMap<String, Vec<PromptItem>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RandomTagsOutput {
    pub random_tags: Vec<PromptItem>,
}

pub type SearchResults = BTreeMap<String, Vec<ResultItem>>;
