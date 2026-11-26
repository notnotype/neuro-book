/**
 * 定位（docs/specs/agent/page-agent.md 输出 4、5）：把一个定位对象解析成页面上的一个元素，或给出失败与候选。
 * 调用方放在 `at`、`of`、`scope`、`within` 里的都是同一个对象；参数形状由宿主先按 `./api` 的 schema 校验过。
 */

import {KEY_ATTRIBUTE, TARGET_ATTRIBUTE, locatorKind} from "./api";
import type {BaseLocator, Candidate, Locator, PageFailure, PageFailureCode} from "./api";
import {collapse, composedContains, composedParent, deepQueryAll} from "./dom";
import type {Inspector} from "./inspect";
import {sameIdentity, sameLayer} from "./refs";
import type {RefRegistry} from "./refs";
import {INTERACTIVE_ROLES, visibleTextOf} from "./snapshot/describe";
import {truncate} from "./text";

export interface LocateOptions {
    /** 这次调用会不会改页面；会改的不按稳定名重找（输出 4）。 */
    readonly mutating: boolean;
    /** 目标本身不可交互时落到它唯一的可交互后代（高亮用；截图与 `scope` 要的就是那个容器，不落）。 */
    readonly settle: boolean;
}

export type Located = {readonly ok: true; readonly element: Element; readonly warnings: readonly string[]};

export interface LocateEnvironment {
    readonly inspector: Inspector;
    readonly refs: RefRegistry;
}

const CANDIDATE_LIMIT = 10;
const CANDIDATE_NAME_CHARS = 100;

export function locate(environment: LocateEnvironment, locator: Locator, options: LocateOptions): Located | PageFailure {
    const warnings: string[] = [];
    let scope: Element | Document = environment.inspector.document;
    if (locator.within !== undefined) {
        const within = resolve(environment, locator.within, scope, options, warnings);
        if (!within.ok) return {...within, message: `within：${within.message}`};
        scope = within.element;
    }
    const {within: _within, ...base} = locator;
    const found = resolve(environment, base, scope, options, warnings);
    if (!found.ok) return found;
    const element = options.settle ? settle(environment.inspector, found.element) : found.element;
    return {ok: true, element, warnings};
}

/** 给候选发引用，调用方可以直接拿来再定位。 */
export function candidateOf(environment: LocateEnvironment, element: Element): Candidate {
    const {inspector, refs} = environment;
    const identity = inspector.identity(element) ?? inspector.identityWith(element, null);
    const candidate: {ref: string; role: string; name: string; target?: string; key?: string} = {
        ref: refs.issue(element, identity),
        role: identity.role,
        name: truncate(identity.name, CANDIDATE_NAME_CHARS),
    };
    if (identity.target !== null) candidate.target = identity.target;
    if (identity.key !== null) candidate.key = identity.key;
    return candidate;
}

function failure(code: PageFailureCode, message: string, candidates?: readonly Candidate[]): PageFailure {
    return candidates === undefined || candidates.length === 0 ? {ok: false, code, message} : {ok: false, code, message, details: {candidates: [...candidates]}};
}

function describe(locator: BaseLocator): string {
    return JSON.stringify(locator);
}

function resolve(environment: LocateEnvironment, locator: BaseLocator, scope: Element | Document, options: LocateOptions, warnings: string[]): Located | PageFailure {
    const kind = locatorKind(locator);
    if (!kind.ok) throw new TypeError(kind.message);
    if (kind.kind === "ref") return resolveRef(environment, locator.ref!, scope, options, warnings);
    const matches = search(environment.inspector, locator, scope);
    if (locator.nth !== undefined) {
        const element = matches[locator.nth];
        return element === undefined
            ? failure("not-found", `${describe(locator)} 只命中 ${String(matches.length)} 个元素，没有第 ${String(locator.nth)} 个（从 0 起）`)
            : {ok: true, element, warnings};
    }
    if (matches.length === 0) return failure("not-found", `没有找到 ${describe(locator)}`);
    if (matches.length > 1) {
        return failure("ambiguous", `${describe(locator)} 命中 ${String(matches.length)} 个元素：用 nth、within，或 details 里候选的引用`,
            matches.slice(0, CANDIDATE_LIMIT).map((element) => candidateOf(environment, element)));
    }
    return {ok: true, element: matches[0]!, warnings};
}

/** 按稳定名、角色加名字或文字找，交回画出来了的元素，按组合树的先后。 */
function search(inspector: Inspector, locator: BaseLocator, scope: Element | Document): Element[] {
    const exact = locator.exact === true;
    if (locator.target !== undefined) {
        const selector = `[${TARGET_ATTRIBUTE}="${CSS.escape(locator.target)}"]${locator.key === undefined ? "" : `[${KEY_ATTRIBUTE}="${CSS.escape(locator.key)}"]`}`;
        return deepQueryAll(scope, selector).filter((element) => inspector.isRendered(element));
    }
    if (locator.role !== undefined) {
        const role = locator.role;
        const name = locator.name;
        return deepQueryAll(scope, "*").filter((element) => inspector.role(element) === role
            && (name === undefined || textMatches(inspector.name(element), name, exact))
            && inspector.isRendered(element));
    }
    return searchText(inspector, locator.text!, exact, scope);
}

/**
 * 按看得见的文字找：先取文字匹配、且没有更深的后代也匹配的元素（最贴近这段文字的那个），
 * 再升到包着它的可交互元素（点按钮里的文字就是点按钮）。
 */
function searchText(inspector: Inspector, text: string, exact: boolean, scope: Element | Document): Element[] {
    // textContent 不折叠空白，拿要找的文字里最长的一段不含空白的片段先筛一遍，便宜地排除绝大多数元素。
    const fragment = collapse(text).toLowerCase().split(" ").reduce((longest, piece) => piece.length > longest.length ? piece : longest, "");
    const matched = deepQueryAll(scope, "*").filter((element) => (element.textContent ?? "").toLowerCase().includes(fragment)
        && textMatches(visibleTextOf(element, Math.max(400, text.length * 2)), text, exact)
        && inspector.isRendered(element));
    const deepest = matched.filter((element) => !matched.some((other) => other !== element && composedContains(element, other)));
    const out: Element[] = [];
    for (const element of deepest) {
        const promoted = interactiveAncestor(inspector, element, scope) ?? element;
        if (!out.includes(promoted)) out.push(promoted);
    }
    return out;
}

function interactiveAncestor(inspector: Inspector, element: Element, scope: Element | Document): Element | null {
    for (let current: Element | null = element; current !== null; current = composedParent(current)) {
        const role = inspector.role(current);
        if (role !== null && INTERACTIVE_ROLES.has(role)) return current;
        if (current === scope) return null;
    }
    return null;
}

function textMatches(actual: string, expected: string, exact: boolean): boolean {
    const have = collapse(actual);
    const want = collapse(expected);
    return exact ? have === want : have.toLowerCase().includes(want.toLowerCase());
}

/** 目标本身不可交互、又只有一个画出来的可交互后代时，落到那个后代（输出 5）。 */
function settle(inspector: Inspector, element: Element): Element {
    const role = inspector.role(element);
    if (role !== null && INTERACTIVE_ROLES.has(role)) return element;
    const inner = deepQueryAll(element, "*").filter((child) => child !== element && INTERACTIVE_ROLES.has(inspector.role(child) ?? "") && inspector.isRendered(child));
    return inner.length === 1 ? inner[0]! : element;
}

function resolveRef(environment: LocateEnvironment, ref: string, scope: Element | Document, options: LocateOptions, warnings: string[]): Located | PageFailure {
    const {inspector, refs} = environment;
    const lookup = refs.lookup(ref);
    if (lookup.kind === "foreign") return failure("stale-ref", `引用 ${ref} 不是这次页面加载发的（窗口刷新过，或来自别的窗口）：重新快照`);
    if (lookup.kind === "unknown") return failure("stale-ref", `引用 ${ref} 已失效：重新快照`);
    const {element, identity: issued} = lookup;
    const current = element !== null && element.isConnected ? inspector.identity(element) : null;
    const inScope = element !== null && (scope instanceof Document || composedContains(scope, element));
    if (element !== null && current !== null && inScope && inspector.isRendered(element) && sameIdentity(issued, current)) {
        return {ok: true, element, warnings};
    }
    // 元素不在了或换了身份：稳定名与 key 在同一层里唯一时，不改页面的方法改用它（输出 4）。
    const sameName = issued.target === null ? [] : search(inspector, issued.key === null ? {target: issued.target} : {target: issued.target, key: issued.key}, scope)
        .filter((candidate) => {
            const identity = inspector.identity(candidate);
            return identity !== null && sameLayer(issued, identity);
        });
    if (!options.mutating && sameName.length === 1) {
        const rebound = sameName[0]!;
        warnings.push(`rebound: ${ref} -> ${candidateOf(environment, rebound).ref}`);
        return {ok: true, element: rebound, warnings};
    }
    const alike = sameName.length > 0 ? sameName : issued.role === "" ? [] : search(inspector, {role: issued.role, name: issued.name, exact: true}, scope);
    return failure("stale-ref", `引用 ${ref} 指的元素已不在或已变：重新快照，或用 details 里候选的引用`,
        alike.slice(0, CANDIDATE_LIMIT).map((candidate) => candidateOf(environment, candidate)));
}
