<script lang="ts">
/**
 * Section 标题的固定占用（CSS px）：纵向是标题高，横向收起时是竖条宽。
 *
 * 它同时是 Grid 收起叶的 `collapsedSize`（`WorkbenchViewHost` 建树时传进去）：几何与观感同一个数，
 * 不各写一份 32。
 */
export const WORKBENCH_VIEW_SECTION_HEADER_PX = 32;

/** 「移动到」子菜单的父项 id：父项只展开、不执行，id 描述的是「这是哪个动作」。 */
export const VIEW_MOVE_MENU_ITEM_ID = "nbook.view.move-view";
/** 子项 id 前缀：子项 id 自带目标容器，回传时不需要再查一次菜单。 */
export const VIEW_MOVE_ITEM_PREFIX = "move-view:";

/**
 * 「移动到」子菜单（带一层 `children` 的动作项）：multiple 时进 Section 标题的「更多」，
 * single 时进 Part 宿主上提的动作组——两处共用同一份 id 词汇与同一个回传形状。
 *
 * 没有可投递的落点（不可移动 / 没有别的容器）时返回 `null`，整条不给。
 */
export function viewMoveSubmenu(options: {
    readonly label: string;
    readonly targets: readonly ViewMoveTarget[];
}): WorkbenchTitleActionItem | null {
    if (options.targets.length === 0) {
        return null;
    }
    return {
        id: VIEW_MOVE_MENU_ITEM_ID,
        label: options.label,
        icon: "i-lucide-corner-up-right",
        children: options.targets.map((target) => ({id: `${VIEW_MOVE_ITEM_PREFIX}${target.containerId}`, label: target.title})),
    };
}
</script>

<script setup lang="ts">
/**
 * 工作台容器内部的**一个 View**：Grid 叶的内容（Section 标题 + 内容落点）。
 *
 * 分工：
 * - **拖动面是整条标题**（`data-workbench-drag-kind="view"`）：鼠标 / 笔移动 6px、触摸按住 200ms 起拖，
 *   载荷是「哪个 View、来自哪个容器」；没有拖动时那一下仍是标题自己的点击（折叠 / 展开）。
 *   拖动中的观感归页面唯一的 `WorkbenchDragOverlay`：标题原地不动，不降不透明度也不位移。
 *   动作组、菜单、表单控件与 `data-no-drag` 区域不参与拖动，标题自身的折叠按钮**仍可拖**。
 * - **Section 自己的插入位**：拖来的 View 落在标题上就是「插到这个 Section 之前」；它不是第二个拖动源，
 *   也不执行移动——载荷交给页面的命令门禁。
 * - **折叠是受控的**：收起位由 Grid 叶的 `collapse` 状态给出（本组件从叶上读，不自己存一份），
 *   本组件只回传意图，由宿主折进同一次 `view-sizes` 合成。内容区在自己的盒子里滚动或留白，
 *   不改变 Grid 叶的外部分配。
 * - **内容落点**：`[data-view]` 元素登记给 View 实例层，业务实例由那一层 Teleport 进来。
 *
 * 三种呈现都由**容器的切片事实**给（本组件不求值、不猜）：
 * - `multiple`：每个 View 一条 32px 标题（图标 + 标题 + 折叠按钮 + 动作组）；
 * - `single`（`viewMode === "single"`）：**不渲染标题**，内容区照旧占满、落点与实例不重挂；
 *   这个 View 的动作由 `WorkbenchPartHost` 投射到容器右上角，所以这里也不做拖动源；
 * - 收起 + `horizontal`：标题变成 32px 宽的竖条（展开按钮 + 图标 + 可达名称 + 「更多」菜单，
 *   `primary` 动作折进菜单）；`vertical` 收起仍是 32px 横向标题。
 *
 * 高度（或横向容器里的宽度）由外层 Grid 决定（收起时叶的主轴占位就是标题），本组件不写死自身尺寸。
 */
import {computed, inject, ref} from "vue";
import type {GridLeaf, GridOrientation} from "@notnotype/nb-ui/layout";
import type {ToolPartLocation} from "nbook/app/utils/workbench/view-placements";
import {useWorkbenchDrag} from "nbook/app/composables/useWorkbenchDrag";
import WorkbenchTitleActions from "nbook/app/components/workbench/WorkbenchTitleActions.vue";
import {VIEW_TARGET_REGISTRY} from "nbook/app/components/workbench/WorkbenchViewInstances.vue";
import {resolveViewLayout, type ViewLayoutContract} from "nbook/app/utils/workbench/descriptors";
import type {ViewMoveTarget, WorkbenchViewEntry} from "nbook/app/utils/workbench/product-catalog";
import type {ViewContainerMode} from "nbook/app/utils/workbench/view-container-layout";
import type {ViewMoveRequest} from "nbook/app/utils/workbench/view-placements";
import {
    titleActionsSignature,
    type ViewActionTarget,
    type WorkbenchTitleActionItem,
    type WorkbenchTitleActionsByView,
    type WorkbenchViewTitleActions,
} from "nbook/app/utils/workbench/view-title-actions";

const props = defineProps<{
    /** Grid 叶：它的 `ref` 是求值后的视图条目，`collapse.collapsed` 是当前收起位。 */
    leaf: GridLeaf<unknown>;
    /** 承载这个 View 的容器（移动请求的来源）。 */
    containerId: string;
    /** 容器的生效落位：拖动载荷要带上它，跨 Part 的记录层按它复核来源。 */
    location: ToolPartLocation;
    /** 会话上下文代际：拖动载荷冻结它，判定与记录层据此拒绝过期意图。 */
    contextKey: string;
    /** 已求值的 View 标题动作，按 viewId 索引。 */
    actionsByView: WorkbenchTitleActionsByView;
    /** 标题动作菜单的失效指纹（工作面 / 首 View / 代际一变就关掉旧菜单）；**不是**会话与几何键。 */
    actionsContextKey: string;
    /** 容器内部的方向（来自容器切片）：`horizontal` 且收起时标题改成 32px 宽的竖条。 */
    orientation: GridOrientation;
    /** 容器的呈现模板：`single` 不渲染重复的标题（动作归容器右上角）。 */
    viewMode: ViewContainerMode;
    /** 是否允许把 View 移动到别的容器（拖动与「移动到」菜单共用这一条）。 */
    allowViewMove: boolean;
    /** 可投递的落点（来自容器切片，不含自己）。 */
    moveTargets: readonly ViewMoveTarget[];
    /** 「移动到」子菜单的可达名称（i18n 归页面）。 */
    moveLabel: string;
    /** View 动作组的无障碍名称。 */
    viewActionsLabel: string;
}>();

const emit = defineEmits<{
    (e: "move-view", request: ViewMoveRequest): void;
    (e: "title-action", payload: {scope: "view"; target: ViewActionTarget; actionId: string}): void;
    (e: "toggle", viewId: string, collapsed: boolean): void;
}>();

/** 叶的 `ref` 就是求值后的条目；取不到（不该发生）时不渲染，也不猜。 */
const entry = computed<WorkbenchViewEntry | null>(() => {
    const reference = props.leaf.ref;
    if (reference === null || typeof reference !== "object" || !("view" in reference)) {
        return null;
    }
    return reference as WorkbenchViewEntry;
});

const viewId = computed(() => entry.value?.view.id ?? "");
const collapsed = computed(() => props.leaf.collapse?.collapsed === true);
const bodyId = computed(() => `section-body-${viewId.value}`);

/** 容器只有一个可见 View：不渲染重复标题，这个 View 的动作由容器右上角投射。 */
const headless = computed(() => props.viewMode === "single");
/** 横向容器里收起：标题变成 32px 宽的竖条（Grid 已经把叶的主轴占位收到标题那一份）。 */
const strip = computed(() => collapsed.value && props.orientation === "horizontal");

const contract = computed<ViewLayoutContract>(() => {
    const mode = entry.value?.view.layout ?? "scroll";
    const resolved = resolveViewLayout(mode);
    return resolved.ok ? resolved.value : {mode: "scroll", shellPadsContent: false, shellOwnsScroll: false};
});

const targets = inject(VIEW_TARGET_REGISTRY, null);

/** 内容落点登记：卸载时按**元素身份**反登记，实例层随即把实例停到 parking。 */
const targetElement = ref<HTMLElement | null>(null);

function setTargetElement(element: unknown): void {
    const previous = targetElement.value;
    if (element instanceof HTMLElement) {
        targetElement.value = element;
        targets?.register(viewId.value, element);
        return;
    }
    targetElement.value = null;
    if (previous !== null) {
        targets?.unregister(viewId.value, previous);
    }
}

/** 标题整块的拖动源；不可移动时（宿主没开、View 声明不可移动或没有标题）不登记。 */
const drag = useWorkbenchDrag({
    kind: "view",
    payload: () => ({
        kind: "workbench-view" as const,
        viewId: viewId.value,
        containerId: props.containerId,
        location: props.location,
        contextKey: props.contextKey,
    }),
    // single 没有标题，也就没有 View 拖动把手：搬整个容器走容器标签，只搬这一个 View 走「移动到」菜单。
    disabled: () => headless.value || !props.allowViewMove || entry.value?.view.canMoveView !== true,
});

const headRef = drag.element;

/*
 * 插入位不再由每个 Section 注册：容器内容区只有一个落点（`WorkbenchViewHost` 注册），
 * 插入线由「内容盒 + 可见叶的 client rect」交给 `resolveWorkbenchDrop` 求值。
 * 这样一屏上有几个 View 就有几条候选线，却只有一份判定与一份几何。
 */

/** 「移动到」子菜单：不可移动 / 没开移动 / 没有落点时整条不给（id 词汇与 single 的上提动作同源）。 */
const moveSubmenu = computed(() => (props.allowViewMove && entry.value?.view.canMoveView === true
    ? viewMoveSubmenu({label: props.moveLabel, targets: props.moveTargets})
    : null));

/** 已求值的展示项 + 本组件补上的移动子菜单（移动是容器层动作，不在 View 自己的贡献里）。 */
const titleActions = computed<WorkbenchViewTitleActions | null>(() => {
    const resolved = entry.value === null ? null : props.actionsByView[entry.value.view.id] ?? null;
    if (resolved === null) {
        return null;
    }
    return moveSubmenu.value === null ? resolved : {...resolved, secondary: [...resolved.secondary, moveSubmenu.value]};
});

/** 竖条里的动作全部折进「更多」：32px 宽放不下第二排按钮，`primary` 也进菜单。 */
const stripActions = computed<readonly WorkbenchTitleActionItem[]>(() => {
    const resolved = titleActions.value;
    return resolved === null ? [] : [...resolved.primary, ...resolved.secondary];
});

const actionsKey = computed(() => titleActions.value === null
    ? ""
    : `${props.actionsContextKey}|${viewId.value}|${titleActions.value.target.generation}|${titleActionsSignature(titleActions.value)}`);

function onInvoke(actionId: string): void {
    if (actionId.startsWith(VIEW_MOVE_ITEM_PREFIX)) {
        emit("move-view", {
            viewId: viewId.value,
            sourceContainerId: props.containerId,
            targetContainerId: actionId.slice(VIEW_MOVE_ITEM_PREFIX.length),
        });
        return;
    }
    const target = titleActions.value?.target;
    if (target !== undefined) {
        emit("title-action", {scope: "view", target, actionId});
    }
}
</script>

<template>
    <section
        v-if="entry"
        class="workbench-view-section"
        :class="{'workbench-view-section--strip': strip}"
        :data-section="viewId"
        :data-view-id="viewId"
        :data-container-mode="viewMode"
        :data-section-orientation="orientation"
        :data-strip="strip ? 'true' : undefined"
        :data-collapsed="collapsed ? 'true' : 'false'"
        :data-layout="contract.mode"
    >
        <!--
          single 不渲染标题：内容挂载节点（下面的 `[data-view]`）与整块叶都不动，
          实例因此不会重挂；这个 View 的动作由容器右上角投射（见 `WorkbenchPartHost`）。
        -->
        <div
            v-if="!headless"
            key="view-head"
            ref="headRef"
            class="workbench-view-section__head"
            data-workbench-drag-kind="view"
            @click.capture="drag.suppressClick"
            @pointerdown.capture="drag.resetSuppression"
        >
            <!-- 横向容器收起：32px 宽的竖条。名称保持在可访问树里（`sr-only`），完整名称同时进 tooltip。 -->
            <template v-if="strip">
                <button
                    type="button"
                    class="workbench-view-section__toggle workbench-view-section__toggle--strip"
                    :title="entry.title"
                    :aria-expanded="false"
                    :aria-controls="bodyId"
                    @click="emit('toggle', viewId, false)"
                >
                    <span
                        class="workbench-view-section__chevron i-lucide-chevrons-left-right"
                        aria-hidden="true"
                    ></span>
                    <span v-if="entry.view.icon" :class="entry.view.icon" class="workbench-view-section__icon" aria-hidden="true"></span>
                    <span class="sr-only">{{ entry.title }}</span>
                </button>

                <div v-if="stripActions.length > 0" class="workbench-view-section__actions workbench-view-section__actions--strip" data-no-drag>
                    <WorkbenchTitleActions
                        scope="view"
                        more-first
                        compact
                        :primary="[]"
                        :secondary="stripActions"
                        :context-key="actionsKey"
                        :label="viewActionsLabel"
                        @invoke="onInvoke" />
                </div>
            </template>

            <template v-else>
                <button
                    type="button"
                    class="workbench-view-section__toggle"
                    :aria-expanded="!collapsed"
                    :aria-controls="bodyId"
                    @click="emit('toggle', viewId, !collapsed)"
                >
                    <span
                        class="workbench-view-section__chevron i-lucide-chevron-right"
                        :class="{'workbench-view-section__chevron--expanded': !collapsed}"
                        aria-hidden="true"
                    ></span>
                    <span v-if="entry.view.icon" :class="entry.view.icon" class="workbench-view-section__icon" aria-hidden="true"></span>
                    <span class="workbench-view-section__title">{{ entry.title }}</span>
                </button>

                <!-- 动作组：`data-no-drag` 让按在这里的指针不启动整标题拖动。 -->
                <div v-if="titleActions" class="workbench-view-section__actions" data-no-drag>
                    <WorkbenchTitleActions
                        scope="view"
                        :primary="titleActions.primary"
                        :secondary="titleActions.secondary"
                        :context-key="actionsKey"
                        :label="viewActionsLabel"
                        @invoke="onInvoke" />
                </div>
            </template>
        </div>

        <!--
          两个子节点都带 key：标题在 single 下不渲染时，内容落点必须仍是**同一个 DOM 节点**
          （实例的 Teleport 目标、业务滚动位置都不该因为模式变化被重建）。
        -->
        <div
            v-show="!collapsed"
            key="view-body"
            :id="bodyId"
            class="workbench-view-section__body"
            :class="{
                'workbench-view-section__body--padded': contract.shellPadsContent,
                'workbench-view-section__body--scrolling': contract.shellOwnsScroll,
            }"
        >
            <div
                :ref="setTargetElement"
                class="workbench-view-section__target"
                :data-view="viewId"
            ></div>
        </div>
    </section>
</template>

<style scoped>
/*
 * 整块 Section 自己占满 Grid 给它的叶盒：标题固定 `--workbench-view-section-header`，
 * 内容吃剩下的高度并在自己的盒子里滚动（`scroll` 档）或交给视图（`fill` 档）。
 *
 * 拖动中不给标题降不透明度 / 位移：跟指针走的是页面唯一的 `WorkbenchDragOverlay`，源标题保持原样。
 */
.workbench-view-section {
    --workbench-view-section-header: 32px;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    touch-action: pan-y;
}

/*
 * 横向容器收起：叶的主轴占位（= 宽度）已经是 32px，标题在这里改成一条竖条——
 * 内容区被 `v-show` 收起，标题自己吃满叶高，按钮竖排；长标题不硬塞进 32px。
 */
.workbench-view-section--strip {
    flex-direction: row;
    border-inline-end: var(--border-w) solid var(--divider);
}

.workbench-view-section--strip .workbench-view-section__head {
    flex: 1 1 auto;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-1);
    width: 100%;
    height: 100%;
    padding: var(--space-1) 0;
    border-bottom: 0;
}

.workbench-view-section--strip .workbench-view-section__toggle {
    flex: 0 0 auto;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    height: auto;
}

.workbench-view-section--strip .workbench-view-section__chevron,
.workbench-view-section--strip .workbench-view-section__icon {
    width: 16px;
    height: 16px;
}
.workbench-view-section__toggle .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
}

.workbench-view-section--strip .workbench-view-section__actions,
.workbench-view-section--strip .workbench-title-actions {
    flex: 0 0 auto;
    width: auto;
}

.workbench-view-section__head {
    display: flex;
    flex: 0 0 var(--workbench-view-section-header);
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    height: var(--workbench-view-section-header);
    min-width: 0;
    padding-inline: var(--space-2);
    border-bottom: var(--border-w) solid var(--divider);
    /* 整条标题就是拖动面：不要选中文字，也不要被浏览器抢走横向手势。 */
    user-select: none;
}

/* 折叠按钮占满标题左侧：它既是键盘的折叠入口，也是鼠标拖动的落点。 */
.workbench-view-section__toggle {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    height: 100%;
    padding: 0;
    font-size: 12px;
    font-weight: var(--weight-strong);
    color: var(--text-muted);
    text-align: start;
    cursor: pointer;
    background: none;
    border: 0;
}

.workbench-view-section__toggle:hover {
    color: var(--text-main);
}

.workbench-view-section__chevron {
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
    transition: transform var(--motion-fast) var(--ease-standard);
}

.workbench-view-section__chevron--expanded {
    transform: rotate(90deg);
}

.workbench-view-section__icon {
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
}

.workbench-view-section__title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.workbench-view-section__actions {
    display: flex;
    flex: 0 1 auto;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
}

.workbench-view-section__body {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
}

.workbench-view-section__body--padded {
    padding: var(--space-2) var(--space-3);
}

.workbench-view-section__body--scrolling {
    overflow-y: auto;
}

.workbench-view-section__target {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
}
</style>
