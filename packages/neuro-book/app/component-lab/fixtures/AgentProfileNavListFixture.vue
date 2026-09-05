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
    {profileKey: "p1", name: "Writer", status: statuses[0], overrideCount: 0, dirty: false, isDefault: false},
    {profileKey: "p2", name: "编译中的 Editor", status: statuses[1], overrideCount: 4, dirty: false, isDefault: false},
    {profileKey: "p3", name: "Reviewer", status: statuses[2], overrideCount: 2, dirty: true, isDefault: false},
    {profileKey: "p4", name: "Researcher", status: statuses[3], overrideCount: 0, dirty: false, isDefault: true},
    {profileKey: "p5", name: "Planner", status: statuses[4], overrideCount: 1, dirty: false, isDefault: false},
    {profileKey: "p6", name: "Archivist", status: statuses[5], overrideCount: 3, dirty: false, isDefault: false},
    {profileKey: "p7", name: "Source Guardian", status: statuses[6], overrideCount: 0, dirty: false, isDefault: false},
];

const defaultItems: AgentProfileNavItem[] = [
    {profileKey: "p1", name: "Writer", status: "loaded", overrideCount: 0, dirty: false, isDefault: true},
    {profileKey: "p2", name: "Editor", status: "loaded", overrideCount: 2, dirty: false, isDefault: false},
];

const noMatchItems: AgentProfileNavItem[] = [
    {profileKey: "p1", name: "Writer", status: "loaded", overrideCount: 0, dirty: false, isDefault: false},
    {profileKey: "p2", name: "Editor", status: "compiling", overrideCount: 1, dirty: false, isDefault: true},
];

function createItems(scene: string): AgentProfileNavItem[] {
    switch (scene) {
        case "statuses":
            return statusItems;
        case "long-list":
            return Array.from({length: 30}, (_, index) => ({
                profileKey: index === 1
                    ? "profile-1-with-an-intentionally-long-key-for-narrow-layout-checks"
                    : `profile-${index}`,
                name: index === 0
                    ? "一个用于验证窄屏截断与完整可访问名称的超长 Agent Profile 名称"
                    : index === 2
                        ? "A very long English profile name for responsive layout checks"
                        : `Profile ${index} · ${index % 2 === 0 ? "创作" : "校对"}助手`,
                status: statuses[index % statuses.length]!,
                overrideCount: index % 4 === 0 ? index + 1 : 0,
                dirty: index % 7 === 0,
                isDefault: index === 4,
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
            return {activeKey: "p2", search: "", defaultsDirty: false};
        case "defaults":
            return {activeKey: "", search: "", defaultsDirty: true};
        case "long-list":
            return {activeKey: "profile-0", search: "", defaultsDirty: false};
        case "no-match":
            return {activeKey: "p1", search: "不存在的搜索词xyz", defaultsDirty: false};
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
    const keys = Object.keys(data);
    if (keys.length !== fixtureStateKeys.length || keys.some((key) => !fixtureStateKeys.includes(key as typeof fixtureStateKeys[number]))) {
        return fallback;
    }
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

function resetFromScene(): void {
    const state = readFixtureData(props.data, props.scene);
    activeKey.value = state.activeKey;
    search.value = state.search;
    defaultsDirty.value = state.defaultsDirty;
}

watch([() => props.scene, () => props.data], resetFromScene, {deep: true, immediate: true});

function updateActiveKey(value: string): void {
    activeKey.value = value;
    syncLabData({activeKey: activeKey.value, search: search.value, defaultsDirty: defaultsDirty.value});
    emitLabEvent("update:activeKey", value);
}

function updateSearch(value: string): void {
    search.value = value;
    syncLabData({activeKey: activeKey.value, search: search.value, defaultsDirty: defaultsDirty.value});
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
