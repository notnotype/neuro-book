<script setup lang="ts">
import {computed, ref} from "vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import ContextMenu, {type ContextMenuItem} from "nbook/app/components/common/ContextMenu.vue";
import {plotPreviewDataset} from "nbook/app/components/novel-ide/plot/plot-preview.data";
import type {
    PlotPreviewRef,
    PlotPreviewScene,
    PlotPreviewThread,
} from "nbook/app/components/novel-ide/plot/plot-preview.types";
import PlotThreadEditorDialog from "nbook/app/components/novel-ide/plot/thread-panel/PlotThreadEditorDialog.vue";
import PlotThreadPanelShell from "nbook/app/components/novel-ide/plot/thread-panel/PlotThreadPanelShell.vue";
import type {
    PlotThreadEditorSave,
    PlotThreadPanelDetail,
    PlotThreadPanelRef,
    PlotThreadQuickSceneUpdate,
    PlotThreadPanelScene,
    PlotThreadPanelThread,
} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";

const toneCycle: PlotPreviewThread["tone"][] = ["amber", "sky", "emerald", "rose"];
const emptyWorldAnchor = {
    startTime: null,
    endTime: null,
    startInstant: null,
    endInstant: null,
    subjectIds: [],
    locationSubjectId: null,
    subjects: [],
    locationSubject: null,
    unresolvedSubjectIds: [],
} satisfies PlotThreadPanelScene["worldAnchor"];

const selectedThreadId = ref<string | null>("thread-main");
const selectedSceneId = ref<string | null>("scene-auction");
const threads = ref(cloneThreads(plotPreviewDataset.threads));
const scenes = ref(cloneScenes(plotPreviewDataset.scenes));
const chapters = plotPreviewDataset.chapters;
const editorVisible = ref(false);
const editorMode = ref<"create" | "edit">("create");
const editorTarget = ref<"thread" | "scene">("scene");
const editingThreadId = ref<string | null>(null);
const editingSceneId = ref<string | null>(null);
const deleteTarget = ref<{type: "thread" | "scene"; id: string} | null>(null);
const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuItems = ref<ContextMenuItem[]>([]);

const threadMap = computed(() => new Map(threads.value.map((thread) => [thread.id, thread])));
const sceneMap = computed(() => new Map(scenes.value.map((scene) => [scene.id, scene])));
const chapterMap = computed(() => new Map(chapters.map((chapter) => [chapter.id, chapter])));

/**
 * 当前选中的 Thread。
 */
const selectedThread = computed(() => {
    return selectedThreadId.value ? (threadMap.value.get(selectedThreadId.value) ?? null) : null;
});

/**
 * 当前选中的 Scene。
 */
const selectedScene = computed(() => {
    return selectedSceneId.value ? (sceneMap.value.get(selectedSceneId.value) ?? null) : null;
});

/**
 * 当前编辑中的 Thread。
 */
const editingThread = computed(() => {
    return editingThreadId.value ? (threadMap.value.get(editingThreadId.value) ?? null) : null;
});

/**
 * 当前编辑中的 Scene。
 */
const editingScene = computed(() => {
    return editingSceneId.value ? (sceneMap.value.get(editingSceneId.value) ?? null) : null;
});

/**
 * 当前编辑中的 Scene refs。
 */
const editingSceneRefs = computed(() => editingScene.value?.refs ?? []);

/**
 * 当前详情面板所需的完整数据。
 */
const detail = computed<PlotThreadPanelDetail | null>(() => {
    const thread = selectedThread.value;
    const scene = selectedScene.value;

    if (!thread || !scene || scene.threadId !== thread.id) {
        return null;
    }

    return {
        thread,
        scene,
        chapter: scene?.chapterId ? (chapterMap.value.get(scene.chapterId) ?? null) : null,
        effectiveRefs: buildEffectiveRefs(thread.refs, scene?.refs ?? []),
        // 预览 mock 无规划层数据,promise beats 恒为空。
        promiseBeats: [],
    };
});

/**
 * 当前删除确认文案。
 */
const deleteMessage = computed(() => {
    if (!deleteTarget.value) {
        return "";
    }

    if (deleteTarget.value.type === "thread") {
        const thread = threadMap.value.get(deleteTarget.value.id);
        return `确认删除「${thread?.title ?? "当前 Thread"}」吗？该 Thread 下的 Scene 会一起删除。`;
    }

    const scene = sceneMap.value.get(deleteTarget.value.id);
    return `确认删除「${scene?.title ?? "当前 Scene"}」吗？`;
});

/**
 * 选中一条 Thread，并同步到它的第一个 Scene。
 */
function selectThread(threadId: string): void {
    selectedThreadId.value = threadId;

    const nextScene = scenes.value
        .filter((scene) => scene.threadId === threadId)
        .sort((left, right) => left.threadSortOrder - right.threadSortOrder)[0] ?? null;

    selectedSceneId.value = nextScene?.id ?? null;
}

/**
 * 选中一个 Scene，并同步所属 Thread。
 */
function selectScene(sceneId: string): void {
    const scene = sceneMap.value.get(sceneId) ?? null;
    if (!scene) {
        return;
    }

    selectedSceneId.value = scene.id;
    selectedThreadId.value = scene.threadId;
}

/**
 * 收起详情面板。
 */
function closeDetail(): void {
    selectedSceneId.value = null;
}

/**
 * 按当前拖拽结果重排 Scene 顺序。
 */
function reorderScenes(sceneIds: string[]): void {
    const sceneOrderMap = new Map(sceneIds.map((sceneId, index) => [sceneId, index]));

    scenes.value = scenes.value.map((scene) => {
        const nextOrder = sceneOrderMap.get(scene.id);
        if (nextOrder === undefined) {
            return scene;
        }

        return {
            ...scene,
            threadSortOrder: nextOrder,
        };
    });
}

/**
 * 处理详情面板里的快速编辑。
 */
function quickUpdateScene(payload: PlotThreadQuickSceneUpdate): void {
    scenes.value = scenes.value.map((scene) => scene.id === payload.sceneId
        ? {
            ...scene,
            title: payload.title,
            summary: payload.summary,
            purpose: payload.purpose,
            status: payload.status === "archived" ? "draft" : payload.status,
            chapterId: payload.chapterId,
            chapterSortOrder: payload.chapterId === null
                ? null
                : (scene.chapterId === payload.chapterId
                    ? scene.chapterSortOrder
                    : scenes.value.filter((item) => item.chapterId === payload.chapterId).length),
        }
        : scene);
}

/**
 * 打开 Thread 编辑器。
 */
function openThreadEditor(mode: "create" | "edit"): void {
    editorMode.value = mode;
    editorTarget.value = "thread";
    editingThreadId.value = mode === "edit" ? selectedThreadId.value : null;
    editingSceneId.value = null;
    editorVisible.value = true;
}

/**
 * 打开 Scene 编辑器。
 */
function openSceneEditor(mode: "create" | "edit", sceneId?: string): void {
    editorMode.value = mode;
    editorTarget.value = "scene";
    editingThreadId.value = selectedThreadId.value;
    editingSceneId.value = mode === "edit" ? (sceneId ?? selectedSceneId.value) : null;
    editorVisible.value = Boolean(selectedThreadId.value);
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
            action: () => openSceneEditor("create"),
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
    const scene = sceneMap.value.get(payload.sceneId);
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
                openSceneEditor("create");
            },
        },
        {
            label: "编辑 Scene",
            iconClass: "i-lucide-pencil-line",
            action: () => {
                selectScene(scene.id);
                openSceneEditor("edit", scene.id);
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
            action: () => openSceneEditor("create"),
        },
        {separator: true},
        {
            label: "编辑当前 Thread",
            iconClass: "i-lucide-pencil-line",
            disabled: !selectedThread.value,
            action: () => openThreadEditor("edit"),
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
 * 确认删除当前对象。
 */
function confirmDelete(): void {
    if (!deleteTarget.value) {
        return;
    }

    if (deleteTarget.value.type === "thread") {
        deleteThread(deleteTarget.value.id);
    } else {
        deleteScene(deleteTarget.value.id);
    }

    deleteTarget.value = null;
}

/**
 * 提交编辑器内容。
 */
function handleEditorSave(payload: PlotThreadEditorSave): void {
    if (payload.target === "thread") {
        saveThread(payload);
        return;
    }

    saveScene(payload);
}

/**
 * 新建或更新 Thread。
 */
function saveThread(payload: {
    title: string;
    summary: string;
    status: PlotThreadPanelThread["status"];
    isMainThread: boolean;
    miceType: PlotThreadPanelThread["miceType"];
    tags: string[];
    writingTip: string | null;
}): void {
    if (editorMode.value === "create") {
        const nextThread: PlotThreadPanelThread = {
            id: createId("thread"),
            phaseId: selectedThread.value?.phaseId ?? plotPreviewDataset.phases[0]?.id ?? null,
            title: payload.title,
            summary: payload.summary,
            status: payload.status === "archived" ? "draft" : payload.status,
            isMainThread: payload.isMainThread,
            miceType: payload.miceType,
            tags: payload.tags,
            writingTip: payload.writingTip,
            tone: toneCycle[threads.value.length % toneCycle.length] ?? "amber",
            refs: [],
        };
        threads.value = [...threads.value, nextThread];
        selectThread(nextThread.id);
        return;
    }

    if (!editingThreadId.value) {
        return;
    }

    threads.value = threads.value.map((thread) => thread.id === editingThreadId.value
        ? {
            ...thread,
            title: payload.title,
            summary: payload.summary,
            status: payload.status === "archived" ? "draft" : payload.status,
            isMainThread: payload.isMainThread,
            miceType: payload.miceType,
            tags: payload.tags,
            writingTip: payload.writingTip,
        }
        : thread);
}

/**
 * 新建或更新 Scene。
 */
function saveScene(payload: {
    title: string;
    summary: string;
    purpose: string | null;
    status: PlotThreadPanelScene["status"];
    outcomeType: PlotThreadPanelScene["outcomeType"];
    pacingRole: PlotThreadPanelScene["pacingRole"];
    chapterId: string | null;
    writingTip: string | null;
    worldAnchor: PlotThreadPanelScene["worldAnchor"];
    refs: PlotPreviewRef[];
}): void {
    if (!selectedThreadId.value) {
        return;
    }

    if (editorMode.value === "create") {
        const nextScene: PlotThreadPanelScene = {
            id: createId("scene"),
            threadId: selectedThreadId.value,
            chapterId: payload.chapterId,
            title: payload.title,
            summary: payload.summary,
            purpose: payload.purpose,
            status: payload.status === "archived" ? "draft" : payload.status,
            outcomeType: payload.outcomeType,
            pacingRole: payload.pacingRole,
            threadSortOrder: scenes.value.filter((scene) => scene.threadId === selectedThreadId.value).length,
            chapterSortOrder: payload.chapterId
                ? scenes.value.filter((scene) => scene.chapterId === payload.chapterId).length
                : null,
            writingTip: payload.writingTip,
            worldAnchor: payload.worldAnchor,
            refs: payload.refs.map((refItem) => ({...refItem})),
        };
        scenes.value = [...scenes.value, nextScene];
        selectScene(nextScene.id);
        return;
    }

    if (!editingSceneId.value) {
        return;
    }

    scenes.value = scenes.value.map((scene) => scene.id === editingSceneId.value
        ? {
            ...scene,
            title: payload.title,
            summary: payload.summary,
            purpose: payload.purpose,
            status: payload.status === "archived" ? "draft" : payload.status,
            outcomeType: payload.outcomeType,
            pacingRole: payload.pacingRole,
            chapterId: payload.chapterId,
            writingTip: payload.writingTip,
            chapterSortOrder: payload.chapterId === null
                ? null
                : (scene.chapterId === payload.chapterId
                    ? scene.chapterSortOrder
                    : scenes.value.filter((item) => item.chapterId === payload.chapterId).length),
            worldAnchor: payload.worldAnchor,
            refs: payload.refs.map((refItem) => ({...refItem})),
        }
        : scene);
}

/**
 * 删除一条 Thread，并清理子 Scene。
 */
function deleteThread(threadId: string): void {
    threads.value = threads.value.filter((thread) => thread.id !== threadId);
    scenes.value = scenes.value.filter((scene) => scene.threadId !== threadId);

    if (selectedThreadId.value === threadId) {
        const nextThread = threads.value[0] ?? null;
        selectedThreadId.value = nextThread?.id ?? null;
        selectedSceneId.value = nextThread
            ? (scenes.value.filter((scene) => scene.threadId === nextThread.id).sort((left, right) => left.threadSortOrder - right.threadSortOrder)[0]?.id ?? null)
            : null;
    }
}

/**
 * 删除一条 Scene，并重排当前 Thread 顺序。
 */
function deleteScene(sceneId: string): void {
    const scene = sceneMap.value.get(sceneId);
    if (!scene) {
        return;
    }

    scenes.value = scenes.value.filter((item) => item.id !== sceneId);
    normalizeThreadScenes(scene.threadId);

    if (selectedSceneId.value === sceneId) {
        const nextScene = scenes.value
            .filter((item) => item.threadId === scene.threadId)
            .sort((left, right) => left.threadSortOrder - right.threadSortOrder)[0] ?? null;
        selectedSceneId.value = nextScene?.id ?? null;
    }
}

/**
 * 重排一条 Thread 下的 Scene 顺序。
 */
function normalizeThreadScenes(threadId: string): void {
    const sortedSceneIds = scenes.value
        .filter((scene) => scene.threadId === threadId)
        .sort((left, right) => left.threadSortOrder - right.threadSortOrder)
        .map((scene) => scene.id);

    scenes.value = scenes.value.map((scene) => {
        if (scene.threadId !== threadId) {
            return scene;
        }

        return {
            ...scene,
            threadSortOrder: sortedSceneIds.indexOf(scene.id),
        };
    });
}

/**
 * 生成预览态 id。
 */
function createId(prefix: "thread" | "scene" | "ref"): string {
    return `${prefix}-preview-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 生成“Thread refs + Scene refs”的有效引用列表。
 */
function buildEffectiveRefs(threadRefs: PlotPreviewRef[], sceneRefs: PlotPreviewRef[]): PlotThreadPanelRef[] {
    return [
        ...threadRefs.map((refItem) => ({...refItem, source: "thread" as const})),
        ...sceneRefs.map((refItem) => ({...refItem, source: "scene" as const})),
    ];
}

/**
 * 克隆 Thread 数据，避免直接改写静态 mock。
 */
function cloneThreads(source: PlotPreviewThread[]): PlotThreadPanelThread[] {
    return source.map((thread) => ({
        ...thread,
        // 预览 mock 不携带规划层线型,桥接到面板模型时按未填写处理。
        miceType: null,
        tags: [...thread.tags],
        refs: thread.refs.map((refItem) => ({...refItem})),
    }));
}

/**
 * 克隆 Scene 数据，避免直接改写静态 mock。
 */
function cloneScenes(source: PlotPreviewScene[]): PlotThreadPanelScene[] {
    return source.map((scene) => {
        const {chapterPath, ...rest} = scene;
        return {
            ...rest,
            // 预览 mock 仍以路径占位;桥接到面板模型时映射为 chapterId 占位值。
            chapterId: chapterPath,
            // 预览 mock 不携带规划层节奏字段,按未填写处理。
            outcomeType: null,
            pacingRole: null,
            worldAnchor: emptyWorldAnchor,
            refs: scene.refs.map((refItem) => ({...refItem})),
        };
    });
}

</script>

<template>
    <!-- 单 Thread 侧边栏工作区 -->
    <div class="flex w-full justify-center">
        <PlotThreadPanelShell
            :threads="threads"
            :scenes="scenes"
            :chapters="chapters"
            :selected-thread-id="selectedThreadId"
            :selected-scene-id="selectedSceneId"
            :detail="detail"
            diagnostics=""
            @select-thread="selectThread"
            @select-scene="selectScene"
            @close-detail="closeDetail"
            @create-scene="openSceneEditor('create')"
            @edit-thread="openThreadEditor('edit')"
            @edit-scene="openSceneEditor('edit')"
            @quick-update-scene="quickUpdateScene"
            @open-thread-menu="openThreadMenu"
            @open-scene-menu="openSceneMenu"
            @open-root-menu="openRootMenu"
            @reorder-scenes="reorderScenes"
        />
    </div>

    <PlotThreadEditorDialog
        :visible="editorVisible"
        :target="editorTarget"
        :mode="editorMode"
        :thread="editingThread"
        :scene="editingScene"
        :chapters="chapters"
        :scene-refs="editingSceneRefs"
        @update:visible="editorVisible = $event"
        @save="handleEditorSave"
    />

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

    <ContextMenu
        :visible="contextMenuVisible"
        :x="contextMenuX"
        :y="contextMenuY"
        :items="contextMenuItems"
        @close="closeContextMenu"
    />
</template>
