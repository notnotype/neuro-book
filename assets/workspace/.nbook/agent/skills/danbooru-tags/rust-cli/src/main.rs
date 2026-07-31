fn main() {
    if let Err(err) = danbooru_tags::run() {
        eprintln!("{err:#}");
        std::process::exit(1);
    }
}
