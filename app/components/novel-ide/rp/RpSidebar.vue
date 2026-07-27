<script setup lang="ts">
import {computed, onMounted, ref} from "vue";
import type {SubjectStateDto, WorldSchemaProjectionDto, WorldSliceDto, WorldStateDto, WorldSubjectDto} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";
import {buildRpGraph} from "nbook/app/components/novel-ide/rp/rp-graph";
import RpGraphCanvas from "nbook/app/components/novel-ide/rp/RpGraphCanvas.vue";
import {formatStateValue} from "nbook/app/utils/world-engine-state-view";
import type {JsonValue} from "nbook/app/utils/world-engine-preview";

/**
 * RP 界面侧边栏：世界 / 地图 / 角色状态 三面板。
 * 数据源 = World Engine rp 世界线（worldKey=rp）。
 */
const props = defineProps<{
    projectPath: string;
}>();

type RpSidebarTab = "world" | "map" | "characters";
const activeTab = ref<RpSidebarTab>("world");

const loading = ref(false);
const loadError = ref("");
/** rp 世界线是否已初始化(rp/world-engine/ 配置就绪);null = 未知(查询中)。 */
const rpInitialized = ref<boolean | null>(null);
const rpMissing = ref<string[]>([]);
const stateResult = ref<WorldStateDto | null>(null);
const subjects = ref<WorldSubjectDto[]>([]);
const slices = ref<WorldSliceDto[]>([]);
const schema = ref<WorldSchemaProjectionDto | null>(null);

async function refresh(): Promise<void> {
    if (!props.projectPath) return;
    loading.value = true;
    loadError.value = "";
    try {
        const query = {projectPath: props.projectPath, worldKey: "rp"};
        // 先查配置就绪状态:rp/world-engine/ 缺失是「尚未初始化」的正常状态,不是错误
        const status = await $fetch<{initialized: boolean; missing: string[]}>("/api/projects/world-engine/status", {query});
        rpInitialized.value = status.initialized;
        rpMissing.value = status.missing;
        if (!status.initialized) {
            stateResult.value = null;
            subjects.value = [];
            slices.value = [];
            schema.value = null;
            return;
        }
        const [nextState, nextSubjects, nextSlices, nextSchema] = await Promise.all([
            $fetch<WorldStateDto>("/api/projects/world-engine/state", {query}),
            $fetch<WorldSubjectDto[]>("/api/projects/world-engine/subjects", {query}),
            $fetch<WorldSliceDto[]>("/api/projects/world-engine/slices", {query: {...query, limit: 30}}),
            $fetch<WorldSchemaProjectionDto>("/api/projects/world-engine/schema", {query}),
        ]);
        stateResult.value = nextState;
        subjects.value = nextSubjects;
        slices.value = nextSlices;
        schema.value = nextSchema;
    } catch (error) {
        loadError.value = error instanceof Error ? error.message : String(error);
    } finally {
        loading.value = false;
    }
}

onMounted(() => {
    void refresh();
});

defineExpose({refresh});

const subjectNameMap = computed(() => new Map(subjects.value.map((subject) => [subject.id, subject.name || subject.id])));

const stateBySubjectId = computed(() => new Map((stateResult.value?.subjects ?? []).map((state) => [state.subjectId, state])));

// ---- 世界面板 ----
const worldState = computed<SubjectStateDto | null>(() => stateResult.value?.subjects.find((state) => state.type === "world") ?? null);

const typeGroups = computed(() => {
    const groups = new Map<string, WorldSubjectDto[]>();
    for (const subject of subjects.value) {
        const list = groups.get(subject.type) ?? [];
        list.push(subject);
        groups.set(subject.type, list);
    }
    return [...groups.entries()].map(([type, members]) => ({type, members}));
});

const recentSlices = computed(() => slices.value.slice(-5).reverse());

// ---- 地图面板 ----
const mapGraph = computed(() => buildRpGraph({
    subjects: subjects.value,
    states: stateResult.value?.subjects ?? [],
    nodeTypes: ["location"],
}));

// ---- 角色面板 ----
const characterSubjects = computed(() => subjects.value.filter((subject) => subject.type === "character"));
const relationGraph = computed(() => buildRpGraph({
    subjects: subjects.value,
    states: stateResult.value?.subjects ?? [],
    nodeTypes: ["character"],
}));

const expandedCharacterId = ref<string | null>(null);

function characterAttrs(subjectId: string): Array<{name: string; text: string}> {
    const state = stateBySubjectId.value.get(subjectId);
    if (!state) return [];
    return Object.entries(state.attrs)
        .filter(([name]) => name !== "secret")
        .map(([name, value]) => ({name, text: renderAttrText(value)}));
}

function renderAttrText(value: JsonValue | undefined): string {
    if (Array.isArray(value)) {
        const parts = value.slice(0, 6).map((item) => {
            if (typeof item === "string") return subjectNameMap.value.get(stripRef(item)) ?? item;
            if (typeof item === "object" && item !== null) return formatStateValue(item);
            return String(item);
        });
        return parts.join("、") + (value.length > 6 ? ` 等${value.length}项` : "");
    }
    if (typeof value === "string") {
        return subjectNameMap.value.get(stripRef(value)) ?? value;
    }
    return formatStateValue(value);
}

function stripRef(value: string): string {
    return value.startsWith("subject://") ? value.slice("subject://".length) : value;
}

const TABS: Array<{key: RpSidebarTab; label: string; icon: string}> = [
    {key: "world", label: "世界", icon: "i-lucide-globe-2"},
    {key: "map", label: "地图", icon: "i-lucide-map"},
    {key: "characters", label: "角色", icon: "i-lucide-users"},
];
</script>

<template>
    <!-- RP 侧边栏容器 -->
    <div class="flex h-full min-h-0 flex-col bg-[var(--bg-panel)]">
        <!-- Tab 切换 -->
        <div class="flex shrink-0 items-center gap-1 border-b border-[var(--border-color)] px-2 py-1.5">
            <button
                v-for="tab in TABS"
                :key="tab.key"
                type="button"
                class="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-[12px] transition-colors"
                :class="activeTab === tab.key ? 'bg-[color-mix(in_srgb,var(--accent-main)_16%,transparent)] font-medium text-[var(--accent-main)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'"
                @click="activeTab = tab.key"
            >
                <span :class="tab.icon" class="h-3.5 w-3.5"></span>
                {{ tab.label }}
            </button>
            <button type="button" class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="刷新" @click="void refresh()">
                <span :class="loading ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-refresh-cw'" class="h-3.5 w-3.5"></span>
            </button>
        </div>

        <div v-if="loadError" class="border-b border-[var(--we-danger-border,#f87171)] bg-[var(--we-danger-soft,rgba(248,113,113,0.1))] px-3 py-2 text-[11px] text-[var(--we-danger,#ef4444)]">{{ loadError }}</div>

        <!-- 未初始化引导:rp/world-engine/ 配置缺失是开局前的正常状态 -->
        <div v-if="rpInitialized === false" class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <span class="i-lucide-sparkles h-8 w-8 text-[var(--accent-main)]"></span>
            <div class="text-[13px] font-semibold text-[var(--text-main)]">RP 世界尚未初始化</div>
            <div class="text-[12px] leading-relaxed text-[var(--text-muted)]">
                在右侧对话里对彩绘说「<span class="text-[var(--text-main)]">开始跑团</span>」,她会引导你搭建世界并自动创建 RP 环境。
            </div>
            <div class="text-[10px] text-[var(--text-muted)]">待创建:{{ rpMissing.join("、") }}</div>
        </div>

        <!-- 世界面板 -->
        <div v-else-if="activeTab === 'world'" class="min-h-0 flex-1 overflow-y-auto p-3 custom-scrollbar">
            <div v-if="!stateResult || !subjects.length" class="py-8 text-center text-[12px] text-[var(--text-muted)]">RP 世界线还没有记录。开始冒险后,世界状态会在这里生长。</div>
            <template v-else>
                <!-- 当前时间 -->
                <div class="mb-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2">
                    <div class="flex items-center gap-2 text-[11px] text-[var(--text-muted)]"><span class="i-lucide-clock h-3.5 w-3.5"></span>当前时间</div>
                    <div class="mt-1 font-mono text-[13px] text-[var(--text-main)]">{{ stateResult.time }}</div>
                </div>
                <!-- 世界 subject 状态 -->
                <div v-if="worldState" class="mb-3 rounded-md border border-[var(--border-color)] p-2.5">
                    <div class="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-main)]"><span class="i-lucide-globe-2 h-3.5 w-3.5 text-[var(--accent-main)]"></span>世界状态</div>
                    <div v-for="attr in characterAttrs(worldState.subjectId)" :key="attr.name" class="flex items-baseline gap-2 py-0.5 text-[12px]">
                        <span class="shrink-0 text-[var(--text-muted)]">{{ attr.name }}</span>
                        <span class="min-w-0 truncate text-[var(--text-main)]" :title="attr.text">{{ attr.text }}</span>
                    </div>
                </div>
                <!-- 分类计数 -->
                <div class="mb-3 rounded-md border border-[var(--border-color)] p-2.5">
                    <div class="mb-1.5 text-[12px] font-semibold text-[var(--text-main)]">登场要素</div>
                    <div class="flex flex-wrap gap-1.5">
                        <span v-for="group in typeGroups" :key="group.type" class="rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">{{ group.type }} × {{ group.members.length }}</span>
                    </div>
                </div>
                <!-- 最近事件 -->
                <div class="rounded-md border border-[var(--border-color)] p-2.5">
                    <div class="mb-1.5 text-[12px] font-semibold text-[var(--text-main)]">最近事件</div>
                    <div v-if="!recentSlices.length" class="text-[11px] text-[var(--text-muted)]">暂无</div>
                    <div v-for="slice in recentSlices" :key="slice.id" class="border-b border-[var(--border-color)] py-1.5 last:border-b-0">
                        <div class="truncate text-[12px] text-[var(--text-main)]" :title="slice.title">{{ slice.title || "(无标题)" }}</div>
                        <div class="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                            <span class="font-mono">{{ slice.time }}</span>
                            <span v-if="slice.kind === 'pending'" class="rounded bg-[color-mix(in_srgb,var(--we-warning,#f59e0b)_16%,transparent)] px-1 text-[var(--we-warning,#f59e0b)]">待发生</span>
                        </div>
                    </div>
                </div>
            </template>
        </div>

        <!-- 地图面板 -->
        <div v-else-if="activeTab === 'map'" class="min-h-0 flex-1">
            <RpGraphCanvas
                :graph="mapGraph"
                :type-colors="{location: 'var(--we-success, #22c55e)'}"
                empty-hint="地图还是空白。随着剧情提到新的地点与路线,这里会自动生长出世界地图。"
            />
        </div>

        <!-- 角色面板 -->
        <div v-else class="flex min-h-0 flex-1 flex-col">
            <div class="min-h-0 flex-[3] overflow-y-auto p-3 custom-scrollbar">
                <div v-if="!characterSubjects.length" class="py-8 text-center text-[12px] text-[var(--text-muted)]">还没有角色登场。</div>
                <!-- 每个角色一个独立卡片 -->
                <div v-for="character in characterSubjects" :key="character.id" class="mb-2 overflow-hidden rounded-md border border-[var(--border-color)]">
                    <button type="button" class="flex w-full items-center justify-between gap-2 bg-[var(--bg-input)] px-2.5 py-2 text-left transition-colors hover:bg-[var(--bg-hover)]" @click="expandedCharacterId = expandedCharacterId === character.id ? null : character.id">
                        <span class="flex min-w-0 items-center gap-2">
                            <span class="i-lucide-user h-3.5 w-3.5 shrink-0 text-[var(--accent-main)]"></span>
                            <span class="truncate text-[12px] font-semibold text-[var(--text-main)]">{{ character.name || character.id }}</span>
                        </span>
                        <span :class="expandedCharacterId === character.id ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"></span>
                    </button>
                    <div v-if="expandedCharacterId === character.id" class="px-2.5 py-2">
                        <div v-if="!characterAttrs(character.id).length" class="text-[11px] text-[var(--text-muted)]">当前时间点没有状态记录</div>
                        <div v-for="attr in characterAttrs(character.id)" :key="attr.name" class="flex items-baseline gap-2 py-0.5 text-[12px]">
                            <span class="w-[72px] shrink-0 text-[var(--text-muted)]">{{ attr.name }}</span>
                            <span class="min-w-0 flex-1 break-words text-[var(--text-main)]">{{ attr.text }}</span>
                        </div>
                    </div>
                </div>
            </div>
            <!-- 关系图 -->
            <div class="min-h-0 flex-[2] border-t border-[var(--border-color)]">
                <RpGraphCanvas
                    :graph="relationGraph"
                    :type-colors="{character: 'var(--accent-main)'}"
                    empty-hint="角色间还没有记录到关系。"
                />
            </div>
        </div>
    </div>
</template>
