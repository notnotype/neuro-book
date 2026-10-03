import type {
    StoryEffectiveRefDto,
    StoryRefDto,
    StorySceneOutcomeTypeDto,
    StoryScenePacingRoleDto,
    StoryScenePromiseBeatDto,
    StorySceneStatusDto,
    StorySceneWorldAnchorDto,
    StoryThreadMiceTypeDto,
    StoryThreadStatusDto,
} from "nbook/shared/dto/plot.dto";

/**
 * 线程卡片配色。
 * 这里只服务前端面板，不进入正式剧情 schema。
 */
export type PlotThreadTone = "amber" | "sky" | "emerald" | "rose";

/**
 * 单 Thread 面板使用的章节视图模型。
 */
export type PlotThreadPanelChapter = {
    // StoryChapter 实体 id。
    id: string;
    volumeTitle: string;
    numberLabel: string;
    title: string;
    summary: string;
};

/**
 * 单 Thread 面板使用的引用视图模型。
 */
export type PlotThreadPanelRef = StoryRefDto & {
    id: string;
    // 仅 effectiveRefs 或已知来源时填写。
    source?: "thread" | "scene";
};

/**
 * 单 Thread 面板使用的 Thread 视图模型。
 */
export type PlotThreadPanelThread = {
    id: string;
    phaseId: string | null;
    title: string;
    summary: string;
    status: StoryThreadStatusDto;
    isMainThread: boolean;
    // MICE 线型(提示这条线怎样才算关);为空表示未填写。
    miceType: StoryThreadMiceTypeDto | null;
    tags: string[];
    writingTip: string | null;
    tone: PlotThreadTone;
    refs: PlotThreadPanelRef[];
};

/**
 * 单 Thread 面板使用的 Scene 视图模型。
 */
export type PlotThreadPanelScene = {
    id: string;
    threadId: string;
    // 挂载章节实体 id;为空表示 Scene 尚未挂章。
    chapterId: string | null;
    title: string;
    summary: string;
    purpose: string | null;
    status: StorySceneStatusDto;
    // 本场主要行动者主动尝试的结果;为空仅表示未填写(D29)。
    outcomeType: StorySceneOutcomeTypeDto | null;
    // 本场张弛角色;为空表示未填写。
    pacingRole: StoryScenePacingRoleDto | null;
    threadSortOrder: number;
    chapterSortOrder: number | null;
    writingTip: string | null;
    worldAnchor: StorySceneWorldAnchorDto;
    refs: PlotThreadPanelRef[];
};

/**
 * 当前单 Thread 视图里选中的详情对象。
 */
export type PlotThreadPanelDetail = {
    thread: PlotThreadPanelThread;
    scene: PlotThreadPanelScene;
    // 为空表示当前 Scene 未挂章。
    chapter: PlotThreadPanelChapter | null;
    effectiveRefs: PlotThreadPanelRef[];
    // 本场服务的承诺线(promise beats);Scene 详情未加载时为空数组。
    promiseBeats: StoryScenePromiseBeatDto[];
};

/**
 * Scene 轻量详情面板的快速编辑载荷。
 */
export type PlotThreadQuickSceneUpdate = {
    sceneId: string;
    title: string;
    summary: string;
    purpose: string | null;
    status: StorySceneStatusDto;
    // 挂载章节实体 id;为空表示取消挂章。
    chapterId: string | null;
    writingTip: string | null;
    worldAnchor: StorySceneWorldAnchorDto;
};

/**
 * Thread 编辑器保存载荷。
 */
export type PlotThreadEditorThreadSave = {
    target: "thread";
    title: string;
    summary: string;
    status: StoryThreadStatusDto;
    isMainThread: boolean;
    // MICE 线型;为空表示显式清空(未填写)。
    miceType: StoryThreadMiceTypeDto | null;
    tags: string[];
    writingTip: string | null;
};

/**
 * Scene 编辑器保存载荷。
 */
export type PlotThreadEditorSceneSave = {
    target: "scene";
    title: string;
    summary: string;
    purpose: string | null;
    status: StorySceneStatusDto;
    // 本场结果类型;为空表示显式清空(未填写)。
    outcomeType: StorySceneOutcomeTypeDto | null;
    // 本场张弛角色;为空表示显式清空(未填写)。
    pacingRole: StoryScenePacingRoleDto | null;
    // 挂载章节实体 id;为空表示取消挂章。
    chapterId: string | null;
    writingTip: string | null;
    worldAnchor: StorySceneWorldAnchorDto;
    refs: PlotThreadPanelRef[];
};

/**
 * 编辑器保存载荷联合类型。
 */
export type PlotThreadEditorSave = PlotThreadEditorThreadSave | PlotThreadEditorSceneSave;

/**
 * Thread 状态中文标签。
 */
export const PLOT_THREAD_STATUS_LABELS: Record<StoryThreadStatusDto, string> = {
    active: "进行中",
    archived: "归档",
    done: "完成",
    draft: "草稿",
    paused: "暂停",
};

/**
 * Scene 状态中文标签。
 */
export const PLOT_SCENE_STATUS_LABELS: Record<StorySceneStatusDto, string> = {
    active: "进行中",
    archived: "归档",
    draft: "草稿",
    revised: "已修订",
    written: "已成稿",
};

/**
 * 线程色板样式。
 */
export const PLOT_THREAD_TONE_STYLES: Record<PlotThreadTone, {
    chipClass: string;
    borderClass: string;
    glowClass: string;
}> = {
    amber: {
        chipClass: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
        borderClass: "border-amber-500/35",
        glowClass: "shadow-[0_0_0_1px_rgba(245,158,11,0.12)]",
    },
    sky: {
        chipClass: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
        borderClass: "border-sky-500/35",
        glowClass: "shadow-[0_0_0_1px_rgba(14,165,233,0.12)]",
    },
    emerald: {
        chipClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
        borderClass: "border-emerald-500/35",
        glowClass: "shadow-[0_0_0_1px_rgba(16,185,129,0.12)]",
    },
    rose: {
        chipClass: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
        borderClass: "border-rose-500/35",
        glowClass: "shadow-[0_0_0_1px_rgba(244,63,94,0.12)]",
    },
};

/**
 * 把有效引用 DTO 转成面板引用项。
 */
export function createPanelRefFromEffectiveRef(refItem: StoryEffectiveRefDto): PlotThreadPanelRef {
    return {
        id: `${refItem.sourceType}:${refItem.sourceId}:${refItem.target}:${refItem.relation}`,
        relation: refItem.relation,
        target: refItem.target,
        visibility: refItem.visibility,
        note: refItem.note,
        source: refItem.sourceType,
    };
}
