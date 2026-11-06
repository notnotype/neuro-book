<script setup lang="ts">
/**
 * 主题编辑器（同名 .md，docs/specs/theme/editor.md）：我的主题库的选择与增删，左边分区导航，右边一次一个分区。页签与浮动窗口放的
 * 是同一个主体；所有修改交给模型，这里只呈现与转发。
 */
import {computed, ref} from "vue";

import {Button, EmptyState, Input, ScrollArea, SegmentedControl, Select} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";

import {useWorkbenchText} from "../text";
import type {ThemeEntry} from "../themes";
import ThemeEditorChrome from "./ThemeEditorChrome.vue";
import ThemeEditorScene from "./ThemeEditorScene.vue";
import ThemeEditorColors from "./ThemeEditorColors.vue";
import ThemeEditorTypography from "./ThemeEditorTypography.vue";
import {ThemeEditorModel} from "./theme-editor-model";
import type {EditorSection} from "./theme-editor-model";

defineOptions({name: "ThemeEditor"});

const props = defineProps<{
    model: ThemeEditorModel;
    /** 主题目录里的全部主题，“复制自…”从这里选。 */
    themes: ReadonlyArray<ThemeEntry>;
    /** 画“关闭”按钮（浮动窗口里）；页签里不画。缺省画。 */
    closable?: boolean;
}>();

const emit = defineEmits<{(event: "close"): void}>();

const text = useWorkbenchText();
const resolver = useText();
const model = props.model;

const SECTIONS: ReadonlyArray<EditorSection> = ["basic", "colors", "fonts", "chrome", "scene", "contrast"];

const titleOf = (title: ThemeEntry["declaration"]["title"]): string => resolver.t(title);
const options = computed(() => model.mine.value.map((theme) => ({label: titleOf(theme.declaration.title), value: theme.id})));
const copyOptions = computed(() => props.themes.map((entry) => ({label: titleOf(entry.declaration.title), value: entry.id})));
const copyFrom = ref("");

const appearanceOptions = computed(() => [
    {value: "light", label: text("themeEditor.appearance.light"), iconClass: "i-lucide-sun"},
    {value: "dark", label: text("themeEditor.appearance.dark"), iconClass: "i-lucide-moon"},
]);

const titleValue = (language: "zh-CN" | "en-US"): string => {
    const title = model.current.value?.declaration.title;
    return typeof title === "object" && title !== null && language in title ? String((title as Record<string, string>)[language]) : "";
};

/** 删除要点两次：第一次变成“确认删除”，换了主题或点别处就回去。 */
const confirming = ref(false);
const remove = async (): Promise<void> => {
    if (!confirming.value) {
        confirming.value = true;
        return;
    }
    confirming.value = false;
    await model.remove();
};

const createFrom = async (id: string): Promise<void> => {
    const entry = props.themes.find((candidate) => candidate.id === id);
    copyFrom.value = "";
    await model.create(entry ?? null);
};

const lightName = computed(() => text("themeEditor.appearance.light"));
const darkName = computed(() => text("themeEditor.appearance.dark"));
const appearanceName = (appearance: "light" | "dark"): string => (appearance === "light" ? lightName.value : darkName.value);
</script>

<template>
    <div class="theme-editor" data-theme-editor>
        <header class="theme-editor__bar">
            <div v-if="model.mine.value.length > 0" class="theme-editor__picker">
                <Select
                    size="sm"
                    :model-value="model.selectedId.value ?? ''"
                    :options="options"
                    :aria-label="text('themeEditor.library.label')"
                    @update:model-value="model.select($event)"
                />
            </div>
            <Button size="sm" variant="secondary" icon-class="i-lucide-plus" data-new @click="model.create()">{{ text("themeEditor.library.new") }}</Button>
            <Button size="sm" variant="secondary" icon-class="i-lucide-copy" :disabled="model.current.value === null" data-duplicate @click="model.duplicate()">{{ text("themeEditor.library.duplicate") }}</Button>
            <Button size="sm" :variant="confirming ? 'danger' : 'ghost'" icon-class="i-lucide-trash-2" :disabled="model.current.value === null" data-delete @click="remove" @blur="confirming = false">
                {{ confirming ? text("themeEditor.library.deleteConfirm") : text("themeEditor.library.delete") }}
            </Button>
            <span class="theme-editor__spacer" />
            <SegmentedControl
                size="sm"
                :model-value="model.appearance.value"
                :options="appearanceOptions"
                :aria-label="text('themeEditor.appearance.label')"
                data-appearance
                @update:model-value="model.appearance.value = $event as 'light' | 'dark'"
            />
            <Button v-if="closable !== false" size="sm" variant="ghost" icon-class="i-lucide-x" data-close @click="emit('close')">{{ text("themeEditor.close") }}</Button>
        </header>

        <p v-if="model.failure.value !== null" class="theme-editor__error" role="alert" data-library-failed>{{ text("themeEditor.library.failed", {reason: model.failure.value}) }}</p>

        <div v-if="!model.ready.value" class="theme-editor__state" role="status" aria-busy="true">{{ text("themeEditor.library.loading") }}</div>

        <EmptyState v-else-if="model.current.value === null" class="theme-editor__empty" icon-class="i-lucide-palette" :title="text('themeEditor.empty.title')" :description="text('themeEditor.empty.hint')" data-empty>
            <div class="theme-editor__empty-actions">
                <Button size="sm" data-new-empty @click="model.create()">{{ text("themeEditor.library.new") }}</Button>
                <Select
                    size="sm"
                    :model-value="copyFrom"
                    :options="copyOptions"
                    :placeholder="text('themeEditor.library.copyFrom')"
                    :aria-label="text('themeEditor.library.copyFrom')"
                    @update:model-value="createFrom($event)"
                />
            </div>
        </EmptyState>

        <div v-else class="theme-editor__body">
            <nav class="theme-editor__nav" :aria-label="text('themeEditor.sections.label')">
                <button
                    v-for="section in SECTIONS"
                    :key="section"
                    type="button"
                    class="theme-editor__nav-item"
                    :data-section-tab="section"
                    :aria-current="model.section.value === section ? 'page' : undefined"
                    @click="model.section.value = section"
                >
                    <span>{{ text(`themeEditor.sections.${section}` as "themeEditor.sections.basic") }}</span>
                    <span v-if="section === 'contrast' && model.failures.value.length > 0" class="theme-editor__badge" data-contrast-count>{{ model.failures.value.length }}</span>
                </button>
            </nav>

            <ScrollArea class="theme-editor__panel">
                <div class="theme-editor__section">
                    <div v-if="model.section.value === 'basic'" class="theme-editor__basic" data-section="basic">
                        <label class="theme-editor__field">
                            <span>{{ text("themeEditor.basic.titleZh") }}</span>
                            <Input :model-value="titleValue('zh-CN')" @update:model-value="model.setTitle('zh-CN', $event)" />
                        </label>
                        <label class="theme-editor__field">
                            <span>{{ text("themeEditor.basic.titleEn") }}</span>
                            <Input :model-value="titleValue('en-US')" @update:model-value="model.setTitle('en-US', $event)" />
                        </label>
                        <div class="theme-editor__field">
                            <span>{{ text("themeEditor.basic.base") }}</span>
                            <SegmentedControl
                                size="sm"
                                :model-value="model.current.value.declaration.base"
                                :options="[{value: 'nbook', label: text('themeEditor.basic.baseNbook')}, {value: 'macos', label: text('themeEditor.basic.baseMacos')}]"
                                :aria-label="text('themeEditor.basic.base')"
                                data-base
                                @update:model-value="model.setBase($event as 'nbook' | 'macos')"
                            />
                            <p class="theme-editor__hint">{{ text("themeEditor.basic.baseHint") }}</p>
                        </div>
                    </div>
                    <ThemeEditorColors v-else-if="model.section.value === 'colors'" :model="model" />
                    <ThemeEditorTypography v-else-if="model.section.value === 'fonts'" :model="model" />
                    <ThemeEditorChrome v-else-if="model.section.value === 'chrome'" :model="model" />
                    <ThemeEditorScene v-else-if="model.section.value === 'scene'" :model="model" />
                    <div v-else class="theme-editor__contrast" data-section="contrast">
                        <p class="theme-editor__hint">{{ text("themeEditor.contrast.legend") }}</p>
                        <h3 class="theme-editor__heading">{{ text("themeEditor.contrast.summary") }}</h3>
                        <p v-if="model.failures.value.length === 0" class="theme-editor__ok" data-contrast-none>{{ text("themeEditor.contrast.none") }}</p>
                        <ul v-else class="theme-editor__failures">
                            <li v-for="item in model.failures.value" :key="`${item.appearance}:${item.check.key}`" data-contrast-failure>
                                <span class="theme-editor__failure-appearance">{{ appearanceName(item.appearance) }}</span>
                                <code>{{ item.check.key }}</code>
                                <span class="theme-editor__failure-ratio">{{ item.check.ratio?.toFixed(2) }}</span>
                                <span class="theme-editor__hint">{{ text("themeEditor.contrast.against", {surface: item.check.against ?? ""}) }}</span>
                            </li>
                        </ul>
                    </div>
                </div>
            </ScrollArea>
        </div>
    </div>
</template>

<style scoped>
/* 编辑面板始终用实心面：被预览的主题可能把浮层面做成半透明，那样改色时看不清自己在改什么（docs/specs/theme/editor.md 输出 18）。 */
.theme-editor {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    background: var(--bg-panel);
    color: var(--text-main);
}

.theme-editor__bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-6);
    border-bottom: var(--border-w) solid var(--border-color);
}

.theme-editor__picker {
    flex: 0 1 240px;
    min-width: 160px;
}

.theme-editor__spacer {
    flex: 1;
}

.theme-editor__error {
    margin: 0;
    padding: var(--space-3) var(--space-6);
    color: var(--status-danger);
    font-size: var(--text-xs);
}

.theme-editor__state,
.theme-editor__empty {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: var(--text-sm);
}

.theme-editor__empty-actions {
    display: flex;
    gap: var(--space-3);
    margin-top: var(--space-4);
}

.theme-editor__body {
    display: grid;
    grid-template-columns: 180px minmax(0, 1fr);
    flex: 1;
    min-height: 0;
}

.theme-editor__nav {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-4);
    border-right: var(--border-w) solid var(--border-color);
}

.theme-editor__nav-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-4);
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    text-align: start;
    cursor: pointer;
}

.theme-editor__nav-item:hover {
    background: var(--bg-hover);
}

.theme-editor__nav-item[aria-current="page"] {
    background: var(--accent-bg);
    color: var(--accent-text);
    font-weight: 600;
}

.theme-editor__badge {
    min-width: 18px;
    padding: 0 var(--space-2);
    border-radius: 999px;
    background: var(--status-danger);
    color: var(--text-inverse);
    font-size: var(--text-xs);
    text-align: center;
}

.theme-editor__panel {
    min-width: 0;
    min-height: 0;
}

.theme-editor__section {
    max-width: 920px;
    padding: var(--space-6) var(--space-8);
}

.theme-editor__basic,
.theme-editor__contrast {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    max-width: 560px;
}

.theme-editor__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    font-size: var(--text-sm);
}

.theme-editor__hint {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.theme-editor__heading {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
}

.theme-editor__ok {
    margin: 0;
    color: var(--status-success);
    font-size: var(--text-sm);
}

.theme-editor__failures {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.theme-editor__failures li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-3);
    font-size: var(--text-sm);
}

.theme-editor__failure-ratio {
    color: var(--status-danger);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
}

/* 窄窗口：导航收成顶部一条，分区内容占满宽（Spec 输出 18）。 */
@container (max-width: 520px) {
    .theme-editor__body {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: auto minmax(0, 1fr);
    }

    .theme-editor__nav {
        flex-direction: row;
        overflow-x: auto;
        border-right: 0;
        border-bottom: var(--border-w) solid var(--border-color);
    }

    .theme-editor__section {
        padding: var(--space-4);
    }
}
</style>
