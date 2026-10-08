<script setup lang="ts">
/**
 * WorkbenchShellLayout 的 Lab 场景（docs/specs/ui/workbench-shell.md 外壳一）：真实的网格、边界与手势，Part 里是样例
 * 内容，状态只在 Lab 的场景输入里（不连产品的布局 store 与 Storage）。拖动边界、面板位置与对齐、隐藏、收起、最大化
 * 与 Part 显隐都改写场景输入，数据面板里看得到；缩小画布到 800 以下进入紧凑呈现。最大化的清除与产品 store 同一规则：
 * 位置、对齐、隐藏、收起变化，或呈现事实已不再最大化时清掉。
 *
 * 编辑器槽放的样例内容带实例编号与累计创建、卸载次数：在同一个场景里连续操作，这三个数不变就说明没有重挂。
 */
import {Button, SegmentedControl} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import WorkbenchShellLayout from "nbook/plugins/workbench/web/components/WorkbenchShellLayout.vue";
import type {PanelAlignment, PanelPosition, PanelState} from "nbook/plugins/workbench/web/shell/panel-state";
import {mergeShellSizePatch, SHELL_HIDDEN_PART_IDS, SHELL_SIZE_DEFAULTS} from "nbook/plugins/workbench/web/shell/sizes";
import type {ShellDragCollapseMap, ShellHideablePart, ShellLayoutFacts, ShellSizePatch, ShellSizePreferences} from "nbook/plugins/workbench/web/shell/sizes";

import {useLabSubject} from "../lab-subject";
import type {LabFixtureProps} from "../lab-subject";
import LabFixtureControls from "../LabFixtureControls.vue";
import ShellSampleEditor from "./shell-scene/ShellSampleEditor.vue";
import ShellViewsScene from "./shell-scene/ShellViewsScene.vue";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof WorkbenchShellLayout>(() => props.input, ["resize", "layout"]);

const PANEL: PanelState = {position: "bottom", alignment: "center", hidden: false, collapsed: false, maximized: false};
const sizes = computed<ShellSizePreferences>(() => subject.bindings.value.sizes ?? SHELL_SIZE_DEFAULTS);
const panel = computed<PanelState>(() => subject.bindings.value.panel ?? PANEL);
const hiddenParts = computed<ReadonlyArray<ShellHideablePart>>(() => subject.bindings.value.hiddenParts ?? []);
const dragCollapsed = computed<ShellDragCollapseMap>(() => subject.bindings.value.dragCollapsedParts ?? {});

function setPanel(patch: Partial<PanelState>): void {
    // 位置、对齐、隐藏、收起任一变化都清掉瞬时最大化（与产品的布局 store 一致）。
    const clears = Object.keys(patch).some((name) => name !== "maximized");
    subject.write("props", "panel", {...panel.value, ...(clears ? {maximized: false} : {}), ...patch});
}

function onResize(payload: {contextKey: string; patch: ShellSizePatch}): void {
    subject.write("props", "sizes", mergeShellSizePatch(sizes.value, payload.patch));
    if (payload.patch.dragCollapsed !== undefined) subject.write("props", "dragCollapsedParts", {...dragCollapsed.value, ...payload.patch.dragCollapsed});
}

function onLayout(facts: ShellLayoutFacts): void {
    if (panel.value.maximized && !facts.effectivePanel.maximized) subject.write("props", "panel", {...panel.value, maximized: false});
}

function togglePart(part: ShellHideablePart): void {
    const others = hiddenParts.value.filter((name) => name !== part);
    subject.write("props", "hiddenParts", hiddenParts.value.includes(part) ? others : [...others, part]);
}

const positions = [{value: "bottom", label: "底部"}, {value: "top", label: "顶部"}, {value: "left", label: "左侧"}, {value: "right", label: "右侧"}];
const alignments = [{value: "center", label: "居中"}, {value: "left", label: "靠左"}, {value: "right", label: "靠右"}, {value: "justify", label: "两端"}];
const PART_LABELS: Readonly<Record<ShellHideablePart, string>> = {titlebar: "标题栏", activitybar: "ActivityBar", sidebar: "侧栏", auxiliarybar: "右栏"};
const position = computed({get: () => panel.value.position, set: (value: string | number | boolean) => setPanel({position: value as PanelPosition})});
const alignment = computed({get: () => panel.value.alignment, set: (value: string | number | boolean) => setPanel({alignment: value as PanelAlignment})});
</script>

<template>
    <ShellViewsScene v-if="props.scene.startsWith('views')" :scene="props.scene" :input="props.input" />
    <template v-else>
    <WorkbenchShellLayout
        data-lab-subject
        class="h-full w-full bg-[var(--bg-panel)]"
        :sizes="sizes"
        :panel="panel"
        :context-key="subject.bindings.value.contextKey ?? `lab:${props.scene}`"
        :hidden-parts="hiddenParts"
        :drag-collapsed-parts="dragCollapsed"
        :disabled="subject.bindings.value.disabled ?? false"
        @resize="onResize"
        @layout="onLayout"
    >
        <template #titlebar>
            <div class="flex h-full items-center px-3 text-xs text-[var(--text-secondary)]">NeuroBook · 外壳场景</div>
        </template>
        <template #activitybar>
            <div class="h-full rounded-[var(--radius-md,8px)] border-[length:var(--border-w)] border-[color:var(--divider)] bg-[var(--panel-surface)]"></div>
        </template>
        <template #sidebar>
            <div class="h-full rounded-[var(--radius-md,8px)] border-[length:var(--border-w)] border-[color:var(--divider)] bg-[var(--panel-surface)] p-3 text-sm text-[var(--text-muted)]">侧栏</div>
        </template>
        <template #auxiliarybar>
            <div class="h-full rounded-[var(--radius-md,8px)] border-[length:var(--border-w)] border-[color:var(--divider)] bg-[var(--panel-surface)] p-3 text-sm text-[var(--text-muted)]">右栏</div>
        </template>
        <template #editor>
            <ShellSampleEditor />
        </template>
        <template #panel="{collapsed}">
            <div class="flex h-full min-h-0 flex-col border-t-[length:var(--border-w)] border-[color:var(--divider)]">
                <div class="flex h-8 flex-none items-center gap-2 px-3 text-xs">
                    <Button size="sm" variant="ghost" data-shell-focus-target="panel-title" @click="setPanel({collapsed: !panel.collapsed})">面板</Button>
                    <span class="text-[var(--text-muted)]">{{ collapsed ? "已收起" : "" }}</span>
                </div>
                <div v-if="!collapsed" class="min-h-0 flex-1 overflow-auto px-3 text-sm text-[var(--text-muted)]">面板内容</div>
            </div>
        </template>
        <template #statusbar>
            <div class="flex h-full items-center justify-between px-3 text-xs text-[var(--text-secondary)]">
                <span>状态栏</span>
                <Button size="sm" variant="ghost" data-shell-focus-target="panel-toggle" @click="setPanel(panel.hidden ? {hidden: false, collapsed: false} : {hidden: true})">{{ panel.hidden ? "显示面板" : "隐藏面板" }}</Button>
            </div>
        </template>
    </WorkbenchShellLayout>

    <LabFixtureControls>
        <div class="flex flex-wrap items-center gap-2 text-xs">
            <span class="text-[var(--text-secondary)]">面板位置</span>
            <SegmentedControl v-model="position" :options="positions" size="xs" aria-label="面板位置" />
            <span class="text-[var(--text-secondary)]">对齐</span>
            <SegmentedControl v-model="alignment" :options="alignments" size="xs" aria-label="面板对齐" />
            <Button size="sm" variant="secondary" @click="setPanel({collapsed: !panel.collapsed})">{{ panel.collapsed ? "展开" : "收起" }}</Button>
            <Button size="sm" variant="secondary" @click="setPanel({maximized: !panel.maximized})">{{ panel.maximized ? "还原" : "最大化" }}</Button>
            <Button size="sm" variant="secondary" @click="setPanel(panel.hidden ? {hidden: false, collapsed: false} : {hidden: true})">{{ panel.hidden ? "显示面板" : "隐藏面板" }}</Button>
            <span class="text-[var(--text-secondary)]">Part</span>
            <Button v-for="part in SHELL_HIDDEN_PART_IDS" :key="part" size="sm" variant="secondary" @click="togglePart(part)">{{ hiddenParts.includes(part) ? "显示" : "隐藏" }}{{ PART_LABELS[part] }}</Button>
        </div>
    </LabFixtureControls>
    </template>
</template>
