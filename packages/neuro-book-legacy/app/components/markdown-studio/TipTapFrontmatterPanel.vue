<script setup lang="ts">
import type {FrontmatterProfileKind} from "nbook/shared/editor-workbench";

const props = withDefaults(defineProps<{
    modelValue: string;
    hasFrontmatter: boolean;
    open: boolean;
    readonly?: boolean;
    error?: string;
    profileKind?: FrontmatterProfileKind | null;
}>(), {
    readonly: false,
    error: "",
    profileKind: null,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "update:hasFrontmatter", value: boolean): void;
    (e: "update:open", value: boolean): void;
    (e: "add"): void;
    (e: "remove"): void;
    (e: "focus"): void;
    (e: "blur"): void;
    (e: "save-request"): void;
    (e: "open-profile", kind: FrontmatterProfileKind): void;
}>();
const {t} = useI18n();

const profileLabel = computed(() => {
    if (props.profileKind === "character") {
        return t("markdownStudio.frontmatter.characterProfile");
    }
    if (props.profileKind === "location") {
        return t("markdownStudio.frontmatter.locationProfile");
    }
    if (props.profileKind === "rule") {
        return t("markdownStudio.frontmatter.ruleProfile");
    }
    return "";
});

/**
 * frontmatter 摘要用于折叠态展示。
 */
const frontmatterSummary = computed(() => {
    if (!props.hasFrontmatter) {
        return t("markdownStudio.frontmatter.noFrontmatter");
    }
    const firstLine = props.modelValue.split("\n").find((line) => line.trim());
    return firstLine?.trim() || t("markdownStudio.frontmatter.emptyFrontmatter");
});

/**
 * 切换 YAML 编辑区展开状态。
 */
function toggleOpen(): void {
    emit("update:open", !props.open);
}

/**
 * 打开当前类型的专属档案表单。
 */
function openProfile(): void {
    if (!props.profileKind) {
        return;
    }
    emit("open-profile", props.profileKind);
}

/**
 * frontmatter YAML 区支持跨平台保存快捷键。
 */
function handleKeydown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") {
        return;
    }
    event.preventDefault();
    emit("save-request");
}
</script>

<template>
    <!-- TipTap 顶部 frontmatter 面板 -->
    <section class="frontmatter-panel">
        <div v-if="props.hasFrontmatter" class="frontmatter-card" :class="props.error ? 'is-error' : ''">
            <div class="frontmatter-head">
                <button type="button" class="frontmatter-summary" @click="toggleOpen">
                    <span :class="props.open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="h-3.5 w-3.5 shrink-0"></span>
                    <span class="min-w-0 truncate font-mono">{{ frontmatterSummary }}</span>
                    <span v-if="props.error" class="i-lucide-triangle-alert h-3.5 w-3.5 shrink-0 text-[var(--status-danger)]"></span>
                </button>
                <div class="frontmatter-actions">
                    <button v-if="props.profileKind" type="button" class="frontmatter-icon-action" :title="profileLabel" @click="openProfile">
                        <span class="i-lucide-square-pen h-3.5 w-3.5"></span>
                    </button>
                    <button type="button" class="frontmatter-icon-action is-danger" :title="t('markdownStudio.frontmatter.remove')" :disabled="props.readonly" @click="emit('remove')">
                        <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                    </button>
                </div>
            </div>

            <div v-if="props.open" class="frontmatter-editor">
                <textarea
                    :value="props.modelValue"
                    class="frontmatter-textarea"
                    spellcheck="false"
                    :readonly="props.readonly"
                    @focus="emit('focus')"
                    @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
                    @keydown="handleKeydown"
                    @blur="emit('blur')"
                ></textarea>
                <p v-if="props.error" class="min-w-0 truncate text-[11px] text-[var(--status-danger)]">{{ props.error }}</p>
            </div>
        </div>

        <button v-else type="button" class="frontmatter-add" :disabled="props.readonly" @click="emit('add')">
            <span class="i-lucide-braces h-3.5 w-3.5"></span>
            <span>{{ t("markdownStudio.frontmatter.add") }}</span>
        </button>
    </section>
</template>

<style scoped>
.frontmatter-panel {
    max-width: calc(var(--nb-markdown-editor-content-width) + 48px);
    margin: 0 auto;
    padding: 16px 24px 0;
}

.frontmatter-card,
.frontmatter-add {
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: color-mix(in srgb, var(--bg-input) 80%, transparent);
}

.frontmatter-card.is-error {
    border-color: var(--status-danger-border);
}

.frontmatter-head {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 8px 6px 10px;
}

.frontmatter-summary {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: center;
    gap: 8px;
    color: var(--text-secondary);
    font-size: 12px;
    text-align: left;
}

.frontmatter-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 4px;
}

.frontmatter-icon-action {
    display: inline-flex;
    height: 24px;
    width: 24px;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    color: var(--text-muted);
    transition: background-color 0.16s ease, color 0.16s ease;
}

.frontmatter-icon-action:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-main);
}

.frontmatter-icon-action.is-danger:hover:not(:disabled) {
    background: var(--status-danger-bg);
    color: var(--status-danger);
}

.frontmatter-editor {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-top: 1px solid var(--border-color);
    padding: 8px;
}

.frontmatter-textarea {
    min-height: 112px;
    height: 336px;
    resize: vertical;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--panel-surface);
    padding: 8px;
    color: var(--text-main);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 12px;
    line-height: 1.6;
    outline: none;
}

.frontmatter-textarea:focus {
    border-color: var(--accent-main);
}

.frontmatter-add {
    display: flex;
    min-height: 34px;
    width: 100%;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    color: var(--text-secondary);
    font-size: 12px;
    text-align: left;
    transition: background-color 0.16s ease, color 0.16s ease;
}

.frontmatter-add:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-main);
}
</style>
