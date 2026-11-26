<script setup lang="ts">
/**
 * 就地改的编辑卡（docs/specs/canon/author-ui.md 输出 16、29、30、51）：输入控件、选着剧情里变了时的“发生了什么”、有别的变化时
 * 一条提示（或原因）、最下面一行是意图二选一与取消、保存。意图写成落点（“从最初起 | 从第 3 章起”），由宿主按值的来源算好给。
 * 受控：填的值、意图、发生了什么、预览与原因都由宿主给，交互时发出新值。挂上时焦点进输入控件；Escape 等同取消（输入法组字里的不算）。
 * `bar` 是页面顶上的确认条（通用字段表），`inline` 是放进宿主给的浮层或原处的编辑卡（输出 51）。
 */
import {computed, nextTick, onMounted, ref} from "vue";

import {Button, Input, SegmentedControl} from "@notnotype/nb-ui/components";

import {useCanonText} from "../text";
import type {ConfirmBarKind, EditIntent} from "./confirm-bar";
import type {EntryResults} from "./entry-picker";
import FieldInput from "./FieldInput.vue";

const props = withDefaults(defineProps<{
    label: string;
    kind: ConfirmBarKind;
    /** 选项字段的选项。 */
    options?: readonly string[];
    unit?: string;
    /** 填的值：数、文字、选项是字符串，是否是布尔，引用是条目 id 或 null，图片是 `{图片, 说明}` 或 null。 */
    value: unknown;
    /** 引用：条目选择器这一次的查找结果（宿主用 `useEntryFind`）与当前值的名字。 */
    refResults?: EntryResults;
    refName?: string;
    /** 可选的意图；只有一项时不显示选择。 */
    intents: readonly EditIntent[];
    intent: EditIntent;
    /** 两项意图的写法（“从最初起”“从第 3 章起”，宿主按值的来源与所选位置算）；缺省是“改设定”“剧情里变了”。 */
    intentLabels?: {readonly creative: string; readonly story: string} | null;
    /** 选着剧情里变了时的“发生了什么”（选填）；null 时这一处不给写。 */
    note?: string | null;
    /** 不填“发生了什么”时用的那一句（写在占位里）。 */
    noteFallback?: string;
    /** 预览：写回哪里与带来的变化（没有别的变化时宿主给空的 `impact`）；没有预览（还没填、正在预览、预览失败）时为 null。 */
    preview?: {readonly route: string; readonly impact: readonly string[]} | null;
    previewing?: boolean;
    /** 失败或说明（`role="alert"`）；没有时为空。 */
    error?: string;
    /** 结局不明：给“再查一次”。 */
    recheck?: boolean;
    /** 保存中：保存不可用。 */
    saving?: boolean;
    /** 保存不可用（例如累出来的数，输出 16）。“这个值刚刚变了”这类原因不锁：作者再点一次保存就行（输出 29）。 */
    locked?: boolean;
    /** `bar`：页面顶上的确认条（缺省）；`inline`：放进就地改的浮层或编辑层。 */
    variant?: "bar" | "inline";
    /** 文字输入的行数（成段的文字从原文的行数起步）；缺省 2。 */
    rows?: number;
}>(), {options: () => [], unit: "", refResults: () => ({kind: "idle"}), refName: undefined, intentLabels: null, note: null, noteFallback: "", preview: null, previewing: false, error: "", recheck: false, saving: false, locked: false, variant: "bar", rows: 2});

const emit = defineEmits<{
    (event: "update:value", value: unknown): void;
    /** 引用的条目选择器打开或打字：宿主按字段的 `targets` 查。 */
    (event: "search-ref", query: string): void;
    (event: "update:intent", value: EditIntent): void;
    (event: "update:note", value: string): void;
    (event: "save"): void;
    (event: "cancel"): void;
    (event: "recheck"): void;
}>();

const text = useCanonText();
const root = ref<HTMLElement | null>(null);
const canSave = computed(() => props.preview !== null && !props.previewing && !props.saving && !props.locked);

/** 回车就是保存的几种：`inline` 时它们是单行的输入框（短文字、有建议值的文字、数）。 */
const ENTER_SAVES: ReadonlySet<ConfirmBarKind> = new Set(["text", "suggest", "number"]);

const intentOptions = computed(() => props.intents.map((intent) => ({
    value: intent,
    label: intent === "creative" ? (props.intentLabels?.creative ?? text("edit.creative")) : (props.intentLabels?.story ?? text("edit.story")),
})));
/** “发生了什么”只在选着剧情里变了时出：它是这一条剧情变更的文字（输出 16）。 */
const noteShown = computed(() => props.note !== null && props.intent === "story" && props.intents.includes("story"));
/** 有别的变化才写（宿主在没有别的变化时给空的 `impact`）；多于一条时写第一条与“还有 N 项”，整句在悬停提示里。 */
const impact = computed(() => props.preview?.impact ?? []);
const impactText = computed(() => (impact.value.length === 1 ? impact.value[0]! : text("edit.moreImpact", {first: impact.value[0] ?? "", count: impact.value.length - 1})));
/** 保存键上写快捷键：单行的回车，成段文字的 Ctrl+回车。 */
const multiline = computed(() => props.kind === "text" && props.rows > 1);
const saveHint = computed(() => (multiline.value ? "Ctrl ↵" : props.variant === "inline" && props.rows === 1 && ENTER_SAVES.has(props.kind) ? "↵" : ""));

onMounted(() => {
    void nextTick(() => root.value?.querySelector<HTMLElement>("input, textarea, [role='combobox'], [role='switch']")?.focus());
});


const onKeydown = (event: KeyboardEvent): void => {
    if (event.isComposing) return;
    if (event.key === "Escape") {
        event.preventDefault();
        emit("cancel");
        return;
    }
    // 只认单行的输入框（成段的文字回车照常换行）；建议值的列表接走了这一下（选中高亮的那条）时不保存。
    // 预览还在等（刚填完就按回车）也发出：宿主先等预览回来，没有别的变化才保存（输出 51），不把这一下吞掉。
    // 成段的文字：Ctrl（或 ⌘）加回车保存，回车照常换行。
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && multiline.value && (canSave.value || (props.previewing && !props.saving && !props.locked))) {
        event.preventDefault();
        emit("save");
        return;
    }
    if (event.key === "Enter" && props.variant === "inline" && props.rows === 1 && ENTER_SAVES.has(props.kind) && !event.defaultPrevented && (event.target as Element | null)?.tagName === "INPUT" && (canSave.value || (props.previewing && !props.saving && !props.locked))) {
        event.preventDefault();
        emit("save");
    }
};
</script>

<template>
    <section
        ref="root"
        class="text-[length:var(--text-sm)]"
        :class="props.variant === 'bar' ? 'sticky top-0 z-[1] mb-3 rounded-[var(--radius-panel)] border border-[var(--accent-main)] bg-[var(--panel-surface)] p-3' : ''"
        :aria-label="text('edit.heading', {label: props.label})"
        :data-confirm-bar="props.variant === 'bar' ? '' : undefined"
        :data-inline-editor="props.variant === 'inline' ? '' : undefined"
        :data-previewed="props.preview !== null && !props.previewing ? '' : undefined"
        @keydown="onKeydown"
    >
        <h3 v-if="props.variant === 'bar'" class="mb-2 font-semibold text-[var(--text-main)]">{{ text("edit.heading", {label: props.label}) }}</h3>
        <FieldInput :kind="props.kind" :value="props.value" :label="props.label" :options="props.options" :unit="props.unit" :ref-results="props.refResults" :ref-name="props.refName" :rows="props.rows" :inline="props.variant === 'inline'" @update:value="(value: unknown) => emit('update:value', value)" @search-ref="(query: string) => emit('search-ref', query)" />
        <Transition name="nb-ui-switch">
            <div v-if="noteShown" class="mt-2" data-edit-note>
                <Input size="sm" :model-value="props.note ?? ''" :aria-label="text('edit.note')" :placeholder="text('edit.notePlaceholder', {fallback: props.noteFallback})" @update:model-value="(value: string) => emit('update:note', value)" />
            </div>
        </Transition>
        <!-- 原因优先（它是这时最要紧的）；没有原因时，有别的变化才写一条。没有别的变化时这一行不占地方。 -->
        <Transition name="nb-ui-switch" mode="out-in">
            <p v-if="props.error !== ''" key="error" class="confirm-bar__notice confirm-bar__notice--danger" role="alert" :title="props.error">{{ props.error }}</p>
            <p v-else-if="!props.previewing && impact.length > 0" key="impact" class="confirm-bar__notice confirm-bar__notice--warning" :title="impact.join('\n')" data-edit-impact>
                <span class="i-lucide-triangle-alert mt-0.5 size-3.5 shrink-0 text-[var(--status-warning)]" aria-hidden="true" />
                <!-- 页顶的确认条地方够，逐条列出；编辑卡里收成一行，整句在悬停提示里。 -->
                <span v-if="props.variant === 'bar'" class="flex min-w-0 flex-col"><span v-for="(line, index) in impact" :key="index">{{ line }}</span></span>
                <span v-else class="min-w-0">{{ impactText }}</span>
            </p>
        </Transition>
        <div class="mt-2 flex flex-wrap items-center gap-1">
            <div v-if="intentOptions.length > 1" class="min-w-0" data-edit-intent>
                <SegmentedControl variant="raised" size="xs" :aria-label="text('edit.intent')" :model-value="props.intent" :options="intentOptions" @update:model-value="(value) => emit('update:intent', value as EditIntent)" />
            </div>
            <Button v-if="props.error !== '' && props.recheck" size="sm" variant="ghost" @click="emit('recheck')">{{ text("failure.recheck") }}</Button>
            <span class="flex-1" />
            <Button size="sm" variant="ghost" @click="emit('cancel')">{{ text("edit.cancel") }}</Button>
            <!-- 快捷键提示画在伪元素里：按钮的文字与读屏名照旧只是“保存”。 -->
            <Button class="confirm-bar__save" size="sm" :disabled="!canSave" :data-shortcut="saveHint === '' ? undefined : saveHint" @click="emit('save')">{{ text("edit.save") }}</Button>
        </div>
    </section>
</template>

<style scoped>
/* 原因与变化：一条浅底的提示，变化用警告色、原因用危险色的字。 */
.confirm-bar__notice {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin: 8px 0 0;
    padding: 6px 8px;
    border-radius: var(--radius-control);
    font-size: var(--text-xs);
    line-height: 1.5;
}
.confirm-bar__notice--warning {
    background: color-mix(in srgb, var(--status-warning) 12%, transparent);
    color: var(--text-main);
}
.confirm-bar__notice--danger {
    background: color-mix(in srgb, var(--status-danger) 10%, transparent);
    color: var(--status-danger);
}
.confirm-bar__save[data-shortcut]::after {
    content: attr(data-shortcut);
    margin-left: 6px;
    font-size: var(--text-xs);
    opacity: 0.7;
}
</style>
