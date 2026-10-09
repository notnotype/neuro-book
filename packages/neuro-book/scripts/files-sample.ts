/**
 * 生成 Files 的样本项目（w00017 t68 的“列出不读内容”证据、t72 的性能验收共用同一套参数与布局）：约 3000 个 Markdown、
 * 3–5 层目录、单个文件 5–30 KB 的精确 UTF-8 字节数，一个 400 项的宽目录，一个带 `content.xml` 的内容文件夹（有正文与
 * 无正文的节点、未列入项、缺失条目）。布局与大小只由参数决定（缺省 seed 42017），同一参数在任何机器上生成同样的字节。
 * 可选另放一批源码文件（`data/source-NNN.json`，t72 的源码编辑器场景用），不占 Markdown 的名额；缺省没有。
 *
 *   bun scripts/files-sample.ts <目标目录> [--count 3000] [--seed 42017] [--wide 400] [--sources 0]
 *
 * 目标目录必须不存在或为空。标准输出是机器可读的样本描述（JSON）。
 */

import {mkdir, readdir, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";

export interface SampleOptions {
    readonly count?: number;
    readonly seed?: number;
    readonly minBytes?: number;
    readonly maxBytes?: number;
    readonly wide?: number;
    /** 另生成的源码文件（`data/source-NNN.json`）个数。 */
    readonly sources?: number;
}

export interface SampleFile {
    readonly path: string;
    readonly bytes: number;
    /** 写进正文第一行的唯一标记：读到它说明打开的是这个文件。 */
    readonly marker: string;
}

export interface SampleDescription {
    readonly seed: number;
    /** Markdown 文件数（不含源码文件）。 */
    readonly count: number;
    readonly totalBytes: number;
    readonly wideDirectory: {readonly path: string; readonly entries: number};
    readonly contentRoot: string;
    /** 内容文件夹里：无正文的节点、未列入清单的节点、清单里有磁盘上没有的条目。 */
    readonly contentCases: {readonly withoutBody: ReadonlyArray<string>; readonly unlisted: ReadonlyArray<string>; readonly missing: ReadonlyArray<string>};
    /** 源码文件的资源地址（`sources` 为 0 时为空）。 */
    readonly sources: ReadonlyArray<string>;
    /** 冷打开与热打开用的文件（资源地址），以及它们的标记。 */
    readonly open: {readonly cold: {readonly address: string; readonly marker: string}; readonly hot: {readonly address: string; readonly marker: string}};
}

export interface SamplePlan {
    readonly files: ReadonlyArray<SampleFile>;
    readonly manifest: string;
    readonly description: SampleDescription;
}

const GROUPS = [{name: "characters", title: "人物", type: "char"}, {name: "places", title: "地点", type: "place"}, {name: "rules", title: "设定", type: "rule"}] as const;
const SENTENCE = "雨后的青石镇安静下来，檐下的水滴一声声落在石阶上。";

/** 只由参数决定的布局与大小；不读磁盘与时间。 */
export function planSample(options: SampleOptions = {}): SamplePlan {
    const count = options.count ?? 3000;
    const seed = options.seed ?? 42017;
    const minBytes = options.minBytes ?? 5 * 1024;
    const maxBytes = options.maxBytes ?? 30 * 1024;
    const wide = options.wide ?? 400;
    const sources = options.sources ?? 0;
    const random = seededRandom(seed);
    const files: SampleFile[] = [];
    const add = (path: string): SampleFile => {
        const file = {path, bytes: minBytes + Math.floor(random() * (maxBytes - minBytes + 1)), marker: `NBOOK-SAMPLE-${String(seed)}-${String(files.length).padStart(5, "0")}`};
        files.push(file);
        return file;
    };

    // 三成内容节点、三成章节、其余笔记（含宽目录）。
    const nodes = Math.floor(count * 0.3);
    const chapters = Math.floor(count * 0.3);
    const notes = count - nodes - chapters;
    // 宽目录从笔记的份额里分：放不下就报错，不写出与描述不符的样本。
    if (wide > notes) throw new Error(`文件数 ${String(count)} 只有 ${String(notes)} 个笔记的名额，放不下 ${String(wide)} 项的宽目录`);
    const listed: Array<{readonly group: string; readonly title: string; readonly items: string[]}> = GROUPS.map((group) => ({group: group.name, title: group.title, items: []}));
    const withoutBody: string[] = [];
    const unlisted: string[] = [];
    for (let index = 0; index < nodes; index += 1) {
        const group = GROUPS[index % GROUPS.length]!;
        const node = `${group.type}-${String(index + 1).padStart(4, "0")}`;
        const directory = `lorebook.content/${group.name}/${node}`;
        // 每 25 个节点有一个没有正文（只有附注）；每 40 个有一个不在清单里。
        add(index % 25 === 24 ? `${directory}/notes.md` : `${directory}/index.md`);
        if (index % 25 === 24) withoutBody.push(directory);
        if (index % 40 === 39) unlisted.push(directory);
        else listed[index % GROUPS.length]!.items.push(node);
    }
    const missing = GROUPS.map((group) => `lorebook.content/${group.name}/${group.type}-gone`);
    for (let index = 0; index < chapters; index += 1) {
        add(`manuscripts/volume-${String((index % 10) + 1).padStart(2, "0")}/chapter-${String(index + 1).padStart(4, "0")}.md`);
    }
    for (let index = 0; index < notes; index += 1) {
        const name = `note-${String(index + 1).padStart(4, "0")}.md`;
        if (index < wide) add(`notes/wide/${name}`);
        else if (index % 2 === 0) add(`notes/archive/2026/q1/${name}`);
        else add(`notes/projects/project-${String((index % 12) + 1).padStart(2, "0")}/${name}`);
    }
    const markdown = files.length;
    // 源码文件放在 Markdown 之后，`sources` 为 0 时与原来的样本逐字节相同。
    for (let index = 0; index < sources; index += 1) add(`data/source-${String(index + 1).padStart(3, "0")}.json`);

    const manifest = [
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
        "<content>",
        ...listed.flatMap((group, at) => [
            `  <item name="${group.group}" title="${group.title}">`,
            ...group.items.map((item) => `    <item name="${item}" title="${item.toUpperCase()}"/>`),
            `    <item name="${GROUPS[at]!.type}-gone" title="已删除"/>`,
            "  </item>",
        ]),
        "</content>",
        "",
    ].join("\n");

    const cold = files[Math.floor(markdown / 2)]!;
    const hot = files[1]!;
    return {
        files,
        manifest,
        description: {
            seed,
            count: markdown,
            totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
            wideDirectory: {path: "notes/wide", entries: wide},
            contentRoot: "lorebook.content",
            contentCases: {withoutBody, unlisted, missing},
            sources: files.slice(markdown).map((file) => `project://${file.path}`),
            open: {cold: {address: `project://${cold.path}`, marker: cold.marker}, hot: {address: `project://${hot.path}`, marker: hot.marker}},
        },
    };
}

/**
 * 一个文件的正文，精确到计划的字节数。Markdown：第一行是标记，之后是重复的中文段落，用 ASCII 补齐。JSON：合法的对象，
 * `marker` 字段是标记，`lines` 是重复的段落，`pad` 用 ASCII 补齐。
 */
export function renderSample(file: SampleFile): string {
    if (file.path.endsWith(".json")) return renderJson(file);
    const head = `# ${file.marker}\n\n`;
    const encoder = new TextEncoder();
    let body = head;
    let size = encoder.encode(body).length;
    const sentence = encoder.encode(SENTENCE).length;
    while (size + sentence + 1 <= file.bytes) {
        body += `${SENTENCE}\n`;
        size += sentence + 1;
    }
    return body + ".".repeat(file.bytes - size);
}

function renderJson(file: SampleFile): string {
    const encoder = new TextEncoder();
    const head = `{\n  "marker": "${file.marker}",\n  "lines": [\n`;
    const tail = "    \"\"\n  ],\n  \"pad\": \"";
    const end = "\"\n}\n";
    const line = `    "${SENTENCE}",\n`;
    const lineBytes = encoder.encode(line).length;
    let body = head;
    let size = encoder.encode(head).length + encoder.encode(tail).length + encoder.encode(end).length;
    if (size > file.bytes) throw new Error(`${file.path} 的字节数 ${String(file.bytes)} 放不下 JSON 的骨架`);
    while (size + lineBytes <= file.bytes) {
        body += line;
        size += lineBytes;
    }
    return `${body}${tail}${".".repeat(file.bytes - size)}${end}`;
}

/** 把样本写进 `target`（必须不存在或为空）；返回样本描述。 */
export async function writeSample(target: string, options: SampleOptions = {}): Promise<SampleDescription> {
    await mkdir(target, {recursive: true});
    if ((await readdir(target)).length > 0) throw new Error(`${target} 不是空目录`);
    const plan = planSample(options);
    for (const file of plan.files) {
        await mkdir(dirname(join(target, file.path)), {recursive: true});
        await writeFile(join(target, file.path), renderSample(file));
    }
    await writeFile(join(target, plan.description.contentRoot, "content.xml"), plan.manifest);
    return plan.description;
}

/** mulberry32：小而确定的伪随机数，同一个 seed 在任何平台得到同一串数。 */
function seededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

function option(name: string, fallback: number): number {
    const at = process.argv.indexOf(`--${name}`);
    if (at < 0) return fallback;
    const value = Number(process.argv[at + 1]);
    if (!Number.isInteger(value) || value < 0) throw new Error(`--${name} 要一个非负整数`);
    return value;
}

if (import.meta.main) {
    const target = process.argv[2];
    if (target === undefined || target.startsWith("--")) {
        console.error("用法：bun scripts/files-sample.ts <目标目录> [--count 3000] [--seed 42017] [--wide 400] [--sources 0]");
        process.exit(2);
    }
    const description = await writeSample(target, {count: option("count", 3000), seed: option("seed", 42017), wide: option("wide", 400), sources: option("sources", 0)});
    console.log(JSON.stringify(description, null, 2));
}
