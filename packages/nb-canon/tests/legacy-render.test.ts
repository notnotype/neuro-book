/**
 * 换写法的对照（w00055 t02 计划的 S0 与 S5）：星瑕样本在每个读取位置、实际与按计划两种模式上，三种渲染的结果拍成快照，
 * 存进 `fixtures/legacy-render.json`。快照只记与写法无关的东西：纯文字的文字与三样、给作者的显示文字序列、给 Agent 的值
 * 序列（按表达式出现的顺序，地址或式子加 JSON）。主文字换成标签写法以后（S5），同一份快照拿来逐块对照新实现：迁移不该改变
 * 读了谁、提到谁、哪里写不干净，也不该改变每一处的值。
 *
 * 快照是旧实现在分支起点上拍的（451d94623），不再重拍：用新实现重拍，对照就成了自己比自己。旧的三元式换成了 `If`：给作者的显示文字
 * 取生效那一支的原文，给 Agent 的值取它的 JSON（旧的三元式算出的就是那段文字）。
 */

import {readFileSync} from "node:fs";
import {join} from "node:path";

import {afterAll, beforeAll, expect, test} from "bun:test";
import {createTestTmpRoot, removeMarkedTmpRoot, TMP_MARKER_FILE} from "@notnotype/neuro-book-test-support/tmp";

import type {ReadPosition} from "../src/index";
import {lexTags, parseEntryText, stripEntryText} from "../src/grammar/index";
import type {World} from "../src/world/world";
import {renderEntryForAgent, renderEntryForAuthor, renderEntryPlain} from "../src/render/entry";
import type {Mode} from "../src/engine/types";
import {loadXingxiaSample} from "../src/sample/index";
import {replay, type Replayed} from "./sample/replay";

/** 一块在一个位置、一种模式上的三种渲染，只留与写法无关的部分。 */
export interface BlockSnapshot {
    readonly plain: {readonly text: string; readonly reads: readonly string[]; readonly mentions: readonly string[]; readonly problems: readonly string[]};
    /** 给作者的结果里，值、算出的结果、占位、引用、图片各自的显示文字，按出现的顺序。 */
    readonly author: readonly string[];
    /** 给 Agent 的结果里每一处的值（JSON），按出现的顺序。 */
    readonly agent: readonly string[];
}

/** 键：`位置|模式|样本条目 id|块序号`。 */
export type LegacySnapshot = Readonly<Record<string, BlockSnapshot>>;

const SNAPSHOT = join(import.meta.dir, "fixtures", "legacy-render.json");
const MODES: readonly Mode[] = ["actual", "planned"];

const where = (position: ReadPosition): string => (position.kind === "initial" ? "初值" : `${position.chapter}:${position.edge}`);

type AuthorItem = {readonly tag: string; readonly start: number; readonly display?: string; readonly unavailable?: string; readonly raw?: unknown; readonly ref?: {readonly name: string}; readonly image?: {readonly caption: string}; readonly name?: string; readonly caption?: string; readonly taken?: number | null};

/** 生效那一支的原文：从这个条件的开标签起，按它的分支标签切开。没有生效的支时是未知。 */
function takenBranch(source: string, item: AuthorItem): string | null {
    if (item.taken === null || item.taken === undefined) return null;
    const tags = lexTags(source).filter((tag) => tag.start >= item.start);
    const close = tags.find((tag) => tag.name === "If" && tag.kind === "close");
    const heads = tags.filter((tag) => (tag.name === "If" && tag.kind === "open") || ((tag.name === "ElseIf" || tag.name === "Else") && tag.kind === "self")).filter((tag) => close === undefined || tag.start < close.start);
    const head = heads[item.taken];
    if (head === undefined || close === undefined) return null;
    return source.slice(head.end, heads[item.taken + 1]?.start ?? close.start);
}

/** 新实现给作者的值表 → 旧快照的显示文字序列。 */
function authorTexts(block: unknown): string[] {
    const record = block as {source?: string; values?: readonly AuthorItem[]};
    if (record.values === undefined || record.source === undefined) return [];
    const out: string[] = [];
    for (const item of record.values) {
        if (item.tag === "V") {
            if (item.unavailable !== undefined && (item.raw ?? null) === null) out.push(`占位:${item.unavailable}`);
            else if (item.ref !== undefined) out.push(`引用:${item.ref.name}`);
            else if (item.image !== undefined) out.push(`图片:${item.image.caption}`);
            else out.push(item.display ?? "");
        } else if (item.tag === "If") out.push(takenBranch(record.source, item) ?? "未知");
        else if (item.tag === "Ref") out.push(`引用:${item.name ?? ""}`);
        else if (item.tag === "Image") out.push(`图片:${item.caption ?? ""}`);
    }
    return out;
}

/**
 * Agent 文字里每个条件按各个判断的 `value` 生效的那一支（按条件出现的顺序）：第一个 `true` 的支，先遇到 `null` 就没有，都是 `false`
 * 时是 `Else`。样本里没有套着的条件，也没有字面的条件标签。
 */
function agentTaken(text: string): Array<number | null> {
    const taken: Array<number | null> = [];
    let heads: Array<string | null> | null = null;
    for (const tag of parseEntryText(text).tags) {
        if (tag.place !== "live" || (tag.name !== "If" && tag.name !== "ElseIf" && tag.name !== "Else")) continue;
        const value = tag.attributes.find((attribute) => attribute.name === "value")?.value ?? null;
        if (tag.name === "If" && tag.kind === "open") heads = [value];
        else if (tag.name === "If" && tag.kind === "close" && heads !== null) {
            const decided = heads.findIndex((head) => head !== "false");
            taken.push(decided < 0 || heads[decided] === "null" ? null : decided);
            heads = null;
        } else if (heads !== null) heads.push(tag.name === "Else" ? "else" : value);
    }
    return taken;
}

/** 新实现给 Agent 的值：带值的 `V` 中间的 JSON 按出现的顺序；条件取 Agent 文字里生效那一支的原文的 JSON。 */
function agentValues(text: string, author: unknown): string[] {
    const values = [...text.matchAll(/<V [^>]*>([^<]*)<\/V>/gu)].map((matched) => matched[1] as string);
    const taken = agentTaken(text);
    const record = author as {source?: string; values?: readonly AuthorItem[]};
    const out: string[] = [];
    for (const item of record.values ?? []) {
        if (item.tag === "V") out.push(values.shift() ?? "");
        else if (item.tag === "If") out.push(JSON.stringify(takenBranch(record.source ?? "", {...item, taken: taken.shift() ?? null})));
    }
    return out;
}

export function snapshotOf(replayed: Replayed, entries: ReadonlyMap<string, string>, positions: readonly ReadPosition[]): Record<string, BlockSnapshot> {
    // 服务交出的是只读的世界（类型只挑了几个成员），实际对象就是 World；旧的渲染入口要整个 World，快照只读不写。
    const world = replayed.service.world as World;
    const out: Record<string, BlockSnapshot> = {};
    for (const position of positions) {
        for (const mode of MODES) {
            for (const [protoId, id] of entries) {
                const plain = renderEntryPlain(world, id, position, mode);
                const author = renderEntryForAuthor(world, id, position, mode);
                const agent = renderEntryForAgent(world, id, position, mode);
                if (plain === null || typeof plain === "string" || author === null || typeof author === "string" || agent === null || typeof agent === "string") continue;
                plain.blocks.forEach((block, index) => {
                    out[`${where(position)}|${mode}|${protoId}|${String(index)}`] = {
                        plain: {text: block.text, reads: [...block.reads].sort(), mentions: [...block.mentions].sort(), problems: [...block.problems].sort()},
                        author: authorTexts(author.blocks[index]),
                        agent: agentValues(agent.blocks[index]!.text, author.blocks[index]),
                    };
                });
            }
        }
    }
    return out;
}

let root = "";
let replayed: Replayed;
let entries: Map<string, string>;
let positions: ReadPosition[];

beforeAll(async () => {
    root = await createTestTmpRoot("nb-canon-legacy-render");
    const sample = await loadXingxiaSample();
    replayed = await replay(root, sample);
    const protoIds = new Set(sample.results.flatMap((result) => Object.keys(result.entries)));
    entries = new Map([...protoIds].sort().map((protoId) => [protoId, replayed.ids.get(protoId)]));
    positions = sample.results.map((result) => result.position as ReadPosition);
});

afterAll(async () => {
    await replayed.service.stop();
    await removeMarkedTmpRoot(root, join(root, TMP_MARKER_FILE));
});

test("换成标签写法以后，三种渲染与旧实现的快照逐块相同（读了谁、提到谁、哪里写不干净、每一处的值）", () => {
    const current = snapshotOf(replayed, entries, positions);
    const saved = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as LegacySnapshot;
    expect(Object.keys(current).length).toBeGreaterThan(0);
    expect(current).toEqual(saved);
});

test("canon.rendering 输出 22：样本每一块在每个位置、两种模式上，带值写法去值以后与源文逐字相同", () => {
    const world = replayed.service.world as World;
    let blocks = 0;
    for (const position of positions) {
        for (const mode of MODES) {
            for (const id of entries.values()) {
                const agent = renderEntryForAgent(world, id, position, mode);
                if (agent === null || typeof agent === "string") continue;
                const stored = world.line().engine.entry(id, position, mode);
                if (stored === null || stored === "chapter-not-found") continue;
                agent.blocks.forEach((block, index) => {
                    blocks += 1;
                    expect({id, block: block.id, text: stripEntryText(block.text)}).toEqual({id, block: block.id, text: stored.text[index]!.source});
                });
            }
        }
    }
    // 与快照同一批块：样本的 6 块，按 7 个位置、两种模式各一次。
    expect(blocks).toBe(Object.keys(snapshotOf(replayed, entries, positions)).length);
});
