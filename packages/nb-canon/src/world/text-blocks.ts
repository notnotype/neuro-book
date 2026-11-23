/**
 * 主文字的块在一个读取位置上能怎么改（docs/specs/canon/project.md 的 `textBlocks`，revisions.md 输出 25 的“主文字的块”）。
 *
 * 作者按块编辑主文字时，界面要先知道三件事：改这一块的字会写到哪（初值，还是给出它的那条剧情变更），这一块能不能从初值里
 * 删掉，新块放在它后面该挂在初值的哪一块后面。这三件事的判断与一次改几处（`entry-edits.ts`）拒收时用的是同一份：这里的
 * `textTouches` 就是改设定删块的拒收条件，`writeBack` 就是 `set` 的路由。界面与内核各算各的会放出必败的按钮。
 *
 * 只按实际模式读：计划还没发生，不能在它上面改设定。
 */

import type {Address, Patch, ReadPosition} from "../core/schema";
import type {OriginStep} from "../engine/types";
import type {World} from "./world";

/**
 * 改设定时一个地址的值写回哪里（revisions.md 输出 8 的路由表），按它在这个位置上来历的最后一步：
 *
 * - `init`：值来自初值；
 * - `change`：值是这条变更给的（赋值、整块替换、增块），改的是它的补丁；
 * - `carried`：值是从别的线带过来的，不是这条线上哪条记录写的；
 * - `accumulated`：值是加减、事件或核对点累出来的，没有一处可以直接改。
 */
export type WriteBack =
    | {readonly kind: "init"}
    | {readonly kind: "change"; readonly change: string; readonly origins: readonly OriginStep[]}
    | {readonly kind: "carried"}
    | {readonly kind: "accumulated"; readonly origins: readonly OriginStep[]}
    | {readonly kind: "chapter-not-found"}
    | {readonly kind: "line-not-found"};

export function writeBack(world: World, position: ReadPosition, at: Address): WriteBack {
    const view = world.lineAt(position);
    if (view === undefined) return {kind: "line-not-found"};
    const origins = view.engine.origins(at, position, "actual");
    if (origins === "chapter-not-found") return {kind: "chapter-not-found"};
    // 精确档的核对点不改值，只有把值定下来的那种（anchor）算一步。
    const last = origins.filter((step) => step.kind !== "check" || step.result === "anchor").at(-1)!;
    if (last.kind === "init") return {kind: "init"};
    if (last.kind === "patch") {
        if (view.synthetic.has(last.change)) return {kind: "carried"};
        if (last.op !== "add" && last.op !== "note") return {kind: "change", change: last.change, origins};
    }
    return {kind: "accumulated", origins};
}

/** 一条变更的补丁碰到的主文字的块。 */
interface TextTouches {
    /** 块 id 到碰过它的变更 id：补丁的地址是它，或增块的补丁以它为锚点。 */
    readonly touched: ReadonlyMap<string, readonly string[]>;
    /** 变更加出来的块 id 到它的锚点（`null` 是放在最前）。 */
    readonly anchors: ReadonlyMap<string, string | null>;
}

/**
 * 这条线上没撤销的变更碰过这个条目的哪些块。按全部变更算、不看先后，也不看实际还是计划、生效还是待定：后面的变更改过一块，
 * 或把新块挂在它后面，从初值里去掉它，那些变更就套不上（连带同一条变更里别的补丁）。
 */
export function textTouches(world: World, position: ReadPosition, entry: string): TextTouches {
    const touched = new Map<string, string[]>();
    const anchors = new Map<string, string | null>();
    const view = world.lineAt(position);
    if (view === undefined) return {touched, anchors};
    const touch = (block: string, change: string): void => {
        const list = touched.get(block);
        if (list === undefined) touched.set(block, [change]);
        else if (!list.includes(change)) list.push(change);
    };
    for (const change of view.records.changes.values()) {
        if (change.status === "undone") continue;
        for (const patch of change.patches) {
            if (patch.at.entry !== entry) continue;
            const block = blockOf(patch);
            if (block === null) continue;
            touch(block, change.id);
            if (patch.op !== "addBlock") continue;
            const after = (patch.value as {after?: unknown} | null)?.after;
            anchors.set(block, typeof after === "string" ? after : null);
            if (typeof after === "string") touch(after, change.id);
        }
    }
    return {touched, anchors};
}

function blockOf(patch: Patch): string | null {
    return /^text\[(.+)\]$/u.exec(patch.at.path)?.[1] ?? null;
}

/** 一块在读取位置上的样子与能怎么改。 */
export interface TextBlockInfo {
    readonly id: string;
    readonly source: string;
    /** 改设定时改这一块的字写到哪：初值、给出它的那条变更（`change` 是哪条），或不能这样改（从别的线带过来的）。 */
    readonly write: "init" | "change" | "none";
    readonly change?: string;
    /** 碰过它的变更（`textTouches`）；非空时改设定不能把它从初值里删掉。 */
    readonly fixed: readonly string[];
    /**
     * 改设定时把新块放在这一块后面，`addBlock` 该写的 `after`：初值里的块是它自己；变更加出来的块是沿锚点追到的那个初值的块，
     * 追到最前是 `null`。追不到（它是从别的线带过来的）时没有这一项，它后面放不了。
     */
    readonly anchor?: string | null;
    /** 在初值的主文字里是第几块（从 0 起）；不在初值里时没有。 */
    readonly init?: number;
}

export interface TextBlocksRead {
    /** 解析后的读取位置，写明线：之后的写入照它给，不再按“那一章讲的线”重新解析。 */
    readonly at: ReadPosition;
    readonly blocks: readonly TextBlockInfo[];
}

/** 条目不存在或已删除为 null。 */
export function textBlocks(world: World, entry: string, position: ReadPosition): TextBlocksRead | null | "chapter-not-found" | "line-not-found" {
    const at: ReadPosition = {...position, line: world.positionLine(position)};
    const line = world.lineAt(at);
    if (line === undefined) return "line-not-found";
    const view = line.engine.entry(entry, at, "actual");
    if (view === "chapter-not-found") return view;
    if (view === null || view.deleted) return null;
    const initIndex = new Map((world.data.entries.get(entry)?.init.text ?? []).map((block, index) => [block.id, index] as const));
    const {touched, anchors} = textTouches(world, at, entry);
    /** 沿锚点追到初值里的块；中途断了（那一块不是这条线上的变更加的）为 undefined。 */
    const anchorOf = (block: string): string | null | undefined => {
        const seen = new Set<string>();
        let current: string | null = block;
        while (current !== null && !initIndex.has(current)) {
            if (seen.has(current) || !anchors.has(current)) return undefined;
            seen.add(current);
            current = anchors.get(current)!;
        }
        return current;
    };
    const blocks = view.text.map((block): TextBlockInfo => {
        const init = initIndex.get(block.id);
        const fixed = touched.get(block.id) ?? [];
        // 这条线上没有带过来的值、初值里的块又没被碰过：它的来历只有初值一步，不必为每一块重放一遍条目的事件。
        const back: WriteBack = init !== undefined && fixed.length === 0 && line.synthetic.size === 0 ? {kind: "init"} : writeBack(world, at, {entry, path: `text[${block.id}]`});
        const anchor = anchorOf(block.id);
        return {
            id: block.id,
            source: block.source,
            write: back.kind === "init" || back.kind === "change" ? back.kind : "none",
            ...(back.kind === "change" ? {change: back.change} : {}),
            fixed,
            ...(anchor === undefined ? {} : {anchor}),
            ...(init === undefined ? {} : {init}),
        };
    });
    return {at, blocks};
}
