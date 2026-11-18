<script setup lang="ts">
/**
 * SortableList 的场景：夹具持有分卷与章节的次序，放下就照 `move` 改（写入慢、写入失败的场景模拟宿主的异步写）；每次 `move`
 * 记在控制栏里。断言在 e2e/lab-sortable-list.e2e.ts。
 */
import {Checkbox} from "@notnotype/nb-ui/components";
import {SortableList} from "@notnotype/nb-layout/vue";
import type {SortableMove} from "@notnotype/nb-layout/vue";
import {ref, shallowRef} from "vue";

import LabFixtureControls from "../../LabFixtureControls.vue";
import type {LabFixtureProps} from "../../lab-subject";

const props = defineProps<LabFixtureProps>();

const CHAPTERS: Record<string, {title: string; note: string}> = {
    c1: {title: "雨夜", note: "沈屿第一次进港务局"},
    c2: {title: "旧码头", note: "船老大交出账本"},
    c3: {title: "潮汐表", note: "林晓发现日期对不上"},
    c4: {title: "灯塔", note: "第二卷开篇，三年以后"},
    c5: {title: "回航", note: "账本的下落"},
};

const initial = (): {id: string; title: string; keys: string[]}[] => props.scene === "empty"
    ? [{id: "v1", title: "第一卷", keys: ["c1", "c2", "c3", "c4", "c5"]}, {id: "v2", title: "第二卷", keys: []}]
    : [{id: "v1", title: "第一卷", keys: ["c1", "c2", "c3"]}, {id: "v2", title: "第二卷", keys: ["c4", "c5"]}];

const sections = shallowRef(initial());
const included = ref<Record<string, boolean>>({c1: true, c2: true, c3: true, c4: true, c5: false});
const log = ref<string[]>([]);

function apply(move: SortableMove): void {
    sections.value = sections.value.map((section) => {
        const keys = section.keys.filter((key) => key !== move.key);
        if (section.id === move.to.section) keys.splice(move.to.index, 0, move.key);
        return {...section, keys};
    });
}

/** 写入慢：600ms 后才采纳；写入失败：300ms 后不采纳。其余场景当场采纳。 */
function onMove(move: SortableMove): void | Promise<void> {
    log.value = [...log.value.slice(-5), `${move.key} ${move.from.section}:${String(move.from.index)} → ${move.to.section}:${String(move.to.index)}`];
    if (props.scene === "slow") return new Promise((resolve) => setTimeout(() => { apply(move); resolve(); }, 600));
    if (props.scene === "fail") return new Promise((resolve) => setTimeout(resolve, 300));
    apply(move);
    return undefined;
}
</script>

<template>
    <div class="sortable-list-fixture" data-lab-subject>
        <SortableList :sections="sections" :label="(key: string) => CHAPTERS[key]?.title ?? key" :disabled="props.scene === 'disabled'" @move="onMove">
            <template #item="{itemKey}">
                <Checkbox v-model="included[itemKey]" :label="CHAPTERS[itemKey]?.title" :description="CHAPTERS[itemKey]?.note" :disabled="props.scene === 'disabled'" />
            </template>
        </SortableList>
    </div>
    <LabFixtureControls>
        <span class="text-xs" data-sortable-order>{{ sections.map((section) => `${section.id}:${section.keys.join(",")}`).join(" ") }}</span>
        <span class="text-xs" data-sortable-log>{{ log.join(" | ") }}</span>
    </LabFixtureControls>
</template>

<style scoped>
.sortable-list-fixture {
    max-width: 520px;
    padding: 16px;
}
</style>
