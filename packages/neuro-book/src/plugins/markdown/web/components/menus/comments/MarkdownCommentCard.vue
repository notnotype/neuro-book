<script setup lang="ts">
/** 批注卡片（同名 .md）：浮层与页边共用，只管显示与发事件。 */
import {IconButton, Textarea} from "@notnotype/nb-ui/components";
import {nextTick, ref, useTemplateRef, watch} from "vue";

/** 卡片上的文字：宿主按显示语言取好（`menus.label`），卡片不认识翻译端口。 */
export interface CommentCardLabels {
    /** 意见为空时的灰字。 */
    readonly empty: string;
    /** “第 i 条，共 n 条”（序号从 1 起）。 */
    readonly counter: (index: number, total: number) => string;
    readonly previous: string;
    readonly next: string;
    readonly edit: string;
    readonly remove: string;
    readonly save: string;
    readonly cancel: string;
    /** 输入的可访问名称。 */
    readonly body: string;
}

const props = defineProps<{
    body: string;
    /** 在整份文档里的序号（从 0 起）与总数。 */
    index: number;
    total: number;
    mode: "view" | "write";
    readonly: boolean;
    /** 页边里没有展开的摘要：只有意见的前两行，点它发 `select`。 */
    compact?: boolean;
    labels: CommentCardLabels;
    /** 宿主每进入一次“写”加一：已经在写时换到另一条也要重新预填。 */
    session: number;
}>();

const emit = defineEmits<{
    (event: "edit"): void;
    (event: "remove"): void;
    (event: "previous"): void;
    (event: "next"): void;
    (event: "select"): void;
    (event: "submit", text: string): void;
    (event: "cancel"): void;
    /** 写的时候焦点去了卡片外面。 */
    (event: "dismiss"): void;
}>();

const draft = ref("");
const root = useTemplateRef<HTMLElement>("root");

// 进入“写”：预填原来的意见，光标在末尾。
watch(() => [props.mode, props.session] as const, async ([mode]) => {
    if (mode !== "write") return;
    draft.value = props.body;
    await nextTick();
    const field = root.value?.querySelector("textarea");
    if (field === null || field === undefined) return;
    field.focus({preventScroll: true});
    field.setSelectionRange(field.value.length, field.value.length);
}, {immediate: true, flush: "post"});

/** 空的是取消，不是删除（输出 29）。 */
function save(): void {
    const text = draft.value.trim();
    if (text === "") emit("cancel");
    else emit("submit", text);
}

/**
 * 点卡片的任何地方都不夺走焦点：浮层里 `AnchoredPopover` 已经这样做，页边里没有，所以写在卡片里，两处一样。输入控件除外。
 */
function onMousedown(event: MouseEvent): void {
    if (event.target instanceof Element && event.target.closest("textarea, input") !== null) return;
    event.preventDefault();
}

/**
 * 写的时候焦点移到卡片外的别处才放弃。窗口失去焦点（切走、点开发者工具）时 `relatedTarget` 也是空的，但文档没有焦点：不算离开，
 * 回来时输入还在，几百字的意见不该因此丢掉。
 */
function onFocusOut(event: FocusEvent): void {
    if (props.mode !== "write") return;
    const next = event.relatedTarget as Node | null;
    if (next !== null && root.value?.contains(next)) return;
    if (next === null && !document.hasFocus()) return;
    emit("dismiss");
}

/** 组字中的回车与 Esc 归输入法；Ctrl+Enter（macOS 上 ⌘Enter）保存，Esc 取消，回车换行。 */
function onKeydown(event: KeyboardEvent): void {
    if (props.mode !== "write" || event.isComposing) return;
    if (event.key === "Escape") {
        event.preventDefault();
        emit("cancel");
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        save();
    }
}

</script>

<template>
    <div
        ref="root"
        class="markdown-comment-card"
        :class="{'markdown-comment-card--compact': props.compact === true}"
        data-markdown-comment-card
        :data-mode="props.mode"
        :role="props.compact === true ? 'button' : undefined"
        :tabindex="props.compact === true ? -1 : undefined"
        @mousedown="onMousedown"
        @click="props.compact === true && emit('select')"
        @focusout="onFocusOut"
        @keydown="onKeydown"
    >
        <template v-if="props.mode === 'view'">
            <p class="markdown-comment-card__body" :class="{'markdown-comment-card__body--empty': props.body === ''}" data-markdown-comment-body>{{ props.body === "" ? props.labels.empty : props.body }}</p>
            <div v-if="props.compact !== true" class="markdown-comment-card__footer">
                <span class="markdown-comment-card__counter" data-markdown-comment-counter>{{ props.labels.counter(props.index + 1, props.total) }}</span>
                <IconButton size="xs" icon-class="i-lucide-chevron-up" :title="props.labels.previous" :aria-label="props.labels.previous" :disabled="props.index <= 0" @click="emit('previous')" />
                <IconButton size="xs" icon-class="i-lucide-chevron-down" :title="props.labels.next" :aria-label="props.labels.next" :disabled="props.index >= props.total - 1" @click="emit('next')" />
                <span class="flex-1" />
                <template v-if="!props.readonly">
                    <IconButton size="xs" icon-class="i-lucide-pencil" :title="props.labels.edit" :aria-label="props.labels.edit" @click="emit('edit')" />
                    <IconButton size="xs" icon-class="i-lucide-trash-2" :title="props.labels.remove" :aria-label="props.labels.remove" @click="emit('remove')" />
                </template>
            </div>
        </template>
        <template v-else>
            <Textarea v-model="draft" variant="bare" autosize :max-rows="12" :rows="1" class="markdown-comment-card__field" :aria-label="props.labels.body" />
            <div class="markdown-comment-card__footer">
                <span class="flex-1" />
                <IconButton size="xs" icon-class="i-lucide-x" :title="props.labels.cancel" :aria-label="props.labels.cancel" @click="emit('cancel')" />
                <IconButton size="xs" icon-class="i-lucide-check" :title="props.labels.save" :aria-label="props.labels.save" @click="save" />
            </div>
        </template>
    </div>
</template>

<style scoped>
/*
 * 卡片本身的外观是浮层（`AnchoredPopover`）给的；页边里的卡片自己画底色与边（`MarkdownCommentMargin.vue`）。这里只管里面：
 * “看”的文字与“写”的输入字体、字号、行距一样，点“编辑”时文字不重排；意见区最高约 12 行再滚动（输出 29）。
 */
.markdown-comment-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 18rem;
    max-width: 100%;
    padding: 8px 8px 4px 12px;
    font-size: var(--text-sm);
    line-height: 1.55;
    color: var(--text-main);
}

.markdown-comment-card__body {
    margin: 0;
    max-height: calc(12 * 1.55em);
    overflow-y: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.markdown-comment-card__body--empty {
    color: var(--text-muted);
}

.markdown-comment-card :deep(.markdown-comment-card__field) {
    font: inherit;
    line-height: inherit;
}

.markdown-comment-card__footer {
    display: flex;
    align-items: center;
    gap: 2px;
    min-height: 24px;
}

.markdown-comment-card__counter {
    margin-right: 4px;
    font-size: var(--text-xs);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
}

.markdown-comment-card--compact {
    width: auto;
    padding: 6px 10px;
    cursor: pointer;
}

.markdown-comment-card--compact .markdown-comment-card__body {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    max-height: none;
}
</style>
