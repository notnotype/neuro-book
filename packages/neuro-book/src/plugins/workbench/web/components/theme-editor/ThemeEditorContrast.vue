<script setup lang="ts">
/** 主题编辑器的“对比度检查”分区（同名 .md）：两套明暗里每个文字色，用它真实的颜色画一行样张，旁边标比值与等级。 */
import {computed, nextTick, useTemplateRef} from "vue";

import {Button} from "@notnotype/nb-ui/components";

import {contrastGrade} from "nbook/ui/theme/contrast-checks";
import type {ContrastCheck, ContrastGrade} from "nbook/ui/theme/contrast-checks";

import {useWorkbenchText} from "../../text";
import type {Appearance} from "./editor-state";
import type {ThemeEditorModel} from "./theme-editor-model";

defineOptions({name: "ThemeEditorContrast"});

const props = defineProps<{model: ThemeEditorModel}>();
const text = useWorkbenchText();
const model = props.model;
const root = useTemplateRef<HTMLElement>("root");

const APPEARANCES: ReadonlyArray<Appearance> = ["light", "dark"];

interface Row {
    readonly check: ContrastCheck;
    /** 没有比值时为 null。 */
    readonly grade: ContrastGrade | null;
}

/** 不合格的排在前面，其余保持检查表里的顺序。 */
const groups = computed(() =>
    APPEARANCES.map((appearance) => {
        const rows = model.contrastByAppearance.value[appearance].map((check): Row => ({check, grade: check.ratio === null ? null : contrastGrade(check.ratio)}));
        const failing = rows.filter((row) => row.grade === "low");
        return {appearance, rows: [...failing, ...rows.filter((row) => row.grade !== "low")], failing: failing.length};
    }),
);
const failingTotal = computed(() => groups.value.reduce((sum, group) => sum + group.failing, 0));

/**
 * 跳到配色分区、切到那一套明暗，把光标放进那个变量的色值输入；变量不在配色分区里（读不到输入）时只停在分区上。
 * 切分区会卸载这个组件，所以编辑器的根节点要在切之前取。
 */
const locate = async (appearance: Appearance, key: string): Promise<void> => {
    const editor = root.value?.closest("[data-theme-editor]");
    model.appearance.value = appearance;
    model.section.value = "colors";
    await nextTick();
    const field = editor?.querySelector<HTMLInputElement>(`[data-color-field="${CSS.escape(key)}"] input:not([type="color"])`);
    field?.scrollIntoView({block: "center"});
    field?.focus();
};
</script>

<template>
    <div ref="root" class="theme-editor-contrast" data-section="contrast">
        <p class="theme-editor-contrast__hint">{{ text("themeEditor.contrast.legend") }}</p>
        <p v-if="failingTotal === 0" class="theme-editor-contrast__summary" data-tone="ok" data-contrast-none>{{ text("themeEditor.contrast.none") }}</p>
        <p v-else class="theme-editor-contrast__summary" data-tone="bad" role="status" data-contrast-total>{{ text("themeEditor.contrast.failingCount", {count: failingTotal}) }}</p>

        <section v-for="group in groups" :key="group.appearance" class="theme-editor-contrast__group" :data-contrast-group="group.appearance">
            <h3 class="theme-editor-contrast__title">
                {{ text(group.appearance === "light" ? "themeEditor.appearance.light" : "themeEditor.appearance.dark") }}
                <span class="theme-editor-contrast__count" :data-tone="group.failing === 0 ? 'ok' : 'bad'">{{ group.failing === 0 ? text("themeEditor.contrast.allPass") : text("themeEditor.contrast.failingCount", {count: group.failing}) }}</span>
            </h3>
            <ul class="theme-editor-contrast__rows">
                <li v-for="{check, grade} in group.rows" :key="check.key" class="theme-editor-contrast__row" :data-grade="grade ?? 'unknown'" :data-contrast-row="check.key" :data-contrast-failure="grade === 'low' ? '' : undefined">
                    <span
                        class="theme-editor-contrast__sample"
                        :style="check.sample === null ? undefined : {color: check.sample.foreground, backgroundColor: check.sample.surface}"
                        :aria-label="text('themeEditor.contrast.sampleLabel')"
                        data-contrast-sample
                    >{{ check.sample === null ? "–" : text("themeEditor.contrast.sampleText") }}</span>
                    <span class="theme-editor-contrast__what">
                        <code>{{ check.key }}</code>
                        <span class="theme-editor-contrast__hint">{{ check.ratio === null ? text("themeEditor.contrast.unknown") : text("themeEditor.contrast.against", {surface: check.against ?? ""}) }}</span>
                    </span>
                    <span class="theme-editor-contrast__ratio" data-contrast-ratio>{{ check.ratio === null ? "–" : check.ratio.toFixed(2) }}</span>
                    <span v-if="grade !== null" class="theme-editor-contrast__grade" :data-grade="grade" data-contrast-grade>{{ text(`themeEditor.contrast.grade.${grade}` as 'themeEditor.contrast.grade.low') }}</span>
                    <Button v-if="grade === 'low'" size="sm" variant="secondary" data-contrast-locate @click="locate(group.appearance, check.key)">{{ text("themeEditor.contrast.locate") }}</Button>
                </li>
            </ul>
        </section>
    </div>
</template>

<style scoped>
.theme-editor-contrast {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
}

.theme-editor-contrast__hint {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.theme-editor-contrast__summary {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
}

.theme-editor-contrast__summary[data-tone="ok"],
.theme-editor-contrast__count[data-tone="ok"] {
    color: var(--status-success);
}

.theme-editor-contrast__summary[data-tone="bad"],
.theme-editor-contrast__count[data-tone="bad"] {
    color: var(--status-danger);
}

.theme-editor-contrast__group {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.theme-editor-contrast__title {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
}

.theme-editor-contrast__count {
    font-size: var(--text-xs);
    font-weight: 400;
}

.theme-editor-contrast__rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

/* 一行：样张、变量与底色、比值、等级、（不合格时）去修改。放不下时从“变量与底色”开始换行。 */
.theme-editor-contrast__row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: var(--border-w) solid var(--border-color);
    border-left-width: 3px;
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
}

.theme-editor-contrast__row[data-grade="low"] {
    border-color: var(--status-danger);
}

/* 样张的颜色全由行内样式给：文字色与它的底色都是被编辑的取值，不能取编辑器自己的 token。 */
.theme-editor-contrast__sample {
    display: flex;
    flex: none;
    width: 148px;
    align-items: center;
    justify-content: center;
    min-height: 2.25rem;
    padding: var(--space-2) var(--space-3);
    border: var(--border-w) solid var(--border-color);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    white-space: nowrap;
    overflow: hidden;
}

.theme-editor-contrast__what {
    display: flex;
    flex: 1 1 160px;
    flex-direction: column;
    min-width: 0;
}

.theme-editor-contrast__what code {
    overflow: hidden;
    text-overflow: ellipsis;
}

.theme-editor-contrast__ratio {
    min-width: 3em;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    text-align: right;
}

.theme-editor-contrast__row[data-grade="low"] .theme-editor-contrast__ratio {
    color: var(--status-danger);
}

.theme-editor-contrast__grade {
    padding: 0 var(--space-3);
    border: var(--border-w) solid currentColor;
    border-radius: 999px;
    font-size: var(--text-xs);
    white-space: nowrap;
}

.theme-editor-contrast__grade[data-grade="low"] {
    color: var(--status-danger);
}

.theme-editor-contrast__grade[data-grade="aa"],
.theme-editor-contrast__grade[data-grade="aaa"] {
    color: var(--status-success);
}
</style>
