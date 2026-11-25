<script setup lang="ts">
/**
 * NestedGrid 离开的内容由库留到过渡结束（docs/specs/ui/nested-grid.md 输出 155、156，断言在 e2e/lab-grid-leaving.e2e.ts）。
 * 夹具自己扮演宿主：一行四张卡，关一张就在同一个同步段里去掉它的叶、内容项和数据，像 nb-story 关掉一张详情卡。
 * a、b、c 的内容项标了 `leave: "retain"`，d 没标（缺省当即卸载）。面板头读一张会被删的表；卡片正文经属性交给子组件，是推荐的写法。
 */
import {computed, reactive, shallowRef} from "vue";

import {createGrid} from "@notnotype/nb-layout";
import type {Grid, GridContentInput} from "@notnotype/nb-layout";
import {NestedGrid, useGridHost} from "@notnotype/nb-layout/vue";

import GridLeavingCard from "./GridLeavingCard.vue";

const HEAD = 28;
const ALL = ["a", "b", "c", "d"] as const;
const RETAINED: ReadonlySet<string> = new Set(["a", "b", "c"]);

type Card = {readonly title: string; readonly body: string};
const fresh = (id: string): Card => ({title: `卡片 ${id.toUpperCase()}`, body: `${id.toUpperCase()} 的正文`});
const cards = reactive<Record<string, Card | undefined>>(Object.fromEntries(ALL.map((id) => [id, fresh(id)])));
const order = shallowRef<readonly string[]>(ALL);

const grid = computed<Grid<string>>(() => createGrid<string>({
    kind: "branch",
    id: "root",
    orientation: "horizontal",
    children: order.value.map((id) => ({kind: "leaf", id, ref: id, size: {width: 1, height: 0}})),
}, {sashSize: 4}));
const host = useGridHost<string>({
    grid,
    contextKey: "leaving",
    // 用 debug 不用 warn：lab-scenes 按手机宽度跑这个场景，放不下是正常结果，不是接线错误。
    onIssues: (issues) => console.debug("[lab] nb-layout issues", issues),
});

const contents = computed<GridContentInput[]>(() => order.value.map((id) => ({key: id, leaf: id, insetTop: HEAD, active: true, ...(RETAINED.has(id) ? {leave: "retain" as const} : {})})));

function close(id: string): void {
    order.value = order.value.filter((item) => item !== id);
    // 数据与叶、内容项同一个同步段里删：留着的内容不能再去读它。
    delete cards[id];
}

function reset(): void {
    for (const id of ALL) cards[id] = fresh(id);
    order.value = ALL;
}
</script>

<template>
    <div class="grid-leaving-scene">
        <div class="grid-leaving-scene__actions">
            <button v-for="id in ALL" :key="id" type="button" :data-leaving-action="`close-${id}`" :disabled="!order.includes(id)" @click="close(id)">关 {{ id }}</button>
            <button type="button" data-leaving-action="reset" @click="reset">还原</button>
        </div>
        <div class="grid-leaving-scene__grid">
            <NestedGrid data-lab-subject v-bind="host.bindings.value" :contents="contents">
                <template #leaf="{node}">
                    <div class="grid-leaving-scene__head" :data-leaving-head="node.id">{{ cards[node.id]!.title }}</div>
                </template>
                <template #content="{contentKey}">
                    <GridLeavingCard :id="contentKey" :card="cards[contentKey]!" />
                </template>
            </NestedGrid>
        </div>
    </div>
</template>

<style scoped>
.grid-leaving-scene {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    height: 100%;
    padding: 8px;
}

.grid-leaving-scene__actions {
    display: flex;
    gap: 8px;
}

.grid-leaving-scene__grid {
    flex: 1;
    min-height: 360px;
}

.grid-leaving-scene__head {
    height: 28px;
    padding: 4px 8px;
    background: rgb(230, 230, 230);
}
</style>
