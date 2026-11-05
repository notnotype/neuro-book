<script setup lang="ts">
/**
 * 产品的工作台外壳（同名 .md）：布局 store 接到纯布局组件，七个 Part 的内容，按钮接到面板命令；工具区域放容器与视图
 * （外壳二），实例层搬进各区域的落点。
 */
import {Tabs} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {layoutMotionMs, moveGridFocus} from "@notnotype/nb-layout/vue";
import type {GridDropRect, GridOrientation} from "@notnotype/nb-layout";
import type {TextParams} from "@notnotype/nb-ui/text";
import {computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, useId, useTemplateRef, watch} from "vue";
import type {Component} from "vue";

import type {CommandService} from "nbook/plugins/commands/shared/contracts";
import type {DisplayText} from "nbook/shared/localized-text";
import TitleActions from "nbook/ui/menus/TitleActions.vue";
import {NO_TITLE_ACTIONS} from "nbook/ui/menus/title-actions";
import type {TitleActionsModel} from "nbook/ui/menus/title-actions";

import {
    SET_PANEL_ALIGNMENT_COMMAND,
    SET_PANEL_COLLAPSED_COMMAND,
    SET_PANEL_HIDDEN_COMMAND,
    SET_PANEL_POSITION_COMMAND,
    TOGGLE_PANEL_MAXIMIZED_COMMAND,
} from "../commands/panel-commands";
import {MOVE_VIEW_COMMAND, PART_LABELS, newContainerLabel} from "../commands/view-commands";
import {workbenchText} from "../../shared/text";
import type {WorkbenchTextKey} from "../../shared/text";
import {SHELL_PART_IDS} from "../shell/sizes";
import type {ShellLayoutFacts, ShellPartId, ShellSizePatch} from "../shell/sizes";
import {TeleportMemory} from "../shell/teleport-memory";
import type {LayoutStore} from "../state/layout-store";
import type {ViewLocation} from "../../shared/views";
import type {PaneFocusMover} from "../commands/pane-focus-commands";
import {createShellDrag} from "../views/drag-session";
import type {ShellDrag} from "../views/drag-session";
import type {DropDecision} from "../views/drop";
import type {ViewIntent} from "../views/intents";
import {moveTargetsOf} from "../views/presentation";
import type {ContainerPresentation} from "../views/presentation";
import type {ViewSource} from "../views/registry";
import type {EditorAreaContext} from "../contracts";
import {editorAreaComponent} from "../editor-area";
import type {EditorAreaSource} from "../editor-area";
import WorkbenchActivityBar from "./WorkbenchActivityBar.vue";
import WorkbenchDragFeedback from "./WorkbenchDragFeedback.vue";
import WorkbenchMoveViewMenu from "./WorkbenchMoveViewMenu.vue";
import type {MovePayload, MoveTargetGroup} from "./WorkbenchMoveViewMenu.vue";
import WorkbenchPanelSurface from "./WorkbenchPanelSurface.vue";
import type {PanelFrameAction} from "./WorkbenchPanelSurface.vue";
import WorkbenchShellLayout from "./WorkbenchShellLayout.vue";
import WorkbenchStatusBar from "./WorkbenchStatusBar.vue";
import WorkbenchTitleBar from "./WorkbenchTitleBar.vue";
import type {ShellChrome, ViewInstanceRef} from "../titlebar/titlebar-source";
import {SET_PART_HIDDEN_COMMAND} from "../commands/part-commands";
import {OPEN_COMMANDS_ID} from "../commands/open-commands";
import WorkbenchToolPartHost from "./WorkbenchToolPartHost.vue";
import {switcherPanelId, switcherTabId} from "./switcher-ids";
import WorkbenchViewInstances from "./WorkbenchViewInstances.vue";

defineOptions({name: "WorkbenchShell"});

const props = defineProps<{
    /** 外壳挂上时交出移动焦点的实现，卸载时交 null（`commands/pane-focus-commands.ts`）。 */
    attachPaneFocus?: (move: PaneFocusMover | null) => void;
    layout: LayoutStore;
    commands: CommandService;
    views: ViewSource;
    /** 编辑器槽的提供者；没有时（或没有贡献）槽里是欢迎文字。 */
    editorArea?: EditorAreaSource;
    /** 标题栏的菜单与搜索、两侧的条目；没有时标题栏只有品牌与项目名（外壳四之前的样子）。 */
    chrome?: ShellChrome;
    project: string | null;
}>();

const resolver = useText();
const text = (value: DisplayText): string => resolver.t(value);
/** 外壳自己的目录文字（命名空间 `nbook.workbench`）；语言随窗口的端口切换。 */
const message = (key: WorkbenchTextKey, params?: TextParams): string => resolver.t(workbenchText(key, params));
const welcome = computed(() => (props.project === null ? message("shell.welcome.noProject") : message("shell.welcome.withProject", {name: props.project})));

const state = computed(() => props.layout.state);

/**
 * 编辑器槽的内容：提供者换了才换组件（重挂），布局变化只改 `visible`。面板最大化时编辑器内容停放（外壳一验收 6），
 * 对提供者就是不可见。
 */
/** 手势预览里已经拉出来、记录里还收着的部件（外壳布局按预览报上来，手势结束清空）：视图的首次加载与“可见”跟着它走。 */
const previewParts = shallowRef<ReadonlyArray<ShellPartId>>([]);
const editorContext: EditorAreaContext = {visible: computed(() => state.value.facts?.effectivePanel.maximized !== true || previewParts.value.includes("editor"))};
const editorComponent = computed((): Component | null => {
    const provider = props.editorArea?.current.value ?? null;
    if (provider === null) return null;
    return editorAreaComponent(provider, resolver);
});
/** 面板看不见：隐藏或拖到零。状态栏按钮此时是“显示面板”，执行时同时清除这两种（与命令的省略参数同一判断）。 */
const panelHidden = computed(() => state.value.panel.hidden || state.value.dragCollapsed.panel === true);

/** 框架按钮：可用性问命令系统；先读布局状态，让按钮随它重新求值（命令系统的可用性变化不通知）。 */
const FRAME: ReadonlyArray<{id: string; icon: string; title: WorkbenchTextKey}> = [
    {id: SET_PANEL_POSITION_COMMAND, icon: "i-lucide-panel-bottom", title: "commands.nbook.view.set-panel-position.title"},
    {id: SET_PANEL_ALIGNMENT_COMMAND, icon: "i-lucide-align-horizontal-space-between", title: "commands.nbook.view.set-panel-alignment.title"},
    {id: SET_PANEL_COLLAPSED_COMMAND, icon: "i-lucide-chevrons-down", title: "commands.nbook.view.set-panel-collapsed.title"},
    {id: TOGGLE_PANEL_MAXIMIZED_COMMAND, icon: "i-lucide-maximize-2", title: "commands.nbook.view.toggle-panel-maximized.title"},
    {id: SET_PANEL_HIDDEN_COMMAND, icon: "i-lucide-x", title: "commands.nbook.view.set-panel-hidden.title"},
];
const frameActions = computed<ReadonlyArray<PanelFrameAction>>(() => {
    const {panel, ready, facts} = state.value;
    void [panel.position, panel.alignment, panel.hidden, panel.collapsed, panel.maximized, ready, facts?.mode];
    return FRAME.map(({id, icon, title}) => {
        const enabled = props.commands.isEnabled(id);
        const available = enabled.ok && enabled.value;
        return {
            id,
            icon,
            label: message(title),
            disabled: !available,
            ...(enabled.ok ? {} : {reason: resolver.t(enabled.reason)}),
            ...(id === SET_PANEL_COLLAPSED_COMMAND ? {pressed: panel.collapsed} : id === TOGGLE_PANEL_MAXIMIZED_COMMAND ? {pressed: panel.maximized} : {}),
        };
    });
});

function run(id: string, args: Record<string, unknown> = {}): void {
    void props.commands.execute(id, args, {source: "user"});
}

/** “打开项目”的命令 id：项目插件的公开合同，工作台不为它依赖项目插件的模块。 */
const OPEN_PROJECT_COMMAND = "nbook.project.open";

const titleMenus = computed(() => props.chrome?.menus(resolver) ?? []);
/** 标题栏三个布局按钮的按下态：区域此刻看得见（未隐藏且未拖到零），与视图菜单的勾选同一判断。 */
const layoutButtons = computed(() => ({
    sidebar: {pressed: props.layout.actions.partVisible("sidebar"), disabled: !state.value.ready},
    panel: {pressed: !panelHidden.value, disabled: !state.value.ready},
    auxiliarybar: {pressed: props.layout.actions.partVisible("auxiliarybar"), disabled: !state.value.ready},
}));

function togglePart(part: "sidebar" | "panel" | "auxiliarybar"): void {
    if (part === "panel") run(SET_PANEL_HIDDEN_COMMAND);
    else run(SET_PART_HIDDEN_COMMAND, {part});
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
const shellLayout = useTemplateRef<InstanceType<typeof WorkbenchShellLayout>>("shellLayout");
/** 预备区的图标：与标题栏的布局按钮同一套。 */
const REVEAL_ICONS: Readonly<Record<ViewLocation, string>> = {sidebar: "i-lucide-panel-left", auxiliarybar: "i-lucide-panel-right", panel: "i-lucide-panel-bottom"};
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
/** 看得见的工具区域：未隐藏、未拖到零（或正被拉出来）；面板还要未收起成标题头。 */
const shownParts = computed<ViewLocation[]>(() => {
    const {hiddenParts, dragCollapsed, facts} = state.value;
    const pulled = previewParts.value;
    const shown: ViewLocation[] = [];
    if (sidebarVisible.value || pulled.includes("sidebar")) shown.push("sidebar");
    if (!hiddenParts.includes("auxiliarybar") && (dragCollapsed.auxiliarybar !== true || pulled.includes("auxiliarybar"))) shown.push("auxiliarybar");
    if (!state.value.panel.hidden && (dragCollapsed.panel !== true || pulled.includes("panel")) && facts?.effectivePanel.collapsed !== true) shown.push("panel");
    return shown;
});

const activityContainers = computed(() => presentation.value.parts.sidebar.switcher.map((item) => ({id: item.containerId, label: text(item.title), icon: item.icon})));

/**
 * ActivityBar（Spec 外壳二输出 15）：点当前项且 Sidebar 看得见时收起它（隐藏）；否则切到这个容器，Sidebar 看不见时同时打开它
 * （被隐藏的显示、拖到零的按记忆尺寸展开）。
 */
function selectSidebarContainer(containerId: string): void {
    if (sidebarVisible.value && presentation.value.parts.sidebar.selected === containerId) {
        props.layout.actions.setPartHidden("sidebar", true);
        return;
    }
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
    attrs: {"data-switcher-entry": item.containerId, "data-drag-container": item.containerId, "aria-description": message('shell.drag.hint')},
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
        resetLabel: targets.canReset ? message('views.resetLocation') : null,
        // 菜单目标身份：视图、来源容器、容器模式、交付状态与实例代际任一变化，已打开的菜单就关闭。
        identity: `${viewId}|${targets.sourceContainerId}|${container?.mode ?? ""}|${props.views.delivery(viewId).kind}|${String(generations.value.get(viewId) ?? 0)}`,
    };
}

/** 视图这一次挂载的实例；还在加载、代际没建立时为 null。 */
const instanceOf = (viewId: string): ViewInstanceRef | null => {
    const generation = generations.value.get(viewId);
    return generation === undefined ? null : {viewId, generation};
};

/** 视图的标题动作（docs/specs/workbench/views.md 输出 10、11）；Lab 里没有命令服务（没有 chrome）时没有。 */
const viewActionsOf = (viewId: string): TitleActionsModel => props.chrome?.viewActions(viewId, state.value.catalog.get(viewId)?.actions ?? [], resolver, instanceOf(viewId)) ?? NO_TITLE_ACTIONS;

const hasViewActions = (viewId: string): boolean => {
    const model = viewActionsOf(viewId);
    return model.buttons.length > 0 || model.menu.length > 0;
};

/** 标题动作“⋯”的菜单身份：与“移动到”同一组事实（视图、所在容器与模式、交付状态与实例代际），任一变化就关闭菜单。 */
function viewActionsIdentity(viewId: string): string {
    const container = state.value.placement.views.get(viewId)?.container ?? "";
    return `${viewId}|${container}|${presentation.value.containers.get(container)?.mode ?? ""}|${props.views.delivery(viewId).kind}|${String(generations.value.get(viewId) ?? 0)}`;
}

function runViewAction(viewId: string, key: string): void {
    props.chrome?.runViewAction(viewId, state.value.catalog.get(viewId)?.actions ?? [], key, instanceOf(viewId));
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
const drag = shallowRef<ShellDrag | null>(null);
onMounted(() => {
    drag.value = createShellDrag({
        root: hostEl.value!,
        presentation: () => presentation.value,
        catalog: () => state.value.catalog,
        enabled: () => state.value.ready,
        revealZones: () => shellLayout.value?.revealZoneRects() ?? [],
        commit: (decision) => {
            const result = props.layout.actions.applyView(decision.intent, decision.reveal === undefined ? {} : {reveal: decision.reveal});
            if (result.kind !== "rejected") startSettle(decision);
        },
    });
});
onBeforeUnmount(() => drag.value?.dispose());

/** 焦点不在任何 grid 里（页面根、菜单）时从外壳的第一块开始。 */
onMounted(() => props.attachPaneFocus?.((direction) => {
    if (!moveGridFocus(document.activeElement, direction)) moveGridFocus(hostEl.value?.querySelector("[data-grid-scope]") ?? null, direction);
}));
onBeforeUnmount(() => props.attachPaneFocus?.(null));

const dragState = computed(() => drag.value?.state.value ?? null);

/**
 * 放下后的收尾（外壳三输出 22）：高亮从松手时的落点滑到拖进去的东西最终所在的位置再淡出。松手那一刻先接住当时的
 * 矩形（覆盖层的同一个节点不断开）；提交引起的重排不是一帧完成的（Teleport 搬动、容器换模式后标题行变化、网格按
 * 新测量重算各晚一帧），外框还要过渡到新矩形，所以之后每帧跟着量、覆盖层的过渡跟着走，连续两帧不变才标记收尾开始淡出，
 * 否则还没走到终点就淡没了。上限按时间不按帧数：高刷新率的屏幕上帧数耗得快，外框还在滑。量不到就直接结束；新的拖动开始时丢掉。
 */
const SETTLE_TRACK_SLACK_MS = 340;
const settle = shallowRef<{readonly rect: GridDropRect; readonly orientation: GridOrientation; readonly final: boolean; readonly token: symbol} | null>(null);

function settledRectOf(intent: ViewIntent): GridDropRect | null {
    const root = hostEl.value;
    if (root === null) return null;
    const selectors = intent.kind === "move-view" ? [`[data-view-section="${CSS.escape(intent.viewId)}"]`]
        : intent.kind === "merge-container" ? intent.sourceViewIds.map((id) => `[data-view-section="${CSS.escape(id)}"]`)
            : intent.kind === "detach-view" || intent.kind === "move-container" || intent.kind === "select-container" ? [`[data-container-host="${CSS.escape(intent.containerId)}"]`]
                : [];
    const rects = selectors.flatMap((selector) => [...root.querySelectorAll(selector)].map((element) => element.getBoundingClientRect())).filter((rect) => rect.width > 0 && rect.height > 0);
    if (rects.length === 0) return null;
    return {left: Math.min(...rects.map((rect) => rect.left)), top: Math.min(...rects.map((rect) => rect.top)), right: Math.max(...rects.map((rect) => rect.right)), bottom: Math.max(...rects.map((rect) => rect.bottom))};
}

function startSettle(decision: Extract<DropDecision, {kind: "commit"}>): void {
    const from = decision.preview.areaRect ?? decision.preview.indicator;
    if (from === null) return;
    const token = Symbol("settle");
    const orientation = decision.preview.orientation;
    settle.value = {rect: from, orientation, final: false, token};
    const deadline = performance.now() + (hostEl.value === null ? 0 : layoutMotionMs(hostEl.value)) + SETTLE_TRACK_SLACK_MS;
    let stable = 0;
    let last = "";
    const track = (): void => {
        if (settle.value?.token !== token) return;
        const rect = settledRectOf(decision.intent);
        if (rect === null) {
            settle.value = null;
            return;
        }
        const key = JSON.stringify(rect);
        if (key === last) stable += 1;
        else {
            stable = 0;
            last = key;
        }
        const done = stable >= 2 || performance.now() >= deadline;
        settle.value = {rect, orientation, final: done, token};
        if (!done) requestAnimationFrame(track);
    };
    requestAnimationFrame(track);
}

watch(dragState, (next) => {
    if (next !== null) settle.value = null;
});
/** 拖动时浮出的预备区：名称与图标；指针正停在上面的那块由落点高亮接管，不再画自己的提示。 */
const revealZones = computed(() => {
    const current = dragState.value;
    if (current === null) return [];
    const active = current.decision?.kind === "commit" ? current.decision.reveal : undefined;
    return current.zones.map((zone) => ({part: zone.part, rect: zone.rect, label: text(PART_LABELS[zone.part]), icon: REVEAL_ICONS[zone.part], active: zone.part === active}));
});
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
    const finishing = settle.value;
    if (dragState.value === null && finishing !== null) {
        return {preview: {areaRect: finishing.rect, entryRect: null, indicator: null, orientation: finishing.orientation, settling: finishing.final}, label: "", kind: "settle", count: 0};
    }
    const decision = dragState.value?.decision ?? null;
    const preview = decision === null || decision.kind === "rejected" ? null : (decision.preview ?? null);
    if (preview === null) return {preview: null, label: "", kind: "", count: 0};
    const kind = decision!.kind === "commit" ? decision!.intent.kind : "noop";
    if (decision!.kind === "commit" && decision!.reveal !== undefined) {
        return {preview: {areaRect: preview.areaRect, entryRect: null, indicator: null, orientation: preview.orientation}, label: message('shell.drop.reveal', {part: text(PART_LABELS[decision!.reveal])}), kind, count: preview.count};
    }
    // 收起分栏前后的插入位：提示说放在谁前后，贴在插入线的末端，不盖住下一行的标题。
    const near = preview.insertion;
    const nearTitle = near === undefined ? undefined : state.value.catalog.get(near.viewId)?.title;
    if (decision!.kind === "commit" && near !== undefined && nearTitle !== undefined) {
        const label = message(near.side === "before" ? "shell.drop.before" : "shell.drop.after", {title: text(nearTitle)});
        return {preview: {areaRect: null, entryRect: null, indicator: preview.indicator, orientation: preview.orientation, labelAt: "line-end" as const}, label, kind, count: preview.count};
    }
    const label = kind === "move-view" ? message('shell.drop.moveView')
        : kind === "detach-view" ? message('shell.drop.detachView')
            : kind === "move-container" ? message('shell.drop.moveContainer')
                : kind === "merge-container" ? message('shell.drop.mergeContainer', {count: preview.count})
                    : "";
    return {preview: {areaRect: preview.areaRect, entryRect: null, indicator: preview.indicator, orientation: preview.orientation}, label, kind, count: preview.count};
});
</script>

<template>
    <div ref="hostEl" class="workbench-shell-host" tabindex="-1" @focusin="onFocusIn">
    <WorkbenchShellLayout
        ref="shellLayout"
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
        @preview="(parts: ReadonlyArray<ShellPartId>) => (previewParts = parts)"
    >
        <template #titlebar>
            <WorkbenchTitleBar
                v-if="chrome !== undefined"
                :project="project"
                :menus="titleMenus"
                :search-shortcut="chrome.searchShortcut()"
                :layout="layoutButtons"
                :items="chrome.titleEntries(resolver)"
                @run="(command, args) => run(command, {...args})"
                @search="run(OPEN_COMMANDS_ID)"
                @toggle-part="togglePart"
                @open-project="run(OPEN_PROJECT_COMMAND)"
                @run-item="(id) => chrome?.runItem(id)"
            />
            <div v-else class="workbench-shell__titlebar">
                <span class="workbench-shell__app">NeuroBook</span>
                <span v-if="project !== null" class="workbench-shell__project">{{ project }}</span>
            </div>
        </template>
        <template #activitybar>
            <WorkbenchActivityBar
                :label="message('shell.activityBar')"
                :containers="activityContainers"
                :selected="presentation.parts.sidebar.selected"
                :sidebar-visible="sidebarVisible"
                :items="chrome?.activityEntries(resolver) ?? []"
                @select="selectSidebarContainer"
                @run-item="(id) => chrome?.runItem(id)"
            />
        </template>
        <template v-for="part in (['sidebar', 'auxiliarybar'] as const)" :key="part" #[part]>
            <WorkbenchToolPartHost
                :part="part"
                :presentation="presentation.parts[part]"
                :selected="selectedOf(part)"
                :label="text(PART_LABELS[part])"
                :empty-text="message('shell.empty.part')"
                :id-prefix="idPrefix"
                @select="(id) => selectContainer(part, id)"
                @target="(element) => setPartTarget(part, element)"
            >
                <template #actions="{container}">
                    <TitleActions v-if="singleViewOf(container) !== null && hasViewActions(singleViewOf(container)!)" :model="viewActionsOf(singleViewOf(container)!)" :identity="viewActionsIdentity(singleViewOf(container)!)" :more-label="message('shell.moreActions')" @run="(key) => runViewAction(singleViewOf(container)!, key)" />
                    <WorkbenchMoveViewMenu
                        v-if="singleViewOf(container) !== null && moveMenuOf(singleViewOf(container)!) !== null"
                        :label="message('shell.moveTo')"
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
            <WorkbenchPanelSurface :title="message('shell.panel')" :collapsed="collapsed" :actions="frameActions" @action="run">
                <template #nav>
                    <Tabs v-if="panelTabs.length > 0" class="workbench-shell__panel-tabs" size="sm" overflow="adapt" :max-item-width="96" :more-label="message('common.more')" :baseline="false" :model-value="presentation.parts.panel.selected ?? ''" :items="panelTabs" :aria-label="message('shell.panel')" @update:model-value="(id: string) => selectContainer('panel', id)" />
                    <!--
                        标签带里的工具区：不起拖、不接收投递（外壳三输出 19 行为表最后一行）。条件写在包装上：槽里什么都没渲染时
                        面板要回落显示标题，常驻的空包装会挡掉回落。
                    -->
                    <span v-if="selectedOf('panel') !== null && singleViewOf(selectedOf('panel')!) !== null && (moveMenuOf(singleViewOf(selectedOf('panel')!)!) !== null || hasViewActions(singleViewOf(selectedOf('panel')!)!))" class="workbench-shell__panel-tools" data-no-drag data-hover-actions>
                        <TitleActions v-if="hasViewActions(singleViewOf(selectedOf('panel')!)!)" :model="viewActionsOf(singleViewOf(selectedOf('panel')!)!)" :identity="viewActionsIdentity(singleViewOf(selectedOf('panel')!)!)" :more-label="message('shell.moreActions')" @run="(key) => runViewAction(singleViewOf(selectedOf('panel')!)!, key)" />
                        <WorkbenchMoveViewMenu
                            v-if="moveMenuOf(singleViewOf(selectedOf('panel')!)!) !== null"
                            :label="message('shell.moveTo')"
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
                        :label="text(PART_LABELS.panel)"
                    :empty-text="message('shell.empty.part')"
                    :id-prefix="idPrefix"
                    @select="(id) => selectContainer('panel', id)"
                    @target="(element) => setPartTarget('panel', element)"
                />
            </WorkbenchPanelSurface>
        </template>
        <template #statusbar>
            <WorkbenchStatusBar
                :project="project"
                :panel-hidden="panelHidden"
                :panel-toggle-disabled="!state.ready"
                :problems="state.problems"
                :items="chrome?.statusEntries(resolver) ?? []"
                @run-item="(id) => chrome?.runItem(id)"
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
        :disabled="!state.ready"
        @intent="(intent) => layout.actions.applyView(intent)"
        @generations="(next) => (generations = next)"
    >
        <template #view-actions="{viewId}">
            <TitleActions v-if="hasViewActions(viewId)" :model="viewActionsOf(viewId)" :identity="viewActionsIdentity(viewId)" :more-label="message('shell.moreActions')" @run="(key) => runViewAction(viewId, key)" />
            <WorkbenchMoveViewMenu
                v-if="moveMenuOf(viewId) !== null"
                :label="message('shell.moveTo')"
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
            <div class="workbench-shell__empty">{{ message('shell.empty.container') }}</div>
        </template>
    </WorkbenchViewInstances>
    <WorkbenchDragFeedback :ghost="dragGhost" :zones="revealZones" :preview="dropFeedback.preview" :label="dropFeedback.label" :kind="dropFeedback.kind" :count="dropFeedback.count" @settled="settle = null" />
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

/* 外壳根是卡片之间露出的窗体底（ui/workbench-shell.md 输出 38）：主题给 --shell-ground；平铺的主题不给，与部件同一块面板底色。 */
.workbench-shell {
    background: var(--shell-ground, var(--panel-surface));
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

.workbench-shell__empty {
    padding: var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.workbench-shell__panel-empty {
    height: 100%;
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
