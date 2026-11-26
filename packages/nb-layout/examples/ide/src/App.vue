<script setup lang="ts">
/**
 * 主界面：把模型接到 NestedGrid 上，再接一场拖动会话。读的顺序建议是 model.ts、drop.ts、这里。
 *
 * 几件事各在一处：
 * - 布局：useGridHost 管量尺寸、算布局、接分隔线的提交；模型直接改了树（收起、尺寸）之后调 invalidate。
 * - 内容：工具窗与编辑区的正文放在 NestedGrid 的内容层，按 key 认实例，换条、换区只换它所在的叶，打的字还在。
 * - 拖动：useDragSession 管按下、起拖、判落点、提交与取消；落点是什么由 drop.ts 定，提交调 model.ts 的操作。
 * - 键盘：快捷键挂在 window 上；焦点所在的工具窗被收起或换走时，焦点交给编辑区。
 * - 存档：每次布局变了就存；读档在启动时一次。
 */
import {computed, onBeforeUnmount, onMounted, shallowRef, triggerRef, useTemplateRef} from "vue";

import {DropFeedbackOverlay, NestedGrid, useDragSession, useGridHost} from "@notnotype/nb-layout/vue";
import type {DropFeedbackPreview} from "@notnotype/nb-layout/vue";
import type {GridContentInput} from "@notnotype/nb-layout";

import {dropKey, listOrientation, resolveDrop, type Drop, type StripGeometry} from "./drop";
import {EDITOR, loadLayout, saveLayout, STRIPE, STRIPE_IDS, TOOL_IDS, TOOLS, ZONES, type LayoutStorage, type Result, type Zone} from "./model";
import ToolPanel from "./ToolPanel.vue";
import ToolStripe from "./ToolStripe.vue";

/** 面板头的高度：工具窗的标题条与编辑区的标签条。库不量面板头，内容层从叶的顶上往下让出 `insetTop` 这么多，样式读同一个数。 */
const TOOL_HEAD_HEIGHT = 28;
const EDITOR_HEAD_HEIGHT = 32;
const FILES = ["main.ts", "util.ts", "README.md"];
const TITLES = Object.fromEntries(TOOLS.map((tool) => [tool.id, tool.title])) as Record<string, string>;
const STRIP_LABELS: Record<Zone, string> = {left: "Left", right: "Right", bottom: "Bottom"};

/** 浏览器禁用存储（某些隐私模式、沙箱里的 iframe）时连读 `localStorage` 都会抛错。 */
function openStorage(): LayoutStorage | null {
    try {
        return window.localStorage;
    } catch {
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
/** 状态行里一次性的话：读档失败的说明、保存失败、操作被拒的原因。下一次成功的操作会清掉它。平时空着。 */
const status = shallowRef(loaded.notice ?? "");
/**
 * 状态行里一直在的话：这一页不再保存（存储不可用，或存档读不了而备份也写不进去）。它说的不是上一件事而是现在的状态，
 * 不能被后面的成功操作清掉，直到重新载入；不然用户看到一切正常、改动却没有保存。
 */
const standingNotice = loaded.keep ? "" : (loaded.notice ?? "");
/** 状态行显示的：一次性的话优先（操作被拒的原因要看得见），没有时显示一直在的。 */
const statusText = computed(() => status.value || standingNotice);
const editorFile = shallowRef(FILES[0]!);

function persist(): void {
    // 存档读不了、备份也没写进去时不再保存：再存就拿缺省布局覆盖了原件。
    if (!loaded.keep) return;
    const failed = saveLayout(storage, layout.value);
    if (failed !== null) status.value = failed;
}

/** 分隔线的手势落账之后：网格只管尺寸，区被拖开时里面显示什么要宿主补（见 model.ts 的 reconcile）。 */
function afterApplied(): void {
    layout.value.reconcile();
    triggerRef(layout);
    persist();
}

// contextKey 标出这是哪一块布局：换了它，进行中的旧手势就不落账。onIssues 是诊断的唯一出口，示例只在控制台说出来。
const host = useGridHost({
    grid,
    contextKey: "ide",
    onApplied: afterApplied,
    onIssues: (issues) => console.warn("nb-layout reported issues", issues),
});
const gridView = useTemplateRef<InstanceType<typeof NestedGrid>>("gridView");
const box = useTemplateRef<HTMLElement>("box");

/** 操作成功：树可能变了，通知网格重算；模板跟着重算；存档。失败：说出原因，模型没动。 */
function settle(result: Result): boolean {
    if (!result.ok) {
        status.value = result.message;
        return false;
    }
    // 一次性的话说的是上一件事（读档、上次保存、上次被拒）；这次成功了就清掉，保存再失败会重新写上。一直在的那句不在这里。
    status.value = "";
    host.invalidate();
    triggerRef(layout);
    persist();
    return true;
}

/**
 * 每个区的视图：这一条上的工具窗、区显示的。收起状态在网格里（拖过最小尺寸也会收起），网格重发布局时版本会变，
 * 读它才会跟着重算。
 */
const zoneViews = computed(() => {
    void host.revision.value;
    const model = layout.value;
    return Object.fromEntries(ZONES.map((zone) => [zone, {
        tools: model.strips[zone].map((id) => ({id, title: TITLES[id]!})),
        shown: model.shown[zone],
        open: model.isCollapsed(zone) ? null : model.shown[zone],
    }])) as Record<Zone, {tools: {id: string; title: string}[]; shown: string | null; open: string | null}>;
});

/**
 * 内容层：每个工具窗与每个文件一项。工具窗按它此刻所在的条的区挂叶，只有区展开且显示它的才 active，别的停放、不卸载。
 * 工具窗从一条拖到另一条，只是这一项的 leaf 变了：实例与里面打的字都还在。
 */
const contents = computed<GridContentInput[]>(() => {
    void host.revision.value;
    const model = layout.value;
    return [
        ...TOOLS.map((tool) => ({key: tool.id, leaf: model.zoneOf(tool.id)!, insetTop: TOOL_HEAD_HEIGHT, active: model.isOpen(tool.id)})),
        ...FILES.map((file) => ({key: `file:${file}`, leaf: EDITOR, insetTop: EDITOR_HEAD_HEIGHT, active: file === editorFile.value})),
    ];
});

/** 最大化编辑区：它盖住除 exclude 以外全部叶的外接矩形，三条按钮条要排除在外，下条在 main 外面才不会落进这个矩形。 */
const maximized = computed(() => (layout.value.maximized ? {leaf: EDITOR, exclude: STRIPE_IDS} : null));

const stripZone = (id: string): Zone | undefined => ZONES.find((zone) => STRIPE[zone] === id);
const toolZone = (id: string): Zone | undefined => ZONES.find((zone) => zone === id);

const PANE_LABELS: Record<string, string> = {
    "left-stripe": "Left strip", "right-stripe": "Right strip", "bottom-stripe": "Bottom strip",
    left: "Left tool window", right: "Right tool window", bottom: "Bottom tool window", editor: "Editor",
};
/** 分隔线的读屏名称念面板的名字，不念 id；挨着分支时库也会问分支的 id，那时交回 undefined 用 id。 */
const paneLabel = (id: string) => PANE_LABELS[id];
/**
 * 这条分隔线此刻不能拖。它读模型里的按钮条，所以这个函数在渲染时调、读到的是响应式状态：条上的按钮变了，
 * 下一次渲染里它的结果就跟着变。
 */
const sashDisabled = (sash: {readonly before: string; readonly after: string}) => layout.value.sashLocked(sash.before, sash.after);

function focusEditor(): void {
    box.value?.querySelector<HTMLElement>(`[data-editor-text="${CSS.escape(editorFile.value)}"]`)?.focus();
}

/** 焦点在哪个区里：区的面板头在叶的外框里（`data-leaf`），正文在内容层里（`data-content-leaf`）。 */
function focusedZone(): Zone | null {
    const element = document.activeElement?.closest<HTMLElement>("[data-leaf], [data-content-leaf]");
    return toolZone(element?.dataset.leaf ?? element?.dataset.contentLeaf ?? "") ?? null;
}

/**
 * 工具窗被收起、换走或被最大化盖住时，库把它的内容停放；焦点还在里面就发这个事件，焦点去哪由宿主定。
 * 所有路径（点按钮、快捷键、拖分隔线收起、最大化）都经这一处，不用在每个操作里记“之前焦点在哪”。
 * 只有焦点在工具窗的正文里才会发：焦点在面板头的“隐藏”按钮上时，隐藏按钮自己的处理另给焦点。
 */
function onContentParked(key: string): void {
    if (TOOL_IDS.includes(key)) focusEditor();
}

function toggleTool(tool: string): void {
    settle(layout.value.toggleTool(tool));
}

function hide(zone: Zone): void {
    // 区收着时 `shown` 还留着（下次展开还是它），toggleTool 会把它当成“展开”：隐藏只对展开着的区有意义。
    if (layout.value.isCollapsed(zone)) return;
    const tool = layout.value.shown[zone];
    if (tool !== null && settle(layout.value.toggleTool(tool))) focusEditor();
}

function toggleMaximized(): void {
    settle(layout.value.toggleMaximized());
}

/**
 * 快捷键挂在 window 上，按 `event.code` 判（不按 `event.key`：Shift 按下时 `key` 是 “!” “@” 这样的字符，随键盘布局变）。
 * 挂在示例的根上不行：点到面板头这类不能聚焦的地方后焦点落到 body，根上收不到键盘事件。
 * Alt 加数字在 Linux 的 Chrome 里是切换浏览器标签，所以加了 Shift。
 */
function onWindowKeydown(event: KeyboardEvent): void {
    // 拖动中不处理：Escape 要留给拖动会话取消这一场。
    if (event.defaultPrevented || drag.state.value !== null) return;
    if (event.key === "Escape") {
        if (focusedZone() === null) return;
        event.preventDefault();
        focusEditor();
        return;
    }
    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
    if (event.code === "KeyM") {
        event.preventDefault();
        toggleMaximized();
        return;
    }
    const digit = /^Digit([1-6])$/u.exec(event.code);
    if (digit === null) return;
    event.preventDefault();
    toggleTool(TOOLS[Number(digit[1]) - 1]!.id);
}
onMounted(() => window.addEventListener("keydown", onWindowKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onWindowKeydown));

/**
 * 这一刻每条按钮条的几何，每次判落点现量：整条的外框（空条也是落点）与每个按钮的矩形。
 * 落点指示的手感下拖动中布局不变，现量读到的就是画面上的样子。窗口缩放会让网格重发布局，整场拖动由 structure 取消。
 * 起拖时如果还有过渡在走（刚收起、刚展开），activate 先把它送到终点：库的分隔线手势自己会做，宿主的拖动会话要自己调。
 */
function measure(): StripGeometry[] {
    const root = box.value;
    if (root === null) return [];
    return ZONES.flatMap((strip) => {
        const frame = root.querySelector<HTMLElement>(`[data-leaf="${STRIPE[strip]}"]`);
        const buttons = [...root.querySelectorAll<HTMLElement>(`[data-tool-strip][data-strip="${strip}"] [data-tool-button]`)];
        if (frame === null) return [];
        return [{strip, rect: frame.getBoundingClientRect(), buttons: buttons.map((element) => ({id: element.dataset.toolButton!, rect: element.getBoundingClientRect()}))}];
    });
}

const drag = useDragSession<string, Drop>(box, () => ({
    // 来源：按在按钮条的按钮上。区的面板头、编辑区里的东西都不是来源。
    sourceAt: (target) => target.closest<HTMLElement>("[data-tool-button]")?.dataset.toolButton ?? null,
    activate: () => {
        gridView.value?.settleMotion();
        return true;
    },
    // 一场里网格重发了布局（窗口缩放、别处改了树），整场取消，不拿旧的落点提交。
    structure: () => String(host.revision.value),
    resolve: ({source, point}) => {
        const model = layout.value;
        const strip = model.zoneOf(source);
        if (strip === undefined) return null;
        return resolveDrop(source, {strip, order: model.strips[strip]}, point, measure());
    },
    actionKey: dropKey,
    // 最大化时拖动照常，放下才退出最大化再移动（moveTool 里做）。
    commit: (drop, tool) => void settle(layout.value.moveTool(tool, drop.strip, drop.before)),
}));

const dragging = computed(() => drag.state.value !== null);
const currentDrop = computed(() => drag.state.value?.drop ?? null);

const preview = computed<DropFeedbackPreview | null>(() => {
    const drop = currentDrop.value;
    return drop === null ? null : {areaRect: null, indicator: drop.indicator, orientation: listOrientation(drop.strip)};
});
const previewLabel = computed(() => {
    const drop = currentDrop.value;
    const tool = drag.state.value?.source;
    return drop === null || tool === undefined ? "" : `Move ${TITLES[tool]} to the ${STRIP_LABELS[drop.strip].toLowerCase()} strip`;
});
</script>

<template>
    <div class="app" :class="{'app--dragging': dragging}" :style="{'--tool-head-height': `${TOOL_HEAD_HEIGHT}px`, '--editor-head-height': `${EDITOR_HEAD_HEIGHT}px`}">
        <header class="titlebar">
            <!-- 状态行在网格外面、高度固定：文字变了不改网格的尺寸，拖动不会因此被取消。 -->
            <p class="status" role="status" data-status>{{ statusText }}</p>
        </header>
        <!-- 承载盒要有确定的高度：NestedGrid 铺满它、自己量它。data-drop 是此刻的落点，拖动时才有。 -->
        <div ref="box" class="grid-box" :data-drop="dragging ? (currentDrop === null ? 'none' : dropKey(currentDrop)) : undefined">
            <NestedGrid
                ref="gridView"
                v-bind="host.bindings.value"
                :contents="contents"
                :maximized="maximized"
                :dragging="dragging"
                :pane-label="paneLabel"
                :sash-disabled="sashDisabled"
                @content-parked="onContentParked"
            >
                <template #leaf="{node}">
                    <ToolStripe
                        v-if="stripZone(node.id) !== undefined"
                        :strip="stripZone(node.id)!"
                        :label="`${STRIP_LABELS[stripZone(node.id)!]} tool windows`"
                        :tools="zoneViews[stripZone(node.id)!].tools"
                        :open="zoneViews[stripZone(node.id)!].open"
                        @toggle="toggleTool"
                    />
                    <header v-else-if="toolZone(node.id) !== undefined" class="tool-head" :data-zone-head="node.id">
                        <span class="tool-head__title">{{ zoneViews[toolZone(node.id)!].shown === null ? "" : TITLES[zoneViews[toolZone(node.id)!].shown!] }}</span>
                        <!-- 只在区展开时画：读档时就收着的叶从第一帧起是零尺寸，库不会把它停放成 inert，按钮留着就能被 Tab 走到、按下去反而展开这个区。 -->
                        <button v-if="zoneViews[toolZone(node.id)!].open !== null" type="button" class="tool-head__hide" data-tool-hide :aria-label="`Hide ${TITLES[zoneViews[toolZone(node.id)!].shown!]}`" @click="hide(toolZone(node.id)!)">&minus;</button>
                    </header>
                    <header v-else-if="node.id === EDITOR" class="editor-head">
                        <button v-for="file in FILES" :key="file" type="button" class="editor-head__tab" :data-editor-tab="file" :aria-pressed="file === editorFile" @click="editorFile = file">{{ file }}</button>
                        <button type="button" class="editor-head__maximize" data-action="maximize" :aria-pressed="layout.maximized" @click="toggleMaximized()">{{ layout.maximized ? "Restore" : "Maximize" }}</button>
                    </header>
                </template>
                <template #content="{contentKey}">
                    <ToolPanel v-if="TOOL_IDS.includes(contentKey)" :tool="contentKey" :title="TITLES[contentKey]!" />
                    <textarea v-else class="editor-text" :aria-label="`Contents of ${contentKey.slice(5)}`" :data-editor-text="contentKey.slice(5)" spellcheck="false" />
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
    background: #d5d9e0;
}
.app--dragging {
    cursor: grabbing;
    user-select: none;
}
.titlebar {
    display: flex;
    flex: none;
    align-items: center;
    height: 28px;
    padding: 0 8px;
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
.tool-head,
.editor-head {
    box-sizing: border-box; /* 高度连下边框一共是面板头的高度，内容层的 insetTop 读的是同一个数。 */
    display: flex;
    align-items: center;
    overflow: hidden;
    background: #eef0f4;
    border-bottom: 1px solid #d5d9e0;
}
.tool-head {
    height: var(--tool-head-height);
    padding: 0 4px 0 10px;
}
.tool-head__title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
}
.tool-head__hide {
    width: 22px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: #667;
    cursor: pointer;
}
.tool-head__hide:hover {
    background: #dde1e8;
}
.editor-head {
    height: var(--editor-head-height);
}
.editor-head__tab,
.editor-head__maximize {
    align-self: stretch;
    padding: 0 12px;
    border: 0;
    border-right: 1px solid #d5d9e0;
    background: none;
    font: inherit;
    cursor: pointer;
}
.editor-head__tab[aria-pressed="true"] {
    background: #fff;
}
.editor-head__maximize {
    margin-left: auto;
    border-right: 0;
    border-left: 1px solid #d5d9e0;
}
.editor-text {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    padding: 12px;
    border: 0;
    resize: none;
    font: 13px/1.5 ui-monospace, monospace;
    outline: none;
}
</style>
