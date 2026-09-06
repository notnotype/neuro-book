<script setup lang="ts">
import {computed, ref, watch} from "vue";
import AgentProfileNavList from "../../components/novel-ide/settings/agent-profile/AgentProfileNavList.vue";
import type {AgentProfileNavItem} from "../../components/novel-ide/settings/agent-profile/AgentProfileNavList.types";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

type FixtureState = {
    activeKey: string;
    search: string;
    defaultsDirty: boolean;
};
const fixtureStateKeys = ["activeKey", "search", "defaultsDirty"] as const;

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();
const activeKey = ref("");
const search = ref("");
const defaultsDirty = ref(false);

const statuses = [
    "loaded",
    "compiling",
    "compile_failed",
    "not_compiled",
    "compile_stale",
    "compiled_load_failed",
    "source_error",
] as const;

const statusItems: AgentProfileNavItem[] = [
    {profileKey: "story-writer", name: "故事写手", status: statuses[0], overrideCount: 0, dirty: false, isDefault: false, iconClass: "i-lucide-feather"},
    {profileKey: "line-editor", name: "行文编辑", status: statuses[1], overrideCount: 4, dirty: false, isDefault: false, iconClass: "i-lucide-pen-line"},
    {profileKey: "fact-reviewer", name: "事实审校", status: statuses[2], overrideCount: 2, dirty: true, isDefault: false, iconClass: "i-lucide-search-check"},
    {profileKey: "deep-researcher", name: "资料研究员", status: statuses[3], overrideCount: 0, dirty: false, isDefault: true, iconClass: "i-lucide-book-open"},
    {profileKey: "plot-planner", name: "大纲规划", status: statuses[4], overrideCount: 1, dirty: false, isDefault: false, iconClass: "i-lucide-list-tree"},
    {profileKey: "series-archivist", name: "设定档案", status: statuses[5], overrideCount: 3, dirty: false, isDefault: false, iconClass: "i-lucide-archive"},
    {profileKey: "canon-guardian", name: "世界观守卫", status: statuses[6], overrideCount: 0, dirty: false, isDefault: false, iconClass: "i-lucide-shield"},
];

const defaultItems: AgentProfileNavItem[] = [
    {profileKey: "story-writer", name: "故事写手", status: "loaded", overrideCount: 0, dirty: false, isDefault: true, iconClass: "i-lucide-feather"},
    {profileKey: "line-editor", name: "行文编辑", status: "loaded", overrideCount: 2, dirty: false, isDefault: false, iconClass: "i-lucide-pen-line"},
];

const noMatchItems: AgentProfileNavItem[] = [
    {profileKey: "story-writer", name: "故事写手", status: "loaded", overrideCount: 0, dirty: false, isDefault: false, iconClass: "i-lucide-feather"},
    {profileKey: "line-editor", name: "行文编辑", status: "compiling", overrideCount: 1, dirty: false, isDefault: true, iconClass: "i-lucide-pen-line"},
];

function createItems(scene: string): AgentProfileNavItem[] {
    switch (scene) {
        case "statuses":
            return statusItems;
        case "long-list":
            return Array.from({length: 30}, (_, index) => ({
                profileKey: index === 1
                    ? "profile-with-an-intentionally-long-key-for-narrow-layout-checks"
                    : index % 3 === 0
                        ? "story-writer"
                        : index % 3 === 1
                            ? "line-editor"
                            : "fact-reviewer",
                name: index === 0
                    ? "一个用于验证窄屏截断与完整可访问名称的超长 Agent Profile 名称"
                    : index === 2
                        ? "A very long English profile name for responsive layout checks"
                        : `${["故事写手", "行文编辑", "事实审校"][index % 3]} · ${Math.floor(index / 3) + 1} 号`,
                status: statuses[index % statuses.length]!,
                overrideCount: index % 4 === 0 ? index + 1 : 0,
                dirty: index % 7 === 0,
                isDefault: index === 4,
                iconClass: ["i-lucide-feather", "i-lucide-pen-line", "i-lucide-search-check"][index % 3],
            }));
        case "empty":
            return [];
        case "defaults":
        case "no-match":
            return scene === "defaults" ? defaultItems : noMatchItems;
        default:
            return [];
    }
}

function sceneDefaults(scene: string): FixtureState {
    switch (scene) {
        case "statuses":
            return {activeKey: "line-editor", search: "", defaultsDirty: false};
        case "defaults":
            return {activeKey: "", search: "", defaultsDirty: true};
        case "long-list":
            return {activeKey: "profile-0", search: "", defaultsDirty: false};
        case "no-match":
            return {activeKey: "story-writer", search: "不存在的搜索词xyz", defaultsDirty: false};
        case "empty":
        default:
            return {activeKey: "", search: "", defaultsDirty: false};
    }
}

function readFixtureData(value: unknown, scene: string): FixtureState {
    const fallback = sceneDefaults(scene);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return fallback;
    }
    const data = value as Record<string, unknown>;
    // Lab 数据面板现在包含 items；回读只认三个受控状态字段，类型不对才回退场景默认值。
    if (typeof data.activeKey !== "string" || typeof data.search !== "string" || typeof data.defaultsDirty !== "boolean") {
        return fallback;
    }
    return {
        activeKey: data.activeKey,
        search: data.search,
        defaultsDirty: data.defaultsDirty,
    };
}

const items = computed(() => createItems(props.scene));

function labData(): FixtureState & {items: AgentProfileNavItem[]} {
    return {
        items: items.value,
        activeKey: activeKey.value,
        search: search.value,
        defaultsDirty: defaultsDirty.value,
    };
}

function syncCurrentLabData(): void {
    syncLabData(labData());
}

function resetFromScene(): void {
    const state = readFixtureData(props.data, props.scene);
    activeKey.value = state.activeKey;
    search.value = state.search;
    defaultsDirty.value = state.defaultsDirty;
}

watch([items, activeKey, search, defaultsDirty], syncCurrentLabData, {deep: true, immediate: true});
watch([() => props.scene, () => props.data], resetFromScene, {deep: true, immediate: true});

function updateActiveKey(value: string): void {
    activeKey.value = value;
    syncCurrentLabData();
    emitLabEvent("update:activeKey", value);
}

function updateSearch(value: string): void {
    search.value = value;
    syncCurrentLabData();
    emitLabEvent("update:search", value);
}
</script>

<template>
    <div class="h-[600px] w-[280px] min-w-0 overflow-hidden">
        <AgentProfileNavList
            data-lab-subject
            :items="items"
            :active-key="activeKey"
            :search="search"
            :defaults-dirty="defaultsDirty"
            @update:active-key="updateActiveKey"
            @update:search="updateSearch"
        />
    </div>
</template>
