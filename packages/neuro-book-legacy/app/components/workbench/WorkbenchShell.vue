<script setup lang="ts">
/**
 * 产品工作台外壳：把**纯布局**（`WorkbenchShellLayout`）接到工作台 Storage 上。
 *
 * 几何一行都不在这里：测量、Grid 构建、渲染、gutter、手势结算与槽位生命周期都在纯布局组件里，
 * 产品与 Component Lab 的骨架 fixture 共用同一份实现。这一层只回答「哪些是保存的事实」：
 *
 * - **尺寸偏好**：左右宽度来自布局记录的叶字段与 user 面尺寸记录，面板高度/宽度来自面板尺寸记录；
 *   会话按字段拆分路由，一次手势的补丁只写它该写的那条记录；
 * - **面板状态**：位置/对齐/隐藏/收起来自页面传入的 user 级定制记录，瞬时最大化只在页面内存；
 * - **呈现事实**：`layout` 事件回传的 mode / 生效面板状态 / 诊断，供状态栏与命令可用性读取。
 *
 * 记录底本（recordGrid）与会话绑在一起：它保存的是**记录里的原始结构**（可能是旧 v2 拓扑），
 * 保存时按主动叶字段合成回原件；渲染树则由纯布局组件按投影另建，两者互不覆盖。
 */
import {computed, onBeforeUnmount, ref, watch} from "vue";
import WorkbenchShellLayout from "nbook/app/components/workbench/WorkbenchShellLayout.vue";
import {useNotification} from "nbook/app/composables/useNotification";
import {
    createShellGrid,
    projectShell,
    SHELL_HIDDEN_PART_IDS,
    SHELL_SIZE_DEFAULTS,
    type ShellDragCollapseMap,
    type ShellLayoutFacts,
    type ShellSizePatch,
    type ShellSizePreferences,
} from "nbook/app/utils/workbench/layout";
import {
    SHELL_PANEL_DEFAULTS,
    type WorkbenchPanelPreferences,
    type WorkbenchPanelState,
} from "nbook/app/utils/workbench/panel-state";
import {
    createWorkbenchLayoutSession,
    type WorkbenchLayoutNotice,
    type WorkbenchLayoutSurface,
} from "nbook/app/utils/workbench/layout-session";
import {shellRefResolver} from "nbook/app/utils/workbench/shell-layout";

defineOptions({name: "WorkbenchShell", inheritAttrs: false});

const props = withDefaults(defineProps<{
    /** 当前工作面（页面事实）：Project ready / 用户资产 / 未开项目；记录归属由它决定。 */
    surface: WorkbenchLayoutSurface;
    /** 保存的 Panel 状态：位置 / 对齐 / 隐藏 / 收起（user 级定制记录）。 */
    panel: WorkbenchPanelPreferences;
    /** 宿主内存里的瞬时最大化：不落盘，失效时由 `layout` 事实回传清除。 */
    maximized?: boolean;
    /** 用户拖到零的 Part（定制记录的偏好位）：保留节点与展开尺寸意图，内容 0px。 */
    dragCollapsedParts?: ShellDragCollapseMap;
}>(), {maximized: false, dragCollapsedParts: () => ({})});

const emit = defineEmits<{
    /** 生效状态与传入不一致时回传（例如换位置后最大化失效），宿主据此清自己的 ref。 */
    (event: "update:maximized", maximized: boolean): void;
    /**
     * 拖到零的偏好位变化：由页面（唯一定制会话的持有者）写进定制记录。
     * 外壳自己不建第二个定制会话，也不写存储。
     */
    (event: "drag-collapse", payload: {contextKey: string; parts: ShellDragCollapseMap}): void;
}>();

/** 允许经 `setLeafVisible` 隐藏的 Part：Panel 走自己的 `hidden`，editor 与状态栏永远在场。 */
const HIDDEN_PART_IDS: Record<string, true> = Object.fromEntries(SHELL_HIDDEN_PART_IDS.map((id) => [id, true]));

const {t} = useI18n();
const notification = useNotification();

const shellEl = ref<InstanceType<typeof WorkbenchShellLayout> | null>(null);
const hidden = ref<string[]>([]);
/** 壳自身的登记诊断（例如 setLeafVisible 收到未登记的叶）：与投影诊断分开累积，不被下一次投影清掉。 */
const leafIssues = ref<string[]>([]);
/** 最近一次呈现事实：状态栏与命令可用性读它，不猜。 */
const facts = ref<ShellLayoutFacts | null>(null);

/** 记录底本：旧 v2 记录会被整体恢复进这棵树，渲染树不参与记录合成。 */
const recordGrid = createShellGrid(projectShell({
    extent: {width: 0, height: 0},
    preferences: SHELL_SIZE_DEFAULTS,
    panel: {...SHELL_PANEL_DEFAULTS, maximized: false},
    hiddenParts: [],
}));

const session = createWorkbenchLayoutSession({
    grid: recordGrid,
    // 收起状态是记录引用解析的输入：收起时面板的约束是刚性 32px，越界意图只夹呈现。
    resolveRef: shellRefResolver(() => shellEl.value?.$el?.clientWidth ?? 0, () => props.panel.collapsed),
    notify: (notice: WorkbenchLayoutNotice): void => {
        notification.warning(notice.diagnosis);
    },
});

const sizes = computed<ShellSizePreferences>(() => ({
    leftPanelWidth: session.preferences.value.leftPanelWidth,
    agentPanelWidth: session.preferences.value.agentPanelWidth,
    panelHeight: session.panelSize.value.height,
    panelWidth: session.panelSize.value.width,
}));

const panelState = computed<WorkbenchPanelState>(() => ({...props.panel, maximized: props.maximized}));

const layoutNotice = computed<WorkbenchLayoutNotice | null>(() => session.state.value.notice);
const layoutNoticeText = computed<string>(() => {
    const notice = layoutNotice.value;
    if (notice === null) {
        return "";
    }
    const key = notice.kind === "unsaved"
        ? "ide.workbench.layout.unsaved"
        : notice.kind === "switch-blocked"
            ? "ide.workbench.layout.switchBlocked"
            : "ide.workbench.layout.migrationBlocked";
    return t(key, {diagnosis: notice.diagnosis});
});
const layoutNoticeRetryable = computed(() => layoutNotice.value?.retryable ?? false);
const layoutNoticeAbandonable = computed(() => {
    const kind = layoutNotice.value?.kind;
    return kind === "unsaved" || kind === "switch-blocked";
});
const layoutDiagnostics = computed(() => [...(facts.value?.issues ?? []), ...leafIssues.value].slice(-3).join(" | "));

function retryLayoutNotice(): void {
    if (layoutNotice.value?.kind === "migration-blocked") {
        void session.retryMigration();
        return;
    }
    void session.retry();
}

function abandonLayoutNotice(): void {
    session.abandon();
}

/**
 * 一次有效手势的落点补丁：px 字段交给布局记录会话，`dragCollapsed` 位经定制会话写入。
 *
 * 两条记录各自收口、各自回报状态（明确的多记录非原子持久化取舍）：尺寸记录失败不影响
 * 已经写成功的拖收起位，反之亦然。
 */
function onResize(payload: {contextKey: string; patch: ShellSizePatch}): void {
    const {dragCollapsed, ...sizes} = payload.patch;
    if (Object.keys(sizes).length > 0) {
        void session.commitSizes({contextKey: payload.contextKey, patch: sizes});
    }
    if (dragCollapsed !== undefined) {
        emit("drag-collapse", {contextKey: payload.contextKey, parts: dragCollapsed});
    }
}

/** 呈现事实：宿主据此清失效的瞬时最大化，并把 mode / 生效状态交给状态栏与命令。 */
let maximizedCleared = false;
function onLayout(next: ShellLayoutFacts): void {
    facts.value = next;
    if (props.maximized && !next.effectivePanel.maximized) {
        // 宿主清 ref 之前会反复收到同一份事实；只回传一次，避免同一条失效被重复上报。
        if (!maximizedCleared) {
            maximizedCleared = true;
            emit("update:maximized", false);
        }
        return;
    }
    maximizedCleared = false;
}

/**
 * 叶的显隐：只接受 titlebar / activity / left / right。
 * editor 与状态栏不可隐藏（它们一旦消失，编辑实例与刚性边界就没有了落点）。
 */
function setLeafVisible(id: string, visible: boolean): void {
    if (!HIDDEN_PART_IDS[id]) {
        leafIssues.value = [...leafIssues.value, `未登记的叶：${id}`];
        return;
    }
    const next = visible
        ? hidden.value.filter((item) => item !== id)
        : (hidden.value.includes(id) ? hidden.value : [...hidden.value, id]);
    if (next === hidden.value) {
        return;
    }
    hidden.value = next;
}

onBeforeUnmount(() => {
    void session.release();
});

/** 进入 / 切换工作面：恢复记录、释放旧上下文都由会话收口（失败时提示条给出重试与放弃）。 */
watch(() => props.surface, (surface) => {
    void session.enterSurface(surface);
}, {immediate: true});

defineExpose({setLeafVisible, hidden, facts, panelSize: computed(() => session.panelSize.value)});
</script>

<template>
    <WorkbenchShellLayout
        ref="shellEl"
        v-bind="$attrs"
        :sizes="sizes"
        :panel="panelState"
        :context-key="session.contextKey.value"
        :hidden-parts="hidden"
        :drag-collapsed-parts="props.dragCollapsedParts"
        :data-session-diagnostics="layoutDiagnostics"
        @resize="onResize"
        @layout="onLayout"
    >
        <template #titlebar><slot name="titlebar"></slot></template>
        <template #activity><slot name="activity"></slot></template>
        <template #left><slot name="left"></slot></template>
        <template #editor><slot name="editor"></slot></template>
        <template #right><slot name="right"></slot></template>
        <template #panel="panelSlot">
            <slot name="panel" :collapsed="panelSlot.collapsed" :effective-panel="panelSlot.effectivePanel" :mode="panelSlot.mode"></slot>
        </template>
        <template #statusbar><slot name="statusbar"></slot></template>
    </WorkbenchShellLayout>

    <!-- 布局提示：未确认保存的调整、被旧工作面挡住的切换、未完成的迁移。
         固定在视口一角（外壳自己是 overflow-hidden），不参与树的几何。 -->
    <div v-if="layoutNotice" class="workbench-layout-notice" role="status" aria-live="polite" data-layout-notice>
        <span class="workbench-layout-notice__text">{{ layoutNoticeText }}</span>
        <button v-if="layoutNoticeRetryable" type="button" class="workbench-layout-notice__action" @click="retryLayoutNotice">{{ t("ide.workbench.layout.retry") }}</button>
        <button v-if="layoutNoticeAbandonable" type="button" class="workbench-layout-notice__action" @click="abandonLayoutNotice">{{ t("ide.workbench.layout.abandon") }}</button>
    </div>
</template>

<style scoped>
/*
 * 布局提示条：浮在视口一角，不参与树几何（外壳本身 overflow-hidden，固定定位不会被裁剪）。
 * 颜色只走主题变量，主题换掉后它不会成为唯一没跟上的一块。
 */
.workbench-layout-notice {
    position: fixed;
    inset-block-end: 12px;
    inset-inline-start: 12px;
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: min(560px, calc(100vw - 24px));
    padding: 8px 12px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-panel);
    color: var(--text-main);
    box-shadow: 0 8px 24px rgb(0 0 0 / 24%);
    font-size: 12px;
    line-height: 1.4;
}

.workbench-layout-notice__text {
    min-width: 0;
}

.workbench-layout-notice__action {
    flex: 0 0 auto;
    padding: 2px 8px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: transparent;
    color: var(--text-main);
    font: inherit;
    cursor: pointer;
}

.workbench-layout-notice__action:hover {
    border-color: var(--status-info);
    color: var(--status-info);
}
</style>
