/**
 * 沿组合树走一个元素时要知道的事：它看不看得见、裁剪框、所在的层（docs/specs/agent/page-agent.md 输出 3）。
 * 快照的遍历与按引用核对身份（refs）都用 `enter`，两边对“在哪一层”的判断才一致。
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

/** 走到一个元素时从祖先带下来的东西。 */
export interface WalkContext {
    /** 祖先链累乘的不透明度。 */
    readonly opacity: number;
    /** `overflow: hidden`、`clip` 的祖先裁出的框：落在框外就是看不见。 */
    readonly hard: Box;
    /** 滚动容器与视口裁出的框：落在框外是滚出去了，标 `offscreen`。 */
    readonly scroll: Box;
    /** 最近的滚动容器；null 是视口。 */
    readonly scroller: Element | null;
    /** 所在层的根；null 是底层。 */
    readonly layer: Element | null;
    /** 从上一个层根往下，是否经过了浮在页面上的小块（fixed 的弹出外壳、打开的 popover）。 */
    readonly floating: boolean;
}

export interface Entered {
    readonly role: string | null;
    readonly opacity: number;
    /** 元素自己受的裁剪：fixed 的元素不受祖先的裁剪。 */
    readonly hard: Box;
    readonly scroll: Box;
    readonly scroller: Element | null;
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
/** 浮出的外壳不超过视口这么大的一块才算“浮在页面上”：铺满视口的 fixed 外壳（整个应用）不算。 */
const FLOATING_AREA_RATIO = 0.8;

export function viewportBox(document: Document): Box {
    const root = document.documentElement;
    return {left: 0, top: 0, right: root.clientWidth, bottom: root.clientHeight};
}

/** 不裁剪：视口外的内容能滚过来，所以起点的“看不见”框不是视口，只有滚动框是。 */
const UNBOUNDED: Box = {left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity};

export function rootContext(document: Document): WalkContext {
    return {opacity: 1, hard: UNBOUNDED, scroll: viewportBox(document), scroller: null, layer: null, floating: false};
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
 * 层根：dialog、alertdialog、`aria-modal` 的元素总是；menu 与 listbox 只在浮出来时才是（它自己是 fixed、absolute 或打开的 popover，
 * 或从上一个层根往下经过了一块浮在页面上的小外壳，例如弹出库挂在 body 上的定位外壳）。页面里常驻的列表框不另成一层。
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
    if (style.display === "none") return null;

    const ownOpacity = Number.parseFloat(style.opacity);
    const opacity = context.opacity * (Number.isNaN(ownOpacity) ? 1 : ownOpacity);
    const position = style.position;
    const fixed = position === "fixed";
    const popoverOpen = element.hasAttribute("popover") && matchesSafely(element, ":popover-open");
    // fixed 的元素不受祖先的裁剪，视口外的部分也滚不过来。
    const viewport = fixed ? viewportBox(document) : null;
    const hard = viewport ?? context.hard;
    const scroll = viewport ?? context.scroll;
    const scroller = fixed ? null : context.scroller;

    const role = roleOf(element);
    const floatsItself = fixed || popoverOpen || position === "absolute";
    const layerRoot = role === "dialog" || role === "alertdialog" || element.getAttribute("aria-modal") === "true"
        || ((role === "menu" || role === "listbox") && (context.floating || floatsItself));
    const layer = layerRoot ? element : context.layer;
    const visibilityHidden = style.visibility === "hidden" || style.visibility === "collapse";

    if (LEAF_TAGS.has(tag)) {
        return {role, opacity, hard, scroll, scroller, layer, layerRoot, visibilityHidden, child: null};
    }

    let childHard = hard;
    let childScroll = scroll;
    let childScroller = scroller;
    // html 与 body 的 overflow 作用在视口上，视口已经是起点的裁剪框。
    // 简写一次读出两个方向（相同时只有一个词，不同时“横 纵”两个词）。
    const overflow = style.overflow;
    if (overflow !== "visible" && style.display !== "contents" && tag !== "html" && tag !== "body") {
        const scrolls = overflow.includes("auto") || overflow.includes("scroll");
        if (scrolls || overflow.includes("hidden") || overflow.includes("clip")) {
            const rect = element.getBoundingClientRect();
            const left = rect.left + element.clientLeft;
            const top = rect.top + element.clientTop;
            const inner = {left, top, right: left + element.clientWidth, bottom: top + element.clientHeight};
            if (scrolls) {
                childScroll = intersect(scroll, inner);
                childScroller = element;
            } else {
                childHard = intersect(hard, inner);
            }
        }
    }

    let floating = layerRoot ? false : context.floating;
    if (!layerRoot && !floating && (fixed || popoverOpen)) {
        const rect = element.getBoundingClientRect();
        const area = Math.max(0, rect.width) * Math.max(0, rect.height);
        const viewportArea = (viewport ?? viewportBox(document));
        floating = area < FLOATING_AREA_RATIO * (viewportArea.right * viewportArea.bottom);
    }

    return {
        role, opacity, hard, scroll, scroller, layer, layerRoot, visibilityHidden,
        child: {opacity, hard: childHard, scroll: childScroll, scroller: childScroller, layer, floating},
    };
}

/**
 * 从文档根重放到 `element` 的父元素，得到进入它时的上下文；某个祖先不画出来、或在不往下走的元素里时为 null。
 * 按引用核对身份与给 `scope` 起点时用；只走祖先链，比整页遍历便宜。
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

/** `element` 自己的 `enter` 结果，含祖先链的判断。 */
export function enterAt(element: Element): Entered | null {
    const context = contextFor(element);
    return context === null ? null : enter(element, context);
}
