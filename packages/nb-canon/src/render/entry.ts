/**
 * 按条目渲染（docs/specs/canon/rendering.md 输出 7、8）与整篇文字的切块（输出 3）。
 */

import {LOCAL_ID_PREFIX} from "../core/ids";
import type {Block, ReadPosition} from "../core/schema";
import type {Engine, Mode} from "../engine/types";
import {existingTagsIn, type World} from "../world/world";
import {parseEntryText} from "../grammar/index";
import {analysisProblem, analyzeDraft} from "./syntax";
import {renderBlockForAgent, renderBlockForAuthor, resolverFor, type AgentBlock, type AuthorBlock, type RenderContext, renderBlockPlain, type PlainBlock, type PlainContext} from "./render";

/** 渲染结果带着读取它的版本、位置与模式。 */
export type EntryRender<T> = {readonly version: number; readonly position: ReadPosition; readonly mode: Mode; readonly blocks: readonly T[]} | "chapter-not-found" | "line-not-found" | null;

/**
 * 渲染的选项：`hideUpcoming` 给带视图令牌的渲染用，不提“之后才启用”。`block` 只渲染这一块（没有这块时 `blocks` 是空的）；给 Agent 的
 * 这一块另带存下的源文（`source`）：Agent 写回这一块时按它核对读到的是哪一版（agent-tools.md 输出 6）。
 */
export interface RenderOptions {
    readonly hideUpcoming?: boolean;
    readonly block?: string;
}

/** 条目的块，按 `block` 只留那一块。 */
const blocksOf = <T extends {readonly id: string}>(text: readonly T[], options: RenderOptions): readonly T[] => (options.block === undefined ? text : text.filter((block) => block.id === options.block));

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
    return {version: world.version, position, mode, blocks: blocksOf(view.text, options).map((block) => renderBlockForAuthor(block.id, block.source, shared))};
}

/** 按给的源文字渲染时那一块的 id（rendering.md 输出 16）：不是存下来的块，不与 `b` 加号的块 id 重复。 */
export const SOURCE_BLOCK_ID = "source";

/**
 * 把一段还没存下的源文字当作这个条目的主文字渲染给作者（rendering.md 输出 16）：求值的上下文与渲染存下来的块相同，结果是
 * 一块。不写入，也不过写入的队列：过不了写入检查的源文字照出错的块给（纯文本与诊断），由调用方显示。
 *
 * 嵌套深到读不出结构的（几万层引用这类）也照出错的块给（`analyzeDraft`）。
 */
export function renderSourceForAuthor(world: World, entry: string, source: string, position: ReadPosition, mode: Mode): EntryRender<AuthorBlock> {
    const engine = world.lineAt(position, mode)?.engine;
    if (engine === undefined) return "line-not-found";
    const view = engine.entry(entry, position, mode);
    if (view === "chapter-not-found" || view === null) return view;
    // 没登记的标签按写入时的基线（输出 19）查：基线里没有的，写入会拒收，预览也照出错的块给。
    const existing = existingTagsIn(world, entry);
    const analyze = (text: string) => {
        const analysis = analyzeDraft(text);
        if (analysis.error !== null) return analysis;
        const error = analysisProblem(analysis, {existing: (tag) => existing.has(tag)});
        return error === null ? analysis : {...analysis, error};
    };
    return {version: world.version, position, mode, blocks: [renderBlockForAuthor(SOURCE_BLOCK_ID, source, context(engine, world, entry, position, mode, {}), analyze)]};
}

export function renderEntryForAgent(world: World, entry: string, position: ReadPosition, mode: Mode, options: RenderOptions = {}): EntryRender<AgentBlock> {
    const engine = world.lineAt(position, mode)?.engine;
    if (engine === undefined) return "line-not-found";
    const view = engine.entry(entry, position, mode);
    if (view === "chapter-not-found" || view === null) return view;
    const shared = context(engine, world, entry, position, mode, options);
    // 位置里写明读的是哪条线：章讲的线换了不加世界版本（宿主改活页夹），交回文字时按这条线读。
    return {version: world.version, position: {...position, line: world.positionLine(position, mode)}, mode, blocks: blocksOf(view.text, options).map((block) => (options.block === undefined ? renderBlockForAgent(block.id, block.source, shared) : {...renderBlockForAgent(block.id, block.source, shared), source: block.source}))};
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
 * 一段文字整体写入（新建条目、整篇替换）时按顶层的语法单元切成块，每块一个新 id（`b` 加号，不与 `taken` 里的重复）。每个单元在原文里
 * 按它的原文往后找（不按原文的长度累加：`marked` 给列表最后一行的行尾空白写成换行），找不到就整段作为一块，交给写入时的检查报错。
 */
export function splitBlocks(source: string, taken: Iterable<string> = []): Block[] {
    let max = 0;
    for (const id of taken) {
        const match = /^b(\d+)$/u.exec(id);
        if (match !== null) max = Math.max(max, Number(match[1]));
    }
    const next = () => `${LOCAL_ID_PREFIX.block}${String(++max)}`;
    const blocks: Block[] = [];
    let cursor = 0;
    let tokens: ReturnType<typeof parseEntryText>["tokens"];
    try {
        tokens = parseEntryText(source).tokens;
    } catch (error) {
        // 嵌套深到读不出结构的（几万层引用）：整段作为一块，交给写入时的检查报错。
        if (error instanceof RangeError) return [{id: next(), source}];
        throw error;
    }
    for (const token of tokens) {
        if (token.type === "space") {
            cursor += token.raw.length;
            continue;
        }
        const raw = token.raw.replace(/\s+$/u, "");
        const at = source.indexOf(raw, cursor);
        if (at < 0 || raw === "") return [{id: next(), source}];
        blocks.push({id: next(), source: raw});
        cursor = at + raw.length;
    }
    return blocks.length === 0 ? [{id: next(), source}] : blocks;
}
