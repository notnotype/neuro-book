<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {storeToRefs} from "pinia";
import Dialog from "nbook/app/components/common/Dialog.vue";
import ContextMenu, {type ContextMenuItem} from "nbook/app/components/common/ContextMenu.vue";
import PlotThreadDetailPanel from "nbook/app/components/novel-ide/plot/thread-panel/PlotThreadDetailPanel.vue";
import PlotThreadEditorDialog from "nbook/app/components/novel-ide/plot/thread-panel/PlotThreadEditorDialog.vue";
import PlotThreadScenePanel from "nbook/app/components/novel-ide/plot/thread-panel/PlotThreadScenePanel.vue";
import PlotWorkbenchDialog from "nbook/app/components/novel-ide/plot/workbench/PlotWorkbenchDialog.vue";
import PlotChapterEditorDialog from "nbook/app/components/novel-ide/plot/chapter-panel/PlotChapterEditorDialog.vue";
import type {PlotChapterEditorSave} from "nbook/app/components/novel-ide/plot/chapter-panel/PlotChapterEditorDialog.vue";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {
    createPanelRefFromEffectiveRef,
    type PlotThreadEditorSave,
    type PlotThreadPanelChapter,
    type PlotThreadPanelDetail,
    type PlotThreadPanelRef,
    type PlotThreadPanelScene,
    type PlotThreadPanelThread,
    type PlotThreadQuickSceneUpdate,
    type PlotThreadTone,
} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import type {
    CreateStorySceneRequestDto,
    CreateStoryThreadRequestDto,
    CreateStoryActRequestDto,
    CreateStoryChapterRequestDto,
    PlotTreeDto,
    PlotWorkbenchDto,
    ReorderStoryScenesRequestDto,
    StoryActDto,
    StoryChapterDto,
    StoryRefDto,
    StorySceneDetailDto,
    StorySceneWorldAnchorDto,
    StorySceneWriteResponseDto,
    StoryScenePromiseBeatDto,
    StoryThreadDetailDto,
    StoryThreadTreeNodeDto,
    StoryThreadWriteResponseDto,
    UpdateStorySceneRequestDto,
    UpdateStoryChapterRequestDto,
    UpdateStoryThreadRequestDto,
} from "nbook/shared/dto/plot.dto";

const toneCycle: PlotThreadTone[] = ["amber", "sky", "emerald", "rose"];

const novelIdeStore = useNovelIdeStore();
const {
    currentProjectRoot,
    currentNovel,
    loadingWorkspace,
    plotWorkbenchOpen,
    plotWorkbenchTab,
    plotPlanningFocusId,
    selectedStoryThreadId,
    selectedStorySceneId,
    plotRefreshVersion,
} = storeToRefs(novelIdeStore);

const emit = defineEmits<{
    (e: "openWorldEngine"): void;
}>();

const threads = ref<PlotThreadPanelThread[]>([]);
const scenes = ref<PlotThreadPanelScene[]>([]);
const selectedThreadId = selectedStoryThreadId;
const selectedSceneId = selectedStorySceneId;
const treeError = ref("");
const detailError = ref("");
const detailDiagnostics = ref("");
const loadingTree = ref(false);
const loadingDetail = ref(false);
const savingQuickScene = ref(false);
const savingEditor = ref(false);
// Thread/Scene 编辑器对话框的保存错误(模态内展示);为空表示无待展示错误。
// 独立于 treeError(面板级)与 detailError(底部详情面板),避免模态打开时错误被遮挡看不见。
const editorError = ref("");
const reorderingScenes = ref(false);
const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuItems = ref<ContextMenuItem[]>([]);
const deleteTarget = ref<{type: "thread" | "scene"; id: string} | null>(null);
const editorVisible = ref(false);
const editorMode = ref<"create" | "edit">("create");
const editorTarget = ref<"thread" | "scene">("scene");
const editingThreadId = ref<string | null>(null);
const editingSceneId = ref<string | null>(null);
const threadDetailMap = ref<Record<string, StoryThreadDetailDto>>({});
const sceneDetailMap = ref<Record<string, StorySceneDetailDto>>({});
const plotWorkbenchData = ref<PlotWorkbenchDto | null>(null);
const detailPanelRef = ref<InstanceType<typeof PlotThreadDetailPanel> | null>(null);
const pinnedWorkbenchThreadIds = ref<string[]>([]);
const loadingWorkbench = ref(false);
const workbenchError = ref("");
// 规划层 open 计数(loadPlotTree 响应携带):侧栏「承诺 / 未决」入口徽标;0 表示当前无进行中承诺 / 未决决策。
const openPromiseCount = ref(0);
const openDecisionCount = ref(0);
// 承载树章节实体(含所属卷标题),由剧情树刷新填充;是章节下拉与挂章的唯一来源。
const chapterTreeNodes = ref<Array<{chapter: StoryChapterDto; volumeTitle: string}>>([]);
// 承载树卷实体,供章节编辑器的「所属卷」下拉。
const actNodes = ref<StoryActDto[]>([]);
// 章节 / ChapterBrief 编辑器状态。
const chapterEditorVisible = ref(false);
const chapterEditorMode = ref<"create" | "edit">("create");
const editingChapter = ref<StoryChapterDto | null>(null);
const savingChapter = ref(false);
const chapterEditorError = ref("");
// 卷(Act)快速创建状态。
const actDialogVisible = ref(false);
const actDraftTitle = ref("");
const actDraftName = ref("");
const savingAct = ref(false);
const actDialogError = ref("");

function projectPlotOptions(options: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        ...options,
        query: {
            ...(typeof options.query === "object" && options.query !== null ? options.query : {}),
            projectRoot: currentProjectRoot.value,
        },
    };
}

/**
 * 创建未连接 World Engine 的 Scene Anchor。
 */
function createEmptyWorldAnchor(): StorySceneWorldAnchorDto {
    return {
        startTime: null,
        endTime: null,
        startInstant: null,
        endInstant: null,
        subjectIds: [],
        locationSubjectId: null,
        subjects: [],
        locationSubject: null,
        unresolvedSubjectIds: [],
    };
}

let treeRequestVersion = 0;
let workbenchRequestVersion = 0;

/**
 * 当前章节列表，来自承载树 StoryChapter 实体(经剧情树填充)。
 * 章不再从 manuscript 文件目录派生;正文承载由 Prose frontmatter 反指表达。
 */
const chapters = computed<PlotThreadPanelChapter[]>(() => {
    return chapterTreeNodes.value.map((node) => ({
        id: node.chapter.id,
        volumeTitle: node.volumeTitle,
        numberLabel: `第${String(node.chapter.sortOrder + 1)}章`,
        title: node.chapter.title || node.chapter.name || "未命名章节",
        summary: node.chapter.note ?? "",
    }));
});

/**
 * 章节管理条用的章节芯片:携带原始 StoryChapter 实体(供编辑器)与展示标签。
 * `hasBrief` 表示该章已填写至少一项 ChapterBrief 字段,用于给 leader 提示信息控制是否就绪。
 */
const chapterChips = computed(() => {
    return chapterTreeNodes.value.map((node) => {
        const brief = node.chapter.brief;
        const hasBrief = Object.values(brief).some((value) => value !== null && value !== "");
        return {
            chapter: node.chapter,
            label: node.chapter.title || node.chapter.name || "未命名章节",
            volumeTitle: node.volumeTitle,
            hasBrief,
        };
    });
});

/**
 * 当前选中的 Thread。
 */
const selectedThread = computed(() => {
    return selectedThreadId.value
        ? (threads.value.find((thread) => thread.id === selectedThreadId.value) ?? null)
        : null;
});

/**
 * 当前选中的 Scene。
 */
const selectedScene = computed(() => {
    return selectedSceneId.value
        ? (scenes.value.find((scene) => scene.id === selectedSceneId.value) ?? null)
        : null;
});

/**
 * 当前编辑中的 Thread。
 */
const editingThread = computed(() => {
    return editingThreadId.value
        ? (threads.value.find((thread) => thread.id === editingThreadId.value) ?? null)
        : null;
});

/**
 * 当前编辑中的 Scene。
 */
const editingScene = computed(() => {
    return editingSceneId.value
        ? (scenes.value.find((scene) => scene.id === editingSceneId.value) ?? null)
        : null;
});

/**
 * 剧本工作台顶部展示的 Story 概要。
 */
const workbenchStory = computed(() => {
    const story = plotWorkbenchData.value?.story;
    return {
        id: story?.id ?? currentProjectRoot.value ?? "current-novel",
        title: story?.title ?? currentNovel.value?.title ?? "当前小说",
        summary: story?.summary ?? currentNovel.value?.summary ?? "",
    };
});

/**
 * 剧本工作台阶段数据。
 */
const workbenchPhases = computed(() => {
    const data = plotWorkbenchData.value;
    if (data) {
        const phases = data.phases.map((phase) => ({
            id: phase.id,
            title: phase.title,
            summary: phase.summary,
        }));
        return phases.length
            ? phases
            : [{
                id: "ungrouped",
                title: "未分阶段",
                summary: "",
            }];
    }

    const phaseIds = [...new Set(threads.value.map((thread) => thread.phaseId).filter((phaseId): phaseId is string => Boolean(phaseId)))];
    return phaseIds.length
        ? phaseIds.map((phaseId, index) => ({
            id: phaseId,
            title: `阶段 ${index + 1}`,
            summary: "",
        }))
        : [{
            id: "phase-current",
            title: "当前阶段",
            summary: "",
        }];
});

/**
 * 剧本工作台线程视图，优先来自聚合接口。
 */
const workbenchThreads = computed<PlotThreadPanelThread[]>(() => {
    const nodes = flattenWorkbenchThreads();
    if (!nodes.length) {
        return threads.value;
    }

    return nodes.map((item, index) => ({
        id: item.thread.id,
        phaseId: item.phaseId,
        title: item.thread.title,
        summary: item.thread.summary,
        status: item.thread.status,
        isMainThread: item.thread.isMainThread,
        miceType: item.thread.miceType,
        tags: [...item.thread.tags],
        writingTip: item.thread.writingTip,
        tone: resolveThreadTone(index),
        refs: [],
    }));
});

/**
 * 剧本工作台 Scene 视图，优先来自聚合接口。
 */
const workbenchScenes = computed<PlotThreadPanelScene[]>(() => {
    const nodes = flattenWorkbenchThreads();
    if (!nodes.length) {
        return scenes.value;
    }

    return nodes.flatMap((item) => item.thread.scenes.map((scene) => ({
        id: scene.id,
        threadId: scene.threadId,
        chapterId: scene.chapterId,
        title: scene.title,
        summary: scene.summary,
        purpose: scene.purpose,
        status: scene.status,
        outcomeType: scene.outcomeType,
        pacingRole: scene.pacingRole,
        threadSortOrder: scene.threadSortOrder,
        chapterSortOrder: scene.chapterSortOrder,
        writingTip: scene.writingTip,
        worldAnchor: scene.worldAnchor,
        refs: scene.refs.map((refItem, index) => mapStoryRefDto(refItem, `scene:${scene.id}:ref:${String(index)}`, "scene")),
    })));
});

/**
 * 当前编辑 Scene 的 refs。
 */
const editingSceneRefs = computed<PlotThreadPanelRef[]>(() => {
    const sceneId = editingSceneId.value;
    if (!sceneId) {
        return [];
    }

    return (sceneDetailMap.value[sceneId]?.refs ?? []).map((refItem, index) => ({
        id: `scene:${sceneId}:ref:${String(index)}`,
        relation: refItem.relation,
        target: refItem.target,
        visibility: refItem.visibility,
        note: refItem.note,
        source: "scene",
    }));
});

/**
 * 当前 detail 面板所需数据。
 */
const currentDetail = computed<PlotThreadPanelDetail | null>(() => {
    const thread = selectedThread.value;
    const scene = selectedScene.value;
    if (!thread || !scene || scene.threadId !== thread.id) {
        return null;
    }

    const sceneDetail = sceneDetailMap.value[scene.id] ?? null;
    const chapter = scene.chapterId
        ? (chapters.value.find((item) => item.id === scene.chapterId) ?? null)
        : null;

    return {
        thread,
        scene,
        chapter,
        effectiveRefs: sceneDetail
            ? sceneDetail.effectiveRefs.map(createPanelRefFromEffectiveRef)
            : [...thread.refs, ...scene.refs],
        promiseBeats: sceneDetail?.promiseBeats ?? [],
    };
});

/**
 * 当前选中 Scene 的 promise beats(「这场戏服务哪些线」);详情未加载时为空数组。
 * 供剧本工作台 Inspector 的 Scene 模式展示只读芯片。
 */
const selectedScenePromiseBeats = computed<StoryScenePromiseBeatDto[]>(() => {
    return selectedSceneId.value
        ? (sceneDetailMap.value[selectedSceneId.value]?.promiseBeats ?? [])
        : [];
});

/**
 * 从 Scene 侧芯片跳转承诺账本并聚焦该 Promise(打开工作台并定位 tab)。
 */
function focusPromiseFromScene(promiseId: string): void {
    plotPlanningFocusId.value = promiseId;
    plotWorkbenchTab.value = "promises";
    plotWorkbenchOpen.value = true;
}

/**
 * 账本 tab(承诺/决策)UI 写操作成功:刷新剧情树(侧栏计数与账本入口徽标)并强刷受影响 Scene 的详情缓存(promiseBeats 芯片)。
 */
async function handlePlanningMutated(payload: {sceneIds?: string[]}): Promise<void> {
    for (const sceneId of payload.sceneIds ?? []) {
        void ensureSceneDetail(sceneId, true);
    }
    await loadPlotTree({
        preferredThreadId: selectedThreadId.value,
        preferredSceneId: selectedSceneId.value,
    });
}

/**
 * 删除确认文案。
 */
const deleteMessage = computed(() => {
    if (!deleteTarget.value) {
        return "";
    }

    if (deleteTarget.value.type === "thread") {
        const thread = threads.value.find((item) => item.id === deleteTarget.value?.id);
        return `确认删除「${thread?.title ?? "当前 Thread"}」吗？该 Thread 下的 Scene 会一起删除。`;
    }

    const scene = scenes.value.find((item) => item.id === deleteTarget.value?.id);
    return `确认删除「${scene?.title ?? "当前 Scene"}」吗？`;
});

/**
 * 从错误对象提取适合展示的文案。
 * 这里使用 unknown 是因为 fetch / createError / 普通 Error 都可能进入 catch。
 */
function resolveErrorMessage(error: unknown, fallback: string): string {
    return resolveApiErrorMessage(error, fallback);
}

/**
 * 记录剧本工作台内触发的操作错误。
 */
function setWorkbenchError(error: unknown, fallback: string): void {
    workbenchError.value = resolveErrorMessage(error, fallback);
}

/**
 * 拼接写接口 diagnostics 文案。
 */
function formatDiagnosticsText(detail: {
    diagnostics?: {
        warnings: string[];
        notes: string[];
    };
}): string {
    return [
        ...(detail.diagnostics?.warnings ?? []),
        ...(detail.diagnostics?.notes ?? []),
    ].join("；");
}

/**
 * 根据顺序分配线程色板。
 */
function resolveThreadTone(index: number): PlotThreadTone {
    return toneCycle[index % toneCycle.length] ?? "amber";
}

/**
 * 把接口 ref 映射成面板 ref。
 */
function mapStoryRefDto(refItem: StoryRefDto, id: string, source?: "thread" | "scene"): PlotThreadPanelRef {
    return {
        id,
        relation: refItem.relation,
        target: refItem.target,
        visibility: refItem.visibility,
        note: refItem.note,
        source,
    };
}

/**
 * 展开剧本工作台聚合 Thread。
 */
function flattenWorkbenchThreads(): Array<{
    phaseId: string | null;
    thread: PlotWorkbenchDto["phases"][number]["threads"][number];
}> {
    const data = plotWorkbenchData.value;
    if (!data) {
        return [];
    }

    return [
        ...data.phases.flatMap((phase) => phase.threads.map((thread) => ({
            phaseId: phase.id,
            thread,
        }))),
        ...data.ungroupedThreads.map((thread) => ({
            phaseId: null,
            thread,
        })),
    ];
}

/**
 * 把缓存里的 Scene refs 映射到面板模型。
 */
function mapSceneRefs(sceneId: string): PlotThreadPanelRef[] {
    return (sceneDetailMap.value[sceneId]?.refs ?? []).map((refItem, index) => (
        mapStoryRefDto(refItem, `scene:${sceneId}:ref:${String(index)}`, "scene")
    ));
}

/**
 * 生成 Thread slug。
 */
function createThreadName(title: string): string {
    const base = title
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || "thread";
    return `${base}-${String(Date.now())}`;
}

/**
 * 去掉前端补充字段，转成接口 refs。
 */
function toStoryRefs(refs: PlotThreadPanelRef[]): StoryRefDto[] {
    return refs.map((refItem) => ({
        relation: refItem.relation,
        target: refItem.target,
        visibility: refItem.visibility,
        note: refItem.note,
    }));
}

/**
 * 用最新剧情树重建当前面板列表。
 */
function applyPlotTree(tree: PlotTreeDto): void {
    const threadNodes: Array<{phaseId: string | null; thread: StoryThreadTreeNodeDto}> = [
        ...tree.phases.flatMap((phase) => phase.threads.map((thread) => ({
            phaseId: phase.id,
            thread,
        }))),
        ...tree.ungroupedThreads.map((thread) => ({
            phaseId: null,
            thread,
        })),
    ];

    threads.value = threadNodes.map((item, index) => ({
        id: item.thread.id,
        phaseId: item.phaseId,
        title: item.thread.title,
        summary: item.thread.summary,
        status: item.thread.status,
        isMainThread: item.thread.isMainThread,
        miceType: item.thread.miceType,
        tags: [...item.thread.tags],
        writingTip: item.thread.writingTip,
        tone: resolveThreadTone(index),
        refs: [],
    }));

    scenes.value = threadNodes.flatMap((item) => item.thread.scenes.map((scene) => ({
        id: scene.id,
        threadId: scene.threadId,
        chapterId: scene.chapterId,
        title: scene.title,
        summary: scene.summary,
        purpose: scene.purpose,
        status: scene.status,
        outcomeType: scene.outcomeType,
        pacingRole: scene.pacingRole,
        threadSortOrder: scene.threadSortOrder,
        chapterSortOrder: scene.chapterSortOrder,
        writingTip: scene.writingTip,
        worldAnchor: scene.worldAnchor,
        refs: mapSceneRefs(scene.id),
    })));

    // 承载树:Act 旗下章 + 未归卷章,拍平成章节实体列表(带所属卷标题)。
    chapterTreeNodes.value = [
        ...tree.acts.flatMap((act) => act.chapters.map((chapter) => ({chapter, volumeTitle: act.title || act.name}))),
        ...tree.ungroupedChapters.map((chapter) => ({chapter, volumeTitle: "未归卷"})),
    ];
    // 卷实体列表(不含旗下章),供章节编辑器归卷下拉。
    actNodes.value = tree.acts.map((act) => ({
        id: act.id,
        storyId: act.storyId,
        sortOrder: act.sortOrder,
        name: act.name,
        title: act.title,
        summary: act.summary,
        note: act.note,
        createdAt: act.createdAt,
        updatedAt: act.updatedAt,
    }));

    // 规划层摘要计数:承诺账本 / 决策记录入口徽标。
    openPromiseCount.value = tree.openPromiseCount;
    openDecisionCount.value = tree.openDecisionCount;
}

/**
 * 根据当前列表修正选中态。
 */
function syncSelection(options: {
    preferredThreadId?: string | null;
    preferredSceneId?: string | null;
} = {}): void {
    const nextThreadId = (
        options.preferredThreadId
        && threads.value.some((thread) => thread.id === options.preferredThreadId)
    )
        ? options.preferredThreadId
        : (
            selectedThreadId.value
            && threads.value.some((thread) => thread.id === selectedThreadId.value)
                ? selectedThreadId.value
                : (threads.value[0]?.id ?? null)
        );
    selectedThreadId.value = nextThreadId;

    const threadScenes = scenes.value
        .filter((scene) => scene.threadId === nextThreadId)
        .sort((left, right) => left.threadSortOrder - right.threadSortOrder);
    const nextSceneId = (
        options.preferredSceneId
        && threadScenes.some((scene) => scene.id === options.preferredSceneId)
    )
        ? options.preferredSceneId
        : (
            selectedSceneId.value
            && threadScenes.some((scene) => scene.id === selectedSceneId.value)
                ? selectedSceneId.value
                : (threadScenes[0]?.id ?? null)
        );
    selectedSceneId.value = nextSceneId;
}

/**
 * 把 Thread 详情写回缓存和列表。
 */
function applyThreadDetail(detail: StoryThreadDetailDto): void {
    threadDetailMap.value = {
        ...threadDetailMap.value,
        [detail.id]: detail,
    };

    threads.value = threads.value.map((thread) => thread.id === detail.id
        ? {
            ...thread,
            title: detail.title,
            summary: detail.summary,
            status: detail.status,
            isMainThread: detail.isMainThread,
            miceType: detail.miceType,
            tags: [...detail.tags],
            writingTip: detail.writingTip,
            refs: [],
        }
        : thread);
}

/**
 * 把 Scene 详情写回缓存和列表。
 */
function applySceneDetail(detail: StorySceneDetailDto): void {
    sceneDetailMap.value = {
        ...sceneDetailMap.value,
        [detail.id]: detail,
    };

    scenes.value = scenes.value.map((scene) => scene.id === detail.id
        ? {
            ...scene,
            threadId: detail.threadId,
            chapterId: detail.chapterId,
            title: detail.title,
            summary: detail.summary,
            purpose: detail.purpose,
            status: detail.status,
            outcomeType: detail.outcomeType,
            pacingRole: detail.pacingRole,
            threadSortOrder: detail.threadSortOrder,
            chapterSortOrder: detail.chapterSortOrder,
            writingTip: detail.writingTip,
            worldAnchor: detail.worldAnchor,
            refs: mapSceneRefs(detail.id),
        }
        : scene);
}

/**
 * 拉取剧情树，并刷新当前单 Thread 面板。
 */
async function loadPlotTree(options: {
    preferredThreadId?: string | null;
    preferredSceneId?: string | null;
} = {}): Promise<void> {
    if (!currentProjectRoot.value) {
        threads.value = [];
        scenes.value = [];
        selectedThreadId.value = null;
        selectedSceneId.value = null;
        treeError.value = "";
        return;
    }

    const requestVersion = ++treeRequestVersion;
    loadingTree.value = true;
    treeError.value = "";

    try {
        const response = await $fetch<PlotTreeDto>(`/api/projects/plot/tree`, projectPlotOptions());
        if (requestVersion !== treeRequestVersion) {
            return;
        }

        applyPlotTree(response);
        syncSelection(options);

        if (selectedThreadId.value) {
            void ensureThreadDetail(selectedThreadId.value);
            void preloadThreadScenes(selectedThreadId.value);
        }

        if (selectedSceneId.value) {
            void ensureSceneDetail(selectedSceneId.value);
        }
    } catch (error) {
        if (requestVersion !== treeRequestVersion) {
            return;
        }
        treeError.value = resolveErrorMessage(error, "加载剧情树失败");
    } finally {
        if (requestVersion === treeRequestVersion) {
            loadingTree.value = false;
        }
    }
}

/**
 * 从侧栏计数入口打开剧本工作台,并定位到规划层 tab(承诺账本 / 决策记录)。
 */
function openPlanningTab(tab: "promises" | "decisions"): void {
    plotWorkbenchTab.value = tab;
    plotWorkbenchOpen.value = true;
}

/**
 * 打开章节 / ChapterBrief 编辑器。传 chapter 为编辑,否则为新建。
 */
function openChapterEditor(chapter: StoryChapterDto | null): void {
    chapterEditorMode.value = chapter ? "edit" : "create";
    editingChapter.value = chapter;
    chapterEditorError.value = "";
    chapterEditorVisible.value = true;
}

/**
 * 打开新建卷对话框。
 */
function openActDialog(): void {
    actDraftTitle.value = "";
    actDraftName.value = "";
    actDialogError.value = "";
    actDialogVisible.value = true;
}

/**
 * 保存新建卷:POST /acts,成功后刷新剧情树。name 空时按 title 派生 slug。
 */
async function saveAct(): Promise<void> {
    if (!currentProjectRoot.value || savingAct.value) {
        return;
    }
    const title = actDraftTitle.value.trim();
    if (!title) {
        actDialogError.value = "请填写卷标题";
        return;
    }
    // name 供机器标识:优先用户输入,否则从 title 派生 slug,再兜底时间戳。
    const name = (actDraftName.value.trim() || title)
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || `act-${String(Date.now())}`;

    savingAct.value = true;
    actDialogError.value = "";
    try {
        await $fetch(`/api/projects/plot/acts`, projectPlotOptions({
            method: "POST",
            body: {name, title} satisfies CreateStoryActRequestDto,
        }));
        actDialogVisible.value = false;
        await loadPlotTree({
            preferredThreadId: selectedThreadId.value,
            preferredSceneId: selectedSceneId.value,
        });
    } catch (error) {
        actDialogError.value = resolveApiErrorMessage(error, "创建卷失败");
    } finally {
        savingAct.value = false;
    }
}

/**
 * 保存章节:新建走 POST /chapters,编辑走 PATCH /chapters/:id,成功后刷新剧情树。
 */
async function saveChapter(payload: PlotChapterEditorSave): Promise<void> {
    if (!currentProjectRoot.value || savingChapter.value) {
        return;
    }
    if (!payload.name.trim()) {
        chapterEditorError.value = "请填写章节 name(供 Prose frontmatter 反指)";
        return;
    }

    savingChapter.value = true;
    chapterEditorError.value = "";
    try {
        const editing = editingChapter.value;
        if (editing) {
            await $fetch(`/api/projects/plot/chapters/${editing.id}`, projectPlotOptions({
                method: "PATCH",
                body: {
                    actId: payload.actId,
                    name: payload.name,
                    title: payload.title,
                    note: payload.note,
                    brief: payload.brief,
                } satisfies UpdateStoryChapterRequestDto,
            }));
        } else {
            await $fetch(`/api/projects/plot/chapters`, projectPlotOptions({
                method: "POST",
                body: {
                    actId: payload.actId,
                    name: payload.name,
                    title: payload.title,
                    note: payload.note,
                    brief: payload.brief,
                } satisfies CreateStoryChapterRequestDto,
            }));
        }
        chapterEditorVisible.value = false;
        editingChapter.value = null;
        await loadPlotTree({
            preferredThreadId: selectedThreadId.value,
            preferredSceneId: selectedSceneId.value,
        });
    } catch (error) {
        chapterEditorError.value = resolveApiErrorMessage(error, "保存章节失败");
    } finally {
        savingChapter.value = false;
    }
}

/**
 * 拉取剧本工作台聚合数据。
 */
async function loadPlotWorkbench(force = false): Promise<void> {    if (!currentProjectRoot.value) {
        plotWorkbenchData.value = null;
        workbenchError.value = "";
        return;
    }

    if (!force && plotWorkbenchData.value) {
        return;
    }

    const requestVersion = ++workbenchRequestVersion;
    loadingWorkbench.value = true;
    workbenchError.value = "";

    try {
        const response = await $fetch<PlotWorkbenchDto>(`/api/projects/plot/workbench`, projectPlotOptions());
        if (requestVersion !== workbenchRequestVersion) {
            return;
        }

        plotWorkbenchData.value = response;
    } catch (error) {
        if (requestVersion !== workbenchRequestVersion) {
            return;
        }
        workbenchError.value = resolveErrorMessage(error, "加载剧本工作台失败");
    } finally {
        if (requestVersion === workbenchRequestVersion) {
            loadingWorkbench.value = false;
        }
    }
}

/**
 * 确保 Thread 详情已加载。
 */
async function ensureThreadDetail(threadId: string, force = false): Promise<void> {
    if (!currentProjectRoot.value || (!force && threadDetailMap.value[threadId])) {
        return;
    }

    try {
        const detail = await $fetch<StoryThreadDetailDto>(`/api/projects/plot/threads/${threadId}`, projectPlotOptions());
        applyThreadDetail(detail);
    } catch (error) {
        detailError.value = resolveErrorMessage(error, "加载 Thread 详情失败");
    }
}

/**
 * 确保 Scene 详情已加载。
 */
async function ensureSceneDetail(sceneId: string, force = false): Promise<void> {
    if (!currentProjectRoot.value || (!force && sceneDetailMap.value[sceneId])) {
        return;
    }

    loadingDetail.value = true;
    detailError.value = "";

    try {
        const detail = await $fetch<StorySceneDetailDto>(`/api/projects/plot/scenes/${sceneId}`, projectPlotOptions());
        applySceneDetail(detail);
    } catch (error) {
        detailError.value = resolveErrorMessage(error, "加载 Scene 详情失败");
    } finally {
        loadingDetail.value = false;
    }
}

/**
 * 为当前 Thread 预加载所有 Scene 详情，用来补齐 Plot 统计。
 */
async function preloadThreadScenes(threadId: string): Promise<void> {
    if (!currentProjectRoot.value) {
        return;
    }

    const missingSceneIds = scenes.value
        .filter((scene) => scene.threadId === threadId)
        .map((scene) => scene.id)
        .filter((sceneId) => !sceneDetailMap.value[sceneId]);

    if (!missingSceneIds.length) {
        return;
    }

    try {
        const details = await Promise.all(missingSceneIds.map((sceneId) => (
            $fetch<StorySceneDetailDto>(`/api/projects/plot/scenes/${sceneId}`, projectPlotOptions())
        )));

        for (const detail of details) {
            applySceneDetail(detail);
        }
    } catch (error) {
        detailError.value = resolveErrorMessage(error, "预加载 Scene 详情失败");
    }
}

/**
 * 选中 Thread，并切到它的第一个 Scene。
 */
function selectThread(threadId: string): void {
    selectedThreadId.value = threadId;
    const nextScene = (workbenchScenes.value.length ? workbenchScenes.value : scenes.value)
        .filter((scene) => scene.threadId === threadId)
        .sort((left, right) => left.threadSortOrder - right.threadSortOrder)[0] ?? null;
    selectedSceneId.value = nextScene?.id ?? null;
    detailError.value = "";

    void ensureThreadDetail(threadId);
    void preloadThreadScenes(threadId);

    if (nextScene) {
        void ensureSceneDetail(nextScene.id);
    }
}

/**
 * 切换 Thread 前先提交 detail 草稿。
 */
async function selectThreadFromPanel(threadId: string): Promise<void> {
    if (!(await flushDetailPanel())) {
        return;
    }

    selectThread(threadId);
}

/**
 * 选中 Scene，并同步所属 Thread。
 */
function selectScene(sceneId: string): void {
    const scene = workbenchScenes.value.find((item) => item.id === sceneId)
        ?? scenes.value.find((item) => item.id === sceneId)
        ?? null;
    if (!scene) {
        return;
    }

    selectedThreadId.value = scene.threadId;
    selectedSceneId.value = scene.id;
    detailError.value = "";

    void ensureThreadDetail(scene.threadId);
    void preloadThreadScenes(scene.threadId);
    void ensureSceneDetail(scene.id);
}

/**
 * 切换 Scene 前先提交 detail 草稿。
 */
async function selectSceneFromPanel(sceneId: string): Promise<void> {
    if (!(await flushDetailPanel())) {
        return;
    }

    selectScene(sceneId);
}

/**
 * 收起底部 detail 面板。
 */
async function closeDetailPanel(): Promise<void> {
    if (!(await flushDetailPanel())) {
        return;
    }

    selectedSceneId.value = null;
    detailError.value = "";
}

/**
 * 强制提交 detail 面板里的 Scene 草稿。
 */
async function flushDetailPanel(): Promise<boolean> {
    if (!detailPanelRef.value) {
        return true;
    }

    return detailPanelRef.value.flushNow(quickUpdateScene);
}

/**
 * 打开上下文菜单。
 */
function openContextMenu(event: MouseEvent, items: ContextMenuItem[]): void {
    contextMenuX.value = event.clientX;
    contextMenuY.value = event.clientY;
    contextMenuItems.value = items;
    contextMenuVisible.value = true;
}

/**
 * 关闭上下文菜单。
 */
function closeContextMenu(): void {
    contextMenuVisible.value = false;
}

/**
 * 打开 Thread 编辑器。
 */
function openThreadEditor(mode: "create" | "edit"): void {
    editorMode.value = mode;
    editorTarget.value = "thread";
    editingThreadId.value = mode === "edit" ? selectedThreadId.value : null;
    editingSceneId.value = null;
    editorError.value = "";
    editorVisible.value = true;
}

/**
 * 打开 Scene 编辑器。
 */
async function openSceneEditor(mode: "create" | "edit", sceneId?: string): Promise<void> {
    if (!selectedThreadId.value) {
        openThreadEditor("create");
        return;
    }

    editorMode.value = mode;
    editorTarget.value = "scene";
    editingThreadId.value = selectedThreadId.value;
    editingSceneId.value = mode === "edit" ? (sceneId ?? selectedSceneId.value) : null;
    editorError.value = "";

    if (editingSceneId.value) {
        await ensureSceneDetail(editingSceneId.value);
    }

    editorVisible.value = true;
}

/**
 * 从 detail 面板进入完整编辑器。
 */
async function openSceneEditorFromDetail(): Promise<void> {
    if (!(await flushDetailPanel())) {
        return;
    }

    await openSceneEditor("edit", selectedSceneId.value ?? undefined);
}

/**
 * 打开 Thread 菜单。
 */
function openThreadMenu(event: MouseEvent): void {
    openContextMenu(event, [
        {
            label: "新建 Thread",
            iconClass: "i-lucide-folder-plus",
            action: () => openThreadEditor("create"),
        },
        {
            label: "编辑当前 Thread",
            iconClass: "i-lucide-pencil-line",
            disabled: !selectedThread.value,
            action: () => openThreadEditor("edit"),
        },
        {
            label: "新建 Scene",
            iconClass: "i-lucide-clapperboard",
            disabled: !selectedThread.value,
            action: () => {
                void openSceneEditor("create");
            },
        },
        {separator: true},
        {
            label: "删除当前 Thread",
            iconClass: "i-lucide-trash-2",
            danger: true,
            disabled: !selectedThread.value,
            action: () => queueDelete("thread", selectedThreadId.value),
        },
    ]);
}

/**
 * 打开 Scene 菜单。
 */
function openSceneMenu(payload: {sceneId: string; event: MouseEvent}): void {
    const scene = scenes.value.find((item) => item.id === payload.sceneId) ?? null;
    if (!scene) {
        return;
    }

    openContextMenu(payload.event, [
        {
            label: "选中 Scene",
            iconClass: "i-lucide-crosshair",
            action: () => selectScene(scene.id),
        },
        {
            label: "新建 Scene",
            iconClass: "i-lucide-plus",
            action: () => {
                selectThread(scene.threadId);
                void openSceneEditor("create");
            },
        },
        {
            label: "编辑 Scene",
            iconClass: "i-lucide-pencil-line",
            action: () => {
                selectScene(scene.id);
                void openSceneEditor("edit", scene.id);
            },
        },
        {separator: true},
        {
            label: "删除 Scene",
            iconClass: "i-lucide-trash-2",
            danger: true,
            action: () => queueDelete("scene", scene.id),
        },
    ]);
}

/**
 * 打开空白区菜单。
 */
function openRootMenu(event: MouseEvent): void {
    openContextMenu(event, [
        {
            label: "新建 Thread",
            iconClass: "i-lucide-folder-plus",
            action: () => openThreadEditor("create"),
        },
        {
            label: "新建 Scene",
            iconClass: "i-lucide-clapperboard",
            disabled: !selectedThread.value,
            action: () => {
                void openSceneEditor("create");
            },
        },
        {separator: true},
        {
            label: "刷新剧情树",
            iconClass: "i-lucide-refresh-cw",
            action: () => {
                void loadPlotTree({
                    preferredThreadId: selectedThreadId.value,
                    preferredSceneId: selectedSceneId.value,
                });
            },
        },
    ]);
}

/**
 * 缓存待删除对象。
 */
function queueDelete(type: "thread" | "scene", id: string | null): void {
    if (!id) {
        return;
    }

    closeContextMenu();
    deleteTarget.value = {type, id};
}

/**
 * 切换剧本工作台里的 Thread pin 状态。
 */
function toggleWorkbenchThreadPin(threadId: string): void {
    pinnedWorkbenchThreadIds.value = pinnedWorkbenchThreadIds.value.includes(threadId)
        ? pinnedWorkbenchThreadIds.value.filter((id) => id !== threadId)
        : [threadId, ...pinnedWorkbenchThreadIds.value];
}

/**
 * 从 Plot 工作台切换到 World Engine 工作台。
 */
function openWorldEngineFromPlot(): void {
    plotWorkbenchOpen.value = false;
    emit("openWorldEngine");
}

/**
 * 快速更新 Thread 字段。
 */
async function updateWorkbenchThread(threadId: string, patch: Partial<PlotThreadPanelThread>): Promise<void> {
    if (!currentProjectRoot.value) {
        return;
    }

    workbenchError.value = "";

    try {
        const updated = await $fetch<StoryThreadWriteResponseDto>(`/api/projects/plot/threads/${threadId}`, projectPlotOptions({
            method: "PATCH",
            body: {
                title: patch.title,
                isMainThread: patch.isMainThread,
                status: patch.status,
                miceType: patch.miceType,
                summary: patch.summary,
                tags: patch.tags,
                writingTip: patch.writingTip,
            } satisfies UpdateStoryThreadRequestDto,
        }));
        detailDiagnostics.value = formatDiagnosticsText(updated);
        applyThreadDetail(updated);
        await loadPlotTree({
            preferredThreadId: updated.id,
            preferredSceneId: selectedSceneId.value,
        });
        await loadPlotWorkbench(true);
    } catch (error) {
        setWorkbenchError(error, "保存 Thread 失败");
    }
}

/**
 * 快速更新 Scene 字段。
 */
async function updateWorkbenchScene(sceneId: string, patch: Partial<PlotThreadPanelScene>): Promise<void> {
    if (!currentProjectRoot.value) {
        return;
    }

    workbenchError.value = "";

    try {
        const updated = await $fetch<StorySceneWriteResponseDto>(`/api/projects/plot/scenes/${sceneId}`, projectPlotOptions({
            method: "PATCH",
            body: {
                threadId: patch.threadId,
                chapterId: patch.chapterId,
                title: patch.title,
                status: patch.status,
                outcomeType: patch.outcomeType,
                pacingRole: patch.pacingRole,
                summary: patch.summary,
                purpose: patch.purpose,
                writingTip: patch.writingTip,
                worldAnchor: patch.worldAnchor,
                refs: patch.refs ? toStoryRefs(patch.refs) : undefined,
            } satisfies UpdateStorySceneRequestDto,
        }));
        detailDiagnostics.value = formatDiagnosticsText(updated);
        applySceneDetail(updated);
        await loadPlotWorkbench(true);
    } catch (error) {
        setWorkbenchError(error, "保存 Scene 失败");
    }
}

/**
 * 快速保存当前 Scene 常用字段。
 */
async function quickUpdateScene(payload: PlotThreadQuickSceneUpdate): Promise<void> {
    if (!currentProjectRoot.value || savingQuickScene.value) {
        return;
    }

    savingQuickScene.value = true;
    detailError.value = "";

    try {
        const detail = await $fetch<StorySceneDetailDto>(`/api/projects/plot/scenes/${payload.sceneId}`, projectPlotOptions({
            method: "PATCH",
            body: {
                title: payload.title,
                summary: payload.summary,
                purpose: payload.purpose,
                writingTip: payload.writingTip,
                status: payload.status,
                chapterId: payload.chapterId,
                worldAnchor: payload.worldAnchor,
            } satisfies UpdateStorySceneRequestDto,
        }));

        applySceneDetail(detail);
    } catch (error) {
        detailError.value = resolveErrorMessage(error, "保存 Scene 详情失败");
    } finally {
        savingQuickScene.value = false;
    }
}

/**
 * 保存 Thread 编辑结果。
 */
async function saveThread(payload: PlotThreadEditorSave): Promise<void> {
    if (!currentProjectRoot.value || payload.target !== "thread" || savingEditor.value) {
        return;
    }

    savingEditor.value = true;
    editorError.value = "";
    detailDiagnostics.value = "";

    try {
        if (editorMode.value === "create") {
            const created = await $fetch<StoryThreadWriteResponseDto>(`/api/projects/plot/threads`, projectPlotOptions({
                method: "POST",
                body: {
                    storyPhaseId: selectedThread.value?.phaseId ?? null,
                    name: createThreadName(payload.title),
                    title: payload.title,
                    isMainThread: payload.isMainThread,
                    status: payload.status,
                    miceType: payload.miceType,
                    summary: payload.summary,
                    tags: payload.tags,
                    writingTip: payload.writingTip,
                } satisfies CreateStoryThreadRequestDto,
            }));
            detailDiagnostics.value = formatDiagnosticsText(created);

            applyThreadDetail(created);
            await loadPlotTree({
                preferredThreadId: created.id,
            });
            await loadPlotWorkbench(true);
            return;
        }

        if (!editingThreadId.value) {
            return;
        }

        const updated = await $fetch<StoryThreadWriteResponseDto>(`/api/projects/plot/threads/${editingThreadId.value}`, projectPlotOptions({
            method: "PATCH",
            body: {
                title: payload.title,
                isMainThread: payload.isMainThread,
                status: payload.status,
                miceType: payload.miceType,
                summary: payload.summary,
                tags: payload.tags,
                writingTip: payload.writingTip,
            } satisfies UpdateStoryThreadRequestDto,
        }));
        detailDiagnostics.value = formatDiagnosticsText(updated);

        applyThreadDetail(updated);
        await loadPlotTree({
            preferredThreadId: updated.id,
            preferredSceneId: selectedSceneId.value,
        });
        await loadPlotWorkbench(true);
    } catch (error) {
        editorError.value = resolveErrorMessage(error, "保存 Thread 失败");
        throw error;
    } finally {
        savingEditor.value = false;
    }
}

/**
 * 保存 Scene 和它下属的 Plot。
 */
async function saveScene(payload: PlotThreadEditorSave): Promise<void> {
    if (!currentProjectRoot.value || payload.target !== "scene" || savingEditor.value || !selectedThreadId.value) {
        return;
    }

    savingEditor.value = true;
    editorError.value = "";
    detailDiagnostics.value = "";

    try {
        let sceneId = editingSceneId.value;

        if (editorMode.value === "create") {
            const createdScene = await $fetch<StorySceneWriteResponseDto>(`/api/projects/plot/scenes`, projectPlotOptions({
                method: "POST",
                body: {
                    threadId: selectedThreadId.value,
                    chapterId: payload.chapterId,
                    title: payload.title,
                    status: payload.status,
                    outcomeType: payload.outcomeType,
                    pacingRole: payload.pacingRole,
                    summary: payload.summary,
                    purpose: payload.purpose,
                    writingTip: payload.writingTip,
                    worldAnchor: payload.worldAnchor,
                    refs: toStoryRefs(payload.refs),
                } satisfies CreateStorySceneRequestDto,
            }));
            detailDiagnostics.value = formatDiagnosticsText(createdScene);

            sceneId = createdScene.id;
            applySceneDetail(createdScene);
        } else if (sceneId) {
            const updatedScene = await $fetch<StorySceneWriteResponseDto>(`/api/projects/plot/scenes/${sceneId}`, projectPlotOptions({
                method: "PATCH",
                body: {
                    threadId: selectedThreadId.value,
                    chapterId: payload.chapterId,
                    title: payload.title,
                    status: payload.status,
                    outcomeType: payload.outcomeType,
                    pacingRole: payload.pacingRole,
                    summary: payload.summary,
                    purpose: payload.purpose,
                    writingTip: payload.writingTip,
                    worldAnchor: payload.worldAnchor,
                    refs: toStoryRefs(payload.refs),
                } satisfies UpdateStorySceneRequestDto,
            }));
            detailDiagnostics.value = formatDiagnosticsText(updatedScene);
            applySceneDetail(updatedScene);
        }

        await loadPlotTree({
            preferredThreadId: selectedThreadId.value,
            preferredSceneId: sceneId,
        });
        await loadPlotWorkbench(true);

        if (sceneId) {
            await ensureSceneDetail(sceneId, true);
        }
    } catch (error) {
        editorError.value = resolveErrorMessage(error, "保存 Scene 失败");
        throw error;
    } finally {
        savingEditor.value = false;
    }
}

/**
 * 统一处理编辑器保存。
 */
async function handleEditorSave(payload: PlotThreadEditorSave): Promise<void> {
    if (payload.target === "thread") {
        await saveThread(payload);
        editorVisible.value = false;
        return;
    }

    await saveScene(payload);
    editorVisible.value = false;
}

/**
 * 删除 Thread。
 */
async function deleteThread(threadId: string): Promise<void> {
    if (!currentProjectRoot.value) {
        return;
    }

    await $fetch(`/api/projects/plot/threads/${threadId}`, projectPlotOptions({
        method: "DELETE",
    }));

    delete threadDetailMap.value[threadId];
    await loadPlotTree();
    await loadPlotWorkbench(true);
}

/**
 * 删除 Scene。
 */
async function deleteScene(sceneId: string): Promise<void> {
    if (!currentProjectRoot.value) {
        return;
    }

    const fallbackThreadId = scenes.value.find((scene) => scene.id === sceneId)?.threadId ?? selectedThreadId.value;
    await $fetch(`/api/projects/plot/scenes/${sceneId}`, projectPlotOptions({
        method: "DELETE",
    }));

    delete sceneDetailMap.value[sceneId];
    await loadPlotTree({
        preferredThreadId: fallbackThreadId,
    });
    await loadPlotWorkbench(true);
}

/**
 * 在指定 Thread 下创建一个 Scene 草稿。
 */
async function createWorkbenchScene(threadId: string): Promise<void> {
    if (!currentProjectRoot.value) {
        return;
    }

    workbenchError.value = "";

    try {
        const created = await $fetch<StorySceneWriteResponseDto>(`/api/projects/plot/scenes`, projectPlotOptions({
            method: "POST",
            body: {
                threadId,
                chapterId: null,
                title: "新建 Scene",
                status: "draft",
                summary: "",
                purpose: null,
                writingTip: null,
                worldAnchor: createEmptyWorldAnchor(),
                refs: [],
            } satisfies CreateStorySceneRequestDto,
        }));
        detailDiagnostics.value = formatDiagnosticsText(created);
        applySceneDetail(created);
        await loadPlotTree({
            preferredThreadId: threadId,
            preferredSceneId: created.id,
        });
        selectedThreadId.value = threadId;
        selectedSceneId.value = created.id;
        await loadPlotWorkbench(true);
    } catch (error) {
        setWorkbenchError(error, "创建 Scene 失败");
    }
}

/**
 * 确认删除当前对象。
 */
async function confirmDelete(): Promise<void> {
    if (!deleteTarget.value) {
        return;
    }

    const target = deleteTarget.value;
    deleteTarget.value = null;
    if (plotWorkbenchOpen.value) {
        workbenchError.value = "";
    } else {
        treeError.value = "";
    }

    try {
        if (target.type === "thread") {
            await deleteThread(target.id);
            return;
        }

        await deleteScene(target.id);
    } catch (error) {
        if (plotWorkbenchOpen.value) {
            setWorkbenchError(error, "删除剧情对象失败");
        } else {
            treeError.value = resolveErrorMessage(error, "删除剧情对象失败");
        }
    }
}

/**
 * 保存当前 Thread 下的 Scene 排序。
 */
async function reorderScenes(sceneIds: string[]): Promise<void> {
    if (!currentProjectRoot.value || !selectedThreadId.value || reorderingScenes.value) {
        return;
    }

    reorderingScenes.value = true;
    if (plotWorkbenchOpen.value) {
        workbenchError.value = "";
    } else {
        treeError.value = "";
    }

    try {
        const sceneMap = new Map(scenes.value.map((scene) => [scene.id, scene]));
        const items = sceneIds.map((sceneId, index) => {
            const scene = sceneMap.get(sceneId);
            if (!scene) {
                throw new Error(`缺少待重排 Scene: ${sceneId}`);
            }

            return {
                sceneId,
                threadId: scene.threadId,
                chapterId: scene.chapterId,
                threadSortOrder: index,
                chapterSortOrder: scene.chapterSortOrder,
            };
        });

        await $fetch(`/api/projects/plot/scenes/reorder`, projectPlotOptions({
            method: "POST",
            body: {
                items,
            } satisfies ReorderStoryScenesRequestDto,
        }));

        await loadPlotTree({
            preferredThreadId: selectedThreadId.value,
            preferredSceneId: selectedSceneId.value,
        });
        await loadPlotWorkbench(true);
    } catch (error) {
        if (plotWorkbenchOpen.value) {
            setWorkbenchError(error, "保存 Scene 顺序失败");
        } else {
            treeError.value = resolveErrorMessage(error, "保存 Scene 顺序失败");
        }
    } finally {
        reorderingScenes.value = false;
    }
}

watch(() => ({
    novelId: currentProjectRoot.value,
    workspaceLoading: loadingWorkspace.value,
}), async ({novelId, workspaceLoading}, previousState) => {
    const isInitialMount = previousState === undefined;
    closeContextMenu();
    deleteTarget.value = null;
    editorVisible.value = false;
    if (!isInitialMount) {
        plotWorkbenchOpen.value = false;
    }
    treeError.value = "";
    detailError.value = "";
    detailDiagnostics.value = "";
    threadDetailMap.value = {};
    sceneDetailMap.value = {};
    plotWorkbenchData.value = null;
    workbenchError.value = "";

    if (workspaceLoading || !novelId) {
        threads.value = [];
        scenes.value = [];
        selectedThreadId.value = null;
        selectedSceneId.value = null;
        openPromiseCount.value = 0;
        openDecisionCount.value = 0;
        return;
    }

    await loadPlotTree();
    if (plotWorkbenchOpen.value) {
        void loadPlotWorkbench(true);
    }
}, {immediate: true});

watch(plotWorkbenchOpen, (open) => {
    if (open) {
        void loadPlotWorkbench();
    }
});

watch(plotRefreshVersion, async (version, previousVersion) => {
    if (!version || version === previousVersion || loadingWorkspace.value || !currentProjectRoot.value) {
        return;
    }

    await loadPlotTree({
        preferredThreadId: selectedThreadId.value,
        preferredSceneId: selectedSceneId.value,
    });
    await loadPlotWorkbench(true);
});
</script>

<template>
    <div class="flex h-full min-h-0 flex-col">
        <!-- 错误提示 -->
        <div v-if="treeError" class="border-b border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-[11px] text-[var(--status-danger)]">
            <div class="flex items-center justify-between gap-3">
                <span>{{ treeError }}</span>
                <button
                    type="button"
                    class="rounded-md border border-[var(--status-danger-border)] px-2 py-1 text-[10px] font-semibold tracking-[0.12em] text-[var(--status-danger)] transition-colors hover:bg-[var(--status-danger-bg)]"
                    @click="loadPlotTree({
                        preferredThreadId: selectedThreadId,
                        preferredSceneId: selectedSceneId,
                    })"
                >
                    重试
                </button>
            </div>
        </div>

        <!-- Plot 工作台入口 -->
        <div class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2">
            <div class="min-w-0">
                <div class="truncate text-[12px] font-semibold text-[var(--text-main)]">剧情编排</div>
                <div class="truncate text-[11px] text-[var(--text-muted)]">Thread / Scene / World Anchor</div>
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <!-- 规划层计数入口:点击打开工作台对应 tab;0 计数弱化显示但不隐藏(入口可发现性) -->
                <button
                    type="button"
                    data-testid="plot-panel-planning-promises"
                    class="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-[11px] font-semibold text-[var(--text-secondary)] transition-all hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)]"
                    :class="openPromiseCount === 0 ? 'opacity-50' : ''"
                    title="承诺账本:进行中的读者债务"
                    @click="openPlanningTab('promises')"
                >
                    <span class="i-lucide-scroll-text h-3.5 w-3.5"></span>
                    <span>承诺 {{ openPromiseCount }}</span>
                </button>
                <button
                    type="button"
                    data-testid="plot-panel-planning-decisions"
                    class="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-[11px] font-semibold text-[var(--text-secondary)] transition-all hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)]"
                    :class="openDecisionCount === 0 ? 'opacity-50' : ''"
                    title="决策记录:待拍板的未决决策"
                    @click="openPlanningTab('decisions')"
                >
                    <span class="i-lucide-gavel h-3.5 w-3.5"></span>
                    <span>未决 {{ openDecisionCount }}</span>
                </button>
                <button
                    type="button"
                    data-testid="plot-panel-chapter-create"
                    class="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-[12px] font-semibold text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)]"
                    @click="openChapterEditor(null)"
                >
                    <span class="i-lucide-book-plus h-4 w-4"></span>
                    <span>章节</span>
                </button>
                <button
                    type="button"
                    data-testid="plot-panel-workbench-entry"
                    class="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-[12px] font-semibold text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)]"
                    :disabled="loadingWorkbench"
                    @click="plotWorkbenchOpen = true"
                >
                    <span :class="loadingWorkbench ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-git-branch-plus'" class="h-4 w-4"></span>
                    <span>剧本工作台</span>
                </button>
            </div>
        </div>

        <!-- 承载树章节管理条:点击芯片编辑章节 + ChapterBrief;圆点表示已填写章级指令 -->
        <div v-if="chapterChips.length || actNodes.length" class="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-1.5">
            <span class="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">章节</span>
            <button
                v-for="chip in chapterChips"
                :key="chip.chapter.id"
                type="button"
                class="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)]"
                :title="`${chip.volumeTitle} · ${chip.label}`"
                @click="openChapterEditor(chip.chapter)"
            >
                <span :class="chip.hasBrief ? 'bg-[var(--status-success)]' : 'bg-[var(--text-muted)]/40'" class="h-1.5 w-1.5 rounded-full"></span>
                <span class="max-w-[120px] truncate">{{ chip.label }}</span>
            </button>
            <button
                type="button"
                data-testid="plot-panel-act-create"
                class="inline-flex shrink-0 items-center gap-1 rounded-md border border-dashed border-[var(--border-color)] px-2 py-1 text-[11px] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--accent-text)]"
                @click="openActDialog"
            >
                <span class="i-lucide-plus h-3 w-3"></span>
                <span>卷</span>
            </button>
        </div>

        <!-- 剧情面板主体 -->
        <div class="relative flex min-h-0 flex-1 flex-col bg-[var(--bg-panel)]">
            <div
                v-if="loadingTree && threads.length === 0"
                class="flex min-h-0 flex-1 items-center justify-center text-[12px] text-[var(--text-muted)]"
            >
                正在加载剧情面板...
            </div>

            <template v-else>
                <PlotThreadScenePanel
                    :threads="threads"
                    :scenes="scenes"
                    :chapters="chapters"
                    :selected-thread-id="selectedThreadId"
                    :selected-scene-id="selectedSceneId"
                    @select-thread="selectThreadFromPanel"
                    @select-scene="selectSceneFromPanel"
                    @create-scene="openSceneEditor('create')"
                    @edit-thread="openThreadEditor('edit')"
                    @edit-scene="openSceneEditor('edit', $event)"
                    @open-thread-menu="openThreadMenu"
                    @open-scene-menu="openSceneMenu"
                    @open-root-menu="openRootMenu"
                    @reorder-scenes="reorderScenes"
                />

                <PlotThreadDetailPanel
                    ref="detailPanelRef"
                    :chapters="chapters"
                    :detail="currentDetail"
                    :diagnostics="detailDiagnostics"
                    @close="closeDetailPanel"
                    @edit="openSceneEditorFromDetail"
                    @update-scene="quickUpdateScene"
                    @focus-promise="focusPromiseFromScene"
                />
            </template>
        </div>

        <ContextMenu
            :visible="contextMenuVisible"
            :x="contextMenuX"
            :y="contextMenuY"
            :items="contextMenuItems"
            @close="closeContextMenu"
        />

        <PlotWorkbenchDialog
            v-model="plotWorkbenchOpen"
            :project-root="currentProjectRoot ?? ''"
            :story="workbenchStory"
            :phases="workbenchPhases"
            :threads="workbenchThreads"
            :scenes="workbenchScenes"
            :chapters="chapters"
            :acts="actNodes"
            :selected-thread-id="selectedThreadId"
            :selected-scene-id="selectedSceneId"
            :scene-promise-beats="selectedScenePromiseBeats"
            :pinned-thread-ids="pinnedWorkbenchThreadIds"
            :loading="loadingWorkbench"
            :error="workbenchError"
            @select-thread="selectThread"
            @select-scene="selectScene"
            @planning-mutated="handlePlanningMutated"
            @create-thread="openThreadEditor('create')"
            @toggle-thread-pin="toggleWorkbenchThreadPin"
            @toggle-thread-main="(threadId) => void updateWorkbenchThread(threadId, {isMainThread: !workbenchThreads.find((thread) => thread.id === threadId)?.isMainThread})"
            @delete-thread="queueDelete('thread', $event)"
            @create-scene="(threadId) => void createWorkbenchScene(threadId)"
            @auto-sort-scenes="reorderScenes"
            @reorder-scenes="reorderScenes"
            @update-thread="(threadId, patch) => void updateWorkbenchThread(threadId, patch)"
            @update-scene="(sceneId, patch) => void updateWorkbenchScene(sceneId, patch)"
            @open-world-engine="openWorldEngineFromPlot"
        />

        <PlotThreadEditorDialog
            :visible="editorVisible"
            :target="editorTarget"
            :mode="editorMode"
            :thread="editingThread"
            :scene="editingScene"
            :chapters="chapters"
            :scene-refs="editingSceneRefs"
            :saving="savingEditor"
            :error="editorError"
            @update:visible="editorVisible = $event"
            @save="handleEditorSave"
        />

        <PlotChapterEditorDialog
            :visible="chapterEditorVisible"
            :mode="chapterEditorMode"
            :chapter="editingChapter"
            :acts="actNodes"
            :project-root="currentProjectRoot ?? ''"
            :saving="savingChapter"
            :error="chapterEditorError"
            @update:visible="chapterEditorVisible = $event"
            @save="saveChapter"
        />

        <!-- 新建卷(Act)对话框 -->
        <Dialog
            :model-value="actDialogVisible"
            title="新建卷"
            width="440px"
            show-cancel
            overlay-type="opaque"
            :busy="savingAct"
            @request-close="actDialogVisible = false"
            @update:model-value="actDialogVisible = $event"
        >
            <template #footer>
                <button class="inline-flex items-center justify-center h-8 px-4 rounded-md text-[13px] font-medium cursor-pointer border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)] active:scale-95 disabled:opacity-50" :disabled="savingAct" @click="actDialogVisible = false">取消</button>
                <button class="inline-flex items-center justify-center h-8 min-w-[92px] px-4 rounded-md text-[13px] font-medium cursor-pointer border border-transparent bg-[var(--accent-main)] text-[var(--text-inverse)] transition-all hover:opacity-90 active:scale-95 disabled:opacity-50" :disabled="savingAct" @click="saveAct">
                    <span v-if="savingAct" class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
                    <span v-else>确定</span>
                </button>
            </template>
            <div class="space-y-3 px-1 mt-1">
                <div v-if="actDialogError" class="text-[11px] text-[var(--status-danger)]">{{ actDialogError }}</div>
                <label class="block space-y-1">
                    <span class="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">卷标题</span>
                    <input v-model="actDraftTitle" placeholder="如 第一卷 · 序章" class="h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-[12px] text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" />
                </label>
                <label class="block space-y-1">
                    <span class="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">name(可空,自动派生)</span>
                    <input v-model="actDraftName" placeholder="小写字母/数字/连字符" class="h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-[12px] text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" />
                </label>
            </div>
        </Dialog>

        <Dialog
            :model-value="Boolean(deleteTarget)"
            title="删除确认"
            width="420px"
            show-cancel
            overlay-type="opaque"
            @update:model-value="deleteTarget = null"
            @confirm="confirmDelete"
        >
            <div class="text-sm leading-6 text-[var(--text-secondary)]">{{ deleteMessage }}</div>
        </Dialog>
    </div>
</template>
