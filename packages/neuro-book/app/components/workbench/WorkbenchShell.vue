<script setup lang="ts">
/**
 * 工作台外壳骨架（#192 阶段 1 步骤 2）：布局树（nb-ui 原语）与四个 Part 叶的宿主。
 *
 * 尺寸真相分两层：
 * - 拖拽期间在 Splitter（reka）手里，结束时提交完整分支的呈现目标；
 * - 手势结束保留原语反解后的呈现，只将主动侧栏的绝对宽度写入 store。
 * - 容器、显隐或外部偏好变化时按产品模型重建：固定栏读取偏好，编辑器吸收余量。
 * 保存自己的手势不能立即触发重建，否则受限 viewport 中的被动兄弟会回弹。
 *
 * 结构真相只有一处：隐藏集合变 → 分支 children 变 → 重挂 splitter 重读默认尺寸。
 * 尺寸落账**不**递增 epoch —— 拖拽中重挂会打断 reka 已开始的拖拽会话。
 */
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue";
import {storeToRefs} from "pinia";
import type {Grid, GridAxis, GridBranch, GridLayoutResult} from "@notnotype/nb-ui/components";
import WorkbenchBranch from "nbook/app/components/workbench/WorkbenchBranch.vue";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {
    createDefaultShellGrid,
    createShellGrid,
    distributeShellHeights,
    recalcShellSizes,
    resizeShellBranch,
    SASH_PX,
    SHELL_ACTIVITY_GUTTER_PX,
    SHELL_CONTAINER_GUTTER_PX,
    SHELL_LEAF_IDS,
    SHELL_MAIN_ID,
    SHELL_TITLEBAR_ID,
    type ShellLeafId,
    type ShellSizes,
    type ShellSizeStore,
} from "nbook/app/utils/workbench/layout";

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

/** 几何模型的键：四个宽度叶 + 垂直方向的 titlebar / main（像素高度）。 */
const LAYOUT_SIZE_IDS = [...SHELL_LEAF_IDS, SHELL_TITLEBAR_ID, SHELL_MAIN_ID] as const;

type ShellLayoutSizes = ShellSizes & {titlebar: number; main: number};

const store = useNovelIdeStore();
const {leftPanelWidth, agentPanelWidth} = storeToRefs(store);
/** `index.vue` 的同一来源（@vueuse/nuxt 自动导入）。 */
const viewportWidth = useWindowSize().width;

const shellEl = ref<HTMLElement | null>(null);
const hidden = ref<string[]>([]);
const issues = ref<string[]>([]);
const epoch = ref(0);
const layout = ref<GridLayoutResult>(createDefaultShellGrid(0, 0).layout({width: 0, height: 0}));

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

function sizeStore(): ShellSizeStore {
    return {leftPanelWidth: leftPanelWidth.value, agentPanelWidth: agentPanelWidth.value, hidden: hidden.value};
}

function maxAbsDiff(left: ShellLayoutSizes, right: ShellLayoutSizes): number {
    let worst = 0;
    for (const id of LAYOUT_SIZE_IDS) {
        worst = Math.max(worst, Math.abs(left[id] - right[id]));
    }
    return worst;
}

/** 宽度分配（store 值 + avail）与高度分配（titlebar / main）合成一份几何模型。 */
function composeLayout(): ShellLayoutSizes {
    const result = recalcShellSizes(createDefaultShellGrid(layoutViewportWidth(), layoutViewportHeight()), sizeStore(), availableWidth());
    issues.value = result.issues;
    return {...result.sizes, ...shellHeights()};
}

/** 树与尺寸模型收敛后，立即按当前容器发布原语呈现。 */
function syncTree(): void {
    grid.value = createShellGrid(layoutViewportWidth(), sizes.value, hidden.value);
    layout.value = grid.value.layout({width: shellEl.value?.clientWidth ?? layoutViewportWidth(), height: layoutViewportHeight()});
}

/** 首屏：默认拓扑先供出叶约束，再按 store 里持久化的宽度与当前外壳尺寸分配一次，避免默认值闪一帧。 */
const grid = ref<Grid<string>>(createDefaultShellGrid(layoutViewportWidth(), layoutViewportHeight()));
const initialLayout = composeLayout();
const sizes = ref<ShellLayoutSizes>({...initialLayout});
syncTree();

/**
 * 按 `store 值 + avail` 与外壳高重算四个宽度叶与 titlebar / main 并落账。
 * `remount=false`（显隐）只更新模型与树，不重挂；`remount=true`（容器尺寸 / 外部尺寸）差异 ≥1px 才
 * 递增 epoch —— <1px 直接返回，避免「自己回写 store → 自己重挂」的自激。
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
 * 一次完整分支提交可同时包含 editor/right，不能靠第一个 active id 决定保存哪条侧栏。
 * 壳层的产品偏好是侧栏绝对宽度；原语验证手势后，只保存用户实际改变的侧栏目标。
 */
let committedStore: {left: number; right: number} | null = null;

function onResizeBranch(branchId: string, axis: GridAxis, baseline: Readonly<Record<string, number>>, target: Readonly<Record<string, number>>, active: readonly string[]): void {
    const result = resizeShellBranch(grid.value, branchId, axis, baseline, target, sizeStore(), active);
    if (!result.ok) {
        issues.value = [...issues.value, result.reason];
        return;
    }
    committedStore = {left: result.store.leftPanelWidth, right: result.store.agentPanelWidth};
    leftPanelWidth.value = result.store.leftPanelWidth;
    agentPanelWidth.value = result.store.agentPanelWidth;
    // 保留原语已反解的当前呈现。立即按固定栏偏好重建会让受限 viewport 中未动的兄弟回弹。
    for (const id of SHELL_LEAF_IDS) {
        if (target[id] !== undefined) sizes.value[id] = target[id];
    }
    layout.value = grid.value.layout({width: shellEl.value?.clientWidth ?? layoutViewportWidth(), height: layoutViewportHeight()});
    issues.value = layout.value.issues;
}

/**
 * 叶的显隐：只改 children 集合（splitter key 变 → 重挂重读尺寸），不动原语拓扑、不递增 epoch。
 * 登记的隐藏项：四个宽度叶 + titlebar（B/S 无 bridge 时由宿主关掉标题栏叶）。
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
    const root = grid.value.root();
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
});

/** 自己提交的侧栏偏好已有对应的原语呈现；只有外部改写才重新分配。 */
watch([leftPanelWidth, agentPanelWidth], ([left, right]) => {
    const ownCommit = committedStore;
    committedStore = null;
    if (ownCommit?.left === left && ownCommit.right === right) return;
    recalcSizes(true);
});

/** 视口宽变了：right 的上限要重来（约束在建树时定稿），先重建树再重算尺寸。 */
watch(viewportWidth, () => {
    syncTree();
    recalcSizes(true);
});

defineExpose({setLeafVisible, hidden, issues});
</script>

<template>
    <div ref="shellEl" class="workbench-shell flex h-full w-full min-h-0 min-w-0 overflow-hidden" :style="{'--workbench-activity-gutter': activityGutter, '--workbench-container-gutter': containerGutter}" data-workbench-shell :data-shell-layout="narrow ? 'stacked' : 'split'">
        <WorkbenchBranch
            v-if="!narrow && rootBranch"
            :node="rootBranch"
            :layout="layout"
            :on-resize-branch="onResizeBranch"
            :hidden="hidden"
            :epoch="epoch"
        >
            <template #leaf="{leafId}">
                <slot :name="leafId"></slot>
            </template>
        </WorkbenchBranch>

        <!-- 窄屏：不渲染 Splitter，按拓扑顺序单列堆叠（顺序与显隐跟树一致）。
             叶包装的 display 与分支版一致（flex column），叶内容才拿得到确定高度。 -->
        <div v-else-if="narrow" class="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden">
            <div
                v-for="id in stackedLeafIds"
                :key="id"
                class="flex min-h-0 flex-col overflow-hidden"
                :class="id === 'activity' ? 'h-12 shrink-0' : id === 'titlebar' ? 'h-9 shrink-0' : 'flex-1'"
                :data-leaf="id"
            >
                <slot :name="id"></slot>
            </div>
        </div>
    </div>
</template>

<style scoped>

/*
 * 悬停分界线时那条线会闪（DevTools 的 style recalcs/sec 冲到 ~70）：nb-ui 的 handle 用
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
</style>
