/**
 * 可拖动排序的分组列表（docs/specs/ui/sortable-list.md）：手势用布局拖动的会话（`drag-session.ts`），判定用核心的 `sortableSlotIn`，
 * 预览从会话的状态派生，被拖的那一行跟手。调用方自己画行，按约定写标记：
 *
 * - 列表根是定位元素（`position` 不是 `static`），行、分区头、占位的 `offsetParent` 都是它：判定按相对根的布局量；
 * - 行 `data-sortable-key`、把手 `data-sortable-handle`、分区头 `data-sortable-head`、空分区的占位 `data-sortable-placeholder`，
 *   都带 `data-sortable-section`；
 * - 行按 `preview` 的次序画（一个平铺的 `TransitionGroup` 让分区之间换序时元素不重建），被拖的那一行压掉换位过渡的 `transform`。
 *
 * 时序：会话收场时先发布空状态、再提交（`drag-gesture.ts` 的 `finish`），都在同一个同步段里，预览从“拖动中的结果”换成“等写入的
 * 结果”中间没有渲染，不闪回旧次序。跟手的 `translate` 在 Vue 按新预览排好 DOM 之后读布局再写（`flush: "post"`），不经响应式；
 * 收场时的落回在会话的 `onActiveChange` 里同步做。
 */

import {computed, nextTick, ref, shallowRef, watch} from "vue";
import type {ComputedRef, Ref} from "vue";

import type {DragState} from "../drag-gesture";
import type {GridDropPoint} from "../grid-drop";
import {moveInSections, slotOfKey, sortableSlotIn, sortableSlots} from "../sortable";
import type {SortableAxis, SortableLayout, SortableSection, SortableSlot, SortableSpan, SortableSwitch} from "../sortable";
import {createDragSession} from "./drag-session";
import type {DragSession} from "./drag-session";
import {layoutDurationMs} from "./layout-vars";
import {useLayoutText} from "./layout-text";

export interface SortableMove {
    readonly key: string;
    readonly from: SortableSlot;
    readonly to: SortableSlot;
}

export interface UseSortableOptions {
    readonly root: Readonly<Ref<HTMLElement | null>>;
    readonly sections: () => readonly SortableSection[];
    /** 缺省 `vertical`。 */
    readonly axis?: SortableAxis;
    readonly disabled?: () => boolean;
    /** 一项的名字：把手的可访问名与播报用。 */
    readonly label: (key: string) => string;
    /** 分区的名字：播报用。 */
    readonly sectionLabel: (section: string) => string;
    /** 放下且位置变了才调，一场至多一次。返回 Promise 时，放下后的次序留到它 settle，这段时间不能再拿起。 */
    readonly onMove: (move: SortableMove) => void | PromiseLike<unknown>;
}

export interface SortableHandle {
    /** 拖动中与等写入时是放下后的样子，其余时间等于 `sections()`。 */
    readonly preview: ComputedRef<readonly SortableSection[]>;
    /** 被拿起的那一项：从拿起到它滑回自己的位置为止。 */
    readonly held: Readonly<Ref<string | null>>;
    /** 读屏播报的一句，只在语义变化时换。 */
    readonly announcement: Readonly<Ref<string>>;
}

/** 按在这些控件上不起拖：它们自己有点击的事。把手除外。 */
const INTERACTIVE = "button, input, select, textarea, a[href], [contenteditable='true'], [contenteditable=''], [data-sortable-ignore]";

const isThenable = (value: unknown): value is PromiseLike<unknown> => typeof (value as PromiseLike<unknown> | null)?.then === "function";

export function useSortable(options: UseSortableOptions): SortableHandle {
    const t = useLayoutText();
    const vertical = (options.axis ?? "vertical") === "vertical";
    const session = shallowRef<DragSession<string, SortableSlot> | null>(null);
    const pending = shallowRef<readonly SortableSection[] | null>(null);
    const held = ref<string | null>(null);
    const announcement = ref("");

    const state = computed<DragState<string, SortableSlot> | null>(() => session.value?.state.value ?? null);
    const preview = computed(() => {
        const current = state.value;
        if (current !== null && current.drop !== null) return moveInSections(options.sections(), current.source, current.drop);
        return pending.value ?? options.sections();
    });

    /** 拿起时这一项在哪：放回这里不提交。 */
    let origin: SortableSlot | null = null;
    /** 抓住的点到行前沿的距离：拿起时定，这一场不变。 */
    let grab = 0;
    /** 这一场上一次换位：判定的粘滞要用（`SORTABLE_STICKY_PX`）。判定时记下，拿起时清空。 */
    let lastSwitch: SortableSwitch | null = null;
    /** 最近一次按下的指针类型：触摸只从把手起拖。 */
    let pointerType = "mouse";
    /** 键盘一场的停靠位置：点只是下标的载体（会话把同一个点对象交回判定），判定按下标取位置。 */
    let keyboardStops: {readonly points: GridDropPoint[]; readonly slots: SortableSlot[]} | null = null;
    let landing: ReturnType<typeof setTimeout> | null = null;

    const blocked = (): boolean => options.disabled?.() === true || pending.value !== null;
    const name = (key: string): string => options.label(key);
    const where = (slot: SortableSlot) => ({section: options.sectionLabel(slot.section), index: slot.index + 1});

    // ─── 量布局：相对列表根，不含正在走的位移（offsetTop 不受 transform、translate 影响） ───

    function offsetAlong(element: HTMLElement, root: HTMLElement): number {
        let position = 0;
        let node: HTMLElement | null = element;
        while (node !== null && node !== root) {
            position += vertical ? node.offsetTop : node.offsetLeft;
            node = node.offsetParent as HTMLElement | null;
        }
        return position;
    }
    function spanOf(element: HTMLElement, root: HTMLElement): SortableSpan {
        const start = offsetAlong(element, root);
        return {start, end: start + (vertical ? element.offsetHeight : element.offsetWidth)};
    }
    function pointerAlong(point: GridDropPoint, root: HTMLElement): number {
        const box = root.getBoundingClientRect();
        return vertical ? point.y - box.top - root.clientTop + root.scrollTop : point.x - box.left - root.clientLeft + root.scrollLeft;
    }
    function itemOf(root: HTMLElement, key: string): HTMLElement | null {
        for (const element of root.querySelectorAll<HTMLElement>("[data-sortable-key]")) {
            if (element.dataset.sortableKey === key) return element;
        }
        return null;
    }
    /** 这一刻的布局与可拖的范围（第一个元素的前沿到最后一个元素、含占位的后沿）。 */
    function measure(root: HTMLElement): {readonly layout: SortableLayout; readonly extent: SortableSpan} {
        const sections = options.sections().map((section) => ({id: section.id, head: null as SortableSpan | null, members: [] as {key: string; span: SortableSpan}[]}));
        let extent: SortableSpan | null = null;
        for (const element of root.querySelectorAll<HTMLElement>("[data-sortable-head], [data-sortable-key], [data-sortable-placeholder]")) {
            const span = spanOf(element, root);
            extent = extent === null ? span : {start: Math.min(extent.start, span.start), end: Math.max(extent.end, span.end)};
            const section = sections.find((entry) => entry.id === element.dataset.sortableSection);
            if (section === undefined) continue;
            if (element.hasAttribute("data-sortable-head")) section.head = span;
            else if (element.dataset.sortableKey !== undefined) section.members.push({key: element.dataset.sortableKey, span});
        }
        return {layout: {sections}, extent: extent ?? {start: 0, end: 0}};
    }
    /** 被拖的那一行此刻该在哪（指针推出来、夹在范围里）。 */
    function heldSpan(root: HTMLElement, element: HTMLElement, point: GridDropPoint, extent: SortableSpan): SortableSpan {
        const size = vertical ? element.offsetHeight : element.offsetWidth;
        const start = Math.min(Math.max(pointerAlong(point, root) - grab, extent.start), Math.max(extent.start, extent.end - size));
        return {start, end: start + size};
    }

    // ─── 拿起的行：跟手与落回 ───

    function finishLanding(): void {
        if (landing !== null) clearTimeout(landing);
        landing = null;
        const root = options.root.value;
        const key = held.value;
        const element = root === null || key === null ? null : itemOf(root, key);
        element?.style.removeProperty("translate");
        element?.style.removeProperty("transition");
        held.value = null;
    }
    /** 写在元素上的跟手位移（沿轴）。 */
    function translateAlong(element: HTMLElement): number {
        const parts = element.style.translate.split(" ").map((part) => Number.parseFloat(part));
        const value = vertical ? parts[1] : parts[0];
        return value !== undefined && Number.isFinite(value) ? value : 0;
    }
    /**
     * 一场结束：被拖的那一行从跟手的位置滑回它的位置（`--nb-layout-motion-move`），滑完才算放下了；减少动效时令牌为 0，直接到位。收场后预览
     * 可能换成别的次序（取消、放下的位置与最后显示的不同），所以等 Vue 按新次序排好，再按排好后的位置换算起点，从看到的地方滑回。
     */
    function land(root: HTMLElement): void {
        const key = held.value;
        const element = key === null ? null : itemOf(root, key);
        // 没写过跟手位移（键盘拿起放下）就没有要滑回的：直接收尾。没写过时 `translate` 是空串，不支持这个属性的 DOM 实现里是 undefined。
        if (element === null || !element.style.translate) {
            finishLanding();
            return;
        }
        const ms = layoutDurationMs(element, "--nb-layout-motion-move");
        if (ms <= 0) {
            finishLanding();
            return;
        }
        const seen = element.getBoundingClientRect();
        const seenAlong = vertical ? seen.top : seen.left;
        void nextTick(() => {
            // 这期间又拿起了别的（或卸载了）：那边已经收拾过这一行。
            if (held.value !== key || !element.isConnected) return;
            const now = element.getBoundingClientRect();
            const start = translateAlong(element) + seenAlong - (vertical ? now.top : now.left);
            element.style.transition = "none";
            element.style.translate = vertical ? `0px ${String(start)}px` : `${String(start)}px`;
            void element.offsetHeight;
            element.style.transition = "translate var(--nb-layout-motion-move, 280ms) var(--nb-layout-ease-layout, cubic-bezier(0.23, 1, 0.32, 1))";
            element.style.translate = vertical ? "0px 0px" : "0px";
            landing = setTimeout(finishLanding, ms);
        });
    }

    watch(state, (current) => {
        const root = options.root.value;
        if (root === null || current === null || current.keyboard) return;
        const element = itemOf(root, current.source);
        if (element === null) return;
        // 先读（布局、指针），再写一次 translate。Vue 重渲染这一行时不碰 style（行上没有绑定 style），写过的值留着。
        const {extent} = measure(root);
        const offset = Math.round((heldSpan(root, element, current.point, extent).start - offsetAlong(element, root)) * 100) / 100;
        const value = vertical ? `0px ${String(offset)}px` : `${String(offset)}px`;
        if (element.style.translate !== value) element.style.translate = value;
    }, {flush: "post"});

    // ─── 播报 ───

    let announced = "";
    watch(() => state.value?.drop ?? null, (drop) => {
        if (drop === null || state.value === null) return;
        const key = `${drop.section}\n${String(drop.index)}`;
        if (key === announced) return;
        announced = key;
        announcement.value = t("sortable.moved", where(drop));
    });

    // ─── 会话 ───

    watch(options.root, (root, _previous, onCleanup) => {
        if (root === null) return;
        const notePointer = (event: PointerEvent): void => {
            pointerType = event.pointerType;
        };
        // 根上的捕获监听，一定先于会话在根上的冒泡按下监听（`sourceAt` 在那里读它）。
        root.addEventListener("pointerdown", notePointer, true);
        const created = createDragSession<string, SortableSlot, "list">({
            root,
            sourceAt: (target) => {
                if (blocked()) return null;
                const row = target.closest<HTMLElement>("[data-sortable-key]");
                if (row === null || !root.contains(row)) return null;
                const onHandle = target.closest("[data-sortable-handle]") !== null;
                if (pointerType === "touch" && !onHandle) return null;
                const control = target.closest(INTERACTIVE);
                if (!onHandle && control !== null && row.contains(control)) return null;
                return row.dataset.sortableKey ?? null;
            },
            activate: (source, _keyboard, at) => {
                if (blocked()) return false;
                finishLanding();
                origin = slotOfKey(options.sections(), source);
                if (origin === null) return false;
                const element = itemOf(root, source);
                if (at !== null && element !== null) {
                    const box = element.getBoundingClientRect();
                    grab = vertical ? at.pressed.y - box.top : at.pressed.x - box.left;
                }
                held.value = source;
                lastSwitch = null;
                announced = `${origin.section}\n${String(origin.index)}`;
                announcement.value = t("sortable.picked", {name: name(source), ...where(origin)});
                return true;
            },
            commitsUnderPointer: () => true,
            structure: () => JSON.stringify(options.sections()),
            resolve: ({source, point, region}) => {
                if (region !== null) {
                    const at = keyboardStops?.points.indexOf(point) ?? -1;
                    return at >= 0 ? keyboardStops!.slots[at]! : null;
                }
                const element = itemOf(root, source);
                if (element === null) return null;
                const {layout, extent} = measure(root);
                const span = heldSpan(root, element, point, extent);
                const slot = sortableSlotIn(layout, source, span, lastSwitch);
                // 记下换位（会话允许判定时记粘滞要的状态）：来源此刻的位置从量到的布局读，就是上一次发布的预览。
                const now = slotOfKey(layout.sections.map((section) => ({id: section.id, keys: section.members.map((member) => member.key)})), source);
                if (slot !== null && now !== null && (slot.section !== now.section || slot.index !== now.index)) lastSwitch = {from: now, to: slot, at: span.start};
                return slot;
            },
            actionKey: (drop) => origin !== null && drop.section === origin.section && drop.index === origin.index ? null : `${drop.section}\n${String(drop.index)}`,
            commit: (drop, source) => {
                const from = origin;
                if (from === null) return;
                announcement.value = t("sortable.dropped", {name: name(source), ...where(drop)});
                const result = options.onMove({key: source, from, to: drop});
                if (!isThenable(result)) return;
                const waiting = moveInSections(options.sections(), source, drop);
                pending.value = waiting;
                // 只清自己这一次：settle 之前不能再拿起，所以不会有更新的一份。失败的 Promise 照样往外抛，宿主自己报告原因。
                const settle = (): void => {
                    if (pending.value === waiting) pending.value = null;
                };
                void result.then(settle, (error: unknown) => {
                    settle();
                    throw error;
                });
            },
            // 收场时同步落回，不等状态的监听：同一拍里拿起又放下（键盘连按）时监听前后看到的都是空，不会触发。宿主中止（`abort`）也走这里。
            onActiveChange: (active) => {
                if (!active) land(root);
            },
            onEnd: (end, last) => {
                if (end.kind === "committed") return;
                // 放回原位是放下，不是取消。
                announcement.value = end.kind === "no-action" && origin !== null
                    ? t("sortable.unchanged", {name: name(last.source), ...where(origin)})
                    : t("sortable.cancelled", {name: name(last.source)});
            },
            keyboard: {
                sourceAt: (target) => {
                    if (target.closest("[data-sortable-handle]") === null) return null;
                    const row = target.closest<HTMLElement>("[data-sortable-key]");
                    return row !== null && root.contains(row) ? row.dataset.sortableKey ?? null : null;
                },
                regions: (source) => {
                    if (blocked()) return [];
                    const slots = sortableSlots(options.sections(), source);
                    keyboardStops = {slots, points: slots.map((_, index) => ({x: 0, y: index}))};
                    return ["list"];
                },
                stops: () => ({axis: vertical ? "vertical" : "horizontal", points: keyboardStops?.points ?? []}),
                start: (source) => {
                    const from = slotOfKey(options.sections(), source);
                    const at = from === null ? 0 : (keyboardStops?.slots.findIndex((slot) => slot.section === from.section && slot.index === from.index) ?? 0);
                    return {region: 0, at: Math.max(0, at)};
                },
                refocus: (source) => itemOf(root, source)?.querySelector<HTMLElement>("[data-sortable-handle]") ?? null,
            },
        });
        session.value = created;
        onCleanup(() => {
            created.dispose();
            root.removeEventListener("pointerdown", notePointer, true);
            if (session.value === created) session.value = null;
            finishLanding();
        });
    }, {immediate: true});

    // 一场进行中变成不可用（例如设置层变得写不了）：整场中止，零提交。
    watch(() => options.disabled?.() === true, (disabled) => {
        if (disabled && state.value !== null) session.value?.abort();
    });

    return {preview, held, announcement};
}
