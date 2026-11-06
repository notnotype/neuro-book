<script setup lang="ts">
/**
 * TabStrip 的场景：夹具持有标签与选中项，事件真的改得动；外观是最小的一份，只为看得出结构。事件记在控制栏里，断言在 e2e/lab-tab-strip.e2e.ts。
 */
import {resolveTabStripInsertion, TabStrip} from "@notnotype/nb-layout/vue";
import type {TabStripItem} from "@notnotype/nb-layout/vue";
import {computed, ref, shallowRef, useTemplateRef} from "vue";

import LabFixtureControls from "../../LabFixtureControls.vue";
import type {LabFixtureProps} from "../../lab-subject";

const props = defineProps<LabFixtureProps>();

const initial = (): TabStripItem[] => {
    if (props.scene === "adapt") return ["资源管理器", "大纲视图", "搜索结果", "问题列表", "终端输出"].map((title, index) => ({id: `t${String(index)}`, title, iconClass: "i-lucide-files"}));
    const count = props.scene === "wrap" ? 14 : 20;
    return Array.from({length: count}, (_unused, index) => ({id: `t${String(index)}`, title: `标签 ${String(index)}`, ...(props.scene === "wrap" ? {partition: index < 2 ? "pinned" : "normal"} : {})}));
};

const items = shallowRef(initial());
const active = ref<string | null>(items.value[0]?.id ?? null);
const log = ref<string[]>([]);
const record = (entry: string): void => {
    log.value = [...log.value.slice(-5), entry];
};

function reorder(id: string, delta: -1 | 1): void {
    record(`reorder ${id} ${String(delta)}`);
    const list = [...items.value];
    const at = list.findIndex((item) => item.id === id);
    const next = at + delta;
    const item = list[at];
    if (item === undefined || next < 0 || next >= list.length) return;
    list.splice(at, 1);
    list.splice(next, 0, item);
    items.value = list;
}

const partitions = computed(() => (props.scene === "wrap" ? [{id: "pinned", layout: "scroll" as const}, {id: "normal", layout: "wrap" as const}] : undefined));
const overflow = computed(() => (props.scene === "adapt" ? ("adapt" as const) : ("scroll" as const)));
const width = ref(props.scene === "scroll" ? 420 : 520);

/** 指针在标签条里算出来的插入位：写出来给 e2e 读，判定的单元就是这个函数。 */
const host = useTemplateRef<HTMLElement>("host");
const insertion = shallowRef("");
function onPointerMove(event: PointerEvent): void {
    const strip = host.value?.querySelector("[data-tab-strip]");
    const measured = strip == null ? null : resolveTabStripInsertion(strip, {x: event.clientX, y: event.clientY});
    insertion.value = measured === null ? "" : JSON.stringify({before: measured.before, after: measured.after, partition: measured.partition});
}
</script>

<template>
    <div ref="host" class="tab-strip-fixture" data-lab-subject :style="{width: `${width}px`}" @pointermove="onPointerMove">
        <TabStrip
            :items="items"
            :active="active"
            label="标签"
            :partitions="partitions"
            :overflow="overflow"
            more-label="更多"
            more-icon-class="i-lucide-chevron-down"
            :max-item-width="72"
            @activate="(id: string) => { active = id; record(`activate ${id}`); }"
            @reorder="reorder"
            @close="(id: string) => record(`close ${id}`)"
            @keep="(id: string) => record(`keep ${id}`)"
            @context-menu="(id: string) => record(`menu ${id}`)"
        />
    </div>
    <LabFixtureControls>
        <label class="flex items-center gap-2 text-xs">宽度 <input v-model.number="width" type="range" min="120" max="900" data-tab-strip-width /></label>
        <span class="text-xs" data-tab-strip-log>{{ log.join(" | ") }}</span>
        <span class="text-xs" data-tab-strip-insertion>{{ insertion }}</span>
    </LabFixtureControls>
</template>

<style scoped>
.tab-strip-fixture {
    max-width: 100%;
}

.tab-strip-fixture :deep(.nb-tab-strip__list) {
    column-gap: 4px;
}

.tab-strip-fixture :deep(.nb-tab-strip__row) {
    column-gap: inherit;
}

.tab-strip-fixture :deep(.nb-tab) {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding-inline: 8px;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    white-space: nowrap;
}

.tab-strip-fixture :deep(.is-active .nb-tab) {
    color: var(--text-main);
    font-weight: 600;
}

.tab-strip-fixture :deep(.nb-tab__icon) {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
}

.tab-strip-fixture :deep(.nb-tab__title) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
}

.tab-strip-fixture :deep(.nb-tab__chevron) {
    width: 12px;
    height: 12px;
}
</style>
