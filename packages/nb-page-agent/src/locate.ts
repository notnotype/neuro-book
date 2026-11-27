/**
 * 定位（docs/specs/agent/page-agent.md 输出 4、5）：把一个定位对象解析成页面上的一个元素，或给出失败与候选。
 * 调用方放在 `at`、`of`、`scope`、`within` 里的都是同一个对象；参数形状由宿主先按 `./api` 的 schema 校验过。
 */

import {DETAILS_BYTE_LIMIT, KEY_ATTRIBUTE, OWN_NODE_ATTRIBUTE, TARGET_ATTRIBUTE, locatorKind} from "./api";
import type {BaseLocator, Candidate, Locator, PageFailure, PageFailureCode, PageFailureDetails} from "./api";
import {collapse, composedContains, composedParent, deepQueryAll, flatChildren} from "./dom";
import type {Inspector} from "./inspect";
import {currentLayers} from "./layers";
import type {PageLayer} from "./layers";
import {sameIdentity, sameLayer} from "./refs";
import type {RefRegistry} from "./refs";
import {INTERACTIVE_ROLES, visibleTextOf} from "./snapshot/describe";
import {truncate, utf8Length} from "./text";

export interface LocateOptions {
    /** 这次调用会不会改页面；会改的不按稳定名重找（输出 4）。 */
    readonly mutating: boolean;
    /** 目标本身不可交互时落到它唯一的可交互后代（高亮用；截图与 `scope` 要的就是那个容器，不落）。 */
    readonly settle: boolean;
    /**
     * 没命中时在 `details` 里写出此刻的各层与遮挡（输出 12）。要多查一遍页面，所以只在失败要交给调用方时开：高亮等目标时只有
     * 最后一次开，界面目录判断“这一步做完没有”时不开。
     */
    readonly explain?: boolean;
}

export type Located = {readonly ok: true; readonly element: Element; readonly warnings: readonly string[]};

export interface LocateEnvironment {
    readonly inspector: Inspector;
    readonly refs: RefRegistry;
}

const CANDIDATE_LIMIT = 10;
const CANDIDATE_NAME_CHARS = 100;
const CANDIDATE_KEY_CHARS = 256;

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
    if (identity.target !== null) candidate.target = truncate(identity.target, CANDIDATE_KEY_CHARS);
    if (identity.key !== null) candidate.key = truncate(identity.key, CANDIDATE_KEY_CHARS);
    return candidate;
}

/**
 * `details` 按 JSON 序列化后至多 8 KB（输出 12）：超了从后往前去掉候选，并在说明里写明省略了几个。层与遮挡另有条数与字数上限
 * （`LAYER_LIMIT`、每层 256 字），和候选不会同时出现（候选只在命中多个时有）。
 */
function failure(code: PageFailureCode, message: string, candidates: readonly Candidate[] = [], explained: Omit<PageFailureDetails, "candidates"> = {}): PageFailure {
    const kept = [...candidates];
    while (kept.length > 0 && utf8Length(JSON.stringify({candidates: kept})) > DETAILS_BYTE_LIMIT) kept.pop();
    const omitted = candidates.length - kept.length;
    const text = omitted === 0 ? message : `${message}（候选太长，省略了 ${String(omitted)} 个）`;
    const details: PageFailureDetails = {...(kept.length === 0 ? {} : {candidates: kept}), ...explained};
    return Object.keys(details).length === 0 ? {ok: false, code, message: text} : {ok: false, code, message: text, details};
}

interface Explained {
    readonly details: Omit<PageFailureDetails, "candidates">;
    /** 盖住目标的那一层；没被盖住时为 null。 */
    readonly covering: PageLayer | null;
}

/**
 * 此刻的各层，以及目标是不是被最上面一层盖住了（输出 12）：`hidden` 是不计 `aria-hidden`、`inert` 时才命中的元素，其中有一个
 * 不在最上面一层里，就是被那一层盖住了。模态对话框打开时把它以外的地方都标成 `aria-hidden`（nb-ui 的对话框经 reka-ui），
 * 底下的控件按输出 3、5 不算画在页面上，这时只说“没找到”会让调用方以为目标不存在。
 */
function explainHidden(environment: LocateEnvironment, hidden: readonly Element[]): Explained {
    const layers = currentLayers(environment.inspector);
    const top = layers[layers.length - 1]!;
    const covering = top.root !== null && hidden.some((element) => !composedContains(top.root!, element)) ? top : null;
    return {details: {layers: layers.map((layer) => layer.label), ...(covering === null ? {} : {covered: {layer: covering.label}})}, covering};
}

function notFound(environment: LocateEnvironment, message: string, explain: boolean, hidden: () => readonly Element[]): PageFailure {
    if (!explain) return failure("not-found", message);
    const explained = explainHidden(environment, hidden());
    return failure("not-found", explained.covering === null ? message : `${message}（目标在，被上层 ${explained.covering.label} 盖住）`, [], explained.details);
}

/**
 * 被 `aria-hidden` 或 `inert` 藏起来、自己却画着的元素：只有这种才可能是“被上层盖住”。祖先里有引擎自己的节点的不算；
 * 被裁成零面积、`display: none`、`visibility: hidden` 的也不算，它们本来就看不见。
 */
function hiddenButDrawn(element: Element): boolean {
    let hidden = false;
    for (let current: Element | null = element; current !== null; current = composedParent(current)) {
        if (current.hasAttribute(OWN_NODE_ATTRIBUTE)) return false;
        if (current.getAttribute("aria-hidden") === "true" || current.hasAttribute("inert")) hidden = true;
    }
    if (!hidden) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && element.checkVisibility({visibilityProperty: true});
}

function describe(locator: BaseLocator): string {
    return JSON.stringify(locator);
}

function resolve(environment: LocateEnvironment, locator: BaseLocator, scope: Element | Document, options: LocateOptions, warnings: string[]): Located | PageFailure {
    const kind = locatorKind(locator);
    if (!kind.ok) throw new TypeError(kind.message);
    if (kind.kind === "ref") return resolveRef(environment, locator.ref!, scope, options, warnings);
    const matches = search(environment.inspector, locator, scope, (element) => environment.inspector.isRendered(element));
    if (locator.nth !== undefined) {
        const element = matches[locator.nth];
        return element === undefined
            ? failure("not-found", `${describe(locator)} 只命中 ${String(matches.length)} 个元素，没有第 ${String(locator.nth)} 个（从 0 起）`)
            : {ok: true, element, warnings};
    }
    if (matches.length === 0) {
        return notFound(environment, `没有找到 ${describe(locator)}`, options.explain === true, () => search(environment.inspector, locator, scope, hiddenButDrawn));
    }
    if (matches.length > 1) {
        return failure("ambiguous", `${describe(locator)} 命中 ${String(matches.length)} 个元素：用 nth、within，或 details 里候选的引用`,
            matches.slice(0, CANDIDATE_LIMIT).map((element) => candidateOf(environment, element)));
    }
    return {ok: true, element: matches[0]!, warnings};
}

/** 按稳定名、角色加名字或文字找，交回 `shown` 认的元素（平常是画出来了的），按组合树的先后。 */
function search(inspector: Inspector, locator: BaseLocator, scope: Element | Document, shown: (element: Element) => boolean): Element[] {
    const exact = locator.exact === true;
    if (locator.target !== undefined) {
        const selector = `[${TARGET_ATTRIBUTE}="${CSS.escape(locator.target)}"]${locator.key === undefined ? "" : `[${KEY_ATTRIBUTE}="${CSS.escape(locator.key)}"]`}`;
        return deepQueryAll(scope, selector).filter(shown);
    }
    if (locator.role !== undefined) {
        const role = locator.role;
        const name = locator.name;
        return deepQueryAll(scope, "*").filter((element) => inspector.role(element) === role
            && (name === undefined || textMatches(inspector.name(element), name, exact))
            && shown(element));
    }
    return searchText(inspector, locator.text!, exact, scope, shown);
}

/**
 * 按看得见的文字找：取文字匹配、又没有更深的后代也匹配的元素（最贴近这段文字的那个），再升到包着它的可交互元素
 * （点按钮里的文字就是点按钮）。
 *
 * 一遍先序走展平树：子树的 `textContent` 里连这段文字都没有就不往下走（它不含隐藏与否，只用来剪枝，原生实现便宜）；
 * 走到底没有后代匹配时，才按看得见的文字判断这个元素自己。这样只在包着这段文字的那几条祖先链上算可见文字，不是每个元素都算。
 */
function searchText(inspector: Inspector, text: string, exact: boolean, scope: Element | Document, shown: (element: Element) => boolean): Element[] {
    const needle = collapse(text).toLowerCase();
    const deepest: Element[] = [];
    /** 交回这棵子树里有没有匹配的元素。 */
    const visit = (element: Element): boolean => {
        const shadow = element.shadowRoot;
        // shadow 里的文字不在宿主的 textContent 里，宿主不剪枝。
        if (shadow === null && !collapse(element.textContent ?? "").toLowerCase().includes(needle)) return false;
        let below = false;
        for (const child of flatChildren(element)) if (visit(child)) below = true;
        if (below) return true;
        if (!textMatches(visibleTextOf(element), text, exact) || !shown(element)) return false;
        deepest.push(element);
        return true;
    };
    if (scope instanceof Document) {
        if (scope.body !== null) visit(scope.body);
    } else visit(scope);
    const out = new Set<Element>();
    for (const element of deepest) out.add(interactiveAncestor(inspector, element, scope) ?? element);
    return [...out];
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
    // 元素还在，只是被上层盖住了：它没变，按“没找到”说明遮挡，不当作引用失效（重新快照也看不到它）；高亮会接着等它露出来。
    if (element !== null && element.isConnected && inScope && hiddenButDrawn(element)) {
        const explained = explainHidden(environment, [element]);
        if (explained.covering !== null) return failure("not-found", `引用 ${ref} 指的元素被上层 ${explained.covering.label} 盖住`, [], explained.details);
    }
    // 元素不在了或换了身份：稳定名与 key 在同一层里唯一时，不改页面的方法改用它（输出 4）。
    // 没有 key 与有 key 是不同的身份：没有 key 的旧引用只重找同样没有 key 的元素。
    const rendered = (candidate: Element): boolean => inspector.isRendered(candidate);
    const sameName = issued.target === null ? [] : search(inspector, issued.key === null ? {target: issued.target} : {target: issued.target, key: issued.key}, scope, rendered)
        .filter((candidate) => {
            const identity = inspector.identity(candidate);
            return identity !== null && identity.key === issued.key && sameLayer(issued, identity);
        });
    if (!options.mutating && sameName.length === 1) {
        const rebound = sameName[0]!;
        warnings.push(`rebound: ${ref} -> ${candidateOf(environment, rebound).ref}`);
        return {ok: true, element: rebound, warnings};
    }
    const alike = sameName.length > 0 ? sameName : issued.role === "" ? [] : search(inspector, {role: issued.role, name: issued.name, exact: true}, scope, rendered);
    return failure("stale-ref", `引用 ${ref} 指的元素已不在或已变：重新快照，或用 details 里候选的引用`,
        alike.slice(0, CANDIDATE_LIMIT).map((candidate) => candidateOf(environment, candidate)));
}
