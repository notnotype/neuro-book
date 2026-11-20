<script setup lang="ts">
/**
 * 条目的文字分页（docs/specs/canon/author-ui.md 输出 10）。块是世界服务给作者的渲染（canon.rendering 输出 7）：mdast 的语法树，
 * 表达式已经换成算好的 canon 节点。条目 MDX 不许 import、export，节点种类有限，这里自己递归画；认不出的节点画它的子节点或文字。
 * 页面的 h1 是条目名，文字里的标题降一级（`#` 画成 h2）。
 */
import {computed, defineComponent, h} from "vue";
import type {PropType, VNodeChild} from "vue";

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
    /** 每一块旁边出“改这一段”“删掉这一段”，文末出“加一段”（输出 9、10）。 */
    editable?: boolean;
    /** 不能写的原因：非空时这几个按钮不可用，悬停写原因。 */
    editReason?: string;
}>(), {marks: () => ({}), open: undefined, editable: false, editReason: ""});

const emit = defineEmits<{
    /** 点了一个值：展开或收起它的来历。 */
    (event: "value", address: TextAddress): void;
    /** 点了一个条目引用。 */
    (event: "entry", id: string): void;
    /** 一块的“改这一段”“删掉这一段”，文末的“加一段”。 */
    (event: "edit-block", id: string): void;
    (event: "remove-block", id: string): void;
    (event: "add-block"): void;
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

function renderNode(node: EntryTextNode): VNodeChild {
    switch (node.type) {
        case "text": return node.value ?? "";
        case "paragraph": return h("p", {class: "my-2"}, children(node));
        case "heading": return h(HEADINGS[Math.min(Math.max((node.depth ?? 1) - 1, 0), 5)]!, {class: "mb-1 mt-4 text-[length:var(--text-md)] font-semibold"}, children(node));
        case "list": return h(node.ordered === true ? "ol" : "ul", {class: node.ordered === true ? "my-2 list-decimal pl-6" : "my-2 list-disc pl-6"}, children(node));
        case "listItem": return h("li", children(node));
        case "blockquote": return h("blockquote", {class: "my-2 border-l-2 border-[var(--divider)] pl-3 text-[var(--text-secondary)]"}, children(node));
        case "emphasis": return h("em", children(node));
        case "strong": return h("strong", children(node));
        case "delete": return h("del", children(node));
        case "inlineCode": return h("code", {class: "font-mono"}, node.value ?? "");
        case "code": return h("pre", {class: "my-2 overflow-x-auto font-mono text-[length:var(--text-sm)]"}, h("code", node.value ?? ""));
        case "break": return h("br");
        case "thematicBreak": return h("hr", {class: "my-3 border-[var(--divider)]"});
        case "table": return h("table", {class: "my-2 border-collapse"}, h("tbody", children(node)));
        case "tableRow": return h("tr", children(node));
        case "tableCell": return h("td", {class: "border border-[var(--divider)] px-2 py-1"}, children(node));
        case "image": return node.alt ?? "";
        case "canonValue": return valueNode(node);
        case "canonComputed": return h("span", {class: "text-[var(--text-secondary)]", title: node.source}, node.display ?? "");
        case "canonPlaceholder": return h("span", {class: "text-[var(--text-muted)]"}, node.reason ?? "");
        case "canonRef": return node.deleted === true
            ? h("span", {class: "text-[var(--text-muted)]"}, node.name !== undefined && node.name !== "" ? node.name : text("value.deletedRef"))
            : h("button", {type: "button", class: "text-[var(--accent-main)] hover:underline", onClick: () => emit("entry", node.id!)}, node.name ?? "");
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
            return h("div", {"data-block": block.id}, children(block.tree));
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
    <div class="min-w-0 text-[length:var(--text-md)] leading-8 text-[var(--text-main)]" data-entry-text>
        <p v-if="props.blocks.length === 0" class="my-2 text-[var(--text-muted)]" data-text-empty>{{ text("block.empty") }}</p>
        <section v-for="(block, index) in props.blocks" :key="block.id" class="group/block relative">
            <div v-if="props.editable" class="flex justify-end gap-1 opacity-60 group-hover/block:opacity-100 group-focus-within/block:opacity-100" :data-block-actions="block.id">
                <Button size="sm" variant="ghost" :disabled="props.editReason !== ''" :title="props.editReason !== '' ? props.editReason : undefined" :aria-label="text('block.editLabel', {index: index + 1})" @click="emit('edit-block', block.id)">{{ text("block.edit") }}</Button>
                <Button size="sm" variant="ghost" :disabled="props.editReason !== ''" :title="props.editReason !== '' ? props.editReason : undefined" :aria-label="text('block.removeLabel', {index: index + 1})" @click="emit('remove-block', block.id)">{{ text("block.remove") }}</Button>
            </div>
            <Block :block="block" />
            <div v-if="block.id === originBlock" class="my-2 rounded-[var(--radius-control)] bg-[var(--bg-subtle)] px-3 py-2 leading-6">
                <slot name="origin" :address="openAddress()!" />
            </div>
        </section>
        <Button v-if="props.editable" class="mt-2" size="sm" variant="ghost" :disabled="props.editReason !== ''" :title="props.editReason !== '' ? props.editReason : undefined" data-add-block @click="emit('add-block')">{{ text("block.add") }}</Button>
    </div>
</template>

<style scoped>
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
:deep(.canon-value:focus-visible) {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
}
</style>
