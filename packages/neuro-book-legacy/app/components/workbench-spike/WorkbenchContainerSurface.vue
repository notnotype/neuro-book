<script setup lang="ts">
/**
 * 容器表面：容器头（图标 + 标题 + 收起）+ 正文。
 *
 * - `panel` 位置：标签条切换该容器的活动视图，正文只画当前活动视图；
 * - 侧栏位置：堆叠视图行（VS Code 语义），行高按 layout 分配——`fill` 抢满剩余空间（内部滚动），`scroll` 保持固有高度。
 *
 * 视图跨容器拖拽的**落点判定**在这里（数「中点落在指针之前」的现有行；面板标签条沿横轴、侧栏堆叠行沿纵轴）；
 * 「能不能移」由落账路径统一判（`canMoveView`），本组件只把 payload 与插入序号发出去。
 */
import {computed, ref} from "vue";
import {canMoveView, labelOf, type SpikeContainerDescriptor, type SpikeViewDescriptor} from "./descriptors";
import {viewsOfContainer, type SpikeCatalog, type SpikeLayoutState} from "./layout";
import WorkbenchViewRow from "./WorkbenchViewRow.vue";
import type {FactoryResolution} from "./factories";

const VIEW_DRAG_TYPE = "text/x-nb-view";

const props = defineProps<{
    leafId: string;
    container: SpikeContainerDescriptor;
    state: SpikeLayoutState;
    catalog: SpikeCatalog;
    factoryStates: Record<string, FactoryResolution>;
    authority: Record<string, {actionable: boolean; reason?: string}>;
    visibility: Record<string, {visible: boolean; reason?: string}>;
}>();

const emit = defineEmits<{
    (event: "toggle-collapse", leafId: string): void;
    (event: "drag-view", viewId: string, containerId: string, index: number): void;
}>();

const containerViews = computed<SpikeViewDescriptor[]>(() => viewsOfContainer(props.container.id, props.state, props.catalog));
const visibleViews = computed(() => containerViews.value.filter((view) => props.visibility[view.id]?.visible !== false));
const hiddenViews = computed(() => containerViews.value.filter((view) => props.visibility[view.id]?.visible === false));

const activePanelView = ref("");
const panelView = computed(() => visibleViews.value.find((view) => view.id === activePanelView.value) ?? visibleViews.value[0] ?? null);

function rowStateOf(view: SpikeViewDescriptor): "ok" | "error" | "unavailable" {
    if (props.factoryStates[view.id]?.kind === "error") {
        return "error";
    }
    return props.authority[view.id]?.actionable === false ? "unavailable" : "ok";
}

function detailOf(view: SpikeViewDescriptor): string {
    const resolution = props.factoryStates[view.id];
    if (resolution?.kind === "error") {
        return resolution.reason;
    }
    const gate = props.authority[view.id];
    if (gate && !gate.actionable) {
        return gate.reason ?? "";
    }
    return resolution?.kind === "ok" ? `已实例化：${resolution.ref}` : "等待首次可见";
}

const draggingTab = ref("");

/** 面板标签也是拖拽起点：视图要能从面板挪回侧栏（与视图行同一份 payload）。 */
function onTabDragStart(event: DragEvent, viewId: string) {
    if (!event.dataTransfer) {
        return;
    }
    event.dataTransfer.setData(VIEW_DRAG_TYPE, viewId);
    event.dataTransfer.effectAllowed = "move";
    draggingTab.value = viewId;
}

const dropEl = ref<HTMLElement | null>(null);
const dropIndex = ref<number | null>(null);

/** 插入序号：数「中点落在指针之前」的现有行；面板的标签条沿横轴，侧栏的堆叠行沿纵轴。 */
function dropIndexAt(clientX: number, clientY: number): number {
    const element = dropEl.value;
    if (!element) {
        return 0;
    }
    const horizontal = props.leafId === "panel";
    let index = 0;
    for (const row of element.querySelectorAll<HTMLElement>("[data-drop-rows] [data-view-row], [data-drop-rows] [data-view-tab]")) {
        const box = row.getBoundingClientRect();
        const middle = horizontal ? box.left + box.width / 2 : box.top + box.height / 2;
        if ((horizontal ? clientX : clientY) > middle) {
            index += 1;
        }
    }
    return index;
}

function onDragOver(event: DragEvent) {
    if (!Array.from(event.dataTransfer?.types ?? []).includes(VIEW_DRAG_TYPE)) {
        return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
    }
    dropIndex.value = dropIndexAt(event.clientX, event.clientY);
}

function onDragLeave(event: DragEvent) {
    if (dropEl.value && event.relatedTarget instanceof Node && dropEl.value.contains(event.relatedTarget)) {
        return;
    }
    dropIndex.value = null;
}

/** 落点只做存在性判定；「能不能移」由落账路径统一判（`canMoveView`），这里不重复一份。 */
function onDrop(event: DragEvent, containerId: string) {
    const viewId = event.dataTransfer?.getData(VIEW_DRAG_TYPE) ?? "";
    const index = dropIndexAt(event.clientX, event.clientY);
    dropIndex.value = null;
    if (!viewId || !props.catalog.containers.some((item) => item.id === containerId)) {
        return;
    }
    event.preventDefault();
    emit("drag-view", viewId, containerId, index);
}
</script>

<template>
    <!-- 容器正文就是视图拖拽的落点（dropEl = 根元素） -->
    <div
        ref="dropEl"
        class="flex h-full min-h-0 flex-col"
        :class="leafId === 'panel' ? 'bg-[var(--bg-panel)]' : 'bg-[var(--bg-sidebar)]'"
        :data-container="container.id"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop($event, container.id)"
    >
        <div class="flex h-[var(--space-8)] shrink-0 items-center gap-[var(--space-2)] border-b-[length:var(--border-w)] border-[var(--divider)] px-[var(--space-3)]">
            <span :class="container.icon" class="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
            <span class="truncate text-[length:var(--text-xs)] [font-weight:var(--weight-strong)] text-[var(--text-main)]">{{ labelOf(container.titleKey) }}</span>
            <button
                type="button"
                class="nb-ui-focus-ring ml-auto flex h-[var(--control-h-sm)] w-[var(--control-h-sm)] shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-control)] text-[var(--text-muted)] transition-colors [transition-duration:var(--motion-fast)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                :aria-label="'收起 ' + labelOf(container.titleKey)"
                @click="emit('toggle-collapse', leafId)"
            >
                <span class="i-lucide-chevrons-left h-3.5 w-3.5" aria-hidden="true"></span>
            </button>
        </div>

        <!-- 面板：标签条切换该容器的活动视图 -->
        <template v-if="leafId === 'panel'">
            <div class="flex shrink-0 items-stretch overflow-x-auto border-b-[length:var(--border-w)] border-[var(--divider)] px-[var(--space-2)]" role="tablist" data-drop-rows>
                <template v-for="(view, index) in visibleViews" :key="view.id">
                    <span v-if="dropIndex === index" class="w-[2px] shrink-0 self-stretch rounded-[var(--radius-pill)] bg-[var(--accent-main)]" aria-hidden="true" data-drop-indicator></span>
                    <button
                        type="button"
                        role="tab"
                        class="nb-ui-focus-ring flex min-h-[var(--control-h-sm)] shrink-0 cursor-pointer items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-xs)] transition-opacity [transition-duration:var(--motion-fast)] hover:bg-[var(--bg-hover)]"
                        :class="[panelView?.id === view.id ? 'text-[var(--text-main)]' : 'text-[var(--text-muted)]', draggingTab === view.id ? 'opacity-60' : '']"
                        :aria-selected="panelView?.id === view.id"
                        :data-view-tab="view.id"
                        :draggable="canMoveView(view)"
                        @click="activePanelView = view.id"
                        @dragstart="onTabDragStart($event, view.id)"
                        @dragend="draggingTab = ''"
                    >
                        <span :class="view.icon" class="h-3.5 w-3.5 shrink-0" aria-hidden="true"></span>
                        <span class="truncate">{{ labelOf(view.titleKey) }}</span>
                    </button>
                </template>
                <span v-if="dropIndex === visibleViews.length" class="w-[2px] shrink-0 self-stretch rounded-[var(--radius-pill)] bg-[var(--accent-main)]" aria-hidden="true" data-drop-indicator></span>
            </div>
            <!-- 面板正文的包裹层已有确定高度（flex-1 + overflow-hidden）：行 h-full 即拿到确定高度，fill 的内部滚动成立 -->
            <div class="min-h-0 flex-1 overflow-hidden p-[var(--space-2)]">
                <WorkbenchViewRow
                    v-if="panelView"
                    :view="panelView"
                    :state="rowStateOf(panelView)"
                    :detail="detailOf(panelView)"
                    :draggable="canMoveView(panelView)"
                    class="h-full"
                />
                <p v-else class="p-[var(--space-3)] text-[length:var(--text-2xs)] text-[var(--text-muted)]">容器内没有可见的视图。</p>
            </div>
        </template>

        <!-- 侧栏：堆叠视图行。行高按 layout 分配：fill 抢满剩余空间（内部滚动），scroll 保持固有高度 -->
        <div v-else class="flex min-h-0 flex-1 flex-col gap-[var(--space-2)] overflow-y-auto p-[var(--space-2)]" role="list" data-drop-rows>
            <template v-for="(view, index) in visibleViews" :key="view.id">
                <span v-if="dropIndex === index" class="h-[2px] shrink-0 rounded-[var(--radius-pill)] bg-[var(--accent-main)]" aria-hidden="true" data-drop-indicator></span>
                <WorkbenchViewRow
                    :view="view"
                    :state="rowStateOf(view)"
                    :detail="detailOf(view)"
                    :draggable="canMoveView(view)"
                    :class="view.layout === 'fill' ? 'min-h-0 flex-1' : 'shrink-0'"
                />
            </template>
            <span v-if="dropIndex === visibleViews.length" class="h-[2px] shrink-0 rounded-[var(--radius-pill)] bg-[var(--accent-main)]" aria-hidden="true" data-drop-indicator></span>
            <p v-for="item in hiddenViews" :key="item.id" class="px-[var(--space-2)] text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                不可见：{{ labelOf(item.titleKey) }}（{{ visibility[item.id]?.reason }}）
            </p>
        </div>
    </div>
</template>
