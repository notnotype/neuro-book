/**
 * 文字快照（docs/specs/agent/page-agent.md 输出 3、12）。
 *
 * 三步：沿组合树收集候选（可交互元素、带名字的容器、列表、层根，加 `includeText` 时的文字），
 * 逐个判断看不看得见；再自底向上定容器列不列（有列出的后代，或自己没被盖住）；最后按预算挑行、渲染成文本树与元素数组。
 */

import {ELEMENT_LIMIT, KEY_ATTRIBUTE, SKIP_ATTRIBUTE, SKIP_VALUE, SNAPSHOT_DEFAULT_TOKENS, SNAPSHOT_MAX_TOKENS, TARGET_ATTRIBUTE} from "../api";
import type {PageFailure, SnapshotArgs, SnapshotElement, SnapshotResult} from "../api";
import {composedContains, composedParent, skipRegionOf, topElementAt} from "../dom";
import type {Inspector} from "../inspect";
import {locate} from "../locate";
import type {LocateEnvironment} from "../locate";
import {estimateTokens, quote, truncate} from "../text";
import {CONTAINER_ROLES, INTERACTIVE_ROLES, LIST_ROLES, ROW_ROLES, TEXT_ROLES, statesOf, valueOf, visibleTextOf} from "./describe";
import {contextFor, enter, intersect, isEmptyBox, rootContext} from "./walk";
import type {Box, WalkContext} from "./walk";

/** 不透明度低于这个值的标 `faint`（悬停才显出来的动作平时是 0）。 */
const FAINT_OPACITY = 0.2;
const NAME_CHARS = 100;
const VALUE_CHARS = 100;
const TEXT_CHARS = 200;
const KEY_CHARS = 256;
/** 留给截断提示的预算。 */
const HINT_TOKENS = 120;
/** 截断时至多推荐这么多个可以用 `scope` 缩小到的区域。 */
const SCOPE_HINTS = 5;
/** 焦点所在区域按这些角色认（输出 3 的截断顺序）。 */
const REGION_ROLES: ReadonlySet<string> = new Set(["region", "main", "navigation", "complementary", "banner", "contentinfo", "form", "search", "tabpanel", "dialog", "alertdialog", "tree", "treegrid", "grid", "listbox", "menu", "toolbar"]);

type Kind = "interactive" | "container" | "text" | "skipped";
/** `visible` 对容器与跳过区域只表示框没被裁掉，盖没盖住要等第二步再看。 */
type Status = "visible" | "offscreen" | "covered" | "hidden";

interface Layer {
    readonly root: Element | null;
    readonly order: number;
    node: SnapshotNode | null;
    shown: number;
    covered: number;
}

interface SnapshotNode {
    readonly element: Element;
    readonly kind: Kind;
    readonly role: string;
    /** 要列出时才算（`nodeName`）。 */
    name?: string;
    readonly order: number;
    readonly parent: SnapshotNode | null;
    readonly layer: Layer;
    readonly list: SnapshotNode | null;
    readonly scroller: Element | null;
    readonly box: Box | null;
    readonly status: Status;
    readonly faint: boolean;
    readonly layerRoot: boolean;
    listed: boolean;
    hasListedDescendant: boolean;
    position?: number;
    summary?: string;
    ref?: string;
}

export function takeSnapshot(environment: LocateEnvironment, args: SnapshotArgs): SnapshotResult | PageFailure {
    const {inspector, refs} = environment;
    const document = inspector.document;
    const warnings: string[] = [];
    let root: Element = document.body ?? document.documentElement;
    let start: WalkContext = rootContext(document);
    let scopeLine: string | null = null;
    if (args.scope !== undefined) {
        const scoped = locate(environment, args.scope, {mutating: false, settle: false});
        if (!scoped.ok) return {...scoped, message: `scope：${scoped.message}`};
        warnings.push(...scoped.warnings);
        // 跳过区域里的元素作 scope 时只写区域的占位：跳过区域不列内容（输出 3），换个起点也一样。
        const from = skipRegionOf(scoped.element) ?? scoped.element;
        const context = contextFor(from);
        if (context === null || !inspector.isRendered(scoped.element)) return {ok: false, code: "not-found", message: "scope 指的元素没有画在页面上"};
        root = from;
        start = context;
        const identity = inspector.identity(scoped.element)!;
        const name = identity.name === "" ? "" : ` ${quote(identity.name, NAME_CHARS)}`;
        scopeLine = `scope: ${identity.role === "" ? scoped.element.localName : identity.role}${name} [${refs.issue(scoped.element, identity)}]`;
    }

    const collected = collect(environment, root, start, args.includeText === true);
    const active = deepActiveElement(document);
    decideListing(collected.nodes, (node) => nodeName(inspector, node));
    summarizeLists(collected.nodes, document);
    for (const node of collected.nodes) {
        if (node.listed && node.kind !== "skipped") node.ref = refs.issue(node.element, inspector.identityWith(node.element, node.layer.root));
    }
    const layerRefs = new Map<Layer, string>();
    for (const layer of collected.layers) {
        if (layer.root === null) layerRefs.set(layer, "base");
        else layerRefs.set(layer, layer.node?.ref ?? refs.issue(layer.root, inspector.identity(layer.root) ?? inspector.identityWith(layer.root, layer.root)));
    }

    const header = [windowLine(document, refs.prefix)];
    if (scopeLine !== null) header.push(scopeLine);
    header.push(layersLine(inspector, collected.layers));

    // 字节上限（输出 12）由预算保证，不另量：至多 8000 token，每个估算的 token 至多 4 个 UTF-8 字节，文字远在 64 KB 以内；
    // 元素数组是同一批行（至多 ELEMENT_LIMIT 个），名字、值与 key 都有字数上限，整个回复远在 256 KB 以内。
    const rendered = render(environment, collected, layerRefs, header, args.maxTokens ?? SNAPSHOT_DEFAULT_TOKENS, active);
    if (rendered.truncated) warnings.push(`truncated: 有 ${String(rendered.omitted)} 个元素超出预算没有列出`);
    return {text: rendered.text, elements: rendered.elements, truncated: rendered.truncated, warnings};
}

/** 节点的名字只在要列出时才算（可访问名是遍历里最贵的一步）。 */
function nodeName(inspector: Inspector, node: SnapshotNode): string {
    node.name ??= node.kind === "text" && node.role !== "heading" ? visibleTextOf(node.element, TEXT_CHARS * 2) : inspector.name(node.element);
    return node.name;
}

function deepActiveElement(document: Document): Element | null {
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active === document.body ? null : active;
}

// ---------- 第一步：收集与可见性 ----------

interface Collected {
    readonly nodes: readonly SnapshotNode[];
    readonly layers: readonly Layer[];
}

function classify(role: string, layerRoot: boolean, includeText: boolean): Kind | null {
    if (INTERACTIVE_ROLES.has(role)) return "interactive";
    if (CONTAINER_ROLES.has(role) || LIST_ROLES.has(role) || layerRoot) return "container";
    if (includeText && TEXT_ROLES.has(role)) return "text";
    return null;
}

function collect(environment: LocateEnvironment, root: Element, start: WalkContext, includeText: boolean): Collected {
    const {inspector} = environment;
    const nodes: SnapshotNode[] = [];
    const layers = new Map<Element | null, Layer>();
    const layerFor = (layerRoot: Element | null): Layer => {
        let layer = layers.get(layerRoot);
        if (layer === undefined) {
            layer = {root: layerRoot, order: layers.size, node: null, shown: 0, covered: 0};
            layers.set(layerRoot, layer);
        }
        return layer;
    };
    layerFor(start.layer);

    const visit = (element: Element, context: WalkContext, parent: SnapshotNode | null, list: SnapshotNode | null): void => {
        const entered = enter(element, context);
        inspector.remember(element, entered);
        if (entered === null) return;
        const layer = layerFor(entered.layer);
        const skipped = element.getAttribute(SKIP_ATTRIBUTE) === SKIP_VALUE;
        const role = entered.role;
        const kind: Kind | null = skipped ? "skipped" : role === null ? null : classify(role, entered.layerRoot, includeText);
        let node: SnapshotNode | null = null;
        if (kind !== null) {
            const rect = element.getBoundingClientRect();
            let status: Status;
            let box: Box | null = null;
            if (entered.visibilityHidden || rect.width <= 0 || rect.height <= 0) {
                status = "hidden";
            } else {
                const clipped = intersect(rect, entered.clips.hard);
                if (isEmptyBox(clipped)) status = "hidden";
                else {
                    const visible = intersect(clipped, entered.clips.scroll);
                    // 滚出去的要还能滚回来：落在滚动内容起点左上方的（例如 left: -9999px 的跳过链接）滚不进视野，按看不见算。
                    if (isEmptyBox(visible)) status = canScrollTo(rect, entered.clips.scroller, element.ownerDocument) ? "offscreen" : "hidden";
                    else {
                        box = visible;
                        status = kind === "interactive" || kind === "text" ? (reachable(element, visible) ? "visible" : "covered") : "visible";
                    }
                }
            }
            node = {
                element, kind, role: role ?? "", order: nodes.length, parent, layer, list: kind !== "skipped" && role !== null && ROW_ROLES.has(role) ? list : null,
                scroller: entered.clips.scroller, box, status, faint: entered.opacity < FAINT_OPACITY, layerRoot: entered.layerRoot, listed: false, hasListedDescendant: false,
            };
            nodes.push(node);
            if (entered.layerRoot) layer.node = node;
        }
        // 跳过的区域不列内容（输出 3）：定位不受影响，locate 自己查整页。
        if (skipped || entered.child === null) return;
        const nextParent = node ?? parent;
        const nextList = node !== null && LIST_ROLES.has(node.role) ? node : list;
        const childContext = entered.child;
        // 按展平树走（同 `dom.ts` 的 `flatChildren`）：有 shadow root 的宿主只走 shadow 里的，轻 DOM 的子元素经 slot 走到；
        // 常见情形按兄弟指针走，不为每个元素建数组。
        const shadow = element.shadowRoot;
        if (shadow !== null) {
            for (let child = shadow.firstElementChild; child !== null; child = child.nextElementSibling) visit(child, childContext, nextParent, nextList);
            return;
        }
        const assigned = element instanceof HTMLSlotElement ? element.assignedElements({flatten: true}) : [];
        if (assigned.length > 0) {
            for (const child of assigned) visit(child, childContext, nextParent, nextList);
            return;
        }
        for (let child = element.firstElementChild; child !== null; child = child.nextElementSibling) visit(child, childContext, nextParent, nextList);
    };
    visit(root, start, null, null);
    return {nodes, layers: [...layers.values()]};
}

/**
 * 能点到：在可见部分的中心、再退到四角做命中检查，最上面的（跳过引擎自己的节点）是它自己或它的后代、是它的 label，
 * 或它自己 `pointer-events: none`（命中检查穿过它）而最上面的是它的祖先，就算没被盖住。祖先在最上面而它自己接收指针时，
 * 是被祖先的伪元素蒙层或背景盖住了（例如加载中的 `::after` 遮罩、负 z-index），按被盖住算。
 */
function reachable(element: Element, box: Box): boolean {
    const width = box.right - box.left;
    const height = box.bottom - box.top;
    const inset = Math.min(3, width / 3, height / 3);
    const points: ReadonlyArray<readonly [number, number]> = [
        [box.left + width / 2, box.top + height / 2],
        [box.left + inset, box.top + inset],
        [box.right - inset, box.top + inset],
        [box.left + inset, box.bottom - inset],
        [box.right - inset, box.bottom - inset],
    ];
    const labels = "labels" in element ? (element as HTMLInputElement).labels : null;
    let passesThrough: boolean | null = null;
    for (const [x, y] of points) {
        const top = topElementAt(element.ownerDocument, x, y);
        if (top === null) continue;
        if (composedContains(element, top)) return true;
        if (composedContains(top, element)) {
            passesThrough ??= element.ownerDocument.defaultView?.getComputedStyle(element).pointerEvents === "none";
            if (passesThrough) return true;
        }
        if (labels !== null && [...labels].some((label) => composedContains(label, top))) return true;
    }
    return false;
}

// ---------- 第二步：列不列 ----------

function decideListing(nodes: readonly SnapshotNode[], nameOf: (node: SnapshotNode) => string): void {
    // 先序排列，倒着走时每个节点的后代都已经定了。
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const node = nodes[index]!;
        switch (node.kind) {
            case "interactive":
            case "text":
                // 列表里滚出去的行折进列表的摘要（输出 3），别的滚出去的元素标 offscreen 照常列出。
                node.listed = node.status === "visible" || (node.status === "offscreen" && node.list === null);
                if (node.status !== "hidden") {
                    if (node.listed) node.layer.shown += 1;
                    else if (node.status === "covered") node.layer.covered += 1;
                }
                break;
            case "container":
                // 容器只列带名字的；列表与层根不带名字也列，它们撑起文本树的层次。
                node.listed = (node.hasListedDescendant || (node.status === "visible" && reachable(node.element, node.box!)))
                    && (LIST_ROLES.has(node.role) || node.layerRoot || nameOf(node) !== "");
                break;
            case "skipped":
                node.listed = node.status === "offscreen" || (node.status === "visible" && reachable(node.element, node.box!));
                break;
        }
        if (node.listed) nameOf(node);
        if ((node.listed || node.hasListedDescendant) && node.parent !== null) node.parent.hasListedDescendant = true;
    }
}

function positiveInteger(value: string | null): number | null {
    if (value === null) return null;
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

/** 列表类容器的摘要与行的位置（输出 3）。树的 `aria-posinset` 按层级各自编号，不拿来当整棵树的位置。 */
function summarizeLists(nodes: readonly SnapshotNode[], document: Document): void {
    const byList = new Map<SnapshotNode, SnapshotNode[]>();
    for (const node of nodes) {
        if (node.list === null || node.status === "hidden") continue;
        const rows = byList.get(node.list);
        if (rows === undefined) byList.set(node.list, [node]);
        else rows.push(node);
    }
    for (const [list, rows] of byList) {
        const flat = list.role !== "tree" && list.role !== "treegrid";
        rows.forEach((row, index) => {
            row.position = (flat ? positiveInteger(row.element.getAttribute("aria-posinset")) : null) ?? index + 1;
        });
        // 总数只在页面写明时给（aria-setsize、aria-rowcount）：虚拟列表只渲染一段，已渲染的行数不是总数。
        const total = (flat ? positiveInteger(rows[0]!.element.getAttribute("aria-setsize")) : null) ?? positiveInteger(list.element.getAttribute("aria-rowcount"));
        const positions = rows.map((row) => row.position!);
        const shown = rows.filter((row) => row.listed).map((row) => row.position!);
        // 行都列出来了、页面也没说还有更多时不写摘要：列表所在的面板能滚，不等于滚这个列表会多出行来。
        if (shown.length === rows.length && (total === null || total <= rows.length)) continue;
        const scroll = scrollDirections(rows[0]!.scroller, document);
        const shownText = shown.length === 0 ? "none" : `${String(Math.min(...shown))}-${String(Math.max(...shown))}`;
        const rendered = `rendered ${String(Math.min(...positions))}-${String(Math.max(...positions))}`;
        list.summary = `(rows: ${total === null ? "" : `${String(total)} total, `}${rendered}, shown ${shownText}${scroll.length === 0 ? "" : `, can scroll ${scroll.join("/")}`})`;
    }
}

/** 元素在滚动内容里的位置不在起点的左上方之外：滚得到它。 */
function canScrollTo(rect: DOMRect, scroller: Element | null, document: Document): boolean {
    if (scroller === null) {
        const view = document.defaultView;
        return view === null || (rect.right + view.scrollX > 0 && rect.bottom + view.scrollY > 0);
    }
    const frame = scroller.getBoundingClientRect();
    return rect.right - frame.left + scroller.scrollLeft > 0 && rect.bottom - frame.top + scroller.scrollTop > 0;
}

function scrollDirections(scroller: Element | null, document: Document): string[] {
    const element = scroller ?? document.scrollingElement;
    if (element === null) return [];
    const directions: string[] = [];
    if (element.scrollTop > 0.5) directions.push("up");
    if (element.scrollTop + element.clientHeight < element.scrollHeight - 1) directions.push("down");
    if (element.scrollLeft > 0.5) directions.push("left");
    if (element.scrollLeft + element.clientWidth < element.scrollWidth - 1) directions.push("right");
    return directions;
}

// ---------- 第三步：按预算渲染 ----------

function windowLine(document: Document, prefix: string): string {
    const view = document.defaultView;
    let path = "";
    if (view !== null) {
        const raw = view.location.pathname + view.location.search;
        try {
            path = decodeURIComponent(raw);
        } catch {
            // 路径里有不成对的百分号编码：照原样写。
            path = raw;
        }
    }
    const pathText = /^\S+$/u.test(path) ? path : quote(path, 200);
    const size = view === null ? "" : `  ${String(view.innerWidth)}x${String(view.innerHeight)}`;
    return `window ${prefix} ${quote(document.title, 80)} ${pathText}${size}${document.hasFocus() ? "  focused" : ""}`;
}

function layersLine(inspector: Inspector, layers: readonly Layer[]): string {
    const parts: string[] = [];
    for (const layer of layers) {
        const covered = layer.shown === 0 && layer.covered > 0;
        if (layer.order > 0 && !covered && layer.shown === 0 && layer.node?.listed !== true) continue;
        // 层根不一定在这次遍历里（scope 落在弹层里时它在起点之外），按元素现查角色与名字。
        const name = layer.root === null ? "" : inspector.name(layer.root);
        const label = layer.root === null ? "base" : `${inspector.role(layer.root) ?? layer.root.localName}${name === "" ? "" : ` ${quote(name, 40)}`}`;
        parts.push(covered ? `${label} (covered)` : label);
    }
    return `layers: ${parts.join(" > ")}`;
}

function depthOf(node: SnapshotNode): number {
    let depth = 0;
    for (let parent = node.parent; parent !== null; parent = parent.parent) if (parent.listed) depth += 1;
    return depth;
}

function listedParent(node: SnapshotNode): SnapshotNode | null {
    let parent = node.parent;
    while (parent !== null && !parent.listed) parent = parent.parent;
    return parent;
}

function stateTokens(node: SnapshotNode, active: Element | null): string[] {
    const tokens = node.kind === "interactive" ? statesOf(node.element, active) : [];
    if (node.faint) tokens.push("faint");
    if (node.status === "offscreen") tokens.push("offscreen");
    if (node.position !== undefined) tokens.push(`pos=${String(node.position)}`);
    return tokens;
}

function keyText(key: string): string {
    return /^[\p{L}\p{N}_.:/@#-]+$/u.test(key) && key.length <= KEY_CHARS ? key : quote(key, KEY_CHARS);
}

interface Line {
    readonly text: string;
    readonly tokens: number;
}

function linesOf(node: SnapshotNode, active: Element | null): Line[] {
    const indent = "  ".repeat(depthOf(node));
    if (node.kind === "skipped") {
        const name = node.name ?? "";
        const label = `${node.role === "" ? "" : ` ${node.role}`}${name === "" ? "" : ` ${quote(name, NAME_CHARS)}`}`;
        const text = `${indent}- (skipped${label})`;
        return [{text, tokens: estimateTokens(text) + 1}];
    }
    const parts = [node.ref!, ...stateTokens(node, active)];
    const target = node.element.getAttribute(TARGET_ATTRIBUTE);
    const key = node.element.getAttribute(KEY_ATTRIBUTE);
    if (target !== null) parts.push(`target=${keyText(target)}`);
    if (key !== null) parts.push(`key=${keyText(key)}`);
    const value = node.kind === "interactive" ? valueOf(node.element, node.role) : undefined;
    if (value !== undefined) parts.push(`value=${quote(value, VALUE_CHARS)}`);
    const name = (node.name ?? "") === "" ? "" : ` ${quote(node.name!, node.kind === "text" ? TEXT_CHARS : NAME_CHARS)}`;
    const text = `${indent}- ${node.role}${name} [${parts.join(" ")}]`;
    const lines: Line[] = [{text, tokens: estimateTokens(text) + 1}];
    if (node.summary !== undefined) {
        const summary = `${indent}  - ${node.summary}`;
        lines.push({text: summary, tokens: estimateTokens(summary) + 1});
    }
    return lines;
}

function elementOf(node: SnapshotNode, layerRef: string, active: Element | null): SnapshotElement {
    const element: {ref: string; role: string; name: string; target?: string; key?: string; layer: string; states: string[]; value?: string} = {
        ref: node.ref!,
        role: node.role,
        name: truncate(node.name ?? "", node.kind === "text" ? TEXT_CHARS : NAME_CHARS),
        layer: layerRef,
        states: stateTokens(node, active),
    };
    const target = node.element.getAttribute(TARGET_ATTRIBUTE);
    const key = node.element.getAttribute(KEY_ATTRIBUTE);
    if (target !== null) element.target = truncate(target, KEY_CHARS);
    if (key !== null) element.key = truncate(key, KEY_CHARS);
    const value = node.kind === "interactive" ? valueOf(node.element, node.role) : undefined;
    if (value !== undefined) element.value = truncate(value, VALUE_CHARS);
    return element;
}

interface Rendered {
    readonly text: string;
    readonly elements: SnapshotElement[];
    readonly truncated: boolean;
    readonly omitted: number;
}

/**
 * 按“最上层 > 焦点所在区域 > 其余”（只有一层时没有第一档）、同档里先看得见的、再按页面先后挑行（输出 3）；
 * 挑一行就把它还没挑的祖先一起挑上，输出时仍按页面先后。
 */
function render(environment: LocateEnvironment, collected: Collected, layerRefs: ReadonlyMap<Layer, string>, header: readonly string[], budget: number, active: Element | null): Rendered {
    const listed = collected.nodes.filter((node) => node.listed);
    const lines = new Map<SnapshotNode, Line[]>();
    const linesFor = (node: SnapshotNode): Line[] => {
        let cached = lines.get(node);
        if (cached === undefined) {
            cached = linesOf(node, active);
            lines.set(node, cached);
        }
        return cached;
    };
    const costOf = (node: SnapshotNode): number => linesFor(node).reduce((sum, line) => sum + line.tokens, 0);

    const shownLayers = collected.layers.filter((layer) => layer.shown > 0);
    const topLayer = shownLayers.length > 1 ? shownLayers[shownLayers.length - 1]! : null;
    const region = focusRegion(collected.nodes, active);
    const within = (node: SnapshotNode, ancestor: SnapshotNode): boolean => {
        for (let current: SnapshotNode | null = node; current !== null; current = current.parent) if (current === ancestor) return true;
        return false;
    };
    const rank = new Map<SnapshotNode, number>();
    for (const node of listed) rank.set(node, topLayer !== null && node.layer === topLayer ? 0 : region !== null && within(node, region) ? 1 : 2);
    const ordered = [...listed].sort((a, b) => rank.get(a)! - rank.get(b)! || Number(a.status === "offscreen") - Number(b.status === "offscreen") || a.order - b.order);

    const included = new Set<SnapshotNode>();
    let tokens = header.reduce((sum, line) => sum + estimateTokens(line) + 1, 0) + HINT_TOKENS;
    let elementCount = 0;
    let truncated = false;
    for (const node of ordered) {
        if (included.has(node)) continue;
        const chain: SnapshotNode[] = [];
        for (let current: SnapshotNode | null = node; current !== null; current = listedParent(current)) {
            if (included.has(current)) break;
            chain.push(current);
        }
        const cost = chain.reduce((sum, member) => sum + costOf(member), 0);
        const added = chain.filter((member) => member.kind !== "skipped").length;
        if (tokens + cost > budget || elementCount + added > ELEMENT_LIMIT) {
            truncated = true;
            break;
        }
        for (const member of chain) included.add(member);
        tokens += cost;
        elementCount += added;
    }

    const body: string[] = [];
    const elements: SnapshotElement[] = [];
    for (const node of listed) {
        if (!included.has(node)) continue;
        for (const line of linesFor(node)) body.push(line.text);
        if (node.kind !== "skipped") elements.push(elementOf(node, layerRefs.get(node.layer)!, active));
    }
    const omitted = listed.filter((node) => !included.has(node) && node.kind !== "skipped").length;
    if (truncated) body.push(truncationHint(environment, listed, included, omitted, costOf));
    return {text: [...header, ...body].join("\n"), elements, truncated, omitted};
}

function focusRegion(nodes: readonly SnapshotNode[], active: Element | null): SnapshotNode | null {
    if (active === null) return null;
    const byElement = new Map<Element, SnapshotNode>();
    for (const node of nodes) if (node.listed && node.kind === "container" && REGION_ROLES.has(node.role)) byElement.set(node.element, node);
    for (let current: Element | null = active; current !== null; current = composedParent(current)) {
        const node = byElement.get(current);
        if (node !== undefined) return node;
    }
    return null;
}

/**
 * 截断提示：列出有没列出的后代、整块放得进最大预算的区域，带估算的大小；调用方拿它的引用作 `scope`、
 * 按大小定 `maxTokens` 再快照一次。
 */
function truncationHint(environment: LocateEnvironment, listed: readonly SnapshotNode[], included: ReadonlySet<SnapshotNode>, omitted: number, costOf: (node: SnapshotNode) => number): string {
    const omittedIn = new Map<SnapshotNode, number>();
    const subtree = new Map<SnapshotNode, number>();
    const elementsIn = new Map<SnapshotNode, number>();
    const sizeOf = (node: SnapshotNode): number => (subtree.get(node) ?? 0) + costOf(node) + 40;
    for (const node of listed) {
        const cost = costOf(node);
        const missing = !included.has(node) && node.kind !== "skipped";
        for (let ancestor = listedParent(node); ancestor !== null; ancestor = listedParent(ancestor)) {
            subtree.set(ancestor, (subtree.get(ancestor) ?? 0) + cost);
            if (node.kind !== "skipped") elementsIn.set(ancestor, (elementsIn.get(ancestor) ?? 0) + 1);
            if (missing) omittedIn.set(ancestor, (omittedIn.get(ancestor) ?? 0) + 1);
        }
    }
    const candidates = [...omittedIn.entries()]
        // 推荐的区域要能整块列出：放得进最大预算，后代也不超过元素上限。
        .filter(([node]) => node.kind === "container" && (node.name ?? "") !== "" && sizeOf(node) <= SNAPSHOT_MAX_TOKENS - HINT_TOKENS && (elementsIn.get(node) ?? 0) < ELEMENT_LIMIT)
        .sort((a, b) => b[1] - a[1]);
    const picked: Array<readonly [SnapshotNode, number]> = [];
    for (const entry of candidates) {
        if (picked.length >= SCOPE_HINTS) break;
        if (picked.some(([other]) => composedContains(other.element, entry[0].element) || composedContains(entry[0].element, other.element))) continue;
        picked.push(entry);
    }
    if (picked.length === 0) return `truncated: ${String(omitted)} more elements; raise maxTokens (up to 8000), or pass a smaller scope (one snapshot lists at most ${String(ELEMENT_LIMIT)} elements)`;
    const items = picked.map(([node, count]) => `${environment.refs.issue(node.element, environment.inspector.identityWith(node.element, node.layer.root))} ${node.role} ${quote(node.name ?? "", 40)} (${String(count)} more, ~${String(sizeOf(node))} tokens)`);
    return `truncated: ${String(omitted)} more elements; snapshot again with scope {ref} and maxTokens of at least its size, on one of: ${items.join(", ")}`;
}
