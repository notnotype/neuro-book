<script setup lang="ts">
/** 批注的浮层与“写”的状态机（同名 .md）：光标进批注出“看”卡片，加批注与改意见在同一张卡片里“写”。 */
import {AnchoredPopover} from "@notnotype/nb-ui/components";
import {commentEntry, commentsAt, findComment, gotoComment, holdSelection, listComments, markShownComment, refOf, releaseSelection} from "@notnotype/nb-markdown/editor";
import type {CommentInfo, CommentRef} from "@notnotype/nb-markdown/editor";
import type {Editor} from "@tiptap/core";
import type {Transaction} from "@tiptap/pm/state";
import {computed, onBeforeUnmount, ref, shallowRef, watch} from "vue";

import type {EditorEditing, EditorMenus} from "nbook/plugins/editor/shared/contracts";

import {caretAnchor, selectionAnchor} from "../selection-anchor";
import MarkdownCommentCard from "./MarkdownCommentCard.vue";
import type {CommentCardLabels} from "./MarkdownCommentCard.vue";

const props = defineProps<{
    editor: Editor | null;
    scroller: HTMLElement | null;
    editing: EditorEditing;
    menus: EditorMenus;
    readonly: boolean;
    /** 换文档时变：卡片与没保存的字都作废。 */
    binding: string | null;
    /** 别的弹层（注音与双语卡片、右键菜单）开着：不弹。 */
    blocked: boolean;
}>();
const emit = defineEmits<{(event: "writing", writing: boolean): void}>();

/** 每次选区或文档变化加一：列表与光标处的批注都是现算的，不缓存（缓存会让卡片上的序号对着旧文档）。 */
const tick = ref(0);
const focused = ref(false);
/** 光标进了批注、卡片开着（“看”）。 */
const cardOpen = ref(false);
/** 正在“写”：`ref` 为 null 是还不在文档里的新批注。 */
const writing = shallowRef<{readonly ref: CommentRef | null; readonly session: number} | null>(null);
/** 点上一条、下一条跳到的那条：紧挨或同起点的批注光标不动，要自己记着“当前”是哪条。 */
const current = shallowRef<CommentRef | null>(null);
let session = 0;

const list = computed<CommentInfo[]>(() => {
    void tick.value;
    return props.editor === null ? [] : listComments(props.editor.state.doc);
});
const at = computed<CommentInfo[]>(() => {
    void tick.value;
    return props.editor === null ? [] : commentsAt(props.editor.state);
});
const writingInfo = computed<CommentInfo | null>(() => {
    void tick.value;
    const target = writing.value?.ref ?? null;
    return props.editor === null || target === null ? null : findComment(props.editor.state.doc, target);
});

const labels = computed<CommentCardLabels>(() => ({
    empty: props.menus.label("commentEmpty"),
    counter: (index, total) => props.menus.label("commentCounter", {i: index, n: total}),
    previous: props.menus.label("commentPrevious"),
    next: props.menus.label("commentNext"),
    edit: props.menus.label("commentEdit"),
    remove: props.menus.label("commentRemove"),
    save: props.menus.label("commentSave"),
    cancel: props.menus.label("commentCancel"),
    body: props.menus.label("commentBody"),
}));

const viewOpen = computed(() => cardOpen.value && focused.value && at.value.length > 0 && !props.blocked && writing.value === null);
const popoverOpen = computed(() => viewOpen.value || writing.value !== null);

/** 新批注贴选区（同注音卡片）；已有的贴光标所在行，块批注贴块里第一个文字处（输出 30）。 */
const anchor = computed(() => {
    const editor = props.editor;
    if (editor === null) return null;
    if (writing.value !== null && writing.value.ref === null) return selectionAnchor(editor, props.scroller);
    const first = at.value[0];
    return caretAnchor(editor, props.scroller, first?.block === true ? first.start : undefined);
});

const sameComment = (info: CommentInfo, target: CommentRef): boolean => info.body === target.body && info.quote === target.quote;

/** 正文里标出来的那条（输出 32）：“写”里的、点了跳转的、否则卡片里排在前面的。 */
const shown = computed<CommentRef | null>(() => {
    if (writing.value !== null) return writing.value.ref;
    if (!viewOpen.value) return null;
    const chosen = current.value;
    if (chosen !== null && at.value.some((info) => sameComment(info, chosen))) return chosen;
    const first = at.value[0];
    return first === undefined ? null : refOf(first);
});
// 标出是一个事务，不在 `transaction` 事件的调用栈里发；`post` 让它在这一轮更新之后。
watch(shown, (target) => {
    if (props.editor !== null) markShownComment(props.editor, target);
}, {flush: "post"});

watch(() => writing.value !== null, (now) => emit("writing", now), {flush: "sync"});

function closeAll(): void {
    cardOpen.value = false;
    pendingOpen = false;
    current.value = null;
    previousInside = new Set();
    if (writing.value !== null) {
        writing.value = null;
        if (props.editor !== null) releaseSelection(props.editor);
    }
    if (props.editor !== null) markShownComment(props.editor, null);
}
// 换文档、变只读：卡片对着的批注已经不是那份文档里的（Spec 的“状态与转换”）。
watch(() => [props.binding, props.readonly] as const, closeAll, {flush: "sync"});
watch(() => props.blocked, (blocked) => {
    if (blocked) cardOpen.value = false;
});
// 正文被程序改了（外部重载）：“写”对着的批注按指纹找不到了就收起，不拿旧序号去改。
watch(writingInfo, (info) => {
    if (writing.value !== null && writing.value.ref !== null && info === null) endWriting(false);
});

let previousInside: ReadonlySet<string> = new Set();
let pendingOpen = false;
let pointerDown = false;

/**
 * 光标“进入”批注才弹（输出 30，判断在 `commentEntry`）。只看改了文档或选区的事务；程序改的文档（重载、写回回填，不进历史）既不算输入，
 * 也不算走进来，只记下此刻光标处有哪些批注。
 */
function onTransaction({transaction}: {transaction: Transaction}): void {
    const editor = props.editor;
    if (editor === null || (!transaction.docChanged && !transaction.selectionSet)) return;
    tick.value += 1;
    const typed = transaction.docChanged && transaction.getMeta("addToHistory") !== false;
    const result = commentEntry(previousInside, {
        inside: commentsAt(editor.state).map((info) => info.identity),
        selectionEmpty: editor.state.selection.empty,
        docChanged: typed,
        composing: editor.view.composing,
    });
    previousInside = result.inside;
    if ((transaction.docChanged && !typed) || writing.value !== null) return;
    current.value = null;
    if (result.close) {
        cardOpen.value = false;
        pendingOpen = false;
    } else if (result.open) {
        // 鼠标点进来时指针还没松开：松开再弹（拖选不弹）。
        if (pointerDown) pendingOpen = true;
        else cardOpen.value = true;
    }
}
const onFocus = (): void => {
    focused.value = true;
};
const onBlur = (): void => {
    focused.value = false;
};
const onPointerDown = (): void => {
    pointerDown = true;
};
const onPointerUp = (): void => {
    pointerDown = false;
    if (!pendingOpen) return;
    pendingOpen = false;
    cardOpen.value = props.editor !== null && commentsAt(props.editor.state).length > 0;
};

/** Ctrl+Alt+M（输出 28）：有选区加批注，光标在批注里改这条的意见；Esc 收起“看”的卡片。 */
function onKeyDown(event: KeyboardEvent): void {
    const editor = props.editor;
    if (editor === null) return;
    if (event.key === "Escape") {
        cardOpen.value = false;
        return;
    }
    if (props.readonly || !props.menus.matches("comment", event)) return;
    if (!editor.state.selection.empty) {
        if (!props.editing.enabled("comment")) return;
        event.preventDefault();
        beginAdd();
        return;
    }
    const first = commentsAt(editor.state)[0];
    if (first === undefined) return;
    event.preventDefault();
    beginEdit(first);
}

let detach: (() => void) | null = null;
watch(() => [props.editor, props.scroller] as const, ([editor, scroller]) => {
    detach?.();
    detach = null;
    if (editor === null) return;
    previousInside = new Set(commentsAt(editor.state).map((info) => info.identity));
    focused.value = editor.view.hasFocus();
    editor.on("transaction", onTransaction);
    editor.on("focus", onFocus);
    editor.on("blur", onBlur);
    // 先取下 DOM：卸载时编辑器已经 `unmount`，再读 `editor.view` 会抛。
    const dom = editor.view.dom;
    dom.addEventListener("keydown", onKeyDown);
    scroller?.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    detach = () => {
        editor.off("transaction", onTransaction);
        editor.off("focus", onFocus);
        editor.off("blur", onBlur);
        dom.removeEventListener("keydown", onKeyDown);
        scroller?.removeEventListener("pointerdown", onPointerDown);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
    };
}, {immediate: true});
onBeforeUnmount(() => {
    detach?.();
    if (props.editor !== null && !props.editor.isDestroyed) closeAll();
});

/** 在选区上加批注：卡片开着时原选区仍画成选中（同输出 9）。 */
function beginAdd(): void {
    const editor = props.editor;
    if (editor === null || props.readonly || !props.editing.enabled("comment")) return;
    cardOpen.value = false;
    holdSelection(editor);
    session += 1;
    writing.value = {ref: null, session};
}

function beginEdit(info: CommentInfo): void {
    if (props.editor === null || props.readonly) return;
    cardOpen.value = false;
    session += 1;
    writing.value = {ref: refOf(info), session};
}

/** 结束“写”。`focus` 为真时焦点回正文（保存、取消）；焦点自己去了别处（`dismiss`）不抢回。 */
function endWriting(focus: boolean): void {
    const editor = props.editor;
    writing.value = null;
    if (editor === null) return;
    releaseSelection(editor);
    if (focus) editor.view.focus();
}

function submit(text: string): void {
    const editor = props.editor;
    const target = writing.value?.ref ?? null;
    if (editor === null || writing.value === null) return;
    if (target === null) {
        endWriting(true);
        props.menus.run("comment", {text});
        return;
    }
    const ok = props.editing.run("comment-edit", {...target, text});
    endWriting(true);
    // 保存后回到“看”；没保存成（批注已经被别处改掉）就收起。
    cardOpen.value = ok && commentsAt(editor.state).length > 0;
}

function remove(info: CommentInfo): void {
    const editor = props.editor;
    if (editor === null) return;
    props.editing.run("comment-delete", {...refOf(info)});
    editor.view.focus();
    // 删后光标仍在别的批注里就出那一条，否则收起。
    cardOpen.value = commentsAt(editor.state).length > 0;
}

function step(info: CommentInfo, direction: -1 | 1): void {
    const editor = props.editor;
    const target = list.value[info.index + direction];
    if (editor === null || target === undefined) return;
    gotoComment(editor, refOf(target));
    editor.view.focus();
    current.value = refOf(target);
    cardOpen.value = true;
}

defineExpose({
    /** 选区菜单的“批注”按钮、右键菜单的“添加批注”。 */
    beginAdd,
});
</script>

<template>
    <AnchoredPopover :open="popoverOpen" :anchor="anchor" side="bottom">
        <div class="markdown-comment-stack" data-markdown-comment-layer>
            <MarkdownCommentCard
                v-if="writing !== null"
                mode="write"
                :body="writingInfo?.body ?? ''"
                :index="writingInfo?.index ?? list.length"
                :total="writingInfo === null ? list.length + 1 : list.length"
                :readonly="false"
                :labels="labels"
                :session="writing.session"
                @submit="submit"
                @cancel="endWriting(true)"
                @dismiss="endWriting(false)"
            />
            <template v-else>
                <MarkdownCommentCard
                    v-for="info in at"
                    :key="info.identity"
                    mode="view"
                    :body="info.body"
                    :index="info.index"
                    :total="list.length"
                    :readonly="props.readonly"
                    :labels="labels"
                    :session="0"
                    @edit="beginEdit(info)"
                    @remove="remove(info)"
                    @previous="step(info, -1)"
                    @next="step(info, 1)"
                />
            </template>
        </div>
    </AnchoredPopover>
</template>

<style scoped>
.markdown-comment-stack {
    display: flex;
    flex-direction: column;
}

/* 重叠的几条：一张浮层里上下排，中间一条分隔线。 */
.markdown-comment-stack > :deep(* + *) {
    border-top: 1px solid var(--divider);
}
</style>
