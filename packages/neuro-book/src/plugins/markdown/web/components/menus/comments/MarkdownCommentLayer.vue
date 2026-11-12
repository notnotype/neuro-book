<script setup lang="ts">
/** 批注的浮层与“写”的状态机（同名 .md）：鼠标停在批注上出“看”卡片，加批注与改意见在同一张卡片里“写”。 */
import {AnchoredPopover} from "@notnotype/nb-ui/components";
import {commentsAt, commentsAtPos, gotoComment, holdBlock, holdSelection, listComments, markShownComment, matchComment, refOf, releaseSelection} from "@notnotype/nb-markdown/editor";
import type {CommentInfo, CommentRef} from "@notnotype/nb-markdown/editor";
import type {Editor} from "@tiptap/core";
import type {Node as PMNode} from "@tiptap/pm/model";
import type {Transaction} from "@tiptap/pm/state";
import {computed, onBeforeUnmount, ref, shallowRef, watch} from "vue";

import type {EditorEditing, EditorMenus} from "nbook/plugins/editor/shared/contracts";

import {blockAnchor, commentLineAnchor, selectionAnchor} from "../selection-anchor";
import MarkdownCommentCard from "./MarkdownCommentCard.vue";
import type {CommentCardLabels} from "./MarkdownCommentCard.vue";
import MarkdownCommentMargin from "./MarkdownCommentMargin.vue";
import type {MarginItem} from "./MarkdownCommentMargin.vue";

const props = withDefaults(defineProps<{
    editor: Editor | null;
    scroller: HTMLElement | null;
    editing: EditorEditing;
    menus: EditorMenus;
    readonly: boolean;
    /** 换文档时变：卡片与没保存的字都作废。 */
    binding: string | null;
    /** 别的弹层（注音与双语卡片、右键菜单）开着：不弹。 */
    blocked: boolean;
    /** 页边此刻画得出来（开关开着、控件够宽，`MarkdownControl` 算出）：卡片在页边里，不出浮层（输出 33）。 */
    marginDrawn: boolean;
    /** 鼠标停在批注上多久（毫秒）弹卡片；测试传小值，不用假计时器。 */
    hoverDelay?: number;
    /** 指针离开批注文字、又没进卡片多久（毫秒）收起。 */
    closeDelay?: number;
}>(), {hoverDelay: 400, closeDelay: 250});
const emit = defineEmits<{(event: "writing", writing: boolean): void}>();

/** 每次选区或文档变化加一：列表与光标处的批注都是现算的，不缓存（缓存会让卡片上的序号对着旧文档）。 */
const tick = ref(0);
/** 悬停（或上一条、下一条跳转）打开的“看”卡片对着哪个位置；null 是没开。 */
const viewing = shallowRef<{readonly pos: number} | null>(null);
/**
 * 正在“写”：`ref` 为 null 是还不在文档里的新批注（`block` 有值时是块菜单加的整块批注，没有就是选区上的）；`at` 是改已有批注时卡片对着的
 * 位置（打开时悬停的位置或光标）。
 */
const writing = shallowRef<{
    readonly ref: CommentRef | null;
    readonly block: {readonly pos: number; readonly node: PMNode} | null;
    readonly session: number;
    readonly at: number | null;
} | null>(null);
/** 点上一条、下一条、页边的卡片跳到的那条：紧挨或同起点的批注光标不动，要自己记着“当前”是哪条。 */
const current = shallowRef<CommentRef | null>(null);
/**
 * 写着的字：卡片在浮层与页边之间换位置（控件宽度跨过阈值）时是另一个实例，字存在这里才不丢；null 是这次“写”还没有字，卡片按原意见预填。
 * 每次进入“写”重置。
 */
const draftText = ref<string | null>(null);
let session = 0;

const list = computed<CommentInfo[]>(() => {
    void tick.value;
    return props.editor === null ? [] : listComments(props.editor.state.doc);
});
/** 光标处的批注：Ctrl+Alt+M 改的是它，页边里当前的也是它。 */
const cursorAt = computed<CommentInfo[]>(() => {
    void tick.value;
    return props.editor === null ? [] : commentsAt(props.editor.state);
});
/** 悬停卡片对着的位置上的批注（重叠的几条按先后排）。 */
const viewAt = computed<CommentInfo[]>(() => {
    void tick.value;
    const target = viewing.value;
    return props.editor === null || target === null ? [] : commentsAtPos(props.editor.state.doc, target.pos);
});
const writingInfo = computed<CommentInfo | null>(() => {
    const target = writing.value?.ref ?? null;
    return target === null ? null : matchComment(list.value, target);
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

const viewOpen = computed(() => !props.marginDrawn && viewing.value !== null && viewAt.value.length > 0 && !props.blocked && writing.value === null);
const popoverOpen = computed(() => viewOpen.value || (writing.value !== null && !props.marginDrawn));
/** 卡片里的批注：关闭的退场动画期间（外框还在淡出）保持关上那一刻的内容，不先变空。 */
const stack = shallowRef<CommentInfo[]>([]);
watch([viewAt, viewOpen], ([infos, open]) => {
    if (open) stack.value = infos;
}, {immediate: true, flush: "sync"});

/**
 * 卡片贴的位置（输出 30）：新批注贴选区（整块批注贴这一块第一行），已有的批注贴悬停或打开时的那一行、左边对齐这条批注在这一行的起点。
 * 位置与范围每次定位重新取，所以滚动、光标移动都跟得上。
 */
const anchor = computed(() => {
    const editor = props.editor;
    if (editor === null) return null;
    const target = writing.value;
    if (target !== null && target.ref === null) {
        const block = target.block;
        return block === null ? selectionAnchor(editor, props.scroller) : blockAnchor(editor, props.scroller, () => block.pos);
    }
    return commentLineAnchor(
        editor,
        props.scroller,
        () => target?.at ?? viewing.value?.pos ?? editor.state.selection.head,
        () => (target !== null ? writingInfo.value?.segments ?? [] : viewAt.value.flatMap((info) => info.segments)),
    );
});

const sameRef = (left: CommentRef | null, right: CommentRef | null): boolean => left === right || (left !== null && right !== null && left.index === right.index && left.body === right.body && left.quote === right.quote);

/** 页边里当前的批注：点了跳转的（在光标处的批注里按序号加指纹找，两条指纹相同的不会一起算），否则光标处排在前面的；光标不在批注里为 null。 */
const cursorComment = computed<CommentInfo | null>(() => {
    const chosen = current.value;
    const kept = chosen === null ? null : matchComment(cursorAt.value, chosen);
    return kept ?? cursorAt.value[0] ?? null;
});

/**
 * 正文里标出来的那条（输出 32）：“写”里的、页边里当前的、浮层开着时跳到的那条（没有就是卡片里排在前面的）。按内容比较、内容没变就还给上一个对象：
 * 光标在同一条批注里走一格不该再发一个只含装饰的事务。
 */
let lastShown: CommentRef | null = null;
const shown = computed<CommentRef | null>(() => {
    let next: CommentRef | null = null;
    if (writing.value !== null) next = writing.value.ref;
    else if (props.marginDrawn) next = cursorComment.value === null ? null : refOf(cursorComment.value);
    else if (viewOpen.value) {
        // 点上一条、下一条跳到的那条在卡片里（紧挨或同起点的几条，卡片里排在前面的不一定是它）。
        const chosen = current.value === null ? null : matchComment(viewAt.value, current.value);
        const picked = chosen ?? viewAt.value[0];
        next = picked === undefined ? null : refOf(picked);
    }
    if (!sameRef(lastShown, next)) lastShown = next;
    return lastShown;
});

/**
 * 页边里的卡片（输出 33）：每条批注一张，写着的在写，光标所在的是当前批注，其余是 idle；还不在文档里的新批注作为一张待写的卡片，
 * 按选区起点（整块批注按块的位置）插进去。
 */
const marginItems = computed<MarginItem[]>(() => {
    const editor = props.editor;
    if (!props.marginDrawn || editor === null) return [];
    const editing = writingInfo.value;
    const open = cursorComment.value;
    const keys = new Map<number, string>();
    const items = list.value.map((info): MarginItem => ({
        key: marginKey(info, keys),
        info,
        // `cursorAt` 与 `list` 是同一个事务里各算一次的，对象不同，序号相同就是同一条。
        mode: editing !== null && info === editing ? "write" : writing.value === null && open !== null && info.index === open.index ? "current" : "idle",
        anchor: info.start,
    }));
    const target = writing.value;
    if (target !== null && target.ref === null) {
        const at = target.block === null ? editor.state.selection.from : target.block.pos;
        const index = items.findIndex((item) => (item.info as CommentInfo).start > at);
        items.splice(index < 0 ? items.length : index, 0, {key: "pending", info: null, mode: "write", anchor: at});
    }
    blockKeys = keys;
    return items;
});

/**
 * 页边卡片的 key 要跨事务稳定：位置过渡、入场动画与“排好才显示”都按 key 记，key 一变整张卡片重建、重新入场。行内批注的 `identity` 是标记的
 * `key`，稳定；块批注的 `identity` 带着块的位置，块前面每打一个字就变。所以块批注的 key 自己记：位置经每个事务映射后沿用原来的，
 * 新出现的块批注取新的。
 */
let blockKeys = new Map<number, string>();
let blockKeySeed = 0;
function marginKey(info: CommentInfo, next: Map<number, string>): string {
    if (!info.block) return info.identity;
    const at = (info.segments[0] as {from: number}).from;
    const key = blockKeys.get(at) ?? `block-${(blockKeySeed += 1)}`;
    next.set(at, key);
    return key;
}
// 标出是一个事务，不在 `transaction` 事件的调用栈里发；`post` 让它在这一轮更新之后。
watch(shown, (target) => {
    if (props.editor !== null) markShownComment(props.editor, target);
}, {flush: "post"});

watch(() => writing.value !== null, (now) => emit("writing", now), {flush: "sync"});

// ---- 悬停（输出 30）----

let openTimer = 0;
let closeTimer = 0;
/** 指针此刻在哪个批注元素上；不在批注上为 null。 */
let overComment: Element | null = null;
/** 指针停在卡片上：卡片是传送出去的，指针在卡片上时滚动容器收不到 `pointermove`，靠卡片自己的 `pointerenter`、`pointerleave`。 */
let overCard = false;
/** 这一次悬停已经被收起（点击、输入、Esc）：指针离开批注文字之前不再弹。 */
let suppressed = false;
let pointer = {x: 0, y: 0};

function clearTimers(): void {
    window.clearTimeout(openTimer);
    window.clearTimeout(closeTimer);
    openTimer = 0;
    closeTimer = 0;
}

/** 收起悬停的卡片。`suppress`：这次悬停不再弹（指针不在批注上时没有这回事）。 */
function closeView(suppress: boolean): void {
    clearTimers();
    overCard = false;
    viewing.value = null;
    suppressed = suppress && overComment !== null;
}

function scheduleClose(): void {
    if (viewing.value === null || overCard || closeTimer !== 0) return;
    closeTimer = window.setTimeout(() => {
        closeTimer = 0;
        if (!overCard) closeView(false);
    }, props.closeDelay);
}

/** 指针下的批注元素：行内批注是 `comment`，块批注是 `.nb-comment-block`；只认编辑器里的。 */
function commentElement(target: EventTarget | null): Element | null {
    const element = target instanceof Element ? target.closest("comment, .nb-comment-block") : null;
    return element !== null && props.editor !== null && props.editor.view.dom.contains(element) ? element : null;
}

/** 到点了：按指针坐标取位置，位置上有批注就开卡片。取不到坐标（没有布局）或坐标落在批注外时用元素自己的位置。 */
function openAtPointer(): void {
    openTimer = 0;
    const editor = props.editor;
    const element = overComment;
    if (editor === null || element === null || suppressed || props.blocked || props.marginDrawn || writing.value !== null) return;
    let pos = editor.view.posAtCoords({left: pointer.x, top: pointer.y})?.pos ?? -1;
    if (pos < 0 || commentsAtPos(editor.state.doc, pos).length === 0) pos = editor.view.posAtDOM(element, 0);
    const infos = commentsAtPos(editor.state.doc, pos);
    if (infos.length === 0) return;
    // 指针在同一条（或同一组重叠的）批注的别的一段上：卡片留在原处，不跟着指针跳。
    const open = viewing.value === null ? [] : commentsAtPos(editor.state.doc, viewing.value.pos);
    if (open.length === infos.length && open.every((info, index) => info.identity === (infos[index] as CommentInfo).identity)) return;
    viewing.value = {pos};
}

function onPointerMove(event: PointerEvent): void {
    // 触屏没有悬停（已知限制，用页边）。
    if (event.pointerType === "touch") return;
    pointer = {x: event.clientX, y: event.clientY};
    const element = commentElement(event.target);
    if (element === overComment) {
        // 键盘改完意见回到“看”的卡片（指针一直不在批注上）：指针动了才开始收。
        if (element === null) scheduleClose();
        return;
    }
    overComment = element;
    window.clearTimeout(openTimer);
    openTimer = 0;
    if (element === null) {
        suppressed = false;
        scheduleClose();
        return;
    }
    window.clearTimeout(closeTimer);
    closeTimer = 0;
    if (suppressed || props.blocked || props.marginDrawn || writing.value !== null) return;
    openTimer = window.setTimeout(openAtPointer, props.hoverDelay);
}

function onPointerLeave(): void {
    overComment = null;
    suppressed = false;
    window.clearTimeout(openTimer);
    openTimer = 0;
    scheduleClose();
}

/** 在正文里按下：要编辑了，卡片收起、这一次悬停不再弹。 */
function onPointerDown(): void {
    closeView(true);
}

const onCardEnter = (): void => {
    overCard = true;
    window.clearTimeout(closeTimer);
    closeTimer = 0;
};
const onCardLeave = (): void => {
    overCard = false;
    scheduleClose();
};

function closeAll(): void {
    closeView(false);
    current.value = null;
    draftText.value = null;
    if (writing.value !== null) {
        writing.value = null;
        if (props.editor !== null) releaseSelection(props.editor);
    }
    if (props.editor !== null) markShownComment(props.editor, null);
}
// 换文档、变只读：卡片对着的批注已经不是那份文档里的（Spec 的“状态与转换”）。换文档只换编辑状态、不产生事务，所以列表要自己重算。
watch(() => [props.binding, props.readonly] as const, () => {
    closeAll();
    tick.value += 1;
}, {flush: "sync"});
watch(() => [props.blocked, props.marginDrawn] as const, ([blocked, drawn]) => {
    if (blocked || drawn) closeView(false);
});
// 正文被程序改了（外部重载）：“写”对着的批注按指纹找不到了就收起，不拿旧序号去改。
watch(writingInfo, (info) => {
    if (writing.value !== null && writing.value.ref !== null && info === null) endWriting(false);
});

/**
 * 只看改了文档或选区的事务；程序改的文档（重载、写回回填，不进历史）不算输入。输入（改了文档）与选区不空（这时出选区菜单）时卡片收起、
 * 这一次悬停不再弹；光标自己走动不影响悬停的卡片。
 */
function onTransaction({transaction}: {transaction: Transaction}): void {
    const editor = props.editor;
    if (editor === null || (!transaction.docChanged && !transaction.selectionSet)) return;
    tick.value += 1;
    if (transaction.docChanged) blockKeys = new Map([...blockKeys].map(([at, key]) => [transaction.mapping.map(at), key]));
    const typed = transaction.docChanged && transaction.getMeta("addToHistory") !== false;
    if (typed || !editor.state.selection.empty) closeView(true);
    if (writing.value === null) current.value = null;
}

/** Ctrl+Alt+M（输出 28）：有选区加批注，光标在批注里改这条的意见。 */
function onKeyDown(event: KeyboardEvent): void {
    const editor = props.editor;
    if (editor === null || props.readonly || !props.menus.matches("comment", event)) return;
    if (!editor.state.selection.empty) {
        if (!props.editing.enabled("comment")) return;
        event.preventDefault();
        beginAdd();
        return;
    }
    const first = cursorAt.value[0];
    if (first === undefined) return;
    event.preventDefault();
    beginEdit(first, editor.state.selection.head);
}

/** Esc 收起悬停的卡片：听 `document`，只读的正文拿不到焦点，鼠标停着时焦点也常在别处。 */
function onDocumentKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && viewing.value !== null) closeView(true);
}

let detach: (() => void) | null = null;
watch(() => [props.editor, props.scroller] as const, ([editor, scroller]) => {
    detach?.();
    detach = null;
    if (editor === null) return;
    editor.on("transaction", onTransaction);
    // 先取下 DOM：卸载时编辑器已经 `unmount`，再读 `editor.view` 会抛。
    const dom = editor.view.dom;
    dom.addEventListener("keydown", onKeyDown);
    scroller?.addEventListener("pointermove", onPointerMove);
    scroller?.addEventListener("pointerleave", onPointerLeave);
    scroller?.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onDocumentKeyDown);
    detach = () => {
        editor.off("transaction", onTransaction);
        dom.removeEventListener("keydown", onKeyDown);
        scroller?.removeEventListener("pointermove", onPointerMove);
        scroller?.removeEventListener("pointerleave", onPointerLeave);
        scroller?.removeEventListener("pointerdown", onPointerDown);
        document.removeEventListener("keydown", onDocumentKeyDown);
        clearTimers();
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
    closeView(false);
    holdSelection(editor);
    session += 1;
    draftText.value = null;
    writing.value = {ref: null, block: null, session, at: null};
}

/** 块菜单给整块加批注（输出 28）：这一块整个画成选中，保存时按块的位置包进块批注。 */
function beginAddBlock(pos: number): void {
    const editor = props.editor;
    const node = editor === null ? null : editor.state.doc.nodeAt(pos);
    if (editor === null || node === null || props.readonly || !props.editing.enabled("comment-block", {pos})) return;
    closeView(false);
    holdBlock(editor, pos);
    session += 1;
    draftText.value = null;
    writing.value = {ref: null, block: {pos, node}, session, at: null};
}

/** 改这条批注的意见；`at` 是卡片贴的位置，由入口给：悬停卡片上的编辑按钮是悬停处，Ctrl+Alt+M 是光标，页边里的编辑是这条批注的开头。 */
function beginEdit(info: CommentInfo, at: number): void {
    const editor = props.editor;
    if (editor === null || props.readonly) return;
    closeView(false);
    session += 1;
    draftText.value = null;
    writing.value = {ref: refOf(info), block: null, session, at};
}

/** 结束“写”。`focus` 为真时焦点回正文（保存、取消）；焦点自己去了别处（`dismiss`）不抢回。 */
function endWriting(focus: boolean): void {
    const editor = props.editor;
    writing.value = null;
    draftText.value = null;
    if (editor === null) return;
    releaseSelection(editor);
    if (focus) editor.view.focus();
}

function submit(text: string): void {
    const editor = props.editor;
    const target = writing.value;
    if (editor === null || target === null) return;
    if (target.ref === null) {
        // 经控件句柄同步执行：加不上（选区折了、所在的块不再允许批注、块已经不是打开时那一块）时留在“写”里，字还在，不关成“已保存”（输出 28）。
        const block = target.block;
        const ok = block === null ? props.editing.run("comment", {text}) : editor.state.doc.nodeAt(block.pos) === block.node && props.editing.run("comment-block", {pos: block.pos, text});
        if (ok) endWriting(true);
        return;
    }
    const ok = props.editing.run("comment-edit", {...target.ref, text});
    endWriting(true);
    // 保存后回到“看”（输出 29）：卡片留在改的那一处；页边画着时卡片在页边里，没有浮层。没保存成（批注已经被别处改掉）就收起。
    if (ok && target.at !== null && !props.marginDrawn && commentsAtPos(editor.state.doc, target.at).length > 0) viewing.value = {pos: target.at};
}

function remove(info: CommentInfo): void {
    const editor = props.editor;
    if (editor === null) return;
    props.editing.run("comment-delete", {...refOf(info)});
    editor.view.focus();
    closeView(false);
}

/** 点页边里的卡片：这条成为当前批注，光标移过去。正在写别的一条时先放下它（点卡片不夺焦，不会自己发 `dismiss`）。 */
function select(info: CommentInfo): void {
    const editor = props.editor;
    if (editor === null) return;
    if (writing.value !== null) endWriting(false);
    gotoComment(editor, refOf(info));
    editor.view.focus();
    current.value = refOf(info);
}

function step(info: CommentInfo, direction: -1 | 1): void {
    const editor = props.editor;
    const target = list.value[info.index + direction];
    if (editor === null || target === undefined) return;
    gotoComment(editor, refOf(target));
    editor.view.focus();
    current.value = refOf(target);
    // 浮层的卡片跟到目标批注开头那一行；页边里只是当前批注换了。
    if (viewing.value !== null) viewing.value = {pos: target.start};
}

defineExpose({
    /** 选区菜单的“批注”按钮、右键菜单的“添加批注”。 */
    beginAdd,
    /** 块菜单的“批注”：代码块、引用、表格等整块，`pos` 是块开始前的位置。 */
    beginAddBlock,
});
</script>

<template>
    <AnchoredPopover :open="popoverOpen" :anchor="anchor" side="bottom" align="start">
        <div class="markdown-comment-stack" data-markdown-comment-layer @pointerenter="onCardEnter" @pointerleave="onCardLeave">
            <MarkdownCommentCard
                v-if="writing !== null"
                mode="write"
                :body="writingInfo?.body ?? ''"
                :index="writingInfo?.index ?? list.length"
                :total="writingInfo === null ? list.length + 1 : list.length"
                :readonly="false"
                :labels="labels"
                :session="writing.session"
                :draft="draftText"
                @update:draft="(text) => { draftText = text; }"
                @submit="submit"
                @cancel="endWriting(true)"
                @dismiss="endWriting(false)"
            />
            <template v-else>
                <MarkdownCommentCard
                    v-for="info in stack"
                    :key="info.identity"
                    mode="view"
                    :body="info.body"
                    :index="info.index"
                    :total="list.length"
                    :readonly="props.readonly"
                    :labels="labels"
                    :session="0"
                    @edit="beginEdit(info, viewing?.pos ?? info.start)"
                    @remove="remove(info)"
                    @previous="step(info, -1)"
                    @next="step(info, 1)"
                />
            </template>
        </div>
    </AnchoredPopover>
    <Teleport v-if="props.editor !== null && props.scroller !== null" :to="props.scroller">
        <Transition name="markdown-comment-margin">
            <MarkdownCommentMargin
                v-if="props.marginDrawn"
                :editor="props.editor"
                :scroller="props.scroller"
                :items="marginItems"
                :total="list.length"
                :readonly="props.readonly"
                :labels="labels"
                :session="writing?.session ?? 0"
                :version="tick"
                :draft="draftText"
                @update:draft="(text) => { draftText = text; }"
                @edit="(info) => beginEdit(info, info.start)"
                @remove="remove"
                @previous="(info) => step(info, -1)"
                @next="(info) => step(info, 1)"
                @select="select"
                @submit="submit"
                @cancel="endWriting(true)"
                @dismiss="endWriting(false)"
            />
        </Transition>
    </Teleport>
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
