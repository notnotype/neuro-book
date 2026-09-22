<script setup lang="ts">
/**
 * 工作台骨架的 Component Lab fixture：**真实外壳 + 真实 Grid + 空白演示 View，零业务依赖**。
 *
 * 它要证明的不是「画了一个工作台」，而是「同一批零件在 Lab 里真的能动」：
 * - 几何、sash、手势、槽位停放与焦点策略都走 `WorkbenchShellLayout`（与主页面同一个组件）；
 * - 容器/视图声明走 descriptor 注册表，位置、活动容器与尺寸走 `composeViewPlacements`
 *   （与产品同一个纯函数），呈现求值走 `resolveViewPresentation`，框架菜单走 `resolvePanelTitleActions`；
 * - 容器宿主装配与产品同构：`WorkbenchViewInstances`（View 实例）→ `WorkbenchContainerInstances`
 *   （容器宿主 + parking）→ 三个 `WorkbenchPartHost`（容器选择 / 标题 / 挂载目标）；
 * - 面板操作、容器与 View 的移动/选择/尺寸、View 动作都经 `CommandRegistry`
 *   （`registerWorkbenchShellCommands` / `registerViewTitleCommands`）——Lab 里点的每一下都是真命令。
 *
 * 与产品的区别只有**事实来源**：这里没有 Storage、没有 store、没有 workspace API，状态是这个组件自己的
 * 内存 ref（`sizes` / `panel` / `hiddenParts` / `dragCollapsed` / `record`），
 * 换场景就重建初值，不写 localStorage / IDB，也不发任何产品请求。
 *
 * 骨架声明是 **5 个容器 + 7 个空白 View**：多容器（同 Part 单选、整容器跨 Part 移动、搬空）与
 * 容器内多 View（同屏纵向排列、换序）这两条能力都由它覆盖，产品目录里只有 `nbook.files` 一个真视图。
 *
 * 七个 fixture 专属空白 View（`lab.primary` / `lab.extra-a` / `lab.extra-b` / `lab.secondary` /
 * `lab.extra-c` / `lab.panel-a` / `lab.panel-b`）共用 `WorkbenchSkeletonView.vue`：panel-a 贡献
 * 「增加演示计数 / 重置演示计数」，panel-b 贡献「切换演示标记 / 一个禁用动作」，命令 id 固定为
 * `nbook.view.lab-*`，卸载时整批释放。
 */
import {DragDropProvider} from "@dnd-kit/vue";
import {computed, defineComponent, h, onBeforeUnmount, ref, watch, type Component, shallowRef} from "vue";
import DesktopTitleBarChrome from "nbook/app/components/common/DesktopTitleBarChrome.vue";
import WorkbenchActivityBar, {type ActivityItem} from "nbook/app/components/workbench/WorkbenchActivityBar.vue";
import WorkbenchContainerInstances from "nbook/app/components/workbench/WorkbenchContainerInstances.vue";
import type {WorkbenchViewSizesEvent} from "nbook/app/components/workbench/WorkbenchViewHost.vue";
import WorkbenchDropOverlay from "nbook/app/components/workbench/WorkbenchDropOverlay.vue";
import WorkbenchDragOverlay from "nbook/app/components/workbench/WorkbenchDragOverlay.vue";
import WorkbenchPartHost from "nbook/app/components/workbench/WorkbenchPartHost.vue";
import WorkbenchShellLayout from "nbook/app/components/workbench/WorkbenchShellLayout.vue";
import WorkbenchStatusBar from "nbook/app/components/workbench/WorkbenchStatusBar.vue";
import WorkbenchStatusBarItem from "nbook/app/components/workbench/WorkbenchStatusBarItem.vue";
import WorkbenchViewInstances from "nbook/app/components/workbench/WorkbenchViewInstances.vue";
import {
} from "nbook/app/composables/useWorkbenchDrag";
import {useWorkbenchDrop} from "nbook/app/composables/useWorkbenchDrop";
import {useWorkbenchViewActions} from "nbook/app/composables/useWorkbenchViewActions";
import {createCommandRegistry, type CommandResult, type Release} from "nbook/app/utils/workbench/commands";
import {
    createWorkbenchRegistry,
    type ContainerDescriptor,
    type DescriptorResult,
    type ViewDescriptor,
    type WorkbenchCatalog,
    type WorkbenchContext,
    type WorkbenchRegistry,
} from "nbook/app/utils/workbench/descriptors";
import {
    mergeShellSizePatch,
    SHELL_SIZE_DEFAULTS,
    type ShellDragCollapseMap,
    type ShellLayoutFacts,
    type ShellSizePatch,
    type ShellSizePreferences,
} from "nbook/app/utils/workbench/layout";
import {
    panelMaximizable,
    resolvePanelPreferences,
    SHELL_PANEL_ALIGNMENTS,
    SHELL_PANEL_POSITIONS,
    type ShellPanelAlignment,
    type ShellPanelPosition,
    type WorkbenchPanelPreferences,
    type WorkbenchPanelState,
} from "nbook/app/utils/workbench/panel-state";
import {
    resolveViewPresentation,
    type ContainerViewPresentation,
    type WorkbenchViewPresentation,
} from "nbook/app/utils/workbench/product-catalog";
import {
    composeViewPlacements,
    isToolPartId,
    placementCatalogOf,
    placementCatalogWithContainers,
    readContainerPlacements,
    readViewPlacements,
    resolveContainerMove,
    resolveViewMove,
    toolPartOfLocation,
    type ContainerMoveRequest,
    type PlacementCatalog,
    type ToolPartId,
    type ToolPartLocation,
    type ViewDetachRequest,
    type ViewMoveRequest,
    type ViewPlacementsPatch,
} from "nbook/app/utils/workbench/view-placements";
import type {
    ViewActionTarget,
    ViewTitleActionContribution,
    WorkbenchTitleActionItems,
} from "nbook/app/utils/workbench/view-title-actions";
import {
    executePanelActionItem,
    PANEL_ACTION_KEYS,
    panelActionItemId,
    registerViewTitleCommands,
    registerWorkbenchShellCommands,
    resolvePanelTitleActions,
    SHELL_CONTAINER_COMMAND_IDS,
    SHELL_PANEL_COMMAND_IDS,
    VIEW_ACTION_ARGS_SCHEMA,
    type ShellCommandOutcome,
    type ViewTitleCommandContribution,
    type WorkbenchShellCommandPort,
} from "nbook/app/utils/workbench/workbench-shell-commands";
import type {WorkbenchViewCustomizationsRecord} from "nbook/shared/storage/workbench-views";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";
import LabFixtureControls from "../LabFixtureControls.vue";
import WorkbenchSkeletonView, {resetSkeletonProbes, skeletonProbeSnapshot} from "./WorkbenchSkeletonView.vue";

defineOptions({name: "WorkbenchShellLayoutFixture"});

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();
const publishLabData = useLabDataSink();

// ── 声明：三个容器、四个空白 View（fixture 专属，不进产品目录） ──────────────────

/**
 * 容器用 `location` 的三种落位各一个：主侧栏 / 辅助侧栏 / 底部面板。
 * 标题只在本文件里解析（Lab 给字面量，产品里给 `t(titleKey)`）。
 */
const LAB_LEFT_CONTAINER: ContainerDescriptor = {
    id: "lab.container.left",
    titleKey: "lab.container.left",
    icon: "i-lucide-panel-left",
    location: "sidebar-left",
    order: 10,
};

const LAB_RIGHT_CONTAINER: ContainerDescriptor = {
    id: "lab.container.right",
    titleKey: "lab.container.right",
    icon: "i-lucide-panel-right",
    location: "sidebar-right",
    order: 20,
};

const LAB_PANEL_CONTAINER: ContainerDescriptor = {
    id: "lab.container.panel",
    titleKey: "lab.container.panel",
    icon: "i-lucide-panel-bottom",
    location: "panel",
    order: 30,
};

/**
 * 第二个主侧栏容器：验证「同一 Part 多容器单选」与「整容器跨 Part 移动后源 Part 回落」。
 * 它也可以被搬空（把它的视图移走）——空容器仍然保留切换入口与空态说明。
 */
const LAB_LEFT_SECONDARY_CONTAINER: ContainerDescriptor = {
    id: "lab.container.left-b",
    titleKey: "lab.container.left-b",
    icon: "i-lucide-layers",
    location: "sidebar-left",
    order: 20,
};

/** 第二个面板容器：底部标签条上有两项可单选（其中一个默认没有视图 = 空容器落点）。 */
const LAB_PANEL_SECONDARY_CONTAINER: ContainerDescriptor = {
    id: "lab.container.panel-b",
    titleKey: "lab.container.panel-b",
    icon: "i-lucide-panel-top",
    location: "panel",
    order: 40,
};

const LAB_CONTAINERS: readonly ContainerDescriptor[] = [
    LAB_LEFT_CONTAINER,
    LAB_LEFT_SECONDARY_CONTAINER,
    LAB_RIGHT_CONTAINER,
    LAB_PANEL_CONTAINER,
    LAB_PANEL_SECONDARY_CONTAINER,
];

/** 容器与视图的显示名：Lab 用字面量，不 import i18n（产品侧解析归页面）。 */
const LAB_TITLES: Record<string, string> = {
    "lab.container.left": "主侧边栏（演示）",
    "lab.container.left-b": "主侧边栏 · 第二容器",
    "lab.container.right": "辅助侧边栏（演示）",
    "lab.container.panel": "面板（演示）",
    "lab.container.panel-b": "面板 · 第二容器",
    "lab.view.primary": "主侧栏空白视图",
    "lab.view.extra-a": "主侧栏空白视图 A",
    "lab.view.extra-b": "第二容器空白视图 B",
    "lab.view.secondary": "辅助侧栏空白视图",
    "lab.view.extra-c": "辅助侧栏空白视图 C",
    "lab.view.panel-a": "面板空白视图 A",
    "lab.view.panel-b": "面板空白视图 B",
    "lab.view.gated": "面板 · 受限视图",
};

/** Part 标题：容器移动菜单里的落点文案（产品侧走 i18n）。 */
const LAB_PART_TITLES: Record<ToolPartId, string> = {left: "主侧边栏", right: "辅助侧边栏", panel: "面板"};

/** panel-a 的动作：primary 直接成按钮，secondary 收进它自己的「更多」。 */
const PANEL_A_ACTIONS: readonly ViewTitleActionContribution[] = [
    {id: "increment", commandId: "nbook.view.lab-increment", placement: "primary", order: 10},
    {id: "reset", commandId: "nbook.view.lab-reset", placement: "secondary", order: 20},
];

/** panel-b 的动作：一个可执行、一个**故意禁用**（原因在按钮与菜单里都看得见）。 */
const PANEL_B_ACTIONS: readonly ViewTitleActionContribution[] = [
    {id: "toggle", commandId: "nbook.view.lab-toggle", placement: "primary", order: 10},
    {id: "disabled", commandId: "nbook.view.lab-disabled", placement: "secondary", order: 20},
];

const LAB_VIEWS: readonly ViewDescriptor[] = [
    {
        id: "lab.primary",
        titleKey: "lab.view.primary",
        icon: "i-lucide-square-dashed",
        container: LAB_LEFT_CONTAINER.id,
        layout: "fill",
        order: 10,
        canToggleVisibility: false,
        canMoveView: true,
        factoryKey: "lab.view.primary",
        stateScope: "user",
    },
    {
        id: "lab.extra-a",
        titleKey: "lab.view.extra-a",
        icon: "i-lucide-square-dashed",
        container: LAB_LEFT_CONTAINER.id,
        layout: "fill",
        order: 20,
        canToggleVisibility: false,
        canMoveView: true,
        factoryKey: "lab.view.extra-a",
        stateScope: "user",
    },
    {
        id: "lab.extra-b",
        titleKey: "lab.view.extra-b",
        icon: "i-lucide-square-dashed",
        container: LAB_LEFT_SECONDARY_CONTAINER.id,
        layout: "fill",
        order: 10,
        canToggleVisibility: false,
        canMoveView: true,
        factoryKey: "lab.view.extra-b",
        stateScope: "user",
    },
    {
        id: "lab.secondary",
        titleKey: "lab.view.secondary",
        icon: "i-lucide-square-dashed",
        container: LAB_RIGHT_CONTAINER.id,
        layout: "fill",
        order: 10,
        canToggleVisibility: false,
        canMoveView: true,
        factoryKey: "lab.view.secondary",
        stateScope: "user",
    },
    {
        id: "lab.extra-c",
        titleKey: "lab.view.extra-c",
        icon: "i-lucide-square-dashed",
        container: LAB_RIGHT_CONTAINER.id,
        layout: "fill",
        order: 20,
        canToggleVisibility: false,
        canMoveView: true,
        factoryKey: "lab.view.extra-c",
        stateScope: "user",
    },
    {
        id: "lab.panel-a",
        titleKey: "lab.view.panel-a",
        icon: "i-lucide-square-dashed",
        container: LAB_PANEL_CONTAINER.id,
        layout: "fill",
        order: 10,
        canToggleVisibility: false,
        canMoveView: true,
        titleActions: PANEL_A_ACTIONS,
        factoryKey: "lab.view.panel-a",
        stateScope: "user",
    },
    {
        id: "lab.panel-b",
        titleKey: "lab.view.panel-b",
        icon: "i-lucide-square-dashed",
        container: LAB_PANEL_CONTAINER.id,
        layout: "fill",
        order: 20,
        canToggleVisibility: false,
        canMoveView: true,
        titleActions: PANEL_B_ACTIONS,
        factoryKey: "lab.view.panel-b",
        stateScope: "user",
    },
    {
        /**
         * `when` 受限的视图：骨架的环境事实里 `user-assets` 恒为 false，所以它默认不出现，
         * 所在的第二个面板容器保持为空。`view-hidden` 场景切到那个容器，就能看到容器的空态
         * 把求值原因写出来（可见性不是权限，也不是加载中）。
         */
        id: "lab.gated",
        titleKey: "lab.view.gated",
        icon: "i-lucide-square-dashed",
        container: LAB_PANEL_SECONDARY_CONTAINER.id,
        layout: "fill",
        order: 10,
        canToggleVisibility: false,
        canMoveView: true,
        when: {requires: ["user-assets"]},
        factoryKey: "lab.view.gated",
        stateScope: "user",
    },
];

const LAB_CATALOG: WorkbenchCatalog = {parts: [], containers: LAB_CONTAINERS, views: LAB_VIEWS};

function buildRegistry(catalog: WorkbenchCatalog): WorkbenchRegistry {
    const created = createWorkbenchRegistry(catalog);
    if (!created.ok) {
        throw new Error(`Lab 的工作台声明不合法：${created.reason}`);
    }
    return created.value;
}

/** 声明只建一次：换场景换的是内存事实，不是声明。 */
const LAB_REGISTRY = buildRegistry(LAB_CATALOG);
const LAB_PLACEMENTS: PlacementCatalog = placementCatalogOf(LAB_REGISTRY);

/**
 * 环境事实：这份骨架没有 Project、没有 authority，因此只有 `lab.gated` 因为 `when` 不出现，
 * 其余视图全部可见、动作全部可用（除声明禁用的那条）。
 */
const LAB_CONTEXT: WorkbenchContext = {
    project: false,
    selection: false,
    "user-assets": false,
    desktop: false,
    authorities: {project: false, session: false, job: false, files: false},
    projectRoot: null,
};

// ── 场景：每个都给确定性初值 ────────────────────────────────────────────────────

type SkeletonScene = Readonly<{
    label: string;
    note: string;
    /** Panel 保存意图 + 宿主内存里的瞬时最大化。 */
    panel?: Partial<WorkbenchPanelState>;
    /** 位置覆盖（`viewId → 目标容器`）：用同一套 `composeViewPlacements` 生成初值。 */
    placements?: readonly Readonly<{viewId: string; containerId: string; beforeViewId?: string}>[];
    /** 容器落位覆盖（整容器跨 Part 移动 / 同 Part 换序）。 */
    containerPlacements?: readonly Readonly<{containerId: string; location: string; beforeContainerId?: string}>[];
    /** 每个 Part 的活动容器（`partId → containerId`）。 */
    activeContainers?: Readonly<Record<string, string>>;
    /** 画布盒子：`width: null` = 撑满 Lab 画布；`narrow` 给 390，`short` 给高度 260。 */
    box: Readonly<{width: number | null; height: number}>;
    /** `lifetime` 场景打开验收探针（输入 / 滚动盒 / 挂载计数）。 */
    probes?: boolean;
    /**
     * 这些 factoryKey 在这个场景里当作「白名单未登记」：视图可见，但实例解析失败——
     * 用来观察容器把失败写在原地而不是留一块空白。
     */
    unknownFactoryKeys?: readonly string[];
    /**
     * 初始隐藏的叶（`left` / `right`）。
     *
     * 默认场景隐藏**右栏**：Lab 画布约 810px 宽，而侧栏最小值是 280 + 320（产品合同，不在这里放松），
     * 三栏全开时编辑区只剩 ~150px，Panel 标题区连一个动作按钮都放不下。侧栏本身要保留 280/320 的
     * 宽度记忆，所以这里只把它初始藏起来；Activity Bar 里的容器条目选中时会把它打开。
     */
    hiddenParts?: readonly string[];
}>;

const SCENES: Record<string, SkeletonScene> = {
    default: {
        label: "默认（底部 / 居中）",
        note: "Panel 在编辑区下方居中：activity 通高到状态栏，主侧边栏在左、Panel 与编辑区同列。右栏按骨架的默认隐藏（Lab 画布放不下两侧栏 + 可用的编辑区），活动栏上半的容器条目点一下就能显示它。拖动 sash、换位置、隐藏、最大化都改这里的内存状态。",
        box: {width: null, height: 720},
    },
    "panel-positions": {
        label: "Panel 在左侧",
        note: "位置是保存意图的一部分：左侧的 Panel 是宽度叶（160..600），与底部的高度记忆互相独立。",
        panel: {position: "left"},
        box: {width: null, height: 720},
    },
    "panel-alignments": {
        label: "底部 / 两端对齐",
        note: "两端对齐的 Panel 跨过左右侧栏，但**不跨活动栏**——活动栏永远是主体左侧的通高列。",
        panel: {position: "bottom", alignment: "justify"},
        box: {width: null, height: 720},
    },
    "panel-collapsed": {
        label: "32px 标题头",
        note: "收起只对水平位置有效：叶仍在树里、编辑实例不重挂，只留一条 32px 的标题头。",
        panel: {position: "bottom", alignment: "center", collapsed: true},
        box: {width: null, height: 720},
    },
    "panel-hidden": {
        label: "隐藏（零占用）",
        note: "隐藏是整个 Panel 零占用；状态栏的「显示面板」同时清 hidden 与 collapsed。",
        panel: {position: "bottom", alignment: "center", hidden: true},
        box: {width: null, height: 720},
    },
    "panel-maximized": {
        label: "最大化（瞬时）",
        note: "最大化只占编辑区所在列，侧栏 / 活动栏 / 标题栏 / 状态栏保留，编辑器内容停放而不卸载；它不落盘。",
        panel: {position: "bottom", alignment: "center", maximized: true},
        box: {width: null, height: 720},
    },
    "empty-panel": {
        label: "空 Panel",
        note: "两个面板视图都被挪去了侧栏：面板容器为空，但容器切换入口、标题与框架操作（位置 / 对齐 / 最大化 / 隐藏）照样在场。",
        placements: [
            {viewId: "lab.panel-a", containerId: LAB_LEFT_SECONDARY_CONTAINER.id},
            {viewId: "lab.panel-b", containerId: LAB_RIGHT_CONTAINER.id},
        ],
        box: {width: null, height: 720},
        hiddenParts: [],
    },
    containers: {
        label: "多容器单选",
        note: "主侧栏与面板各有两个容器：点标签切换活动容器（一个 Part 只显示一个），未活动的容器停在实例层 parking 不销毁；面板第二个容器默认为空，保留切换入口与空态说明。",
        activeContainers: {left: LAB_LEFT_SECONDARY_CONTAINER.id, panel: LAB_PANEL_SECONDARY_CONTAINER.id},
        box: {width: null, height: 720},
        hiddenParts: [],
    },
    "container-moved": {
        label: "整容器搬到 Panel",
        note: "主侧栏容器被整体搬到面板：它的视图归属、顺序与高度都不变，源 Part 回落到第二个容器（没有其它容器时显示可接收容器的空态落点）。",
        containerPlacements: [{containerId: LAB_LEFT_CONTAINER.id, location: "panel"}],
        box: {width: null, height: 720},
    },
    "view-reordered": {
        label: "容器内换序",
        note: "同一个容器里的两个 View 换了顺序（插到彼此之前）：归属不变，行高意图也不丢——换序不重建记录里的其它条目。",
        placements: [{viewId: "lab.extra-a", containerId: LAB_LEFT_CONTAINER.id, beforeViewId: "lab.primary"}],
        box: {width: null, height: 720},
    },
    "view-actions": {
        label: "View 贡献的标题动作",
        note: "panel-a 的动作跟着它自己的实例走：切到 panel-b，动作身份也随之切换，迟到的点击不会落到新实例上。",
        activeContainers: {panel: LAB_PANEL_CONTAINER.id},
        box: {width: null, height: 720},
    },
    narrow: {
        label: "窄画布 390×844（紧凑）",
        note: "紧凑呈现由**容器宽**驱动（不是 window 宽）：活动栏仍是左侧通高列，其余主体叶纵向排布，没有可拖边界。",
        box: {width: 390, height: 844},
    },
    short: {
        label: "短容器（高 260）",
        note: "高度装不下编辑区最小值 + Panel 最小值时先把 Panel 退成 32px 标题头；仍不足时编辑区取非负余量并给诊断。",
        box: {width: null, height: 260},
    },
    lifetime: {
        label: "实例生命周期探针",
        note: "面板视图上开了验收探针：换位置、最大化往返、隐藏与还原都不该重挂实例——输入值、滚动位置与焦点都要留住（计数据此判断）。",
        box: {width: null, height: 720},
        probes: true,
    },
    "view-hidden": {
        label: "视图不可见（空态给原因）",
        note: "第二个面板容器里只有一个 `when` 受限的视图：环境事实不满足时它不出现，容器空态把求值原因写出来——可见性不是权限，也不是加载中。",
        activeContainers: {panel: LAB_PANEL_SECONDARY_CONTAINER.id},
        box: {width: null, height: 720},
        hiddenParts: [],
    },
    "unknown-factory": {
        label: "未知 factoryKey（失败可见）",
        note: "panel-b 的 factoryKey 在这个场景里当作白名单未登记：容器把失败原因写在视图位置上，不留一块空白、不静默。",
        unknownFactoryKeys: ["lab.view.panel-b"],
        box: {width: null, height: 720},
    },
};

/**
 * 骨架默认隐藏右栏。
 *
 * Lab「随窗口」画布约 810px，而侧栏最小值是 280 + 320（产品合同，不在这里放松）：三栏全开时编辑列
 * 只剩 ~150px，Panel 标题区连一个动作按钮都放不下（标题操作会被挤成 0 宽）。所以默认藏起右栏，
 * 需要它的场景（`empty-panel`）显式写 `hiddenParts: []`；活动栏第二项随时可以手动显示。
 */
const DEFAULT_HIDDEN_PARTS: readonly string[] = ["right"];

const scene = computed<SkeletonScene>(() => SCENES[props.scene] ?? SCENES.default!);

// ── 探针：探针只开在面板视图上（它才是会被搬来搬去的那两个） ──────────────────────

function probesOf(viewId: string): boolean {
    return scene.value.probes === true && viewId.startsWith("lab.panel");
}

/**
 * 每个空白 View 一份「绑定好身份」的组件：实例层不传 props，因此身份与探针开关在这里闭包绑定。
 * 组件引用按 viewId 稳定复用，搬 DOM 不会换身份。
 */
const blankViews: Record<string, Component> = Object.fromEntries(LAB_VIEWS.map((view) => [
    view.factoryKey,
    defineComponent({
        name: `LabBlank_${view.id}`,
        setup: () => () => h(WorkbenchSkeletonView, {
            viewId: view.id,
            title: LAB_TITLES[view.titleKey] ?? view.titleKey,
            instanceIndex: LAB_VIEWS.findIndex((candidate) => candidate.id === view.id) + 1,
            actionKind: view.id === "lab.panel-a" ? "counter" : view.id === "lab.panel-b" ? "flag" : "none",
            probes: probesOf(view.id),
        }),
    }),
]));

/** 白名单：未知键返回结构化错误，**不回退产品解析器**（骨架不许把业务 View 拉进来）。 */
function resolveLabViewFactory(factoryKey: string): DescriptorResult<Component> {
    const active: SkeletonScene | undefined = SCENES[props.scene] ?? SCENES.default;
    if (active?.unknownFactoryKeys?.includes(factoryKey) === true) {
        return {ok: false, reason: `Lab 骨架没有登记这个 factoryKey：${factoryKey}`};
    }
    const component = blankViews[factoryKey];
    return component === undefined
        ? {ok: false, reason: `Lab 骨架没有登记这个 factoryKey：${factoryKey}`}
        : {ok: true, value: component};
}

// ── 内存状态：初值由场景决定，全部可重建 ────────────────────────────────────────

/**
 * 初始尺寸：Lab 画布（「随窗口」档）通常只有 ~810px 宽，产品默认的 340 + 400 会把编辑区挤到几十像素。
 * 骨架用它自己的一档初值（两侧栏都取最小值），保证默认场景就是「能看懂、能拖」的样子；
 * 产品默认值不在这里改——产品页面在自己的宽度下用 340 / 400。
 */
const LAB_SIZE_DEFAULTS: ShellSizePreferences = {
    ...SHELL_SIZE_DEFAULTS,
    leftPanelWidth: 220,
    agentPanelWidth: 220,
};
const sizes = ref<ShellSizePreferences>({...LAB_SIZE_DEFAULTS});
const hiddenParts = ref<readonly string[]>([]);
/** 「已确认记录」的内存替身：位置、活动页签与 Panel 偏好都由它派生（与产品同一套字段）。 */
const record = ref<WorkbenchViewCustomizationsRecord | null>(null);
const maximized = ref(false);
// shallowRef：呈现事实会被原样交给 Lab 数据面板（structuredClone），深响应会把嵌套对象变成 Proxy 而克隆失败。
const layoutFacts = shallowRef<ShellLayoutFacts | null>(null);
const notices = ref<readonly string[]>([]);

const panelPreferences = computed<WorkbenchPanelPreferences>(() => resolvePanelPreferences({
    position: record.value?.panelPosition,
    alignment: record.value?.panelAlignment,
    hidden: record.value?.panelHidden,
    collapsed: record.value?.panelCollapsed,
}));

const panel = computed<WorkbenchPanelState>(() => ({...panelPreferences.value, maximized: maximized.value}));

const contextKey = computed(() => `lab-skeleton:${props.scene}`);

const boxStyle = computed<Record<string, string>>(() => ({
    width: scene.value.box.width === null ? "100%" : `${String(scene.value.box.width)}px`,
    maxWidth: "100%",
    height: `${String(scene.value.box.height)}px`,
}));

function initialRecord(current: SkeletonScene): WorkbenchViewCustomizationsRecord | null {
    const patches: ViewPlacementsPatch[] = [];
    if (current.panel !== undefined) {
        patches.push({
            kind: "set-panel-state",
            ...(current.panel.position === undefined ? {} : {position: current.panel.position}),
            ...(current.panel.alignment === undefined ? {} : {alignment: current.panel.alignment}),
            ...(current.panel.hidden === undefined ? {} : {hidden: current.panel.hidden}),
            ...(current.panel.collapsed === undefined ? {} : {collapsed: current.panel.collapsed}),
        });
    }
    let record = patches.length === 0 ? null : composeViewPlacements(LAB_PLACEMENTS, null, patches).value;
    // 移动补丁要带**来源**（命令形状如此）：合成前先读一次当前生效落位，与页面同一条路径。
    for (const move of current.containerPlacements ?? []) {
        const effective = readContainerPlacements(LAB_PLACEMENTS, record?.containerPlacements)
            .placements.find((placement) => placement.containerId === move.containerId);
        if (effective === undefined) {
            continue;
        }
        record = composeViewPlacements(LAB_PLACEMENTS, record, [{
            kind: "move-container",
            containerId: move.containerId,
            sourceLocation: effective.location,
            targetLocation: move.location as ToolPartLocation,
            ...(move.beforeContainerId === undefined ? {} : {beforeContainerId: move.beforeContainerId}),
        }]).value;
    }
    for (const move of current.placements ?? []) {
        const effective = readViewPlacements(LAB_PLACEMENTS, record?.placements)
            .placements.find((placement) => placement.viewId === move.viewId);
        if (effective === undefined) {
            continue;
        }
        record = composeViewPlacements(LAB_PLACEMENTS, record, [{
            kind: "move-view",
            viewId: move.viewId,
            sourceContainerId: effective.containerId,
            targetContainerId: move.containerId,
            ...(move.beforeViewId === undefined ? {} : {beforeViewId: move.beforeViewId}),
        }]).value;
    }
    for (const [partId, containerId] of Object.entries(current.activeContainers ?? {})) {
        if (!isToolPartId(partId)) {
            continue;
        }
        record = composeViewPlacements(LAB_PLACEMENTS, record, [{kind: "select-container", partId, containerId}]).value;
    }
    return record;
}

/** 场景初值：切场景（或第一次挂载）时整份重建，并把事件与诊断清空。 */
function initializeScene(): void {
    // 探针计数必须在任何子组件挂载之前清掉（子组件挂载会 +1），因此它在 setup 的第一次调用里同步执行。
    resetSkeletonProbes();
    sizes.value = {...LAB_SIZE_DEFAULTS};
    hiddenParts.value = [...(scene.value.hiddenParts ?? DEFAULT_HIDDEN_PARTS)];
    maximized.value = scene.value.panel?.maximized === true;
    record.value = initialRecord(scene.value);
    layoutFacts.value = null;
    notices.value = [];
    lastEffectiveKey = "";
    emitLabEvent("shell-reset", {scene: props.scene});
    publishData();
}

// ── 求值：位置 + 可见性 + 活动页签（与产品同一个纯函数） ──────────────────────────

const presentation = computed<WorkbenchViewPresentation>(() => resolveViewPresentation({
    registry: LAB_REGISTRY,
    context: LAB_CONTEXT,
    overrides: record.value?.placements ?? {},
    customContainers: record.value?.customContainers,
    viewSizes: record.value?.viewSizes,
    containerOverrides: record.value?.containerPlacements ?? {},
    suppressedContainers: record.value?.suppressedContainers ?? {},
    activeContainerByPart: record.value?.activeContainerByPart ?? {},
    titleOf: (descriptor) => LAB_TITLES[descriptor.titleKey] ?? descriptor.titleKey,
    partTitleOf: (partId) => LAB_PART_TITLES[partId],
}));

const effectiveCatalog = computed(() => placementCatalogWithContainers(LAB_PLACEMENTS, record.value?.customContainers));

/** 容器实例层要的是**全部常驻**容器的切片（被抑制的也要活着，停在它自己的 parking）。 */
const containerSlices = computed<readonly ContainerViewPresentation[]>(() => presentation.value.residentContainers);

/** View 尺寸意图（内存记录里的那一份）。 */
const viewSizes = computed(() => record.value?.viewSizes ?? {});

const visibleViewIds = (): readonly string[] => presentation.value.entries
    .filter((entry) => entry.visible)
    .map((entry) => entry.view.id);

// ── 命令：注册表 + 端口（内存实现，返回值与产品的会话同形） ────────────────────────

const registry = createCommandRegistry({
    context: () => LAB_CONTEXT,
    agentMode: () => "normal",
    development: false,
    report: (error) => {
        note(`命令注册表报告异常：${error.message}`);
    },
});

function note(diagnosis: string): void {
    if (diagnosis.trim() !== "") {
        // 只留最近若干条：Lab 里看得到失败出口就够，不让诊断把数据面板顶爆。
        notices.value = [...notices.value, diagnosis].slice(-20);
    }
}

/** Panel 偏好写回：与产品同一个合成函数，`changed=false` 就是 `unchanged`（不伪报保存）。 */
function setPanelState(patch: Partial<WorkbenchPanelPreferences>): ShellCommandOutcome {
    const composed = composeViewPlacements(LAB_PLACEMENTS, record.value, [{kind: "set-panel-state", ...patch}]);
    if (!composed.changed) {
        return {status: "unchanged", diagnosis: composed.diagnosis};
    }
    record.value = composed.value;
    emitLabEvent("panel-state-change", {panel: {...panel.value}, patch: {...patch}, status: "saved"});
    publishData();
    return {status: "saved", diagnosis: ""};
}

/** 移动：先按 `resolveViewMove` 判越界与空操作，再合成；落到隐藏 / 收起的容器要显露目标。 */
function moveView(request: ViewMoveRequest): ShellCommandOutcome {
    const reading = readViewPlacements(effectiveCatalog.value, record.value?.placements);
    const decision = resolveViewMove({
        catalog: effectiveCatalog.value,
        reading,
        request,
        visibleViewIds: visibleViewIds(),
    });
    if (decision.kind === "rejected") {
        emitLabEvent("view-move", {...request, status: "rejected", diagnosis: decision.diagnosis});
        return {status: "rejected", diagnosis: decision.diagnosis};
    }
    if (decision.kind === "noop") {
        emitLabEvent("view-move", {...request, status: "noop", diagnosis: decision.diagnosis});
        return {status: "unchanged", diagnosis: decision.diagnosis};
    }
    const outcome = applyPatch([{
        kind: "move-view",
        viewId: decision.viewId,
        sourceContainerId: request.sourceContainerId,
        targetContainerId: decision.targetContainerId,
        ...(decision.beforeViewId === undefined ? {} : {beforeViewId: decision.beforeViewId}),
        ...(request.split === undefined ? {} : {split: request.split}),
    }]);
    if (outcome.status !== "saved") return outcome;
    revealTarget(decision.targetContainerId);
    emitLabEvent("view-move", {...request, status: "saved", diagnosis: ""});
    publishData();
    return {status: "saved", diagnosis: ""};
}

function detachView(request: ViewDetachRequest): ShellCommandOutcome {
    if (request.contextKey !== contextKey.value) {
        return {status: "rejected", diagnosis: "工作面已经切换，这次视图移动没有落账"};
    }
    const containerId = `custom:${crypto.randomUUID()}`;
    const outcome = applyPatch([{
        kind: "detach-view",
        viewId: request.viewId,
        sourceContainerId: request.sourceContainerId,
        targetLocation: request.targetLocation,
        beforeContainerId: request.beforeContainerId,
        containerId,
    }]);
    if (outcome.status === "saved") revealTarget(containerId);
    emitLabEvent("view-detach", {...request, containerId, ...outcome});
    return outcome;
}

/** 整容器移动：与 View 同一条路（先判来源与锚点，再合成，最后显露目标 Part 的容器）。 */
function moveContainer(request: ContainerMoveRequest): ShellCommandOutcome {
    const decision = resolveContainerMove({
        catalog: effectiveCatalog.value,
        reading: readContainerPlacements(effectiveCatalog.value, record.value?.containerPlacements),
        request,
    });
    if (decision.kind === "rejected") {
        emitLabEvent("container-move", {...request, status: "rejected", diagnosis: decision.diagnosis});
        return {status: "rejected", diagnosis: decision.diagnosis};
    }
    if (decision.kind === "noop") {
        emitLabEvent("container-move", {...request, status: "noop", diagnosis: decision.diagnosis});
        return {status: "unchanged", diagnosis: decision.diagnosis};
    }
    record.value = composeViewPlacements(LAB_PLACEMENTS, record.value, [{
        kind: "move-container",
        containerId: decision.containerId,
        sourceLocation: request.sourceLocation,
        targetLocation: decision.targetLocation,
        ...(decision.beforeContainerId === undefined ? {} : {beforeContainerId: decision.beforeContainerId}),
    }]).value;
    // 容器整体落到某个 Part：目标 Part 要显式打开（这里只有面板与两侧栏的隐藏位要清）。
    const targetPart = toolPartOfLocation(decision.targetLocation);
    if (targetPart === "panel") {
        record.value = composeViewPlacements(LAB_PLACEMENTS, record.value, [
            {kind: "set-panel-state", hidden: false, collapsed: false},
        ]).value;
    } else if (targetPart !== null && hiddenParts.value.includes(targetPart)) {
        hiddenParts.value = hiddenParts.value.filter((id) => id !== targetPart);
    }
    emitLabEvent("container-move", {...request, status: "saved", diagnosis: ""});
    publishData();
    return {status: "saved", diagnosis: ""};
}

/** 选择一个 Part 的活动容器：合成同时清该 Part 的显式隐藏与拖收起，并把隐藏位在 Lab 里真的打开。 */
function selectContainer(partId: ToolPartId, containerId: string): ShellCommandOutcome {
    const composed = composeViewPlacements(LAB_PLACEMENTS, record.value, [{kind: "select-container", partId, containerId}]);
    if (!composed.changed) {
        return {status: "unchanged", diagnosis: composed.diagnosis};
    }
    record.value = composed.value;
    if (partId === "panel") {
        record.value = composeViewPlacements(LAB_PLACEMENTS, record.value, [
            {kind: "set-panel-state", hidden: false, collapsed: false},
        ]).value;
    } else if (hiddenParts.value.includes(partId)) {
        hiddenParts.value = hiddenParts.value.filter((id) => id !== partId);
    }
    if (dragCollapsed.value[partId] === true) {
        dragCollapsed.value = {...dragCollapsed.value, [partId]: false};
    }
    emitLabEvent("container-select", {partId, containerId, status: "saved"});
    publishData();
    return {status: "saved", diagnosis: ""};
}

/** 目标容器此刻被隐藏或收起时把它显露出来（移动本身不改 Panel 位置）。 */
function revealTarget(containerId: string): void {
    const part = containerPlacementPart(containerId);
    if (part === "panel" && (panel.value.hidden || panel.value.collapsed)) {
        record.value = composeViewPlacements(LAB_PLACEMENTS, record.value, [
            {kind: "set-panel-state", hidden: false, collapsed: false},
        ]).value;
        emitLabEvent("panel-state-change", {panel: {...panel.value}, patch: {hidden: false, collapsed: false}, status: "saved"});
        return;
    }
    if (part !== null && part !== "panel" && hiddenParts.value.includes(part)) {
        hiddenParts.value = hiddenParts.value.filter((id) => id !== part);
    }
}

/** 某个容器此刻生效的 Part（容器可能已经被用户搬到别的落位）。 */
function containerPlacementPart(containerId: string): ToolPartId | null {
    const placement = readContainerPlacements(effectiveCatalog.value, record.value?.containerPlacements)
        .placements.find((entry) => entry.containerId === containerId);
    return placement === undefined ? null : toolPartOfLocation(placement.location);
}

/** 一次内存合成：`changed=false` 就是 `unchanged`（不伪报保存）。 */
function applyPatch(patches: readonly ViewPlacementsPatch[]): ShellCommandOutcome {
    const composed = composeViewPlacements(LAB_PLACEMENTS, record.value, patches);
    if (composed.conflicts.length > 0) {
        return {status: "rejected", diagnosis: composed.conflicts.join("；")};
    }
    if (!composed.changed) {
        return {status: "unchanged", diagnosis: composed.diagnosis};
    }
    record.value = composed.value;
    publishData();
    return {status: "saved", diagnosis: ""};
}

/** 某个 Part 的显式隐藏 / 拖收起：拖收起位是独立偏好，落进 Lab 的内存 ref。 */
function setPartVisibility(input: {partId: ToolPartId; hidden?: boolean; dragCollapsed?: boolean}): ShellCommandOutcome {
    const outcome = applyPatch([{
        kind: "set-part-visibility",
        partId: input.partId,
        ...(input.hidden === undefined ? {} : {hidden: input.hidden}),
        ...(input.dragCollapsed === undefined ? {} : {dragCollapsed: input.dragCollapsed}),
    }]);
    if (outcome.status === "saved" && input.dragCollapsed !== undefined) {
        dragCollapsed.value = {...dragCollapsed.value, [input.partId]: input.dragCollapsed};
        return {status: "saved", diagnosis: ""};
    }
    if (outcome.status === "saved" && input.hidden !== undefined) {
        hiddenParts.value = input.hidden
            ? [...hiddenParts.value.filter((id) => id !== input.partId), input.partId]
            : hiddenParts.value.filter((id) => id !== input.partId);
    }
    return outcome;
}

const shellPort: WorkbenchShellCommandPort = {
    state: () => ({panel: panel.value, mode: layoutFacts.value?.mode ?? "split", ready: true}),
    setPanelState: (patch) => Promise.resolve(setPanelState(patch)),
    setMaximized: (value) => {
        if (maximized.value === value) {
            return;
        }
        maximized.value = value;
        emitLabEvent("panel-state-change", {panel: {...panel.value}, patch: {maximized: value}, status: "unchanged"});
        publishData();
    },
    moveView: (request) => Promise.resolve(moveView(request)),
    moveContainer: (request) => Promise.resolve(moveContainer(request)),
    selectContainer: (partId, containerId) => Promise.resolve(selectContainer(partId, containerId)),
    restoreContainerPlacement: (containerId) => Promise.resolve(applyPatch([{kind: "restore-container-placement", containerId}])),
    mergeContainer: (request) => Promise.resolve(applyPatch([{
        kind: "merge-container",
        sourceContainerId: request.sourceContainerId,
        sourceLocation: request.sourceLocation,
        targetContainerId: request.targetContainerId,
        targetLocation: request.targetLocation,
        sourceViewIds: request.sourceViewIds,
        ...(request.beforeViewId === undefined ? {} : {beforeViewId: request.beforeViewId}),
        ...(request.split === undefined ? {} : {split: request.split}),
    }])),
    reopenContainer: (containerId) => Promise.resolve(applyPatch([{kind: "reopen-container", containerId}])),
    restoreViewPlacement: (viewId) => Promise.resolve(applyPatch([{kind: "restore-view-placement", viewId}])),
    setPartVisibility: (input) => Promise.resolve(setPartVisibility(input)),
    revealView: (viewId) => {
        const outcome = applyPatch([{kind: "reveal-view", viewId}]);
        const entry = presentation.value.entries.find((candidate) => candidate.view.id === viewId);
        if (entry !== undefined) {
            revealTarget(entry.containerId);
        }
        emitLabEvent("view-reveal", {viewId, status: outcome.status});
        return Promise.resolve(outcome);
    },
};

const releases: Release[] = [];

const shellCommandRegistration = registerWorkbenchShellCommands(registry, shellPort);
if (shellCommandRegistration.ok) {
    releases.push(shellCommandRegistration.value);
} else {
    note(`框架命令没有注册成功：${shellCommandRegistration.reason}`);
}

/** Lab 专属 View 命令：参数统一 `{viewId, generation}`，执行路由到实例自己的句柄。 */
const LAB_COMMAND_CATEGORY = "workbenchCommands.category.view";

function labCommand(commandId: string, actionId: string, titleKey: string, icon: string, description: string): ViewTitleCommandContribution {
    return {
        actionId,
        command: {
            id: commandId,
            titleKey,
            description,
            categoryKey: LAB_COMMAND_CATEGORY,
            icon,
            argsSchema: VIEW_ACTION_ARGS_SCHEMA,
            effect: "write",
            expose: {agent: "never"},
        },
    };
}

const LAB_VIEW_COMMANDS: readonly ViewTitleCommandContribution[] = [
    labCommand("nbook.view.lab-increment", "increment", "lab.command.increment", "i-lucide-plus", "Increment the demo counter of the target skeleton view instance."),
    labCommand("nbook.view.lab-reset", "reset", "lab.command.reset", "i-lucide-rotate-ccw", "Reset the demo counter of the target skeleton view instance."),
    labCommand("nbook.view.lab-toggle", "toggle", "lab.command.toggle", "i-lucide-flag", "Toggle the demo marker of the target skeleton view instance."),
    labCommand("nbook.view.lab-disabled", "disabled", "lab.command.disabled", "i-lucide-ban", "A deliberately unavailable demo action of the target skeleton view instance."),
];

/** View 动作状态与句柄的宿主侧映射（与主页同一个 composable）。 */
const viewActions = useWorkbenchViewActions({
    registry,
    entries: () => presentation.value.entries,
    titleOf: (metadata) => LAB_COMMAND_TITLES[metadata.titleKey] ?? metadata.titleKey,
    context: () => LAB_CONTEXT,
    onFailure: (diagnosis) => {
        note(diagnosis);
    },
});

const viewCommandRegistration = registerViewTitleCommands(registry, LAB_VIEW_COMMANDS, {
    runAction: (target: ViewActionTarget, actionId: string) => viewActions.runAction(target, actionId),
});

if (viewCommandRegistration.ok) {
    releases.push(viewCommandRegistration.value);
} else {
    note(`View 命令没有注册成功：${viewCommandRegistration.reason}`);
}

/** 每次命令执行都进事件日志：动作结果带 command / target / result（失败也在里面）。 */
releases.push(registry.onDidExecuteCommand((event) => {
    emitLabEvent("view-action-result", {
        command: event.id,
        requestedId: event.requestedId,
        target: event.args,
        result: event.result,
    });
}));

onBeforeUnmount(() => {
    for (const release of releases.splice(0)) {
        release();
    }
});

// ── 文案：Lab 用字面量，产品侧走 i18n（key 与 `PANEL_ACTION_KEYS` 同一份） ─────

const LAB_COMMAND_TITLES: Record<string, string> = {
    "lab.command.increment": "增加演示计数",
    "lab.command.reset": "重置演示计数",
    "lab.command.toggle": "切换演示标记",
    "lab.command.disabled": "演示禁用动作",
};

const LAB_PANEL_TITLES: Record<string, string> = {
    [PANEL_ACTION_KEYS.more]: "框架操作",
    [PANEL_ACTION_KEYS.position]: "面板位置",
    [PANEL_ACTION_KEYS.alignment]: "面板对齐",
    [PANEL_ACTION_KEYS.positionBottom]: "底部",
    [PANEL_ACTION_KEYS.positionTop]: "顶部",
    [PANEL_ACTION_KEYS.positionLeft]: "左侧",
    [PANEL_ACTION_KEYS.positionRight]: "右侧",
    [PANEL_ACTION_KEYS.alignCenter]: "居中",
    [PANEL_ACTION_KEYS.alignLeft]: "左对齐",
    [PANEL_ACTION_KEYS.alignRight]: "右对齐",
    [PANEL_ACTION_KEYS.alignJustify]: "两端对齐",
    [PANEL_ACTION_KEYS.hide]: "隐藏面板",
    [PANEL_ACTION_KEYS.show]: "显示面板",
    [PANEL_ACTION_KEYS.collapse]: "收起为标题头",
    [PANEL_ACTION_KEYS.expand]: "展开面板",
    [PANEL_ACTION_KEYS.maximize]: "最大化面板",
    [PANEL_ACTION_KEYS.restore]: "还原面板尺寸",
    // 禁用原因也走 i18n：Lab 里给字面量，产品侧由语言文件给（key 清单见任务汇报）。
    [PANEL_ACTION_KEYS.reasonNotReady]: "工具位置记录还没完成首次读取，面板操作暂不可用",
    [PANEL_ACTION_KEYS.reasonCompact]: "紧凑呈现下不可用：退出紧凑模式再操作面板位置、对齐或最大化",
    [PANEL_ACTION_KEYS.reasonNeedsCenter]: "居中对齐后可最大化：当前对齐不支持",
    [PANEL_ACTION_KEYS.reasonSideAlignment]: "左右位置的 Panel 只有一种跨度：切回底部或顶部再调整对齐",
    [PANEL_ACTION_KEYS.reasonSideCollapse]: "只有水平面板（底部 / 顶部）可以收起为标题头",
};

/** 框架菜单：与命令同一套可用性判定（不可用就禁用并给原因，不靠点击才发现）。 */
const panelActions = computed(() => resolvePanelTitleActions({
    state: panel.value,
    mode: layoutFacts.value?.mode ?? "split",
    ready: true,
    titleOf: (titleKey) => LAB_PANEL_TITLES[titleKey] ?? titleKey,
}));

// ── 手势、事实与事件 ────────────────────────────────────────────────────────────

function onResize(payload: {contextKey: string; patch: ShellSizePatch}): void {
    sizes.value = mergeShellSizePatch(sizes.value, payload.patch);
    // 拖到零是独立偏好位：Lab 只维护自己的内存状态，不落任何存储。
    if (payload.patch.dragCollapsed !== undefined) {
        dragCollapsed.value = {...dragCollapsed.value, ...payload.patch.dragCollapsed};
    }
    emitLabEvent("shell-resize", {contextKey: payload.contextKey, patch: {...payload.patch}});
    publishData();
}

/**
 * 用户拖到零的 Part：与隐藏分开的**偏好位**，保留展开尺寸意图与 1px 可拖边界。
 * Lab 只放内存里，产品侧由定制记录（`setPartVisibility`）持有。
 */
const dragCollapsed = ref<ShellDragCollapseMap>({});

let lastEffectiveKey = "";

function onLayout(facts: ShellLayoutFacts): void {
    layoutFacts.value = facts;
    const effective = facts.effectivePanel;
    const key = `${effective.position}|${effective.alignment}|${effective.collapsed}|${effective.maximized}|${facts.mode}|${facts.extent.width}x${facts.extent.height}`;
    if (key === lastEffectiveKey) {
        return;
    }
    lastEffectiveKey = key;
    // 无效的瞬时最大化由壳清除，宿主跟着清自己的 ref（不写任何存储）。
    if (effective.maximized !== maximized.value) {
        maximized.value = effective.maximized;
        emitLabEvent("panel-state-change", {panel: {...panel.value}, patch: {maximized: effective.maximized}, status: "unchanged"});
    }
    publishData();
}

function onGestureCancel(payload: {reason: string}): void {
    emitLabEvent("shell-gesture-cancel", {...payload});
    publishData();
}

// ── 宿主侧动作路由（菜单 / 拖动 / 标签 / 折叠走同一条命令） ────────────────────────

function executeShellCommand(commandId: string, args?: unknown): void {
    void registry.executeCommand(commandId, args).then((result) => {
        if (!result.ok) {
            note(result.reason);
        }
        publishData();
    });
}

function onMoveViewRequest(request: ViewMoveRequest): void {
    executeShellCommand(SHELL_PANEL_COMMAND_IDS.moveView, {
        viewId: request.viewId,
        sourceContainerId: request.sourceContainerId,
        targetContainerId: request.targetContainerId,
        ...(request.beforeViewId === undefined ? {} : {beforeViewId: request.beforeViewId}),
    });
}

/** 容器整体移动：落到哪个 Part 由落点数据给，命令层再校验一次来源与锚点。 */
function onMoveContainerRequest(request: ContainerMoveRequest): void {
    executeShellCommand(SHELL_CONTAINER_COMMAND_IDS.move, {
        containerId: request.containerId,
        sourceLocation: request.sourceLocation,
        targetLocation: request.targetLocation,
        ...(request.beforeContainerId === undefined ? {} : {beforeContainerId: request.beforeContainerId}),
    });
}

/** 容器选择：`Part` 由容器当前的生效落位求值，不从落点文本猜。 */
function onSelectContainer(containerId: string, partId: ToolPartId): void {
    executeShellCommand(SHELL_CONTAINER_COMMAND_IDS.select, {partId, containerId});
}

/** 标签 / 落点回传的容器 id → 它此刻生效的 Part（拒绝与诊断归命令层）。 */
function selectContainerById(containerId: string): void {
    onSelectContainer(containerId, partOfContainer(containerId));
}

/** 一场 View 尺寸手势：与位置会话同形，直接合进内存记录（唯一写者的 Lab 替身）。 */
function onViewSizes(payload: WorkbenchViewSizesEvent): void {
    const outcome = applyPatch([{
        kind: "set-view-sizes",
        containerId: payload.containerId,
        sourceLocation: payload.sourceLocation,
        contextKey: contextKey.value,
        patches: payload.patches,
    }]);
    emitLabEvent("view-sizes", {...payload, status: outcome.status});
}

/** 容器动作组：只有一条「恢复默认落点」，但它经的是真实容器命令。 */
const containerActions = computed<WorkbenchTitleActionItems>(() => ({
    primary: [],
    secondary: [{id: SHELL_CONTAINER_COMMAND_IDS.restore, label: "恢复默认落点", icon: "i-lucide-rotate-ccw"}],
}));

function onPanelCollapse(payload: {collapsed: boolean}): void {
    executeShellCommand(SHELL_PANEL_COMMAND_IDS.setCollapsed, {collapsed: payload.collapsed});
}

function onTitleAction(payload: {scope: "view"; target: ViewActionTarget; actionId: string} | {scope: "container"; target: {containerId: string}; actionId: string} | {scope: "panel"; actionId: string}): void {
    if (payload.scope === "view") {
        void viewActions.run(payload.target, payload.actionId).then((result) => {
            if (!result.ok) {
                note(result.reason);
            }
            publishData();
        });
        return;
    }
    if (payload.scope === "container") {
        // 容器动作组里目前只有「恢复默认落点」：走容器命令，不在宿主里写第二套位置逻辑。
        executeShellCommand(SHELL_CONTAINER_COMMAND_IDS.restore, {containerId: payload.target.containerId});
        return;
    }
    executePanelItem(payload.actionId);
}

/** 框架菜单项 id → 命令调用（`executePanelActionItem` 是唯一映射）；失败在一个出口汇总。 */
function executePanelItem(itemId: string): void {
    void executePanelActionItem(registry, itemId).then((result: CommandResult<unknown>) => {
        if (!result.ok) {
            note(result.reason);
        }
        publishData();
    });
}

// ── 拖动：整标题都是拖动面（`useWorkbenchDrag`） + KeyboardSensor ─────────────────
//
// `handle ?? element`：dnd-kit 的默认激活元素就是这个；只写 `source.handle` 时，没给 handle 的
// 拖动源会被静默跳过（一个 pointerdown 监听器都不挂），表现为"按下去毫无反应"。

/**
 * 拖放：判定、预览与提交都在 `useWorkbenchDrop` 里，Lab 与产品用**同一套**几何登记与 resolver。
 *
 * 端口指向命令层（`moveView` / `moveContainer` / `mergeContainer` 都过命令校验），Lab 不另写一条
 * 「先试内存」的捷径：落点判定的结论与真实命令的结论必须一致，否则这条验收就不成立。
 */
const workbenchDrop = useWorkbenchDrop({
    presentation: () => presentation.value,
    contextKey: () => contextKey.value,
    ports: {
        moveView: (request) => Promise.resolve(moveView(request)),
        detachView: (request) => Promise.resolve(detachView(request)),
        moveContainer: (request) => Promise.resolve(moveContainer(request)),
        mergeContainer: (request) => shellPort.mergeContainer(request),
    },
    onOutcome: (outcome) => {
        if (outcome.status === "rejected" || outcome.status === "pending") {
            note(outcome.diagnosis);
            emitLabEvent("drop-rejected", {...outcome});
        } else {
            emitLabEvent("drop-committed", {...outcome});
        }
    },
});

/** 预览文案：动作种类 + 并入的视图数（与产品用同一句话术来源）；`noop` 带预览时只承诺保持布局。 */
const dropPreviewLabel = computed(() => {
    const preview = workbenchDrop.preview.value;
    if (preview === null || preview.indicator !== null) {
        return "";
    }
    if (workbenchDrop.decision.value === "noop") {
        return "保持当前布局";
    }
    return workbenchDrop.decision.value === "merge-container"
        ? `并入 ${String(preview.count)} 个视图`
        : workbenchDrop.decision.value === "move-container"
            ? "移动容器"
            : "移动视图";
});

/** 跟随指针的唯一 Overlay 的文案：与产品同一口径（源载荷 → 当前呈现的标题 / 图标，取不到回落 id）。 */
const dropOverlay = computed<{label: string; iconClass: string | undefined} | null>(() => {
    const source = workbenchDrop.source.value;
    if (source === null) {
        return null;
    }
    if (source.kind === "workbench-view") {
        const entry = presentation.value.entries.find((item) => item.view.id === source.viewId) ?? null;
        return {label: entry?.title ?? source.viewId, iconClass: entry?.view.icon};
    }
    const container = presentation.value.container(source.containerId);
    return {label: container?.title ?? source.containerId, iconClass: container?.icon};
});

// ── 活动栏与状态栏：都是 fixture 语义内的真实动作 ────────────────────────────────

/**
 * 上半 = **当前位于主侧栏的容器**（与产品同一口径）：点它选择，重复点当前项保持选择并打开被隐藏的主侧栏。
 * 显隐演示（左右栏 / 面板）退休到活动栏底部与骨架控制条。
 */
const activityPrimary = computed<ActivityItem[]>(() => (presentation.value.part("left").containers)
    .map((container) => ({
        id: container.containerId,
        label: container.title,
        icon: container.icon,
        active: container.containerId === presentation.value.part("left").activeContainerId,
    })));

/** 容器条目要的额外事实：Lab 与产品共用同一份活动栏契约（拖源 / 落点 / 几何）。 */
const activityContainerFacts = computed(() => presentation.value.part("left").containers.map((container) => ({
    containerId: container.containerId,
    location: container.location,
    partId: container.partId,
    viewIds: container.memberViewIds,
    canMoveContainer: container.canMoveContainer,
})));

/**
 * 中段的「揭示」不再是活动栏条目：每个 View 一项的 secondary 会让活动栏看起来像视图选择器，
 * 而活动栏的职责是容器切换。揭示命令改到骨架控制条的独立按钮（见 `revealControls`）。
 */
const revealControls = computed(() => presentation.value.entries.map((entry) => ({
    viewId: entry.view.id,
    label: entry.title,
})));

const activityFooter: readonly ActivityItem[] = [
    {id: "toggle-left", label: "主侧边栏", icon: "i-lucide-panel-left"},
    {id: "toggle-right", label: "辅助侧边栏", icon: "i-lucide-panel-right"},
    {id: "toggle-panel", label: "面板", icon: "i-lucide-panel-bottom"},
    {id: "footer-show-panel", label: "恢复面板", icon: "i-lucide-panel-bottom"},
    {id: "footer-reset", label: "重置演示", icon: "i-lucide-rotate-ccw"},
];

/** 某个容器此刻生效的 Part（容器可以被搬到别的落位，所以不能按声明默认值猜）。 */
function partOfContainer(containerId: string): ToolPartId {
    return containerPlacementPart(containerId) ?? "left";
}

function onActivityInvoke(id: string): void {
    emitLabEvent("activity-invoke", {id});
    switch (id) {
        case "toggle-left":
            hiddenParts.value = hiddenParts.value.includes("left")
                ? hiddenParts.value.filter((part) => part !== "left")
                : [...hiddenParts.value, "left"];
            break;
        case "toggle-right":
            hiddenParts.value = hiddenParts.value.includes("right")
                ? hiddenParts.value.filter((part) => part !== "right")
                : [...hiddenParts.value, "right"];
            break;
        case "toggle-panel":
            executeShellCommand(SHELL_PANEL_COMMAND_IDS.setHidden, {hidden: !panel.value.hidden});
            break;
        case "footer-show-panel":
            executeShellCommand(SHELL_PANEL_COMMAND_IDS.setHidden, {hidden: false});
            break;
        case "footer-reset":
            initializeScene();
            break;
        default:
            // 容器条目 id 就是 containerId；别的 id 只在控制条里出现，不该走到这条事件上。
            if (LAB_CONTAINERS.some((container) => container.id === id)) {
                onSelectContainer(id, partOfContainer(id));
                return;
            }
            emitLabEvent("activity-invoke-unknown", {id});
            break;
    }
}

const statusLeft = computed(() => [
    {id: "scene", label: `场景：${scene.value.label}`, icon: "i-lucide-flask-conical", clickable: false},
    {
        id: "mode",
        label: (layoutFacts.value?.mode ?? "split") === "compact" ? "紧凑呈现" : "分栏呈现",
        icon: "i-lucide-columns-2",
        clickable: false,
    },
    {
        id: "panel-state",
        label: `${panel.value.hidden ? "面板隐藏" : panel.value.collapsed ? "面板收起" : "面板展开"} · ${panel.value.position}/${panel.value.alignment}${maximized.value ? " · 最大化" : ""}`,
        icon: "i-lucide-layout-panel-top",
        clickable: false,
    },
]);

const visibleViewCount = computed(() => presentation.value.entries.filter((entry) => entry.visible).length);

// ── 数据面板：只发布 JSON 安全的事实，不发 DOM / 句柄 / 函数 ──────────────────────

function publishData(): void {
    publishLabData({
        scene: props.scene,
        sizes: {...sizes.value},
        panel: {...panel.value},
        hiddenParts: [...hiddenParts.value],
        placements: Object.fromEntries(Object.entries(record.value?.placements ?? {}).map(([viewId, placement]) => [viewId, {...placement}])),
        customContainers: Object.fromEntries(Object.entries(record.value?.customContainers ?? {}).map(([containerId, container]) => [containerId, {...container}])),
        containerPlacements: Object.fromEntries(Object.entries(record.value?.containerPlacements ?? {}).map(([containerId, placement]) => [containerId, {...placement}])),
        activeContainerByPart: {...(record.value?.activeContainerByPart ?? {})},
        viewSizes: Object.fromEntries(Object.entries(record.value?.viewSizes ?? {}).map(([viewId, size]) => [viewId, {...size}])),
        mode: layoutFacts.value?.mode ?? "split",
        effectivePanel: layoutFacts.value?.effectivePanel ?? null,
        layoutIssues: [...(layoutFacts.value?.issues ?? [])],
        visibleViews: presentation.value.entries.filter((entry) => entry.visible).map((entry) => entry.view.id),
        notices: [...notices.value],
        probes: skeletonProbeSnapshot(),
    });
}

watch([sizes, record, hiddenParts, layoutFacts, maximized, notices], () => {
    publishData();
}, {deep: true});

// ── 标题栏：无 bridge、无窗口按钮、无不可执行菜单 ────────────────────────────────

const titleBarOpenMenu = ref<string | null>(null);

/** Lab 里的标题条只是一个「受检零件在壳里也在场」的证明：菜单、窗口按钮、Project 切换都不给。 */
const TITLEBAR_CAPABILITIES = {desktop: false, surfaceActive: false, editTarget: "none"} as const;

// ── 模板用的解析助手（模板里不写非空断言，避免 TS 语法进模板表达式） ────────────────

const POSITION_TITLE_KEY: Record<ShellPanelPosition, string> = {
    bottom: PANEL_ACTION_KEYS.positionBottom,
    top: PANEL_ACTION_KEYS.positionTop,
    left: PANEL_ACTION_KEYS.positionLeft,
    right: PANEL_ACTION_KEYS.positionRight,
};

const ALIGNMENT_TITLE_KEY: Record<ShellPanelAlignment, string> = {
    center: PANEL_ACTION_KEYS.alignCenter,
    left: PANEL_ACTION_KEYS.alignLeft,
    right: PANEL_ACTION_KEYS.alignRight,
    justify: PANEL_ACTION_KEYS.alignJustify,
};

/** 控制条上的位置 / 对齐快捷键：与菜单同源（同一条命令、同一份文案与同一套可用性）。 */
const POSITION_CONTROLS = SHELL_PANEL_POSITIONS.map((position) => ({
    value: position,
    label: LAB_PANEL_TITLES[POSITION_TITLE_KEY[position]] ?? position,
}));

const ALIGNMENT_CONTROLS = SHELL_PANEL_ALIGNMENTS.map((alignment) => ({
    value: alignment,
    label: LAB_PANEL_TITLES[ALIGNMENT_TITLE_KEY[alignment]] ?? alignment,
}));

/**
 * 换场景 = 重建初值。watch 与首次调用都放在最后：`initializeScene` 会读 `presentation` 等常量，
 * 提前触发会踩到暂时性死区；首次调用还必须在任何子组件挂载之前同步跑完，探针计数才清得干净。
 */
watch(() => props.scene, () => {
    initializeScene();
});

initializeScene();
</script>

<template>
    <!--
        根不长成 `h-full overflow-hidden`：画布盒子可能比可视区高（720 / 窄屏 844），
        裁掉它会让状态栏这类贴底落点永远滚不到，验收点也点不着。让 Lab 的滚动容器去滚。
    -->
    <div class="flex min-h-full w-full flex-col gap-[var(--space-2)] p-[var(--space-2)]" data-workbench-skeleton-fixture>
        <DragDropProvider
            :sensors="workbenchDrop.sensors"
            @drag-start="workbenchDrop.handlers.onDragStart"
            @drag-move="workbenchDrop.handlers.onDragMove"
            @drag-over="workbenchDrop.handlers.onDragOver"
            @drag-end="workbenchDrop.handlers.onDragEnd">
            <!-- 换场景 = 换一套空白实例：key 让实例层（连同壳与宿主）整体重建，演示状态与探针计数都回初值。 -->
            <WorkbenchViewInstances
                :key="props.scene"
                :views="presentation.entries"
                :view-factory-resolver="resolveLabViewFactory"
                @view-actions="viewActions.setStates"
                @view-handle-ready="viewActions.bindHandle"
            >
                <!-- 容器实例层：每个容器一个 ViewHost，按 Part 宿主的挂载目标用 Teleport 搬进去。 -->
                <WorkbenchContainerInstances
                    :containers="containerSlices"
                    :view-sizes="viewSizes"
                    :context-key="contextKey"
                    :allow-container-move="true"
                    :actions-by-view="viewActions.actionsByView.value"
                    :allow-view-move="true"
                    move-label="移动到"
                    view-actions-label="视图操作"
                    @move-view="onMoveViewRequest"
                    @view-sizes="onViewSizes"
                    @title-action="onTitleAction"
                >
                <!-- 画布盒子：高度由场景给（720 / 260 / 窄屏 844），不用 `flex-1`——那会按剩余空间拉伸而不是保持场景尺寸。 -->
                <div class="flex min-h-0 min-w-0 flex-col" :style="boxStyle">
                    <WorkbenchShellLayout
                        data-lab-subject
                        :sizes="sizes"
                        :panel="panel"
                        :context-key="contextKey"
                        :hidden-parts="hiddenParts"
                        :drag-collapsed-parts="dragCollapsed"
                        @resize="onResize"
                        @layout="onLayout"
                        @gesture-cancel="onGestureCancel"
                    >
                        <template #titlebar>
                            <DesktopTitleBarChrome
                                v-model:open-menu="titleBarOpenMenu"
                                title="NeuroBook 工作台骨架（Lab）"
                                :projects="[]"
                                :current-project-root="null"
                                :capabilities="TITLEBAR_CAPABILITIES"
                                :project-url="null"
                                :agent-panel-available="false"
                                :agent-panel-open="false"
                                :renderer-menus="false"
                                :custom-window-controls="false"
                                :connection="null"
                            />
                        </template>

                        <template #activity>
                            <WorkbenchActivityBar
                                :primary="activityPrimary"
                                :secondary="[]"
                                :containers="activityContainerFacts"
                                :allow-container-move="true"
                                :allow-view-move="true"
                                :context-key="contextKey"
                                :footer="activityFooter"
                                label="活动栏（演示）"
                                more-label="更多入口"
                                @invoke="onActivityInvoke"
                                :container-actions="containerActions"
                                @container-action="(containerId: string, actionId: string) => onTitleAction({scope: 'container', target: {containerId}, actionId})"
                            />
                        </template>

                        <template #left>
                            <WorkbenchPartHost
                                :presentation="presentation.part('left')"
                                :context-key="contextKey"
                                :container-actions="containerActions"
                                container-actions-label="容器操作"
                                move-container-label="移动到"
                                :allow-container-move="true"
                                :allow-view-move="true"
                                @select-container="selectContainerById"
                                @move-container="onMoveContainerRequest"
                                @move-view="onMoveViewRequest"
                                @title-action="onTitleAction"
                            />
                        </template>

                        <template #editor>
                            <div class="flex h-full min-h-0 w-full flex-col items-center justify-center gap-[var(--space-2)] bg-[var(--bg-main)]" data-lab-editor>
                                <span class="i-lucide-square h-5 w-5 text-[var(--text-muted)]" aria-hidden="true"></span>
                                <p class="text-[var(--text-sm)] text-[var(--text-secondary)]">编辑区 / Editor Area</p>
                                <p class="max-w-[44ch] text-center text-[11px] leading-relaxed text-[var(--text-muted)]">
                                    骨架不加载 EditorWorkbench / TipTap / Monaco，也没有文档模型：这里只是一块空白落点。
                                </p>
                            </div>
                        </template>

                        <template #right>
                            <WorkbenchPartHost
                                :presentation="presentation.part('right')"
                                :context-key="contextKey"
                                :container-actions="containerActions"
                                container-actions-label="容器操作"
                                move-container-label="移动到"
                                :allow-container-move="true"
                                :allow-view-move="true"
                                @select-container="selectContainerById"
                                @move-container="onMoveContainerRequest"
                                @move-view="onMoveViewRequest"
                                @title-action="onTitleAction"
                            />
                        </template>

                        <template #panel="{ collapsed }">
                            <WorkbenchPartHost
                                :presentation="presentation.part('panel')"
                                :context-key="contextKey"
                                :panel-collapsed="collapsed"
                                :panel-actions="panelActions"
                                panel-actions-label="面板操作"
                                panel-collapse-label="收起面板"
                                :container-actions="containerActions"
                                container-actions-label="容器操作"
                                move-container-label="移动到"
                                :allow-container-move="true"
                                :allow-view-move="true"
                                @select-container="selectContainerById"
                                @move-container="onMoveContainerRequest"
                                @move-view="onMoveViewRequest"
                                @title-action="onTitleAction"
                                @panel-collapse="onPanelCollapse"
                            />
                        </template>

                        <template #statusbar>
                            <WorkbenchStatusBar>
                                <template #left>
                                    <WorkbenchStatusBarItem
                                        v-for="item in statusLeft"
                                        :key="item.id"
                                        :id="item.id"
                                        :label="item.label"
                                        :icon="item.icon"
                                        :clickable="item.clickable"
                                    />
                                </template>

                                <template #right>
                                    <WorkbenchStatusBarItem
                                        id="visible-views"
                                        :label="`视图 ${visibleViewCount}/${LAB_VIEWS.length}`"
                                        icon="i-lucide-square-dashed"
                                        :clickable="false"
                                    />
                                    <!-- 隐藏面板后焦点落到这里（壳按 data-shell-focus-target 查它）。 -->
                                    <WorkbenchStatusBarItem
                                        id="panel-toggle"
                                        data-shell-focus-target="panel-toggle"
                                        :label="panel.hidden ? '显示面板' : '隐藏面板'"
                                        icon="i-lucide-panel-bottom"
                                        :active="!panel.hidden"
                                        :aria-label="panel.hidden ? '显示面板' : '隐藏面板'"
                                        @click="executeShellCommand(SHELL_PANEL_COMMAND_IDS.setHidden, {hidden: !panel.hidden})"
                                    />
                                </template>
                            </WorkbenchStatusBar>
                        </template>
                    </WorkbenchShellLayout>
                </div>
                </WorkbenchContainerInstances>
            </WorkbenchViewInstances>
        <WorkbenchDropOverlay
            :preview="workbenchDrop.preview.value"
            :kind="workbenchDrop.decision.value ?? ''"
            :label="dropPreviewLabel"
        />
        <!-- 唯一 Custom Overlay：跟指针走的是它，源条目原地不动、也不生成占位副本。 -->
        <WorkbenchDragOverlay
            :source="workbenchDrop.source.value"
            :label="dropOverlay?.label ?? ''"
            :icon-class="dropOverlay?.iconClass"
        />
        </DragDropProvider>

        <p v-if="notices.length > 0" class="shrink-0 rounded-[var(--radius-control)] border border-[var(--panel-outline)] px-[var(--space-2)] py-1 text-[11px] text-[var(--status-warning)]" data-lab-notice>
            {{ notices.slice(-3).join("；") }}
        </p>

        <!-- 辅助控制条：验收主入口是壳里的标题按钮与菜单，这里只放场景注入、位置/对齐与重置。 -->
        <LabFixtureControls>
            <div class="flex shrink-0 flex-wrap items-center gap-1.5 text-xs select-none">
                <span class="text-[var(--text-secondary)]">骨架控制 · {{ scene.label }}</span>
                <span class="flex flex-wrap items-center gap-1">
                    <button
                        v-for="control in POSITION_CONTROLS"
                        :key="`position-${control.value}`"
                        type="button"
                        class="inline-flex h-6 cursor-pointer items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)]"
                        :data-lab-control="`position-${control.value}`"
                        @click="executePanelItem(panelActionItemId(SHELL_PANEL_COMMAND_IDS.setPosition, control.value))"
                    >{{ control.label }}</button>

                    <button
                        v-for="control in ALIGNMENT_CONTROLS"
                        :key="`alignment-${control.value}`"
                        type="button"
                        class="inline-flex h-6 cursor-pointer items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)]"
                        :data-lab-control="`alignment-${control.value}`"
                        @click="executePanelItem(panelActionItemId(SHELL_PANEL_COMMAND_IDS.setAlignment, control.value))"
                    >对齐 {{ control.label }}</button>

                    <button
                        type="button"
                        class="inline-flex h-6 cursor-pointer items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)]"
                        data-lab-control="collapse-toggle"
                        @click="executeShellCommand(SHELL_PANEL_COMMAND_IDS.setCollapsed, {collapsed: !panel.collapsed})"
                    >{{ panel.collapsed ? "展开面板" : "收起为标题头" }}</button>

                    <button
                        type="button"
                        class="inline-flex h-6 cursor-pointer items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)]"
                        data-lab-control="hidden-toggle"
                        @click="executeShellCommand(SHELL_PANEL_COMMAND_IDS.setHidden, {hidden: !panel.hidden})"
                    >{{ panel.hidden ? "显示面板" : "隐藏面板" }}</button>

                    <button
                        type="button"
                        class="inline-flex h-6 cursor-pointer items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)]"
                        :disabled="!panelMaximizable(panel.position, panel.alignment)"
                        :title="panelMaximizable(panel.position, panel.alignment) ? '最大化 / 还原面板' : '居中对齐后可最大化：当前对齐不支持'"
                        data-lab-control="maximize-toggle"
                        @click="executeShellCommand(SHELL_PANEL_COMMAND_IDS.toggleMaximized, {})"
                    >{{ panel.maximized ? "还原面板尺寸" : "最大化面板" }}</button>

                    <button
                        type="button"
                        class="inline-flex h-6 cursor-pointer items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)]"
                        data-lab-control="reset"
                        @click="initializeScene"
                    >恢复演示初始状态</button>

                    <!-- 揭示走真实 `reveal-view` 命令：活动栏只示范容器切换，不把每个 View 伪装成一个入口。 -->
                    <button
                        v-for="control in revealControls"
                        :key="`reveal-${control.viewId}`"
                        type="button"
                        class="inline-flex h-6 cursor-pointer items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)]"
                        :data-lab-control="`reveal-${control.viewId}`"
                        @click="executeShellCommand(SHELL_CONTAINER_COMMAND_IDS.revealView, {viewId: control.viewId})"
                    >揭示 {{ control.label }}</button>
                </span>
            </div>
        </LabFixtureControls>
    </div>
</template>
