<script setup lang="ts">
/**
 * 外壳二的集成场景（docs/specs/ui/workbench-shell.md 外壳二），登记为 WorkbenchShellLayout 的 views 系列场景：真实的外壳
 * 布局、活动栏、工具区域、面板框架与两层实例，落位、呈现与意图合成用产品的纯模型；外壳的尺寸与面板状态是场景输入
 * （数据面板里看得到），视图定制只在场景里（不连产品的布局 store、Storage 与插件宿主）。视图来源是一份局部实现：按
 * 场景开关让某个视图加载失败、渲染出错、所属入口停止或启动失败。
 *
 * 样例视图带实例编号、代际与可见标记：在同一场景里连续移动、切容器、隐藏 Part，实例编号不变就说明没有重挂。
 */
import {Button, SegmentedControl, Tabs} from "@notnotype/nb-ui/components";
import {computed, reactive, ref, shallowRef} from "vue";

import WorkbenchActivityBar from "nbook/plugins/workbench/web/components/WorkbenchActivityBar.vue";
import WorkbenchMoveViewMenu from "nbook/plugins/workbench/web/components/WorkbenchMoveViewMenu.vue";
import WorkbenchPanelSurface from "nbook/plugins/workbench/web/components/WorkbenchPanelSurface.vue";
import WorkbenchShellLayout from "nbook/plugins/workbench/web/components/WorkbenchShellLayout.vue";
import WorkbenchToolPartHost from "nbook/plugins/workbench/web/components/WorkbenchToolPartHost.vue";
import WorkbenchViewInstances from "nbook/plugins/workbench/web/components/WorkbenchViewInstances.vue";
import type {ViewDeclaration, ViewLocation} from "nbook/plugins/workbench/shared/views";
import type {PanelPosition, PanelState} from "nbook/plugins/workbench/web/shell/panel-state";
import {mergeShellSizePatch, SHELL_SIZE_DEFAULTS} from "nbook/plugins/workbench/web/shell/sizes";
import type {ShellDragCollapseMap, ShellHideablePart, ShellSizePatch} from "nbook/plugins/workbench/web/shell/sizes";
import {TeleportMemory} from "nbook/plugins/workbench/web/shell/teleport-memory";
import type {Customizations} from "nbook/plugins/workbench/web/state/records";
import {applyIntent, applyPatch} from "nbook/plugins/workbench/web/views/intents";
import type {ViewIntent} from "nbook/plugins/workbench/web/views/intents";
import {computePlacement} from "nbook/plugins/workbench/web/views/placement";
import {buildPresentation, moveTargetsOf} from "nbook/plugins/workbench/web/views/presentation";
import type {ContainerPresentation} from "nbook/plugins/workbench/web/views/presentation";
import type {ViewDelivery, ViewSource} from "nbook/plugins/workbench/web/views/registry";

import {useLabSubject} from "../../lab-subject";
import type {LabFixtureProps} from "../../lab-subject";
import LabFixtureControls from "../../LabFixtureControls.vue";
import SampleView, {renderFailures} from "./SampleView.vue";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof WorkbenchShellLayout>(() => props.input, ["resize", "layout"]);

const view = (name: string, location: ViewLocation, icon: string, extra: Partial<ViewDeclaration> = {}): ViewDeclaration => ({title: {"zh-CN": name, "en-US": name}, icon, location, layout: "scroll", ...extra});
const catalog = new Map<string, ViewDeclaration>([
    ["test.files", view("资源管理器", "sidebar", "i-lucide-files", {layout: "fill"})],
    ["test.outline", view("大纲", "sidebar", "i-lucide-list-tree", {order: 1})],
    ["test.timeline", view("时间线", "sidebar", "i-lucide-clock", {order: 2})],
    ["test.notes", view("笔记", "auxiliarybar", "i-lucide-notebook-pen")],
    ["test.terminal", view("终端", "panel", "i-lucide-terminal")],
]);

/** 场景预设：merged 把大纲并进资源管理器的容器，看 multiple 与容器网格。 */
function preset(): Customizations {
    if (props.scene !== "views-merged") return {};
    const placement = computePlacement(catalog, {});
    const presentation = buildPresentation({catalog, placement, customizations: {}});
    const result = applyIntent({catalog, placement, presentation, customizations: {}}, {kind: "move-view", viewId: "test.outline", sourceContainerId: "view:test.outline", targetContainerId: "view:test.files"});
    return result.kind === "patch" ? applyPatch({}, result.patch) : {};
}

// shallowRef：记录值是普通对象（意图合成用 structuredClone 复制它，代理对象复制不了）。
const customizations = shallowRef<Customizations>(preset());
const placement = computed(() => computePlacement(catalog, customizations.value));
const presentation = computed(() => buildPresentation({catalog, placement: placement.value, customizations: customizations.value}));

function apply(intent: ViewIntent): void {
    const result = applyIntent({catalog, placement: placement.value, presentation: presentation.value, customizations: customizations.value}, intent);
    if (result.kind === "patch") customizations.value = applyPatch(customizations.value, result.patch);
}

// ── 视图来源：交付状态与加载都按场景开关 ────────────────────────────────

const AVAILABLE: ViewDelivery = {kind: "available"};
const deliveries = reactive(new Map<string, ViewDelivery>());
const loadFailures = reactive(new Set<string>());
const source: ViewSource = {
    delivery: (viewId) => deliveries.get(viewId) ?? AVAILABLE,
    load: async (viewId) => (loadFailures.has(viewId) ? {status: "failed", error: new Error("样例：组件模块加载失败")} : {status: "loaded", component: SampleView}),
    retry: async (viewId) => {
        deliveries.delete(viewId);
        return {status: "activated"};
    },
};

function toggleDelivery(viewId: string, delivery: ViewDelivery): void {
    if (deliveries.get(viewId)?.kind === delivery.kind) deliveries.delete(viewId);
    else deliveries.set(viewId, delivery);
}

function toggle(set: Set<string>, viewId: string): void {
    if (set.has(viewId)) set.delete(viewId);
    else set.add(viewId);
}
const renderFailing = reactive(renderFailures);

// ── 外壳状态 ────────────────────────────────────────────────────────────────

const PANEL: PanelState = {position: "bottom", alignment: "center", hidden: false, collapsed: false, maximized: false};
const sizes = computed({get: () => subject.bindings.value.sizes ?? SHELL_SIZE_DEFAULTS, set: (value) => subject.write("props", "sizes", value)});
const panel = computed<PanelState>({get: () => subject.bindings.value.panel ?? PANEL, set: (value) => subject.write("props", "panel", value)});
const hiddenParts = computed<ReadonlyArray<ShellHideablePart>>({get: () => subject.bindings.value.hiddenParts ?? [], set: (value) => subject.write("props", "hiddenParts", value)});
const dragCollapsed = computed<ShellDragCollapseMap>({get: () => subject.bindings.value.dragCollapsedParts ?? {}, set: (value) => subject.write("props", "dragCollapsedParts", value)});
const memory = new TeleportMemory();
const hostEl = ref<HTMLElement | null>(null);
const partTargets = reactive<Partial<Record<ViewLocation, HTMLElement>>>({});

function onResize(payload: {contextKey: string; patch: ShellSizePatch}): void {
    sizes.value = mergeShellSizePatch(sizes.value, payload.patch);
    if (payload.patch.dragCollapsed !== undefined) dragCollapsed.value = {...dragCollapsed.value, ...payload.patch.dragCollapsed};
}

function setTarget(part: ViewLocation, element: HTMLElement | null): void {
    if (element === null) delete partTargets[part];
    else partTargets[part] = element;
}

const sidebarVisible = computed(() => !hiddenParts.value.includes("sidebar") && dragCollapsed.value.sidebar !== true);
const shownParts = computed<ViewLocation[]>(() => [
    ...(sidebarVisible.value ? ["sidebar" as const] : []),
    ...(!hiddenParts.value.includes("auxiliarybar") && dragCollapsed.value.auxiliarybar !== true ? ["auxiliarybar" as const] : []),
    ...(!panel.value.hidden && !panel.value.collapsed && dragCollapsed.value.panel !== true ? ["panel" as const] : []),
]);

function selectedOf(part: ViewLocation): ContainerPresentation | null {
    const id = presentation.value.parts[part].selected;
    return id === null ? null : (presentation.value.containers.get(id) ?? null);
}

function selectSidebar(containerId: string): void {
    apply({kind: "select-container", part: "sidebar", containerId});
    hiddenParts.value = hiddenParts.value.filter((part) => part !== "sidebar");
    if (dragCollapsed.value.sidebar === true) dragCollapsed.value = {...dragCollapsed.value, sidebar: false};
}

function togglePart(part: ShellHideablePart): void {
    hiddenParts.value = hiddenParts.value.includes(part) ? hiddenParts.value.filter((name) => name !== part) : [...hiddenParts.value, part];
}

const PART_LABELS: Readonly<Record<ViewLocation, string>> = {sidebar: "侧栏", auxiliarybar: "右栏", panel: "面板"};

function menuOf(viewId: string) {
    const targets = moveTargetsOf(presentation.value, placement.value, catalog, viewId);
    if (targets === null) return null;
    const container = presentation.value.containers.get(targets.sourceContainerId);
    return {
        groups: targets.groups.map((group) => ({label: PART_LABELS[group.part], targets: group.targets.map((target) => ({id: target.containerId, label: target.title["zh-CN"], icon: target.icon}))})),
        source: targets.sourceContainerId,
        resetLabel: targets.canReset ? "重置位置" : null,
        identity: `${viewId}|${targets.sourceContainerId}|${container?.mode ?? ""}|${source.delivery(viewId).kind}`,
    };
}

const singleViewOf = (container: ContainerPresentation | null): string | null => (container?.mode === "single" ? (container.views[0]?.id ?? null) : null);

const activityContainers = computed(() => presentation.value.parts.sidebar.switcher.map((item) => ({id: item.containerId, label: item.title["zh-CN"], icon: item.icon})));
const panelTabs = computed(() => presentation.value.parts.panel.switcher.map((item) => ({value: item.containerId, label: item.title["zh-CN"], iconClass: item.icon})));

const positions = [{value: "bottom", label: "底部"}, {value: "left", label: "左侧"}, {value: "right", label: "右侧"}];
const position = computed({get: () => panel.value.position, set: (value: string | number | boolean) => {
    panel.value = {...panel.value, position: value as PanelPosition, maximized: false};
}});
</script>

<template>
    <div ref="hostEl" class="h-full w-full bg-[var(--bg-panel)] outline-none" tabindex="-1" data-lab-subject data-views-scene>
        <WorkbenchShellLayout
            class="h-full w-full"
            :sizes="sizes"
            :panel="panel"
            :context-key="subject.bindings.value.contextKey ?? `lab:${props.scene}`"
            :hidden-parts="hiddenParts"
            :drag-collapsed-parts="dragCollapsed"
            :memory="memory"
            @resize="onResize"
        >
            <template #titlebar>
                <div class="flex h-full items-center px-3 text-xs text-[var(--text-secondary)]">NeuroBook · 视图场景</div>
            </template>
            <template #activitybar>
                <WorkbenchActivityBar label="活动栏" :containers="activityContainers" :selected="presentation.parts.sidebar.selected" :sidebar-visible="sidebarVisible" @select="selectSidebar" />
            </template>
            <template v-for="part in (['sidebar', 'auxiliarybar'] as const)" :key="part" #[part]>
                <WorkbenchToolPartHost :part="part" :presentation="presentation.parts[part]" :selected="selectedOf(part)" locale="zh-CN" :label="PART_LABELS[part]" empty-text="这里还没有视图" @select="(id) => apply({kind: 'select-container', part, containerId: id})" @target="(element) => setTarget(part, element)">
                    <template #actions="{container}">
                        <WorkbenchMoveViewMenu v-if="singleViewOf(container) !== null && menuOf(singleViewOf(container)!) !== null" label="移动到" :view-id="singleViewOf(container)!" :source-container-id="menuOf(singleViewOf(container)!)!.source" :groups="menuOf(singleViewOf(container)!)!.groups" :reset-label="menuOf(singleViewOf(container)!)!.resetLabel" :identity="menuOf(singleViewOf(container)!)!.identity" @move="(payload) => apply({kind: 'move-view', ...payload})" @reset="(viewId) => apply({kind: 'reset-view', viewId})" />
                    </template>
                </WorkbenchToolPartHost>
            </template>
            <template #editor>
                <div class="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">编辑器</div>
            </template>
            <template #panel="{collapsed}">
                <WorkbenchPanelSurface title="面板" :collapsed="collapsed" :actions="[{id: 'collapse', label: '收起', icon: 'i-lucide-chevrons-down', disabled: false, pressed: panel.collapsed}]" @action="panel = {...panel, collapsed: !panel.collapsed}">
                    <template v-if="panelTabs.length > 0" #nav>
                        <Tabs class="min-w-0 flex-1" size="sm" :model-value="presentation.parts.panel.selected ?? ''" :items="panelTabs" aria-label="面板" @update:model-value="(id: string) => apply({kind: 'select-container', part: 'panel', containerId: id})" />
                        <WorkbenchMoveViewMenu v-if="singleViewOf(selectedOf('panel')) !== null && menuOf(singleViewOf(selectedOf('panel'))!) !== null" label="移动到" :view-id="singleViewOf(selectedOf('panel'))!" :source-container-id="menuOf(singleViewOf(selectedOf('panel'))!)!.source" :groups="menuOf(singleViewOf(selectedOf('panel'))!)!.groups" :reset-label="menuOf(singleViewOf(selectedOf('panel'))!)!.resetLabel" :identity="menuOf(singleViewOf(selectedOf('panel'))!)!.identity" @move="(payload) => apply({kind: 'move-view', ...payload})" @reset="(viewId) => apply({kind: 'reset-view', viewId})" />
                    </template>
                    <WorkbenchToolPartHost part="panel" :presentation="presentation.parts.panel" :selected="selectedOf('panel')" locale="zh-CN" label="面板" empty-text="这里还没有视图" @select="(id) => apply({kind: 'select-container', part: 'panel', containerId: id})" @target="(element) => setTarget('panel', element)" />
                </WorkbenchPanelSurface>
            </template>
            <template #statusbar>
                <div class="flex h-full items-center px-3 text-xs text-[var(--text-secondary)]">状态栏</div>
            </template>
        </WorkbenchShellLayout>
        <WorkbenchViewInstances :presentation="presentation" :source="source" :part-targets="partTargets" :shown-parts="shownParts" :memory="memory" :root="hostEl" locale="zh-CN" @intent="apply">
            <template #view-actions="{viewId}">
                <WorkbenchMoveViewMenu v-if="menuOf(viewId) !== null" label="移动到" :view-id="viewId" :source-container-id="menuOf(viewId)!.source" :groups="menuOf(viewId)!.groups" :reset-label="menuOf(viewId)!.resetLabel" :identity="menuOf(viewId)!.identity" @move="(payload) => apply({kind: 'move-view', ...payload})" @reset="(id) => apply({kind: 'reset-view', viewId: id})" />
            </template>
            <template #empty>
                <div class="p-3 text-xs text-[var(--text-muted)]">容器里的视图都已隐藏</div>
            </template>
        </WorkbenchViewInstances>
    </div>

    <LabFixtureControls>
        <div class="flex flex-wrap items-center gap-2 text-xs">
            <Button size="sm" variant="secondary" data-lab-toggle="load-failure" @click="toggle(loadFailures, 'test.timeline')">{{ loadFailures.has("test.timeline") ? "时间线：恢复加载" : "时间线：加载失败" }}</Button>
            <Button size="sm" variant="secondary" data-lab-toggle="render-failure" @click="toggle(renderFailing, 'test.notes')">{{ renderFailing.has("test.notes") ? "笔记：恢复渲染" : "笔记：渲染出错" }}</Button>
            <Button size="sm" variant="secondary" data-lab-toggle="entry-stopped" @click="toggleDelivery('test.terminal', {kind: 'entry-stopped', reason: 'scope-closed'})">终端：入口停止/恢复</Button>
            <Button size="sm" variant="secondary" data-lab-toggle="entry-failed" @click="toggleDelivery('test.terminal', {kind: 'entry-failed', reason: '样例入口启动失败'})">终端：入口启动失败</Button>
            <Button size="sm" variant="secondary" @click="togglePart('sidebar')">{{ hiddenParts.includes("sidebar") ? "显示侧栏" : "隐藏侧栏" }}</Button>
            <span class="text-[var(--text-secondary)]">面板位置</span>
            <SegmentedControl v-model="position" :options="positions" size="xs" aria-label="面板位置" />
            <Button size="sm" variant="secondary" @click="panel = {...panel, hidden: !panel.hidden}">{{ panel.hidden ? "显示面板" : "隐藏面板" }}</Button>
        </div>
    </LabFixtureControls>
</template>
