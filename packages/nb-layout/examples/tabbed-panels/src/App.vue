<script setup lang="ts">
/**
 * 主界面：把模型接到 NestedGrid 上，再接一场拖动会话。读的顺序建议是 model.ts、drop.ts、这里。
 *
 * 几件事各在一处：
 * - 布局：useGridHost 管量尺寸、算布局、接分隔线的提交；结构变了调 invalidate。
 * - 内容：标签的正文放在 NestedGrid 的内容层，按标签 key 认实例，挪编组只换它所在的叶，打的字还在。
 * - 拖动：useDragSession 管按下、起拖、判落点、提交与取消；落点是什么由 drop.ts 定，提交调 model.ts 的操作。
 * - 存档：每次布局变了就存；读档在启动时一次。
 */
import {computed, nextTick, shallowRef, triggerRef, useTemplateRef} from "vue";

import {moveGridFocus, NestedGrid, DropFeedbackOverlay, useDragSession, useGridHost} from "@notnotype/nb-layout/vue";
import type {DropFeedbackPreview} from "@notnotype/nb-layout/vue";
import type {GridContentInput} from "@notnotype/nb-layout";

import {actionKey, dropKey, resolveDrop, type Drop, type GroupGeometry} from "./drop";
import {EXPLORER, loadLayout, saveLayout, type LayoutStorage, type Result} from "./model";
import TabBar from "./TabBar.vue";
import TabPanel from "./TabPanel.vue";

/** 标签条的高度：标签条的样式与内容层的 `insetTop` 读同一个数。库不量面板头，内容层从叶的顶上往下让出这么多。 */
const TAB_BAR_HEIGHT = 32;

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
/** 这一页不保存时（存档读不了、备份也写不进）的提示：一直挂着，直到重新载入，不被后面成功的操作清掉。 */
const sticky = loaded.keep ? "" : (loaded.notice ?? "");
/** 状态行：读档失败、保存失败、操作被拒的原因。平时空着。 */
const status = shallowRef(loaded.notice ?? "");

function persist(): void {
    // 存档读不了、备份也没写进去时不再保存：再存就拿缺省布局覆盖了原件。
    if (!loaded.keep) return;
    const failed = saveLayout(storage, layout.value);
    if (failed !== null) status.value = failed;
}

// contextKey 标出这是哪一块布局：换了它，进行中的旧手势就不落账。onApplied 在拖完分隔线落账之后、经 host 收起或展开之后都会调：在这里存档。
// onIssues 是诊断的唯一出口，示例只在控制台说出来。
const host = useGridHost({
    grid,
    contextKey: "tabbed-panels",
    onApplied: persist,
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
    // 状态行说的是上一件事（读档、上次保存、上次被拒）；这次成功了就清掉，保存再失败会重新写上。
    status.value = sticky;
    host.invalidate();
    triggerRef(layout);
    persist();
    return true;
}

const groupLabel = (id: string) => `Group ${id.replace(/^group-/u, "")}`;

/** 每个编组的标签条要的东西；模板里的 v-for 读它，经属性交给 TabBar。 */
const groupViews = computed(() => {
    const model = layout.value;
    // 能不能关只问模型：规则只在 canClose 一处，界面不另写一份。
    return new Map([...model.groups].map(([id, group]) => [id, {...group, closable: model.canClose(group.tabs[0]!)}]));
});

/** 内容层：每个标签一项，只有选中的 active。`leave: "retain"`：关掉最后一个标签时，库把它留到编组缩回去之后再卸载。 */
const contents = computed<GridContentInput[]>(() => [...groupViews.value].flatMap(([group, view]) =>
    view.tabs.map((tab) => ({key: tab, leaf: group, insetTop: TAB_BAR_HEIGHT, active: view.active === tab, leave: "retain" as const}))));

const explorerCollapsed = computed(() => {
    void host.revision.value; // 收起状态在网格里，网格重发布局时版本会变，读它才会跟着重算。
    return layout.value.explorerState().collapsed;
});
function toggleExplorer(): void {
    // 收起变了会走 onApplied，存档在那里。
    const result = host.setCollapsed(EXPLORER, !explorerCollapsed.value);
    if (!result.ok) status.value = result.message;
}

/** 焦点在哪个编组里：标签条带 `data-group`，正文在内容层里、带库写的 `data-content-leaf`。 */
function focusedGroup(): string | null {
    const element = document.activeElement?.closest<HTMLElement>("[data-group], [data-content-leaf]");
    return element?.dataset.group ?? element?.dataset.contentLeaf ?? null;
}

function focusActiveTab(group: string): void {
    const active = layout.value.groups.get(group)?.active;
    if (active === undefined) return;
    box.value?.querySelector<HTMLElement>(`[data-tab-strip][data-group="${CSS.escape(group)}"] [data-tab-button="${CSS.escape(active)}"]`)?.focus();
}

/**
 * 切换与关闭之后的焦点由这里给。关掉的标签带着它的按钮从页面上消失，焦点会掉到 body；正文被停放时也一样。
 * 先记下受影响的编组与它在树序上的邻居（操作之后编组可能已经没了），操作成功后：焦点原来在这个编组里的，
 * 给它新选中的标签；编组没了，给邻居选中的标签。
 */
function withFocus(group: string | undefined, operation: () => Result): void {
    if (group === undefined) return;
    const ids = layout.value.groupIds();
    const index = ids.indexOf(group);
    const neighbor = ids[index - 1] ?? ids[index + 1];
    const hadFocus = focusedGroup() === group;
    if (!settle(operation())) return;
    if (!hadFocus) return;
    void nextTick(() => {
        const target = layout.value.groups.has(group) ? group : neighbor;
        if (target !== undefined) focusActiveTab(target);
    });
}
const activate = (tab: string) => withFocus(layout.value.groupOf(tab), () => layout.value.activate(tab));
const close = (tab: string) => withFocus(layout.value.groupOf(tab), () => layout.value.closeTab(tab));

function reveal(tab: string): void {
    const group = layout.value.groupOf(tab);
    if (group === undefined || !settle(layout.value.activate(tab))) return;
    void nextTick(() => focusActiveTab(group));
}
const files = computed(() => [...layout.value.groups.values()].flatMap((group) => group.tabs).sort());

/**
 * 这一刻每个编组的几何，每次判落点现量。落点指示的手感下拖动中布局不变，现量读到的就是画面上的样子。
 * 窗口缩放会让网格重发布局，整场拖动由 structure 取消，不会拿缩放前的几何判。
 * 起拖时如果还有过渡在走（刚关掉、刚拆分），activate 先把它送到终点：库的分隔线手势自己会做，宿主的拖动会话要自己调。
 */
function measure(): GroupGeometry[] {
    const root = box.value;
    if (root === null) return [];
    return layout.value.groupIds().flatMap((group) => {
        const strip = root.querySelector<HTMLElement>(`[data-tab-strip][data-group="${CSS.escape(group)}"]`);
        const frame = root.querySelector<HTMLElement>(`[data-leaf="${CSS.escape(group)}"]`);
        if (strip === null || frame === null) return [];
        const tabs = [...strip.querySelectorAll<HTMLElement>("[data-tab]")].map((element) => ({id: element.dataset.tab!, rect: element.getBoundingClientRect()}));
        const outer = frame.getBoundingClientRect();
        return [{group, strip: strip.getBoundingClientRect(), tabs, body: {left: outer.left, top: outer.top + TAB_BAR_HEIGHT, right: outer.right, bottom: outer.bottom}}];
    });
}

/** 一场拖动里试拆的结果：拖动中树不变（尺寸变了 structure 会取消整场），同一个编组同一边只试一次。 */
const splitTrials = new Map<string, string | null>();

const drag = useDragSession<string, Drop>(box, () => ({
    // 来源：按在标签上。关闭按钮也在标签里，要排除它，不然按住关闭按钮一拖就起拖了。
    sourceAt: (target) => (target.closest("[data-tab-close]") !== null ? null : (target.closest<HTMLElement>("[data-tab]")?.dataset.tab ?? null)),
    activate: () => {
        gridView.value?.settleMotion();
        splitTrials.clear();
        return true;
    },
    // 一场里网格重发了布局（窗口缩放、别处改了树），整场取消，不拿旧的落点提交。
    structure: () => String(host.revision.value),
    resolve: ({source, point}) => {
        const model = layout.value;
        const from = model.groupOf(source);
        if (from === undefined) return null;
        const drop = resolveDrop(source, {id: from, group: model.groups.get(from)!}, point, measure());
        const extent = host.extent.value;
        if (drop?.kind !== "split" || extent === null) return drop;
        const key = `${drop.group}:${drop.side}`;
        if (!splitTrials.has(key)) {
            const trial = model.canSplit(source, drop.group, drop.side, extent);
            splitTrials.set(key, trial.ok ? null : trial.message);
        }
        return {...drop, blocked: splitTrials.get(key) ?? null};
    },
    actionKey,
    commit: (drop, tab) => {
        const model = layout.value;
        // 按下标签时焦点就在它的按钮上；挪过去之后来源那份按钮没了，焦点会掉到 body。跟着标签走到它的新位置。
        const hadFocus = focusedGroup() !== null;
        const result = drop.kind === "insert" ? model.moveTab(tab, drop.group, drop.before) : drop.kind === "into" ? model.moveTab(tab, drop.group, null) : model.splitWithTab(tab, drop.group, drop.side);
        if (!settle(result) || !hadFocus) return;
        void nextTick(() => {
            const group = layout.value.groupOf(tab);
            if (group !== undefined) focusActiveTab(group);
        });
    },
}));

const dragging = computed(() => drag.state.value !== null);
const currentDrop = computed(() => drag.state.value?.drop ?? null);

const preview = computed<DropFeedbackPreview | null>(() => {
    const drop = currentDrop.value;
    if (drop === null) return null;
    if (drop.kind === "insert") return {areaRect: null, indicator: drop.indicator, orientation: "horizontal"};
    if (drop.kind === "into") return {areaRect: drop.area, indicator: null, orientation: "horizontal"};
    // armed 为假：照样画出那半边，但淡下去，告诉用户松手不会拆。
    return {areaRect: drop.area, indicator: null, orientation: drop.side === "left" || drop.side === "right" ? "horizontal" : "vertical", armed: drop.blocked === null};
});
const previewLabel = computed(() => {
    const drop = currentDrop.value;
    if (drop === null) return "";
    if (drop.kind === "insert") return `Move to ${groupLabel(drop.group)}`;
    if (drop.kind === "into") return `Move to ${groupLabel(drop.group)}`;
    return drop.blocked ?? `Split ${drop.side}`;
});

function onKeydown(event: KeyboardEvent): void {
    // F6 在侧栏与编组之间走；moveGridFocus 返回有没有移动，没有就不拦这个键。
    if (event.key === "F6" && moveGridFocus(box.value, event.shiftKey ? "previous" : "next")) event.preventDefault();
}

/** 分隔线的读屏名称念面板的名字，不念生成的 id；挨着分支时库也会问分支的 id，那时交回 undefined 用 id。 */
const paneLabel = (id: string) => (id === EXPLORER ? "Explorer" : layout.value.groups.has(id) ? groupLabel(id) : undefined);
</script>

<template>
    <div class="app" :class="{'app--dragging': dragging}" :style="{'--tab-bar-height': `${TAB_BAR_HEIGHT}px`}">
        <header class="toolbar">
            <button type="button" data-action="toggle-explorer" @click="toggleExplorer()">{{ explorerCollapsed ? "Show explorer" : "Hide explorer" }}</button>
            <!-- 状态行在网格外面、高度固定：文字变了不改网格的尺寸，拖动不会因此被取消。 -->
            <p class="status" role="status" data-status>{{ status }}</p>
        </header>
        <!-- 承载盒要有确定的高度：NestedGrid 铺满它、自己量它。data-drop 是此刻的落点，拖动时才有。 -->
        <div ref="box" class="grid-box" :data-drop="dragging ? (currentDrop === null ? 'none' : dropKey(currentDrop)) : undefined" @keydown="onKeydown">
            <NestedGrid ref="gridView" v-bind="host.bindings.value" :contents="contents" :dragging="dragging" :pane-label="paneLabel">
                <template #leaf="{node}">
                    <nav v-if="node.id === EXPLORER" class="explorer" aria-label="Files">
                        <button v-for="file in files" :key="file" type="button" class="explorer__file" @click="reveal(file)">{{ file }}</button>
                    </nav>
                    <TabBar
                        v-else-if="groupViews.has(node.id)"
                        :group="node.id"
                        :label="groupLabel(node.id)"
                        :tabs="groupViews.get(node.id)!.tabs"
                        :active="groupViews.get(node.id)!.active"
                        :closable="groupViews.get(node.id)!.closable"
                        @activate="activate"
                        @close="close"
                    />
                </template>
                <template #content="{contentKey}">
                    <TabPanel :tab="contentKey" />
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
.toolbar {
    display: flex;
    flex: none;
    gap: 12px;
    align-items: center;
    height: 36px;
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
.explorer {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: auto;
    padding: 6px 0;
    background: #f6f7f9;
}
.explorer__file {
    padding: 3px 12px;
    border: 0;
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
}
.explorer__file:hover {
    background: #e6e9ef;
}
</style>
