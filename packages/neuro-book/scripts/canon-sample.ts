/**
 * 生成星瑕样本项目（w00039 t31，docs/specs/canon/author-ui.md 验收 1 到 14 用的那部作品）：一个能直接打开的作品目录，带活页夹
 * 三章的正文与世界日志。数据来自 nb-canon 的样本（`@notnotype/nb-canon/sample`，t16 原型导出的十一次写入），经应用自己的
 * 世界宿主（`createWorldHost`，与项目实例里打开世界的是同一段代码）逐次发布，日志、锁与缓存的位置因此与产品一致。
 *
 *   bun scripts/canon-sample.ts [--plot] <目标目录>
 *
 * 目标目录必须不存在或为空。标准输出是机器可读的结果（JSON）：作品 id、条目数、修订数。`--plot` 另带剧情数据（秘密、知情、伏笔、
 * 目标、决策与一条回溯分叉，见 `canon-sample-plot.ts`），剧情侧的作者界面用它；不带时是设定侧用的那份（`canon-author.e2e.ts`）。
 *
 * 原型自己定了四种数据，换成应用内置的类型（开发者 2026-11-11 在 t16 评审板第 13 版定 `map-builtin`；2026-11-24 人物重整、
 * 形象单独成组以后的迁法见 w00039 t41 的计划）：
 * - 人物（`character`）用内置人物：“性格”照旧；“外观”搬到形象的“外貌”；这本书专有的“身体”“现在的样子”“现在的态度”
 *   不是内置人物的字段，谁的数据或补丁里用到，就在谁的条目上声明成它自己的字段（星瑕有前两项，星瑾有第三项）；
 * - 面板（`panel`）用内置面板，原型的五个字段成为每个条目自己声明的字段；
 * - 身份（`identity`）不带：马甲条目照人物带人物与形象两组，“外观”进形象的“外貌”，“谁知道”丢掉；剧情线（`plotline`）
 *   不带，剧情数据由 `--plot` 另写。
 * 换地址的不只是值：初值的依据与讲述里以地址为键的几处、补丁与核对点的地址、主文字里的字段引用都按同一张表（`ADDRESSES`）换。
 * 原型的章 id 是 `ch1`……，活页夹的章 id 是编号，换成 `1`……。
 */

import {mkdir, readdir, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {componentDeclarations, IdMap, loadXingxiaSample, toRequest} from "@notnotype/nb-canon/sample";
import type {FieldDeclaration} from "@notnotype/nb-canon/schema";
import type {PrototypeSample, SampleTypes} from "@notnotype/nb-canon/sample";

import {BINDER_DIR, BINDER_MANIFEST} from "../src/plugins/canon/backend/binder";
import {createWorldHost} from "../src/plugins/canon/backend/world-host";
import {BUILTIN_COMPONENTS, LOOK_COMPONENT, PANEL_COMPONENT, PERSON_COMPONENT} from "../src/plugins/canon/shared/components";
import {PLOT_COMPONENTS, PLOT_DIAGNOSTICS, PLOT_MARKS, PLOT_PLUGIN_ID} from "../src/plugins/plot/shared/declarations";
import {writePlotSample} from "./canon-sample-plot";

export interface CanonSampleResult {
    readonly projectId: string;
    readonly entries: number;
    readonly revisions: number;
}

const chapterId = (prototype: string): string => prototype.replace(/^ch/u, "");

/** 原型的章 id 换成编号：所有 `chapter` 键的值，与读取位置里的章。 */
function renumber(value: unknown, key?: string): unknown {
    if (typeof value === "string") return key === "chapter" ? chapterId(value) : value;
    if (Array.isArray(value)) return value.map((item) => renumber(item));
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([inner, item]) => [inner, renumber(item, inner)]));
}

/** 原型的地址（`<命名空间>.<字段>`）换到内置类型以后的地址；`null` 是不带。没列的不变。 */
const ADDRESSES: Readonly<Record<string, string | null>> = {
    "character.外观": "look.外貌",
    "identity.外观": "look.外貌",
    "identity.谁知道": null,
};
/** 这本书专有、内置人物里没有的字段：在用到它的条目上声明。 */
const OWN_FIELDS = ["身体", "样子", "态度"] as const;

function mapAddress(path: string): string | null {
    const [, head, rest] = /^([^.[\]]+\.[^.[\]]+)(.*)$/u.exec(path) ?? [undefined, path, ""];
    const mapped = ADDRESSES[head!];
    return mapped === undefined ? path : mapped === null ? null : `${mapped}${rest!}`;
}

/** 主文字里的字段引用：前面带不带点（别的条目的、自己的）都认，不碰恰好含这几个字的别的词。 */
const FIELD_IN_SOURCE = new RegExp(`(?<![\\p{L}\\p{N}_])(${Object.keys(ADDRESSES).filter((address) => ADDRESSES[address] !== null).map((address) => address.replace(".", "\\.")).join("|")})(?![\\p{L}\\p{N}_])`, "gu");

/** 一个对象里的地址都按 `ADDRESSES` 换：`{entry, path}`、以地址为键的表（初值的依据与讲述）、主文字源文。 */
function readdress(value: unknown, key?: string): unknown {
    if (typeof value === "string") return key === "source" ? value.replace(FIELD_IN_SOURCE, (whole) => ADDRESSES[whole] ?? whole) : value;
    if (Array.isArray(value)) return value.map((item) => readdress(item));
    if (value === null || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (key === "initBasis" || key === "initTold") {
        return Object.fromEntries(Object.entries(record).flatMap(([address, item]) => {
            const mapped = mapAddress(address);
            return mapped === null ? [] : [[mapped, readdress(item)]];
        }));
    }
    if (typeof record.entry === "string" && typeof record.path === "string") {
        const mapped = mapAddress(record.path);
        if (mapped === null) throw new Error(`样本里有指向不带的字段的地址：${record.path}`);
        return {...(readdress({...record, path: undefined}) as object), path: mapped};
    }
    return Object.fromEntries(Object.entries(record).filter(([, item]) => item !== undefined).map(([inner, item]) => [inner, readdress(item, inner)]));
}

/** 原型里条目的一块数据；`declared` 是换形状时给这个条目加的字段声明。 */
interface PrototypeBlock {
    readonly enabled: boolean;
    readonly fields: Record<string, unknown>;
    readonly declared?: readonly FieldDeclaration[];
}

/**
 * 样本换成内置类型的形状（见文件头）：先定这本书专有的几项各在谁身上（初值里有值，或有补丁指着），再逐个对象换地址、
 * 把条目的人物与身份两块拆成人物与形象。结果仍是原型的写法，交给 `toRequest` 换成写入请求。
 */
function toBuiltin(sample: PrototypeSample): PrototypeSample {
    const declarations = componentDeclarations(sample).find((type) => type.namespace === "character")?.fields ?? [];
    const owners = new Map<string, Set<string>>();
    const use = (entry: string, field: string) => owners.set(entry, (owners.get(entry) ?? new Set()).add(field));
    const scan = (value: unknown): void => {
        if (Array.isArray(value)) return value.forEach(scan);
        if (value === null || typeof value !== "object") return;
        const record = value as Record<string, unknown>;
        if (typeof record.entry === "string" && typeof record.path === "string") {
            const field = OWN_FIELDS.find((name) => record.path === `character.${name}`);
            if (field !== undefined) use(record.entry, field);
        }
        Object.values(record).forEach(scan);
    };
    for (const item of sample.items) {
        for (const put of item.draft.puts) {
            scan(put.after);
            if (put.ref.kind !== "entry" || put.after === null) continue;
            const fields = (put.after as {init: {data: Record<string, PrototypeBlock>}}).init.data.character?.fields ?? {};
            for (const field of OWN_FIELDS) if (fields[field] !== null && fields[field] !== undefined) use(put.ref.id, field);
        }
    }
    const items = sample.items.map((item) => ({
        ...item,
        draft: {
            ...item.draft,
            puts: item.draft.puts.map((put) => {
                if (put.after === null) return put;
                const moved = readdress(put.after) as Record<string, unknown>;
                if (put.ref.kind !== "entry") return {...put, after: moved};
                const init = moved.init as {data: Record<string, PrototypeBlock>};
                const {character, identity, plotline: _plotline, ...rest} = init.data;
                const person = character ?? identity;
                if (person === undefined) return {...put, after: {...moved, init: {...init, data: rest}}};
                const own = [...(owners.get(put.ref.id) ?? [])];
                // 人物与形象排在前面：数据分页按这里的先后排，面板这些跟在后面。
                const data = {
                    character: {
                        enabled: person.enabled,
                        fields: character === undefined ? {} : {性格: character.fields.性格 ?? null, ...Object.fromEntries(own.map((field) => [field, character.fields[field] ?? null]))},
                        declared: declarations.filter((field) => (own as string[]).includes(field.id)),
                    },
                    look: {enabled: person.enabled, fields: {外貌: person.fields.外观 ?? null}},
                    ...rest,
                };
                return {...put, after: {...moved, init: {...init, data}}};
            }),
        },
    }));
    return {...sample, items};
}

/** 换好形状以后各命名空间用哪个内置类型；面板的五个字段是每个条目自己声明的。 */
function builtinTypes(sample: PrototypeSample): SampleTypes {
    const of = (id: string) => BUILTIN_COMPONENTS.find((type) => type.id === id)!;
    const panelFields = componentDeclarations(sample).find((type) => type.namespace === "panel")?.fields ?? [];
    return (ns) => {
        const type = ns === "character" ? of(PERSON_COMPONENT) : ns === "look" ? of(LOOK_COMPONENT) : ns === "panel" ? of(PANEL_COMPONENT) : undefined;
        if (type === undefined) return null;
        return {type: type.id, version: type.version ?? 1, namespace: type.namespace!, ...(ns === "panel" ? {declared: panelFields} : {})};
    };
}

/**
 * 章节文件名里的标题：去掉“第 N 章”前缀。原型的第 3 章没有标题，去掉以后什么也不剩，文件名就是 `00003-.md`：活页夹把空
 * 标题当没有标题（`chapterTitles`），位置选择只写“第 3 章末尾”。
 */
const titleOf = (title: string): string => title.replace(/^第\s*\d+\s*章\s*/u, "");

export interface CanonSampleOptions {
    /** 另带剧情数据（`canon-sample-plot.ts`）。 */
    readonly plot?: boolean;
}

export async function writeCanonSample(target: string, options: CanonSampleOptions = {}): Promise<CanonSampleResult> {
    await mkdir(target, {recursive: true});
    if ((await readdir(target)).length > 0) throw new Error(`目标目录不是空的：${target}`);
    const original = await loadXingxiaSample();
    const renumbered = renumber(toBuiltin(original)) as PrototypeSample;
    const sample: PrototypeSample = {...renumbered, chapters: renumbered.chapters.map((chapter) => ({...chapter, id: chapterId(chapter.id)}))};
    const types = builtinTypes(original);

    const projectId = crypto.randomUUID();
    await mkdir(join(target, ".nbook"), {recursive: true});
    await writeFile(join(target, ".nbook", "project.json"), `${JSON.stringify({schema: 1, id: projectId, title: "星瑕"})}\n`);
    const binder = join(target, BINDER_DIR);
    await mkdir(binder, {recursive: true});
    const fileOf = (chapter: {readonly id: string; readonly title: string}): string => join(binder, `${chapter.id.padStart(5, "0")}-${titleOf(chapter.title)}.md`);
    for (const chapter of sample.chapters) await writeFile(fileOf(chapter), chapter.text);
    const nextId = Math.max(...sample.chapters.map((chapter) => Number(chapter.id))) + 1;
    await writeFile(join(binder, BINDER_MANIFEST), `<binder nextId="${String(nextId)}">${sample.chapters.map((chapter) => `<chapter id="${chapter.id}"/>`).join("")}</binder>\n`);

    const problems: string[] = [];
    const host = createWorldHost(target, (input) => {
        if (input.level === "error") problems.push(`${input.event}: ${input.message}`);
    });
    try {
        // 剧情的声明与项目实例里剧情插件经 canon 贡献点登记的一样（类型、标注种类与诊断）。
        host.setComponents(options.plot === true ? [...BUILTIN_COMPONENTS, ...PLOT_COMPONENTS] : BUILTIN_COMPONENTS);
        if (options.plot === true) {
            host.setMarks(PLOT_MARKS.map((declaration) => ({plugin: PLOT_PLUGIN_ID, declaration})));
            host.setDiagnostics(PLOT_DIAGNOSTICS.map((declaration) => ({plugin: PLOT_PLUGIN_ID, declaration})));
        }
        const service = await host.ready();
        if ("code" in service) throw new Error(`世界没有打开：${service.code}`);
        const ids = new IdMap();
        const written = new Map<string, string>();
        for (const [index, item] of sample.items.entries()) {
            for (const [chapter, file] of Object.entries(item.files ?? {})) {
                if (file.text === undefined) continue;
                const found = sample.chapters.find((candidate) => candidate.id === chapterId(chapter));
                if (found === undefined) throw new Error(`样本第 ${String(index + 1)} 项写到没有的章 ${chapter}`);
                await writeFile(fileOf(found), file.text);
                // 宿主改了正文要通知世界服务（canon.project 输出 25）；项目实例里由活页夹监视做，这里直接通知。
                service.textChanged(found.id);
            }
            const draft = item.draft as Parameters<typeof toRequest>[0];
            const requestId = `xingxia-${String(index + 1)}`;
            const result = draft.reverts !== undefined
                ? await service.revert(ids.revision(draft.reverts), false, {requestId, by: draft.by, title: draft.title})
                : await service.publish(toRequest(draft, index, ids, sample, service.status().version, written, types));
            if (!result.ok) throw new Error(`样本第 ${String(index + 1)} 项“${item.label}”发布失败：${JSON.stringify(result.failure)}`);
            ids.learn(result.ids, result.revision.id);
        }
        if (options.plot === true) await writePlotSample(service, nameIndex(service), changeIndex(service));
        await service.idle();
        if (problems.length > 0) throw new Error(`世界报了错：\n${problems.join("\n")}`);
        const status = service.status();
        // 数条目：沿条目树一层一层走（只是给调用方核对的数，样本只有几十个条目）。
        const count = (parent: string | null): number => {
            let total = 0;
            for (let cursor: string | undefined, first = true; first || cursor !== undefined; first = false) {
                const page = service.tree(parent, cursor, 500);
                if (page === "cursor-stale") throw new Error("条目树的游标过期");
                for (const item of page.items) total += 1 + (item.hasChildren ? count(item.id) : 0);
                cursor = page.cursor;
            }
            return total;
        };
        return {projectId, entries: count(null), revisions: status.version};
    } finally {
        await host.stop();
    }
}

type Service = Exclude<Awaited<ReturnType<ReturnType<typeof createWorldHost>["ready"]>>, {readonly code: string}>;

/** 条目的名字到 id（沿条目树走一遍；设定样本的名字唯一）。 */
function nameIndex(service: Service): (name: string) => string {
    const ids = new Map<string, string>();
    const walk = (parent: string | null): void => {
        const page = service.tree(parent, undefined, 500);
        if (page === "cursor-stale") throw new Error("条目树的游标过期");
        for (const item of page.items) {
            ids.set(item.name, item.id);
            if (item.hasChildren) walk(item.id);
        }
    };
    walk(null);
    return (name) => {
        const id = ids.get(name);
        if (id === undefined) throw new Error(`样本里没有条目“${name}”`);
        return id;
    };
}

/** 剧情变更的文字到 id（设定样本里每条的文字不同）。 */
function changeIndex(service: Service): (text: string) => string {
    const ids = new Map<string, string>();
    for (let cursor: string | undefined, first = true; first || cursor !== undefined; first = false) {
        const page = service.changes({}, cursor, 200);
        if (typeof page === "string") throw new Error(`剧情变更读不出来：${page}`);
        for (const item of page.items) ids.set(item.change.text, item.change.id);
        cursor = page.cursor;
    }
    return (text) => {
        const id = ids.get(text);
        if (id === undefined) throw new Error(`样本里没有剧情变更“${text}”`);
        return id;
    };
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    const plot = args.includes("--plot");
    const rest = args.filter((arg) => arg !== "--plot");
    if (rest.length !== 1 || rest[0]!.startsWith("--")) {
        console.error("用法：bun scripts/canon-sample.ts [--plot] <目标目录>");
        process.exit(2);
    }
    console.log(JSON.stringify(await writeCanonSample(rest[0]!, {plot})));
}
