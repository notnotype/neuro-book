use clap::{CommandFactory, Parser};
use serde_json::to_string_pretty;

use crate::types::{BatchInput, BatchQuery, RandomTagsOutput};

use crate::format::{format_layered_prompt_results, format_results};
use crate::search::{
    SearchRequest, batch_compact_layered_for_prompt, batch_layered_for_prompt, layered_for_prompt,
    prompt_item, random_artists, random_tags, search_tags,
};

#[derive(Parser, Debug)]
#[command(name = "danbooru-tags", about = "Danbooru 标签检索")]
struct Args {
    #[arg(long, short = 'k', default_value = "")]
    keyword: String,
    #[arg(long, short = 'p', default_value = "")]
    prefix: String,
    #[arg(long, short = 'c', default_value = "")]
    category: String,
    #[arg(long, short = 'g', default_value = "")]
    group: String,
    #[arg(long = "min-count", short = 'm', default_value_t = 0)]
    min_count: i64,
    #[arg(long, short = 'l', default_value_t = 20)]
    limit: usize,
    #[arg(long = "json", short = 'j')]
    json: bool,
    #[arg(long = "for-prompt")]
    for_prompt: bool,
    #[arg(long)]
    compact: bool,
    #[arg(long, short = 'r', default_value_t = 0)]
    random: usize,
    #[arg(long, short = 'e')]
    extended: bool,
    #[arg(long, short = 'v')]
    verbose: bool,
    #[arg(long = "batch-json", default_value = "")]
    batch_json: String,
    #[arg(long = "batch-file", default_value = "")]
    batch_file: String,
    #[arg(long = "batch-workers", default_value_t = 4)]
    batch_workers: usize,
    #[arg(long = "match-mode", default_value = "auto")]
    match_mode: String,
}

pub fn run() -> anyhow::Result<()> {
    let args = Args::parse();
    if !args.batch_json.is_empty() || !args.batch_file.is_empty() {
        return print_batch_results(&args);
    }

    if args.random > 0 {
        return print_random(&args);
    }

    let has_filter = !args.keyword.is_empty()
        || !args.prefix.is_empty()
        || !args.category.is_empty()
        || !args.group.is_empty()
        || args.min_count > 0;
    if !has_filter {
        Args::command().print_help()?;
        println!();
        std::process::exit(1);
    }

    let request = SearchRequest {
        keyword: args.keyword,
        prefix: args.prefix,
        category: args.category,
        group: args.group,
        min_count: args.min_count,
        limit: args.limit,
        extended: args.extended,
        match_mode: args.match_mode,
    };
    let results = search_tags(&request)?;

    if args.for_prompt && args.compact {
        let output = layered_for_prompt(&results).compact();
        if args.json {
            println!("{}", to_string_pretty(&output)?);
        } else {
            println!("{}", to_string_pretty(&output)?);
        }
        return Ok(());
    }

    if args.for_prompt {
        let output = layered_for_prompt(&results);
        if args.json {
            println!("{}", to_string_pretty(&output)?);
        } else {
            println!("{}", format_layered_prompt_results(&output));
        }
        return Ok(());
    }

    if args.json {
        println!("{}", to_string_pretty(&results)?);
    } else {
        println!("{}", format_results(&results, args.verbose));
    }
    Ok(())
}

fn print_batch_results(args: &Args) -> anyhow::Result<()> {
    let mut input = read_batch_input(args)?;
    if input.max_workers.is_none() {
        input.max_workers = Some(args.batch_workers);
    }
    if args.compact {
        let output = batch_compact_layered_for_prompt(&input)?;
        println!("{}", to_string_pretty(&output)?);
        return Ok(());
    }

    let output = batch_layered_for_prompt(&input)?;
    if args.json {
        println!("{}", to_string_pretty(&output)?);
    } else {
        println!("{}", to_string_pretty(&output)?);
    }
    Ok(())
}

fn read_batch_input(args: &Args) -> anyhow::Result<BatchInput> {
    if !args.batch_json.is_empty() && !args.batch_file.is_empty() {
        anyhow::bail!("--batch-json and --batch-file cannot be used together");
    }
    if !args.batch_json.is_empty() {
        return parse_batch_input(&args.batch_json);
    }
    let data = std::fs::read_to_string(&args.batch_file)?;
    parse_batch_input(&data)
}

fn parse_batch_input(data: &str) -> anyhow::Result<BatchInput> {
    match serde_json::from_str::<BatchInput>(data) {
        Ok(input) => return Ok(input),
        Err(object_err) => match serde_json::from_str::<Vec<BatchQuery>>(data) {
            Ok(queries) => Ok(BatchInput {
                queries,
                max_workers: None,
            }),
            Err(array_err) => anyhow::bail!(
                "invalid batch input; expected object {{\"queries\":[...]}} or array [...]; object error: {object_err}; array error: {array_err}"
            ),
        },
    }
}

fn print_random(args: &Args) -> anyhow::Result<()> {
    if !args.group.is_empty() || !args.category.is_empty() {
        return print_random_tags(args);
    }
    print_random_artists(args)
}

fn print_random_artists(args: &Args) -> anyhow::Result<()> {
    let artists = random_artists(args.random, args.extended)?;
    let output = if args.for_prompt {
        artists.into_iter().take(1).collect::<Vec<_>>()
    } else {
        artists
    };

    if args.json {
        let key = if args.for_prompt {
            "random_artists_for_prompt"
        } else {
            "random_artists"
        };
        println!("{}", to_string_pretty(&serde_json::json!({ key: output }))?);
        return Ok(());
    }

    let src = if args.extended {
        "扩展列表"
    } else {
        "高质量画师"
    };
    let mode = if args.for_prompt {
        "生图回填"
    } else {
        "测试串"
    };
    println!("随机画师串（{src}，{mode}，{}个）：", output.len());
    println!("{}", output.join(", "));
    Ok(())
}

fn print_random_tags(args: &Args) -> anyhow::Result<()> {
    if args.for_prompt {
        anyhow::bail!(
            "--for-prompt random mode is only for artist prompt backfill; use --random N --group ... --json for random tag candidates"
        );
    }
    let request = SearchRequest {
        keyword: String::new(),
        prefix: String::new(),
        category: args.category.clone(),
        group: args.group.clone(),
        min_count: args.min_count,
        limit: args.random,
        extended: args.extended,
        match_mode: "fuzzy".to_string(),
    };
    let output = RandomTagsOutput {
        random_tags: random_tags(&request)?.iter().map(prompt_item).collect(),
    };

    if args.json {
        println!("{}", to_string_pretty(&output)?);
        return Ok(());
    }

    println!("随机标签（{}个）：", output.random_tags.len());
    for item in output.random_tags {
        println!("- {} ({})", item.prompt_tag, item.count);
    }
    Ok(())
}
