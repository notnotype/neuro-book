<script setup lang="ts">
/**
 * 主界面：把模型接到 NestedGrid 上，再接一场拖动会话。读的顺序建议是 model.ts、drop.ts、这里。
 *
 * 几件事各在一处：
 * - 布局：useGridHost 管量尺寸、算布局、接分隔线的提交；树的结构变了调 invalidate。树里只有桌面、底栏和平铺的窗。
 * - 浮动窗：不在树里，矩形由模型记着，经 `floats` 交给网格；窗在树与浮动之间来回时叶的 id 不变，库据此做飞进飞出的过渡。
 * - 正文：每扇窗的正文放在内容层，按窗的 id 认实例，窗换了样子打的字还在。
 * - 移动：useDragSession 驱动整窗移动，网格只管把窗跟着挪（placeFloat）；在桌面左右缘松手就平铺。
 * - 缩放与键盘移动：FloatWindowHandles 只算矩形，这里负责夹进桌面再写回。
 * - 存档：每次布局变了就存；读档在启动时一次。
 */
import {computed, nextTick, shallowRef, triggerRef, useTemplateRef} from "vue";

import {DropFeedbackOverlay, FloatWindowHandles, NestedGrid, useDragSession, useGridHost} from "@notnotype/nb-layout/vue";
import type {DropFeedbackPreview} from "@notnotype/nb-layout/vue";
import type {GridContentInput, GridDropPoint, GridFloatInput, GridRect} from "@notnotype/nb-layout";

import {actionKey, dropKey, moveTarget, tileSide, type Drop} from "./drop";
import {
    deskClamp,
    DESKTOP,
    DOCK,
    intersectRect,
    isWindowId,
    leafRect,
    loadLayout,
    roundRect,
    saveLayout,
    TITLE_BAR_HEIGHT,
    TITLES,
    WINDOW_IDS,
    WINDOW_MIN,
    type LayoutStorage,
    type Mode,
    type Result,
    type Side,
    type TilePreview,
    type WindowId,
} from "./model";
import Taskbar from "./Taskbar.vue";
import WindowBody from "./WindowBody.vue";
import WindowFrame, {type WindowAction} from "./WindowFrame.vue";

/** 浏览器禁用存储（某些隐私模式、沙箱里的 iframe）时连读 `localStorage` 都会抛错。 */
function openStorage(): LayoutStorage | null {
    try {
        return window.localStorage;
    } catch (error) {
        console.warn("Opening localStorage failed", error);
        return null;
    }
}
const storage = openStorage();
const loaded = loadLayout(storage);

/**
 * 模型放在 shallowRef 里：网格实例不该被 Vue 深度代理。模型是原地改的，改完调 triggerRef 让读它的模板重算。
 * 网格实例在整个页面里不换，所以 useGridHost 看到的一直是同一个。
 */
const layout = shallowRef(loaded.layout);
const grid = computed(() => layout.value.grid);
/**
 * 这一页不保存时（存储不可用、存档读不了而且备份也写不进去）的提示：常驻，直到重新载入，不被后面成功的操作清掉。
 * 它和一次性的操作结果分开放：只放在状态行里的话，第一次成功的操作就把它清了，之后所有改动都不存，界面上却什么都看不到。
 */
const sticky = loaded.keep ? "" : (loaded.notice ?? "");
/** 一次性的状态：读档的说明、保存失败、操作被拒的原因。下一次成功的操作清掉它。 */
const notice = shallowRef(loaded.keep ? (loaded.notice ?? "") : "");
/** 状态行显示的：有一次性的就显示它，没有时显示常驻的。 */
const status = computed(() => notice.value || sticky);

function persist(): void {
    // 存档读不了、备份也没写进去时不再保存：再存就拿缺省布局覆盖了原件。
    if (!loaded.keep) return;
    const failed = saveLayout(storage, layout.value);
    if (failed !== null) notice.value = failed;
}

// contextKey 标出这是哪一块布局：换了它，进行中的旧手势就不落账。onApplied 是拖完分隔线、提交落账之后：在这里存档。
// onIssues 是诊断的唯一出口，示例只在控制台说出来。
const host = useGridHost({
    grid,
    contextKey: "desktop",
    onApplied: persist,
    onIssues: (issues) => console.warn("nb-layout reported issues", issues),
});
const gridView = useTemplateRef<InstanceType<typeof NestedGrid>>("gridView");
const box = useTemplateRef<HTMLElement>("box");

/**
 * 操作成功：通知网格重算（树变了才需要），模板跟着重算，存档。失败：说出原因，模型没动。
 * `tree` 为假的操作（移动、缩放、抬升）没碰树：不调 `invalidate`，它会让版本加一，取消正在进行的手势。
 */
function settle(result: Result, tree = true): boolean {
    if (!result.ok) {
        notice.value = result.message;
        return false;
    }
    // 一次性的状态说的是上一件事（读档、上次保存、上次被拒）；这次成功了就清掉，保存再失败会重新写上。常驻的不清。
    notice.value = "";
    if (tree) host.invalidate();
    triggerRef(layout);
    persist();
    return true;
}

/**
 * 设备像素比：库按它取整，这里量桌面叶的矩形也要用同一个。
 * 已知限制：这里在计算属性里直接读 `window.devicePixelRatio`，不是响应式的。浏览器缩放通常会改视口的 CSS 宽度、
 * 让网格重算，这里跟着重算；但窗口拖到比例不同的另一块屏幕上而视口宽度没变时，这里还是旧的比例，
 * 取整可能与库差一个设备像素。库内部有响应式的版本，但没有导出，示例只能这样读。
 */
const dpr = (): number => window.devicePixelRatio || 1;

/**
 * 桌面叶此刻相对网格根的矩形：库不交出摆放结果，只能按同一份树与布局自己摆一遍（`leafRect`）。
 * 左右有平铺窗时它不从 0 开始、也不是整个网格那么宽。
 */
const desk = computed<GridRect | null>(() => {
    const extent = host.extent.value;
    return extent === null ? null : leafRect(host.node.value, host.layout.value, extent, dpr(), DESKTOP);
});

/** 浮动窗此刻画着的矩形：夹进桌面（视口变小、平铺占了地方之后窗都在桌面里，记录不改，视口变回来窗回原处）；最大化的取桌面。 */
const floatRects = computed(() => {
    const rects = new Map<WindowId, GridRect>();
    const area = desk.value;
    if (area === null) return rects;
    for (const id of layout.value.floating()) {
        const state = layout.value.windows.get(id)!;
        rects.set(id, state.mode === "maximized" ? area : roundRect(deskClamp(state.floatRect, area)));
    }
    return rects;
});

/** 拖动标题栏移动的一场：起点矩形、按下处与桌面都在起拖时记下，这一场里不重新量。 */
type Moving = {readonly id: WindowId; readonly start: GridRect; readonly pressed: GridDropPoint; readonly desk: GridRect};
const moving = shallowRef<Moving | null>(null);
/** 缩放进行中的预览矩形：画它，不写模型；松手才写。 */
const resizing = shallowRef<{readonly id: WindowId; readonly rect: GridRect} | null>(null);

/** 交给网格的浮动窗，次序就是层叠次序（后面的在上面）。进行中的手势写在 `gesture` 上：跟手、不过渡。 */
const floats = computed<GridFloatInput[]>(() => [...floatRects.value].map(([id, rect]) => {
    if (moving.value?.id === id) return {id, rect, gesture: "move" as const};
    if (resizing.value?.id === id) return {id, rect: resizing.value.rect, gesture: "resize" as const};
    return {id, rect};
}));

const modes = computed(() => Object.fromEntries(WINDOW_IDS.map((id) => [id, layout.value.mode(id)])) as Record<WindowId, Mode>);

/**
 * 内容层：每扇没关的窗一项。最小化的 `active: false`，网格把它停放而不卸载，打的字还在；关闭的拿掉，卸载。
 * `leave: "retain"`：关掉一扇平铺的窗时，库把它的正文留到那块叶缩回去之后再卸载。
 */
const contents = computed<GridContentInput[]>(() => WINDOW_IDS.flatMap((id) => (modes.value[id] === "closed"
    ? []
    : [{key: id, leaf: id, insetTop: TITLE_BAR_HEIGHT, active: modes.value[id] !== "minimized", leave: "retain" as const}])));

const titleOf = (id: string): string => (isWindowId(id) ? TITLES[id] : id);

/**
 * 标题栏的按钮。操作都在模型里判能不能做，这里只转发。
 * 最小化与关闭之后，按钮随窗一起从页面上消失，焦点会掉到 body：交给底栏上这扇窗的按钮，它一直在，
 * 键盘用户可以接着按回车把窗找回来。
 */
function onAction(id: string, action: WindowAction): void {
    if (!isWindowId(id)) return;
    const model = layout.value;
    if (action === "maximize") settle(model.toggleMaximize(id), false);
    else if (action === "minimize" || action === "close") {
        if (settle(action === "minimize" ? model.minimize(id) : model.close(id))) void nextTick(() => box.value?.querySelector<HTMLElement>(`[data-window="${CSS.escape(id)}"]`)?.focus());
    } else settle(model.untile(id));
}

/** 点底栏按钮。平铺的窗什么都不改，焦点给它的正文；回到平铺时模型先试放得下放不下。 */
function onDockClick(id: WindowId): void {
    const extent = host.extent.value;
    if (extent === null) return;
    const tiled = modes.value[id] === "tiled-left" || modes.value[id] === "tiled-right";
    if (!settle(layout.value.dockClick(id, extent)) || !tiled) return;
    void nextTick(() => box.value?.querySelector<HTMLElement>(`[data-window-text="${CSS.escape(id)}"]`)?.focus());
}

/**
 * 按下浮动窗的任何地方把它挪到最上面，含它的缩放手柄。监听挂在承载盒的捕获阶段：手柄是网格根的直接子元素、
 * 不在窗的内容里，而且它在 `pointerdown` 里阻止冒泡，挂在窗上收不到。窗的三层都带自己的标记：
 * 叶的外框（标题栏在里面）`data-leaf`、正文 `data-content-leaf`、手柄 `data-float-chrome`。
 */
function raiseOnPress(event: PointerEvent): void {
    if (!(event.target instanceof Element)) return;
    const part = event.target.closest<HTMLElement>("[data-leaf], [data-content-leaf], [data-float-chrome]");
    const id = part?.dataset.leaf ?? part?.dataset.contentLeaf ?? part?.dataset.floatChrome;
    if (!isWindowId(id) || layout.value.floating().at(-1) === id) return;
    if (layout.value.floating().includes(id)) settle(layout.value.raise(id), false);
}

/** 一场移动里试平铺的结果，按侧缓存：拖动中树不变（变了 structure 会取消整场），同一侧只试一次。 */
const tileTrials = new Map<Side, TilePreview>();

/** 视口坐标里的矩形：网格根的左上角加上相对网格根的矩形。 */
function inViewport(rect: GridRect): {left: number; top: number; right: number; bottom: number} {
    const origin = gridView.value?.origin() ?? {x: 0, y: 0};
    return {left: origin.x + rect.x, top: origin.y + rect.y, right: origin.x + rect.x + rect.width, bottom: origin.y + rect.y + rect.height};
}

/** 一场移动结束但不提交：窗回到原处。 */
function releaseMove(): void {
    const current = moving.value;
    if (current === null) return;
    gridView.value?.placeFloat(current.id, null);
    moving.value = null;
}

/**
 * 松手后下一帧再改树：先把拖到的矩形发布出去（`commit` 里已写进模型），等浏览器把它算成当前样式，再平铺。
 * 同一拍里改树的话，库从按下之前的矩形开始飞，窗会先跳回去再飞进那一侧：e2e 把它改成同一拍时会失败。
 * 下面读一次 `getBoundingClientRect` 是保险，让浏览器此刻就算好样式。实测在 Chromium 里鼠标松手的事件之后浏览器自己
 * 已经算过一遍样式（命中测试），删掉这一行用例也不失败，所以没有证据说它必不可少；触摸与笔没有试过，留着它不花什么。
 */
function tileOnNextFrame(id: WindowId, side: Side): void {
    requestAnimationFrame(() => {
        void box.value?.getBoundingClientRect();
        const extent = host.extent.value;
        if (extent !== null) settle(layout.value.tile(id, side, extent));
    });
}

const drag = useDragSession<WindowId, Drop>(box, () => ({
    // 来源：按在浮动窗（没最大化的）的标题栏上。标题栏上的按钮要排除，不然按住按钮一拖就起拖、点击也被吞掉。
    sourceAt: (target) => {
        if (target.closest("button") !== null) return null;
        const id = target.closest<HTMLElement>("[data-window-title]")?.dataset.windowTitle;
        return isWindowId(id) && modes.value[id] === "floating" ? id : null;
    },
    activate: (id, _keyboard, at) => {
        const area = desk.value;
        const start = floatRects.value.get(id);
        if (at === null || area === null || start === undefined) return false;
        // 起拖时如果还有过渡在走（刚平铺、刚关掉），先送到终点：宿主的拖动会话要自己调，库的分隔线手势才自己做。
        gridView.value?.settleMotion();
        tileTrials.clear();
        moving.value = {id, start, pressed: at.pressed, desk: area};
        return true;
    },
    // 一场里网格重发了布局（窗口缩放、别处改了树），整场取消，不拿起拖时量的桌面矩形判。
    structure: () => String(host.revision.value),
    // 放下提交指针此刻所在的落点，不要求与最后显示过的相同：窗是跟着指针即时挪的，显示的落点总比指针慢一拍。
    commitsUnderPointer: () => true,
    resolve: ({source, point}) => {
        const current = moving.value;
        const extent = host.extent.value;
        if (current === null || extent === null) return null;
        const target = moveTarget(current.start, current.pressed, point, current.desk);
        const rect = {...current.start, ...target};
        // 先读后写：读 DOM（`inViewport` 量网格根的矩形）都在前面做完，最后才写窗跟手的反馈（`placeFloat` 改 translate）。
        // 写在读之前的话，每个指针样本都要浏览器同步重算样式与布局。
        const side = tileSide(point, inViewport(current.desk));
        let drop: Drop;
        if (side === null) drop = {kind: "move", rect};
        else {
            let trial = tileTrials.get(side);
            if (trial === undefined) {
                trial = layout.value.previewTile(source, side, extent, dpr());
                tileTrials.set(side, trial);
            }
            const area = trial.area === null ? null : inViewport(trial.area);
            drop = {kind: "tile", side, rect, area, blocked: trial.result.ok ? null : trial.result.message};
        }
        // 窗跟手：网格把它的外框、正文、手柄一起挪。
        gridView.value?.placeFloat(current.id, {x: target.x - current.start.x, y: target.y - current.start.y});
        return drop;
    },
    actionKey,
    // 顺序：会话先收场（`onEnd`），再调 `commit`。提交的是 `move` 或平铺；平铺放不下时按 `move` 处理，窗停在松手处。
    commit: (drop, id) => {
        gridView.value?.placeFloat(id, null);
        moving.value = null;
        // 只写 x、y：窗比桌面大时夹过的宽高是缩小的，写回去视口变大后也回不来。
        if (!settle(layout.value.move(id, drop.rect.x, drop.rect.y), false)) return;
        if (drop.kind === "tile" && drop.blocked === null) tileOnNextFrame(id, drop.side);
    },
    onEnd: (end) => {
        if (end.kind !== "committed") releaseMove();
    },
}));

const dragging = computed(() => drag.state.value !== null);
const currentDrop = computed(() => drag.state.value?.drop ?? null);

const preview = computed<DropFeedbackPreview | null>(() => {
    const drop = currentDrop.value;
    if (drop?.kind !== "tile") return null;
    // armed 为假：照样画出那一块，但淡下去，告诉用户松手不会平铺。
    return {areaRect: drop.area, indicator: null, orientation: "horizontal", armed: drop.blocked === null};
});
const previewLabel = computed(() => {
    const drop = currentDrop.value;
    return drop?.kind === "tile" ? (drop.blocked ?? `Tile ${drop.side}`) : "";
});

/** 缩放预览与提交都先与桌面求交：库的 `max` 是尺寸不是边界，不求交时预览能伸出桌面，松手后又被夹，窗会跳。 */
function withinDesk(rect: GridRect): GridRect {
    return desk.value === null ? rect : roundRect(intersectRect(rect, desk.value));
}
function onResizePreview(id: WindowId, rect: GridRect | null): void {
    resizing.value = rect === null ? null : {id, rect: withinDesk(rect)};
}
function onResizeCommit(id: WindowId, rect: GridRect): void {
    settle(layout.value.resize(id, withinDesk(rect)), false);
}
/** 键盘移动：位置过 `deskClamp` 后只写回 `x`、`y`；窗被夹着时画着的矩形是夹过的，宽高不能写回。 */
function onKeyboardMove(id: WindowId, position: {readonly x: number; readonly y: number}): void {
    const drawn = floatRects.value.get(id);
    if (drawn === undefined || desk.value === null) return;
    const clamped = roundRect(deskClamp({...drawn, ...position}, desk.value));
    settle(layout.value.move(id, clamped.x, clamped.y), false);
}

const deskExtent = computed(() => ({width: desk.value?.width ?? 0, height: desk.value?.height ?? 0}));

/** 分隔线的读屏名称念面板的名字，不念生成的 id；挨着分支时库也会问分支的 id，那时交回 undefined 用 id。 */
const paneLabel = (id: string): string | undefined => (id === DESKTOP ? "Desktop" : id === DOCK ? "Dock" : isWindowId(id) ? TITLES[id] : undefined);

/** 底栏上面那条分隔线不能拖。平铺之后 `before` 会变成分支的 id，`after` 才一直是底栏。 */
const sashDisabled = (sash: {readonly after: string}): boolean => sash.after === DOCK;
</script>

<template>
    <div class="app" :class="{'app--dragging': dragging}">
        <header class="toolbar">
            <strong>Desktop</strong>
            <!-- 状态行在网格外面、高度固定：文字变了不改网格的尺寸，拖动不会因此被取消。 -->
            <p class="status" role="status" data-status>{{ status }}</p>
        </header>
        <!-- 承载盒要有确定的高度：NestedGrid 铺满它、自己量它。data-drop 是此刻的落点，拖动时才有。 -->
        <div ref="box" class="grid-box" :data-drop="dragging ? (currentDrop === null ? 'none' : dropKey(currentDrop)) : undefined" @pointerdown.capture="raiseOnPress">
            <NestedGrid
                ref="gridView"
                v-bind="host.bindings.value"
                :contents="contents"
                :floats="floats"
                :dragging="dragging"
                :pane-label="paneLabel"
                :sash-disabled="sashDisabled"
            >
                <template #leaf="{node}">
                    <div v-if="node.id === DESKTOP" class="desktop" data-desktop></div>
                    <Taskbar v-else-if="node.id === DOCK" :states="modes" @click="onDockClick" />
                    <WindowFrame v-else :id="node.id" :title="titleOf(node.id)" :mode="isWindowId(node.id) ? modes[node.id] : 'closed'" @action="onAction" />
                </template>
                <template #content="{contentKey}">
                    <WindowBody :id="contentKey" :title="titleOf(contentKey)" />
                </template>
                <!-- 手柄只给浮动的、没最大化的窗：最大化的窗铺满桌面，没有可缩放的边。 -->
                <template #float-chrome="{id, rect}">
                    <FloatWindowHandles
                        v-if="isWindowId(id) && modes[id] === 'floating'"
                        :rect="rect"
                        :min="WINDOW_MIN"
                        :max="deskExtent"
                        @preview="onResizePreview(id, $event)"
                        @commit="onResizeCommit(id, $event)"
                        @move="onKeyboardMove(id, $event)"
                    />
                </template>
            </NestedGrid>
            <!-- data-drag-feedback：会话判落点时跳过它，不然它会挡住指针下的目标。 -->
            <DropFeedbackOverlay data-drag-feedback :preview="preview" :label="previewLabel" />
        </div>
    </div>
</template>

<style>
html,
body,
#app {
    height: 100%;
    margin: 0;
}
body {
    font: 13px/1.4 system-ui, sans-serif;
    color: #1d2330;
}
</style>

<style scoped>
.app {
    /* 换外观：设库的 --nb-layout-* 变量。这里只改了几个，其余用库的缺省；全部名单在根入口的 NB_LAYOUT_THEME_VARS。 */
    --nb-layout-sash-line-color: #4f6bed;
    --nb-layout-drop-area-fill: color-mix(in srgb, #4f6bed 14%, transparent);
    --nb-layout-drop-area-border: #4f6bed;
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #20263a;
}
.app--dragging {
    cursor: grabbing;
    user-select: none;
}
.toolbar {
    display: flex;
    flex: none;
    gap: 12px;
    align-items: center;
    height: 36px;
    padding: 0 12px;
    background: #f6f7f9;
    border-bottom: 1px solid #d5d9e0;
}
.status {
    overflow: hidden;
    margin: 0;
    color: #a33;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.grid-box {
    flex: 1;
    min-height: 0;
}
.desktop {
    height: 100%;
    background:
        radial-gradient(circle at 20% 15%, rgb(143 176 255 / 35%), transparent 45%),
        radial-gradient(circle at 85% 80%, rgb(180 140 255 / 30%), transparent 50%),
        #3b4a7a;
}
</style>
