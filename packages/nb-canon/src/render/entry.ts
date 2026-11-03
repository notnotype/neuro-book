/**
 * 按条目渲染（docs/specs/canon/rendering.md 输出 7、8）与整篇文字的切块（输出 3）。
 */

import {fromMarkdown} from "mdast-util-from-markdown";
import {mdxFromMarkdown} from "mdast-util-mdx";
import {mdxjs} from "micromark-extension-mdxjs";

import {LOCAL_ID_PREFIX} from "../core/ids";
import type {Block, ReadPosition} from "../core/schema";
import type {Mode} from "../engine/types";
import type {World} from "../world/world";
import {renderBlockForAgent, renderBlockForAuthor, resolverFor, type AgentBlock, type AuthorBlock, type RenderContext} from "./render";

/** 渲染结果带着读取它的版本、位置与模式：回写时照带（rendering.md 输出 12）。 */
export type EntryRender<T> = {readonly version: number; readonly position: ReadPosition; readonly mode: Mode; readonly blocks: readonly T[]} | "chapter-not-found" | null;

function context(world: World, entry: string, position: ReadPosition, mode: Mode): RenderContext {
    const resolve = resolverFor(world.engine, world.options.registry, world.options.order, entry, position, mode);
    return {
        resolve,
        entryName: (id) => {
            const view = world.engine.entry(id, position, mode);
            return view === null || view === "chapter-not-found" || view.deleted ? null : view.name;
        },
    };
}

export function renderEntryForAuthor(world: World, entry: string, position: ReadPosition, mode: Mode): EntryRender<AuthorBlock> {
    const view = world.engine.entry(entry, position, mode);
    if (view === "chapter-not-found" || view === null) return view;
    const shared = context(world, entry, position, mode);
    return {version: world.version, position, mode, blocks: view.text.map((block) => renderBlockForAuthor(block.id, block.source, shared))};
}

export function renderEntryForAgent(world: World, entry: string, position: ReadPosition, mode: Mode): EntryRender<AgentBlock> {
    const view = world.engine.entry(entry, position, mode);
    if (view === "chapter-not-found" || view === null) return view;
    const shared = context(world, entry, position, mode);
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
