<script setup lang="ts">
import {computed, ref} from "vue";
import {storeToRefs} from "pinia";
import Dialog from "nbook/app/components/common/Dialog.vue";
import PlotDecisionLedgerTab from "nbook/app/components/novel-ide/plot/planning/PlotDecisionLedgerTab.vue";
import PlotPromiseLedgerTab from "nbook/app/components/novel-ide/plot/planning/PlotPromiseLedgerTab.vue";
import PlotWorkbenchInspector from "nbook/app/components/novel-ide/plot/workbench/PlotWorkbenchInspector.vue";
import PlotWorkbenchSceneList from "nbook/app/components/novel-ide/plot/workbench/PlotWorkbenchSceneList.vue";
import PlotWorkbenchSidebar from "nbook/app/components/novel-ide/plot/workbench/PlotWorkbenchSidebar.vue";
import type {
    PlotThreadPanelChapter,
    PlotThreadPanelRef,
    PlotThreadPanelScene,
    PlotThreadPanelThread,
} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import type {WorkbenchManualRef} from "nbook/app/components/novel-ide/plot/workbench/plot-workbench.types";
import type {StoryActDto, StoryScenePromiseBeatDto} from "nbook/shared/dto/plot.dto";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {buildWorkspaceReferenceSections} from "nbook/app/utils/workspace-reference-menu";

type PlotWorkbenchStory = {
    id: string;
    title: string;
    summary: string;
};

type PlotWorkbenchPhase = {
    id: string;
    title: string;
    summary: string;
};

type WorkbenchInlineRefKind = "content" | "thread" | "scene";
type WorkbenchInlineRefSource = "scene";
type WorkbenchInlineRef = {
    id: string;
    kind: WorkbenchInlineRefKind;
    title: string;
    target: string;
    source: WorkbenchInlineRefSource;
    field: "summary" | "purpose" | "writingTip";
};
const props = defineProps<{
    modelValue: boolean;
    projectRoot: string;
    story: PlotWorkbenchStory;
    phases: PlotWorkbenchPhase[];
    threads: PlotThreadPanelThread[];
    scenes: PlotThreadPanelScene[];
    chapters: PlotThreadPanelChapter[];
    // 承载树卷实体:决策记录 tab 的锚点 kind=act 下拉与卷名解析;为空表示宿主未接承载树(如演示页)。
    acts?: StoryActDto[];
    selectedThreadId: string | null;
    selectedSceneId: string | null;
    // 当前选中 Scene 的 promise beats(「这场戏服务哪些线」);为空表示宿主未接 Scene 详情(如演示页)或该场无节拍。
    scenePromiseBeats?: StoryScenePromiseBeatDto[];
    pinnedThreadIds: string[];
    loading?: boolean;
    error?: string;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "selectThread", threadId: string): void;
    (e: "selectScene", sceneId: string): void;
    (e: "createThread"): void;
    (e: "toggleThreadPin", threadId: string): void;
    (e: "toggleThreadMain", threadId: string): void;
    (e: "deleteThread", threadId: string): void;
    (e: "createScene", threadId: string): void;
    (e: "autoSortScenes", sceneIds: string[]): void;
    (e: "reorderScenes", sceneIds: string[]): void;
    (e: "updateThread", threadId: string, patch: Partial<PlotThreadPanelThread>): void;
    (e: "updateScene", sceneId: string, patch: Partial<PlotThreadPanelScene>): void;
    (e: "openWorldEngine"): void;
    // 账本 tab(承诺/决策)UI 写操作成功的转发信号:宿主刷新剧情树计数,sceneIds 为需强刷详情缓存的场景。
    (e: "planningMutated", payload: {sceneIds?: string[]}): void;
}>();

const MARKDOWN_LINK_PATTERN = /\[([^\]]+)]\(([^)]+)\)/g;

const novelIdeStore = useNovelIdeStore();
// activeTab 直接读写 store 的 plotWorkbenchTab:侧栏计数入口、Scene 芯片跳转都通过它定位 tab;
// plotPlanningFocusId 是账本聚焦请求(Inspector 芯片跳转时写入,对应 tab 消费一次);
// workspaceTree 是 refs 目标候选的内容节点来源(与 @ 引用菜单同源)。
const {plotWorkbenchTab: activeTab, plotPlanningFocusId, workspaceTree} = storeToRefs(novelIdeStore);
const inspectorMode = ref<"thread" | "scene" | null>(null);
const search = ref("");
const threadMode = ref<"all" | "main" | "support" | "active" | "draft" | "paused" | "unmounted" | "pinned">("all");

// 三个真 tab:线程规划(默认)/承诺账本/决策记录,主体随 tab 切换。
const tabs: Array<{value: "thread" | "promises" | "decisions"; label: string; icon: string}> = [
    {value: "thread", label: "线程规划", icon: "i-lucide-git-branch-plus"},
    {value: "promises", label: "承诺账本", icon: "i-lucide-scroll-text"},
    {value: "decisions", label: "决策记录", icon: "i-lucide-gavel"},
];

const selectedThread = computed(() => {
    return props.threads.find((thread) => thread.id === props.selectedThreadId) ?? null;
});
const selectedScene = computed(() => {
    return props.scenes.find((scene) => scene.id === props.selectedSceneId) ?? null;
});
const selectedPhase = computed(() => {
    return props.phases.find((phase) => phase.id === selectedThread.value?.phaseId) ?? props.phases[0] ?? null;
});
const effectiveRefs = computed<WorkbenchInlineRef[]>(() => {
    if (inspectorMode.value !== "scene" || !selectedScene.value) {
        return [];
    }
    return extractWorkbenchInlineRefs("scene", selectedScene.value.id, [
        ["summary", selectedScene.value.summary],
        ["purpose", selectedScene.value.purpose ?? ""],
        ["writingTip", selectedScene.value.writingTip ?? ""],
    ]);
});
// 空 query 的默认候选:引用卡片的展示解析(label/icon)与弹层初始列表用。
const refTargetOptions = computed(() => buildRefTargetOptions(""));
const manualRefs = computed<WorkbenchManualRef[]>(() => {
    if (inspectorMode.value !== "scene") {
        return [];
    }
    return toManualRefs(selectedScene.value?.refs ?? []);
});

/**
 * 同步选中 Thread，同时让右侧检查器回到 Thread/Scene 的可见对象。
 */
function selectThread(threadId: string): void {
    emit("selectThread", threadId);
}

/**
 * 同步选中 Scene。
 */
function selectScene(sceneId: string): void {
    emit("selectScene", sceneId);
}

/**
 * 打开 Thread 检查器。
 */
function editThread(threadId: string): void {
    emit("selectThread", threadId);
    inspectorMode.value = "thread";
}

/**
 * 打开 Scene 检查器。
 */
function editScene(sceneId: string): void {
    emit("selectScene", sceneId);
    inspectorMode.value = "scene";
}

/**
 * 更新当前对象的手动 refs。
 */
function updateManualRefs(refs: WorkbenchManualRef[]): void {
    if (inspectorMode.value === "scene" && selectedScene.value) {
        emit("updateScene", selectedScene.value.id, {refs: toPanelRefs(refs)});
    }
}

/**
 * 生成 refs target 候选列表:thread/scene 来自工作台 props(按 query 本地匹配),
 * 内容节点候选与 @ 引用菜单同源(workspace tree),query 透传给搜索器按需搜索——
 * 空 query 只返回默认截断列表(maxResults),带 query 才能覆盖大型 workspace 靠后的节点,
 * 因此消费方(引用弹层)必须走 searchRefTargetOptions 而不是只过滤一次性列表。
 */
function buildRefTargetOptions(query: string): SelectOption[] {
    const normalized = query.trim().toLowerCase();
    // thread/scene 数量可控,按标题/摘要包含匹配即可。
    const matches = (label: string, description: string): boolean => !normalized
        || label.toLowerCase().includes(normalized)
        || description.toLowerCase().includes(normalized);
    const options: SelectOption[] = [];
    for (const thread of props.threads) {
        const label = thread.title || "未命名 Thread";
        if (matches(label, thread.summary)) {
            options.push({ value: `thread://${thread.id}`, label, iconClass: "i-lucide-git-branch", description: thread.summary });
        }
    }
    for (const scene of props.scenes) {
        const label = scene.title || "未命名 Scene";
        if (matches(label, scene.summary)) {
            options.push({ value: `scene://${scene.id}`, label, iconClass: "i-lucide-clapperboard", description: scene.summary });
        }
    }
    for (const section of buildWorkspaceReferenceSections(workspaceTree.value, query)) {
        for (const item of section.items) {
            if (!item.workspaceReference) {
                continue;
            }
            options.push({ value: item.workspaceReference.target, label: item.label, iconClass: item.iconClass, description: item.description });
        }
    }
    return options;
}

/**
 * 承诺账本节拍行点场景:切回线程规划 tab,并转发给宿主选中该 Scene。
 */
function jumpToSceneFromLedger(sceneId: string): void {
    activeTab.value = "thread";
    emit("selectScene", sceneId);
}

/**
 * Inspector 的 Scene 芯片跳转:置聚焦请求并切到承诺账本 tab(工作台已开着,不动 open)。
 */
function focusPromiseFromInspector(promiseId: string): void {
    plotPlanningFocusId.value = promiseId;
    activeTab.value = "promises";
}

/**
 * 从剧情字段里的 Markdown link 派生工作台引用。
 */
function extractWorkbenchInlineRefs(
    source: WorkbenchInlineRefSource,
    sourceId: string,
    fields: Array<[WorkbenchInlineRef["field"], string]>,
): WorkbenchInlineRef[] {
    const refs = new Map<string, WorkbenchInlineRef>();
    for (const [field, text] of fields) {
        for (const matched of text.matchAll(MARKDOWN_LINK_PATTERN)) {
            const title = matched[1]?.trim() ?? "";
            const target = normalizeInlineTarget(matched[2] ?? "");
            const kind = resolveInlineRefKind(target);
            if (!title || !target || !kind) {
                continue;
            }

            const key = `${source}:${sourceId}:${field}:${kind}:${target}:${title}`;
            refs.set(key, {
                id: key,
                kind,
                title,
                target,
                source,
                field,
            });
        }
    }
    return [...refs.values()];
}

/**
 * 判断 inline ref 目标类型。外部 URL 不进入 effective refs。
 */
function resolveInlineRefKind(target: string): WorkbenchInlineRefKind | null {
    if (/^https?:\/\//i.test(target)) {
        return null;
    }
    if (target.startsWith("thread://")) {
        return "thread";
    }
    if (target.startsWith("scene://")) {
        return "scene";
    }
    if (target && !target.startsWith("#") && !/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) {
        return "content";
    }
    return null;
}

/**
 * 保留 workspace path 形态，去掉 query/hash 方便展示和去重。
 */
function normalizeInlineTarget(raw: string): string {
    return raw.trim().replace(/\\/g, "/").replace(/[?#].*$/, "");
}

/**
 * 把现有 Scene refs 类型转换成通用 content-node refs 形状。
 */
function toManualRefs(refs: PlotThreadPanelRef[]): WorkbenchManualRef[] {
    return refs.map((refItem) => ({
        id: refItem.id,
        relation: refItem.relation,
        target: refItem.target,
        note: refItem.note ?? null,
    }));
}

/**
 * 当前面板引用类型仍要求 visibility，写回时内部补默认值。
 */
function toPanelRefs(refs: WorkbenchManualRef[]): PlotThreadPanelRef[] {
    return refs.map((refItem) => ({
        ...refItem,
        visibility: "author",
    }));
}
</script>

<template>
    <Dialog
        :model-value="props.modelValue"
        size="full"
        overlay-type="opaque"
        :show-footer="false"
        :close-on-overlay="false"
        body-class="!gap-0 !overflow-hidden !p-0"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <template #header>
            <!-- 剧本工作台顶部栏:面包屑 = 小说标题 › 阶段 › 选中线(主/支按 isMainThread);状态区只报加载中/失败,不虚构保存状态 -->
            <div class="flex min-w-0 flex-1 items-center gap-3">
                <span class="workbench-accent-icon">
                    <span class="i-lucide-pen-line h-4 w-4"></span>
                </span>
                <span class="text-[16px] font-semibold text-[var(--text-main)]">剧本工作台</span>
                <span class="hidden max-w-[200px] truncate text-[13px] text-[var(--text-muted)] md:inline">{{ props.story.title }}</span>
                <span class="hidden text-[13px] text-[var(--text-muted)] md:inline">›</span>
                <span class="hidden truncate text-[13px] text-[var(--text-secondary)] md:inline">{{ selectedPhase?.title ?? "未分阶段" }}</span>
                <template v-if="selectedThread">
                    <span class="hidden text-[13px] text-[var(--text-muted)] lg:inline">›</span>
                    <span class="hidden max-w-[260px] truncate text-[13px] text-[var(--text-secondary)] lg:inline">{{ selectedThread.isMainThread ? "主线" : "支线" }}：{{ selectedThread.title }}</span>
                </template>

                <span class="ml-auto flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                    <template v-if="props.error || props.loading">
                        <span class="h-2 w-2 rounded-full" :class="props.error ? 'bg-[var(--status-danger)]' : 'bg-[var(--status-warning)]'"></span>
                        {{ props.error ? "加载失败" : "加载中" }}
                    </template>
                </span>

                <button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="emit('update:modelValue', false)">
                    <span class="i-lucide-x h-4 w-4"></span>
                </button>
            </div>
        </template>

        <!-- 工作台主体 -->
        <div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-[color-mix(in_srgb,var(--bg-main)_96%,white)]">
            <nav class="flex h-11 shrink-0 items-center justify-center gap-10 border-b border-[var(--border-color)] bg-[var(--bg-panel)]/88 px-8 text-[12px] font-medium shadow-sm">
                <button
                    v-for="tab in tabs"
                    :key="tab.value"
                    type="button"
                    class="relative inline-flex h-full items-center justify-center gap-2 transition-colors"
                    :class="activeTab === tab.value ? 'text-[var(--accent-main)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-main)]'"
                    @click="activeTab = tab.value"
                >
                    <span class="h-4 w-4 transition-opacity" :class="[tab.icon, activeTab === tab.value ? 'opacity-100' : 'opacity-60']"></span>
                    <span class="truncate">{{ tab.label }}</span>
                    <div v-if="activeTab === tab.value" class="absolute bottom-0 left-0 right-0 h-[2px] rounded-t-full bg-[var(--accent-main)]"></div>
                </button>
            </nav>

            <div class="relative flex min-h-0 flex-1">
                <div v-if="props.error" class="absolute left-1/2 top-[70px] z-20 -translate-x-1/2 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-[12px] text-[var(--status-danger)] shadow-sm">
                    {{ props.error }}
                </div>

                <!-- 线程规划 tab:Sidebar + SceneList + Inspector 三件套 -->
                <template v-if="activeTab === 'thread'">
                    <PlotWorkbenchSidebar
                        v-model:search="search"
                        v-model:mode="threadMode"
                        :threads="props.threads"
                        :scenes="props.scenes"
                        :pinned-thread-ids="props.pinnedThreadIds"
                        :selected-thread-id="props.selectedThreadId"
                        @select-thread="selectThread"
                        @edit-thread="editThread"
                        @create-thread="emit('createThread')"
                        @toggle-thread-pin="emit('toggleThreadPin', $event)"
                        @toggle-thread-main="emit('toggleThreadMain', $event)"
                        @delete-thread="emit('deleteThread', $event)"
                    />

                    <PlotWorkbenchSceneList
                        :thread="selectedThread"
                        :phase-title="selectedPhase?.title ?? null"
                        :scenes="props.scenes"
                        :chapters="props.chapters"
                        :selected-scene-id="props.selectedSceneId"
                        @select-scene="selectScene"
                        @edit-scene="editScene"
                        @create-scene="emit('createScene', $event)"
                        @auto-sort-scenes="emit('autoSortScenes', $event)"
                        @reorder-scenes="emit('reorderScenes', $event)"
                    />

                    <Transition name="inspector">
                        <PlotWorkbenchInspector
                            v-if="inspectorMode"
                            :mode="inspectorMode"
                            :project-root="props.projectRoot"
                            :thread="selectedThread"
                            :scene="selectedScene"
                            :chapters="props.chapters"
                            :scene-promise-beats="props.scenePromiseBeats ?? []"
                            :effective-refs="effectiveRefs"
                            :manual-refs="manualRefs"
                            :ref-target-options="refTargetOptions"
                            :ref-target-search="buildRefTargetOptions"
                            @close="inspectorMode = null"
                            @update-thread="(threadId, patch) => emit('updateThread', threadId, patch)"
                            @update-scene="(sceneId, patch) => emit('updateScene', sceneId, patch)"
                            @update-refs="updateManualRefs"
                            @focus-promise="focusPromiseFromInspector"
                            @open-world-engine="emit('openWorldEngine')"
                        />
                    </Transition>
                </template>

                <!-- 承诺账本 tab:自含数据加载,节拍行点场景跳回线程规划;写操作成功经 mutated 转发宿主刷新计数与场景缓存 -->
                <PlotPromiseLedgerTab
                    v-else-if="activeTab === 'promises'"
                    :project-root="props.projectRoot"
                    :chapters="props.chapters"
                    :threads="props.threads"
                    :scenes="props.scenes"
                    @select-scene="jumpToSceneFromLedger"
                    @mutated="emit('planningMutated', $event)"
                />

                <!-- 决策记录 tab:自含数据加载,引用/锚点点场景同样跳回线程规划 -->
                <PlotDecisionLedgerTab
                    v-else
                    :project-root="props.projectRoot"
                    :acts="props.acts ?? []"
                    :chapters="props.chapters"
                    :threads="props.threads"
                    :scenes="props.scenes"
                    @select-scene="jumpToSceneFromLedger"
                    @mutated="emit('planningMutated', $event)"
                />
            </div>
        </div>
    </Dialog>
</template>

<style scoped>
.workbench-top-button {
    display: inline-flex;
    height: 2rem;
    align-items: center;
    gap: 0.375rem;
    border-radius: 0.375rem;
    border: 1px solid var(--border-color);
    background: var(--bg-input);
    padding: 0 0.75rem;
    font-size: 12px;
    color: var(--text-main);
    transition: background-color 0.15s ease, color 0.15s ease;
}

.workbench-top-button:hover {
    background: var(--bg-hover);
}

.workbench-accent-icon {
    display: flex;
    height: 1.75rem;
    width: 1.75rem;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border-radius: 0.375rem;
    border: 1px solid color-mix(in srgb, var(--accent-main) 58%, var(--border-color));
    background: color-mix(in srgb, var(--accent-main) 18%, var(--bg-panel));
    color: color-mix(in srgb, var(--accent-main) 86%, var(--accent-text));
}

.inspector-enter-active,
.inspector-leave-active {
    transition: margin-right 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.inspector-enter-from,
.inspector-leave-to {
    margin-right: -380px;
    transform: translateX(20px);
    opacity: 0;
}
</style>
