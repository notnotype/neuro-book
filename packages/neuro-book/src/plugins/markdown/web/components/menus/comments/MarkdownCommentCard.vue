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
    /**
     * 摆在浮层里还是页边里，缺省浮层。页边里没有底行：编辑、删除按钮在当前、悬停或有焦点时显现在右上角，意见第一行给它们留着位置（不压到字）；
     * 意见的行数由宿主的 CSS 变量 `--markdown-comment-lines` 限；点不是展开的卡片发 `select`。
     */
    variant?: "float" | "margin";
    /** 页边里这条是当前批注（光标所在的、写着的）：编辑、删除按钮显现。 */
    current?: boolean;
    /** 页边里这张卡片展开了（点了卡片，或在写）：意见放开行数。 */
    expanded?: boolean;
    /** 页边里同一段有几条批注：右上角 `‹ 1/3 ›`，箭头发 `previous`、`next`（同一段里切换）。`index` 从 0 起。 */
    pager?: {readonly index: number; readonly count: number};
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
/** 页边里没展开的卡片：意见按宿主给的行数限。展开的与浮层里的放开到约 12 行。 */
const clamped = computed(() => props.variant === "margin" && props.expanded !== true);
const isMargin = computed(() => props.variant === "margin");
/** 页边里右上角有控件：编辑、删除（只读没有）与同一段的 `‹ 1/3 ›`。意见第一行为它们留位置。 */
const hasActions = computed(() => isMargin.value && !props.readonly);
const hasPager = computed(() => isMargin.value && props.pager !== undefined);
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

/** 页边里点没展开的卡片（按钮除外）：这条成为当前批注并展开。 */
function onClick(event: MouseEvent): void {
    if (props.variant !== "margin" || props.expanded === true || props.mode !== "view") return;
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
        :data-expanded="props.expanded === true ? '' : undefined"
        :data-actions="hasActions ? '' : undefined"
        :data-pager="hasPager ? '' : undefined"
        @mousedown="onMousedown"
        @click="onClick"
        @focusout="onFocusOut"
        @keydown="onKeydown"
    >
        <template v-if="props.mode === 'view'">
            <p class="markdown-comment-card__body" :class="{'markdown-comment-card__body--empty': props.body === '', 'markdown-comment-card__body--clamped': clamped}" data-markdown-comment-body><span v-if="hasActions || hasPager" class="markdown-comment-card__reserve" aria-hidden="true" />{{ props.body === "" ? props.labels.empty : props.body }}</p>
            <div v-if="isMargin" class="markdown-comment-card__overlay" data-markdown-comment-controls>
                <div v-if="!props.readonly" class="markdown-comment-card__actions">
                    <IconButton size="xs" icon-class="i-lucide-pencil" :title="props.labels.edit" :aria-label="props.labels.edit" @click="emit('edit')" />
                    <IconButton size="xs" icon-class="i-lucide-trash-2" :title="props.labels.remove" :aria-label="props.labels.remove" @click="emit('remove')" />
                </div>
                <div v-if="props.pager !== undefined" class="markdown-comment-card__pager" data-markdown-comment-pager>
                    <IconButton size="xs" icon-class="i-lucide-chevron-left" :title="props.labels.previous" :aria-label="props.labels.previous" :disabled="props.pager.index <= 0" @click="emit('previous')" />
                    <span class="markdown-comment-card__pager-count">{{ props.pager.index + 1 }}/{{ props.pager.count }}</span>
                    <IconButton size="xs" icon-class="i-lucide-chevron-right" :title="props.labels.next" :aria-label="props.labels.next" :disabled="props.pager.index >= props.pager.count - 1" @click="emit('next')" />
                </div>
            </div>
            <div v-else class="markdown-comment-card__footer">
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
 * 卡片本身的外观是浮层（`AnchoredPopover`）给的；页边里的卡片面由页边画（`MarkdownCommentMargin.vue`：当前的用浮层基座，其余是淡底）。这里只管里面：
 * “看”的文字与“写”的输入字体、字号、行距一样，点“编辑”时文字不重排；意见区最高约 12 行再滚动（输出 29）。
 * 浮层里状态之间外框与版式不变（ui-development-spec 第 3 节第 4 条）：意见区加一个固定高度的底行。页边里没有底行，按钮浮在右上角，只是显隐。
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
    /*
     * 右上角控件的宽度：编辑、删除两个按钮，`‹ 1/3 ›` 是两个按钮夹一个页码。意见第一行按它们的总宽留位置（`__reserve`），所以按钮显现时
     * 不压到字，也不因为显现而重排（ui-development-spec 第 3 节第 4 条：只在某个状态出现的零件放进预留的位置）。
     * 数字依赖 `IconButton` 的 xs 是 24px、`__overlay` 靠右 4px、卡片右内边距 10px、页码 `__pager-count` 的 28px：改了其中一个要一起改；
     * 下面 `[data-actions]`、`[data-pager]` 两条与这条同特异性，靠写在后面覆盖。
     */
    --markdown-comment-actions-w: 0px;
    --markdown-comment-pager-w: 0px;
    --markdown-comment-controls-w: calc(var(--markdown-comment-actions-w) + var(--markdown-comment-pager-w));

    position: relative;
    width: auto;
    padding: 4px 10px 4px 12px;
}

.markdown-comment-card[data-actions] {
    --markdown-comment-actions-w: 48px;
}

.markdown-comment-card[data-pager] {
    --markdown-comment-pager-w: 76px;
}

/* 页边里没展开的卡片可以点：点了成为当前批注并展开。 */
.markdown-comment-card[data-variant="margin"]:not([data-expanded]):not([data-mode="write"]) {
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

/*
 * 页边里没展开的卡片按宿主给的行数限（意见区）；什么时候限行（收起时晚一个过渡）见 `MarkdownCommentMargin.vue` 的 `__body--clamped` 一条。
 * 占位（`__reserve`）是浮动元素，放在 `-webkit-box` 里：Chrome 里成立（`-webkit-box` 带限行时是块容器），Firefox 124、Chrome 119 里 `-webkit-box`
 * 是弹性盒、浮动无效，占位可能自己占一行，未在那两个浏览器里验证（t23 的待确认清单）。
 */
.markdown-comment-card__body--clamped {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: var(--markdown-comment-lines, 3);
    line-clamp: var(--markdown-comment-lines, 3);
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

/* 页边：右上角控件的占位，浮动、只占第一行高，意见的第一行绕开它。控件靠右 4px，比内容区的右缘多出 6px，所以占位少 6px。 */
.markdown-comment-card__reserve {
    float: right;
    width: calc(var(--markdown-comment-controls-w) - 6px);
    height: 1.55em;
}

/* 页边：右上角的控件，绝对定位，位置已经由 `__reserve` 留好。 */
.markdown-comment-card__overlay {
    position: absolute;
    top: 2px;
    right: 4px;
    display: flex;
    align-items: center;
}

.markdown-comment-card__pager {
    display: flex;
    align-items: center;
    gap: 0;
}

.markdown-comment-card__pager-count {
    min-width: 28px;
    text-align: center;
    font-size: var(--text-xs);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
}

/*
 * 编辑、删除只在当前的卡片、指针停在卡片上、焦点在里面时显现；位置一直留着（`__reserve`），不盖字。
 * `visibility` 等淡出结束才切，显现时立刻切（`visibility` 的过渡是离散的）；键盘焦点进来（`:focus-within`）时显现，按钮才点得到。
 */
.markdown-comment-card__actions {
    display: flex;
    align-items: center;
    opacity: 1;
    transition: opacity var(--motion-fast) var(--ease-layout);
}

.markdown-comment-card:not([data-current]):not(:hover):not(:focus-within) .markdown-comment-card__actions {
    opacity: 0;
    visibility: hidden;
    transition: opacity var(--motion-fast) var(--ease-layout), visibility 0s linear var(--motion-fast);
}
</style>
