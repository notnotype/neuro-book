<script setup lang="ts">
/**
 * 工作台外壳骨架（#192 阶段 1 步骤 2）：布局树（nb-ui 原语）与四个 Part 叶的宿主。
 *
 * 尺寸真相分三层（本增量切到 Storage 会话，见 `app/utils/workbench/layout-session.ts`）：
 * - **已确认值**：工作台 Storage 记录——Project 是 `workbench.layout/layout` 的 grid 布局记录，
 *   未开项目与用户资产是同 owner 的 user/local 尺寸记录；
 * - **当前显示**：树上意图——恢复、手势结算与放弃都发布到同一棵树（`readShellPreferences` 读它）；
 * - **本地意图**：未确认保存的调整留在会话里，提示条给出重试/放弃，不静默吞掉。
 *
 * 一次用户手势只在 `gesture-end` 提交一次主动字段；程序布局、挂载、测量、视口夹取与临时显隐都不产生保存。
 * 容器尺寸变化按产品模型重建树（固定栏读偏好、编辑器吸收余量）：那是呈现，不是保存。
 *
 * 结构真相只有一处：隐藏集合变 → 分支 children 变 → 重挂 splitter 重读默认尺寸。
 * 尺寸落账**不**递增 epoch —— 拖拽中重挂会打断 reka 已开始的拖拽会话。
 */
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue";
import type {Grid, GridBranch, GridLayoutResult, SplitterGestureState} from "@notnotype/nb-ui/components";
import WorkbenchBranch from "nbook/app/components/workbench/WorkbenchBranch.vue";
import {useNotification} from "nbook/app/composables/useNotification";
import {
    createDefaultShellGrid,
    distributeShellHeights,
    recalcShellSizes,
    SASH_PX,
    SHELL_ACTIVITY_GUTTER_PX,
    SHELL_CONTAINER_GUTTER_PX,
    SHELL_LEAF_IDS,
    SHELL_MAIN_ID,
    SHELL_TITLEBAR_HEIGHT,
    SHELL_TITLEBAR_ID,
    type ShellLeafId,
    type ShellSizes,
    type ShellSizeStore,
} from "nbook/app/utils/workbench/layout";
import {
    createWorkbenchLayoutSession,
    type WorkbenchLayoutNotice,
    type WorkbenchLayoutSurface,
} from "nbook/app/utils/workbench/layout-session";
import {shellGridSnapshot, shellRefResolver} from "nbook/app/utils/workbench/shell-layout";

const props = defineProps<{
    /** 当前工作面（页面事实）：Project ready / 用户资产 / 未开项目；记录归属由它决定。 */
    surface: WorkbenchLayoutSurface;
}>();

/** 窄屏判据：与 `index.vue` 的 `agentPanelOverlay` 同源（< 800），不新造断点。 */
const NARROW_VIEWPORT_PX = 800;

/**
 * 活动栏卡片四周留白（唯一来源是 `layout.ts` 的叶宽公式）：以 CSS 变量喂给叶的内边距，
 * 卡片样式与叶宽就不会各自记一个数字。
 */
const activityGutter = `${SHELL_ACTIVITY_GUTTER_PX}px`;

/**
 * 左右容器卡片四周的留白：机制与活动栏同一套（外壳喂给叶的内边距，卡片是叶的内接盒），
 * 取值同源（`SHELL_CONTAINER_GUTTER_PX = SHELL_ACTIVITY_GUTTER_PX`）——容器组件里不写宽度也不写
 * margin，内容区比叶窄 2 × 6px 这件事只在 `layout.ts` 记账。
 */
const containerGutter = `${SHELL_CONTAINER_GUTTER_PX}px`;

/**
 * 标题栏叶的高度：唯一来源是产品几何常量 `SHELL_TITLEBAR_HEIGHT`（与 `distributeShellHeights`
 * 的垂直分配同一个数）。做成 CSS 变量有两个消费者——标题栏组件自己的高度，以及**窄屏堆叠时**
 * 那层叶包装：堆叠态不跑 Splitter，包装默认按 `flex-1` 等分，标题栏会被拉成整屏的 1/5。
 */
const titlebarExtent = `${SHELL_TITLEBAR_HEIGHT}px`;

/** 几何模型的键：四个宽度叶 + 垂直方向的 titlebar / main（像素高度）。 */
const LAYOUT_SIZE_IDS = [...SHELL_LEAF_IDS, SHELL_TITLEBAR_ID, SHELL_MAIN_ID] as const;

type ShellLayoutSizes = ShellSizes & {titlebar: number; main: number};

const {t} = useI18n();
const notification = useNotification();
/** `index.vue` 的同一来源（@vueuse/nuxt 自动导入）。 */
const viewportWidth = useWindowSize().width;

const shellEl = ref<HTMLElement | null>(null);
const hidden = ref<string[]>([]);
const issues = ref<string[]>([]);
const epoch = ref(0);

const visibleLeafIds = computed<string[]>(() => SHELL_LEAF_IDS.filter((id) => !hidden.value.includes(id)));
const narrow = computed(() => viewportWidth.value > 0 && viewportWidth.value < NARROW_VIEWPORT_PX);

/** 树里 right 叶的上限随视口宽变化，而约束在建树时定稿（步骤 1 的取舍）：重建树时用它取同一份数字。 */
function layoutViewportWidth(): number {
    const measured = viewportWidth.value;
    return measured > 0 ? measured : Math.max(1, shellEl.value?.clientWidth ?? 1);
}

/** 外壳高的实测值（挂载前退回视口高）：只用于默认拓扑的垂直比例，与宽度手势无关。 */
function layoutViewportHeight(): number {
    return shellEl.value?.clientHeight ?? (typeof window === "undefined" ? 0 : window.innerHeight);
}

/** 渲染器测量结果：会话的手势基线与呈现都读同一份。 */
function measuredExtent(): {width: number; height: number} {
    return {width: shellEl.value?.clientWidth ?? layoutViewportWidth(), height: layoutViewportHeight()};
}

/** 只扣真实流内 sash：根 sash 与 activity 后的 sash 被隐藏，其余可见宽度叶之间各 1px。 */
function availableWidth(): number {
    const width = shellEl.value?.clientWidth ?? (typeof window === "undefined" ? 0 : window.innerWidth);
    const visible = visibleLeafIds.value.length;
    const activityAdjustment = visibleLeafIds.value[0] === "activity" ? 1 : 0;
    return Math.max(0, width - SASH_PX * Math.max(0, visible - 1 - activityAdjustment));
}

/** 垂直方向：titlebar 刚性 36（不可见时不占高度），main 吸收余量；挂载前退回视口高。 */
function shellHeights(): {titlebar: number; main: number} {
    const height = layoutViewportHeight();
    return distributeShellHeights(height, !hidden.value.includes(SHELL_TITLEBAR_ID));
}

/** 外壳的布局树：唯一实例，宿主与会话都借用它；重建走 `restore`（换树不换实例）。 */
const grid: Grid<string> = createDefaultShellGrid(layoutViewportWidth(), layoutViewportHeight());

const session = createWorkbenchLayoutSession({
    grid,
    resolveRef: shellRefResolver(layoutViewportWidth),
    hidden: () => hidden.value,
    notify: (notice: WorkbenchLayoutNotice): void => {
        notification.warning(notice.diagnosis);
    },
});

const layout = ref<GridLayoutResult>(grid.layout({width: 0, height: 0}));

/** 会话提示：未保存意图 / 切换被挡 / 迁移阻断，带重试与放弃入口。 */
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
/** 会话诊断（含手势未落盘的原因）——外壳把它挂在根节点的 data 属性上，便于人工核对与取证。 */
const layoutDiagnostics = computed(() => session.state.value.issues.slice(-3).join(" | "));
const layoutNoticeAbandonable = computed(() => {
    const kind = layoutNotice.value?.kind;
    return kind === "unsaved" || kind === "switch-blocked";
});

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

/** 尺寸偏好（树上意图）加当前收起集合：产品模型的输入只有这一处。 */
function sizeStore(): ShellSizeStore {
    const preferences = session.preferences.value;
    return {leftPanelWidth: preferences.leftPanelWidth, agentPanelWidth: preferences.agentPanelWidth, hidden: hidden.value};
}

function maxAbsDiff(left: ShellLayoutSizes, right: ShellLayoutSizes): number {
    let worst = 0;
    for (const id of LAYOUT_SIZE_IDS) {
        worst = Math.max(worst, Math.abs(left[id] - right[id]));
    }
    return worst;
}

/** 宽度分配（偏好 + avail）与高度分配（titlebar / main）合成一份几何模型。 */
function composeLayout(): ShellLayoutSizes {
    const result = recalcShellSizes(createDefaultShellGrid(layoutViewportWidth(), layoutViewportHeight()), sizeStore(), availableWidth());
    issues.value = result.issues;
    return {...result.sizes, ...shellHeights()};
}

/**
 * 树与尺寸模型收敛后，立即按当前容器发布原语呈现。
 *
 * 重建不产生保存：树上意图是呈现模型，记录仍由会话按手势提交。
 */
function syncTree(): void {
    const viewportWidthNow = layoutViewportWidth();
    const restored = grid.restore(
        shellGridSnapshot(viewportWidthNow, sizes.value, hidden.value),
        shellRefResolver(() => viewportWidthNow),
    );
    if (!restored.ok) {
        issues.value = [...issues.value, `外壳拓扑重建失败：${restored.reason ?? "未知结构"}`];
    }
    const extent = measuredExtent();
    // 测量结果是手势基线的一部分：先告知会话，再发布呈现。
    session.setContainer(extent);
    layout.value = grid.layout(extent);
}

/** 首屏：默认拓扑先供出叶约束，再按当前偏好与外壳尺寸分配一次，避免默认值闪一帧。 */
const sizes = ref<ShellLayoutSizes>({...composeLayout()});
syncTree();

/**
 * 按 `偏好 + avail` 与外壳高重算四个宽度叶与 titlebar / main 并落账。
 * `remount=false`（显隐）只更新模型与树，不重挂；`remount=true`（容器尺寸 / 外部发布）差异 ≥1px 才
 * 递增 epoch —— <1px 直接返回，避免「自己回写偏好 → 自己重挂」的自激。
 */
function recalcSizes(remount: boolean): void {
    const next = composeLayout();
    if (remount && maxAbsDiff(next, sizes.value) < 1) {
        return;
    }
    sizes.value = {...next};
    syncTree();
    if (remount) {
        epoch.value += 1;
    }
}

/**
 * 一次完整分支手势由会话结算：只提交主动字段，程序布局不产生保存。
 *
 * 手势结束保留原语反解后的呈现（不按偏好立即重建），否则受限 viewport 中未动的兄弟会回弹。
 */
function onGestureStart(branchId: string, state: SplitterGestureState): void {
    if (branchId !== SHELL_MAIN_ID) {
        return;
    }
    const status = session.gestureStart({branchId, sizes: state.sizes});
    if (status !== "started") {
        issues.value = [...issues.value, "手势未被接纳：布局记录尚未就绪或尺寸不合法"];
    }
}

function onGestureEnd(branchId: string, state: SplitterGestureState): void {
    if (branchId !== SHELL_MAIN_ID) {
        return;
    }
    void session.gestureEnd({branchId, active: state.active, sizes: state.sizes}).then(() => {
        const extent = measuredExtent();
        layout.value = grid.layout(extent);
        issues.value = layout.value.issues;
    });
}

function onGestureCancel(branchId: string): void {
    if (branchId !== SHELL_MAIN_ID) {
        return;
    }
    session.gestureCancel();
}

/**
 * 叶的显隐：只改 children 集合（splitter key 变 → 重挂重读尺寸），不动原语拓扑、不递增 epoch。
 * 登记的隐藏项：四个宽度叶 + titlebar（页面在书架态收起左右栏；标题栏两种宿主都显示）。
 * 显隐是临时的，不保存。
 */
function setLeafVisible(id: string, visible: boolean): void {
    if (![...SHELL_LEAF_IDS, SHELL_TITLEBAR_ID].includes(id as ShellLeafId)) {
        issues.value = [...issues.value, `未登记的叶：${id}`];
        return;
    }
    const next = visible
        ? hidden.value.filter((item) => item !== id)
        : (hidden.value.includes(id) ? hidden.value : [...hidden.value, id]);
    if (next === hidden.value) {
        return;
    }
    hidden.value = next;
    recalcSizes(false);
}

/** 窄屏堆叠顺序：titlebar（36 条）→ 四个宽度叶，与树的顺序一致。 */
const stackedLeafIds = computed<string[]>(() => [
    ...(hidden.value.includes(SHELL_TITLEBAR_ID) ? [] : [SHELL_TITLEBAR_ID]),
    ...visibleLeafIds.value,
]);

/** 分支根：尺寸模型重建后节点对象会换，但 id / 约束不变，所以不会触发重挂。 */
const rootBranch = computed<GridBranch<unknown> | null>(() => {
    layout.value;
    const root = grid.root();
    return root && root.kind === "branch" ? root : null;
});

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
    recalcSizes(true);
    if (!shellEl.value) {
        return;
    }
    resizeObserver = new ResizeObserver(() => recalcSizes(true));
    resizeObserver.observe(shellEl.value);
});

onBeforeUnmount(() => {
    resizeObserver?.disconnect();
    resizeObserver = null;
    void session.release();
});

/** 进入 / 切换工作面：恢复记录、释放旧上下文都由会话收口（失败时提示条给出重试与放弃）。 */
watch(() => props.surface, (surface) => {
    void session.enterSurface(surface);
}, {immediate: true});

/** 会话重新发布呈现（进入工作面恢复、放弃未确认调整）：按产品模型重建一次。 */
watch(() => session.publication.value, () => {
    recalcSizes(true);
});

/** 视口宽变了：right 的上限要重来（约束在建树时定稿），整棵模型重建。 */
watch(viewportWidth, () => {
    recalcSizes(true);
});

defineExpose({setLeafVisible, hidden, issues, layoutNotice});
</script>

<template>
    <div ref="shellEl" class="workbench-shell flex h-full w-full min-h-0 min-w-0 overflow-hidden" :style="{'--workbench-activity-gutter': activityGutter, '--workbench-container-gutter': containerGutter, '--workbench-titlebar-height': titlebarExtent}" data-workbench-shell :data-shell-layout="narrow ? 'stacked' : 'split'" :data-layout-diagnostics="layoutDiagnostics">
        <WorkbenchBranch
            v-if="!narrow && rootBranch"
            :node="rootBranch"
            :layout="layout"
            :on-gesture-start="onGestureStart"
            :on-gesture-end="onGestureEnd"
            :on-gesture-cancel="onGestureCancel"
            :hidden="hidden"
            :epoch="epoch"
        >
            <template #leaf="{leafId}">
                <!-- 叶 id 就是页面给的插槽名（#activity / #left / #editor / #right / #titlebar）：
                     外壳不重命名插槽，页面按叶挂业务内容。 -->
                <slot :name="leafId"></slot>
            </template>
        </WorkbenchBranch>

        <!-- 窄屏：不渲染 Splitter，按拓扑顺序单列堆叠（顺序与显隐跟树一致）。
             叶包装的 display 与分支版一致（flex column），叶内容才拿得到确定高度。 -->
        <div v-else-if="narrow" class="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden">
            <div
                v-for="leafId in stackedLeafIds"
                :key="leafId"
                class="flex min-h-0 min-w-0 flex-col overflow-hidden"
                :class="leafId === SHELL_TITLEBAR_ID ? 'flex-none' : 'flex-1'"
                :style="leafId === SHELL_TITLEBAR_ID ? {flex: '0 0 var(--workbench-titlebar-height)'} : undefined"
                :data-leaf="leafId"
            >
                <slot :name="leafId"></slot>
            </div>
        </div>

        <!-- 布局提示：未确认保存的调整、被旧工作面挡住的切换、未完成的迁移。
             固定在视口一角（外壳自己是 overflow-hidden），不参与树的几何。 -->
        <div v-if="layoutNotice" class="workbench-layout-notice" role="status" aria-live="polite" data-layout-notice>
            <span class="workbench-layout-notice__text">{{ layoutNoticeText }}</span>
            <button v-if="layoutNoticeRetryable" type="button" class="workbench-layout-notice__action" @click="retryLayoutNotice">{{ t("ide.workbench.layout.retry") }}</button>
            <button v-if="layoutNoticeAbandonable" type="button" class="workbench-layout-notice__action" @click="abandonLayoutNotice">{{ t("ide.workbench.layout.abandon") }}</button>
        </div>
    </div>
</template>

<style scoped>

/*
 * 悬停分界线时那条线会闪（DevTools 的 style recalc/sec 冲到 ~70）：nb-ui 的 handle 用
 * `::after` 把命中区扩到 10px，但 panel 是 `position: relative` 又排在 handle 后面，
 * ::after 的**右半边被后一个叶按绘制顺序盖住**。于是指针在分界线两侧来回擦过时 :hover
 * 反复开合，每开一次都要重跑一遍 nb-ui 的 transition-colors / opacity——过渡帧本身每帧
 * 都要 recalc，观感就是这条线在闪，而布局一动没动。
 *
 * 把 handle 抬到相邻叶之上（z-index: 1），nb-ui 本来就设计好的命中区才真的生效：
 * 指针在分界线 ±5px 内保持 :hover，过渡不再重启，光标与高亮都稳定。
 * 实测（CDP Performance.getMetrics，1440×900，四叶态，指针在分界线 ±1px 抖动）：
 * recalc 73.5 次/秒 → 0 次/秒（layout 前后都是 0），handle 的 mouseenter/mouseleave 各 29 次 → 各 0 次。
 */
:deep([data-branch] > div > [role="separator"]) {
    z-index: 1;
}

/*
 * 活动栏卡片的四周留白归外壳：留白加在叶上，卡片（`NovelIdeActivityBar` 的根元素）就是叶的内接盒。
 * 这样叶宽与卡片样式不会各自记一个数字——叶宽 = 卡片 + 两侧留白由 `layout.ts` 一处给出
 * （`SHELL_ACTIVITY_WIDTH = SHELL_ACTIVITY_CARD_WIDTH + SHELL_ACTIVITY_GUTTER_PX × 2`），
 * 组件里不再出现 `w-12` 这类与树重复的宽度。卡片右侧那 6px 是纯留白：那一条边界上的 sash
 * 已经去掉（见上），不会出现可拖/可高亮的线。
 */
:deep([data-leaf="activity"]) {
    padding: var(--workbench-activity-gutter);
}

/*
 * 左右叶的留白同活动栏卡片：容器卡片是叶的内接盒（面 / 描边 / 圆角都由组件画），
 * 留白加在叶上，叶宽仍是树上的逻辑尺寸（340 / 400）。容器组件因此不写宽度也不写 margin。
 * 窄屏堆叠态用的是同一批 `data-leaf` 包装，规则照旧命中，两个容器之间也留出这条缝。
 */
:deep([data-leaf="left"]),
:deep([data-leaf="right"]) {
    padding: var(--workbench-container-gutter);
}

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
