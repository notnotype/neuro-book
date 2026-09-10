<script setup lang="ts">
import {computed, useId} from "vue";
import {Autocomplete, Button, FormInput, Switch} from "@notnotype/nb-ui/components";
import type {AutocompleteOption} from "@notnotype/nb-ui/components";
import type {MarkdownEditorPreferences, MonacoEditorPreferences} from "nbook/shared/editor-workbench";
import {
    MARKDOWN_FONT_OPTIONS,
    MARKDOWN_NUMBER_LIMITS,
    MONACO_FONT_OPTIONS,
    MONACO_NUMBER_LIMITS,
    clampEditorNumber,
    clampMonacoNumber,
    editorFontLabel,
    type MarkdownNumberKey,
    type MonacoNumberKey,
} from "./editor/editor-prefs";

const props = withDefaults(defineProps<{
    /** Markdown 富文本显示偏好 */
    markdown: MarkdownEditorPreferences;
    /** Monaco 源码显示偏好 */
    monaco: MonacoEditorPreferences;
    disabled?: boolean;
}>(), {
    disabled: false,
});

const emit = defineEmits<{
    (event: "update:markdown", value: MarkdownEditorPreferences): void;
    (event: "update:monaco", value: MonacoEditorPreferences): void;
    (event: "reset", target: "markdown" | "monaco"): void;
}>();

const {t} = useI18n();
const idPrefix = `editor-settings-${useId()}`;
const indentId = `${idPrefix}-indent-enabled`;
const wordWrapId = `${idPrefix}-word-wrap`;
const minimapId = `${idPrefix}-minimap`;
const lineNumbersId = `${idPrefix}-line-numbers`;
const whitespaceId = `${idPrefix}-whitespace`;

const markdownFontOptions = computed<AutocompleteOption[]>(() => MARKDOWN_FONT_OPTIONS.map((option) => ({
    value: option.value,
    label: editorFontLabel(option, t),
})));
const monacoFontOptions = computed<AutocompleteOption[]>(() => MONACO_FONT_OPTIONS.map((option) => ({
    value: option.value,
    label: editorFontLabel(option, t),
})));

function patchMarkdown(patch: Partial<MarkdownEditorPreferences>): void {
    emit("update:markdown", {...props.markdown, ...patch});
}

function patchMonaco(patch: Partial<MonacoEditorPreferences>): void {
    emit("update:monaco", {...props.monaco, ...patch});
}

/** 越界夹紧后写回；空串与非数字不写回，见 editor-prefs。 */
function updateMarkdownNumber(key: MarkdownNumberKey, value: string): void {
    const parsed = clampEditorNumber(key, value);
    if (parsed === null) {
        return;
    }
    patchMarkdown({[key]: parsed});
}

function updateMonacoNumber(key: MonacoNumberKey, value: string): void {
    const parsed = clampMonacoNumber(key, value);
    if (parsed === null) {
        return;
    }
    patchMonaco({[key]: parsed});
}
</script>

<template>
    <div class="editor-view-root flex min-w-0 flex-col" data-lab-subject>
        <header class="flex flex-wrap items-start justify-between gap-[var(--space-4)]">
            <div class="min-w-0">
                <h2 class="text-[var(--text-base)] [font-weight:var(--weight-strong)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.editor.markdownTitle") }}</h2>
                <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.editor.markdownDescription") }}</p>
            </div>
            <Button size="sm" variant="secondary" class="shrink-0" :disabled="props.disabled" @click="emit('reset', 'markdown')">
                <span class="i-lucide-rotate-ccw mr-1 h-3.5 w-3.5" aria-hidden="true"></span>
                {{ t("settings.editor.resetMarkdown") }}
            </Button>
        </header>

        <div class="editor-grid mt-[var(--space-4)] grid gap-[var(--space-3)] border-t border-[var(--divider)] pt-[var(--space-4)]">
            <label class="editor-span block min-w-0">
                <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.editor.bodyFontTitle") }}</span>
                <span class="mt-[var(--space-1)] block text-[var(--text-2xs)] leading-[var(--leading-ui)] text-[var(--text-muted)]">{{ t("settings.editor.bodyFontDescription") }}</span>
                <Autocomplete
                    class="mt-[var(--space-2)]"
                    size="sm"
                    :model-value="props.markdown.fontFamily"
                    :options="markdownFontOptions"
                    :placeholder="t('settings.editor.fontFamilyPlaceholder')"
                    :disabled="props.disabled"
                    @update:model-value="patchMarkdown({fontFamily: $event})"
                />
            </label>

            <label class="block min-w-0">
                <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.editor.fontSizeTitle") }}</span>
                <span class="mt-[var(--space-1)] block text-[var(--text-2xs)] leading-[var(--leading-ui)] text-[var(--text-muted)]">{{ t("settings.editor.fontSizeDescription") }}</span>
                <FormInput
                    class="mt-[var(--space-2)]"
                    type="number"
                    inputmode="decimal"
                    size="sm"
                    :min="String(MARKDOWN_NUMBER_LIMITS.fontSize.min)"
                    :max="String(MARKDOWN_NUMBER_LIMITS.fontSize.max)"
                    :step="String(MARKDOWN_NUMBER_LIMITS.fontSize.step)"
                    :model-value="String(props.markdown.fontSize)"
                    :disabled="props.disabled"
                    @update:model-value="updateMarkdownNumber('fontSize', $event)"
                />
            </label>

            <label class="block min-w-0">
                <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.editor.lineHeightTitle") }}</span>
                <span class="mt-[var(--space-1)] block text-[var(--text-2xs)] leading-[var(--leading-ui)] text-[var(--text-muted)]">{{ t("settings.editor.lineHeightDescription") }}</span>
                <FormInput
                    class="mt-[var(--space-2)]"
                    type="number"
                    inputmode="decimal"
                    size="sm"
                    :min="String(MARKDOWN_NUMBER_LIMITS.lineHeight.min)"
                    :max="String(MARKDOWN_NUMBER_LIMITS.lineHeight.max)"
                    :step="String(MARKDOWN_NUMBER_LIMITS.lineHeight.step)"
                    :model-value="String(props.markdown.lineHeight)"
                    :disabled="props.disabled"
                    @update:model-value="updateMarkdownNumber('lineHeight', $event)"
                />
            </label>

            <label class="block min-w-0">
                <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.editor.contentWidthTitle") }}</span>
                <span class="mt-[var(--space-1)] block text-[var(--text-2xs)] leading-[var(--leading-ui)] text-[var(--text-muted)]">{{ t("settings.editor.contentWidthDescription") }}</span>
                <FormInput
                    class="mt-[var(--space-2)]"
                    type="number"
                    inputmode="numeric"
                    size="sm"
                    :min="String(MARKDOWN_NUMBER_LIMITS.contentWidth.min)"
                    :max="String(MARKDOWN_NUMBER_LIMITS.contentWidth.max)"
                    :step="String(MARKDOWN_NUMBER_LIMITS.contentWidth.step)"
                    :model-value="String(props.markdown.contentWidth)"
                    :disabled="props.disabled"
                    @update:model-value="updateMarkdownNumber('contentWidth', $event)"
                />
            </label>

            <div class="block min-w-0">
                <label :for="indentId" class="flex cursor-pointer items-start gap-[var(--space-3)]">
                    <span class="min-w-0 flex-1">
                        <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.editor.paragraphIndentTitle") }}</span>
                        <span class="mt-[var(--space-1)] block text-[var(--text-2xs)] leading-[var(--leading-ui)] text-[var(--text-muted)]">{{ t("settings.editor.paragraphIndentDescription") }}</span>
                    </span>
                    <Switch
                        :id="indentId"
                        class="mt-[var(--space-1)] shrink-0"
                        :model-value="props.markdown.paragraphIndentEnabled"
                        :disabled="props.disabled"
                        :aria-label="t('settings.editor.paragraphIndentTitle')"
                        @update:model-value="patchMarkdown({paragraphIndentEnabled: $event})"
                    />
                </label>
                <FormInput
                    class="mt-[var(--space-2)]"
                    type="number"
                    inputmode="decimal"
                    size="sm"
                    :min="String(MARKDOWN_NUMBER_LIMITS.paragraphIndentEm.min)"
                    :max="String(MARKDOWN_NUMBER_LIMITS.paragraphIndentEm.max)"
                    :step="String(MARKDOWN_NUMBER_LIMITS.paragraphIndentEm.step)"
                    :model-value="String(props.markdown.paragraphIndentEm)"
                    :disabled="props.disabled || !props.markdown.paragraphIndentEnabled"
                    @update:model-value="updateMarkdownNumber('paragraphIndentEm', $event)"
                />
            </div>
        </div>

        <header class="mt-[var(--space-6)] flex flex-wrap items-start justify-between gap-[var(--space-4)] border-t border-[var(--divider)] pt-[var(--space-4)]">
            <div class="min-w-0">
                <h2 class="text-[var(--text-base)] [font-weight:var(--weight-strong)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.editor.monacoTitle") }}</h2>
                <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.editor.monacoDescription") }}</p>
            </div>
            <Button size="sm" variant="secondary" class="shrink-0" :disabled="props.disabled" @click="emit('reset', 'monaco')">
                <span class="i-lucide-rotate-ccw mr-1 h-3.5 w-3.5" aria-hidden="true"></span>
                {{ t("settings.editor.resetMonaco") }}
            </Button>
        </header>

        <div class="editor-grid mt-[var(--space-4)] grid gap-[var(--space-3)]">
            <label class="editor-span block min-w-0">
                <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.editor.monacoFontTitle") }}</span>
                <span class="mt-[var(--space-1)] block text-[var(--text-2xs)] leading-[var(--leading-ui)] text-[var(--text-muted)]">{{ t("settings.editor.monacoFontDescription") }}</span>
                <Autocomplete
                    class="mt-[var(--space-2)]"
                    size="sm"
                    :model-value="props.monaco.fontFamily"
                    :options="monacoFontOptions"
                    :placeholder="t('settings.editor.fontFamilyPlaceholder')"
                    :disabled="props.disabled"
                    @update:model-value="patchMonaco({fontFamily: $event})"
                />
            </label>

            <label class="block min-w-0">
                <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.editor.monacoFontSizeTitle") }}</span>
                <span class="mt-[var(--space-1)] block text-[var(--text-2xs)] leading-[var(--leading-ui)] text-[var(--text-muted)]">{{ t("settings.editor.monacoFontSizeDescription") }}</span>
                <FormInput
                    class="mt-[var(--space-2)]"
                    type="number"
                    inputmode="numeric"
                    size="sm"
                    :min="String(MONACO_NUMBER_LIMITS.fontSize.min)"
                    :max="String(MONACO_NUMBER_LIMITS.fontSize.max)"
                    :step="String(MONACO_NUMBER_LIMITS.fontSize.step)"
                    :model-value="String(props.monaco.fontSize)"
                    :disabled="props.disabled"
                    @update:model-value="updateMonacoNumber('fontSize', $event)"
                />
            </label>

            <label class="block min-w-0">
                <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.editor.monacoLineHeightTitle") }}</span>
                <span class="mt-[var(--space-1)] block text-[var(--text-2xs)] leading-[var(--leading-ui)] text-[var(--text-muted)]">{{ t("settings.editor.monacoLineHeightDescription") }}</span>
                <FormInput
                    class="mt-[var(--space-2)]"
                    type="number"
                    inputmode="numeric"
                    size="sm"
                    :min="String(MONACO_NUMBER_LIMITS.lineHeight.min)"
                    :max="String(MONACO_NUMBER_LIMITS.lineHeight.max)"
                    :step="String(MONACO_NUMBER_LIMITS.lineHeight.step)"
                    :model-value="String(props.monaco.lineHeight)"
                    :disabled="props.disabled"
                    @update:model-value="updateMonacoNumber('lineHeight', $event)"
                />
            </label>

            <label class="block min-w-0">
                <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.editor.tabSizeTitle") }}</span>
                <span class="mt-[var(--space-1)] block text-[var(--text-2xs)] leading-[var(--leading-ui)] text-[var(--text-muted)]">{{ t("settings.editor.tabSizeDescription") }}</span>
                <FormInput
                    class="mt-[var(--space-2)]"
                    type="number"
                    inputmode="numeric"
                    size="sm"
                    :min="String(MONACO_NUMBER_LIMITS.tabSize.min)"
                    :max="String(MONACO_NUMBER_LIMITS.tabSize.max)"
                    :step="String(MONACO_NUMBER_LIMITS.tabSize.step)"
                    :model-value="String(props.monaco.tabSize)"
                    :disabled="props.disabled"
                    @update:model-value="updateMonacoNumber('tabSize', $event)"
                />
            </label>

            <label :for="wordWrapId" class="flex cursor-pointer items-start gap-[var(--space-3)] min-w-0">
                <span class="min-w-0 flex-1">
                    <span class="block text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.editor.wordWrapTitle") }}</span>
                    <span class="mt-[var(--space-1)] block text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.editor.wordWrapDescription") }}</span>
                </span>
                <Switch
                    :id="wordWrapId"
                    class="mt-[var(--space-1)] shrink-0"
                    :model-value="props.monaco.wordWrap"
                    :disabled="props.disabled"
                    :aria-label="t('settings.editor.wordWrapTitle')"
                    @update:model-value="patchMonaco({wordWrap: $event})"
                />
            </label>

            <label :for="minimapId" class="flex cursor-pointer items-start gap-[var(--space-3)] min-w-0">
                <span class="min-w-0 flex-1">
                    <span class="block text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.editor.minimapTitle") }}</span>
                    <span class="mt-[var(--space-1)] block text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.editor.minimapDescription") }}</span>
                </span>
                <Switch
                    :id="minimapId"
                    class="mt-[var(--space-1)] shrink-0"
                    :model-value="props.monaco.minimapEnabled"
                    :disabled="props.disabled"
                    :aria-label="t('settings.editor.minimapTitle')"
                    @update:model-value="patchMonaco({minimapEnabled: $event})"
                />
            </label>

            <label :for="lineNumbersId" class="flex cursor-pointer items-start gap-[var(--space-3)] min-w-0">
                <span class="min-w-0 flex-1">
                    <span class="block text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.editor.lineNumbersTitle") }}</span>
                    <span class="mt-[var(--space-1)] block text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.editor.lineNumbersDescription") }}</span>
                </span>
                <Switch
                    :id="lineNumbersId"
                    class="mt-[var(--space-1)] shrink-0"
                    :model-value="props.monaco.lineNumbers"
                    :disabled="props.disabled"
                    :aria-label="t('settings.editor.lineNumbersTitle')"
                    @update:model-value="patchMonaco({lineNumbers: $event})"
                />
            </label>

            <label :for="whitespaceId" class="flex cursor-pointer items-start gap-[var(--space-3)] min-w-0">
                <span class="min-w-0 flex-1">
                    <span class="block text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.editor.whitespaceTitle") }}</span>
                    <span class="mt-[var(--space-1)] block text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.editor.whitespaceDescription") }}</span>
                </span>
                <Switch
                    :id="whitespaceId"
                    class="mt-[var(--space-1)] shrink-0"
                    :model-value="props.monaco.renderWhitespace"
                    :disabled="props.disabled"
                    :aria-label="t('settings.editor.whitespaceTitle')"
                    @update:model-value="patchMonaco({renderWhitespace: $event})"
                />
            </label>
        </div>
    </div>
</template>

<style scoped>
.editor-view-root {
    container-type: inline-size;
}

/* 短字段并排由视图自身容器宽度决定，不看窗口宽度。 */
@container (min-width: 620px) {
    .editor-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .editor-grid .editor-span {
        grid-column: span 2;
    }
}
</style>
