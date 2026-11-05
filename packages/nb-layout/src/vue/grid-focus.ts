/**
 * Grid 的焦点走法（docs/specs/ui/nested-grid.md 的“Tab 顺序”“移动焦点”）。DOM 序与树序不一致时，浏览器的 Tab 按 DOM 走，和屏幕上的
 * 先后对不上，所以由这里接管；一致时全是浏览器的原生行为，出错的面小。
 *
 * 外层 grid 经 DOM 找（`closest`），不用 `inject`：外壳的内容是 Teleport 进叶的，组件树上不在外层 `NestedGrid` 下面。
 */

import {tabbable} from "tabbable";


export interface GridFocusItems {
    /** 树序的叶外框与分隔线元素；`leaf` 为假的不是 `moveGridFocus` 的落点。 */
    items(): ReadonlyArray<{readonly element: HTMLElement; readonly leaf: boolean}>;
}

/** 每个 grid 根的焦点入口：`moveGridFocus` 从里往外走时用。 */
const scopes = new WeakMap<Element, GridFocusItems>();
/** 每块上次的焦点：`moveGridFocus` 回到这块时还给它。 */
const lastFocused = new WeakMap<HTMLElement, HTMLElement>();

export function registerGridFocus(root: Element, scope: GridFocusItems): () => void {
    scopes.set(root, scope);
    return () => scopes.delete(root);
}

function focusablesIn(element: HTMLElement): HTMLElement[] {
    return tabbable(element, {includeContainer: true}) as HTMLElement[];
}

/** 焦点元素走到这一项的头或尾了。它不在列表里时（`tabindex="-1"` 的容器、可滚动区）按文档位置判断。 */
function atEdge(focusables: ReadonlyArray<HTMLElement>, target: Element, direction: 1 | -1): boolean {
    const beyond = direction > 0 ? Node.DOCUMENT_POSITION_FOLLOWING : Node.DOCUMENT_POSITION_PRECEDING;
    return !focusables.some((element) => element !== target && (target.compareDocumentPosition(element) & beyond) !== 0);
}

/**
 * Tab 走出一项时按树序找下一项。返回 `"leave"` 表示走完了，调用方把焦点放到边上的哨兵，由浏览器移到 grid 外面；`"browser"` 是还没走
 * 到头或内容自己处理，不管。
 */
export function moveTab(event: KeyboardEvent, scope: GridFocusItems): "moved" | "leave" | "browser" {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return "browser";
    // 输入法组字时 Tab 用来翻候选。
    if (event.isComposing || event.keyCode === 229) return "browser";
    if (!(event.target instanceof Element)) return "browser";
    const target = event.target;
    const items = scope.items();
    const from = items.findIndex(({element}) => element.contains(target));
    const current = items[from];
    if (current === undefined) return "browser";
    const direction = event.shiftKey ? -1 : 1;
    if (!atEdge(focusablesIn(current.element), target, direction)) return "browser";
    const next = nextFocusStop({count: items.length, from, direction, wrap: false, focusable: (index) => focusablesIn((items[index] as {element: HTMLElement}).element).length > 0});
    if (next === null) return "leave";
    event.preventDefault();
    const candidates = focusablesIn((items[next] as {element: HTMLElement}).element);
    (direction > 0 ? candidates[0] : candidates.at(-1))?.focus();
    return "moved";
}

/** 记下这一块的焦点。外层 grid 也会收到，同一个元素分别记在内外两层的块上。 */
export function noteFocus(scope: GridFocusItems, target: EventTarget | null): void {
    if (!(target instanceof HTMLElement)) return;
    const owner = scope.items().find(({element, leaf}) => leaf && element.contains(target));
    if (owner !== undefined) lastFocused.set(owner.element, target);
}

/**
 * 在叶之间按树序移动焦点：从 `from` 所在的 grid 开始，走到头交给外层，最外层绕回。`container` 是宿主已知的、包着 grid 的元素（或 grid 根本身）。返回是否移动了。
 */
export function moveGridFocus(container: Element | null, direction: "next" | "previous"): boolean {
    const step = direction === "next" ? 1 : -1;
    // 焦点在 `container` 里就从那一块往外走；不在（页面根、菜单）就从 `container` 里第一个 grid 的第一块（往前走时最后一块）开始。
    const active = container?.ownerDocument.activeElement ?? null;
    let from: Element | null = active !== null && container?.contains(active) === true ? active : null;
    let root: Element | null = from?.closest("[data-grid-scope]") ?? container?.querySelector("[data-grid-scope]") ?? container?.closest("[data-grid-scope]") ?? null;
    if (root !== null && from !== null && !root.contains(from)) from = null;
    while (root !== null) {
        const outer = root.parentElement?.closest("[data-grid-scope]") ?? null;
        const scope = scopes.get(root);
        if (scope !== undefined) {
            const items = scope.items();
            const index = from === null ? -1 : items.findIndex(({element}) => element.contains(from));
            const next = nextFocusStop({
                count: items.length,
                from: index === -1 ? (step > 0 ? -1 : items.length) : index,
                direction: step,
                wrap: outer === null,
                focusable: (candidate) => {
                    const item = items[candidate];
                    return item !== undefined && item.leaf && focusablesIn(item.element).length > 0;
                },
            });
            const target = next === null ? undefined : items[next];
            if (target !== undefined) {
                const last = lastFocused.get(target.element);
                const focusables = focusablesIn(target.element);
                (last !== undefined && focusables.includes(last) ? last : focusables[0])?.focus();
                return true;
            }
        }
        root = outer;
    }
    return false;
}

/**
 * 按树序找下一个能停的项：跳过没有可聚焦元素的。`wrap` 为假时走到头返回 null（Tab 离开这个 grid）；为真时绕回（最外层的
 * `moveGridFocus`），都没有返回 null。
 */
export function nextFocusStop(input: {readonly count: number; readonly from: number; readonly direction: 1 | -1; readonly wrap: boolean; focusable(index: number): boolean}): number | null {
    const {count, from, direction, wrap, focusable} = input;
    for (let step = 1; step <= count; step += 1) {
        const raw = from + direction * step;
        if (!wrap && (raw < 0 || raw >= count)) return null;
        const index = ((raw % count) + count) % count;
        if (focusable(index)) return index;
    }
    return null;
}
