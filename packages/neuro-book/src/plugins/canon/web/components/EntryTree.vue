<script setup lang="ts">
import {computed} from "vue";

import {Banner, Button, Tree} from "@notnotype/nb-ui/components";
import type {GenericTreeNode} from "@notnotype/nb-ui/components";

import {useCanonText} from "../text";
import type {EntryTreeItem, EntryTreeLayer} from "./entry-tree";

const props = defineProps<{
    layers: Readonly<Record<string, EntryTreeLayer>>;
    expanded: readonly string[];
    selected?: string;
    disconnected?: boolean;
}>();

const emit = defineEmits<{
    (event: "open", id: string): void;
    (event: "update:expanded", value: string[]): void;
    (event: "more", parent: string | null): void;
    (event: "retry"): void;
}>();

const text = useCanonText();

// 树里除了条目还有三种行，id 带前缀与条目 id 分开：条目 id 由内核给出，不含冒号前缀这种写法。
const FOLDER = "folder:";
const MORE = "more:";
const LOADING = "loading:";
const ROOT = "";

/** 行尾的说明：已删除优先于未出场（已删除的条目不再谈出不出场）。 */
const noteOf = (item: EntryTreeItem): string | null => (item.deleted ? text("entries.deleted") : item.appeared ? null : text("entries.unappeared"));
const notes = computed(() => {
    const map = new Map<string, string>();
    for (const layer of Object.values(props.layers)) {
        for (const item of layer.items) {
            const note = noteOf(item);
            if (note !== null) map.set(item.id, note);
        }
    }
    return map;
});

/** 一层的行：读到的条目，加上“再显示”；展开了还没读到的一层只有一行“读取中”。 */
function layerNodes(parent: string): GenericTreeNode[] {
    const layer = props.layers[parent];
    if (layer === undefined || (layer.loading && layer.items.length === 0)) return [{id: `${LOADING}${parent}`, title: text("entries.loading"), muted: true}];
    const nodes = layer.items.map(entryNode);
    if (layer.remaining > 0) nodes.push({id: `${MORE}${parent}`, title: text("entries.more", {count: layer.remaining}), muted: true});
    return nodes;
}

function entryNode(item: EntryTreeItem): GenericTreeNode {
    const node: GenericTreeNode = {id: item.id, title: item.name, ...(item.appeared && !item.deleted ? {} : {muted: true})};
    if (!item.hasChildren) return node;
    // 没展开的有子条目的行给空的子项：`Tree` 据此画展开箭头，展开时宿主才去读那一层。
    return {...node, children: props.expanded.includes(item.id) ? layerNodes(item.id) : []};
}

/** 根这一层按分组插分组行；分组按它的第一个条目在根里出现的先后，没有分组的条目留在原位。 */
const items = computed<GenericTreeNode[]>(() => {
    const root = props.layers[ROOT];
    if (root === undefined || root.items.length === 0) return [];
    const nodes: GenericTreeNode[] = [];
    const folders = new Map<string, GenericTreeNode[]>();
    for (const item of root.items) {
        if (item.folder === "") {
            nodes.push(entryNode(item));
            continue;
        }
        let children = folders.get(item.folder);
        if (children === undefined) {
            children = [];
            folders.set(item.folder, children);
            nodes.push({id: `${FOLDER}${item.folder}`, title: item.folder, children});
        }
        children.push(entryNode(item));
    }
    if (root.remaining > 0) nodes.push({id: `${MORE}${ROOT}`, title: text("entries.more", {count: root.remaining}), muted: true});
    return nodes;
});

const rootState = computed<"loading" | "empty" | "tree">(() => {
    const root = props.layers[ROOT];
    if (root === undefined || (root.loading && root.items.length === 0)) return "loading";
    return root.items.length === 0 ? "empty" : "tree";
});

function select(node: GenericTreeNode): void {
    if (node.id.startsWith(MORE)) {
        const parent = node.id.slice(MORE.length);
        emit("more", parent === ROOT ? null : parent);
        return;
    }
    if (node.id.startsWith(FOLDER) || node.id.startsWith(LOADING)) return;
    emit("open", node.id);
}
</script>

<template>
    <div class="min-w-0">
        <Banner v-if="props.disconnected" tone="warning" role="status" class="m-2" :message="text('world.disconnected')">
            <template #actions><Button size="sm" @click="emit('retry')">{{ text("world.retry") }}</Button></template>
        </Banner>
        <p v-if="rootState === 'loading'" class="px-3 py-2 text-[length:var(--text-sm)] text-[var(--text-muted)]">{{ text("entries.loading") }}</p>
        <p v-else-if="rootState === 'empty'" class="px-3 py-2 text-[length:var(--text-sm)] text-[var(--text-muted)]">{{ text("entries.empty") }}</p>
        <Tree
            v-else
            :aria-label="text('entries.label')"
            :items="items"
            :expanded="[...props.expanded]"
            :model-value="props.selected"
            surface="plain"
            @select="select"
            @update:expanded="(value: string[]) => emit('update:expanded', value)"
        >
            <template #suffix="{node}">{{ notes.get(node.id) ?? "" }}</template>
        </Tree>
    </div>
</template>
