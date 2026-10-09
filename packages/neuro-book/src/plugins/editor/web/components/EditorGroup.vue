<script setup lang="ts">
/** 一个编辑组（同名 .md）：标签条、状态条、进度条与控件。 */
import {Button} from "@notnotype/nb-ui/components";
import {computed} from "vue";
import type {Component} from "vue";

import type {DisplayLocale} from "nbook/shared/localized-text";

import type {EditorArea, EditorControlHandle} from "../area";
import type {EditorKind} from "../groups/groups";
import {editorText, nameOf} from "../messages";
import EditorTabBar from "./EditorTabBar.vue";
import type {TabItem} from "./EditorTabBar.vue";

const props = defineProps<{area: EditorArea; groupId: string; locale: DisplayLocale; control: (kind: EditorKind) => Component}>();

const group = computed(() => props.area.groups.groups.value.find((candidate) => candidate.id === props.groupId) ?? null);
const activeTab = computed(() => group.value?.tabs.find((tab) => tab.id === group.value?.active) ?? null);
const document = computed(() => props.area.documentOf(props.groupId));
const binding = computed(() => props.area.binding(props.groupId));
const active = computed(() => props.area.groups.activeGroup.value === props.groupId);

const tabs = computed((): TabItem[] => (group.value?.tabs ?? []).map((tab) => {
    const opened = props.area.documents.get(tab.address);
    return {id: tab.id, label: nameOf(tab.address), title: tab.address, preview: tab.preview, dirty: opened?.dirty.value === true, active: tab.id === group.value?.active};
}));

type Banner = {readonly tone: "danger" | "warning" | "info"; readonly text: string; readonly actions: ReadonlyArray<{readonly id: string; readonly label: string; readonly run: () => void}>};

const banner = computed((): Banner | null => {
    const current = document.value;
    if (current === null) return null;
    const t = (key: Parameters<typeof editorText>[1], values?: Readonly<Record<string, string>>): string => editorText(props.locale, key, values);
    if (binding.value?.unresolved() === true) {
        return {tone: "warning", text: t("unresolved"), actions: [
            {id: "adopt", label: t("adopt"), run: () => props.area.resolve(props.groupId, "adopt-current")},
            {id: "keep", label: t("keep"), run: () => props.area.resolve(props.groupId, "keep-view")},
        ]};
    }
    if (current.conflict.value !== null) {
        return {tone: "danger", text: t("conflict"), actions: [
            {id: "reload", label: t("reload"), run: () => void props.area.revert()},
            {id: "overwrite", label: t("overwrite"), run: () => void props.area.overwrite()},
        ]};
    }
    if (current.ended.value !== null) return {tone: "danger", text: t("ended", {reason: current.ended.value}), actions: []};
    if (current.status.value === "deleted") return {tone: "warning", text: current.dirty.value ? t("deleted") : t("deletedClean"), actions: []};
    if (current.diskChanged.value) return {tone: "warning", text: t("diskChanged"), actions: [{id: "reload", label: t("reload"), run: () => void props.area.revert()}]};
    const problem = current.saveProblem.value;
    if (problem !== null) return {tone: "danger", text: problem.code === "unknown-outcome" ? t("saveUnknown") : t("saveFailed", {reason: problem.detail || problem.code}), actions: []};
    return null;
});

const failure = computed(() => {
    const current = document.value;
    if (current === null || current.status.value !== "failed") return null;
    return editorText(props.locale, "openFailed", {name: nameOf(current.target.value.path), reason: current.failure.value?.code ?? ""});
});

const onReady = (kind: EditorKind, handle: EditorControlHandle | null): void => props.area.registerHandle(props.groupId, kind, handle);

// 控件按编辑器种类各挂一个：换文档只换绑定，不重建控件；同组另一种控件停放（不卸载、不可见）。
const kinds = computed((): EditorKind[] => {
    const present = new Set<EditorKind>((group.value?.tabs ?? []).map((tab) => tab.editor));
    return (["markdown", "code"] as const).filter((kind) => present.has(kind));
});
</script>

<template>
    <section
        class="flex h-full min-h-0 w-full min-w-0 flex-col bg-[var(--bg-main)]"
        :class="active ? '' : 'opacity-[0.98]'"
        :aria-label="editorText(locale, 'areaLabel')"
        :data-editor-group="groupId"
        :data-editor-group-active="active ? '' : undefined"
        @focusin="area.focusGroup(groupId)"
        @pointerdown="area.focusGroup(groupId)"
    >
        <EditorTabBar
            :tabs="tabs"
            :label="editorText(locale, 'tabsLabel')"
            :close-label="(name: string) => editorText(locale, 'closeTab', {name})"
            :unsaved-label="editorText(locale, 'unsaved')"
            @activate="(id: string) => area.activate(id)"
            @pin="(id: string) => area.pin(id)"
            @close="(id: string) => void area.close(id)"
            @move="(id: string, delta: -1 | 1) => area.groups.move(id, delta)"
        />
        <div class="relative h-0.5 shrink-0 overflow-hidden" aria-hidden="true">
            <div v-if="area.progress(groupId)" class="editor-group__progress absolute inset-y-0 w-1/3 bg-[var(--accent-main)]" data-editor-progress></div>
        </div>
        <!-- 进度条本身只是装饰：同一时刻给读屏一句可播报的“正在读取”。 -->
        <p v-if="area.progress(groupId)" class="sr-only" role="status">{{ editorText(locale, "loading") }}</p>
        <div
            v-if="banner !== null"
            class="flex shrink-0 flex-wrap items-center gap-2 border-b border-[color:var(--divider)] px-3 py-1.5 text-xs"
            :class="banner.tone === 'danger' ? 'text-[var(--status-danger)]' : banner.tone === 'warning' ? 'text-[var(--status-warning)]' : 'text-[var(--text-secondary)]'"
            role="status"
            data-editor-banner
        >
            <span class="min-w-0 flex-1">{{ banner.text }}</span>
            <Button v-for="action in banner.actions" :key="action.id" size="sm" variant="secondary" :data-editor-banner-action="action.id" @click="action.run()">{{ action.label }}</Button>
        </div>
        <div class="relative min-h-0 flex-1" :aria-busy="area.progress(groupId) ? 'true' : undefined" data-editor-content>
            <p v-if="activeTab === null" class="p-6 text-sm text-[var(--text-muted)]" data-editor-empty>{{ editorText(locale, "empty") }}</p>
            <div v-else-if="failure !== null" class="flex flex-col items-start gap-2 p-6 text-sm" role="alert" data-editor-failure>
                <p>{{ failure }}</p>
                <Button size="sm" variant="secondary" @click="document !== null && area.documents.retry(document)">{{ editorText(locale, "retry") }}</Button>
            </div>
            <template v-for="kind in kinds" :key="kind">
                <div v-show="binding !== null && binding.kind === kind" class="absolute inset-0" :data-editor-kind="kind">
                    <component
                        :is="control(kind)"
                        :binding="binding !== null && binding.kind === kind ? binding : null"
                        :host="area.controlSlot(groupId, kind)"
                        :readonly="document?.writable.value !== true"
                        :visible="binding !== null && binding.kind === kind"
                        :label="activeTab === null ? '' : nameOf(activeTab.address)"
                        @ready="(handle: EditorControlHandle | null) => onReady(kind, handle)"
                        @focus="(focused: boolean) => (area.focused.value = focused)"
                    />
                </div>
            </template>
        </div>
    </section>
</template>

<style scoped>
.editor-group__progress {
    animation: editor-group-progress 1.2s var(--ease-standard) infinite;
}

@keyframes editor-group-progress {
    from {
        left: -33%;
    }

    to {
        left: 100%;
    }
}

@media (prefers-reduced-motion: reduce) {
    .editor-group__progress {
        animation: none;
        left: 0;
        width: 100%;
        opacity: 0.6;
    }
}
</style>
