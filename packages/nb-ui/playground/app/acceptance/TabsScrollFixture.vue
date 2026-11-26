<script setup lang="ts">
import {computed, ref} from "vue";
import Tabs from "../../../src/components/controls/Tabs.vue";
import type {TabsItem} from "../../../src/components/controls/Tabs.vue";
import FixtureShell from "./AcceptanceShell.vue";
import type {LabComponentDefinition} from "./definitions";

/**
 * Tabs 横向滚动时把选中项滚进来的验收夹具（e2e/tabs-scroll.spec.ts）。窄格子（240px）里放一排放不下的标签；外面套一个
 * 能竖向滚动的格子，用例借它确认只动了标签栏、没滚外层。
 *
 * 场景 `last`：挂上时选中最后一个。按钮：新加一项并选中它、只改计数（选中不变）、在 240px 与 900px（都放得下）之间换宽度。
 */
const props = defineProps<{
    definition: LabComponentDefinition;
    sceneId: string;
}>();

const controls = ref<Record<string, string | boolean>>({});
const labels = ["人物", "形象", "文字", "知情", "态度", "知识点", "经历", "情节"];
const added = ref<string[]>([]);
const bump = ref(0);
const wide = ref(false);
const items = computed<TabsItem[]>(() => [...labels, ...added.value].map((label, index) => ({value: label, label, count: index === 0 ? bump.value : undefined})));
const selected = ref(props.sceneId === "last" ? labels.at(-1)! : labels[0]!);

function addOne(): void {
    const label = `新的一组 ${String(added.value.length + 1)}`;
    added.value = [...added.value, label];
    selected.value = label;
}
</script>

<template>
    <FixtureShell v-model:controls="controls" :definition="definition" :scene-id="sceneId">
        <div id="nb-lab-target" data-fixture-outer class="tabs-scroll-outer">
            <div class="tabs-scroll-pad" />
            <div data-fixture-strip class="tabs-scroll-strip" :style="{width: wide ? '900px' : '240px'}">
                <Tabs v-model="selected" size="sm" :items="items" aria-label="分页" />
            </div>
            <div class="tabs-scroll-actions">
                <button type="button" data-fixture-add @click="addOne">新加一项并选中</button>
                <button type="button" data-fixture-bump @click="bump += 1">只改计数</button>
                <button type="button" data-fixture-width @click="wide = !wide">换宽度</button>
            </div>
            <div class="tabs-scroll-pad" />
        </div>
    </FixtureShell>
</template>

<style scoped>
.tabs-scroll-outer {
    height: 240px;
    overflow-y: auto;
    border: 1px solid var(--border-color);
}

.tabs-scroll-pad {
    height: 200px;
}

.tabs-scroll-actions {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-2) 0;
}
</style>
