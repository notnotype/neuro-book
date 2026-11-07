/**
 * 实时布局的预览（docs/specs/ui/workbench-layout.md“实时布局”）：判定照旧由 `layout-drag` 做，这里把候选变成预览。候选稳定不稳定要逐帧看：指针不动时手势不发布，所以这一场有自己的帧循环。
 *
 * 一帧的顺序固定：先让手势判定（读 DOM），再换预览，最后写卡片。写在读前面的话，判定里的 `elementsFromPoint` 每帧要强制重算一次样式。卡片的矩形每帧变，直接写在元素上，不进响应式；响应式的东西一场只变几次到几十次。
 *
 * 预览只是一份给渲染用的文档（store 的 `setLivePreview`），不写记录，不改可见性。撤预览由 `end` 做：手势的收场顺序里它先于提交，同一个同步段不渲染，不闪。
 */

import {initialLiveDrop, insideShownSlot, layoutDropKey, stepLiveDrop} from "@notnotype/nb-layout";
import type {GridDropPoint, GridDropRect, GridRect, LayoutDoc, LayoutDropAction, LiveDropCandidate, LiveDropState} from "@notnotype/nb-layout";
import {readonly, shallowRef} from "vue";
import type {Ref} from "vue";

import type {LayoutDragDrop, LayoutTabSource} from "./layout-drag";

/** 卡片缩到这么大（和原大小取较小者）。 */
const CARD_COMPACT = {width: 380, height: 260};
/** 缩放的时间常数：每帧按它指数逼近。 */
const CARD_TAU_MS = 90;
/** 卡片尺寸离目标这么近就算到了：指数逼近永远到不了，不截断的话宽高每帧都在变，每帧都要布局。 */
const CARD_STILL_PX = 0.1;

export interface LiveDragHost {
    requestFrame(run: (now: number) => void): number;
    cancelFrame(frame: number): void;
    /** 这块面板此刻的卡片矩形（视口坐标）；没有为 null。 */
    panelRect(panel: string): GridDropRect | null;
    /** 网格根的左上角（视口坐标）：拿起的内容与盖层的坐标相对它。拿起时读一次：容器变了整场取消。 */
    gridOrigin(): {readonly x: number; readonly y: number};
    /** 让手势做完这一帧的判定（`DragSession.flush`）。可能结束这一场。 */
    settleDrop(): void;
    /** 手势此刻的指针。 */
    pointer(): GridDropPoint | null;
    /** 写卡片的矩形（相对网格根）。 */
    placeCard(rect: GridRect): void;
    /** 卡片什么时候缩小（设置 `nbook.workbench/dragCardShrink`）：离开标签条，或离开来源面板。 */
    cardShrink(): "strip" | "panel";
    /** 按这个落点摆的文档；null 是摆不出来（放回原处、不预览的落点），就用已提交的。 */
    candidateDoc(source: LayoutTabSource, drop: LayoutDragDrop): LayoutDoc | null;
    /** 摘掉来源后的文档。 */
    sourceRemovedDoc(source: LayoutTabSource): LayoutDoc | null;
    /** 来源在已提交的文档里所在的面板。预览可能把它摘掉，卡片还是从这块缩出来。 */
    homeOf(source: LayoutTabSource): string | null;
    show(doc: LayoutDoc | null): void;
}

export interface LiveDrag {
    /** 这一场是实时布局。 */
    readonly active: Readonly<Ref<boolean>>;
    /** 此刻预览的是什么：`none`、`source-removed` 或候选的键。e2e 等它，不按时长等。 */
    readonly previewKey: Readonly<Ref<string>>;
    /** 拿起的内容项；在标签条里、没拿起时为 null。只在拿起与放下时变，矩形经 `placeCard` 写。 */
    readonly card: Readonly<Ref<{readonly key: string} | null>>;
    /** 已显示的空位（相对网格根）；没有新面板时为 null。 */
    readonly slot: Readonly<Ref<GridRect | null>>;
    /** 已显示的落点动作；预览的是别的（来源收起、没有、摆不出来）时为 null。 */
    readonly shownAction: Readonly<Ref<LayoutDropAction | null>>;
    /** 网格根的左上角（视口坐标），这一场拿起时读的。 */
    origin(): {readonly x: number; readonly y: number};
    begin(source: LayoutTabSource, point: GridDropPoint | null): void;
    /** 这一刻判定的落点。 */
    offer(drop: LayoutDragDrop | null): void;
    /** 指针在已显示的空位里：候选不变，是这个落点。 */
    stickyDrop(point: GridDropPoint): LayoutDragDrop | null;
    end(): void;
}

const clampUnit = (value: number): number => Math.min(1, Math.max(0, value));
const keyOf = (drop: LayoutDragDrop): string => (drop.inPlace ? "in-place" : JSON.stringify([layoutDropKey(drop.action), drop.part ?? null]));

export function createLiveDrag(host: LiveDragHost): LiveDrag {
    const active = shallowRef(false);
    const previewKey = shallowRef("none");
    const card = shallowRef<{readonly key: string} | null>(null);
    const slot = shallowRef<GridRect | null>(null);
    const shownAction = shallowRef<LayoutDropAction | null>(null);
    let source: LayoutTabSource | null = null;
    let pointer: GridDropPoint | null = null;
    let origin: {readonly x: number; readonly y: number} = {x: 0, y: 0};
    /** 上一次写出去的矩形：指针没动、缩放结束之后不写。 */
    let written: GridRect | null = null;
    /** 卡片此刻的尺寸与抓住的那一点（占卡片的比例）：缩放时抓住的点一直在指针下。 */
    let cardSize: {width: number; height: number} | null = null;
    let grab = {x: 0.5, y: 0};
    let homeRect: GridDropRect | null = null;
    let lastFrame = 0;
    let state: LiveDropState = initialLiveDrop(0);
    let started = false;
    let offered: LayoutDragDrop | null = null;
    let shown: LayoutDragDrop | null = null;
    let frame: number | null = null;
    function candidateOf(drop: LayoutDragDrop, from: LayoutTabSource): LiveDropCandidate {
        const {action} = drop;
        // 自己那条标签条要跟手。别人的标签条是并入：预览不动它，和中央一样等候选稳定。
        const inStrip = action.kind === "strip" && host.homeOf(from) === action.panel;
        // 只有长出新面板的落点有空位：并进已有面板时空位就是它的整块正文，粘住了它自己的外缘就选不到了。
        const grows = !drop.inPlace && action.kind === "edge";
        return {key: keyOf(drop), immediate: inStrip, slot: grows ? drop.preview.areaRect : null};
    }

    /**
     * 自己的标签条里不拿起：只有标签跟手，内容留在面板里。别人的标签条要拿起：并入的预览把来源摘掉了，内容靠拿起留着（`WorkbenchSurface` 的 `contents`），不拿起实例就卸了。
     * 活动栏的落点不改这个状态：已经拿起的继续跟手。
     */
    function wantsCard(): boolean {
        if (offered === null || source === null) return true;
        if (offered.noPreview === true) return card.value !== null;
        return offered.action.kind !== "strip" || host.homeOf(source) !== offered.action.panel;
    }

    function updateCard(now: number): void {
        if (source === null || pointer === null || !wantsCard()) {
            card.value = null;
            cardSize = null;
            written = null;
            return;
        }
        if (cardSize === null) {
            // 撕下来：从来源的面板开始缩。
            const panel = host.homeOf(source);
            const rect = panel === null ? null : host.panelRect(panel);
            homeRect = rect;
            const width = rect === null ? CARD_COMPACT.width : rect.right - rect.left;
            const height = rect === null ? CARD_COMPACT.height : rect.bottom - rect.top;
            cardSize = {width, height};
            grab = rect === null ? {x: 0.5, y: 0} : {x: clampUnit((pointer.x - rect.left) / width), y: clampUnit((pointer.y - rect.top) / height)};
        }
        const home = homeRect;
        const inHome = host.cardShrink() === "panel" && home !== null && pointer.x >= home.left && pointer.x < home.right && pointer.y >= home.top && pointer.y < home.bottom;
        const target = inHome ? {width: home.right - home.left, height: home.bottom - home.top} : {
            width: Math.min(CARD_COMPACT.width, home === null ? CARD_COMPACT.width : home.right - home.left),
            height: Math.min(CARD_COMPACT.height, home === null ? CARD_COMPACT.height : home.bottom - home.top),
        };
        // 这一场的第一帧没有上一帧：不算时间，从面板的大小开始缩。
        const blend = lastFrame === 0 ? 0 : 1 - Math.exp(-Math.max(0, now - lastFrame) / CARD_TAU_MS);
        const approach = (from: number, to: number): number => (Math.abs(to - from) < CARD_STILL_PX ? to : from + (to - from) * blend);
        cardSize = {width: approach(cardSize.width, target.width), height: approach(cardSize.height, target.height)};
        const rect = {x: pointer.x - origin.x - grab.x * cardSize.width, y: pointer.y - origin.y - grab.y * cardSize.height, width: cardSize.width, height: cardSize.height};
        if (card.value?.key !== source.tab) card.value = {key: source.tab};
        if (written !== null && written.x === rect.x && written.y === rect.y && written.width === rect.width && written.height === rect.height) return;
        written = rect;
        host.placeCard(rect);
    }

    /** 候选稳定了就换预览。 */
    function stepPreview(from: LayoutTabSource, now: number): void {
        if (!started) {
            started = true;
            state = initialLiveDrop(now);
        }
        const before = state.preview;
        state = stepLiveDrop(state, {now, candidate: offered === null ? null : candidateOf(offered, from)});
        if (state.preview === before) return;
        const {preview} = state;
        if (preview.kind === "candidate") {
            shown = offered;
            previewKey.value = preview.key;
            const doc = offered === null ? null : host.candidateDoc(from, offered);
            // 摆不出来（原位、活动栏、编辑器会合并或拒绝）就没有预览，盖层看它。
            shownAction.value = doc === null ? null : (offered?.action ?? null);
            host.show(doc);
        } else if (preview.kind === "source-removed") {
            shown = null;
            previewKey.value = "source-removed";
            shownAction.value = null;
            host.show(host.sourceRemovedDoc(from));
        }
        slot.value = state.slot === null ? null : {x: state.slot.left - origin.x, y: state.slot.top - origin.y, width: state.slot.right - state.slot.left, height: state.slot.bottom - state.slot.top};
    }

    function tick(now: number): void {
        frame = host.requestFrame(tick);
        if (source === null) return;
        host.settleDrop();
        // 判定时结构变了会结束这一场。
        if (source === null) return;
        pointer = host.pointer() ?? pointer;
        stepPreview(source, now);
        updateCard(now);
        lastFrame = now;
    }

    return {
        active: readonly(active),
        previewKey: readonly(previewKey),
        card,
        slot,
        shownAction,
        origin: () => origin,
        begin: (from, point) => {
            source = from;
            pointer = point;
            origin = host.gridOrigin();
            cardSize = null;
            written = null;
            lastFrame = 0;
            state = initialLiveDrop(0);
            started = false;
            offered = null;
            shown = null;
            previewKey.value = "none";
            active.value = true;
            frame = host.requestFrame(tick);
        },
        offer: (drop) => {
            offered = drop;
        },
        stickyDrop: (point) => (active.value && insideShownSlot(state, point) ? shown : null),
        end: () => {
            if (!active.value) return;
            if (frame !== null) host.cancelFrame(frame);
            frame = null;
            source = null;
            offered = null;
            shown = null;
            pointer = null;
            active.value = false;
            previewKey.value = "none";
            shownAction.value = null;
            slot.value = null;
            card.value = null;
            cardSize = null;
            host.show(null);
        },
    };
}
