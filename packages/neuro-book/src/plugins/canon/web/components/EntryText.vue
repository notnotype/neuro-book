<script setup lang="ts">
/**
 * 条目的文字分页（docs/specs/canon/author-ui.md 输出 10）。块是世界服务给作者的渲染（canon.rendering 输出 7）：源文加值表。这里对源文
 * 跑与内核同一份条目文法，按词法单元画，活的标签换成值表里对应的那一项；对不上的块整块按出错显示。条件只画生效的那一支，判断
 * 未知时写“未知”。页面的 h1 是条目名，文字里的标题降一级（`#` 画成 h2）。
 */
import {defineComponent, h, nextTick, onActivated, onBeforeUnmount, onMounted, ref, shallowRef, watch} from "vue";
import type {PropType, VNodeChild} from "vue";
import {decodeHTMLStrict} from "entities";

import "@notnotype/nb-markdown/markdown.css";

import {Button, Popover} from "@notnotype/nb-ui/components";

import type {EntryTextBlock, EntryTextToken, EntryTextValue, LaidOutBlock, TextAddress} from "./entry-text";
import {layoutBlock, placeAddress, placeKey} from "./entry-text";
import {useCanonText} from "../text";

const props = withDefaults(defineProps<{
    blocks: readonly EntryTextBlock[];
    /** 这个条目的 id：值节点不写条目时指它自己。 */
    self: string;
    /** 这个条目各字段的“改过”标记，按路径（输出 10）。 */
    marks?: Readonly<Record<string, string>>;
    /** 开着来历的那一处（`placeKey`）；没有时不写。 */
    open?: string;
    /** 右上出“编辑”（没有主文字时是“开始写”）：进整篇的编辑（输出 39）。 */
    editable?: boolean;
    /** 不能进编辑的原因：非空时那个按钮不可用，悬停写原因。 */
    editReason?: string;
}>(), {marks: () => ({}), open: undefined, editable: false, editReason: ""});

const emit = defineEmits<{
    /** 点了一个值：打开或关上它的来历。`place` 是这一处（`placeKey`）。 */
    (event: "value", place: string): void;
    /** 来历的浮层在页面里被关上（Esc、点页面里别处），或开着的那一处已经不在了：清掉记下的那一处。 */
    (event: "close"): void;
    /** 点了一个条目引用。 */
    (event: "entry", id: string): void;
    /** 点了“编辑”或“开始写”。 */
    (event: "edit"): void;
}>();

defineSlots<{
    /** 开着的那一处的来历，画在贴着它的浮层里。 */
    origin?(props: {address: TextAddress}): unknown;
}>();

const text = useCanonText();

const HEADINGS = ["h2", "h3", "h4", "h5", "h5", "h5"] as const;

/** HTML 形式的强调（核心语法的 `htmlMark`，标签名小写）画成的元素。 */
const HTML_MARKS: Readonly<Record<string, string>> = {strong: "strong", b: "strong", em: "em", i: "em", del: "del", s: "del"};

type VValue = Extract<EntryTextValue, {tag: "V"}>;

/** 正在画的那一块的 id（`Block` 的渲染函数里设）。 */
let renderingBlock = "";

const blockList = (layout: LaidOutBlock, list: readonly EntryTextToken[] | undefined): VNodeChild[] => (list ?? []).map((token) => blockToken(layout, token));
const inlineList = (layout: LaidOutBlock, list: readonly EntryTextToken[] | undefined): VNodeChild[] => (list ?? []).map((token) => inlineToken(layout, token));

function blockToken(layout: LaidOutBlock, token: EntryTextToken): VNodeChild {
    switch (token.type) {
        case "space":
        case "def":
        case "checkbox":
            return null;
        // 段落、标题、列表、引用、代码、表格、分隔线的样子来自章节的正文样式（块的根上的 `.nb-markdown`），这里不另写。
        case "paragraph": return h("p", inlineList(layout, token.tokens));
        case "heading": return h(HEADINGS[Math.min(Math.max((token.depth ?? 1) - 1, 0), 5)]!, inlineList(layout, token.tokens));
        case "list": return h(token.ordered === true ? "ol" : "ul", (token.items ?? []).map((item) => h("li", blockList(layout, item.tokens))));
        case "blockquote": return h("blockquote", blockList(layout, token.tokens));
        case "code": return h("pre", h("code", token.text ?? ""));
        case "hr": return h("hr");
        // 表格比内容列宽时在自己的框里横向滚动，不把页面撑出横向滚动条。
        case "table": return h("div", {class: "overflow-x-auto"}, h("table", h("tbody", [token.header ?? [], ...(token.rows ?? [])].map((row) => h("tr", row.map((cell) => h("td", inlineList(layout, cell.tokens))))))));
        default: return inlineToken(layout, token);
    }
}

function inlineToken(layout: LaidOutBlock, token: EntryTextToken): VNodeChild {
    switch (token.type) {
        // 正文里的实体（`&lt;`）在词法单元里还是原文，画成它表示的字；转义的字已经是那个字。
        case "text": return token.tokens !== undefined ? inlineList(layout, token.tokens) : decodeHTMLStrict(token.text ?? token.raw);
        case "escape": return token.text ?? "";
        case "strong": return h("strong", inlineList(layout, token.tokens));
        case "em": return h("em", inlineList(layout, token.tokens));
        case "del": return h("del", inlineList(layout, token.tokens));
        // HTML 形式的强调（`<strong>…</strong>` 等，编辑器写回读不回来的强调时用它）：与 Markdown 的写法画成同样的元素。
        case "htmlMark": return h(HTML_MARKS[String(token.tag)] ?? "span", inlineList(layout, token.tokens));
        case "codespan": return h("code", token.text ?? "");
        case "br":
        case "htmlBreak":
        case "html":
            return h("br");
        // 链接只显示文字，图片写说明。
        case "link": return inlineList(layout, token.tokens);
        case "image": return decodeHTMLStrict(token.text ?? "");
        case "entryTag": return tagNode(layout, typeof token.tag === "number" ? token.tag : -1);
        case "entryIf": return conditionNode(layout, token);
        default: return token.tokens !== undefined ? inlineList(layout, token.tokens) : token.raw;
    }
}

const muted = (content: string): VNodeChild => h("span", {class: "text-[var(--text-muted)]"}, content);

function tagNode(layout: LaidOutBlock, tag: number): VNodeChild {
    const value = layout.valueOf(tag);
    if (value === undefined) return null;
    if ("needsPlugin" in value) return muted(text("value.needsPlugin"));
    switch (value.tag) {
        case "V": return valueNode(value as VValue);
        case "Ref": {
            const ref = value as Extract<EntryTextValue, {tag: "Ref"}>;
            return refNode(ref.id, ref.name, ref.deleted);
        }
        case "Image": return muted((value as Extract<EntryTextValue, {tag: "Image"}>).caption);
        default: return null;
    }
}

function refNode(id: string, name: string, deleted: boolean): VNodeChild {
    if (deleted) return muted(name !== "" ? name : text("value.deletedRef"));
    return h("button", {type: "button", class: "text-[var(--accent-main)] hover:underline", onClick: () => emit("entry", id)}, name);
}

/** 条件：画生效的那一支；没有生效的支时，有判断未知就写“未知”（警告色），都不成立就什么都不画。 */
function conditionNode(layout: LaidOutBlock, token: EntryTextToken): VNodeChild {
    const branches = token.branches ?? [];
    const head = layout.valueOf(branches[0]?.head ?? -1) as Extract<EntryTextValue, {result: unknown}> | undefined;
    const taken = head?.taken ?? null;
    if (taken !== null) return inlineList(layout, branches[taken]?.tokens);
    const unknown = branches.some((branch) => {
        const value = layout.valueOf(branch.head);
        return value !== undefined && "result" in value && value.result === null;
    });
    return unknown ? h("span", {class: "text-[var(--status-warning)]"}, text("value.unknown")) : null;
}

function valueNode(node: VValue): VNodeChild {
    // 读不到的值：带说明的一句（canon.rendering 输出 6）；算出来的值不可点，悬停是式子原文；图片写说明；值是引用的同条目引用。
    if (node.unavailable !== undefined) return muted(node.unavailable);
    if (node.expr !== undefined) return h("span", {class: "text-[var(--text-secondary)]", title: node.expr}, node.unknown === true ? text("value.unknown") : node.display);
    if (node.image !== undefined) return muted(node.image.caption);
    const address: TextAddress = {entry: node.entry ?? props.self, path: node.path ?? ""};
    const place = placeKey(renderingBlock, node.start, address);
    const open = props.open === place;
    const shown = node.unknown === true ? text("value.unknown") : node.display;
    const mark = address.entry === props.self ? props.marks[address.path] : undefined;
    const warn = node.unknown === true || node.incomplete !== undefined;
    return [
        h("button", {
            "type": "button",
            "class": ["canon-value", warn ? "text-[var(--status-warning)]" : "", open ? "canon-value-open" : ""],
            "aria-haspopup": "dialog",
            "aria-expanded": open,
            "aria-label": text("value.label", {label: node.label ?? address.path, value: shown}),
            "data-value": `${address.entry}|${address.path}`,
            "data-place": place,
            "data-label": node.label ?? address.path,
            "onClick": () => emit("value", place),
        }, shown),
        node.incomplete === undefined ? null : h("span", {class: "ml-1 text-[length:var(--text-xs)] text-[var(--status-warning)]"}, text("value.incomplete")),
        mark === undefined ? null : h("span", {class: "ml-1 text-[length:var(--text-xs)] text-[var(--text-muted)]"}, mark),
    ];
}

/**
 * 每块读好、对好的结果，按块对象留着：块的数据不变（换了内容的块是新对象），父组件为了别的 prop 重画、或找来历画在哪块时不重新分词。
 */
type SourceBlock = Extract<EntryTextBlock, {source: string}>;
const layouts = new WeakMap<SourceBlock, ReturnType<typeof layoutBlock>>();
function layoutOf(block: SourceBlock): ReturnType<typeof layoutBlock> {
    let laid = layouts.get(block);
    if (laid === undefined) {
        laid = layoutBlock(block.source, block.values);
        layouts.set(block, laid);
    }
    return laid;
}

const failedBlock = (body: string, reason: string): VNodeChild => h("div", {"class": "my-2", "data-block-error": ""}, [
    h("p", {class: "whitespace-pre-wrap"}, body),
    h("p", {class: "text-[length:var(--text-xs)] text-[var(--status-danger)]"}, text("value.blockFailed", {reason})),
]);

const Block = defineComponent({
    name: "EntryTextBlock",
    props: {block: {type: Object as PropType<EntryTextBlock>, required: true}},
    setup(blockProps) {
        return () => {
            const block = blockProps.block;
            if ("error" in block) return failedBlock(block.text, block.error.message);
            const laid = layoutOf(block);
            // 值表与源文对不上（前后端的文法不是同一版这类）：整块按出错显示，不按位置猜。
            if ("mismatch" in laid) return failedBlock(block.source, laid.mismatch);
            // 值按钮要知道自己在哪一块（“哪一处”的键）：渲染函数同步执行，画这一块期间记在模块里。
            renderingBlock = block.id;
            try {
                return h("div", {"class": "nb-markdown", "data-block": block.id}, blockList(laid, laid.tokens));
            } finally {
                renderingBlock = "";
            }
        };
    },
});

/* ---------- 来历的浮层（输出 11） ---------- */

const root = ref<HTMLElement | null>(null);
/** 开着的那一处的值按钮：浮层锚在它上面。画完才找得到（块是渲染函数画的）。 */
const anchor = shallowRef<HTMLElement | null>(null);
/**
 * 交给浮层的锚点：关上以后还留着上一个。按 Esc 关上时宿主马上清掉记下的那一处（`anchor` 随之为空），原语却要等浮层卸下才把
 * 焦点还给锚点，那时它得还在。
 */
const held = shallowRef<HTMLElement | null>(null);
watch(anchor, (now) => {
    if (now !== null) held.value = now;
});
/**
 * 作者点到条目页外面（标签条、设定树）时浮层只收起，记下的那一处留着：切到别的标签再回来（重新挂上）时照它打开。
 * 页面里点别处、按 Esc 才清掉（发 `close`）。
 */
const collapsed = ref(false);
/** 最近一次按下落在哪：浮层关上时据此分辨点的是页面里还是页面外。 */
let pressed: EventTarget | null = null;
let escaped = false;
const press = (event: PointerEvent): void => {
    pressed = event.target;
};
onMounted(() => document.addEventListener("pointerdown", press, true));
onBeforeUnmount(() => document.removeEventListener("pointerdown", press, true));
onActivated(() => {
    collapsed.value = false;
});

const findAnchor = (): void => {
    const place = props.open;
    anchor.value = place === undefined ? null : (root.value?.querySelector<HTMLElement>(`[data-place="${CSS.escape(place)}"]`) ?? null);
    // 记着的那一处已经不在了（块改了、值换了）：清掉。块还没读到（空的）时不算。
    if (place !== undefined && anchor.value === null && props.blocks.length > 0) emit("close");
};
// 换了开着的那一处：先前收起的作废。块变了（重读、世界变了）：重新找按钮，找不到就清掉。
watch(() => props.open, () => {
    collapsed.value = false;
});
watch(() => [props.open, props.blocks], () => void nextTick(findAnchor), {immediate: true});

const openAddress = (): TextAddress | null => (props.open === undefined ? null : placeAddress(props.open));

/**
 * 浮层的边在打开时按值按钮上下哪边地方大选定，之后内容变高（再显示更早的、重读）不换边：避让只在这一边上挪，免得读回来时整个翻过去。
 */
const side = shallowRef<"bottom" | "top">("bottom");
watch(anchor, (now) => {
    if (now === null) return;
    const rect = now.getBoundingClientRect();
    side.value = window.innerHeight - rect.bottom >= rect.top || window.innerHeight - rect.bottom >= window.innerHeight * 0.6 ? "bottom" : "top";
});

const onPopover = (open: boolean): void => {
    if (open) return;
    const page = root.value?.closest("[data-entry-page]") ?? root.value;
    const inPage = escaped || (pressed instanceof Node && page !== null && page !== undefined && page.contains(pressed));
    escaped = false;
    if (inPage) emit("close");
    else collapsed.value = true;
};
const markEscape = (): void => {
    escaped = true;
};
</script>

<template>
    <div ref="root" class="entry-text min-w-0 text-[var(--text-main)]" data-entry-text>
        <!--
            根上只能有这一个元素，注释也要写在它里面：开发构建保留模板里的注释，根上多一条注释，组件的根就成了片段。条目页把本
            组件直接放在先出后进的 `Transition` 里，根是片段时退场收不了尾，换上来的编辑视图一直不出现（生产构建剥掉注释，看不出来）。
        -->
        <!-- 能点的是阅读视图（`data-entry-text`）；不能点的是编辑时的预览，另一个标记：找“回到阅读视图了没有”的地方不该认到它。 -->
        <div v-if="props.blocks.length === 0" class="my-2 flex flex-col items-start gap-3">
            <p class="text-[var(--text-muted)]" data-text-empty>{{ text("block.empty") }}</p>
            <Button v-if="props.editable" variant="primary" :disabled="props.editReason !== ''" :title="props.editReason !== '' ? props.editReason : undefined" data-text-edit @click="emit('edit')">{{ text("textEdit.start") }}</Button>
        </div>
        <div v-else-if="props.editable" class="flex justify-end">
            <Button size="sm" variant="ghost" :disabled="props.editReason !== ''" :title="props.editReason !== '' ? props.editReason : undefined" data-text-edit @click="emit('edit')">
                <span class="i-lucide-pencil-line mr-1 size-3.5" aria-hidden="true" />{{ text("textEdit.edit") }}
            </Button>
        </div>
        <section v-for="block in props.blocks" :key="block.id" class="entry-text__block">
            <Block :block="block" />
        </section>
        <Popover :open="anchor !== null && !collapsed" :anchor="held" :side="side" align="start" @update:open="onPopover">
            <section
                v-if="anchor !== null && openAddress() !== null"
                class="entry-text__origin"
                tabindex="0"
                :aria-label="text('origin.dialog', {label: anchor.dataset.label ?? ''})"
                data-origin-popover
                @keydown.esc="markEscape"
            >
                <slot name="origin" :address="openAddress()!" />
            </section>
        </Popover>
    </div>
</template>

<style scoped>
/*
 * 正文的样子与章节一致（`@notnotype/nb-markdown/markdown.css`）：字号、行距、段距取章节纸面的缺省值（不跟“Markdown 正文”
 * 的设置：那是编辑器插件给章节控件的）。块与块之间同样隔一个段距：段距在块里按正文的字号算，这里照同一个字号算。
 */
.entry-text {
    --markdown-font-size: 17px;
    --markdown-line-height: 1.95;
    --markdown-block-gap: 1.1em;
}
.entry-text__block + .entry-text__block {
    margin-top: calc(var(--markdown-font-size) * 1.1);
}
:deep(.canon-value) {
    border-bottom: 1px dotted var(--accent-main);
    padding: 0 1px;
    cursor: pointer;
}
:deep(.canon-value:hover),
:deep(.canon-value-open) {
    background: var(--bg-hover);
    border-radius: 3px;
}
.entry-text__origin {
    width: min(416px, calc(100vw - 56px));
    max-height: 60vh;
    overflow-y: auto;
    /* 来历读取期间先占三行的高度，读回来时浮层不跳。 */
    min-height: 5.5rem;
    line-height: 1.5rem;
    user-select: text;
    border-radius: 4px;
    outline: none;
}
/* 打开时焦点先落在浮层这一块上（读屏读出“某某的来历”）：用键盘时看得到焦点在哪。 */
.entry-text__origin:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
}
:deep(.canon-value:focus-visible) {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
}
</style>
