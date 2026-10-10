<script setup lang="ts">
/**
 * 组件手势验收页：`/acceptance/<组件>?scene=&theme=&colorway=`。只承载需要真实指针与布局引擎的验收（嵌套分栏、
 * 多栏分割，见 e2e/nested-grid.spec.ts、e2e/splitter.spec.ts）；组件的场景登记在新应用的 Component Lab。
 *
 * 页面给出三样东西：按地址应用主题与配色、装 fixture 的画布、一直可见的事件日志（只收定义里登记的事件）。
 */
import {computed, ref, watch} from "vue";
import type {Component} from "vue";
import {useRoute} from "vue-router";

import NestedGridFixture from "../../acceptance/NestedGridFixture.vue";
import SplitterFixture from "../../acceptance/SplitterFixture.vue";
import {ACCEPTANCE_DEFINITIONS} from "../../acceptance/definitions";
import {useColorway} from "../../composables/useColorway";
import {useTheme} from "../../composables/useTheme";

const FIXTURES: Record<string, Component> = {"nested-grid": NestedGridFixture, "splitter": SplitterFixture};

const route = useRoute();
const theme = useTheme();
const colorway = useColorway();

const name = computed(() => String(route.params.name));
const definition = computed(() => ACCEPTANCE_DEFINITIONS[name.value] ?? null);
const fixture = computed(() => FIXTURES[name.value] ?? null);
const query = (key: string): string | null => (typeof route.query[key] === "string" ? route.query[key] as string : null);
const sceneId = computed(() => query("scene") ?? "default");

watch(() => [query("theme"), query("colorway")] as const, ([themeId, colorwayId]) => {
    if (themeId !== null && theme.themes.value.some((installed) => installed.manifest.id === themeId)) theme.setTheme(themeId);
    if (colorwayId !== null && (colorway.colorwayIds as string[]).includes(colorwayId)) colorway.setColorway(colorwayId);
}, {immediate: true});

type AcceptanceEvent = {id: number; name: string; payload: unknown};
const events = ref<AcceptanceEvent[]>([]);
let counter = 0;

function record(eventName: string, payload?: unknown): void {
    if (definition.value === null || !definition.value.events.includes(eventName)) return;
    counter += 1;
    events.value = [{id: counter, name: eventName, payload}, ...events.value].slice(0, 200);
}

watch([name, sceneId], () => {
    events.value = [];
});
</script>

<template>
    <div class="acc-page">
        <p v-if="definition === null || fixture === null" class="acc-missing">没有名为「{{ name }}」的验收页</p>
        <template v-else>
            <div class="acc-canvas">
                <component :is="fixture" :key="`${name}:${sceneId}`" :definition="definition" :scene-id="sceneId" @lab-event="record" />
            </div>
            <section class="acc-events" aria-label="事件日志">
                <p class="acc-events__header">事件（最新在上）</p>
                <ol class="acc-events__list">
                    <li v-for="item in events" :key="item.id" class="acc-events__row">
                        <span class="acc-events__name">{{ item.name }}</span>
                    </li>
                </ol>
            </section>
        </template>
    </div>
</template>

<style scoped>
.acc-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
}

.acc-canvas {
    min-width: 0;
    overflow: auto;
}

.acc-events__header {
    font-size: var(--text-2xs);
    color: var(--text-muted);
}

.acc-events__list {
    margin: 0;
    padding: 0;
    list-style: none;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
}

.acc-missing {
    color: var(--text-muted);
}
</style>
