use std::collections::HashSet;

pub fn normalize_search_text(value: &str) -> String {
    let mut s = value.trim().to_lowercase();
    if s.starts_with('@') {
        s = s[1..].trim().to_string();
    }
    s = s.replace(r"\(", "(").replace(r"\)", ")");
    s = s.replace('-', " ").replace('_', " ");
    collapse_ws(&s)
}

pub fn expand_keyword_terms(keyword: &str) -> Vec<String> {
    let keyword_norm = normalize_search_text(keyword);
    if keyword_norm.is_empty() {
        return Vec::new();
    }

    let mut terms = vec![keyword_norm.clone()];
    let words_only = words(&keyword_norm)
        .into_iter()
        .filter(|word| word.len() > 1)
        .collect::<Vec<_>>();
    let phrase_map: &[(&str, &[&str])] = &[
        ("paw gloves", &["paw gloves", "gloves", "paw"]),
        ("fur trim", &["fur trim", "fur"]),
        ("fur trimmed", &["fur trim", "fur trimmed", "fur"]),
        ("hooded cape", &["hooded cape", "hood", "cape"]),
        (
            "three-quarter view",
            &[
                "three quarter view",
                "three-quarter view",
                "from side",
                "profile",
            ],
        ),
        (
            "three quarter view",
            &["three quarter view", "from side", "profile"],
        ),
        (
            "window light",
            &["window shadow", "sunlight", "backlighting"],
        ),
        ("backlight", &["backlighting", "sunlight"]),
        (
            "rim lighting",
            &["backlighting", "sidelighting", "lighting"],
        ),
    ];

    for (phrase, additions) in phrase_map {
        if keyword_norm.contains(phrase) {
            terms.extend(additions.iter().map(|value| (*value).to_string()));
        }
    }
    if words_only.len() > 1 {
        terms.extend(words_only);
    }
    dedupe_terms(terms)
}

pub fn matches_query(
    tag_norm: &str,
    aliases_norm: &str,
    prefix_norm: &str,
    keyword_terms: &[String],
    group_name: &str,
) -> bool {
    if !prefix_norm.is_empty() && !tag_norm.starts_with(prefix_norm) {
        return false;
    }
    if keyword_terms.is_empty() {
        return true;
    }
    if group_name == "characters" || group_name == "series" {
        return matches_structured_name(tag_norm, aliases_norm, keyword_terms);
    }
    keyword_terms
        .iter()
        .any(|term| tag_norm.contains(term) || aliases_norm.contains(term))
}

pub fn match_score(tag_norm: &str, aliases_norm: &str, keyword_terms: &[String]) -> i64 {
    if keyword_terms.is_empty() {
        return 0;
    }
    let primary = &keyword_terms[0];
    let tag_loose = normalize_loose_text(tag_norm);
    let aliases_loose = normalize_loose_text(aliases_norm);
    let primary_loose = normalize_loose_text(primary);
    let mut score = primary_match_score(
        tag_norm,
        aliases_norm,
        &tag_loose,
        &aliases_loose,
        primary,
        &primary_loose,
    );
    for term in keyword_terms.iter().skip(1) {
        score += secondary_match_score(tag_norm, aliases_norm, &tag_loose, &aliases_loose, term);
    }
    score
}

pub fn collapse_ws(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn result_identity(source_category: &str, tag: &str) -> String {
    format!("{}::{}", source_category, tag.to_lowercase())
}

fn matches_structured_name(tag_norm: &str, aliases_norm: &str, keyword_terms: &[String]) -> bool {
    let primary = &keyword_terms[0];
    let primary_loose = normalize_loose_text(primary);
    let tag_loose = normalize_loose_text(tag_norm);
    let aliases_loose = normalize_loose_text(aliases_norm);

    if contains_word_phrase(&tag_loose, &primary_loose)
        || contains_word_phrase(&aliases_loose, &primary_loose)
    {
        return true;
    }

    let head = primary_head_term(&primary_loose);
    if !head.is_empty()
        && (contains_word_phrase(&tag_loose, &head) || contains_word_phrase(&aliases_loose, &head))
    {
        return true;
    }

    if keyword_terms.len() == 1 {
        let term = normalize_loose_text(&keyword_terms[0]);
        return contains_word_phrase(&tag_loose, &term)
            || contains_word_phrase(&aliases_loose, &term);
    }
    false
}

fn normalize_loose_text(value: &str) -> String {
    let mut s = normalize_search_text(value);
    let mut cleaned = String::with_capacity(s.len());
    for ch in s.drain(..) {
        if ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '@' || ch.is_whitespace() {
            cleaned.push(ch);
        } else {
            cleaned.push(' ');
        }
    }
    collapse_ws(&cleaned)
}

fn contains_word_phrase(text: &str, phrase: &str) -> bool {
    let text_words = normalize_loose_text(text);
    let phrase_words = normalize_loose_text(phrase);
    let text_words = words(&text_words);
    let phrase_words = words(&phrase_words);
    if phrase_words.is_empty() || phrase_words.len() > text_words.len() {
        return false;
    }

    let width = phrase_words.len();
    text_words
        .windows(width)
        .any(|window| window == phrase_words.as_slice())
}

fn primary_match_score(
    tag_norm: &str,
    aliases_norm: &str,
    tag_loose: &str,
    aliases_loose: &str,
    primary: &str,
    primary_loose: &str,
) -> i64 {
    let mut score = 0;
    if tag_norm == primary {
        score += 100;
    }
    if tag_loose == primary_loose {
        score += 120;
    }
    if contains_word_phrase(tag_loose, primary_loose) {
        score += 80;
    }
    if contains_word_phrase(aliases_loose, primary_loose) {
        score += 70;
    }
    if primary_loose.len() >= 5 && tag_loose.starts_with(primary_loose) {
        score += 30;
    }
    if tag_norm.contains(primary) {
        score += 20;
    }
    if aliases_norm.contains(primary) {
        score += 20;
    }
    if !primary_loose.is_empty() && aliases_loose.contains(primary_loose) {
        score += 20;
    }
    score
}

fn secondary_match_score(
    tag_norm: &str,
    aliases_norm: &str,
    tag_loose: &str,
    aliases_loose: &str,
    term: &str,
) -> i64 {
    let term_loose = normalize_loose_text(term);
    if tag_norm == term {
        40
    } else if tag_loose == term_loose {
        40
    } else if contains_word_phrase(tag_loose, &term_loose) {
        30
    } else if contains_word_phrase(aliases_loose, &term_loose) {
        20
    } else if tag_norm.contains(term) {
        10
    } else if aliases_norm.contains(term) {
        10
    } else if !term_loose.is_empty() && aliases_loose.contains(&term_loose) {
        10
    } else {
        0
    }
}

fn primary_head_term(primary_loose: &str) -> String {
    let parts = words(primary_loose);
    if parts.is_empty() {
        return String::new();
    }
    let stopwords: HashSet<&str> = HashSet::from([
        "azur",
        "lane",
        "blue",
        "archive",
        "girls",
        "frontline",
        "fate",
        "grand",
        "order",
    ]);
    if parts.len() > 1 && stopwords.contains(parts[0].as_str()) {
        let last = parts.last().cloned().unwrap_or_default();
        return if last.len() >= 3 { last } else { String::new() };
    }
    if parts[0].len() >= 3 {
        parts[0].clone()
    } else {
        String::new()
    }
}

fn words(value: &str) -> Vec<String> {
    value.split_whitespace().map(ToOwned::to_owned).collect()
}

fn dedupe_terms(terms: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut output = Vec::new();
    for term in terms {
        let key = term.trim().to_string();
        if key.is_empty() || !seen.insert(key.clone()) {
            continue;
        }
        output.push(key);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_phrases() {
        let terms = expand_keyword_terms("fur-trimmed hooded cape");
        assert!(terms.contains(&"fur trim".to_string()));
        assert!(terms.contains(&"hood".to_string()));
        assert!(terms.contains(&"cape".to_string()));
    }
}
