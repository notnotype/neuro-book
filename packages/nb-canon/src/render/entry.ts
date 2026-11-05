/**
 * 按条目渲染（docs/specs/canon/rendering.md 输出 7、8）与整篇文字的切块（输出 3）。
 */

import {fromMarkdown} from "mdast-util-from-markdown";
import {mdxFromMarkdown} from "mdast-util-mdx";
import {mdxjs} from "micromark-extension-mdxjs";

import {LOCAL_ID_PREFIX} from "../core/ids";
import type {Block, ReadPosition} from "../core/schema";
import type {Engine, Mode} from "../engine/types";
import type {World} from "../world/world";
import {renderBlockForAgent, renderBlockForAuthor, resolverFor, type AgentBlock, type AuthorBlock, type RenderContext} from "./render";

/** 渲染结果带着读取它的版本、位置与模式：回写时照带（rendering.md 输出 12）。 */
export type EntryRender<T> = {readonly version: number; readonly position: ReadPosition; readonly mode: Mode; readonly blocks: readonly T[]} | "chapter-not-found" | "line-not-found" | null;

/** 渲染的选项：`hideUpcoming` 给带视图令牌的渲染用，不提“之后才启用”。 */
export interface RenderOptions {
    readonly hideUpcoming?: boolean;
}

/** 渲染按读取位置的线算（worldlines 输出 1、12）；那条线读不到时调用方得 `line-not-found`。 */
function context(engine: Engine, world: World, entry: string, position: ReadPosition, mode: Mode, options: RenderOptions): RenderContext {
    const resolve = resolverFor(engine, world.options.registry, world.options.order, entry, position, mode, options.hideUpcoming === true);
    return {
        resolve,
        entryName: (id) => {
            const view = engine.entry(id, position, mode);
            return view === null || view === "chapter-not-found" || view.deleted ? null : view.name;
        },
    };
}

export function renderEntryForAuthor(world: World, entry: string, position: ReadPosition, mode: Mode, options: RenderOptions = {}): EntryRender<AuthorBlock> {
    const engine = world.lineAt(position, mode)?.engine;
    if (engine === undefined) return "line-not-found";
    const view = engine.entry(entry, position, mode);
    if (view === "chapter-not-found" || view === null) return view;
    const shared = context(engine, world, entry, position, mode, options);
    return {version: world.version, position, mode, blocks: view.text.map((block) => renderBlockForAuthor(block.id, block.source, shared))};
}

export function renderEntryForAgent(world: World, entry: string, position: ReadPosition, mode: Mode, options: RenderOptions = {}): EntryRender<AgentBlock> {
    const engine = world.lineAt(position, mode)?.engine;
    if (engine === undefined) return "line-not-found";
    const view = engine.entry(entry, position, mode);
    if (view === "chapter-not-found" || view === null) return view;
    const shared = context(engine, world, entry, position, mode, options);
    return {version: world.version, position, mode, blocks: view.text.map((block) => renderBlockForAgent(block.id, block.source, shared))};
}

/**
 * 一段文字整体写入（新建条目、整篇替换）时按顶层的语法节点切成块，每块一个新 id（`b` 加号，不与 `taken` 里的重复）。
 * 解析不了时整段作为一块，交给写入时的检查报错。
 */
export function splitBlocks(source: string, taken: Iterable<string> = []): Block[] {
    let max = 0;
    for (const id of taken) {
        const match = /^b(\d+)$/u.exec(id);
        if (match !== null) max = Math.max(max, Number(match[1]));
    }
    const next = () => `${LOCAL_ID_PREFIX.block}${String(++max)}`;
    let tree;
    try {
        tree = fromMarkdown(source, {extensions: [mdxjs()], mdastExtensions: [mdxFromMarkdown()]});
    } catch {
        return [{id: next(), source}];
    }
    const blocks: Block[] = [];
    for (const node of tree.children) {
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        if (start === undefined || end === undefined) continue;
        blocks.push({id: next(), source: source.slice(start, end)});
    }
    return blocks.length === 0 ? [{id: next(), source}] : blocks;
}
