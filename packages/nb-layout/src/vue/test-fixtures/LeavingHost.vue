<script setup lang="ts">
/**
 * `NestedGrid.dom.test.ts` 的“离开的内容”（docs/specs/ui/nested-grid.md 输出 155、156）：SFC 编译的插槽（`v-if`、`v-for`、`Transition`、子组件）。
 * 一行叶 x、y、z 加一列 col（p 在上、q 在下），x、y、z、p 各一个内容项，q 没有；面板头读 `heads`，内容读 `store`。
 * `close` 在同一个同步段里去掉叶、内容项和两份数据，像关掉一张卡片；`closeColumn` 同样关掉整列。
 * 日志 `log` 记每次插槽调用，是普通数组，模板里写它不引起重渲染。
 */
import {computed, reactive, shallowRef} from "vue";

import {createGrid} from "../../grid";
import type {GridContentInput} from "../../grid-rects";
import type {GridNodeInput} from "../../grid-types";
import NestedGrid from "../NestedGrid.vue";
import LeavingCard from "./LeavingCard.vue";
import SlotTaker from "./SlotTaker.vue";

const props = defineProps<{retain: boolean; byKeyInChildSlot?: boolean}>();
const emit = defineEmits<{parked: [key: string]}>();
type Card = {title: string; items: string[]};
const IDS = ["x", "y", "z"] as const;
const fresh = (id: string): Card => ({title: id.toUpperCase(), items: id === "y" ? ["y1", "y2"] : [`${id}1`]});
const store = reactive<Record<string, Card | undefined>>(Object.fromEntries(IDS.map((id) => [id, fresh(id)])));
const heads = reactive<Record<string, string | undefined>>(Object.fromEntries([...IDS, "p", "q"].map((id) => [id, `h${id}`])));
store.p = fresh("p");
/** 那一列还在吗。 */
const column = shallowRef(true);
/** 宿主发布的容器宽度（`layout()` 的根尺寸）。 */
const width = shallowRef(1000);
/** 叶与它的内容项（`content` 为 null 是叶在、内容项被去掉了）。 */
const cards = shallowRef<ReadonlyArray<{id: string; content: string | null}>>(IDS.map((id) => ({id, content: id})));
/** 收起的叶（保留像素、收起到 0）。 */
const collapsed = shallowRef<ReadonlySet<string>>(new Set());
/** 区域隐藏：叶不在树里，内容项还在（挂在找不到的叶上，停放）。 */
const hidden = shallowRef<ReadonlySet<string>>(new Set());

const COLUMN: GridNodeInput<string> = {kind: "branch", id: "col", orientation: "vertical", size: {width: 150, height: 0}, sizing: "fixed", children: [
    {kind: "leaf", id: "p", ref: "p", size: {width: 0, height: 300}},
    {kind: "leaf", id: "q", ref: "q", size: {width: 0, height: 300}},
]};
const grid = computed(() => createGrid<string>({kind: "branch", id: "root", orientation: "horizontal", children: [...cards.value.filter((card) => !hidden.value.has(card.id)).map((card): GridNodeInput<string> => ({
    kind: "leaf", id: card.id, ref: card.id, size: {width: 250, height: 0}, sizing: card.id === "z" ? "weight" : "fixed",
    collapse: {collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24, collapsed: collapsed.value.has(card.id)},
})), ...(column.value ? [COLUMN] : [])]}, {sashSize: 1}));
const layout = computed(() => grid.value.layout({width: width.value, height: 600}));
const retainFlag = (): {leave?: "retain"} => (props.retain ? {leave: "retain"} : {});
const contents = computed<GridContentInput[]>(() => [
    ...cards.value.flatMap((card) => (card.content === null ? [] : [{key: card.content, leaf: card.id, insetTop: 32, active: true, ...retainFlag()}])),
    ...(column.value ? [{key: "p", leaf: "p", insetTop: 32, active: true, ...retainFlag()}] : []),
]);
const log: string[] = [];

/** 再发布一次同样的布局：第一次布局回调只记尺寸、不过渡。 */
function refresh(): void {
    cards.value = [...cards.value];
}
function close(id: string): void {
    cards.value = cards.value.filter((card) => card.id !== id);
    delete store[id];
    delete heads[id];
}
function reopen(id: string, at: number): void {
    store[id] = fresh(id);
    heads[id] = `h${id}`;
    const next = [...cards.value];
    next.splice(at, 0, {id, content: id});
    cards.value = next;
}
/** 叶不动，换掉它的内容项（旧的数据同时删掉）。 */
function swapContent(leaf: string, content: string): void {
    store[content] = {title: content.toUpperCase(), items: []};
    const old = cards.value.find((card) => card.id === leaf)?.content;
    cards.value = cards.value.map((card) => (card.id === leaf ? {id: leaf, content} : card));
    if (old != null) delete store[old];
}
/** 叶收起到 0，同一轮去掉它的内容项与数据。 */
function collapseAndDrop(id: string): void {
    collapsed.value = new Set([...collapsed.value, id]);
    cards.value = cards.value.map((card) => (card.id === id ? {id, content: null} : card));
    delete store[id];
}
/** 区域隐藏：叶离开树，内容项还在，数据都在。 */
function hide(id: string): void {
    hidden.value = new Set([...hidden.value, id]);
}
/** 关掉整列：p 的内容项、两块叶的面板头数据同一个同步段里删掉（q 没有内容项）。 */
function closeColumn(): void {
    column.value = false;
    delete store.p;
    delete heads.p;
    delete heads.q;
}
/** 宿主发布的容器宽度变了（窗口缩放）。 */
function resizeTo(next: number): void {
    width.value = next;
}
defineExpose({refresh, close, reopen, swapContent, collapseAndDrop, hide, closeColumn, resizeTo, log});
</script>

<template>
    <NestedGrid :node="grid.root()" :layout="layout" :contents="contents" @content-parked="(key: string) => emit('parked', key)">
        <template #leaf="{node}"><span :data-head="node.id">{{ (log.push(`head:${node.id}`), heads[node.id]!) }}</span></template>
        <template #content="{contentKey}">
            <div :data-body="contentKey">
                <button :data-focus="contentKey">{{ (log.push(`slot:${contentKey}`), store[contentKey]!.title) }}</button>
                <span v-if="store[contentKey]!.items.length > 1">many</span>
                <i v-for="item in store[contentKey]!.items" :key="item">{{ item }}</i>
                <LeavingCard :id="contentKey" :card="store[contentKey]!" :log="log" />
                <SlotTaker v-if="byKeyInChildSlot">{{ store[contentKey]!.title }}</SlotTaker>
            </div>
        </template>
    </NestedGrid>
</template>
