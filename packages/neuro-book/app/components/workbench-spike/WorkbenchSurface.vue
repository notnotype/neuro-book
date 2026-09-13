<script setup lang="ts">
/**
 * 工作台表面：一个叶子节点里渲染的整块界面。
 *
 * - `activity`：两条活动栏（左栏 = `sidebar-left` 的容器，右栏 = `sidebar-right` 的容器；面板容器走面板标签条）；
 * - `sidebar-left` / `sidebar-right`：当前活动容器 = 容器头 + 堆叠视图行（VS Code 语义）；
 * - `panel`：当前活动容器 = 容器头 + 标签条 + 活动视图；
 * - `editor`：标签条 + 空白页；`statusbar`：计数 + 布局摘要。
 *
 * 视图跨容器拖拽的**落点判定**在这里（容器正文用行中点算插入序号），改状态由父组件按 `placeView` 落账。
 */
import {computed, ref} from "vue";
import {labelOf, SPIKE_CONTAINERS, SPIKE_VIEWS, type SpikeContainerDescriptor, type SpikeViewDescriptor} from "./descriptors";
import {viewsOfContainer, type SpikeLayoutState, type SpikeLocation} from "./layout";
import WorkbenchViewRow from "./WorkbenchViewRow.vue";
import type {FactoryResolution} from "./factories";

const VIEW_DRAG_TYPE = "text/x-nb-view";

const props = defineProps<{
    leafId: string;
    state: SpikeLayoutState;
    factoryStates: Record<string, FactoryResolution>;
    authority: Record<string, {actionable: boolean; reason?: string}>;
    visibility: Record<string, {visible: boolean; reason?: string}>;
}>();

const emit = defineEmits<{
    (event: "toggle-collapse", leafId: string): void;
    (event: "set-active-container", location: SpikeLocation, containerId: string): void;
    (event: "drag-view", viewId: string, containerId: string, index: number): void;
}>();

const LOCATION_LABELS: Record<SpikeLocation, string> = {"sidebar-left": "左栏", "sidebar-right": "右栏", "panel": "面板"};
const SIDEBAR_LOCATIONS: SpikeLocation[] = ["sidebar-left", "sidebar-right"];
const ALL_LOCATIONS: SpikeLocation[] = ["sidebar-left", "sidebar-right", "panel"];
const EDITOR_TABS = [
    {id: "chapter-001.md", icon: "i-lucide-file-text"},
    {id: "outline.md", icon: "i-lucide-list-tree"},
];
const PROJECT_NAME = "NeuroBook 示例项目";

/** 活动栏的两条：容器按 descriptor 的默认位置分组，面板容器不在这里（走面板标签条）。 */
const activityGroups = computed(() => SIDEBAR_LOCATIONS.map((location) => ({
    location,
    label: location === "sidebar-left" ? "左侧栏容器" : "右侧栏容器",
    containers: SPIKE_CONTAINERS.filter((item) => item.location === location),
})));

const container = computed<SpikeContainerDescriptor | null>(
    () => SPIKE_CONTAINERS.find((item) => item.id === props.state.activeContainer[props.leafId as SpikeLocation]) ?? null,
);
const containerViews = computed<SpikeViewDescriptor[]>(() => (container.value ? viewsOfContainer(container.value.id, props.state) : []));
const visibleViews = computed(() => containerViews.value.filter((view) => props.visibility[view.id]?.visible !== false));
const hiddenViews = computed(() => containerViews.value.filter((view) => props.visibility[view.id]?.visible === false));

const editorTab = ref(EDITOR_TABS[0]!.id);
const activePanelView = ref("");
const panelView = computed(() => visibleViews.value.find((view) => view.id === activePanelView.value) ?? visibleViews.value[0] ?? null);

const layoutSummary = computed(() => ALL_LOCATIONS.map((location) => {
    const item = SPIKE_CONTAINERS.find((entry) => entry.id === props.state.activeContainer[location]);
    const title = item ? labelOf(item.titleKey) : "没有容器";
    return {location, text: `${LOCATION_LABELS[location]}：${title}${props.state.collapsed.includes(location) ? "（已收起）" : ""}`, collapsed: props.state.collapsed.includes(location), title};
}));

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

function onActivityClick(location: SpikeLocation, containerId: string) {
    if (props.state.activeContainer[location] === containerId) {
        emit("toggle-collapse", location);
        return;
    }
    emit("set-active-container", location, containerId);
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
    for (const row of element.querySelectorAll<HTMLElement>("[data-drop-rows] [data-view-row]")) {
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

function onDrop(event: DragEvent, containerId: string) {
    const viewId = event.dataTransfer?.getData(VIEW_DRAG_TYPE) ?? "";
    const index = dropIndexAt(event.clientX, event.clientY);
    dropIndex.value = null;
    if (!viewId || !SPIKE_CONTAINERS.some((item) => item.id === containerId)) {
        return;
    }
    event.preventDefault();
    emit("drag-view", viewId, containerId, index);
}
</script>

<template>
    <!-- 活动栏：一个叶子装两条，左栏管左侧栏容器、右栏管右侧栏容器；选中态即「该位置当前显示的容器」 -->
    <div v-if="leafId === 'activity'" class="flex h-full flex-col items-center bg-[var(--bg-subtle)] py-[var(--space-4)]">
        <div
            v-for="(group, groupIndex) in activityGroups"
            :key="group.location"
            class="flex flex-col items-center gap-[var(--space-2)]"
            :class="groupIndex > 0 ? 'mt-auto border-t-[length:var(--border-w)] border-[var(--divider)] pt-[var(--space-4)]' : ''"
            role="group"
            :aria-label="group.label"
            :data-activity-group="group.location"
        >
            <button
                v-for="item in group.containers"
                :key="item.id"
                type="button"
                class="nb-ui-focus-ring flex h-8 w-8 cursor-pointer items-center justify-center rounded-[var(--radius-control)] text-[var(--text-muted)] transition-colors [transition-duration:var(--motion-fast)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                :class="state.activeContainer[group.location] === item.id ? 'bg-[var(--bg-hover)] text-[var(--text-main)]' : ''"
                :title="labelOf(item.titleKey)"
                :aria-pressed="state.activeContainer[group.location] === item.id"
                :data-activity-item="item.id"
                @click="onActivityClick(group.location, item.id)"
            >
                <span :class="item.icon" class="h-4 w-4" aria-hidden="true"></span>
            </button>
        </div>
    </div>

    <div v-else ref="dropEl" class="h-full min-h-0 min-w-0">
        <!-- 容器：容器头 + 正文（正文即视图拖拽的落点） -->
        <div
            v-if="container"
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
                    class="nb-ui-focus-ring ml-auto flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-control)] text-[var(--text-muted)] transition-colors [transition-duration:var(--motion-fast)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
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
                            class="nb-ui-focus-ring flex shrink-0 cursor-pointer items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-xs)] transition-opacity [transition-duration:var(--motion-fast)] hover:bg-[var(--bg-hover)]"
                            :class="[panelView?.id === view.id ? 'text-[var(--text-main)]' : 'text-[var(--text-muted)]', draggingTab === view.id ? 'opacity-60' : '']"
                            :aria-selected="panelView?.id === view.id"
                            :data-view-row="view.id"
                            :draggable="view.canMoveView"
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
                <div class="min-h-0 flex-1 overflow-hidden p-[var(--space-2)]">
                    <WorkbenchViewRow
                        v-if="panelView"
                        :view="panelView"
                        :state="rowStateOf(panelView)"
                        :detail="detailOf(panelView)"
                        :draggable="panelView.canMoveView"
                        class="h-full"
                    />
                    <p v-else class="p-[var(--space-3)] text-[length:var(--text-2xs)] text-[var(--text-muted)]">容器内没有可见的视图。</p>
                </div>
            </template>

            <!-- 侧栏：堆叠视图行 -->
            <div v-else class="flex min-h-0 flex-1 flex-col gap-[var(--space-2)] overflow-y-auto p-[var(--space-2)]" role="list" data-drop-rows>
                <template v-for="(view, index) in visibleViews" :key="view.id">
                    <span v-if="dropIndex === index" class="h-[2px] shrink-0 rounded-[var(--radius-pill)] bg-[var(--accent-main)]" aria-hidden="true" data-drop-indicator></span>
                    <WorkbenchViewRow :view="view" :state="rowStateOf(view)" :detail="detailOf(view)" :draggable="view.canMoveView" />
                </template>
                <span v-if="dropIndex === visibleViews.length" class="h-[2px] shrink-0 rounded-[var(--radius-pill)] bg-[var(--accent-main)]" aria-hidden="true" data-drop-indicator></span>
                <p v-for="item in hiddenViews" :key="item.id" class="px-[var(--space-2)] text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                    不可见：{{ labelOf(item.titleKey) }}（{{ visibility[item.id]?.reason }}）
                </p>
            </div>
        </div>

        <!-- 编辑器：标签条 + 空白页（标签与缓冲属编辑器会话，不是布局） -->
        <div v-else-if="leafId === 'editor'" class="flex h-full min-h-0 flex-col bg-[var(--bg-main)]">
            <div class="flex shrink-0 items-stretch border-b-[length:var(--border-w)] border-[var(--divider)] bg-[var(--bg-subtle)]" role="tablist">
                <button
                    v-for="tab in EDITOR_TABS"
                    :key="tab.id"
                    type="button"
                    role="tab"
                    class="nb-ui-focus-ring flex shrink-0 cursor-pointer items-center gap-[var(--space-2)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-xs)] transition-colors [transition-duration:var(--motion-fast)] hover:bg-[var(--bg-hover)]"
                    :class="editorTab === tab.id ? 'bg-[var(--bg-panel)] text-[var(--text-main)]' : 'text-[var(--text-muted)]'"
                    :aria-selected="editorTab === tab.id"
                    :data-editor-tab="tab.id"
                    @click="editorTab = tab.id"
                >
                    <span :class="tab.icon" class="h-3.5 w-3.5 shrink-0" aria-hidden="true"></span>
                    <span class="truncate">{{ tab.id }}</span>
                </button>
            </div>
            <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-[var(--space-3)] p-[var(--space-6)]">
                <p class="text-[length:var(--text-sm)] [font-weight:var(--weight-strong)] text-[var(--text-main)]">{{ PROJECT_NAME }}</p>
                <p class="text-[length:var(--text-xs)] text-[var(--text-muted)]">Ctrl+P 快速打开 · Ctrl+Shift+P 命令面板 · 标签与缓冲不进布局快照</p>
            </div>
        </div>

        <!-- 状态栏：左侧计数，右侧布局摘要（收起的位置点一下即可展开） -->
        <div v-else-if="leafId === 'statusbar'" class="flex h-full items-center justify-between gap-[var(--space-4)] bg-[var(--bg-subtle)] px-[var(--space-3)] text-[length:var(--text-2xs)] text-[var(--text-muted)]">
            <span class="shrink-0">{{ SPIKE_VIEWS.length }} 个视图 · {{ SPIKE_CONTAINERS.length }} 个容器</span>
            <span class="flex min-w-0 items-center gap-[var(--space-2)]">
                <template v-for="item in layoutSummary" :key="item.location">
                    <button
                        v-if="item.collapsed"
                        type="button"
                        class="nb-ui-focus-ring shrink-0 cursor-pointer rounded-[var(--radius-control)] px-[var(--space-2)] transition-colors [transition-duration:var(--motion-fast)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                        :aria-label="'展开 ' + item.title"
                        @click="emit('toggle-collapse', item.location)"
                    >
                        {{ item.text }}
                    </button>
                    <span v-else class="shrink-0">{{ item.text }}</span>
                </template>
            </span>
        </div>

        <p v-else class="p-[var(--space-4)] text-[length:var(--text-2xs)] text-[var(--text-muted)]">这个位置没有可显示的容器：{{ leafId }}</p>
    </div>
</template>
