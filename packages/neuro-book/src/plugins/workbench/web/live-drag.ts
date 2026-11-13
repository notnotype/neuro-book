/**
 * 实时布局的预览（docs/specs/ui/workbench-layout.md“实时布局”）：判定照旧由 `layout-drag` 做，这里把候选变成预览。候选稳定不稳定要逐帧看：指针不动时手势不发布，所以这一场有自己的帧循环。
 *
 * 一帧的顺序固定：先让手势判定（读 DOM），再换预览，最后写卡片。写在读前面的话，判定里的 `elementsFromPoint` 每帧要强制重算一次样式。卡片的矩形每帧变，直接写在元素上，不进响应式；响应式的东西一场只变几次到几十次。
 *
 * 判定的几何：拿起时量一份；第一次落到别处时来源收起，之后按收起后的布局判（`collapseSource`），预览怎么摆判定都不跟着变。回到原处（放下去是原样）时来源展开，
 * 判定换回拿起时的那份（`expandSource`）；再落到别处又收起（输出 38）。
 *
 * 预览只是一份给渲染用的文档（store 的 `setLivePreview`），不写记录，不改可见性。撤预览由 `end` 做：手势的收场顺序里它先于提交，同一个同步段不渲染，不闪。
 */

import {initialLiveDrop, insideShownSlot, stepLiveDrop} from "@notnotype/nb-layout";
import type {GridDropPoint, GridDropRect, GridRect, LayoutDoc, LiveDropCandidate, LiveDropState} from "@notnotype/nb-layout";
import {readonly, shallowRef} from "vue";
import type {Ref} from "vue";

import {dropStripOf, homeStripOf, workbenchDropKey} from "./entry-drop";
import type {WorkbenchDropAction} from "./entry-drop";
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
    /**
     * 标签条里排序：被拖的标签自己沿标签条跟手，夹在条里（`point` 是指针，`panel` 是吸收它的那块面板的标签条）；null 是不在排序，放回原位。
     * 这一步只读（帧开头样式是干净的，读不强制重算），返回写的那一步：调用方在判定（也读 DOM）之后再写，写在读前面的话判定就要强制重算。
     */
    placeSorted(at: {readonly point: GridDropPoint; readonly panel: string} | null): () => void;
    /** 同上，等这一帧的渲染做完再放：预览或卡片刚变，标签换了位置或刚要显示出来，按上一帧的状态放会错一帧。只在状态变的那一帧调，读位置强制一次重算。 */
    placeSortedAfterRender(at: {readonly point: GridDropPoint; readonly panel: string} | null): void;
    /** 卡片什么时候缩小（设置 `nbook.workbench/dragCardShrink`）：离开标签条，或离开来源面板。 */
    cardShrink(): "strip" | "panel";
    /** 按这个落点摆的文档；null 是放回原处或算不出，就用已提交的。编辑器标签的并入、拒绝在判定里已经换成中央、被拒绝（`layout-drag` 的 `answeredByEditor`）。 */
    candidateDoc(source: LayoutTabSource, drop: LayoutDragDrop): LayoutDoc | null;
    /** 摘掉来源后的文档。 */
    sourceRemovedDoc(source: LayoutTabSource): LayoutDoc | null;
    /** 来源收起了：之后按收起后的布局判定（输出 38）。`drop` 是收起时屏幕上的落点（来源收起的预览是 null），指针再动之前一直是它。 */
    collapseSource(source: LayoutTabSource, drop: LayoutDragDrop | null): void;
    /** 回到原处，来源展开回原位：判定换回拿起时的布局（输出 38）。`drop` 是这一刻屏幕上的落点（原位），指针再动之前一直是它。 */
    expandSource(source: LayoutTabSource, drop: LayoutDragDrop): void;
    /** 来源在已提交的文档里所在的面板。 */
    homeOf(source: LayoutTabSource): string | null;
    /**
     * 这条标签条是不是来源自己的：它所在面板的，或者来源是侧栏里一个容器唯一的视图时的活动栏（输出 45：入口之间只是给它的容器换位置）。
     * 在自己的标签条里跟手、不收起来源。
     */
    isHomeStrip(source: LayoutTabSource, strip: string): boolean;
    show(doc: LayoutDoc | null): void;
}

export interface LiveDrag {
    /** 这一场是实时布局。 */
    readonly active: Readonly<Ref<boolean>>;
    /** 此刻预览的是什么：`none`、`source-removed` 或候选的键。e2e 等它，不按时长等。 */
    readonly previewKey: Readonly<Ref<string>>;
    /** 拿起的内容项；原位、被标签条吸收、没拿起时为 null。只在拿起与放下时变，矩形经 `placeCard` 写。 */
    readonly card: Readonly<Ref<{readonly key: string} | null>>;
    /** 已显示的空位（相对网格根）；没有新面板时为 null。 */
    readonly slot: Readonly<Ref<GridRect | null>>;
    /** 已显示的落点动作；预览的是别的（来源收起、没有、摆不出来）时为 null。 */
    readonly shownAction: Readonly<Ref<WorkbenchDropAction | null>>;
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
/** 落在哪条标签条上（活动栏的入口之间也是一条）；不是标签条为 null。 */
const stripOf = dropStripOf;
/** 原位的落点结果都一样，键也一样；只有标签条里的原位分开：来源收起之后它是排序（已提交的样子），别的原位是来源收起的样子。 */
const keyOf = (drop: LayoutDragDrop): string => (drop.inPlace ? (stripOf(drop.action) === null ? "in-place" : "in-place-strip") : JSON.stringify([workbenchDropKey(drop.action), drop.part ?? null]));

export function createLiveDrag(host: LiveDragHost): LiveDrag {
    const active = shallowRef(false);
    const previewKey = shallowRef("none");
    const card = shallowRef<{readonly key: string} | null>(null);
    const slot = shallowRef<GridRect | null>(null);
    const shownAction = shallowRef<WorkbenchDropAction | null>(null);
    let source: LayoutTabSource | null = null;
    let pointer: GridDropPoint | null = null;
    let origin: {readonly x: number; readonly y: number} = {x: 0, y: 0};
    /** 上一次写出去的矩形：指针没动、缩放结束之后不写。 */
    let written: GridRect | null = null;
    /** 卡片此刻的尺寸与抓住的那一点（占卡片的比例）：缩放时抓住的点一直在指针下。 */
    let cardSize: {width: number; height: number} | null = null;
    let grab = {x: 0.5, y: 0};
    /** 卡片离跟手的位置还差多少：拿起时指针在那块面板外面，抓住的点夹在卡片边上，卡片从面板的位置追到指针下，和尺寸同一个时间常数。 */
    let chase = {x: 0, y: 0};
    /** 来源面板的矩形：这一场第一次要卡片时量，之后不变（吸收之后“来源面板”还是它）。undefined 是还没量。 */
    let homeRect: GridDropRect | null | undefined;
    /** 已经吸收来源的标签条是哪块面板的：预览摆着它（或它本来就在那里）。 */
    let absorbedIn: string | null = null;
    /** 来源此刻收起着：摆别处的落点（或来源收起的预览）时收起，回到原处时展开。 */
    let collapsed = false;
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
        const immediate = strip !== null && (host.isHomeStrip(from, strip) || strip === absorbedIn);
        // 只有长出新面板的落点有空位：并进已有面板时空位就是它的整块正文，粘住了它自己的外缘就选不到了。
        const grows = !drop.inPlace && action.kind === "edge";
        return {key: keyOf(drop), immediate, slot: grows ? drop.preview.areaRect : null};
    }

    /**
     * 两种时候不要卡片（输出 38）。原位：放下去是原样，卡片飞回，内容回到叶，标签照常显示。来源收起着时等它展开：收起着的预览里没有这个标签，
     * 不拿着的话内容项就卸了；原位稳定的那一帧 `stepPreview` 先展开，同一帧这里就收回。指针落在别人的标签条上并且已经被它吸收：只有标签跟手。
     * 还没等够稳定时卡片留着，内容靠拿起留着（`WorkbenchSurface` 的 `contents`）。
     */
    function wantsCard(): boolean {
        if (offered === null) return true;
        if (offered.inPlace) return collapsed;
        const strip = stripOf(offered.action);
        return strip === null || strip !== absorbedIn;
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
        // 拿起的那一帧不算时间：卡片就在那块面板上，从它的矩形开始缩、开始追。
        const lifting = cardSize === null;
        if (cardSize === null) {
            // 撕下来：从此刻显示着它的那块面板开始缩。
            const showing = absorbedIn ?? homePanel;
            const rect = showing === null ? null : host.panelRect(showing);
            const width = rect === null ? Math.min(CARD_COMPACT.width, home === null ? CARD_COMPACT.width : home.right - home.left) : rect.right - rect.left;
            const height = rect === null ? Math.min(CARD_COMPACT.height, home === null ? CARD_COMPACT.height : home.bottom - home.top) : rect.bottom - rect.top;
            cardSize = {width, height};
            grab = rect === null ? {x: 0.5, y: 0} : {x: clampUnit((pointer.x - rect.left) / width), y: clampUnit((pointer.y - rect.top) / height)};
            chase = rect === null ? {x: 0, y: 0} : {x: rect.left - (pointer.x - grab.x * width), y: rect.top - (pointer.y - grab.y * height)};
        }
        const inHome = host.cardShrink() === "panel" && home !== null && pointer.x >= home.left && pointer.x < home.right && pointer.y >= home.top && pointer.y < home.bottom;
        const target = inHome ? {width: home.right - home.left, height: home.bottom - home.top} : {
            width: Math.min(CARD_COMPACT.width, home === null ? CARD_COMPACT.width : home.right - home.left),
            height: Math.min(CARD_COMPACT.height, home === null ? CARD_COMPACT.height : home.bottom - home.top),
        };
        const blend = lifting ? 0 : 1 - Math.exp(-Math.max(0, now - lastFrame) / CARD_TAU_MS);
        const approach = (from: number, to: number): number => (Math.abs(to - from) < CARD_STILL_PX ? to : from + (to - from) * blend);
        cardSize = {width: approach(cardSize.width, target.width), height: approach(cardSize.height, target.height)};
        chase = {x: approach(chase.x, 0), y: approach(chase.y, 0)};
        const rect = {x: pointer.x - origin.x - grab.x * cardSize.width + chase.x, y: pointer.y - origin.y - grab.y * cardSize.height + chase.y, width: cardSize.width, height: cardSize.height};
        if (card.value?.key !== source.tab) card.value = {key: source.tab};
        if (written !== null && written.x === rect.x && written.y === rect.y && written.width === rect.width && written.height === rect.height) return;
        written = rect;
        host.placeCard(rect);
    }

    const isHome = (from: LayoutTabSource, strip: string | null): boolean => strip !== null && host.isHomeStrip(from, strip);

    /** 候选稳定了就换预览；换了返回真。 */
    function stepPreview(from: LayoutTabSource, now: number): boolean {
        if (!started) {
            started = true;
            state = initialLiveDrop(now);
        }
        const before = state.preview;
        state = stepLiveDrop(state, {now, candidate: offered === null ? null : candidateOf(offered, from)});
        if (state.preview === before) return false;
        const {preview} = state;
        // 落到别处才收起来源：自己的标签条里换序、放回原处都还没离开（活动栏是自己的入口条时，停在别的入口上也是，`homeStripOf`）。
        const elsewhere = preview.kind === "source-removed" || (preview.kind === "candidate" && offered !== null && !offered.inPlace && !isHome(from, homeStripOf(offered.action)));
        if (elsewhere && !collapsed) {
            collapsed = true;
            host.collapseSource(from, preview.kind === "candidate" ? offered : null);
        }
        // 回到原处（放下去是原样）：来源展开回原位，判定换回拿起时的布局，预览就是已提交的样子（输出 38）。
        if (collapsed && preview.kind === "candidate" && offered !== null && offered.inPlace) {
            collapsed = false;
            host.expandSource(from, offered);
        }
        if (preview.kind === "candidate") {
            shown = offered;
            previewKey.value = preview.key;
            const doc = offered === null ? null : host.candidateDoc(from, offered);
            // 原位、算不出就没有预览，盖层看它。
            shownAction.value = doc === null ? null : (offered?.action ?? null);
            absorbedIn = offered !== null && (offered.inPlace || doc !== null) ? stripOf(offered.action) : null;
            // 来源收起着时，算不出的仍是来源收起的样子：已提交的文档里来源还在原处，换回它就是又展开。原位走上面的展开。
            host.show(doc ?? (collapsed ? host.sourceRemovedDoc(from) : null));
        } else if (preview.kind === "source-removed") {
            shown = null;
            previewKey.value = "source-removed";
            shownAction.value = null;
            absorbedIn = null;
            host.show(host.sourceRemovedDoc(from));
        }
        slot.value = state.slot === null ? null : {x: state.slot.left - origin.x, y: state.slot.top - origin.y, width: state.slot.right - state.slot.left, height: state.slot.bottom - state.slot.top};
        return true;
    }

    /** 被拖的标签在不在标签条里排序：卡片收回了就是。帧开头调时是上一帧的状态。 */
    function sortingAt(): {readonly point: GridDropPoint; readonly panel: string} | null {
        if (pointer === null || offered === null || wantsCard()) return null;
        const panel = stripOf(offered.action);
        return panel === null ? null : {point: pointer, panel};
    }

    function tick(now: number): void {
        frame = host.requestFrame(tick);
        if (source === null) return;
        // 读在判定之前、写在判定之后：两次读之间没有写，这一帧不强制重算。用上一帧的状态；状态一变，渲染之后再放一次（`placeSortedAfterRender`）。
        const placeSorted = host.placeSorted(sortingAt());
        host.settleDrop();
        // 判定时结构变了会结束这一场。
        if (source === null) return;
        placeSorted();
        pointer = host.pointer() ?? pointer;
        const lifted = card.value !== null;
        const changed = stepPreview(source, now);
        updateCard(now);
        lastFrame = now;
        if (changed || lifted !== (card.value !== null)) host.placeSortedAfterRender(sortingAt());
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
            collapsed = false;
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
            host.placeSorted(null)();
            host.show(null);
        },
    };
}
