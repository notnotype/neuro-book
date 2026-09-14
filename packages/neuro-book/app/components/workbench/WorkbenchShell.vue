<script setup lang="ts">
/**
 * 工作台外壳骨架（#192 阶段 1 步骤 2）：布局树（nb-ui 原语）与四个 Part 叶的宿主。
 *
 * 尺寸真相分两层：
 * - 拖拽期间在 Splitter（reka）手里，本组件只收 `@layout` 的像素增量；
 * - 落账后归**尺寸模型**（`sizes`）与 store：固定叶取夹取后的绝对值，编辑器是唯一吸收余量的叶。
 * 原语实例与模型在每次落账后收敛为同一份布局（原语没有「改尺寸」API，重建是唯一精确写法），
 * 否则下一次拖拽会从漂移值起算。
 *
 * 结构真相只有一处：隐藏集合变 → 分支 children 变 → 重挂 splitter 重读默认尺寸。
 * 尺寸落账**不**递增 epoch —— 拖拽中重挂会打断 reka 已开始的拖拽会话。
 */
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue";
import {storeToRefs} from "pinia";
import type {Grid, GridBranch} from "@notnotype/nb-ui/components";
import WorkbenchBranch from "nbook/app/components/workbench/WorkbenchBranch.vue";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {
    createDefaultShellGrid,
    createShellGrid,
    distributeShellHeights,
    recalcShellSizes,
    SASH_PX,
    SHELL_LEAF_IDS,
    SHELL_MAIN_ID,
    SHELL_TITLEBAR_ID,
    type ShellLeafId,
    type ShellSizes,
    type ShellSizeStore,
} from "nbook/app/utils/workbench/layout";

/** 窄屏判据：与 `index.vue` 的 `agentPanelOverlay` 同源（< 800），不新造断点。 */
const NARROW_VIEWPORT_PX = 800;

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

const visibleLeafIds = computed<string[]>(() => SHELL_LEAF_IDS.filter((id) => !hidden.value.includes(id)));
const narrow = computed(() => viewportWidth.value > 0 && viewportWidth.value < NARROW_VIEWPORT_PX);

/** 树里 right 叶的上限随视口宽变化，而约束在建树时定稿（步骤 1 的取舍）：重建树时用它取同一份数字。 */
function layoutViewportWidth(): number {
    const measured = viewportWidth.value;
    return measured > 0 ? measured : Math.max(1, shellEl.value?.clientWidth ?? 1);
}

/** `avail = 外壳宽 − SASH_PX ×（可见叶数 − 1）`；挂载前退回视口宽。 */
function availableWidth(): number {
    const width = shellEl.value?.clientWidth ?? (typeof window === "undefined" ? 0 : window.innerWidth);
    return Math.max(0, width - SASH_PX * Math.max(0, visibleLeafIds.value.length - 1));
}

/** 垂直方向：titlebar 刚性 36（不可见时不占高度），main 吸收余量；挂载前退回视口高。 */
function shellHeights(): {titlebar: number; main: number} {
    const height = shellEl.value?.clientHeight ?? (typeof window === "undefined" ? 0 : window.innerHeight);
    return distributeShellHeights(height, !hidden.value.includes(SHELL_TITLEBAR_ID));
}

function sizeStore(): ShellSizeStore {
    return {leftPanelWidth: leftPanelWidth.value, agentPanelWidth: agentPanelWidth.value, hidden: hidden.value};
}

/** 原语当前结算出的叶尺寸（本次 `resize` 后已经过夹取与兄弟吸收）。 */
function treeSizes(): ShellSizes {
    const layout = grid.value.layout().sizes;
    const settled = {} as ShellSizes;
    for (const id of SHELL_LEAF_IDS) {
        settled[id] = layout[id] ?? 0;
    }
    return settled;
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
    const result = recalcShellSizes(grid.value, sizeStore(), availableWidth());
    issues.value = result.issues;
    return {...result.sizes, ...shellHeights()};
}

/** 树 ≡ 尺寸模型：落账后按模型重建树，下一次拖拽从同一份数字起算。 */
function syncTree(): void {
    grid.value = createShellGrid(layoutViewportWidth(), sizes.value);
}

/** 首屏：默认拓扑先供出叶约束，再按 store 里持久化的宽度与当前外壳尺寸分配一次，避免默认值闪一帧。 */
const grid = ref<Grid<string>>(createDefaultShellGrid(layoutViewportWidth()));
const initialLayout = composeLayout();
const sizes = ref<ShellLayoutSizes>({...initialLayout});
syncTree();

/**
 * 按 `store 值 + avail` 与外壳高重算四个宽度叶与 titlebar / main 并落账。
 * `remount=false`（拖拽 / 显隐）只更新模型与树，不重挂；`remount=true`（容器尺寸 / 外部尺寸）差异 ≥1px 才
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
 * 拖拽落账：像素增量 → 原语；`left` / `right` 把夹取后的绝对值写回 store（`novel.ide.local`）。
 * 编辑器不写 store —— 它是吸收余量的叶，尺寸由分配公式决定。
 * titlebar（36/36 刚性）与 main（分支，原语不接受分支 resize）不参与宽度结算。
 */
function onLeafResize(id: string, deltaPx: number): void {
    if (!(SHELL_LEAF_IDS as readonly string[]).includes(id)) {
        return;
    }
    const result = grid.value.resize(id, deltaPx);
    if (!result.ok) {
        issues.value = [...issues.value, result.reason];
        return;
    }
    const settled = treeSizes();
    if (id === "left") {
        leftPanelWidth.value = settled.left;
    } else if (id === "right") {
        agentPanelWidth.value = settled.right;
    }
    recalcSizes(false);
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

/** store 的外部改写（持久化恢复 / 别处的尺寸入口）→ 重新分配；自己回写的差 <1px，直接返回。 */
watch([leftPanelWidth, agentPanelWidth], () => recalcSizes(true));

/** 视口宽变了：right 的上限要重来（约束在建树时定稿），先重建树再重算尺寸。 */
watch(viewportWidth, () => {
    syncTree();
    recalcSizes(true);
});

defineExpose({setLeafVisible, hidden, issues});
</script>

<template>
    <div ref="shellEl" class="workbench-shell flex h-full w-full min-h-0 min-w-0 overflow-hidden" data-workbench-shell :data-shell-layout="narrow ? 'stacked' : 'split'">
        <WorkbenchBranch
            v-if="!narrow && rootBranch"
            :node="rootBranch"
            :sizes="sizes"
            :on-resize="onLeafResize"
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
 * titlebar|main 之间的 sash 不参与拖动（titlebar 36/36 刚性），分割线由标题栏自带的 border-bottom 承担：
 * 少一条 1px 线，活动栏的起点才与接入前一致（y = 36）。只作用于根分支自己的 handle，不动四个宽度叶的 sash。
 */
:deep([data-branch="root"] > div > [role="separator"]) {
    display: none;
}
</style>
