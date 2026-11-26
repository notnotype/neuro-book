/**
 * 换写法的对照（w00055 t02 计划的 S0 与 S5）：星瑕样本在每个读取位置、实际与按计划两种模式上，三种渲染的结果拍成快照，
 * 存进 `fixtures/legacy-render.json`。快照只记与写法无关的东西：纯文字的文字与三样、给作者的显示文字序列、给 Agent 的值
 * 序列（按表达式出现的顺序，地址或式子加 JSON）。主文字换成标签写法以后，同一份快照拿来逐块对照新实现：迁移不该改变
 * 读了谁、提到谁、哪里写不干净，也不该改变每一处的值。
 *
 * 重拍快照：`NB_CANON_UPDATE_LEGACY=1 bun test tests/legacy-render.test.ts`（只在旧实现上拍，S0 一次）。
 */

import {readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";

import {afterAll, beforeAll, expect, test} from "bun:test";
import {createTestTmpRoot, removeMarkedTmpRoot, TMP_MARKER_FILE} from "@notnotype/neuro-book-test-support/tmp";

import type {ReadPosition} from "../src/index";
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

function authorTexts(tree: unknown): string[] {
    const out: string[] = [];
    const walk = (node: unknown): void => {
        if (node === null || typeof node !== "object") return;
        const record = node as {type?: string; display?: string; reason?: string; name?: string; caption?: string; children?: unknown[]};
        switch (record.type) {
            case "canonValue":
            case "canonComputed":
                out.push(record.display ?? "");
                return;
            case "canonPlaceholder":
                out.push(`占位:${record.reason ?? ""}`);
                return;
            case "canonRef":
                out.push(`引用:${record.name ?? ""}`);
                return;
            case "canonImage":
                out.push(`图片:${record.caption ?? ""}`);
                return;
            default:
                for (const child of record.children ?? []) walk(child);
        }
    };
    walk(tree);
    return out;
}

/** 旧的带值写法里每个注记 `= JSON` 或 `-> JSON` 的值（不含装饰）。只给快照用：值不含 `}`、` # ` 时按最后一个分隔切。 */
function agentValues(text: string): string[] {
    return [...text.matchAll(/\{[^{}]*?(?: = | -> )([^{}]*?)(?: # [^{}]*)?\}/gu)].map((match) => match[1]!);
}

export function snapshotOf(replayed: Replayed, entries: ReadonlyMap<string, string>, positions: readonly ReadPosition[], blockAgent: (text: string) => readonly string[] = agentValues, blockAuthor: (block: unknown) => readonly string[] = (block) => authorTexts((block as {tree?: unknown}).tree)): Record<string, BlockSnapshot> {
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
                        author: blockAuthor(author.blocks[index]),
                        agent: blockAgent(agent.blocks[index]!.text),
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

test("旧写法的三种渲染与快照逐块相同（迁移对照的基线）", () => {
    const current = snapshotOf(replayed, entries, positions);
    if (process.env.NB_CANON_UPDATE_LEGACY === "1") writeFileSync(SNAPSHOT, `${JSON.stringify(current, null, 1)}\n`);
    const saved = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as LegacySnapshot;
    expect(Object.keys(current).length).toBeGreaterThan(0);
    expect(current).toEqual(saved);
});
