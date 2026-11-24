<script setup lang="ts">
/**
 * 条目的文字分页（docs/specs/canon/author-ui.md 输出 10）。块是世界服务给作者的渲染（canon.rendering 输出 7）：mdast 的语法树，
 * 表达式已经换成算好的 canon 节点。条目 MDX 不许 import、export，节点种类有限，这里自己递归画；认不出的节点画它的子节点或文字。
 * 页面的 h1 是条目名，文字里的标题降一级（`#` 画成 h2）。
 */
import {computed, defineComponent, h} from "vue";
import type {PropType, VNodeChild} from "vue";

import "@notnotype/nb-markdown/markdown.css";

import {Button} from "@notnotype/nb-ui/components";

import type {EntryTextBlock, EntryTextNode, TextAddress} from "./entry-text";
import {addressKey} from "./entry-text";
import {useCanonText} from "../text";

const props = withDefaults(defineProps<{
    blocks: readonly EntryTextBlock[];
    /** 这个条目的 id：值节点不写条目时指它自己。 */
    self: string;
    /** 这个条目各字段的“改过”标记，按路径（输出 10）。 */
    marks?: Readonly<Record<string, string>>;
    /** 展开着来历的值（`addressKey`）；没有时不写。 */
    open?: string;
    /** 右上出“编辑”（没有主文字时是“开始写”）：进整篇的编辑（输出 39）。 */
    editable?: boolean;
    /** 不能进编辑的原因：非空时那个按钮不可用，悬停写原因。 */
    editReason?: string;
    /** 值与条目引用能点（展开来历、打开条目）。为假时它们只是文字：编辑时的预览用（输出 48）。默认 true。 */
    interactive?: boolean;
}>(), {marks: () => ({}), open: undefined, editable: false, editReason: "", interactive: true});

const emit = defineEmits<{
    /** 点了一个值：展开或收起它的来历。 */
    (event: "value", address: TextAddress): void;
    /** 点了一个条目引用。 */
    (event: "entry", id: string): void;
    /** 点了“编辑”或“开始写”。 */
    (event: "edit"): void;
}>();

defineSlots<{
    /** 展开着的值的来历，画在它所在的块后面。 */
    origin?(props: {address: TextAddress}): unknown;
}>();

const text = useCanonText();

function children(node: EntryTextNode): VNodeChild[] {
    return (node.children ?? []).map(renderNode);
}

const HEADINGS = ["h2", "h3", "h4", "h5", "h5", "h5"] as const;

/** 块一级的元素带着它在这一块源文字里的行号：预览跟着光标滚到对应的段落时按它找（输出 48）。 */
const line = (node: EntryTextNode): {"data-source-line"?: number} => (node.position === undefined ? {} : {"data-source-line": node.position.start.line});

function renderNode(node: EntryTextNode): VNodeChild {
    switch (node.type) {
        case "text": return node.value ?? "";
        // 段落、标题、列表、引用、代码、表格、分隔线的样子来自章节的正文样式（块的根上的 `.nb-markdown`），这里不另写。
        case "paragraph": return h("p", line(node), children(node));
        case "heading": return h(HEADINGS[Math.min(Math.max((node.depth ?? 1) - 1, 0), 5)]!, line(node), children(node));
        case "list": return h(node.ordered === true ? "ol" : "ul", children(node));
        case "listItem": return h("li", line(node), children(node));
        case "blockquote": return h("blockquote", line(node), children(node));
        case "emphasis": return h("em", children(node));
        case "strong": return h("strong", children(node));
        case "delete": return h("del", children(node));
        case "inlineCode": return h("code", node.value ?? "");
        case "code": return h("pre", line(node), h("code", node.value ?? ""));
        case "break": return h("br");
        case "thematicBreak": return h("hr", line(node));
        // 表格比内容列宽时在自己的框里横向滚动，不把页面撑出横向滚动条。
        case "table": return h("div", {class: "overflow-x-auto", ...line(node)}, h("table", h("tbody", children(node))));
        case "tableRow": return h("tr", children(node));
        case "tableCell": return h("td", children(node));
        case "image": return node.alt ?? "";
        case "canonValue": return valueNode(node);
        case "canonComputed": return h("span", {class: "text-[var(--text-secondary)]", title: node.source}, node.display ?? "");
        case "canonPlaceholder": return h("span", {class: "text-[var(--text-muted)]"}, node.reason ?? "");
        case "canonRef":
            if (node.deleted === true) return h("span", {class: "text-[var(--text-muted)]"}, node.name !== undefined && node.name !== "" ? node.name : text("value.deletedRef"));
            if (!props.interactive) return h("span", {"class": "text-[var(--accent-main)]", "data-ref": node.id}, node.name ?? "");
            return h("button", {type: "button", class: "text-[var(--accent-main)] hover:underline", onClick: () => emit("entry", node.id!)}, node.name ?? "");
        case "canonImage": return h("span", {class: "text-[var(--text-muted)]"}, node.caption ?? "");
        default: return node.children !== undefined ? children(node) : (node.value ?? "");
    }
}

function valueNode(node: EntryTextNode): VNodeChild {
    const address: TextAddress = {entry: node.entry ?? props.self, path: node.path ?? ""};
    const key = addressKey(address);
    const shown = node.unknown === true ? text("value.unknown") : (node.display ?? "");
    const mark = address.entry === props.self ? props.marks[address.path] : undefined;
    const warn = node.unknown === true || node.incomplete !== undefined;
    // 不能点时是同样画法的文字，悬停写它是哪个字段。
    if (!props.interactive) {
        return [
            h("span", {"class": ["canon-value canon-value-static", warn ? "text-[var(--status-warning)]" : ""], "title": node.label ?? address.path, "data-value": key}, shown),
            node.incomplete === undefined ? null : h("span", {class: "ml-1 text-[length:var(--text-xs)] text-[var(--status-warning)]"}, text("value.incomplete")),
        ];
    }
    return [
        h("button", {
            "type": "button",
            "class": ["canon-value", warn ? "text-[var(--status-warning)]" : "", props.open === key ? "canon-value-open" : ""],
            "aria-expanded": props.open === key,
            "aria-label": text("value.label", {label: node.label ?? address.path, value: shown}),
            "data-value": key,
            "onClick": () => emit("value", address),
        }, shown),
        node.incomplete === undefined ? null : h("span", {class: "ml-1 text-[length:var(--text-xs)] text-[var(--status-warning)]"}, text("value.incomplete")),
        mark === undefined ? null : h("span", {class: "ml-1 text-[length:var(--text-xs)] text-[var(--text-muted)]"}, mark),
    ];
}

/** 一块里有没有展开着的那个值：来历画在这一块后面。 */
function contains(node: EntryTextNode, key: string): boolean {
    if (node.type === "canonValue") return addressKey({entry: node.entry ?? props.self, path: node.path ?? ""}) === key;
    return (node.children ?? []).some((child) => contains(child, key));
}

const Block = defineComponent({
    name: "EntryTextBlock",
    props: {block: {type: Object as PropType<EntryTextBlock>, required: true}},
    setup(blockProps) {
        return () => {
            const block = blockProps.block;
            if ("error" in block) {
                return h("div", {"class": "my-2", "data-block-error": ""}, [
                    h("p", {class: "whitespace-pre-wrap"}, block.text),
                    h("p", {class: "text-[length:var(--text-xs)] text-[var(--status-danger)]"}, text("value.blockFailed", {reason: block.error.message})),
                ]);
            }
            return h("div", {"class": "nb-markdown", "data-block": block.id}, children(block.tree));
        };
    },
});

/** 来历只画一份：同一个值在几块里都出现时，画在第一个含它的块后面。 */
const originBlock = computed(() => {
    const key = props.open;
    if (key === undefined) return null;
    return props.blocks.find((block) => !("error" in block) && contains(block.tree, key))?.id ?? null;
});

const openAddress = (): TextAddress | null => {
    if (props.open === undefined) return null;
    const split = props.open.indexOf("|");
    return {entry: props.open.slice(0, split), path: props.open.slice(split + 1)};
};
</script>

<template>
    <div class="entry-text min-w-0 text-[var(--text-main)]" :data-entry-text="props.interactive ? '' : undefined" :data-entry-preview="props.interactive ? undefined : ''">
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
            <div v-if="block.id === originBlock" class="my-2 rounded-[var(--radius-control)] bg-[var(--bg-subtle)] px-3 py-2 leading-6">
                <slot name="origin" :address="openAddress()!" />
            </div>
        </section>
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
:deep(.canon-value-static) {
    cursor: inherit;
}
:deep(.canon-value:not(.canon-value-static):hover),
:deep(.canon-value-open) {
    background: var(--bg-hover);
    border-radius: 3px;
}
:deep(.canon-value:focus-visible) {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
}
</style>
