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
import {parseDraft} from "./syntax";
import {renderBlockForAgent, renderBlockForAuthor, resolverFor, type AgentBlock, type AuthorBlock, type RenderContext, renderBlockPlain, type PlainBlock, type PlainContext} from "./render";

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

/** 按给的源文字渲染时那一块的 id（rendering.md 输出 16）：不是存下来的块，不与 `b` 加号的块 id 重复。 */
export const SOURCE_BLOCK_ID = "source";

/** 带着起始行留下来的节点种类：块一级的，预览按它把光标所在的行对到段落上。 */
const LINED = new Set(["paragraph", "heading", "list", "listItem", "blockquote", "code", "thematicBreak", "table"]);

/**
 * 语法树里的位置只留块一级节点的起始行，别的都去掉。mdast 给每个节点带起止的行、列、偏移，整棵树因此是源文字的十几到四十
 * 倍（量过：每个字符 4 到 41 字节），短段落的文字三万字符就超过一次读取的预算；只留起始行以后是 3 到 16 字节。用显式的栈
 * 走，不递归：这里的源文字没过写入检查，嵌套可以很深。
 */
function slimPositions(tree: object): void {
    const pending: Array<Record<string, unknown>> = [tree as Record<string, unknown>];
    for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
        const line = (node.position as {start?: {line?: number}} | undefined)?.start?.line;
        if (line !== undefined && LINED.has(node.type as string)) node.position = {start: {line}};
        else delete node.position;
        if (Array.isArray(node.children)) pending.push(...(node.children as Array<Record<string, unknown>>));
    }
}

/**
 * 把一段还没存下的源文字当作这个条目的主文字渲染给作者（rendering.md 输出 16）：求值的上下文与渲染存下来的块相同，结果是
 * 一块。不写入，也不过写入的队列：过不了写入检查的源文字照出错的块给（纯文本与诊断），由调用方显示。
 *
 * 嵌套深到解析或替换时栈溢出的（几万层引用这类，只会来自粘贴）也照出错的块给：这里的输入是作者正在打的字，不该让调用方
 * 收到一个说不清原因的内部错误。
 */
export function renderSourceForAuthor(world: World, entry: string, source: string, position: ReadPosition, mode: Mode): EntryRender<AuthorBlock> {
    const engine = world.lineAt(position, mode)?.engine;
    if (engine === undefined) return "line-not-found";
    const view = engine.entry(entry, position, mode);
    if (view === "chapter-not-found" || view === null) return view;
    let block: AuthorBlock;
    try {
        block = renderBlockForAuthor(SOURCE_BLOCK_ID, source, context(engine, world, entry, position, mode, {}), parseDraft);
    } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        block = {id: SOURCE_BLOCK_ID, error: {code: "mdx-invalid", line: 1, column: 1, message: "Nested too deeply to render"}, text: source};
    }
    if ("tree" in block) slimPositions(block.tree);
    return {version: world.version, position, mode, blocks: [block]};
}

export function renderEntryForAgent(world: World, entry: string, position: ReadPosition, mode: Mode, options: RenderOptions = {}): EntryRender<AgentBlock> {
    const engine = world.lineAt(position, mode)?.engine;
    if (engine === undefined) return "line-not-found";
    const view = engine.entry(entry, position, mode);
    if (view === "chapter-not-found" || view === null) return view;
    const shared = context(engine, world, entry, position, mode, options);
    // 位置里写明读的是哪条线：回写照带。章讲的线换了不加世界版本（宿主改活页夹），不写明的话，交回时会按新的线读，把旧线的值当成对新线的改动（输出 12）。
    return {version: world.version, position: {...position, line: world.positionLine(position, mode)}, mode, blocks: view.text.map((block) => renderBlockForAgent(block.id, block.source, shared))};
}

/** 纯文字渲染的选项：`entryName` 由调用方决定写给读者的名字（例如简报里用马甲的人写马甲）；返回 null 时写“已删除的条目”。 */
export interface PlainOptions {
    readonly entryName?: (id: string) => string | null;
}

/** 纯文字的渲染（rendering.md 输出 15：给不回写的读者，例如写手的简报）。 */
export function renderEntryPlain(world: World, entry: string, position: ReadPosition, mode: Mode, options: PlainOptions = {}): "chapter-not-found" | "line-not-found" | {readonly blocks: readonly PlainBlock[]} | null {
    const engine = world.lineAt(position, mode)?.engine;
    if (engine === undefined) return "line-not-found";
    const view = engine.entry(entry, position, mode);
    if (view === "chapter-not-found" || view === null) return view;
    const shared = context(engine, world, entry, position, mode, {});
    const plain: PlainContext = {
        ...shared,
        ...(options.entryName === undefined ? {} : {entryName: options.entryName}),
        // 只问条目表里有没有：不必为此折叠一遍条目。
        isEntry: (id) => world.data.entries.has(id),
    };
    return {blocks: view.text.map((block) => renderBlockPlain(block.id, block.source, plain))};
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
