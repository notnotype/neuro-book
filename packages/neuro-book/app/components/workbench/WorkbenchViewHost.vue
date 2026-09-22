<script lang="ts">
import type {WorkbenchTitleActionEvent} from "nbook/app/utils/workbench/view-title-actions";
import type {ToolPartLocation, ViewSizePatch} from "nbook/app/utils/workbench/view-placements";

/**
 * 一次 `view-sizes` 提交：与位置会话的 `setViewSizes` 入参同形，页面可以原样转发。
 *
 * 一批只改**这一个容器里**的 View，且整批要么一起成功、要么一起被拒（会话那边按批拒绝）。
 * 补丁只带本次真正变化的字段：当前主轴的 `width` / `height`（左/右栏是 `height`，Panel 是 `width`）
 * 与 `collapsed`；另一轴的意图与未知字段不进补丁、由记录原样保留。
 * `sourceLocation` 是发起时该容器的生效落位：容器换 Part（= 换轴）后到达的批整批拒绝。
 */
export type WorkbenchViewSizesEvent = {
    readonly containerId: string;
    readonly sourceLocation: ToolPartLocation;
    readonly contextKey: string;
    readonly patches: readonly ViewSizePatch[];
};

/** View 标题动作的回传形状（共享 union 的 view 分支）。 */
export type WorkbenchViewTitleActionEvent = Extract<WorkbenchTitleActionEvent, {scope: "view"}>;
</script>

<script setup lang="ts">
/**
 * 容器的**内部**宿主：把容器切片的可见 View 渲染成一条**单轴** Grid，位置无关
 * （不再分 Panel / 侧栏两套模板，也不是写死的竖向）。
 *
 * 分工：
 * - 位置、可见性、动作可用性、落点、方向（`orientation`）与呈现模板（`mode`）都在容器切片里
 *   （`resolveViewPresentation` 求一次）；
 * - **树**：`viewContainerGridInput` 把可见成员投影成一棵单轴树（left/right 上下、panel 左右），
 *   每个可见 View 一个叶，叶里是 `WorkbenchViewSection`；
 * - **尺寸**：叶的意图是 px（`viewSizes[viewId]` 的当前轴字段，缺省 `240 * weight`），按 weight 参与分配；
 *   两轴意图都保存，容器换 Part 只换轴、不换算数值；`multiple` 收起时叶的主轴占位就是标题那一份，
 *   展开回到记忆尺寸；`single` 只有一个叶且不装收起策略（填满宿主，已有的收起意图保留但不应用）；
 * - **测量与布局**：`useLayoutExtent` 量承载盒的布局尺寸（client 尺寸，不带变换），
 *   `useGridLayout` 发布 node / layout / revision 并独占一次手势的一次 `resizeBranches`——
 *   结构、模式或轴一变就重建树并 `invalidate()`，进行中的手势据此整场失效；
 * - **手势结算**：成功的手势只把**主动改变**的叶折成一批 `view-sizes` 补丁
 *   （`viewSizePatchesOf`：邻居被补偿出的尺寸、降级夹取与 single 填满的测量值都不写意图），
 *   一批一次 emit；失败的整批不落账并回诊断。宿主不等存储：先落几何，再让页面交给唯一写者；
 * - 视图实例归 `WorkbenchViewInstances`：本组件只画落点（登记走它 provide 的通道）。
 *
 * 容器自己的标题、选择与框架动作**不在这里**：那是 Part 宿主（`WorkbenchPartHost`）的事。
 */
import {computed, inject, onBeforeUnmount, onMounted, ref, shallowRef, watch} from "vue";
import {CollisionPriority} from "@dnd-kit/abstract";
import {useDroppable} from "@dnd-kit/vue";
import {useGridLayout, useLayoutExtent} from "@notnotype/nb-ui/composables";
import {
    createGrid,
    GridRenderer,
    SASH_COLLAPSE_THRESHOLD,
    type Grid,
    type GridDropMember,
    type GridNodeInput,
} from "@notnotype/nb-ui/layout";
import WorkbenchViewSection, {WORKBENCH_VIEW_SECTION_HEADER_PX} from "nbook/app/components/workbench/WorkbenchViewSection.vue";
import {VIEW_TARGET_REGISTRY} from "nbook/app/components/workbench/WorkbenchViewInstances.vue";
import {
    workbenchContentTargetId,
    WORKBENCH_CONTAINER_DRAG_TYPE,
    WORKBENCH_CONTENT_TARGET_TYPE,
    WORKBENCH_VIEW_DRAG_TYPE,
    type WorkbenchContentDropData,
} from "nbook/app/composables/useWorkbenchDrag";
import {useWorkbenchDropGeometry} from "nbook/app/composables/useWorkbenchDrop";
import type {WorkbenchDropContentRects} from "nbook/app/utils/workbench/workbench-drop";
import {readWorkbenchDropRect, workbenchPointerCollision} from "nbook/app/utils/workbench/workbench-drop-dom";
import {SASH_PX} from "nbook/app/utils/workbench/layout";
import type {ContainerViewPresentation, WorkbenchViewEntry} from "nbook/app/utils/workbench/product-catalog";
import {
    viewContainerGridInput,
    viewSizePatchesOf,
    type ViewContainerGridOptions,
} from "nbook/app/utils/workbench/view-container-layout";
import type {ViewMoveRequest} from "nbook/app/utils/workbench/view-placements";
import type {WorkbenchTitleActionsByView} from "nbook/app/utils/workbench/view-title-actions";

const props = withDefaults(defineProps<{
    /** 本容器的求值切片（位置 + 可见性 + 动作可用性 + 落点 + 方向 + 模板）。 */
    presentation: ContainerViewPresentation;
    /** 全部 View 的尺寸意图（两轴独立，user/local 共用：跨 Project 同一份）；收起位也在里面。 */
    viewSizes?: Readonly<Record<string, {readonly width?: number; readonly height?: number; readonly collapsed?: boolean}>>;
    /** 会话与几何键：手势跨代不结算，随补丁交给位置会话。 */
    contextKey?: string;
    /** 标题动作菜单的失效指纹（面板状态 / 首 View / 代际）；与 `contextKey` 分开传。 */
    actionsContextKey?: string;
    /** 已求值的 View 标题动作，按 viewId 索引（`useWorkbenchViewActions().actionsByView`）。 */
    actionsByView?: WorkbenchTitleActionsByView;
    /** 是否允许把 View 移动到别的容器（拖动与「移动到」菜单共用这一条）。 */
    allowViewMove?: boolean;
    /** 是否允许把容器整组合并到本容器（内容落点的容器源）。 */
    allowContainerMove?: boolean;
    /** 「移动到」子菜单的可达名称（i18n 归页面）。 */
    moveLabel?: string;
    /** View 动作组的无障碍名称。 */
    viewActionsLabel?: string;
}>(), {
    viewSizes: () => ({}),
    contextKey: "",
    actionsContextKey: "",
    actionsByView: () => ({}),
    allowViewMove: false,
    allowContainerMove: false,
    moveLabel: "",
    viewActionsLabel: "",
});

const emit = defineEmits<{
    (e: "move-view", request: ViewMoveRequest): void;
    (e: "view-sizes", payload: WorkbenchViewSizesEvent): void;
    (e: "title-action", payload: WorkbenchViewTitleActionEvent): void;
}>();

const targets = inject(VIEW_TARGET_REGISTRY, null);
const containerId = computed(() => props.presentation.containerId);
const views = computed(() => props.presentation.views);

/** 实例通道缺失的诊断：宿主必须在 `WorkbenchViewInstances` 的子树里渲染，落点才会被实例层接走。 */
const missingInstanceChannel = computed(() => targets === null && views.value.length > 0);

/** 手势与落点的诊断出口：容量不足、提交被拒等都显示在容器里，不静默。 */
const gestureIssues = ref<readonly string[]>([]);
/** 收起细条故意不吸收剩余空间；这两条是几何事实，不是需要用户处理的故障。 */
const UNABSORBED_SPACE_NOTE = /未被(?:任何子节点)?吸收/;
const problems = computed(() => [...props.presentation.problems, ...gestureIssues.value]
    .filter((problem) => !UNABSORBED_SPACE_NOTE.test(problem)));

/** 没有可见视图时的说明：`when` 的原因去重后以「；」连接（可见性不是权限）。 */
const emptyText = computed(() => {
    const unique = [...new Set(props.presentation.hidden.flatMap((entry) => entry.visibilityReasons))];
    return unique.length > 0 ? unique.join("；") : "本容器还没有可见的视图，可从其它容器拖一个进来。";
});

// ── 尺寸意图与 Grid ──────────────────────────────────────────────────────────

/**
 * 建树输入：**可见**成员 + 记录里的尺寸意图 + 容器的方向与模板（都用切片求值过的事实）。
 *
 * 轴、约束、意图与收起策略全在纯投影里（`viewContainerGridInput`）：`single` 只有一个叶、
 * 不装收起策略（已有的收起意图保留但不应用），`multiple` 的收起叶主轴占位就是标题那一份。
 */
const gridOptions = computed<ViewContainerGridOptions<WorkbenchViewEntry>>(() => ({
    containerId: containerId.value,
    partId: props.presentation.partId,
    mode: props.presentation.mode,
    members: views.value.map((entry) => ({
        ref: entry,
        view: entry.view,
        size: props.viewSizes[entry.view.id],
        collapsed: props.viewSizes[entry.view.id]?.collapsed === true,
    })),
    collapseThreshold: SASH_COLLAPSE_THRESHOLD,
    collapsedSize: WORKBENCH_VIEW_SECTION_HEADER_PX,
}));

const gridInput = computed<GridNodeInput<WorkbenchViewEntry> | null>(() => viewContainerGridInput(gridOptions.value));

const gridEl = ref<HTMLElement | null>(null);
/** 承载盒的布局尺寸：`useLayoutExtent` 用 client 尺寸，不吃祖先 transform（命中另有 client rect）。 */
const extent = useLayoutExtent(gridEl);
const grid = shallowRef<Grid<WorkbenchViewEntry> | null>(null);

/**
 * 布局与一次手势的原子结算都由共享宿主组合式函数提供：node / layout / revision 是唯一的失效合同，
 * 提交先核对冻结的工作面、版本与承载盒尺寸，再一次性 `resizeBranches`。
 */
const {node: gridRoot, layout, revision, invalidate, onGestureCommit} = useGridLayout<WorkbenchViewEntry>({
    grid,
    extent,
    contextKey: () => props.contextKey,
    onApplied: (commit, applied) => {
        // 只认主动改变且真正变化的叶：补偿、夹取与 single 填满的测量值都不写意图。
        const patches = viewSizePatchesOf({layout: gridOptions.value, commit, applied});
        if (patches.length === 0) {
            return;
        }
        emit("view-sizes", {
            containerId: containerId.value,
            sourceLocation: props.presentation.location,
            contextKey: props.contextKey,
            patches,
        });
    },
    onIssues,
});

watch(gridInput, (node) => {
    grid.value = node === null ? null : createGrid(node, {
        sashSize: SASH_PX,
        // 叶的 ref 是求值后的条目（不是字符串）：给原语一个稳定的快照编码（本宿主不取快照）。
        encodeRef: (entry) => entry.view.id,
    });
    gestureIssues.value = [];
    // 结构、模式与轴都在这里变：显式失效一次，不依赖 composable 内部 watch 的执行顺序。
    invalidate();
}, {immediate: true});

/** 布局与提交的诊断出口：容量不足、降级与宿主通知失败都在这里显示，不静默。 */
function onIssues(issues: readonly string[]): void {
    if (issues.length > 0) {
        gestureIssues.value = issues.slice(-3);
    }
}

/** 标题上的折叠按钮：只改这一个 View 的收起位，主轴尺寸意图不动（展开回到上次尺寸）。 */
function onViewToggle(viewId: string, collapsed: boolean): void {
    emit("view-sizes", {
        containerId: containerId.value,
        sourceLocation: props.presentation.location,
        contextKey: props.contextKey,
        patches: [{viewId, collapsed}],
    });
}

// ── 落点 ─────────────────────────────────────────────────────────────────────

/**
 * 容器内容落点：**一个容器只有一个**，整块内容盒（含空态与横向收起的竖条）都是它。
 *
 * 插入位不再由 Section 各自注册，而是本层把「内容盒 + 可见叶的可见矩形（呈现顺序）」交给
 * `resolveWorkbenchDrop`，由同一个纯函数沿目标轴求插入位、接收半区与插入线——因此预览与最终插入位置必然同源。
 * 几何读法登记给页面的落点层（`useWorkbenchDrop`），它按容器 id 取；命中改由适配层的可见矩形 +
 * 指针遮挡检测器判定（见下面的 `collisionDetector`），不再用库默认的 bounding rect。
 */
/** 空态的承载元素：没有可见视图时内容盒就是它（落点与几何都要量这一块）。 */
const emptyRef = ref<HTMLElement | null>(null);
/** 内容盒：有网格就是网格根，空态就是空态块——两者同一时刻只有一个在 DOM 里。 */
const contentBox = computed<HTMLElement | null>(() => gridEl.value ?? emptyRef.value);
/** 登记时按容器 id 读一次；卸载时撤销（页面按 id 取，读法失效即拒绝而不是猜）。 */
let unregisterGeometry: (() => void) | null = null;

/**
 * 内容盒的**可见**矩形与按呈现顺序的可见成员矩形：都走 DOM 适配层的可见 reader
 * （`readWorkbenchDropRect`：扣掉祖先 overflow 裁剪与边框/滚动条，零尺寸与断连返回 `null`），
 * 因此被裁掉、parking 中的零尺寸根、`hidden` / `inert` 子树都不会被当成落点。
 */
const contentGeometryRead = (): WorkbenchDropContentRects | null => {
    const root = contentBox.value;
    if (root === null) {
        return null;
    }
    const rect = readWorkbenchDropRect(root);
    if (rect === null) {
        return null;
    }
    const members = memberRects(root);
    if (members === null) {
        return null;
    }
    if (members.length === 0 && props.presentation.views.length > 0) {
        // 切片说这里还有可见成员，却一个都量不出可见矩形：这不能冒充空容器（那会承诺"成为第一个视图"）。
        return null;
    }
    return {
        containerId: containerId.value,
        rect,
        members,
    };
};

/**
 * 可见叶的可见矩形：只在**当前内容盒**里按 `data-section` 属性值建一次映射（不再拼字符串选择器、
 * 不再查 document 全局），再按呈现顺序取切片里的可见成员。
 *
 * 两种"量不出来"是不同的合同：**应呈现成员的 DOM 缺失**说明内容盒与切片不是同一份结构，整份几何无效
 * （返回 `null`，判定拒绝而不是拿别的成员猜插入位）；**成员被裁掉 / 零尺寸**只是此刻不是可见候选，
 * 跳过即可。折叠的 Section 量的就是它自己的外盒——收起时那就是标题那一份，body 是零高。
 */
function memberRects(root: HTMLElement): readonly GridDropMember[] | null {
    const sections = new Map<string, Element>();
    for (const element of root.querySelectorAll("[data-section]")) {
        const viewId = element.getAttribute("data-section");
        if (viewId !== null && !sections.has(viewId)) {
            sections.set(viewId, element);
        }
    }
    const members: GridDropMember[] = [];
    for (const entry of props.presentation.views) {
        const element = sections.get(entry.view.id);
        if (element === undefined) {
            return null;
        }
        const rect = readWorkbenchDropRect(element);
        if (rect === null) {
            continue;
        }
        members.push({id: entry.view.id, rect});
    }
    return members;
}

const dropGeometry = useWorkbenchDropGeometry();
onMounted(() => {
    if (dropGeometry !== null) {
        unregisterGeometry = dropGeometry.registerContent(containerId.value, contentGeometryRead);
    }
});
onBeforeUnmount(() => {
    unregisterGeometry?.();
});

useDroppable<WorkbenchContentDropData>({
    id: computed(() => workbenchContentTargetId(containerId.value)),
    type: WORKBENCH_CONTENT_TARGET_TYPE,
    /**
     * 落点按**拖动源类型**分别收口：两个门压成一个总开关时，只开一门也会被另一种源命中
     * （判定层只校验源一侧的权限，不会替目标复核类型）。
     */
    accept: computed(() => [
        ...(props.allowViewMove ? [WORKBENCH_VIEW_DRAG_TYPE] : []),
        ...(props.allowContainerMove ? [WORKBENCH_CONTAINER_DRAG_TYPE] : []),
    ]),
    data: computed<WorkbenchContentDropData>(() => ({
        kind: "workbench-container-content-target",
        containerId: containerId.value,
        location: props.presentation.location,
    })),
    /**
     * 命中口径与几何读法同源：指针落在**可见**内容盒里、且指针位置最上层的业务元素属于它，
     * 才算命中（被裁掉的部分、被菜单/对话框盖住的位置、以及库默认"退化成与被拖 shape 相交"都不算）。
     */
    collisionDetector: () => workbenchPointerCollision,
    /** 内容盒是最粗的一档：精确条目（容器标签 / 活动栏条目）优先于它。 */
    collisionPriority: CollisionPriority.Normal,
    element: contentBox,
    disabled: computed(() => !props.allowViewMove && !props.allowContainerMove),
});
</script>

<template>
    <div
        class="workbench-view-host"
        :data-container-id="containerId"
        :data-container-location="presentation.location"
        :data-workbench-container="containerId"
        :data-container-mode="presentation.mode"
        :data-container-orientation="presentation.orientation"
    >
        <p v-for="problem in problems" :key="problem" class="workbench-view-host__note" role="status">{{ problem }}</p>
        <p v-if="missingInstanceChannel" class="workbench-view-host__note" role="status" data-view-instance-channel="missing">
            视图实例层不在宿主上方：请把宿主渲染在 `WorkbenchViewInstances` 的子树里，否则本容器的视图没有落点。
        </p>

        <div v-if="gridRoot" ref="gridEl" class="workbench-view-host__grid" :data-container-content="containerId">
            <GridRenderer
                :node="gridRoot"
                :layout="layout"
                :context-key="contextKey"
                :revision="revision"
                :on-gesture-commit="onGestureCommit"
                :on-issues="onIssues">
                <template #leaf="{node}">
                    <WorkbenchViewSection
                        :leaf="node"
                        :container-id="containerId"
                        :location="presentation.location"
                        :context-key="contextKey"
                        :actions-by-view="actionsByView"
                        :actions-context-key="actionsContextKey"
                        :orientation="presentation.orientation"
                        :view-mode="presentation.mode"
                        :allow-view-move="allowViewMove"
                        :move-targets="presentation.moveTargets"
                        :move-label="moveLabel"
                        :view-actions-label="viewActionsLabel"
                        @move-view="(request: ViewMoveRequest) => emit('move-view', request)"
                        @title-action="(payload: WorkbenchViewTitleActionEvent) => emit('title-action', payload)"
                        @toggle="onViewToggle" />
                </template>
            </GridRenderer>
        </div>

        <p v-else
            ref="emptyRef"
            class="workbench-view-host__empty"
            :data-container-content="containerId"
            :data-container-empty="containerId"
        >{{ emptyText }}</p>
    </div>
</template>

<style scoped>
/* 容器内容区：Grid 吃满剩余高度，末尾的追加落点是一条固定的细带。 */
.workbench-view-host {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
}

.workbench-view-host__grid {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
}

/* 末尾条：不占可读内容，只是内容盒的一部分（插入位由几何求值，不再单独注册落点）。 */
.workbench-view-host__end {
    flex: 0 0 6px;
}

.workbench-view-host__note {
    flex: 0 0 auto;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    font-size: 12px;
    line-height: 1.5;
    color: var(--status-warning);
}

.workbench-view-host__empty {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    justify-content: center;
    margin: 0;
    padding: var(--space-3);
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-muted);
    text-align: center;
}
</style>
