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
    /** 这块面板拿起时的卡片矩形（视口坐标）；那时隐藏着、量不到是 null。不读 DOM：预览的过渡中间读到的是中间值。 */
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
    /** 按这个落点摆的文档；null 是摆不出来（放回原处、编辑器会合并或拒绝），就用已提交的。 */
    candidateDoc(source: LayoutTabSource, drop: LayoutDragDrop): LayoutDoc | null;
    /** 摘掉来源后的文档。 */
    sourceRemovedDoc(source: LayoutTabSource): LayoutDoc | null;
    /** 来源在已提交的文档里所在的面板。 */
    homeOf(source: LayoutTabSource): string | null;
    show(doc: LayoutDoc | null): void;
}

export interface LiveDrag {
    /** 这一场是实时布局。 */
    readonly active: Readonly<Ref<boolean>>;
    /** 此刻预览的是什么：`none`、`source-removed` 或候选的键。e2e 等它，不按时长等。 */
    readonly previewKey: Readonly<Ref<string>>;
    /** 拿起的内容项；被标签条吸收、没拿起时为 null。只在拿起与放下时变，矩形经 `placeCard` 写。 */
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
/** 落在哪块面板的标签条上（活动栏是侧栏的标签条）；不是标签条为 null。 */
const stripOf = ({kind, ...action}: LayoutDropAction): string | null => (kind === "strip" || kind === "reveal" ? (action as {readonly panel: string}).panel : null);

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
    /** 来源面板的矩形：这一场第一次要卡片时量，之后不变（吸收之后“来源面板”还是它）。undefined 是还没量。 */
    let homeRect: GridDropRect | null | undefined;
    /** 已经吸收来源的标签条是哪块面板的：预览摆着它（或它本来就在那里）。 */
    let absorbedIn: string | null = null;
    let lastFrame = 0;
    let state: LiveDropState = initialLiveDrop(0);
    let started = false;
    let offered: LayoutDragDrop | null = null;
    let shown: LayoutDragDrop | null = null;
    let frame: number | null = null;
    function candidateOf(drop: LayoutDragDrop, from: LayoutTabSource): LiveDropCandidate {
        const {action} = drop;
        // 自己的标签条、已经吸收它的那条要跟手。第一次进别的标签条和别的落点一样等稳定：路过不闪，也不会路过活动栏就把隐藏的侧栏弹出来。
        const strip = stripOf(action);
        const immediate = strip !== null && (strip === host.homeOf(from) || strip === absorbedIn);
        // 只有长出新面板的落点有空位：并进已有面板时空位就是它的整块正文，粘住了它自己的外缘就选不到了。
        const grows = !drop.inPlace && action.kind === "edge";
        return {key: keyOf(drop), immediate, slot: grows ? drop.preview.areaRect : null};
    }

    /** 指针落在标签条上并且已经被它吸收时不要卡片：只有标签跟手。还没等够稳定时卡片留着，内容靠拿起留着（`WorkbenchSurface` 的 `contents`）。 */
    function wantsCard(): boolean {
        if (offered === null) return true;
        const strip = stripOf(offered.action);
        return strip === null || !(offered.inPlace || strip === absorbedIn);
    }

    function updateCard(now: number): void {
        if (source === null || pointer === null || !wantsCard()) {
            card.value = null;
            cardSize = null;
            written = null;
            return;
        }
        const homePanel = host.homeOf(source);
        if (homeRect === undefined) homeRect = homePanel === null ? null : host.panelRect(homePanel);
        const home = homeRect;
        if (cardSize === null) {
            // 撕下来：从此刻显示着它的那块面板开始缩。
            const showing = absorbedIn ?? homePanel;
            const rect = showing === null ? null : host.panelRect(showing);
            const width = rect === null ? Math.min(CARD_COMPACT.width, home === null ? CARD_COMPACT.width : home.right - home.left) : rect.right - rect.left;
            const height = rect === null ? Math.min(CARD_COMPACT.height, home === null ? CARD_COMPACT.height : home.bottom - home.top) : rect.bottom - rect.top;
            cardSize = {width, height};
            grab = rect === null ? {x: 0.5, y: 0} : {x: clampUnit((pointer.x - rect.left) / width), y: clampUnit((pointer.y - rect.top) / height)};
        }
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
            // 摆不出来（原位、编辑器会合并或拒绝）就没有预览，盖层看它。
            shownAction.value = doc === null ? null : (offered?.action ?? null);
            absorbedIn = offered !== null && (offered.inPlace || doc !== null) ? stripOf(offered.action) : null;
            host.show(doc);
        } else if (preview.kind === "source-removed") {
            shown = null;
            previewKey.value = "source-removed";
            shownAction.value = null;
            absorbedIn = null;
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
            homeRect = undefined;
            absorbedIn = null;
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
