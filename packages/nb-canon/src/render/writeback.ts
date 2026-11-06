/**
 * Agent 交回改过的一块（docs/specs/canon/rendering.md 输出 10、12、13、14）。
 *
 * 先扫出注记（跳过代码与转义；值用 JSON 解析出边界，不按第一个 `}` 切），按出现的顺序与源文的表达式一一对应；
 * `=` 右边变了的是字段操作，注记以外的字变了的是文字操作。每个操作先在一份临时世界上按就地改的规则走一遍
 * （revisions.md 输出 8），最后把临时世界里改到的对象合成一次写入请求，在真实世界上发布：一次回写一次修订。
 */

import {sameJson} from "../core/stable-json";
import type {Actor, Address, ReadPosition, WriteRequest} from "../core/schema";
import type {Mode} from "../engine/types";
import {editInPlace, type EditFailure} from "../world/edits";
import type {World, WriteResult} from "../world/world";
import {evaluate, resolverFor} from "./render";
import {blockProblem, parseBlock, type ExpressionSite} from "./syntax";

export interface WriteBackInput {
    readonly requestId: string;
    readonly by: Actor;
    readonly entry: string;
    readonly block: string;
    readonly position: ReadPosition;
    /** 读取时的版本。 */
    readonly version: number;
    /** 读取时的模式：只有按实际模式读到的块能回写（输出 12）。 */
    readonly mode: Mode;
    readonly text: string;
    readonly intent?: "creative" | "story";
    readonly title?: string;
}

export type WriteBackFailure =
    | EditFailure
    | {readonly code: "not-found"}
    | {readonly code: "computed-edited"}
    | {readonly code: "annotation-mismatch"}
    | {readonly code: "conflicting-values"; readonly at: Address}
    | {readonly code: "planned-not-writable"};

export type WriteBackResult = Extract<WriteResult, {ok: true}> | {readonly ok: false; readonly failure: WriteBackFailure};

interface Item {
    readonly start: number;
    readonly end: number;
    readonly kind: "comment" | "assign" | "computed";
    readonly left: string;
    readonly value: unknown;
}

/** 扫出注记与只含注释的表达式；写法不对返回 null。 */
export function scanAnnotations(text: string): Item[] | null {
    const items: Item[] = [];
    let index = 0;
    let lineStart = true;
    while (index < text.length) {
        const char = text[index]!;
        if (lineStart) {
            const fence = FENCE_OPEN.exec(text.slice(index, text.indexOf("\n", index) < 0 ? undefined : text.indexOf("\n", index)));
            if (fence !== null) {
                index = fenceEnd(text, index, fence[1]!);
                lineStart = true;
                continue;
            }
        }
        lineStart = char === "\n";
        if (char === "\\") {
            index += 2;
            continue;
        }
        if (char === "`") {
            let run = 0;
            while (text[index + run] === "`") run += 1;
            const fence = "`".repeat(run);
            const close = text.indexOf(fence, index + run);
            index = close < 0 ? text.length : close + run;
            continue;
        }
        if (char !== "{") {
            index += 1;
            continue;
        }
        const item = scanOne(text, index);
        if (item === null) return null;
        items.push(item);
        index = item.end;
    }
    return items;
}

/** Markdown 的围栏代码块开头（CommonMark：行首最多三个空格；反引号围栏的信息串里不能再有反引号）。 */
const FENCE_OPEN = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/u;

/** 围栏代码块结束之后的位置：闭合行同一种字符、不短于开头；没有闭合时到文末。 */
function fenceEnd(text: string, start: number, fence: string): number {
    const closing = new RegExp(`^ {0,3}${fence[0]!}{${String(fence.length)},}[ \\t]*$`, "u");
    let lineEnd = text.indexOf("\n", start);
    while (lineEnd >= 0) {
        const next = text.indexOf("\n", lineEnd + 1);
        const line = text.slice(lineEnd + 1, next < 0 ? undefined : next);
        if (closing.test(line)) return next < 0 ? text.length : next + 1;
        lineEnd = next;
    }
    return text.length;
}

function scanOne(text: string, start: number): Item | null {
    let cursor = start + 1;
    while (text[cursor] === " ") cursor += 1;
    if (text.startsWith("/*", cursor)) {
        const close = text.indexOf("*/", cursor);
        if (close < 0) return null;
        const end = text.indexOf("}", close);
        return end < 0 ? null : {start, end: end + 1, kind: "comment", left: text.slice(start + 1, end), value: null};
    }
    // 按 JS 的词法扫到顶层的 `=` 或 `->`：跳过字符串、注释与括号（输出 10）。
    let depth = 0;
    let separator = -1;
    let kind: "assign" | "computed" = "assign";
    for (let index = cursor; index < text.length; index += 1) {
        const char = text[index]!;
        if (char === "\"" || char === "'" || char === "`") {
            index = skipString(text, index);
            continue;
        }
        if (char === "/" && text[index + 1] === "*") {
            const close = text.indexOf("*/", index + 2);
            if (close < 0) return null;
            index = close + 1;
            continue;
        }
        if (char === "/" && text[index + 1] === "/") {
            const close = text.indexOf("\n", index + 2);
            if (close < 0) return null;
            index = close;
            continue;
        }
        if (char === "(" || char === "[" || char === "{") depth += 1;
        else if (char === ")" || char === "]") depth -= 1;
        else if (char === "}") {
            if (depth === 0) return null;
            depth -= 1;
        } else if (depth === 0 && char === "-" && text[index + 1] === ">") {
            separator = index;
            kind = "computed";
            break;
        } else if (depth === 0 && char === "=" && !"=!<>".includes(text[index - 1]!) && text[index + 1] !== "=" && text[index + 1] !== ">") {
            separator = index;
            break;
        }
    }
    if (separator < 0) return null;
    const left = text.slice(start + 1, separator).trim();
    let valueStart = separator + (kind === "computed" ? 2 : 1);
    while (text[valueStart] === " ") valueStart += 1;
    const valueEnd = jsonEnd(text, valueStart);
    if (valueEnd < 0) return null;
    let value: unknown;
    try {
        value = JSON.parse(text.slice(valueStart, valueEnd));
    } catch {
        return null;
    }
    let close = valueEnd;
    while (text[close] === " ") close += 1;
    if (text[close] === "#") {
        const end = text.indexOf("}", close);
        if (end < 0) return null;
        close = end;
    }
    if (text[close] !== "}") return null;
    return {start, end: close + 1, kind, left, value};
}

function skipString(text: string, start: number): number {
    const quote = text[start]!;
    for (let index = start + 1; index < text.length; index += 1) {
        if (text[index] === "\\") index += 1;
        else if (text[index] === quote) return index;
    }
    return text.length;
}

/** 一个 JSON 值的结束偏移：字符串、数字、字面量、对象与数组（括号配对，字符串里的括号不算）。 */
function jsonEnd(text: string, start: number): number {
    const char = text[start];
    if (char === "\"") return skipString(text, start) + 1;
    if (char === "{" || char === "[") {
        let depth = 0;
        for (let index = start; index < text.length; index += 1) {
            const current = text[index]!;
            if (current === "\"") index = skipString(text, index);
            else if (current === "{" || current === "[") depth += 1;
            else if (current === "}" || current === "]") {
                depth -= 1;
                if (depth === 0) return index + 1;
            }
        }
        return -1;
    }
    const match = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/u.exec(text.slice(start));
    return match === null ? -1 : start + match[0].length;
}

const REF_TAG = /<Ref\s+id=("(?:[^"\\]|\\.)*")\s+name="(?:[^"\\]|\\.)*"\s*\/>/gu;

export function writeBack(world: World, input: WriteBackInput, time: string): WriteBackResult {
    // 计划里的值不是现在的值：按计划模式读到的块原样交回也会被当成改动，悄悄改写设定。
    if (input.mode !== "actual") return {ok: false, failure: {code: "planned-not-writable"}};
    const engine = world.lineAt(input.position, "actual")?.engine;
    if (engine === undefined) return {ok: false, failure: {code: "line-not-found"}};
    const view = engine.entry(input.entry, input.position, "actual");
    if (view === "chapter-not-found") return {ok: false, failure: {code: "chapter-not-found"}};
    const block = view === null || view.deleted ? undefined : view.text.find((candidate) => candidate.id === input.block);
    if (block === undefined) return {ok: false, failure: {code: "not-found"}};
    const original = block.source;
    const parsed = parseBlock(original);
    // 交回的文字是读取时那个版本的样子。世界前进过以后，它和现在的差别分不清是 Agent 改的还是别的修订改的；当成改动会把别人写的值悄悄
    // 改回去（输出 13）。这里不回放旧版本，有差别一律请它重读：只会多拒，不会写错。
    const stale = input.version !== world.version;
    const staleConflict = (): WriteBackResult => ({ok: false, failure: {code: "version-conflict", objects: [{ref: {kind: "entry", id: input.entry}, changed: true, current: structuredClone(world.data.entries.get(input.entry))}]}});
    const resolve = resolverFor(engine, world.options.registry, world.options.order, input.entry, input.position, "actual");

    let newSource: string;
    const fieldOps: Array<{at: Address; value: unknown; read: unknown}> = [];
    if (!parsed.ok) {
        // 出错的块：交回的文字整体当作新源文（输出 14）。
        newSource = input.text;
    } else {
        const items = scanAnnotations(input.text);
        if (items === null) return {ok: false, failure: {code: "annotation-mismatch"}};
        const sites = parsed.block.expressions;
        if (items.length !== sites.length) return stale ? staleConflict() : {ok: false, failure: {code: "annotation-mismatch"}};
        const chosen = new Map<string, unknown>();
        for (const [index, item] of items.entries()) {
            const site = sites[index]!;
            if (!matches(item, site)) return stale ? staleConflict() : {ok: false, failure: {code: "annotation-mismatch"}};
            if (item.kind === "comment") continue;
            if (item.kind === "computed") {
                const current = evaluate(site.expression!, site.references, resolve).value;
                if (!sameJson(current ?? null, item.value)) return {ok: false, failure: stale ? {code: "value-conflict", current: current ?? null} : {code: "computed-edited"}};
                continue;
            }
            const reference = site.reference!;
            const current = resolve(reference);
            const currentValue = current.unavailable === undefined ? (current.value ?? null) : null;
            if (sameJson(currentValue, item.value)) continue;
            if (stale) return {ok: false, failure: {code: "value-conflict", current: currentValue}};
            const at: Address = {entry: reference.entry ?? input.entry, path: reference.path};
            const key = `${at.entry}\u0000${at.path}`;
            if (chosen.has(key) && !sameJson(chosen.get(key), item.value)) return {ok: false, failure: {code: "conflicting-values", at}};
            chosen.set(key, item.value);
            if (!fieldOps.some((op) => op.at.entry === at.entry && op.at.path === at.path)) fieldOps.push({at, value: item.value, read: currentValue});
        }
        // 文字操作：注记换回源文的表达式，`<Ref>` 去掉程序加的 name。
        let rebuilt = "";
        let cursor = 0;
        for (const [index, item] of items.entries()) {
            rebuilt += input.text.slice(cursor, item.start) + `{${sites[index]!.source}}`;
            cursor = item.end;
        }
        rebuilt += input.text.slice(cursor);
        newSource = rebuilt.replace(REF_TAG, (_whole, id: string) => `<Ref id=${id} />`);
        // 源文里的 `<Ref>` 也按同样的写法比，免得只是空白不同就算成文字操作。
        const normalizedOriginal = original.replace(/<Ref\s+id=("(?:[^"\\]|\\.)*")\s*\/>/gu, (_whole, id: string) => `<Ref id=${id} />`);
        if (newSource === normalizedOriginal) newSource = original;
    }

    if (newSource !== original) {
        const problem = blockProblem(newSource);
        if (problem !== null) return {ok: false, failure: {code: "validation-failed", problems: [{code: problem.code, path: `text[${input.block}]`, message: `${problem.message} (${String(problem.line)}:${String(problem.column)})`}]}};
    }
    if (fieldOps.length === 0 && newSource === original) return {ok: true, world, revision: world.revisions.at(-1)!, ids: {}, repeated: true};
    if (stale) return staleConflict();

    let scratch = world;
    let step = 0;
    const apply = (at: Address, value: unknown, read: unknown) => {
        const result = editInPlace(scratch, {requestId: `${input.requestId}#${String(++step)}`, by: input.by, position: input.position, at, value, read: {value: read, version: scratch.version}, intent: input.intent ?? "creative"}, time);
        if (!result.ok) return result.failure;
        scratch = result.world;
        return null;
    };
    for (const op of fieldOps) {
        const failure = apply(op.at, op.value, op.read);
        if (failure !== null) return {ok: false, failure};
    }
    if (newSource !== original) {
        const failure = apply({entry: input.entry, path: `text[${input.block}]`}, newSource, original);
        if (failure !== null) return {ok: false, failure};
    }

    // 把临时世界里改到的对象合成一次写入：新建的对象换回 tmp: id。
    const puts: WriteRequest["puts"] = [];
    for (const revision of scratch.revisions.slice(world.revisions.length)) {
        for (const op of revision.ops) {
            if (op.kind === "chapters" || puts.some((put) => put.ref.kind === op.ref.kind && (put.ref.id === op.ref.id || put.ref.id === `tmp:${op.ref.id}`))) continue;
            const value = scratch.object(op.ref);
            const isNew = world.object(op.ref) === undefined;
            const id = isNew ? `tmp:${op.ref.id}` : op.ref.id;
            puts.push({ref: {kind: op.ref.kind, id}, after: value === undefined ? null : {...(value as object), id}});
        }
    }
    const request: WriteRequest = {
        requestId: input.requestId,
        by: input.by,
        what: "edit",
        title: input.title ?? "改写一块",
        baseVersion: input.version,
        ...(input.position.kind === "chapter" ? {chapter: input.position.chapter} : {}),
        puts,
    };
    const result = world.publish(request, time);
    return result.ok ? result : {ok: false, failure: result.failure};
}

function matches(item: Item, site: ExpressionSite): boolean {
    if (item.kind === "comment") return site.expression === null;
    if (site.expression === null) return false;
    if ((item.kind === "assign") !== (site.reference !== null)) return false;
    return item.left.replace(/\s+/gu, "") === site.source.trim().replace(/\s+/gu, "");
}
