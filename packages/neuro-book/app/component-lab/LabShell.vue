<script setup lang="ts">
import {computed, ref, shallowRef, watch} from "vue";
import {Tabs as NbTabs, Toolbar as NbToolbar, ToggleGroup as NbToggleGroup, Tree as NbTree} from "@notnotype/nb-ui/components";
import type {TabsItem, ToggleGroupOption} from "@notnotype/nb-ui/components";
import type {Component} from "vue";
import CollapsibleSidePanel from "./CollapsibleSidePanel.vue";
import ViewportCanvas from "./ViewportCanvas.vue";
import {labComponents, findLabComponent} from "./component-index";
import {findLabFixture} from "./fixtures";

const leftCollapsed = ref(false);
const rightCollapsed = ref(false);
const selectedName = ref<string>(labComponents.find((entry) => entry.mountable)?.name ?? "");
const selectedScene = ref<string>("");
const rightTab = ref("scenes");
const canvasWidth = ref(0);
const canvasHeight = ref(0);
const fixtureComponent = shallowRef<Component | null>(null);

const treeItems = computed(() => {
    const groups = new Map<string, typeof labComponents>();
    for (const entry of labComponents) {
        const bucket = groups.get(entry.group) ?? [];
        bucket.push(entry);
        groups.set(entry.group, bucket);
    }
    return [...groups.entries()].map(([group, entries]) => ({
        id: `group:${group}`,
        title: group,
        children: entries.map((entry) => ({
            id: entry.name,
            title: entry.name,
            // 挂不上的组件仍然在清单里，用锁图标标出来，点进去能看到原因
            iconClass: entry.mountable ? "i-lucide-box" : "i-lucide-lock",
        })),
    }));
});

const selected = computed(() => (selectedName.value ? findLabComponent(selectedName.value) : null));
const fixture = computed(() => (selectedName.value ? findLabFixture(selectedName.value) : null));

const presetOptions: ToggleGroupOption[] = [
    {value: "free", label: "随窗口"},
    {value: "tablet", label: "平板"},
    {value: "phone", label: "手机"},
];
const presetSizes: Record<string, [number, number]> = {
    free: [0, 0],
    tablet: [768, 1024],
    phone: [390, 844],
};
const activePreset = computed(() => {
    for (const [id, [w, h]] of Object.entries(presetSizes)) {
        if (w === canvasWidth.value && h === canvasHeight.value) {
            return id;
        }
    }
    return "";
});

const tabItems = computed<TabsItem[]>(() => [
    {value: "scenes", label: "场景", count: fixture.value?.scenes.length ?? 0},
    {value: "overview", label: "概览"},
]);

// reka 的单选组再次点击当前项会把值清空，画布必须始终有一个尺寸档，因此挡住空值。
// nb-ui 声明的类型是 string | string[]，但运行时确实会给 undefined，两处都要挡。
function applyPreset(value: string | string[]): void {
    const size = typeof value === "string" ? presetSizes[value] : undefined;
    if (!size) {
        return;
    }
    [canvasWidth.value, canvasHeight.value] = size;
}

function selectComponent(id: string): void {
    if (id.startsWith("group:")) {
        return;
    }
    selectedName.value = id;
}

watch(fixture, async (next) => {
    selectedScene.value = next?.scenes[0]?.id ?? "";
    fixtureComponent.value = next ? await next.load() : null;
}, {immediate: true});
</script>

<template>
    <div class="flex h-full min-h-0 flex-col bg-[var(--bg-page)]">
        <header class="flex shrink-0 items-center gap-3 border-b border-[var(--border-color)] px-3 py-2">
            <span class="text-sm font-medium text-[var(--text-main)]">组件 Lab</span>
            <span class="text-xs text-[var(--text-muted)]">{{ labComponents.length }} 个组件</span>
            <div class="flex-1"></div>
            <NbToolbar aria-label="画布尺寸">
                <NbToggleGroup
                    size="sm"
                    :options="presetOptions"
                    :model-value="activePreset"
                    @update:model-value="applyPreset"
                />
            </NbToolbar>
        </header>

        <div class="flex min-h-0 flex-1">
            <CollapsibleSidePanel
                v-model:collapsed="leftCollapsed"
                title="组件"
                side="left"
                :class="leftCollapsed ? '' : 'w-[240px] shrink-0'"
            >
                <div class="p-2">
                    <NbTree
                        :items="treeItems"
                        :model-value="selectedName"
                        :expanded="treeItems.map((group) => group.id)"
                        @select="selectComponent($event.id)"
                    />
                </div>
            </CollapsibleSidePanel>

            <main class="min-w-0 flex-1">
                <div v-if="!selected" class="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
                    左边选一个组件
                </div>
                <div v-else-if="!selected.mountable" class="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
                    <span class="i-lucide-lock h-6 w-6 text-[var(--text-muted)]"></span>
                    <p class="text-sm text-[var(--text-main)]">{{ selected.name }} 不能在 Lab 里验证</p>
                    <p class="max-w-md text-xs text-[var(--text-muted)]">{{ selected.blockedReason }}</p>
                </div>
                <div v-else-if="!fixture" class="flex h-full flex-col items-center justify-center gap-2 text-center">
                    <p class="text-sm text-[var(--text-main)]">{{ selected.name }} 还没有场景</p>
                    <p class="text-xs text-[var(--text-muted)]">它可以挂载，但还没有人为它写 fixture。</p>
                </div>
                <ViewportCanvas v-else v-model:width="canvasWidth" v-model:height="canvasHeight">
                    <component :is="fixtureComponent" v-if="fixtureComponent" :key="`${selectedName}:${selectedScene}`" :scene="selectedScene" />
                </ViewportCanvas>
            </main>

            <CollapsibleSidePanel
                v-model:collapsed="rightCollapsed"
                title="检视"
                side="right"
                :class="rightCollapsed ? '' : 'w-[280px] shrink-0'"
            >
                <div class="border-b border-[var(--border-color)] px-2 pt-2">
                    <NbTabs v-model="rightTab" :items="tabItems" size="sm" aria-label="检视面板" />
                </div>

                <div v-if="rightTab === 'scenes'" class="flex flex-col gap-1 p-2">
                    <button
                        v-for="scene in fixture?.scenes ?? []"
                        :key="scene.id"
                        type="button"
                        class="rounded px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-main)]"
                        :class="scene.id === selectedScene ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'hover:bg-[var(--bg-hover)]'"
                        @click="selectedScene = scene.id"
                    >
                        {{ scene.label }}
                    </button>
                    <p v-if="!fixture" class="px-2 py-1 text-xs text-[var(--text-muted)]">这个组件没有场景。</p>
                </div>

                <dl v-else-if="selected" class="flex flex-col gap-3 p-3 text-xs">
                    <div>
                        <dt class="text-[var(--text-muted)]">目录</dt>
                        <dd class="mt-0.5 text-[var(--text-main)]">{{ selected.group }}</dd>
                    </div>
                    <div>
                        <dt class="text-[var(--text-muted)]">能力标签</dt>
                        <dd class="mt-0.5 flex flex-wrap gap-1">
                            <span v-if="selected.tags.length === 0" class="text-[var(--text-main)]">无（已确认没有隐藏通道）</span>
                            <code v-for="tag in selected.tags" :key="tag" class="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[var(--text-main)]">{{ tag }}</code>
                        </dd>
                    </div>
                    <div>
                        <dt class="text-[var(--text-muted)]">耦合度</dt>
                        <dd class="mt-0.5 text-[var(--text-main)]">{{ selected.tags.filter((tag) => tag !== "state:local").length }}</dd>
                    </div>
                    <div>
                        <dt class="text-[var(--text-muted)]">确定性验证</dt>
                        <dd class="mt-0.5 text-[var(--text-main)]">
                            {{ selected.mountable ? (selected.needsSnapshot ? "需预置状态快照" : "可以") : "只能在正式界面" }}
                        </dd>
                    </div>
                </dl>
            </CollapsibleSidePanel>
        </div>
    </div>
</template>
