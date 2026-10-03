/**
 * 剧情测试页的四个视图类型。
 */
export type PlotPreviewView = "locator" | "thread" | "chapter" | "tree";

/**
 * 线程配色。
 */
export type PlotPreviewTone = "amber" | "sky" | "emerald" | "rose";

/**
 * 剧情引用。
 */
export type PlotPreviewRef = {
    id: string;
    relation: string;
    target: string;
    visibility: "author" | "reader";
    // 为空表示当前引用没有额外备注。
    note: string | null;
};

/**
 * Story 数据。
 */
export type PlotPreviewStory = {
    id: string;
    title: string;
    summary: string;
};

/**
 * Phase 数据。
 */
export type PlotPreviewPhase = {
    id: string;
    title: string;
    summary: string;
};

/**
 * Thread 数据。
 */
export type PlotPreviewThread = {
    id: string;
    phaseId: string | null;
    title: string;
    summary: string;
    status: "draft" | "active" | "paused" | "done";
    isMainThread: boolean;
    tags: string[];
    writingTip: string | null;
    tone: PlotPreviewTone;
    refs: PlotPreviewRef[];
};

/**
 * Scene 数据。
 */
export type PlotPreviewScene = {
    id: string;
    threadId: string;
    chapterPath: string | null;
    title: string;
    summary: string;
    purpose: string | null;
    status: "draft" | "active" | "written" | "revised";
    threadSortOrder: number;
    chapterSortOrder: number | null;
    writingTip: string | null;
    refs: PlotPreviewRef[];
};

/**
 * Chapter 数据。
 */
export type PlotPreviewChapter = {
    id: string;
    volumeTitle: string;
    numberLabel: string;
    title: string;
    summary: string;
};

/**
 * 测试页完整数据集。
 */
export type PlotPreviewDataset = {
    story: PlotPreviewStory;
    phases: PlotPreviewPhase[];
    threads: PlotPreviewThread[];
    scenes: PlotPreviewScene[];
    chapters: PlotPreviewChapter[];
};

/**
 * 当前测试页的统一选中态。
 */
export type PlotPreviewSelection = {
    phaseId: string | null;
    threadId: string | null;
    sceneId: string | null;
    chapterId: string | null;
};

/**
 * 树图本地坐标。
 * 仅用于前端视图布局，不进入正式剧情 schema。
 */
export type PlotPreviewTreePosition = {
    x: number;
    y: number;
};

/**
 * 树图本地布局状态。
 * 这些状态需要在切视图时保留，因此由工作区托管。
 */
export type PlotPreviewTreeLayoutState = {
    collapsedPhaseIds: string[];
    threadPositions: Record<string, PlotPreviewTreePosition>;
    scenePositions: Record<string, PlotPreviewTreePosition>;
};

/**
 * 当前选中对象摘要。
 */
export type PlotPreviewFocus = {
    kind: "story" | "phase" | "thread" | "scene" | "chapter";
    title: string;
    summary: string;
    meta: string[];
    refs: PlotPreviewRef[];
    writingTip: string | null;
};

/**
 * 线程色板样式。
 */
export const PLOT_TONE_STYLES: Record<PlotPreviewTone, {
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
 * Thread 状态中文标签。
 */
export const PLOT_THREAD_STATUS_LABELS: Record<PlotPreviewThread["status"], string> = {
    draft: "草稿",
    active: "进行中",
    paused: "暂停",
    done: "完成",
};

/**
 * Scene 状态中文标签。
 */
export const PLOT_SCENE_STATUS_LABELS: Record<PlotPreviewScene["status"], string> = {
    draft: "草稿",
    active: "进行中",
    written: "已成稿",
    revised: "已修订",
};
