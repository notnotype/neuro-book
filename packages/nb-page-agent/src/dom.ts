/**
 * 穿过 shadow root 的 DOM 小工具。只认 open 的 shadow root：closed 的拿不到，里面的元素对引擎就是不存在。
 */

import {OWN_NODE_ATTRIBUTE, SKIP_ATTRIBUTE, SKIP_VALUE} from "./api";

/**
 * 展平树里的父元素：分配进 slot 的元素的父是那个 slot（它画在 slot 的位置，受 slot 祖先的层与裁剪）；shadow root 里的顶层元素
 * 的父是宿主元素。
 */
export function composedParent(element: Element): Element | null {
    const slot = element.assignedSlot;
    if (slot !== null) return slot;
    if (element.parentElement !== null) return element.parentElement;
    const parent = element.parentNode;
    return parent instanceof ShadowRoot ? parent.host : null;
}

/** `ancestor` 在组合树里是不是 `node` 自己或它的祖先。 */
export function composedContains(ancestor: Element, node: Element): boolean {
    for (let current: Element | null = node; current !== null; current = composedParent(current)) {
        if (current === ancestor) return true;
    }
    return false;
}

/** 组合树里最近的、匹配选择器的祖先（含自己）。 */
export function composedClosest(element: Element, selector: string): Element | null {
    for (let current: Element | null = element; current !== null; current = composedParent(current)) {
        if (current.matches(selector)) return current;
    }
    return null;
}

/** 宿主标了 `data-nb-agent="skip"` 的区域（含自己）。 */
export function skipRegionOf(element: Element): Element | null {
    return composedClosest(element, `[${SKIP_ATTRIBUTE}="${SKIP_VALUE}"]`);
}

/**
 * 这一点上最上面的、不是引擎自己的元素，钻进 open 的 shadow root；点在视口外或什么都没有时是 null。
 * 引擎自己的节点都是带标记的 shadow 宿主，`elementFromPoint` 在宿主所在的树里交回宿主本身，所以先走单点的快路，
 * 碰到自己的宿主才取整叠元素跳过它。
 */
export function topElementAt(document: Document, x: number, y: number): Element | null {
    const view = document.defaultView;
    if (view === null || x < 0 || y < 0 || x >= view.innerWidth || y >= view.innerHeight) return null;
    let scope: Document | ShadowRoot = document;
    let found: Element | null = null;
    for (let depth = 0; depth < 16; depth += 1) {
        let hit: Element | null = scope.elementFromPoint(x, y);
        if (hit !== null && hit.hasAttribute(OWN_NODE_ATTRIBUTE)) {
            hit = scope.elementsFromPoint(x, y).find((element) => !element.hasAttribute(OWN_NODE_ATTRIBUTE)) ?? null;
        }
        if (hit === null || hit === found) break;
        found = hit;
        const shadow: ShadowRoot | null = hit.shadowRoot;
        if (shadow === null) break;
        scope = shadow;
    }
    return found;
}

/**
 * 展平树里的子元素：有 open shadow root 的宿主只交 shadow 里的（轻 DOM 的子元素经 slot 画出来，没分配的不画）；slot 交分配到
 * 它的元素，没有时交它自己的后备内容。
 */
export function flatChildren(element: Element): Element[] {
    const shadow = element.shadowRoot;
    if (shadow !== null) return [...shadow.children];
    if (element instanceof HTMLSlotElement) {
        const assigned = element.assignedElements({flatten: true});
        if (assigned.length > 0) return assigned;
    }
    return [...element.children];
}

/** 在文档与全部 open 的 shadow root 里查选择器，按组合树的先后。 */
export function deepQueryAll(root: Document | Element, selector: string): Element[] {
    const out: Element[] = [];
    const visit = (scope: Document | Element | ShadowRoot): void => {
        for (const element of scope.querySelectorAll("*")) {
            if (element.matches(selector)) out.push(element);
            if (element.shadowRoot !== null) visit(element.shadowRoot);
        }
    };
    if (root instanceof Element && root.matches(selector)) out.push(root);
    if (root instanceof Element && root.shadowRoot !== null) visit(root.shadowRoot);
    visit(root);
    return out;
}

/** 折叠空白、去掉首尾。 */
export const collapse = (text: string): string => text.replace(/\s+/gu, " ").trim();
