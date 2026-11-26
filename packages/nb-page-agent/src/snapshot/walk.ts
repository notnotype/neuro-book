/**
 * 沿展平树走一个元素时要知道的事：它看不看得见、裁剪框、所在的层（docs/specs/agent/page-agent.md 输出 3）。
 * 快照的遍历与按引用核对身份（`Inspector`）都用 `enter`，两边对“在哪一层”“裁没裁掉”的判断才一致。
 */

import {OWN_NODE_ATTRIBUTE} from "../api";
import {composedParent} from "../dom";
import {roleOf} from "./describe";

export interface Box {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
}

export const intersect = (a: Box, b: Box): Box => ({left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom)});
export const isEmptyBox = (box: Box): boolean => box.right <= box.left || box.bottom <= box.top;

/** 一个元素受的裁剪。 */
export interface Clips {
    /** `overflow: hidden`、`clip` 的祖先裁出的框：落在框外就是看不见。 */
    readonly hard: Box;
    /** 滚动容器与视口裁出的框：落在框外是滚出去了，标 `offscreen`。 */
    readonly scroll: Box;
    /** 最近的滚动容器；null 是视口。 */
    readonly scroller: Element | null;
}

/** 走到一个元素时从祖先带下来的东西。 */
export interface WalkContext {
    /** 祖先链累乘的不透明度。 */
    readonly opacity: number;
    /** 普通（static、relative、sticky）的子元素受的裁剪。 */
    readonly clips: Clips;
    /**
     * `position: absolute` 的子元素受的裁剪：CSS 的 overflow 只裁包含块链经过它的后代，所以是最近的定位祖先（或带 transform 的
     * 祖先）里面的那份，不是父元素里面的那份。
     */
    readonly absolute: Clips;
    /** `position: fixed` 的子元素受的裁剪：有带 transform 的祖先时是它里面的那份；null 是视口。 */
    readonly fixed: Clips | null;
    /** 所在层的根；null 是底层。 */
    readonly layer: Element | null;
    /** 从上一个层根往下，是否经过了浮出来的外壳（挂在 body 下的 fixed、absolute 外壳，打开的 popover）。 */
    readonly floating: boolean;
    /** 被展开的触发器（`aria-expanded="true"`）经 `aria-controls`、`aria-owns` 指着的元素 id。 */
    readonly expanded: ReadonlySet<string>;
}

export interface Entered {
    readonly role: string | null;
    readonly opacity: number;
    /** 元素自己受的裁剪。 */
    readonly clips: Clips;
    /** 元素所在的层；层根自己就在它开的那一层。 */
    readonly layer: Element | null;
    readonly layerRoot: boolean;
    readonly visibilityHidden: boolean;
    /** 子元素的上下文；null 表示不往下走（svg、select 这类内部不列的元素）。 */
    readonly child: WalkContext | null;
}

const PRUNED_TAGS: ReadonlySet<string> = new Set(["script", "style", "template", "noscript", "head", "meta", "link", "title"]);
/** 内部不列的元素：选项、正文与图形都由元素自己代表。 */
const LEAF_TAGS: ReadonlySet<string> = new Set(["svg", "select", "textarea", "iframe", "object", "embed", "video", "audio", "canvas", "math"]);
/** overflow 不起作用的 display：行内盒与表格内部的盒不裁剪，`clientWidth` 也是 0，不能拿来建框。 */
const NO_OVERFLOW_DISPLAYS: ReadonlySet<string> = new Set(["inline", "contents", "table-row", "table-row-group", "table-header-group", "table-footer-group", "table-column", "table-column-group"]);

const FLOATING_AREA_RATIO = 0.8;

/** 不裁剪：视口外的内容能滚过来，所以起点的“看不见”框不是视口，只有滚动框是。 */
const UNBOUNDED: Box = {left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity};

export function viewportBox(document: Document): Box {
    const root = document.documentElement;
    return {left: 0, top: 0, right: root.clientWidth, bottom: root.clientHeight};
}

/** fixed 的元素：视口外的部分滚不过来，两个框都是视口。 */
function viewportClips(document: Document): Clips {
    const viewport = viewportBox(document);
    return {hard: viewport, scroll: viewport, scroller: null};
}

function expandedTargets(document: Document): Set<string> {
    const ids = new Set<string>();
    for (const trigger of document.querySelectorAll('[aria-expanded="true"][aria-controls], [aria-expanded="true"][aria-owns]')) {
        for (const attribute of ["aria-controls", "aria-owns"]) {
            for (const id of (trigger.getAttribute(attribute) ?? "").split(/\s+/u)) if (id !== "") ids.add(id);
        }
    }
    return ids;
}

/**
 * 弹出库挂在 body 下的定位外壳：body 的直接子元素、fixed 或 absolute、比视口的 80% 小。铺满视口的（整个应用的根）不算。
 */
function floatingShell(element: Element, position: string): boolean {
    const document = element.ownerDocument;
    if ((position !== "fixed" && position !== "absolute") || element.parentElement !== document.body) return false;
    const rect = element.getBoundingClientRect();
    const viewport = viewportBox(document);
    return rect.width * rect.height < FLOATING_AREA_RATIO * viewport.right * viewport.bottom;
}

export function rootContext(document: Document): WalkContext {
    const clips: Clips = {hard: UNBOUNDED, scroll: viewportBox(document), scroller: null};
    return {opacity: 1, clips, absolute: clips, fixed: null, layer: null, floating: false, expanded: expandedTargets(document)};
}

function matchesSafely(element: Element, selector: string): boolean {
    try {
        return element.matches(selector);
    } catch {
        // 浏览器不认识这个伪类（没有 popover 的旧浏览器）：按不匹配处理。
        return false;
    }
}

/**
 * 进入一个元素。交回 null 表示它与它的子树都不画出来：引擎自己的节点、`aria-hidden`、`inert`、`display: none`（含 `hidden` 属性）。
 * 每个元素都走一遍，是快照的热路径：计算样式的每次读取都不便宜，只读要用的几项。
 *
 * 层根：dialog、alertdialog、`aria-modal` 的元素总是；menu 与 listbox 只在弹出来时才是：被展开的触发器指着它，它自己是 fixed、
 * absolute 或打开的 popover，或从上一个层根往下经过了浮出来的外壳（`floatingShell`）。页面里常驻的列表框、应用里贴边的
 * fixed 侧栏里的菜单不另成一层。
 */
export function enter(element: Element, context: WalkContext): Entered | null {
    if (element.hasAttribute(OWN_NODE_ATTRIBUTE)) return null;
    if (element.getAttribute("aria-hidden") === "true" || element.hasAttribute("inert")) return null;
    const tag = element.localName;
    if (PRUNED_TAGS.has(tag)) return null;
    const document = element.ownerDocument;
    const view = document.defaultView;
    if (view === null) return null;
    const style = view.getComputedStyle(element);
    const display = style.display;
    if (display === "none") return null;

    const ownOpacity = Number.parseFloat(style.opacity);
    const opacity = context.opacity * (Number.isNaN(ownOpacity) ? 1 : ownOpacity);
    const position = style.position;
    const clips = position === "absolute" ? context.absolute : position === "fixed" ? (context.fixed ?? viewportClips(document)) : context.clips;

    const role = roleOf(element);
    const popoverOpen = element.hasAttribute("popover") && matchesSafely(element, ":popover-open");
    const floatsItself = position === "fixed" || position === "absolute" || popoverOpen;
    const layerRoot = role === "dialog" || role === "alertdialog" || element.getAttribute("aria-modal") === "true"
        || ((role === "menu" || role === "listbox") && (context.floating || floatsItself || (element.id !== "" && context.expanded.has(element.id))));
    const layer = layerRoot ? element : context.layer;
    const visibilityHidden = style.visibility === "hidden" || style.visibility === "collapse";

    if (LEAF_TAGS.has(tag)) {
        return {role, opacity, clips, layer, layerRoot, visibilityHidden, child: null};
    }

    let childClips = clips;
    // 简写一次读出两个方向（相同时只有一个词，不同时“横 纵”两个词）。html 与 body 的 overflow 作用在视口上，视口已经是起点的框。
    const overflow = style.overflow;
    if (overflow !== "visible" && !NO_OVERFLOW_DISPLAYS.has(display) && tag !== "html" && tag !== "body") {
        const scrolls = overflow.includes("auto") || overflow.includes("scroll");
        if (scrolls || overflow.includes("hidden") || overflow.includes("clip")) {
            const rect = element.getBoundingClientRect();
            const left = rect.left + element.clientLeft;
            const top = rect.top + element.clientTop;
            const inner = {left, top, right: left + element.clientWidth, bottom: top + element.clientHeight};
            childClips = scrolls
                ? {hard: clips.hard, scroll: intersect(clips.scroll, inner), scroller: element}
                : {hard: intersect(clips.hard, inner), scroll: clips.scroll, scroller: clips.scroller};
        }
    }
    // 定位的元素是 absolute 后代的包含块；带 transform 的元素还是 fixed 后代的包含块（filter、contain 同理，第一版只认 transform）。
    const transformed = style.transform !== "none";
    const floating = layerRoot ? false : context.floating || popoverOpen || floatingShell(element, position);

    return {
        role, opacity, clips, layer, layerRoot, visibilityHidden,
        child: {
            opacity,
            clips: childClips,
            absolute: position !== "static" || transformed ? childClips : context.absolute,
            fixed: transformed ? childClips : context.fixed,
            layer,
            floating,
            expanded: context.expanded,
        },
    };
}

/**
 * 从文档根重放到 `element` 的父元素，得到进入它时的上下文；某个祖先不画出来、或在不往下走的元素里时为 null。
 * 给 `scope` 起点时用；只走祖先链，比整页遍历便宜。
 */
export function contextFor(element: Element): WalkContext | null {
    const chain: Element[] = [];
    for (let current = composedParent(element); current !== null; current = composedParent(current)) chain.push(current);
    let context = rootContext(element.ownerDocument);
    for (let index = chain.length - 1; index >= 0; index -= 1) {
        const entered = enter(chain[index]!, context);
        if (entered === null || entered.child === null) return null;
        context = entered.child;
    }
    return context;
}
