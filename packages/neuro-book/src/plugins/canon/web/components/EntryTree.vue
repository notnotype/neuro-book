<script setup lang="ts">
import {computed, shallowRef} from "vue";

import {Banner, Button, ContextMenu, EmptyState, Tree} from "@notnotype/nb-ui/components";
import type {GenericTreeNode} from "@notnotype/nb-ui/components";

import {useCanonText} from "../text";
import type {EntryTreeItem, EntryTreeLayer} from "./entry-tree";

const props = withDefaults(defineProps<{
    layers: Readonly<Record<string, EntryTreeLayer>>;
    expanded: readonly string[];
    selected?: string;
    disconnected?: boolean;
    /** 有右键菜单“在它下面新建”，空着时是带新建按钮的空状态；默认 false。 */
    creatable?: boolean;
    /** 现在不能写：空状态的按钮禁用，悬停提示是它。 */
    blockedReason?: string;
    /** 空状态里有“新建人物”（“人物”这个种类登记了）；默认 true。 */
    createPerson?: boolean;
}>(), {createPerson: true});

const emit = defineEmits<{
    (event: "open", id: string): void;
    (event: "update:expanded", value: string[]): void;
    (event: "more", parent: string | null): void;
    (event: "retry"): void;
    /** 右键菜单里的“在它下面新建”；`parent` 为 null 是在根这一层（空白处右键）。只在宿主接了它时有菜单。 */
    (event: "create", parent: string | null): void;
    /** 空状态的“新建人物”。 */
    (event: "create-person"): void;
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
    if (node.id.startsWith(LOADING)) return;
    // 分组行打不开：点它是展开或收起（树按 `arrow` 只认箭头切换展开，这一种行由这里补上）。
    if (node.id.startsWith(FOLDER)) {
        emit("update:expanded", props.expanded.includes(node.id) ? props.expanded.filter((id) => id !== node.id) : [...props.expanded, node.id]);
        return;
    }
    emit("open", node.id);
}

/* 右键菜单（输出 4、5）：右键一行、或焦点在一行上按菜单键与 Shift+F10。分组、“再显示”“读取中”这几种行不是条目，按空白处算。 */
const menu = shallowRef<{x: number; y: number; parent: string | null} | null>(null);
const rowIdOf = (target: EventTarget | null): string | null => {
    const id = (target instanceof Element ? target.closest("[data-tree-id]") : null)?.getAttribute("data-tree-id") ?? null;
    return id === null || id.startsWith(FOLDER) || id.startsWith(MORE) || id.startsWith(LOADING) ? null : id;
};
const openMenu = (event: MouseEvent): void => {
    event.preventDefault();
    menu.value = {x: event.clientX, y: event.clientY, parent: rowIdOf(event.target)};
};
const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
    event.preventDefault();
    const row = event.target instanceof Element ? event.target.closest("[data-tree-id]") : null;
    const box = row?.getBoundingClientRect();
    menu.value = {x: box?.left ?? 0, y: box?.bottom ?? 0, parent: rowIdOf(event.target)};
};
const menuItems = computed(() => [{label: text("entries.createUnder"), iconClass: "i-lucide-plus", action: () => emit("create", menu.value?.parent ?? null)}]);
</script>

<template>
    <div class="min-w-0" @contextmenu="props.creatable && openMenu($event)" @keydown="props.creatable && onKeydown($event)">
        <Banner v-if="props.disconnected" tone="warning" role="status" :message="text('world.disconnected')">
            <template #actions><Button variant="primary" size="sm" @click="emit('retry')">{{ text("world.retry") }}</Button></template>
        </Banner>
        <p v-if="rootState === 'loading'" class="px-3 py-2 text-[length:var(--text-sm)] text-[var(--text-muted)]">{{ text("entries.loading") }}</p>
        <EmptyState
            v-else-if="rootState === 'empty' && props.creatable"
            icon-class="i-lucide-book-open"
            :title="text('entries.emptyTitle')"
            :description="text('entries.emptyHint')"
            data-entries-empty
        >
            <template #action>
                <div class="flex flex-wrap justify-center gap-[var(--space-2)]">
                    <Button v-if="props.createPerson" variant="primary" :disabled="props.blockedReason !== undefined && props.blockedReason !== ''" :title="props.blockedReason || undefined" @click="emit('create-person')">{{ text("entries.createPerson") }}</Button>
                    <Button :variant="props.createPerson ? 'secondary' : 'primary'" :disabled="props.blockedReason !== undefined && props.blockedReason !== ''" :title="props.blockedReason || undefined" @click="emit('create', null)">{{ text("entries.createEntry") }}</Button>
                </div>
            </template>
        </EmptyState>
        <p v-else-if="rootState === 'empty'" class="px-3 py-2 text-[length:var(--text-sm)] text-[var(--text-muted)]">{{ text("entries.empty") }}</p>
        <Tree
            v-else
            :aria-label="text('entries.label')"
            :items="items"
            :expanded="[...props.expanded]"
            :model-value="props.selected"
            surface="plain"
            toggle-on="arrow"
            @select="select"
            @update:expanded="(value: string[]) => emit('update:expanded', value)"
        >
            <template #suffix="{node}">{{ notes.get(node.id) ?? "" }}</template>
        </Tree>
        <ContextMenu v-if="menu !== null" :open="true" :x="menu.x" :y="menu.y" :items="menuItems" @request-close="menu = null" />
    </div>
</template>
