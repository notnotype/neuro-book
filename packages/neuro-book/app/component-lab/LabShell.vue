<script setup lang="ts">
import {computed, onMounted, provide, ref, shallowRef, watch} from "vue";
import {
    FormSelect as NbFormSelect,
    Tabs as NbTabs,
    ToggleGroup as NbToggleGroup,
    Toolbar as NbToolbar,
    Tree as NbTree,
} from "@notnotype/nb-ui/components";
import type {FormSelectOption, TabsItem, ToggleGroupOption} from "@notnotype/nb-ui/components";
import type {Component} from "vue";
import {builtInThemeIds} from "nbook/shared/theme/theme-vars";
import {themeMeta} from "nbook/app/utils/theme/theme-tokens";
import {resolveTheme} from "nbook/app/utils/theme/resolve-theme";
import {applyThemeVars} from "nbook/app/utils/theme/apply-theme";
import JsonViewer from "nbook/app/components/common/JsonViewer.vue";
import CollapsibleSidePanel from "./CollapsibleSidePanel.vue";
import ViewportCanvas from "./ViewportCanvas.vue";
import MarkdownView from "./MarkdownView.vue";
import EventLogPanel from "./EventLogPanel.vue";
import {labComponents, findLabComponent} from "./component-index";
import {findLabFixture} from "./fixtures";
import {LAB_EVENT_SINK} from "./lab-event-sink";
import type {LabEventEntry} from "./event-log.types";

const EVENT_LIMIT = 200;

const rootRef = ref<HTMLElement | null>(null);
const leftCollapsed = ref(false);
const rightCollapsed = ref(false);
const selectedName = ref<string>(labComponents.find((entry) => entry.mountable)?.name ?? "");
const selectedScene = ref<string>("");
const rightTab = ref("scenes");
const canvasWidth = ref(0);
const canvasHeight = ref(0);
const fixtureComponent = shallowRef<Component | null>(null);
const sceneData = ref<unknown>(undefined);
const events = ref<LabEventEntry[]>([]);
let eventCounter = 0;

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
const scene = computed(() => fixture.value?.scenes.find((item) => item.id === selectedScene.value) ?? null);
const sceneHasData = computed(() => scene.value?.data !== undefined);

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

// Lab 的主题只写在 Lab 自己的根节点上，不经过 useThemeManager——那条路会把
// 主题保存进 Global Config，等于让开发工具改用户的产品设置。
const labThemeId = ref<string>("dark");
const themeOptions: FormSelectOption[] = builtInThemeIds.map((id) => ({
    value: id,
    label: themeMeta[id].label,
    description: themeMeta[id].appearance === "dark" ? "深色" : "浅色",
}));

watch([labThemeId, rootRef], ([id, host]) => {
    if (host) {
        applyThemeVars(host, resolveTheme(id).vars);
    }
});
onMounted(() => {
    if (rootRef.value) {
        applyThemeVars(rootRef.value, resolveTheme(labThemeId.value).vars);
    }
});

const tabItems = computed<TabsItem[]>(() => [
    {value: "scenes", label: "场景", count: fixture.value?.scenes.length ?? 0},
    {value: "doc", label: "文档"},
    {value: "events", label: "事件", count: events.value.length},
    {value: "data", label: "数据"},
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

function recordEvent(name: string, payload?: unknown): void {
    eventCounter += 1;
    // 裁剪在写入这一侧做：EventLogPanel 不替使用方丢数据。
    events.value = [
        {id: `ev-${eventCounter}`, name, at: new Date(), payload},
        ...events.value,
    ].slice(0, EVENT_LIMIT);
}

provide(LAB_EVENT_SINK, recordEvent);

function resetScene(): void {
    sceneData.value = structuredClone(scene.value?.data);
    events.value = [];
}

watch(fixture, async (next) => {
    selectedScene.value = next?.scenes[0]?.id ?? "";
    fixtureComponent.value = next ? await next.load() : null;
}, {immediate: true});

// 换场景等于重来一次：假数据回到登记的初值，事件日志清空，
// 否则「同一场景重复打开结果一致」这条验收就不成立。
watch([selectedScene, fixture], () => {
    resetScene();
}, {immediate: true});
</script>

<template>
    <div ref="rootRef" class="flex h-full min-h-0 flex-col bg-[var(--bg-page,var(--bg-main))] text-[var(--text-main)]">
        <header class="flex shrink-0 items-center gap-3 border-b border-[var(--border-color)] px-3 py-2">
            <span class="text-sm font-medium text-[var(--text-main)]">组件 Lab</span>
            <span class="text-xs text-[var(--text-muted)]">{{ labComponents.length }} 个组件</span>
            <div class="flex-1"></div>
            <NbFormSelect
                v-model="labThemeId"
                :options="themeOptions"
                size="sm"
                class="w-[190px]"
                aria-label="Lab 主题"
            />
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
                <!-- nb-ui Tree 的根节点自带边框、内边距与阴影，外面不能再套一层，
                     否则成了「一张卡片浮在侧栏里」。 -->
                <NbTree
                    :items="treeItems"
                    :model-value="selectedName"
                    :expanded="treeItems.map((group) => group.id)"
                    @select="selectComponent($event.id)"
                />
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
                    <component
                        :is="fixtureComponent"
                        v-if="fixtureComponent"
                        :key="`${selectedName}:${selectedScene}`"
                        :scene="selectedScene"
                        :data="sceneData"
                    />
                </ViewportCanvas>
            </main>

            <CollapsibleSidePanel
                v-model:collapsed="rightCollapsed"
                title="检视"
                side="right"
                :class="rightCollapsed ? '' : 'w-[320px] shrink-0'"
            >
                <div class="flex h-full min-h-0 flex-col">
                    <div class="shrink-0 border-b border-[var(--border-color)] px-2 pt-2">
                        <NbTabs v-model="rightTab" :items="tabItems" size="sm" aria-label="检视面板" />
                    </div>

                    <div class="min-h-0 flex-1 overflow-y-auto">
                        <div v-if="rightTab === 'scenes'" class="flex flex-col gap-1 p-2">
                            <button
                                v-for="item in fixture?.scenes ?? []"
                                :key="item.id"
                                type="button"
                                class="rounded px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-main)]"
                                :class="item.id === selectedScene ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'hover:bg-[var(--bg-hover)]'"
                                @click="selectedScene = item.id"
                            >
                                {{ item.label }}
                            </button>
                            <p v-if="!fixture" class="px-2 py-1 text-xs text-[var(--text-muted)]">这个组件没有场景。</p>
                        </div>

                        <div v-else-if="rightTab === 'doc'" class="p-3">
                            <template v-if="selected">
                                <!-- 能力标签与能不能挂都是文档 frontmatter 派生的，
                                     放在文档正文上方而不是单开一个 tab。 -->
                                <dl class="mb-3 flex flex-col gap-2 border-b border-[var(--border-color)] pb-3 text-xs">
                                    <div class="flex gap-2">
                                        <dt class="w-16 shrink-0 text-[var(--text-muted)]">目录</dt>
                                        <dd class="text-[var(--text-main)]">{{ selected.group }}</dd>
                                    </div>
                                    <div class="flex gap-2">
                                        <dt class="w-16 shrink-0 text-[var(--text-muted)]">能力标签</dt>
                                        <dd class="flex flex-wrap gap-1">
                                            <span v-if="selected.tags.length === 0" class="text-[var(--text-main)]">无</span>
                                            <code
                                                v-for="tag in selected.tags"
                                                :key="tag"
                                                class="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[var(--text-main)]"
                                            >{{ tag }}</code>
                                        </dd>
                                    </div>
                                    <div class="flex gap-2">
                                        <dt class="w-16 shrink-0 text-[var(--text-muted)]">确定性验证</dt>
                                        <dd class="text-[var(--text-main)]">
                                            {{ selected.mountable ? (selected.needsSnapshot ? "需预置状态快照" : "可以") : "只能在正式界面" }}
                                        </dd>
                                    </div>
                                </dl>
                                <MarkdownView :source="selected.doc" />
                            </template>
                        </div>

                        <div v-else-if="rightTab === 'events'" class="flex h-full flex-col">
                            <div class="flex shrink-0 items-center justify-between border-b border-[var(--border-color)] px-3 py-1.5">
                                <span class="text-xs text-[var(--text-muted)]">最多留最近 {{ EVENT_LIMIT }} 条</span>
                                <button
                                    type="button"
                                    class="rounded px-2 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                                    @click="events = []"
                                >
                                    清空
                                </button>
                            </div>
                            <EventLogPanel :entries="events" empty-text="操作一下组件，事件会记在这里" />
                        </div>

                        <div v-else class="flex h-full flex-col gap-2 p-3">
                            <template v-if="sceneHasData">
                                <div class="flex shrink-0 items-center justify-between">
                                    <span class="text-xs text-[var(--text-muted)]">改完立刻生效</span>
                                    <button
                                        type="button"
                                        class="rounded px-2 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                                        @click="resetScene"
                                    >
                                        还原
                                    </button>
                                </div>
                                <JsonViewer
                                    :value="sceneData"
                                    :read-only="false"
                                    :max-height="0"
                                    class="min-h-0 flex-1"
                                    @update:value="sceneData = $event"
                                />
                            </template>
                            <p v-else class="text-xs text-[var(--text-muted)]">
                                这个场景没有登记可改的假数据。
                            </p>
                        </div>
                    </div>
                </div>
            </CollapsibleSidePanel>
        </div>
    </div>
</template>
