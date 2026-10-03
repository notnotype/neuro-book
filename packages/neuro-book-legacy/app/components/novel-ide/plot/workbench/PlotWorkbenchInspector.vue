<script setup lang="ts">
import {computed, watch} from "vue";
import FormField from "nbook/app/components/common/form/FormField.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import StructuredTextEditor from "nbook/app/components/common/form/StructuredTextEditor.vue";
import RefEditorPopover from "./RefEditorPopover.vue";
import SubjectMultiSelect from "nbook/app/components/novel-ide/plot/workbench/SubjectMultiSelect.vue";
import SubjectSingleSelect from "nbook/app/components/novel-ide/plot/workbench/SubjectSingleSelect.vue";
import WorldEngineContextPanel from "nbook/app/components/novel-ide/plot/workbench/WorldEngineContextPanel.vue";
import type {WorkbenchManualRef} from "nbook/app/components/novel-ide/plot/workbench/plot-workbench.types";
import {
    PLOT_SCENE_STATUS_LABELS,
    PLOT_THREAD_STATUS_LABELS,
    type PlotThreadPanelChapter,
    type PlotThreadPanelScene,
    type PlotThreadPanelThread,
} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";
import {
    PLANNING_TONE_CLASSES,
    PROMISE_BEAT_KIND_META,
    PROMISE_BEAT_STATE_META,
    SCENE_OUTCOME_TYPE_OPTIONS,
    SCENE_PACING_ROLE_OPTIONS,
    THREAD_MICE_TYPE_OPTIONS,
} from "nbook/app/components/novel-ide/plot/planning/plot-planning.types";
import type {
    StorySceneOutcomeTypeDto,
    StoryScenePacingRoleDto,
    StoryScenePromiseBeatDto,
    StorySceneStatusDto,
    StoryThreadMiceTypeDto,
    StoryThreadStatusDto,
} from "nbook/shared/dto/plot.dto";

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
    mode: "thread" | "scene";
    projectRoot: string;
    thread: PlotThreadPanelThread | null;
    scene: PlotThreadPanelScene | null;
    chapters: PlotThreadPanelChapter[];
    // 当前 Scene 的 promise beats(「这场戏服务哪些线」);为空表示宿主未接详情或该场无节拍。
    scenePromiseBeats?: StoryScenePromiseBeatDto[];
    effectiveRefs: WorkbenchInlineRef[];
    manualRefs: WorkbenchManualRef[];
    refTargetOptions: SelectOption[];
    // 按 query 即时搜索 refs 目标候选(覆盖大型 workspace 靠后的内容节点);为空表示宿主未提供,弹层退回静态列表本地过滤。
    refTargetSearch?: (query: string) => SelectOption[];
}>();

const emit = defineEmits<{
    (e: "close"): void;
    (e: "updateThread", threadId: string, patch: Partial<PlotThreadPanelThread>): void;
    (e: "updateScene", sceneId: string, patch: Partial<PlotThreadPanelScene>): void;
    (e: "updateRefs", refs: WorkbenchManualRef[]): void;
    (e: "focusPromise", promiseId: string): void;
    (e: "openWorldEngine"): void;
}>();

const activeRefId = ref<string | null>(null);
const refCardRefs = ref<Record<string, HTMLElement>>({});
const manualRefsDraft = ref<WorkbenchManualRef[]>([]);
const manualRefsDraftSceneId = ref<string | null>(null);
const worldContextVisible = ref(false);

watch(() => [props.scene?.id, props.manualRefs], () => {
    const sceneId = props.scene?.id ?? null;
    if (manualRefsDraftSceneId.value !== sceneId) {
        manualRefsDraftSceneId.value = sceneId;
        manualRefsDraft.value = props.manualRefs.map((refItem) => ({...refItem}));
        activeRefId.value = null;
        return;
    }

    const hasIncompleteDraft = manualRefsDraft.value.some((refItem) => !isManualRefComplete(refItem));
    if (hasIncompleteDraft) {
        return;
    }
    manualRefsDraft.value = props.manualRefs.map((refItem) => ({...refItem}));
}, {immediate: true});

function setRefCardRef(el: any, id: string) {
    if (el) {
        refCardRefs.value[id] = el.$el || el;
    } else {
        delete refCardRefs.value[id];
    }
}

function getTargetIcon(target: string | null) {
    if (!target) return 'i-lucide-bookmark';
    const opt = props.refTargetOptions.find(o => o.value === target);
    return opt?.iconClass || 'i-lucide-bookmark';
}

function getTargetLabel(target: string | null) {
    if (!target) return '未选择目标';
    const opt = props.refTargetOptions.find(o => o.value === target);
    return opt?.label || target;
}

function getTargetDescription(target: string | null) {
    if (!target) return null;
    const opt = props.refTargetOptions.find(o => o.value === target);
    return opt?.description || null;
}

const threadStatusOptions: SelectOption[] = Object.entries(PLOT_THREAD_STATUS_LABELS).map(([value, label]) => ({
    value,
    label,
}));
const sceneStatusOptions: SelectOption[] = Object.entries(PLOT_SCENE_STATUS_LABELS).map(([value, label]) => ({
    value,
    label,
}));
const RELATION_LABELS: Record<string, string> = {
    mentions: "提及 (mentions)",
    depends_on: "前置依赖 (depends_on)",
    conflicts_with: "冲突 (conflicts_with)",
    setup_for: "铺垫 (setup_for)",
    derived_from: "派生自 (derived_from)",
};

const refRelationOptions: SelectOption[] = Object.entries(RELATION_LABELS).map(([value, label]) => ({
    value,
    label,
}));

function getRelationLabel(relation: string | null) {
    if (!relation) return "未设置关联";
    return RELATION_LABELS[relation] || relation;
}
const chapterOptions = computed<SelectOption[]>(() => [
    {value: "", label: "未挂章"},
    ...props.chapters.map((chapter) => ({
        value: chapter.id,
        label: `${chapter.numberLabel} · ${chapter.title}`,
    })),
]);
const currentTitle = computed(() => {
    if (props.mode === "thread") {
        return props.thread?.title ?? "Thread";
    }
    if (props.mode === "scene") {
        return props.scene?.title ?? "Scene";
    }
    return "Scene";
});
const refsByKind = computed(() => {
    const groups: Record<WorkbenchInlineRefKind, WorkbenchInlineRef[]> = {
        content: [],
        thread: [],
        scene: [],
    };
    for (const refItem of props.effectiveRefs) {
        groups[refItem.kind].push(refItem);
    }
    return groups;
});
const visibleRefGroups = computed(() => [
    {kind: "content" as const, label: "内容节点", items: refsByKind.value.content},
    {kind: "thread" as const, label: "Thread", items: refsByKind.value.thread},
    {kind: "scene" as const, label: "Scene", items: refsByKind.value.scene},
].filter((group) => group.items.length > 0));
const showRefs = computed(() => props.mode === "scene" && Boolean(props.scene));

/**
 * 更新当前 Thread。
 */
function updateThread(patch: Partial<PlotThreadPanelThread>): void {
    if (!props.thread) {
        return;
    }
    emit("updateThread", props.thread.id, patch);
}

/**
 * 更新当前 Scene。
 */
function updateScene(patch: Partial<PlotThreadPanelScene>): void {
    if (!props.scene) {
        return;
    }
    emit("updateScene", props.scene.id, patch);
}

/**
 * 新增一条手动 refs。
 */
function addManualRef(): void {
    const newId = `ref-workbench-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    manualRefsDraft.value = [
        ...manualRefsDraft.value,
        {
            id: newId,
            relation: "",
            target: "",
            note: null,
        },
    ];
    activeRefId.value = newId;
}

/**
 * 更新手动 refs 中的一项。
 */
function updateManualRef(refId: string, patch: Partial<WorkbenchManualRef>): void {
    const nextRefs = manualRefsDraft.value.map((refItem) => refItem.id === refId
        ? {
            ...refItem,
            ...patch,
        }
        : refItem);
    manualRefsDraft.value = nextRefs;
    emitCompleteManualRefs(nextRefs);
}

/**
 * 删除一条手动 refs。
 */
function removeManualRef(refId: string): void {
    const nextRefs = manualRefsDraft.value.filter((refItem) => refItem.id !== refId);
    manualRefsDraft.value = nextRefs;
    emitCompleteManualRefs(nextRefs);
}

/**
 * 判断手动 ref 是否已经满足后端结构化引用合同。
 */
function isManualRefComplete(refItem: WorkbenchManualRef): boolean {
    return refItem.relation.trim().length > 0 && refItem.target.trim().length > 0;
}

/**
 * 只把完整 ref 同步给父组件，空白草稿留在检查器本地。
 */
function emitCompleteManualRefs(refs: WorkbenchManualRef[]): void {
    emit("updateRefs", refs
        .filter(isManualRefComplete)
        .map((refItem) => ({
            id: refItem.id,
            relation: refItem.relation.trim(),
            target: refItem.target.trim(),
            note: refItem.note?.trim() || null,
        })));
}

/**
 * 更新当前 Scene 的 World Anchor。
 */
function updateWorldAnchor(patch: Partial<PlotThreadPanelScene["worldAnchor"]>): void {
    if (!props.scene) {
        return;
    }
    emit("updateScene", props.scene.id, {
        worldAnchor: {
            ...props.scene.worldAnchor,
            ...patch,
        },
    });
}
</script>

<template>
    <!-- 工作台右侧编辑检查器 -->
    <aside class="flex min-h-0 w-[380px] shrink-0 flex-col border-l border-[var(--border-color)] bg-[var(--bg-panel)]/88">
        <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3 custom-scrollbar">
            <div class="mb-4 flex items-center justify-between gap-3">
                <div class="min-w-0">
                    <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">当前编辑：{{ props.mode }}</div>
                    <div class="mt-0.5 truncate text-[13px] font-semibold text-[var(--text-main)]">{{ currentTitle }}</div>
                </div>
                <div class="flex items-center gap-1">
                    <button type="button" class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="关闭检查器" @click="emit('close')">
                        <span class="i-lucide-panel-right-close h-3.5 w-3.5"></span>
                    </button>
                </div>
            </div>

            <section v-if="props.mode === 'thread' && props.thread" class="space-y-3">
                <div class="grid grid-cols-[minmax(0,1fr)_112px] gap-2">
                    <FormField label="标题">
                        <FormInput :model-value="props.thread.title" placeholder="Thread 标题" @update:model-value="updateThread({title: $event})" />
                    </FormField>
                    <FormField label="状态">
                        <FormSelect :model-value="props.thread.status" :options="threadStatusOptions" @update:model-value="updateThread({status: $event as StoryThreadStatusDto})" />
                    </FormField>
                </div>
                <FormField label="线型(MICE)">
                    <FormSelect :model-value="props.thread.miceType ?? ''" :options="THREAD_MICE_TYPE_OPTIONS" @update:model-value="updateThread({miceType: ($event || null) as StoryThreadMiceTypeDto | null})" />
                </FormField>
                <FormField label="摘要">
                    <StructuredTextEditor
                        :model-value="props.thread.summary"
                        :rows="12"
                        :min-height="228"
                        :max-height="380"
                        placeholder="Thread 摘要，可使用 [标题](lorebook/...) 或 [Scene](scene://...)"
                        @update:model-value="updateThread({summary: $event})"
                    />
                </FormField>
                <FormField label="写作提示">
                    <StructuredTextEditor
                        :model-value="props.thread.writingTip ?? ''"
                        :rows="6"
                        :min-height="114"
                        :max-height="380"
                        placeholder="写作提示，可写入 inline ref"
                        @update:model-value="updateThread({writingTip: $event || null})"
                    />
                </FormField>
            </section>

            <section v-else-if="props.mode === 'scene' && props.scene" class="space-y-3">
                <div class="grid grid-cols-[minmax(0,1fr)_112px] gap-2">
                    <FormField label="标题">
                        <FormInput :model-value="props.scene.title" placeholder="Scene 标题" @update:model-value="updateScene({title: $event})" />
                    </FormField>
                    <FormField label="状态">
                        <FormSelect :model-value="props.scene.status" :options="sceneStatusOptions" @update:model-value="updateScene({status: $event as StorySceneStatusDto})" />
                    </FormField>
                </div>
                <div class="grid grid-cols-1 gap-2">
                    <FormField label="所属章节">
                        <FormSelect :model-value="props.scene.chapterId ?? ''" :options="chapterOptions" @update:model-value="updateScene({chapterId: $event || null})" />
                    </FormField>
                </div>
                <!-- 节奏字段:本场结果与张弛角色(Task 93 规划层,null=未填写) -->
                <div class="grid grid-cols-2 gap-2">
                    <FormField label="结果类型">
                        <FormSelect :model-value="props.scene.outcomeType ?? ''" :options="SCENE_OUTCOME_TYPE_OPTIONS" @update:model-value="updateScene({outcomeType: ($event || null) as StorySceneOutcomeTypeDto | null})" />
                    </FormField>
                    <FormField label="节奏角色">
                        <FormSelect :model-value="props.scene.pacingRole ?? ''" :options="SCENE_PACING_ROLE_OPTIONS" @update:model-value="updateScene({pacingRole: ($event || null) as StoryScenePacingRoleDto | null})" />
                    </FormField>
                </div>
                <!-- 本场服务的承诺线(promise beats):只读芯片,点击跳承诺账本聚焦;节拍增删在账本侧 -->
                <div v-if="(props.scenePromiseBeats ?? []).length" class="space-y-1">
                    <div class="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">服务承诺</div>
                    <div class="flex flex-wrap gap-1.5">
                        <button
                            v-for="beat in props.scenePromiseBeats"
                            :key="beat.id"
                            type="button"
                            data-testid="workbench-inspector-promise-beat-chip"
                            class="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] transition-opacity hover:opacity-80"
                            :class="PLANNING_TONE_CLASSES[PROMISE_BEAT_STATE_META[beat.state].tone].chip"
                            :title="`${PROMISE_BEAT_KIND_META[beat.kind].label} · ${PROMISE_BEAT_STATE_META[beat.state].label}${beat.note ? ` · ${beat.note}` : ''}`"
                            @click="emit('focusPromise', beat.promiseId)"
                        >
                            <span class="h-3 w-3 shrink-0" :class="PROMISE_BEAT_KIND_META[beat.kind].iconClass"></span>
                            <span class="max-w-[140px] truncate">{{ beat.promiseTitle }}</span>
                        </button>
                    </div>
                </div>
                <FormField label="摘要">
                    <StructuredTextEditor
                        :model-value="props.scene.summary"
                        :rows="12"
                        :min-height="228"
                        :max-height="380"
                        placeholder="Scene 摘要，可使用内容节点或 scene inline ref"
                        @update:model-value="updateScene({summary: $event})"
                    />
                    <div class="mt-1 text-right text-[10px] text-[var(--text-muted)]">{{ props.scene.summary.length }}/5000</div>
                </FormField>
                <FormField label="目的">
                    <StructuredTextEditor
                        :model-value="props.scene.purpose ?? ''"
                        :rows="8"
                        :min-height="152"
                        :max-height="380"
                        placeholder="Scene 目的"
                        @update:model-value="updateScene({purpose: $event || null})"
                    />
                </FormField>
                <FormField label="写作提示">
                    <StructuredTextEditor
                        :model-value="props.scene.writingTip ?? ''"
                        :rows="6"
                        :min-height="114"
                        :max-height="380"
                        placeholder="写作提示"
                        @update:model-value="updateScene({writingTip: $event || null})"
                    />
                </FormField>

                <div class="mt-4 space-y-3 border-t border-[var(--border-color)] pt-4">
                    <div class="flex items-center justify-between">
                        <div class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">World Engine</div>
                        <button type="button" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)]" @click="worldContextVisible = !worldContextVisible">
                            <span class="i-lucide-orbit h-3.5 w-3.5"></span>
                            上下文
                        </button>
                    </div>
                    <div class="grid grid-cols-1 gap-2">
                        <FormField label="开始时间">
                            <FormInput :model-value="props.scene.worldAnchor.startTime ?? ''" placeholder="项目日历时间，留空表示未连接" @update:model-value="updateWorldAnchor({startTime: $event.trim() || null, startInstant: null})" />
                        </FormField>
                        <FormField label="结束时间">
                            <FormInput :model-value="props.scene.worldAnchor.endTime ?? ''" placeholder="项目日历时间，留空表示未连接" @update:model-value="updateWorldAnchor({endTime: $event.trim() || null, endInstant: null})" />
                        </FormField>
                    </div>
                    <FormField label="出场 Subjects">
                        <SubjectMultiSelect :project-root="props.projectRoot" :model-value="props.scene.worldAnchor.subjectIds" @update:model-value="updateWorldAnchor({subjectIds: $event})" />
                    </FormField>
                    <FormField label="地点">
                        <SubjectSingleSelect :project-root="props.projectRoot" :model-value="props.scene.worldAnchor.locationSubjectId" @update:model-value="updateWorldAnchor({locationSubjectId: $event})" />
                    </FormField>
                    <div v-if="props.scene.worldAnchor.unresolvedSubjectIds.length" class="rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--status-warning)]">
                        <div class="mb-1 flex items-center gap-1 font-semibold">
                            <span class="i-lucide-alert-triangle h-3.5 w-3.5"></span>
                            World Engine subject 尚未接入
                        </div>
                        <div class="break-all font-mono">{{ props.scene.worldAnchor.unresolvedSubjectIds.join("，") }}</div>
                    </div>
                    <WorldEngineContextPanel v-if="worldContextVisible" :project-root="props.projectRoot" :scene-id="props.scene.id" @open-world-engine="emit('openWorldEngine')" />
                </div>
            </section>

            <section v-else class="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--bg-input)]/30 px-4 py-8 text-center text-[12px] text-[var(--text-muted)]">
                请选择一个对象开始编辑。
            </section>

            <div v-if="showRefs" class="mt-4 space-y-4">
                <div class="space-y-2">
                    <div class="flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
                        <span>Refs (手动)</span>
                        <button type="button" class="inline-flex items-center gap-0.5 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-main)]" @click="addManualRef">
                            <span class="i-lucide-plus h-3 w-3"></span>
                            添加
                        </button>
                    </div>
                    <div v-if="manualRefsDraft.length" class="space-y-2">
                        <div v-for="refItem in manualRefsDraft" :key="refItem.id" class="relative" :class="activeRefId === refItem.id ? 'z-50' : 'z-10'">
                            <!-- DISPLAY CARD -->
                            <div 
                                :ref="(el) => setRefCardRef(el, refItem.id)"
                                class="group relative flex cursor-pointer flex-col gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-2.5 transition-all hover:border-[var(--border-strong)] hover:shadow-sm" 
                                :class="activeRefId === refItem.id ? 'ring-1 ring-[var(--accent-main)]/50 !border-[var(--accent-main)]/50 shadow-sm' : ''"
                                @click.stop="activeRefId = activeRefId === refItem.id ? null : refItem.id"
                            >
                                <div class="flex items-start gap-2">
                                    <span class="mt-0.5 shrink-0 text-[14px] text-[var(--accent-main)] opacity-90" :class="getTargetIcon(refItem.target)"></span>
                                    <div class="min-w-0 flex-1">
                                        <div class="flex items-center gap-1.5" :title="refItem.target || '尚未选择目标路径'">
                                            <span class="shrink-0 whitespace-nowrap rounded-[4px] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">{{ getRelationLabel(refItem.relation) }}</span>
                                            <span class="truncate text-[12px] font-semibold text-[var(--text-main)]">{{ getTargetLabel(refItem.target) }}</span>
                                        </div>
                                        <div v-if="getTargetDescription(refItem.target)" class="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)] line-clamp-2">
                                            {{ getTargetDescription(refItem.target) }}
                                        </div>
                                        <div v-if="refItem.note" class="mt-1.5 rounded-md bg-[var(--bg-sidebar)] px-2 py-1 text-[11px] leading-relaxed text-[var(--text-main)]">
                                            {{ refItem.note }}
                                        </div>
                                    </div>
                                </div>
                                
                                <div class="absolute right-1.5 top-1.5 flex opacity-0 transition-opacity group-hover:opacity-100">
                                    <button type="button" class="flex h-5 w-5 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="删除" @click.stop="removeManualRef(refItem.id)">
                                        <span class="i-lucide-x h-3.5 w-3.5"></span>
                                    </button>
                                </div>
                            </div>
                            
                            <!-- EDIT POPOVER -->
                            <RefEditorPopover
                                v-if="activeRefId === refItem.id"
                                :ref-item="refItem"
                                :ref-relation-options="refRelationOptions"
                                :ref-target-options="props.refTargetOptions"
                                :ref-target-search="props.refTargetSearch"
                                :anchor-element="refCardRefs[refItem.id] ?? null"
                                @update="updateManualRef(refItem.id, $event)"
                                @close="activeRefId = null"
                            />
                        </div>
                    </div>
                    <div v-else class="rounded-md border border-dashed border-[var(--border-color)] bg-transparent px-3 py-3 text-center text-[11px] text-[var(--text-muted)]">
                        暂无手动引用
                    </div>
                </div>

                <div class="space-y-2">
                    <div class="flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
                        <span>有效引用 (内联派生)</span>
                    </div>
                    <div v-if="visibleRefGroups.length" class="space-y-2.5">
                        <div v-for="group in visibleRefGroups" :key="group.kind" class="space-y-1">
                            <div class="text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] opacity-70">
                                {{ group.label }}
                            </div>
                            <div class="space-y-1.5">
                                <div v-for="refItem in group.items" :key="refItem.id" class="flex flex-col gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-2.5 transition-all hover:border-[var(--border-strong)] hover:shadow-sm">
                                    <div class="flex items-start gap-2">
                                        <span class="mt-0.5 shrink-0 text-[14px] text-[var(--accent-main)]" :class="getTargetIcon(refItem.target)"></span>
                                        <div class="min-w-0 flex-1">
                                            <div class="flex items-center gap-1.5">
                                                <span class="rounded-[4px] bg-[var(--accent-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent-text)]">inline</span>
                                                <span class="truncate text-[12px] font-semibold text-[var(--text-main)]">{{ getTargetLabel(refItem.target) }}</span>
                                            </div>
                                            <div class="mt-0.5 truncate font-mono text-[9px] text-[var(--text-muted)] opacity-60">{{ refItem.target }}</div>
                                            <div class="mt-1 flex items-center gap-1.5">
                                                <span class="i-lucide-corner-down-right h-3 w-3 shrink-0 text-[var(--text-muted)] opacity-50"></span>
                                                <span class="truncate text-[11px] text-[var(--text-secondary)]">出自: {{ refItem.title }}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div v-else class="rounded-md border border-dashed border-[var(--border-color)] bg-transparent px-3 py-3 text-center text-[11px] text-[var(--text-muted)]">
                        暂无内联派生引用
                    </div>
                </div>
            </div>
        </div>

    </aside>
</template>
