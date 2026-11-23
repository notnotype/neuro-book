/**
 * 拖详情换边（docs/specs/story/viewer.md 输出 68）：两张都在时按住头部拖，在另一张上松手对调。从 `BookFrame` 搬出来，
 * 判定逻辑不碰挂载也读得懂；BookFrame 只接线。
 *
 * 会话的根是包着网格的那一层：内容层是网格根的子元素，两张不在同一块叶里。选项只在建会话时读一次，里面读的响应式值每次调用时现读。
 * 有动效时是实时布局（nb-layout 的 `useLiveDragSession`）：被拖的那张拿起跟手，在另一张上停稳后预览就是对调后的样子，回到自己那一半是原位；
 * 减少动效时会话照常是落点指示：另一张上盖一层“与这一张对调”，标题小块跟手。
 */
import type {GridDropRect} from "@notnotype/nb-layout";
import {useLiveDragSession} from "@notnotype/nb-layout/vue";
import type {LiveDragHost, LiveDragSessionOptions} from "@notnotype/nb-layout/vue";
import {computed, ref} from "vue";
import type {Ref} from "vue";

/** 落点：另一张（松手对调）；实时布局里回到自己那一半是原位（不提交）。 */
type SwapDrop = {readonly key: number; readonly rect: GridDropRect; readonly inPlace?: true};
/** 实时布局判定的几何：两张拿起时的矩形（视口坐标）。预览把另一张换到这边以后现量的话，指针下就不是它了，候选会来回换。 */
type SwapRects = ReadonlyMap<number, GridDropRect>;

const inside = (rect: GridDropRect, point: {readonly x: number; readonly y: number}): boolean => point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;

export interface DetailSwapDragOptions {
    /** 包着网格的那一层：会话的根。 */
    readonly gridBox: Readonly<Ref<HTMLElement | null>>;
    /** 引擎要的网格（`NestedGrid` 的实例）。 */
    readonly grid: LiveDragSessionOptions<number, SwapDrop, never, number, SwapRects>["grid"];
    /** 此刻看得见的详情；换张数、关掉一张时整场取消。 */
    readonly shownDetails: Readonly<Ref<readonly {readonly key: number}[]>>;
    /** 预览的是对调之后的样子：两张换叶，会话的 `details` 不动（结构键读它，预览不改结构键）。宿主的内容层读它，所以宿主建、这里写。 */
    readonly swapPreviewed: Ref<boolean>;
    /** 一张详情的外壳元素。 */
    readonly shellOf: (key: number) => HTMLElement | null;
    /** 松手对调：参数是被拖的那张。 */
    readonly swap: (key: number) => void;
}

export function useDetailSwapDrag({gridBox, grid, shownDetails, swapPreviewed, shellOf, swap}: DetailSwapDragOptions) {
    // DOMRect 本身就有 left、top、right、bottom，不必抄成新对象；引擎与落点盖层只按字段读它。
    const shellRect = (key: number): GridDropRect | null => shellOf(key)?.getBoundingClientRect() ?? null;
    function measureShells(): SwapRects {
        return new Map(shownDetails.value.flatMap((item) => {
            const rect = shellRect(item.key);
            return rect === null ? [] : [[item.key, rect] as const];
        }));
    }
    /** 被拖的那张的标题：过门槛时从它的把手上取一次，落点指示时跟手的小块写它。 */
    const dragTitle = ref("");
    const swapHost: LiveDragHost<number, SwapDrop, SwapRects> = {
        facts: (_source, drop) => ({key: drop.inPlace === true ? "in-place" : `swap:${String(drop.key)}`, inPlace: drop.inPlace === true, home: false, slotOnScreen: null}),
        show: (target) => {
            swapPreviewed.value = target?.kind === "drop" && target.drop.inPlace !== true;
            return swapPreviewed.value;
        },
        measure: () => measureShells(),
        // 对调不摘掉来源：收起来源不改判定的几何。
        collapsed: () => null,
        card: {
            key: (source) => `detail-${String(source)}`,
            rect: (source, _container, geometry) => geometry.get(source) ?? null,
            // 卡片里是人物卡、原文与节点图，按卡片的大小重排不便宜：缩小一点，尺寸每秒至多写 30 次。
            compact: {width: 320, height: 240},
            refreshMs: () => 1000 / 30,
        },
    };
    const {state: swapDrag, liveState: swapLive, lifted: liftedDetail, dragging} = useLiveDragSession<number, SwapDrop, never, number, SwapRects>(gridBox, (live) => ({
        sourceAt: (target) => {
            if (shownDetails.value.length < 2 || target.closest("button, input, a, [role='menu'], [role='menuitem'], [role='tab']") !== null) return null;
            const shell = target.closest("[data-detail-handle]")?.closest<HTMLElement>("[data-detail-key]");
            return shell === null || shell === undefined ? null : Number(shell.dataset.detailKey);
        },
        activate: (source: number) => {
            dragTitle.value = shellOf(source)?.querySelector("[data-detail-handle]")?.textContent?.trim() ?? "";
            return true;
        },
        live: (source) => source,
        host: swapHost,
        grid,
        // 拖着的时候详情变了（关掉一张、换了内容）整场取消（ui/layout-drag 输出 7）。
        structure: () => shownDetails.value.map((item) => item.key).join(","),
        resolve: ({source, point}) => {
            const other = shownDetails.value.find((item) => item.key !== source);
            if (other === undefined) return null;
            // 实时布局用拿起时的几何（引擎量到之前这一次现量）；落点指示每次现量。
            const rects = live.state().active ? (live.geometry() ?? measureShells()) : null;
            const own = rects?.get(source);
            if (own !== undefined && inside(own, point)) return {key: source, rect: own, inPlace: true};
            const rect = rects === null ? shellRect(other.key) : (rects.get(other.key) ?? null);
            return rect !== null && inside(rect, point) ? {key: other.key, rect} : null;
        },
        actionKey: (drop) => (drop.inPlace === true ? null : `swap:${String(drop.key)}`),
        commit: (_drop, source) => swap(source),
    }));
    /** 落点指示的盖层：只在不是实时布局时画（实时布局里反馈就是布局本身）。 */
    const swapPreview = computed(() => {
        const drop = swapDrag.value?.drop;
        return swapLive.value.active || drop === null || drop === undefined ? null : {areaRect: drop.rect, indicator: null, orientation: "horizontal" as const};
    });
    return {swapDrag, swapLive, liftedDetail, dragging, swapPreview, dragTitle};
}
