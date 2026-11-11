/**
 * 生成星瑕样本项目（w00039 t31，docs/specs/canon/author-ui.md 验收 1 到 14 用的那部作品）：一个能直接打开的作品目录，带活页夹
 * 三章的正文与世界日志。数据来自 nb-canon 的样本（`@notnotype/nb-canon/sample`，t16 原型导出的十一次写入），经应用自己的
 * 世界宿主（`createWorldHost`，与项目实例里打开世界的是同一段代码）逐次发布，日志、锁与缓存的位置因此与产品一致。
 *
 *   bun scripts/canon-sample.ts <目标目录>
 *
 * 目标目录必须不存在或为空。标准输出是机器可读的结果（JSON）：作品 id、条目数、修订数。
 *
 * 原型自己定了四种数据，应用里只有内置的人物与面板（开发者 2026-11-11 在 t16 评审板第 13 版定 `map-builtin`）：
 * - 人物（`character`）用内置人物，内置人物为此补了“身体”“现在的样子”“性格”三个文字字段；
 * - 面板（`panel`）用内置面板，原型的五个字段成为每个条目自己声明的字段；
 * - 身份（`identity`）不带：马甲条目的“外观”并进内置人物的“外观”，主文字里 `.identity.外观` 跟着改成 `.character.外观`，
 *   “谁知道”丢掉；剧情线（`plotline`）不带（剧情侧是第二批）。
 * 原型的章 id 是 `ch1`……，活页夹的章 id 是编号，换成 `1`……。
 */

import {mkdir, readdir, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {componentDeclarations, IdMap, loadXingxiaSample, toRequest} from "@notnotype/nb-canon/sample";
import type {PrototypeSample, SampleTypes} from "@notnotype/nb-canon/sample";

import {BINDER_DIR, BINDER_MANIFEST} from "../src/plugins/canon/backend/binder";
import {createWorldHost} from "../src/plugins/canon/backend/world-host";
import {BUILTIN_COMPONENTS} from "../src/plugins/canon/shared/components";

export interface CanonSampleResult {
    readonly projectId: string;
    readonly entries: number;
    readonly revisions: number;
}

const chapterId = (prototype: string): string => prototype.replace(/^ch/u, "");

/** 原型的章 id 换成编号：所有 `chapter` 键的值，与读取位置里的章。 */
function renumber(value: unknown, key?: string): unknown {
    if (typeof value === "string") {
        if (key === "chapter") return chapterId(value);
        if (key === "source") return value.replaceAll(".identity.外观", ".character.外观");
        return value;
    }
    if (Array.isArray(value)) return value.map((item) => renumber(item));
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([inner, item]) => [inner, renumber(item, inner)]));
}

/** 样本的类型换成应用内置的（见文件头）。 */
function builtinTypes(sample: PrototypeSample): SampleTypes {
    const person = BUILTIN_COMPONENTS.find((type) => type.id === "nbook.canon.person")!;
    const panel = BUILTIN_COMPONENTS.find((type) => type.id === "nbook.canon.panel")!;
    const panelFields = componentDeclarations(sample).find((type) => type.namespace === "panel")?.fields ?? [];
    return (ns) => {
        if (ns === "character" || ns === "identity") return {type: person.id, version: person.version ?? 1, namespace: person.namespace!};
        if (ns === "panel") return {type: panel.id, version: panel.version ?? 1, namespace: panel.namespace!, declared: panelFields};
        return null;
    };
}

/** 身份块里只带“外观”（并进人物）；别的命名空间原样。在换类型之前做，换类型时同命名空间的字段合起来。 */
function withoutIdentityExtras(sample: PrototypeSample): PrototypeSample {
    const items = sample.items.map((item) => ({
        ...item,
        draft: {
            ...item.draft,
            puts: item.draft.puts.map((put) => {
                if (put.ref.kind !== "entry" || put.after === null) return put;
                const after = put.after as {init: {data: Record<string, {enabled: boolean; fields: Record<string, unknown>}>}};
                const identity = after.init.data.identity;
                if (identity === undefined) return put;
                return {...put, after: {...after, init: {...after.init, data: {...after.init.data, identity: {...identity, fields: {外观: identity.fields.外观 ?? null}}}}}};
            }),
        },
    }));
    return {...sample, items};
}

/** 章节文件名里的标题：去掉“第 N 章”前缀；去掉以后什么也不剩时用原来的。 */
const titleOf = (title: string): string => title.replace(/^第\s*\d+\s*章\s*/u, "") || title;

export async function writeCanonSample(target: string): Promise<CanonSampleResult> {
    await mkdir(target, {recursive: true});
    if ((await readdir(target)).length > 0) throw new Error(`目标目录不是空的：${target}`);
    const original = await loadXingxiaSample();
    const renumbered = renumber(withoutIdentityExtras(original)) as PrototypeSample;
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
        host.setComponents(BUILTIN_COMPONENTS);
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

if (import.meta.main) {
    const target = process.argv[2];
    if (target === undefined) {
        console.error("用法：bun scripts/canon-sample.ts <目标目录>");
        process.exit(2);
    }
    console.log(JSON.stringify(await writeCanonSample(target)));
}
