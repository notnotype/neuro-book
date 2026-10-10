<script setup lang="ts">
/**
 * 产品的工作台外壳（同名 .md）：布局 store 接到纯布局组件，七个 Part 的内容，按钮接到面板命令；工具区域放容器与视图
 * （外壳二），实例层搬进各区域的落点。
 */
import {Tabs} from "@notnotype/nb-ui/components";
import {computed, defineAsyncComponent, defineComponent, h, markRaw, onBeforeUnmount, onMounted, reactive, ref, shallowRef, useId} from "vue";
import type {Component} from "vue";

import type {CommandService} from "nbook/plugins/commands/shared/contracts";
import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

import {
    PANEL_COMMAND_DECLARATIONS,
    SET_PANEL_ALIGNMENT_COMMAND,
    SET_PANEL_COLLAPSED_COMMAND,
    SET_PANEL_HIDDEN_COMMAND,
    SET_PANEL_POSITION_COMMAND,
    TOGGLE_PANEL_MAXIMIZED_COMMAND,
} from "../commands/panel-commands";
import {MOVE_VIEW_COMMAND, PART_LABELS, newContainerLabel} from "../commands/view-commands";
import {SHELL_PART_IDS} from "../shell/sizes";
import type {ShellLayoutFacts, ShellPartId, ShellSizePatch} from "../shell/sizes";
import {TeleportMemory} from "../shell/teleport-memory";
import type {LayoutStore} from "../state/layout-store";
import type {ViewLocation} from "../../shared/views";
import {createDragSession} from "../views/drag-session";
import type {DragSession} from "../views/drag-session";
import {moveTargetsOf} from "../views/presentation";
import type {ContainerPresentation} from "../views/presentation";
import type {ViewSource} from "../views/registry";
import type {EditorAreaContext} from "../contracts";
import type {EditorAreaSource} from "../editor-area";
import WorkbenchActivityBar from "./WorkbenchActivityBar.vue";
import WorkbenchDragFeedback from "./WorkbenchDragFeedback.vue";
import WorkbenchMoveViewMenu from "./WorkbenchMoveViewMenu.vue";
import type {MovePayload, MoveTargetGroup} from "./WorkbenchMoveViewMenu.vue";
import WorkbenchPanelSurface from "./WorkbenchPanelSurface.vue";
import type {PanelFrameAction} from "./WorkbenchPanelSurface.vue";
import WorkbenchShellLayout from "./WorkbenchShellLayout.vue";
import WorkbenchStatusBar from "./WorkbenchStatusBar.vue";
import WorkbenchToolPartHost from "./WorkbenchToolPartHost.vue";
import {switcherPanelId, switcherTabId} from "./switcher-ids";
import WorkbenchViewInstances from "./WorkbenchViewInstances.vue";

defineOptions({name: "WorkbenchShell"});

const props = defineProps<{
    layout: LayoutStore;
    commands: CommandService;
    views: ViewSource;
    /** 编辑器槽的提供者；没有时（或没有贡献）槽里是欢迎文字。 */
    editorArea?: EditorAreaSource;
    project: string | null;
    locale: DisplayLocale;
}>();

const TEXT = {
    ready: {"zh-CN": "工作台已就绪。没有打开项目。", "en-US": "The workbench is ready. No project is open."},
    readyWithProject: {"zh-CN": "工作台已就绪。当前项目：{name}", "en-US": "The workbench is ready. Current project: {name}"},
    panel: {"zh-CN": "面板", "en-US": "Panel"},
    editorFailed: {"zh-CN": "编辑器加载失败：{reason}", "en-US": "The editor failed to load: {reason}"},
    emptyPart: {"zh-CN": "将视图拖动到此处显示", "en-US": "Drag a view here to show it"},
    emptyContainer: {"zh-CN": "容器里的视图都已隐藏", "en-US": "All views in this container are hidden"},
    activityBar: {"zh-CN": "活动栏", "en-US": "Activity Bar"},
    moveTo: {"zh-CN": "移动到", "en-US": "Move To"},
    resetLocation: {"zh-CN": "重置位置", "en-US": "Reset Location"},
    dragLabel: {"zh-CN": "拖动 {title}", "en-US": "Drag {title}"},
    dragHint: {"zh-CN": "按空格拿起并拖动", "en-US": "Press Space to pick up and drag"},
    dropMoveView: {"zh-CN": "移到这里", "en-US": "Move here"},
    dropDetachView: {"zh-CN": "新建容器", "en-US": "New container"},
    dropMoveContainer: {"zh-CN": "移动容器", "en-US": "Move container"},
    dropMergeContainer: {"zh-CN": "并入 {count} 个视图", "en-US": "Merge {count} views"},
} satisfies Record<string, LocalizedText>;

const text = (value: LocalizedText): string => localize(value, props.locale);
const welcome = computed(() => (props.project === null ? text(TEXT.ready) : text(formatText(TEXT.readyWithProject, {name: props.project}))));

const state = computed(() => props.layout.state);

/**
 * 编辑器槽的内容：提供者换了才换组件（重挂），布局变化只改 `visible`。面板最大化时编辑器内容停放（外壳一验收 6），
 * 对提供者就是不可见。
 */
const EditorAreaFailed = markRaw(defineComponent({
    props: {error: {type: Error, required: true}},
    setup: (failed) => () => h("p", {"class": "workbench-shell__editor-failed", "role": "alert"}, text(formatText(TEXT.editorFailed, {reason: failed.error.message}))),
}));
const editorContext: EditorAreaContext = {visible: computed(() => state.value.facts?.effectivePanel.maximized !== true)};
const editorComponent = computed((): Component | null => {
    const provider = props.editorArea?.current.value ?? null;
    if (provider === null) return null;
    return markRaw(defineAsyncComponent({
        loader: () => provider.load(),
        errorComponent: EditorAreaFailed,
    }));
});
/** 面板看不见：隐藏或拖到零。状态栏按钮此时是“显示面板”，执行时同时清除这两种（与命令的省略参数同一判断）。 */
const panelHidden = computed(() => state.value.panel.hidden || state.value.dragCollapsed.panel === true);

/** 框架按钮：可用性问命令系统；先读布局状态，让按钮随它重新求值（命令系统的可用性变化不通知）。 */
const FRAME: ReadonlyArray<{id: keyof typeof PANEL_COMMAND_DECLARATIONS; icon: string}> = [
    {id: SET_PANEL_POSITION_COMMAND, icon: "i-lucide-panel-bottom"},
    {id: SET_PANEL_ALIGNMENT_COMMAND, icon: "i-lucide-align-horizontal-space-between"},
    {id: SET_PANEL_COLLAPSED_COMMAND, icon: "i-lucide-chevrons-down"},
    {id: TOGGLE_PANEL_MAXIMIZED_COMMAND, icon: "i-lucide-maximize-2"},
    {id: SET_PANEL_HIDDEN_COMMAND, icon: "i-lucide-x"},
];
const frameActions = computed<ReadonlyArray<PanelFrameAction>>(() => {
    const {panel, ready, facts} = state.value;
    void [panel.position, panel.alignment, panel.hidden, panel.collapsed, panel.maximized, ready, facts?.mode];
    return FRAME.map(({id, icon}) => {
        const enabled = props.commands.isEnabled(id);
        const available = enabled.ok && enabled.value;
        return {
            id,
            icon,
            label: localize(PANEL_COMMAND_DECLARATIONS[id].title, props.locale),
            disabled: !available,
            ...(enabled.ok ? {} : {reason: enabled.reason}),
            ...(id === SET_PANEL_COLLAPSED_COMMAND ? {pressed: panel.collapsed} : id === TOGGLE_PANEL_MAXIMIZED_COMMAND ? {pressed: panel.maximized} : {}),
        };
    });
});

function run(id: string, args: Record<string, unknown> = {}): void {
    void props.commands.execute(id, args, {source: "user"});
}

function onResize(payload: {contextKey: string; patch: ShellSizePatch}): void {
    props.layout.actions.commitSizes(payload.patch);
}

function onLayout(facts: ShellLayoutFacts): void {
    props.layout.actions.acceptLayoutFacts(facts);
}

// ── 容器与视图（外壳二） ───────────────────────────────────────────────────

/** 三层 Teleport 共用一份滚动与焦点记忆；外壳一生不换。 */
const memory = new TeleportMemory();
const hostEl = ref<HTMLElement | null>(null);
const partTargets = reactive<Partial<Record<ViewLocation, HTMLElement>>>({});
function setPartTarget(part: ViewLocation, element: HTMLElement | null): void {
    if (element === null) delete partTargets[part];
    else partTargets[part] = element;
}

const presentation = computed(() => state.value.presentation);
const selectedOf = (part: ViewLocation): ContainerPresentation | null => {
    const id = presentation.value.parts[part].selected;
    return id === null ? null : (presentation.value.containers.get(id) ?? null);
};
const sidebarVisible = computed(() => !state.value.hiddenParts.includes("sidebar") && state.value.dragCollapsed.sidebar !== true);
/** 看得见的工具区域：未隐藏、未拖到零；面板还要未收起成标题头。 */
const shownParts = computed<ViewLocation[]>(() => {
    const {hiddenParts, dragCollapsed, facts} = state.value;
    const shown: ViewLocation[] = [];
    if (sidebarVisible.value) shown.push("sidebar");
    if (!hiddenParts.includes("auxiliarybar") && dragCollapsed.auxiliarybar !== true) shown.push("auxiliarybar");
    if (!panelHidden.value && facts?.effectivePanel.collapsed !== true) shown.push("panel");
    return shown;
});

const activityContainers = computed(() => presentation.value.parts.sidebar.switcher.map((item) => ({id: item.containerId, label: text(item.title), icon: item.icon})));

/** ActivityBar：切到这个容器；Sidebar 看不见时同时打开它（被隐藏的显示、拖到零的按记忆尺寸展开）。 */
function selectSidebarContainer(containerId: string): void {
    props.layout.actions.applyView({kind: "select-container", part: "sidebar", containerId});
    props.layout.actions.setPartHidden("sidebar", false);
}

function selectContainer(part: ViewLocation, containerId: string): void {
    props.layout.actions.applyView({kind: "select-container", part, containerId});
}

/** 标签与内容面板关联的 id 前缀：外壳一生取一次。 */
const idPrefix = useId();
const panelTabs = computed(() => presentation.value.parts.panel.switcher.map((item) => ({
    value: item.containerId,
    attrs: {"data-switcher-entry": item.containerId, "data-drag-container": item.containerId, "aria-description": text(TEXT.dragHint)},
    label: text(item.title),
    iconClass: item.icon,
    id: switcherTabId(idPrefix, "panel", item.containerId),
    controls: switcherPanelId(idPrefix, "panel"),
})));

/** 视图实例的代际（实例层报上来）。 */
const generations = shallowRef<ReadonlyMap<string, number>>(new Map());

/** “移动到”菜单的输入：目标按 Part 分组，标题与图标与 Switcher 同源。 */
function moveMenuOf(viewId: string): {groups: MoveTargetGroup[]; source: string; resetLabel: string | null; identity: string} | null {
    const targets = moveTargetsOf(presentation.value, state.value.placement, state.value.catalog, viewId);
    if (targets === null) return null;
    const container = presentation.value.containers.get(targets.sourceContainerId);
    return {
        groups: targets.groups.map((group) => ({
            part: group.part,
            label: text(PART_LABELS[group.part]),
            targets: group.targets.map((target) => ({id: target.containerId, label: text(target.title), icon: target.icon})),
            createLabel: text(newContainerLabel(group.part)),
        })),
        source: targets.sourceContainerId,
        resetLabel: targets.canReset ? text(TEXT.resetLocation) : null,
        // 菜单目标身份：视图、来源容器、容器模式、交付状态与实例代际任一变化，已打开的菜单就关闭。
        identity: `${viewId}|${targets.sourceContainerId}|${container?.mode ?? ""}|${props.views.delivery(viewId).kind}|${String(generations.value.get(viewId) ?? 0)}`,
    };
}

function moveView(payload: MovePayload): void {
    void props.commands.execute(MOVE_VIEW_COMMAND, payload, {source: "user"});
}

function resetView(viewId: string): void {
    props.layout.actions.applyView({kind: "reset-view", viewId});
}

/**
 * 最近获得焦点的 Part（输出 27）：焦点进到外壳里某个 Part 的内容时上报。停放区、命令面板与菜单浮层不在任何 Part 里，
 * 焦点到那里时保持原值。视图实例搬进 Part 的落点后才在 `[data-shell-slot]` 之下，所以按焦点此刻所在的 DOM 求。
 */
function onFocusIn(event: FocusEvent): void {
    const part = event.target instanceof Element ? event.target.closest("[data-shell-slot]")?.getAttribute("data-shell-slot") : null;
    if (part !== null && part !== undefined && (SHELL_PART_IDS as ReadonlyArray<string>).includes(part)) props.layout.actions.focusPart(part as ShellPartId);
}

/** single 时上提到区域标题行的动作：容器里唯一可见的视图的“移动到”。 */
const singleViewOf = (container: ContainerPresentation): string | null => (container.mode === "single" ? (container.views[0]?.id ?? null) : null);

// ── 拖放（外壳三） ─────────────────────────────────────────────────────────

/** 拖放会话装在外壳根上：组件只写拖动源与落点的标记，按下、命中、判定与提交都在会话里。 */
const drag = shallowRef<DragSession | null>(null);
onMounted(() => {
    drag.value = createDragSession({
        root: hostEl.value!,
        presentation: () => presentation.value,
        catalog: () => state.value.catalog,
        enabled: () => state.value.ready,
        commit: (intent) => {
            props.layout.actions.applyView(intent);
        },
    });
});
onBeforeUnmount(() => drag.value?.dispose());

const dragState = computed(() => drag.value?.state.value ?? null);
const dragGhost = computed(() => {
    const current = dragState.value;
    if (current === null) return null;
    const {source, point} = current;
    const declaration = source.kind === "view" ? state.value.catalog.get(source.viewId) : undefined;
    const container = presentation.value.containers.get(source.containerId);
    const title = declaration?.title ?? container?.title;
    const icon = declaration?.icon ?? container?.icon ?? "";
    return title === undefined ? null : {label: text(title), icon, x: point.x, y: point.y};
});
const dropFeedback = computed(() => {
    const decision = dragState.value?.decision ?? null;
    const preview = decision === null || decision.kind === "rejected" ? null : (decision.preview ?? null);
    if (preview === null) return {preview: null, label: "", kind: "", count: 0};
    const kind = decision!.kind === "commit" ? decision!.intent.kind : "noop";
    const label = kind === "move-view" ? text(TEXT.dropMoveView)
        : kind === "detach-view" ? text(TEXT.dropDetachView)
            : kind === "move-container" ? text(TEXT.dropMoveContainer)
                : kind === "merge-container" ? text(formatText(TEXT.dropMergeContainer, {count: preview.count}))
                    : "";
    return {preview: {areaRect: preview.areaRect, entryRect: null, indicator: preview.indicator, orientation: preview.orientation}, label, kind, count: preview.count};
});
</script>

<template>
    <div ref="hostEl" class="workbench-shell-host" tabindex="-1" @focusin="onFocusIn">
    <WorkbenchShellLayout
        class="workbench-shell"
        :sizes="state.sizes"
        :panel="state.panel"
        context-key="workbench"
        :hidden-parts="state.hiddenParts"
        :drag-collapsed-parts="state.dragCollapsed"
        :disabled="!state.ready"
        :memory="memory"
        @resize="onResize"
        @layout="onLayout"
    >
        <template #titlebar>
            <div class="workbench-shell__titlebar">
                <span class="workbench-shell__app">NeuroBook</span>
                <span v-if="project !== null" class="workbench-shell__project">{{ project }}</span>
            </div>
        </template>
        <template #activitybar>
            <WorkbenchActivityBar :label="text(TEXT.activityBar)" :containers="activityContainers" :selected="presentation.parts.sidebar.selected" :sidebar-visible="sidebarVisible" :drag-hint="text(TEXT.dragHint)" @select="selectSidebarContainer" />
        </template>
        <template v-for="part in (['sidebar', 'auxiliarybar'] as const)" :key="part" #[part]>
            <WorkbenchToolPartHost
                :part="part"
                :presentation="presentation.parts[part]"
                :selected="selectedOf(part)"
                :locale="locale"
                :label="text(PART_LABELS[part])"
                :empty-text="text(TEXT.emptyPart)"
                :id-prefix="idPrefix"
                :drag-label="text(TEXT.dragLabel)"
                :drag-hint="text(TEXT.dragHint)"
                @select="(id) => selectContainer(part, id)"
                @target="(element) => setPartTarget(part, element)"
            >
                <template #actions="{container}">
                    <WorkbenchMoveViewMenu
                        v-if="singleViewOf(container) !== null && moveMenuOf(singleViewOf(container)!) !== null"
                        :label="text(TEXT.moveTo)"
                        :view-id="singleViewOf(container)!"
                        :source-container-id="moveMenuOf(singleViewOf(container)!)!.source"
                        :groups="moveMenuOf(singleViewOf(container)!)!.groups"
                        :reset-label="moveMenuOf(singleViewOf(container)!)!.resetLabel"
                        :identity="moveMenuOf(singleViewOf(container)!)!.identity"
                        @move="moveView"
                        @reset="resetView"
                    />
                </template>
            </WorkbenchToolPartHost>
        </template>
        <template #editor>
            <component :is="editorComponent" v-if="editorComponent !== null" :key="props.editorArea?.current.value?.id" :context="editorContext" data-workbench-editor-area />
            <div v-else class="workbench-shell__welcome">
                <h1>NeuroBook</h1>
                <p>{{ welcome }}</p>
            </div>
        </template>
        <template #panel="{collapsed}">
            <WorkbenchPanelSurface :title="text(TEXT.panel)" :collapsed="collapsed" :actions="frameActions" @action="run">
                <template #nav>
                    <Tabs v-if="panelTabs.length > 0" class="workbench-shell__panel-tabs" size="sm" :model-value="presentation.parts.panel.selected ?? ''" :items="panelTabs" :aria-label="text(TEXT.panel)" @update:model-value="(id: string) => selectContainer('panel', id)" />
                    <!--
                        标签带里的工具区：不起拖、不接收投递（外壳三输出 19 行为表最后一行）。条件写在包装上：槽里什么都没渲染时
                        面板要回落显示标题，常驻的空包装会挡掉回落。
                    -->
                    <span v-if="selectedOf('panel') !== null && singleViewOf(selectedOf('panel')!) !== null && moveMenuOf(singleViewOf(selectedOf('panel')!)!) !== null" class="workbench-shell__panel-tools" data-no-drag>
                        <WorkbenchMoveViewMenu
                            :label="text(TEXT.moveTo)"
                            :view-id="singleViewOf(selectedOf('panel')!)!"
                            :source-container-id="moveMenuOf(singleViewOf(selectedOf('panel')!)!)!.source"
                            :groups="moveMenuOf(singleViewOf(selectedOf('panel')!)!)!.groups"
                            :reset-label="moveMenuOf(singleViewOf(selectedOf('panel')!)!)!.resetLabel"
                            :identity="moveMenuOf(singleViewOf(selectedOf('panel')!)!)!.identity"
                            @move="moveView"
                            @reset="resetView"
                        />
                    </span>
                </template>
                <WorkbenchToolPartHost
                    part="panel"
                    :presentation="presentation.parts.panel"
                    :selected="selectedOf('panel')"
                    :locale="locale"
                    :label="text(PART_LABELS.panel)"
                    :empty-text="text(TEXT.emptyPart)"
                    :id-prefix="idPrefix"
                    :drag-label="text(TEXT.dragLabel)"
                    :drag-hint="text(TEXT.dragHint)"
                    @select="(id) => selectContainer('panel', id)"
                    @target="(element) => setPartTarget('panel', element)"
                />
            </WorkbenchPanelSurface>
        </template>
        <template #statusbar>
            <WorkbenchStatusBar
                :locale="locale"
                :project="project"
                :panel-hidden="panelHidden"
                :panel-toggle-disabled="!state.ready"
                :problems="state.problems"
                @toggle-panel="run(SET_PANEL_HIDDEN_COMMAND, {hidden: !panelHidden})"
                @retry="(record) => layout.actions.retry(record as 'side' | 'panelSize' | 'customizations')"
                @discard="(record) => layout.actions.discard(record as 'side' | 'panelSize' | 'customizations')"
            />
        </template>
    </WorkbenchShellLayout>
    <WorkbenchViewInstances
        :presentation="presentation"
        :source="views"
        :part-targets="partTargets"
        :shown-parts="shownParts"
        :memory="memory"
        :root="hostEl"
        :locale="locale"
        :disabled="!state.ready"
        @intent="(intent) => layout.actions.applyView(intent)"
        @generations="(next) => (generations = next)"
    >
        <template #view-actions="{viewId}">
            <WorkbenchMoveViewMenu
                v-if="moveMenuOf(viewId) !== null"
                :label="text(TEXT.moveTo)"
                :view-id="viewId"
                :source-container-id="moveMenuOf(viewId)!.source"
                :groups="moveMenuOf(viewId)!.groups"
                :reset-label="moveMenuOf(viewId)!.resetLabel"
                :identity="moveMenuOf(viewId)!.identity"
                @move="moveView"
                @reset="resetView"
            />
        </template>
        <template #empty>
            <div class="workbench-shell__empty">{{ text(TEXT.emptyContainer) }}</div>
        </template>
    </WorkbenchViewInstances>
    <WorkbenchDragFeedback :ghost="dragGhost" :preview="dropFeedback.preview" :label="dropFeedback.label" :kind="dropFeedback.kind" :count="dropFeedback.count" />
    </div>
</template>

<style scoped>
.workbench-shell-host {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    outline: none;
}

/* 只是工具区的标记，不另占布局。 */
.workbench-shell__panel-tools {
    display: contents;
}

.workbench-shell__panel-tabs {
    flex: 1 1 auto;
    min-width: 0;
}

.workbench-shell {
    background: var(--bg-main);
    color: var(--text-main);
    font-family: var(--font-ui);
}

.workbench-shell__titlebar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 100%;
    padding-inline: var(--space-3);
    font-size: var(--text-xs);
}

.workbench-shell__app {
    font-weight: 600;
}

.workbench-shell__project {
    min-width: 0;
    overflow: hidden;
    color: var(--text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.workbench-shell__card {
    height: 100%;
    background: var(--panel-surface);
    border: var(--border-w) solid var(--panel-outline);
    border-radius: var(--radius-panel);
}

.workbench-shell__empty {
    padding: var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.workbench-shell__panel-empty {
    height: 100%;
}

.workbench-shell__editor-failed {
    padding: var(--space-4);
    color: var(--status-danger);
}

.workbench-shell__welcome {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    height: 100%;
    padding: var(--space-4);
    text-align: center;
}

.workbench-shell__welcome h1 {
    margin: 0;
    font-size: var(--text-lg);
}

.workbench-shell__welcome p {
    margin: 0;
    max-width: 40rem;
    color: var(--text-secondary);
}
</style>
