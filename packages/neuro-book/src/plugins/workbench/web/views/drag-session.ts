/**
 * 外壳的拖放（docs/specs/ui/workbench-shell.md 外壳三输出 19–23）：装在外壳根上。手势是 nb-layout 的拖动会话
 * （docs/specs/ui/layout-drag.md），这里只给来源、判定与键盘的区域：拖动源与落点由组件写的 DOM 标记声明（`drop-dom.ts`），
 * 判定是纯函数 `resolveDrop`，提交经调用方给的 `commit`（布局 store 的 `applyView`）。
 *
 * 拿起时冻结拖动源与布局代次（`layoutKeyOf`），并生成这场拖动建自建容器用的 id 与预备区；之后布局代次变了，整场取消。
 *
 * 由旧应用 `useWorkbenchDrag.ts` 与 `useWorkbenchDrop.ts`（已人工验证）改写；手势不再经拖动库（取舍见 t67 计划）。
 */

import {computed} from "vue";
import type {ComputedRef} from "vue";

import {createDragSession} from "@notnotype/nb-layout/vue";
import type {GridDropPoint} from "@notnotype/nb-layout";

import {dropActionKey, layoutKeyOf, resolveDrop} from "./drop";
import type {DropDecision, DropRects, DropSource} from "./drop";
import {containerHostIn, dragSourceAt, dropHitAt, entryIn, keyboardRegions, keyboardStops, readContentRects, readDropRect, readSwitcherRects, revealAt, sectionIn} from "./drop-dom";
import type {RevealZoneRect} from "./drop-dom";
import {customContainerId} from "./placement";
import type {ViewCatalog} from "./placement";
import type {Presentation} from "./presentation";

export interface ShellDragOptions {
    /** 外壳根：拖动源与落点只认这里面的。 */
    readonly root: HTMLElement;
    presentation(): Presentation;
    catalog(): ViewCatalog;
    /** 布局可写时为真；否则不起拖。 */
    enabled(): boolean;
    /** 拿起时浮出的预备区（此刻没显示的 Part 显示出来会在的矩形）；整场拖动不变。缺省没有。 */
    revealZones?(): ReadonlyArray<RevealZoneRect>;
    /** 提交一次已显示过的动作：意图、落在预备区时要同次显示的 Part（`reveal`），以及松手时的预览（收尾从那里开始）。 */
    commit(decision: Extract<DropDecision, {kind: "commit"}>): void;
}

/** 进行中的拖动：拖影与落点反馈只读它。 */
export interface ShellDragState {
    readonly source: DropSource;
    /** 拖影所在的视口坐标：指针拖动是指针，键盘拖动是当前位置。 */
    readonly point: GridDropPoint;
    /** 这一次的判定；没有命中任何落点为 null。 */
    readonly decision: DropDecision | null;
    readonly keyboard: boolean;
    /** 这场拖动浮出的预备区。 */
    readonly zones: ReadonlyArray<RevealZoneRect>;
}

export interface ShellDrag {
    readonly state: ComputedRef<ShellDragState | null>;
    dispose(): void;
}

/** 键盘能去的区域：真实落点的元素，或预备区（排在真实落点之后）。 */
type KeyboardRegion = {readonly kind: "element"; readonly element: HTMLElement} | {readonly kind: "zone"; readonly zone: RevealZoneRect};

/** 拖动源 → 冻结的 `DropSource`；不可移动的视图、过期的标记不起拖（不出现“拿起了却落不下去”）。 */
function freezeSource(presentation: Presentation, catalog: ViewCatalog, viewId: string | null, containerId: string | null): DropSource | null {
    const layoutKey = layoutKeyOf(presentation);
    if (viewId !== null) {
        if (catalog.get(viewId)?.movable === false) return null;
        for (const container of presentation.containers.values()) {
            if (container.views.some((view) => view.id === viewId)) return {kind: "view", viewId, containerId: container.id, part: container.part, layoutKey};
        }
        return null;
    }
    const container = containerId === null ? undefined : presentation.containers.get(containerId);
    if (container === undefined) return null;
    return {kind: "container", containerId: container.id, part: container.part, viewIds: [...container.members], layoutKey};
}

export function createShellDrag(options: ShellDragOptions): ShellDrag {
    const {root} = options;
    /** 拿起时冻结的：这场拖动建自建容器用的 id 与预备区。一个会话同一时间只有一场。 */
    let frozen: {readonly newContainerId: string; readonly zones: ReadonlyArray<RevealZoneRect>} = {newContainerId: "", zones: []};

    const partOf = (containerId: string) => options.presentation().containers.get(containerId)?.part ?? null;

    const sourceOf = (found: ReturnType<typeof dragSourceAt>): DropSource | null => (found === null || !options.enabled() ? null : freezeSource(options.presentation(), options.catalog(), found.viewId, found.containerId));

    const session = createDragSession<DropSource, DropDecision, KeyboardRegion>({
        root,
        sourceAt: (target) => sourceOf(dragSourceAt(root, target)),
        activate: (source) => {
            if (layoutKeyOf(options.presentation()) !== source.layoutKey) return false;
            frozen = {newContainerId: customContainerId(crypto.randomUUID()), zones: options.revealZones?.() ?? []};
            return true;
        },
        structure: () => layoutKeyOf(options.presentation()),
        resolve: ({source, point, top, region}) => {
            const presentation = options.presentation();
            const sourceHost = containerHostIn(root, source.containerId);
            const sourceContent = sourceHost === null ? null : readContentRects(sourceHost);
            // 键盘停在预备区上就是它（预备区可能叠在真实落点上，按中心命中会落到下面去）；指针先认真实落点，落空才找预备区。
            const hit = region?.kind === "zone" ? null : dropHitAt(root, top, partOf);
            const zone = region?.kind === "zone" ? region.zone : hit === null ? revealAt(root, top, point, frozen.zones) : null;
            const common = {source, point, presentation, catalog: options.catalog(), layoutKey: source.layoutKey, newContainerId: frozen.newContainerId};
            if (zone !== null) return resolveDrop({...common, target: {kind: "reveal", part: zone.part}, rects: {sourceContent, reveal: zone.rect}});
            if (hit === null) return null;
            const rects: DropRects = {
                sourceContent,
                ...(hit.target.kind === "switcher" ? {switcher: readSwitcherRects(hit.element, hit.target.part)}
                    : hit.target.kind === "empty" ? {empty: readDropRect(hit.element)}
                        : {content: readContentRects(hit.element)}),
            };
            return resolveDrop({...common, target: hit.target, rects});
        },
        actionKey: dropActionKey,
        commit: (decision) => {
            if (decision.kind === "commit") options.commit(decision);
        },
        // 拖动中的光标与禁选在全局样式里按这个标记生效。
        onActiveChange: (active) => root.ownerDocument.documentElement.toggleAttribute("data-workbench-dragging", active),
        keyboard: {
            // 焦点要在拖动源本身或它的把手上；源里别的控件（收起开关）保留自己的空格。
            sourceAt: (target) => {
                const found = dragSourceAt(root, target);
                return found !== null && (target === found.element || target.hasAttribute("data-drag-handle")) ? sourceOf(found) : null;
            },
            // 预备区排在真实落点之后，按侧栏、右栏、面板的顺序（求出来就是这个顺序）。
            regions: () => [
                ...keyboardRegions(root, partOf).map((element) => ({kind: "element" as const, element})),
                ...frozen.zones.map((zone) => ({kind: "zone" as const, zone})),
            ],
            stops: (region) => {
                if (region.kind === "element") return keyboardStops(region.element);
                // 预备区只有中心一个位置。
                const {rect} = region.zone;
                return {axis: null, points: [{x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2}]};
            },
            // 从源自己的原位开始，直接 Enter 是无操作：容器源是它在条目带上的条目的前缘，视图源是它自己分节里的位置。都找不到
            // （源条目不可见）时停在源的中心，不落到区域的第一个位置（那是一次真实的移动）。
            start: (source, regions, origin) => {
                const home = source.kind === "container"
                    ? root.querySelector(`[data-switcher-entry="${CSS.escape(source.containerId)}"]`)?.closest("[data-switcher-band]")
                    : containerHostIn(root, source.containerId);
                const region = Math.max(0, regions.findIndex((candidate) => candidate.kind === "element" && candidate.element === home));
                const start = regions[region] as KeyboardRegion;
                const element = start.kind === "element" ? start.element : null;
                const own = (element === null ? null : source.kind === "view" ? sectionIn(element, source.viewId) : entryIn(element, source.containerId)) ?? origin;
                const box = own.getBoundingClientRect();
                const points = start.kind === "element" ? keyboardStops(start.element).points : [];
                const at = points.findIndex((point) => point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom);
                return {region, at: at !== -1 ? at : {x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2}};
            },
            // 提交后拿起时的元素可能随重渲染换掉了（标签迁到别的标签带、视图进了别的容器）：按同一个源的标记找新元素，视图标题找里面的把手。
            refocus: (source) => {
                const selector = source.kind === "view" ? `[data-drag-view="${CSS.escape(source.viewId)}"]` : `[data-drag-container="${CSS.escape(source.containerId)}"]`;
                const next = root.querySelector<HTMLElement>(selector);
                return next?.querySelector<HTMLElement>("[data-drag-handle]") ?? next;
            },
        },
    });

    return {
        state: computed(() => {
            const current = session.state.value;
            return current === null ? null : {source: current.source, point: current.point, decision: current.drop, keyboard: current.keyboard, zones: frozen.zones};
        }),
        dispose: () => session.dispose(),
    };
}
