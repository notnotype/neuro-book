mod cli;
mod db;
mod format;
mod groups;
mod prompt;
mod result_item;
mod search;
mod text_match;
mod types;

pub fn run() -> anyhow::Result<()> {
    cli::run()
}
