<script setup lang="ts">
/** 批注卡片（同名 .md）：浮层与页边共用，只管显示与发事件。 */
import {IconButton, Textarea} from "@notnotype/nb-ui/components";
import {computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch} from "vue";

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
    /** 摆在浮层里还是页边里，缺省浮层。页边里意见最多显示 3 行，底行的按钮只在当前、悬停或有焦点时显现；点不是当前的卡片发 `select`。 */
    variant?: "float" | "margin";
    /** 页边里这条是当前批注（光标所在的、写着的）：按钮显现、意见放开行数。 */
    current?: boolean;
    labels: CommentCardLabels;
    /** 宿主每进入一次“写”加一：已经在写时换到另一条也要重新预填。 */
    session: number;
    /**
     * 写着的字由宿主存（卡片在浮层与页边之间换位置时是另一个实例，不能让字跟着丢）：为 null 是这次“写”还没有字，按 `body` 预填；
     * 有字就用它，不预填。
     */
    draft?: string | null;
}>();

const emit = defineEmits<{
    (event: "edit"): void;
    (event: "remove"): void;
    (event: "previous"): void;
    (event: "next"): void;
    (event: "select"): void;
    (event: "submit", text: string): void;
    (event: "update:draft", text: string): void;
    (event: "cancel"): void;
    /** 写的时候焦点去了卡片外面。 */
    (event: "dismiss"): void;
}>();

const draft = ref("");
/** 页边里不是当前的卡片：意见只显示 3 行。当前的与浮层里的放开到约 12 行。 */
const clamped = computed(() => props.variant === "margin" && props.current !== true);
const root = useTemplateRef<HTMLElement>("root");

// 进入“写”：预填原来的意见，光标在末尾。
watch(() => [props.mode, props.session] as const, async ([mode]) => {
    if (mode !== "write") return;
    draft.value = props.draft ?? props.body;
    emit("update:draft", draft.value);
    await nextTick();
    const field = root.value?.querySelector("textarea");
    if (field === null || field === undefined) return;
    field.focus({preventScroll: true});
    field.setSelectionRange(field.value.length, field.value.length);
}, {immediate: true, flush: "post"});

watch(draft, (text) => emit("update:draft", text));

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

/** 页边里点不是当前的卡片（按钮除外）：这条成为当前批注。 */
function onClick(event: MouseEvent): void {
    if (props.variant !== "margin" || props.current === true || props.mode !== "view") return;
    if (event.target instanceof Element && event.target.closest("button") !== null) return;
    emit("select");
}

/**
 * 写的时候焦点移到卡片外的别处（不是另一张批注卡片）才放弃。窗口失去焦点（切走、点开发者工具）时 `relatedTarget` 也是空的，但文档没有焦点：不算离开，
 * 回来时输入还在，几百字的意见不该因此丢掉。
 */
function onFocusOut(event: FocusEvent): void {
    // 卡片自己被摘掉（页边与浮层之间换位置）时，浏览器可能对拿着焦点的输入补一个 `focusout`：不是用户离开。
    if (leaving || props.mode !== "write") return;
    const next = event.relatedTarget as Node | null;
    if (next !== null && root.value?.contains(next)) return;
    // 焦点去了另一张批注卡片（页边与浮层互相切换时，退场动画里的旧卡片还在，新卡片已经抢了焦点）：写还在继续，不是离开。
    if (next instanceof Element && next.closest("[data-markdown-comment-card]") !== null) return;
    if (next === null && !document.hasFocus()) return;
    emit("dismiss");
}

let leaving = false;
onBeforeUnmount(() => {
    leaving = true;
});

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
        data-markdown-comment-card
        :data-mode="props.mode"
        :data-variant="props.variant ?? 'float'"
        :data-current="props.current === true ? '' : undefined"
        @mousedown="onMousedown"
        @click="onClick"
        @focusout="onFocusOut"
        @keydown="onKeydown"
    >
        <template v-if="props.mode === 'view'">
            <p class="markdown-comment-card__body" :class="{'markdown-comment-card__body--empty': props.body === '', 'markdown-comment-card__body--clamped': clamped}" data-markdown-comment-body>{{ props.body === "" ? props.labels.empty : props.body }}</p>
            <div class="markdown-comment-card__footer">
                <span class="markdown-comment-card__counter" data-markdown-comment-counter>{{ props.labels.counter(props.index + 1, props.total) }}</span>
                <div class="markdown-comment-card__controls" data-markdown-comment-controls>
                    <IconButton size="xs" icon-class="i-lucide-chevron-up" :title="props.labels.previous" :aria-label="props.labels.previous" :disabled="props.index <= 0" @click="emit('previous')" />
                    <IconButton size="xs" icon-class="i-lucide-chevron-down" :title="props.labels.next" :aria-label="props.labels.next" :disabled="props.index >= props.total - 1" @click="emit('next')" />
                    <span class="flex-1" />
                    <template v-if="!props.readonly">
                        <IconButton size="xs" icon-class="i-lucide-pencil" :title="props.labels.edit" :aria-label="props.labels.edit" @click="emit('edit')" />
                        <IconButton size="xs" icon-class="i-lucide-trash-2" :title="props.labels.remove" :aria-label="props.labels.remove" @click="emit('remove')" />
                    </template>
                </div>
            </div>
        </template>
        <template v-else>
            <Textarea v-model="draft" variant="bare" autosize :max-rows="12" :rows="1" class="markdown-comment-card__field" :aria-label="props.labels.body" />
            <div class="markdown-comment-card__footer">
                <div class="markdown-comment-card__controls">
                    <span class="flex-1" />
                    <IconButton size="xs" icon-class="i-lucide-x" :title="props.labels.cancel" :aria-label="props.labels.cancel" @click="emit('cancel')" />
                    <IconButton size="xs" icon-class="i-lucide-check" :title="props.labels.save" :aria-label="props.labels.save" @click="save" />
                </div>
            </div>
        </template>
    </div>
</template>

<style scoped>
/*
 * 卡片本身的外观是浮层（`AnchoredPopover`）给的；页边里的卡片自己画底色与边（`MarkdownCommentMargin.vue`）。这里只管里面：
 * “看”的文字与“写”的输入字体、字号、行距一样，点“编辑”时文字不重排；意见区最高约 12 行再滚动（输出 29）。
 * 状态之间外框与版式不变（ui-development-spec 第 3 节第 4 条）：意见区加一个固定高度的底行，底行的按钮在页边里只是显隐。
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

.markdown-comment-card[data-variant="margin"] {
    width: auto;
}

/* 页边里不是当前的卡片可以点：点了成为当前批注。 */
.markdown-comment-card[data-variant="margin"]:not([data-current]):not([data-mode="write"]) {
    cursor: pointer;
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

.markdown-comment-card__body--clamped {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    overflow: hidden;
    max-height: none;
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

.markdown-comment-card__controls {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 2px;
    opacity: 1;
    transition: opacity var(--motion-fast) var(--ease-layout);
}

/*
 * 页边里不是当前的卡片、指针没停在上面、焦点也不在里面时按钮不画，但占着位置（外框不变）。`visibility` 等淡出结束才切，
 * 显现时立刻切（`visibility` 的过渡是离散的）。键盘焦点进来（`:focus-within`）时显现，按钮才点得到。
 */
.markdown-comment-card[data-variant="margin"]:not([data-current]):not(:hover):not(:focus-within) .markdown-comment-card__controls {
    opacity: 0;
    visibility: hidden;
    transition: opacity var(--motion-fast) var(--ease-layout), visibility 0s linear var(--motion-fast);
}
</style>
