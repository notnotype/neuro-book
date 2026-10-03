import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {inflateRawSync} from "node:zlib";
import {Command} from "commander";

type ImportOptions = {
    workspace?: string;
    out: string;
    force: boolean;
    keepRaw: boolean;
};

type ExeOptions = {
    exe: string;
    dataDir?: string;
    password?: string;
    debug: boolean;
};

type ZipEntry = {
    name: string;
    compressionMethod: number;
    compressedSize: number;
    uncompressedSize: number;
    localHeaderOffset: number;
};

type Chapter = {
    id?: string;
    title: string;
    markdown: string;
};

type ImageAsset = {
    sourcePath: string;
    outputPath: string;
    aliases: string[];
};

type ExtractedEpubImages = {
    assets: ImageAsset[];
    tempRoot: string;
};

type BookMetadata = {
    book_name: string;
    author?: string;
    book_id?: string;
    category?: string;
    description?: string;
    chapter_count: number;
    source_type: "epub" | "tomato-download";
    imported_at: string;
    source_path: string;
};

const DEFAULT_OUT = "reference/tomato";
const DEFAULT_EXE = "C:\\Users\\notnotype\\Downloads\\TomatoNovelDownloader-Win64-v2.4.9.exe";

const program = new Command();

program
    .name("tomato-novel")
    .description("番茄小说本地素材导入与 Tomato Novel Downloader 薄封装工具");

program
    .command("import-epub")
    .description("导入本地 epub，并转换为 Markdown 参考资料")
    .argument("<epub>", "本地 epub 文件路径")
    .requiredOption("--workspace <path>", "当前小说 workspace 根目录")
    .option("--out <path>", "workspace 内输出目录", DEFAULT_OUT)
    .option("--force", "允许覆盖已有同名导入目录", false)
    .option("--keep-raw", "复制原始 epub 到 raw/", false)
    .action(async (epubPath: string, options: ImportOptions) => {
        await importEpub(epubPath, options);
    });

program
    .command("import-download")
    .description("导入 Tomato Novel Downloader 已下载出的结构化目录")
    .argument("<dir>", "包含 status.json 或 downloaded_chapters.jsonl 的目录")
    .requiredOption("--workspace <path>", "当前小说 workspace 根目录")
    .option("--out <path>", "workspace 内输出目录", DEFAULT_OUT)
    .option("--force", "允许覆盖已有同名导入目录", false)
    .option("--keep-raw", "复制原始 JSON 到 raw/", false)
    .action(async (downloadDir: string, options: ImportOptions) => {
        await importDownload(downloadDir, options);
    });

program
    .command("serve")
    .description("启动 Tomato Novel Downloader Web UI，供手动搜索和首次下载")
    .option("--exe <path>", "下载器 exe 路径", DEFAULT_EXE)
    .option("--data-dir <path>", "下载器数据目录")
    .option("--password <password>", "Web UI 密码")
    .option("--debug", "启用下载器调试日志", false)
    .action(async (options: ExeOptions) => {
        await runDownloader(options.exe, buildServeArgs(options));
    });

program
    .command("update")
    .description("更新下载器已经记录过的本地小说；不支持首次下载")
    .argument("<book-id>", "下载器已有记录的 book_id")
    .option("--exe <path>", "下载器 exe 路径", DEFAULT_EXE)
    .option("--data-dir <path>", "下载器数据目录")
    .option("--debug", "启用下载器调试日志", false)
    .action(async (bookId: string, options: ExeOptions) => {
        await runDownloader(options.exe, buildUpdateArgs(bookId, options));
    });

program.parseAsync().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});

/**
 * 导入本地 epub 文件。
 */
async function importEpub(epubPathInput: string, options: ImportOptions): Promise<void> {
    const epubPath = path.resolve(epubPathInput);
    const zipEntries = await readZipEntries(epubPath);
    const containerXml = await readZipText(epubPath, zipEntries, "META-INF/container.xml");
    const opfPath = extractFirstMatch(containerXml, /full-path="([^"]+)"/u) ?? fail("epub 缺少 OPF 路径。");
    const opfXml = await readZipText(epubPath, zipEntries, opfPath);
    const opfDir = path.posix.dirname(opfPath);
    const manifest = parseManifest(opfXml);
    const spineIds = parseSpine(opfXml);
    const metadata = parseEpubMetadata(opfXml, epubPath);
    const chapters: Chapter[] = [];
    const extractedImages = await extractEpubImages(epubPath, zipEntries, manifest, opfDir);
    const imageAssets = extractedImages.assets;
    const imageAliases = buildImageAliases(imageAssets);
    const chapterItems = selectEpubChapterItems(spineIds, manifest);

    for (const spineId of chapterItems) {
        const manifestItem = manifest.get(spineId);
        if (!manifestItem) {
            continue;
        }
        const chapterPath = normalizeZipPath(opfDir, manifestItem.href);
        const xhtml = await readZipText(epubPath, zipEntries, chapterPath);
        const title = extractHtmlTitle(xhtml) || `第 ${chapters.length + 1} 章`;
        chapters.push({
            title,
            markdown: htmlToMarkdown(xhtml, (src) => imageAliases.get(normalizeZipPath(path.posix.dirname(chapterPath), src))),
        });
    }

    try {
        const bookMetadata: BookMetadata = {
            ...metadata,
            chapter_count: chapters.length,
            source_type: "epub",
            imported_at: new Date().toISOString(),
            source_path: epubPath,
        };
        const target = await writeBookOutput(bookMetadata, chapters, options, imageAssets);

        if (options.keepRaw) {
            await fs.mkdir(path.join(target, "raw"), {recursive: true});
            await fs.copyFile(epubPath, path.join(target, "raw", path.basename(epubPath)));
        }

        console.log(`导入完成：${target}`);
    } finally {
        await fs.rm(extractedImages.tempRoot, {recursive: true, force: true});
    }
}

/**
 * 导入下载器结构化目录。
 */
async function importDownload(downloadDirInput: string, options: ImportOptions): Promise<void> {
    const downloadDir = path.resolve(downloadDirInput);
    const statusPath = path.join(downloadDir, "status.json");
    const chaptersPath = path.join(downloadDir, "downloaded_chapters.jsonl");
    const status = JSON.parse(await fs.readFile(statusPath, "utf-8")) as Record<string, unknown>;
    const chapters = await readDownloadedChapters(chaptersPath);
    const bookName = stringValue(status.book_name) || path.basename(downloadDir).replace(/^\d+_/u, "");
    const imageAssets = await collectDownloadImages(downloadDir);
    const bookMetadata: BookMetadata = {
        book_name: bookName,
        author: stringValue(status.author),
        book_id: stringValue(status.book_id),
        category: stringValue(status.category),
        description: stringValue(status.description),
        chapter_count: chapters.length,
        source_type: "tomato-download",
        imported_at: new Date().toISOString(),
        source_path: downloadDir,
    };
    const target = await writeBookOutput(bookMetadata, chapters, options, imageAssets);

    if (options.keepRaw) {
        await fs.mkdir(path.join(target, "raw"), {recursive: true});
        await fs.copyFile(statusPath, path.join(target, "raw", "status.json"));
        await fs.copyFile(chaptersPath, path.join(target, "raw", "downloaded_chapters.jsonl"));
    }

    console.log(`导入完成：${target}`);
}

/**
 * 写入统一的导入目录。
 */
async function writeBookOutput(metadata: BookMetadata, chapters: Chapter[], options: ImportOptions, imageAssets: ImageAsset[]): Promise<string> {
    const workspaceRoot = path.resolve(options.workspace ?? process.cwd());
    const safeBookName = metadata.book_id || slugify(metadata.book_name);
    const target = resolveInside(workspaceRoot, path.join(options.out, safeBookName));
    await prepareTarget(target, options.force);
    await fs.mkdir(path.join(target, "chapters"), {recursive: true});
    await fs.mkdir(path.join(target, "images"), {recursive: true});

    for (const asset of imageAssets) {
        const imageTarget = path.join(target, asset.outputPath);
        await fs.mkdir(path.dirname(imageTarget), {recursive: true});
        await fs.copyFile(asset.sourcePath, imageTarget);
    }

    await fs.writeFile(path.join(target, "metadata.json"), JSON.stringify(metadata, null, 4), "utf-8");

    const fullParts = [`# ${metadata.book_name}`, ""];
    for (const [index, chapter] of chapters.entries()) {
        const chapterMarkdown = normalizeChapterMarkdown(chapter);
        const fileName = `${String(index + 1).padStart(4, "0")}-${slugify(chapter.title)}.md`;
        await fs.writeFile(path.join(target, "chapters", fileName), chapterMarkdown, "utf-8");
        fullParts.push(chapterMarkdown.trim(), "");
    }
    await fs.writeFile(path.join(target, "full.md"), `${fullParts.join("\n").trim()}\n`, "utf-8");
    return target;
}

/**
 * 选择 epub 正文章节。番茄导出的 epub 使用 chapter_00001.xhtml 命名；其他 epub 回退到排除目录/导航页后的 spine 文档。
 */
function selectEpubChapterItems(spineIds: string[], manifest: Map<string, {href: string; mediaType: string}>): string[] {
    const xhtmlSpineIds = spineIds.filter((spineId) => {
        const item = manifest.get(spineId);
        return item ? isXhtmlItem(item.href) : false;
    });
    const tomatoChapterIds = xhtmlSpineIds.filter((spineId) => {
        const item = manifest.get(spineId);
        return item ? /(^|\/)chapter_\d+\.(xhtml|html?)$/iu.test(item.href) : false;
    });
    if (tomatoChapterIds.length > 0) {
        return tomatoChapterIds;
    }
    return xhtmlSpineIds.filter((spineId) => {
        const item = manifest.get(spineId);
        return item ? !/(^|\/)(toc|nav|table-of-contents|aux)[^/]*\.(xhtml|html?)$/iu.test(item.href) : false;
    });
}

/**
 * 从 JSONL 中读取章节正文。
 */
async function readDownloadedChapters(chaptersPath: string): Promise<Chapter[]> {
    const text = await fs.readFile(chaptersPath, "utf-8");
    const chapters: Chapter[] = [];
    for (const line of text.split(/\r?\n/u)) {
        if (!line.trim()) {
            continue;
        }
        const item = JSON.parse(line) as Record<string, unknown>;
        const title = stringValue(item.title) || `第 ${chapters.length + 1} 章`;
        const html = stringValue(item.content) || "";
        chapters.push({
            id: stringValue(item.id),
            title,
            markdown: htmlToMarkdown(html),
        });
    }
    return chapters;
}

/**
 * 复制下载器目录中的封面和图片。
 */
async function collectDownloadImages(downloadDir: string): Promise<ImageAsset[]> {
    const imageAssets: ImageAsset[] = [];
    const entries = await fs.readdir(downloadDir, {withFileTypes: true});
    for (const entry of entries) {
        const sourcePath = path.join(downloadDir, entry.name);
        if (entry.isFile() && isImagePath(entry.name)) {
            imageAssets.push({sourcePath, outputPath: path.posix.join("images", entry.name), aliases: [entry.name]});
        }
        if (entry.isDirectory() && entry.name === "images") {
            for (const imageFile of await listFiles(sourcePath)) {
                const relative = path.relative(sourcePath, imageFile).replace(/\\/gu, "/");
                imageAssets.push({sourcePath: imageFile, outputPath: path.posix.join("images", relative), aliases: [relative]});
            }
        }
    }
    return imageAssets;
}

/**
 * 复制 epub 内图片到临时文件，再交给统一输出流程复制到目标目录。
 */
async function extractEpubImages(epubPath: string, zipEntries: Map<string, ZipEntry>, manifest: Map<string, {href: string; mediaType: string}>, opfDir: string): Promise<ExtractedEpubImages> {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tomato-epub-images-"));
    const imageAssets: ImageAsset[] = [];
    for (const item of manifest.values()) {
        if (!item.mediaType.startsWith("image/") && !isImagePath(item.href)) {
            continue;
        }
        const zipPath = normalizeZipPath(opfDir, item.href);
        const buffer = await readZipBuffer(epubPath, zipEntries, zipPath);
        const fileName = path.posix.basename(zipPath);
        const tempPath = path.join(tempRoot, fileName);
        await fs.writeFile(tempPath, buffer);
        imageAssets.push({
            sourcePath: tempPath,
            outputPath: path.posix.join("images", fileName),
            aliases: [zipPath, item.href, path.posix.basename(item.href)],
        });
    }
    return {assets: imageAssets, tempRoot};
}

/**
 * 建立图片引用别名索引。
 */
function buildImageAliases(imageAssets: ImageAsset[]): Map<string, string> {
    const aliases = new Map<string, string>();
    for (const asset of imageAssets) {
        for (const alias of asset.aliases) {
            aliases.set(alias, asset.outputPath);
        }
    }
    return aliases;
}

/**
 * 将章节正文整理为稳定 Markdown。
 */
function normalizeChapterMarkdown(chapter: Chapter): string {
    const body = chapter.markdown.replace(new RegExp(`^#\\s+${escapeRegExp(chapter.title)}\\s*\\n+`, "u"), "").trim();
    const idLine = chapter.id ? `\n\n<!-- tomato-chapter-id: ${chapter.id} -->` : "";
    return `# ${chapter.title}${idLine}\n\n${body}\n`;
}

/**
 * 极小 HTML 到 Markdown 转换器，覆盖下载器章节和常见 epub xhtml。
 */
function htmlToMarkdown(html: string, resolveImage?: (src: string) => string | undefined): string {
    let text = html
        .replace(/<head[\s\S]*?<\/head>/giu, "")
        .replace(/<title[\s\S]*?<\/title>/giu, "")
        .replace(/<script[\s\S]*?<\/script>/giu, "")
        .replace(/<style[\s\S]*?<\/style>/giu, "")
        .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/giu, (_match, content: string) => `\n# ${stripTags(content).trim()}\n\n`)
        .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/giu, (_match, content: string) => `\n## ${stripTags(content).trim()}\n\n`)
        .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/giu, (_match, content: string) => `\n### ${stripTags(content).trim()}\n\n`)
        .replace(/<img\b[^>]*>/giu, (tag: string) => {
            const src = extractFirstMatch(tag, /\bsrc=["']([^"']+)["']/iu) || extractFirstMatch(tag, /\bhref=["']([^"']+)["']/iu);
            if (!src) {
                return "";
            }
            const resolved = resolveImage?.(src) || src;
            return `\n\n![](${resolved})\n\n`;
        })
        .replace(/<p[^>]*>([\s\S]*?)<\/p>/giu, (_match, content: string) => `\n${stripTags(content).trim()}\n\n`)
        .replace(/<br\s*\/?>/giu, "\n")
        .replace(/<\/(div|section|article|footer)>/giu, "\n\n")
        .replace(/<[^>]+>/gu, "");
    text = decodeHtmlEntities(text);
    return text
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .join("\n")
        .replace(/\n{3,}/gu, "\n\n")
        .trim();
}

/**
 * 读取 zip 中央目录。
 */
async function readZipEntries(zipPath: string): Promise<Map<string, ZipEntry>> {
    const buffer = await fs.readFile(zipPath);
    const eocdOffset = findEndOfCentralDirectory(buffer);
    const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
    const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
    const entries = new Map<string, ZipEntry>();
    let offset = centralDirectoryOffset;
    for (let index = 0; index < totalEntries; index += 1) {
        if (buffer.readUInt32LE(offset) !== 0x02014b50) {
            throw new Error("zip 中央目录结构异常。");
        }
        const compressionMethod = buffer.readUInt16LE(offset + 10);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const uncompressedSize = buffer.readUInt32LE(offset + 24);
        const nameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const localHeaderOffset = buffer.readUInt32LE(offset + 42);
        const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf-8");
        entries.set(name, {name, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset});
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}

/**
 * 读取 zip 文件中的文本。
 */
async function readZipText(zipPath: string, entries: Map<string, ZipEntry>, entryName: string): Promise<string> {
    return (await readZipBuffer(zipPath, entries, entryName)).toString("utf-8");
}

/**
 * 读取 zip 文件中的二进制内容。
 */
async function readZipBuffer(zipPath: string, entries: Map<string, ZipEntry>, entryName: string): Promise<Buffer> {
    const entry = entries.get(entryName) ?? fail(`zip 中未找到条目：${entryName}`);
    const buffer = await fs.readFile(zipPath);
    const offset = entry.localHeaderOffset;
    if (buffer.readUInt32LE(offset) !== 0x04034b50) {
        throw new Error(`zip 本地文件头异常：${entryName}`);
    }
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + nameLength + extraLength;
    const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);
    if (entry.compressionMethod === 0) {
        return Buffer.from(compressed);
    }
    if (entry.compressionMethod === 8) {
        const inflated = inflateRawSync(compressed);
        if (entry.uncompressedSize !== 0 && inflated.length !== entry.uncompressedSize) {
            throw new Error(`zip 解压尺寸异常：${entryName}`);
        }
        return inflated;
    }
    throw new Error(`不支持的 zip 压缩方式 ${entry.compressionMethod}：${entryName}`);
}

/**
 * 找到 zip EOCD 记录。
 */
function findEndOfCentralDirectory(buffer: Buffer): number {
    for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
        if (buffer.readUInt32LE(offset) === 0x06054b50) {
            return offset;
        }
    }
    throw new Error("找不到 zip EOCD 记录。");
}

/**
 * 解析 epub manifest。
 */
function parseManifest(opfXml: string): Map<string, {href: string; mediaType: string}> {
    const manifest = new Map<string, {href: string; mediaType: string}>();
    for (const match of opfXml.matchAll(/<item\b([^>]*)\/?>/giu)) {
        const attrs = match[1] ?? "";
        const id = extractFirstMatch(attrs, /\bid=["']([^"']+)["']/iu);
        const href = extractFirstMatch(attrs, /\bhref=["']([^"']+)["']/iu);
        const mediaType = extractFirstMatch(attrs, /\bmedia-type=["']([^"']+)["']/iu) ?? "";
        if (id && href) {
            manifest.set(id, {href: decodeXmlAttribute(href), mediaType});
        }
    }
    return manifest;
}

/**
 * 解析 epub spine 章节顺序。
 */
function parseSpine(opfXml: string): string[] {
    const spineMatch = opfXml.match(/<spine\b[\s\S]*?<\/spine>/iu);
    if (!spineMatch) {
        return [];
    }
    return Array.from(spineMatch[0].matchAll(/<itemref\b[^>]*idref=["']([^"']+)["'][^>]*\/?>/giu), (match) => match[1] ?? "");
}

/**
 * 解析 epub 元数据。
 */
function parseEpubMetadata(opfXml: string, epubPath: string): Omit<BookMetadata, "chapter_count" | "source_type" | "imported_at" | "source_path"> {
    return {
        book_name: decodeHtmlEntities(extractFirstMatch(opfXml, /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/iu)?.trim() || path.basename(epubPath, path.extname(epubPath))),
        author: decodeHtmlEntities(extractFirstMatch(opfXml, /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/iu)?.trim() || ""),
        description: decodeHtmlEntities(stripTags(extractFirstMatch(opfXml, /<dc:description[^>]*>([\s\S]*?)<\/dc:description>/iu) || "").trim()),
    };
}

/**
 * 运行下载器 exe。
 */
async function runDownloader(exePath: string, args: string[]): Promise<void> {
    await fs.access(exePath);
    await new Promise<void>((resolve, reject) => {
        const child = spawn(exePath, args, {stdio: "inherit"});
        child.on("error", reject);
        child.on("exit", (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`下载器退出码：${code}`));
        });
    });
}

/**
 * 构造 serve 参数。
 */
function buildServeArgs(options: ExeOptions): string[] {
    const args = ["--server"];
    appendCommonDownloaderArgs(args, options);
    if (options.password) {
        args.push("--password", options.password);
    }
    return args;
}

/**
 * 构造 update 参数。
 */
function buildUpdateArgs(bookId: string, options: ExeOptions): string[] {
    const args = ["--update", bookId];
    appendCommonDownloaderArgs(args, options);
    return args;
}

/**
 * 添加下载器公共参数。
 */
function appendCommonDownloaderArgs(args: string[], options: ExeOptions): void {
    if (options.debug) {
        args.push("--debug");
    }
    if (options.dataDir) {
        args.push("--data-dir", options.dataDir);
    }
}

/**
 * 准备输出目录。
 */
async function prepareTarget(target: string, force: boolean): Promise<void> {
    if (force) {
        await fs.rm(target, {recursive: true, force: true});
        await fs.mkdir(target, {recursive: true});
        return;
    }
    try {
        await fs.mkdir(target, {recursive: true});
        const entries = await fs.readdir(target);
        if (entries.length > 0) {
            throw new Error(`输出目录已存在且非空，请使用 --force 覆盖：${target}`);
        }
    } catch (error) {
        if (error instanceof Error && error.message.includes("输出目录已存在")) {
            throw error;
        }
        throw error;
    }
}

/**
 * 确保输出路径留在 workspace 内。
 */
function resolveInside(root: string, relativePath: string): string {
    const resolved = path.resolve(root, relativePath);
    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`输出路径越过 workspace：${relativePath}`);
    }
    return resolved;
}

/**
 * 列出目录内全部文件。
 */
async function listFiles(root: string): Promise<string[]> {
    const result: string[] = [];
    for (const entry of await fs.readdir(root, {withFileTypes: true})) {
        const current = path.join(root, entry.name);
        if (entry.isDirectory()) {
            result.push(...await listFiles(current));
            continue;
        }
        if (entry.isFile()) {
            result.push(current);
        }
    }
    return result;
}

/**
 * 归一化 zip 内部路径。
 */
function normalizeZipPath(baseDir: string, href: string): string {
    const decodedHref = decodeXmlAttribute(href).split("#")[0] ?? href;
    return path.posix.normalize(path.posix.join(baseDir === "." ? "" : baseDir, decodedHref)).replace(/^\/+/u, "");
}

/**
 * 提取 HTML 标题。
 */
function extractHtmlTitle(html: string): string {
    return decodeHtmlEntities(stripTags(
        extractFirstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/iu)
        || extractFirstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/iu)
        || "",
    ).trim());
}

/**
 * 去除 HTML/XML 标签。
 */
function stripTags(input: string): string {
    return input.replace(/<[^>]+>/gu, "");
}

/**
 * 解码常见 HTML 实体。
 */
function decodeHtmlEntities(input: string): string {
    const named: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: "\"",
        apos: "'",
        nbsp: " ",
    };
    return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/giu, (match, entity: string) => {
        if (entity.startsWith("#x")) {
            return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
        }
        if (entity.startsWith("#")) {
            return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
        }
        return named[entity.toLowerCase()] ?? match;
    });
}

/**
 * 解码 XML 属性中的转义和 URL 编码。
 */
function decodeXmlAttribute(input: string): string {
    try {
        return decodeURIComponent(decodeHtmlEntities(input));
    } catch {
        return decodeHtmlEntities(input);
    }
}

/**
 * 读取字符串字段。
 */
function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * 判断文件是否为图片。
 */
function isImagePath(filePath: string): boolean {
    return /\.(png|jpe?g|gif|webp|svg)$/iu.test(filePath);
}

/**
 * 判断 manifest 条目是否为章节文档。
 */
function isXhtmlItem(filePath: string): boolean {
    return /\.(xhtml|html?)$/iu.test(filePath);
}

/**
 * 生成安全文件名片段。
 */
function slugify(input: string): string {
    return input
        .trim()
        .replace(/[\\/:*?"<>|]+/gu, "-")
        .replace(/\s+/gu, "-")
        .replace(/-+/gu, "-")
        .replace(/^-|-$/gu, "")
        .slice(0, 80) || "book";
}

/**
 * 转义正则文本。
 */
function escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * 提取第一个正则捕获组。
 */
function extractFirstMatch(input: string, pattern: RegExp): string | undefined {
    return input.match(pattern)?.[1];
}

/**
 * 抛出错误并满足表达式类型。
 */
function fail(message: string): never {
    throw new Error(message);
}
