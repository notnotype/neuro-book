import type {Edge, Node} from "@vue-flow/core";

/**
 * 树图使用的线程色带。
 */
export type PlotTreeTone = "amber" | "sky" | "emerald" | "rose";

/**
 * 树图场景分支角色。
 */
export type PlotTreeBranchRole = "main" | "side";

/**
 * 树图坐标。
 * 在原型阶段，它是前端 draft graph 的真相源。
 */
export type PlotTreePosition = {
    x: number;
    y: number;
};

/**
 * 树图的整书级摘要。
 */
export type PlotTreeStory = {
    id: string;
    title: string;
    summary: string;
    // 为空表示使用默认的“主线开始”文案。
    startLabel: string | null;
};

/**
 * 树图里的线程组。
 */
export type PlotTreeThread = {
    id: string;
    title: string;
    summary: string;
    status: string;
    isMainThread: boolean;
    tone: PlotTreeTone;
    position: PlotTreePosition;
};

/**
 * 树图里的场景节点。
 * `threadId = null` 表示游离 Scene。
 * `position` 在归属 Thread 时为 group 内局部坐标；游离时为画布绝对坐标。
 */
export type PlotTreeScene = {
    id: string;
    threadId: string | null;
    title: string;
    summary: string;
    status: string;
    // 为空表示当前场景尚未挂章。
    chapterLabel: string | null;
    // `null` 表示当前 Scene 没有连线来源。
    // `plot-root-start` 表示该 Scene 直接从根节点起步。
    // 其他值表示来源 Scene 的 id。
    sourceId: string | null;
    // `true` 表示 fork 后这一支仍属于主线分支。
    isMainBranch: boolean;
    position: PlotTreePosition;
};

/**
 * PlotTreeView 的正式输入模型。
 * 当前只关注 Thread / Scene 级别，不再引入 StoryPhase 子图。
 */
export type PlotTreeGraph = {
    story: PlotTreeStory;
    threads: PlotTreeThread[];
    scenes: PlotTreeScene[];
};

/**
 * 树图最小选择态。
 */
export type PlotTreeSelectionState = {
    selectedThreadId: string | null;
    selectedSceneId: string | null;
};

/**
 * 线程组节点的统计信息。
 */
export type PlotTreeThreadMetrics = {
    width: number;
    height: number;
    sceneCount: number;
    mainBranchSceneCount: number;
};

/**
 * 节点级操作回调。
 */
export type PlotTreeNodeActions = {
    addScene(threadId: string): void;
    deleteThread(threadId: string): void;
    addChildScene(sceneId: string): void;
    toggleSceneBranch(sceneId: string): void;
    detachScene(sceneId: string): void;
    deleteScene(sceneId: string): void;
};

/**
 * 主线起点节点的数据。
 */
export type PlotTreeRootNodeData = {
    kind: "root";
    title: string;
    subtitle: string;
    threadCount: number;
    sceneCount: number;
};

/**
 * 线程组节点的数据。
 */
export type PlotTreeThreadNodeData = {
    kind: "thread";
    thread: PlotTreeThread;
    metrics: PlotTreeThreadMetrics;
    editable: boolean;
    actions: PlotTreeNodeActions;
};

/**
 * 场景节点的数据。
 */
export type PlotTreeSceneNodeData = {
    kind: "scene";
    scene: PlotTreeScene;
    // 为空表示当前是游离 Scene。
    thread: PlotTreeThread | null;
    branchRole: PlotTreeBranchRole;
    childCount: number;
    editable: boolean;
    actions: PlotTreeNodeActions;
};

/**
 * 树图节点的数据联合类型。
 */
export type PlotTreeGraphNodeData =
    | PlotTreeRootNodeData
    | PlotTreeThreadNodeData
    | PlotTreeSceneNodeData;

/**
 * 树图边的数据。
 */
export type PlotTreeEdgeData = {
    kind: "start" | "scene";
    branchRole: PlotTreeBranchRole;
};

/**
 * 树图节点类型。
 */
export type PlotTreeFlowNodeType = "plot-root" | "plot-thread" | "plot-scene";

/**
 * 树图节点类型别名。
 */
export type PlotTreeFlowNode = Node<PlotTreeGraphNodeData, Record<string, never>, PlotTreeFlowNodeType>;

/**
 * 树图边类型别名。
 */
export type PlotTreeFlowEdge = Edge<PlotTreeEdgeData>;

/**
 * 色带样式。
 */
export const PLOT_TREE_TONE_STYLES: Record<PlotTreeTone, {
    border: string;
    bg: string;
    chip: string;
    text: string;
    minimap: string;
}> = {
    amber: {
        border: "border-amber-500/40",
        bg: "bg-amber-500/10",
        chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
        text: "text-amber-700 dark:text-amber-300",
        minimap: "#f59e0b",
    },
    sky: {
        border: "border-sky-500/40",
        bg: "bg-sky-500/10",
        chip: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
        text: "text-sky-700 dark:text-sky-300",
        minimap: "#0ea5e9",
    },
    emerald: {
        border: "border-emerald-500/40",
        bg: "bg-emerald-500/10",
        chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
        text: "text-emerald-700 dark:text-emerald-300",
        minimap: "#10b981",
    },
    rose: {
        border: "border-rose-500/40",
        bg: "bg-rose-500/10",
        chip: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
        text: "text-rose-700 dark:text-rose-300",
        minimap: "#f43f5e",
    },
};

/**
 * 游离 Scene 的默认视觉样式。
 */
export const PLOT_TREE_ORPHAN_SCENE_STYLE = {
    border: "border-slate-400/45",
    chip: "bg-slate-500/12 text-slate-600 dark:text-slate-300",
    minimap: "#64748b",
};

/**
 * 特殊的主线开始节点 id。
 */
export const PLOT_TREE_ROOT_NODE_ID = "plot-root-start";

/**
 * 根节点默认文案。
 */
export const DEFAULT_PLOT_TREE_START_LABEL = "主线开始";

/**
 * 线程组默认尺寸。
 */
export const PLOT_TREE_THREAD_LAYOUT = {
    minWidth: 540,
    minHeight: 220,
    paddingRight: 36,
    paddingBottom: 28,
};

/**
 * Scene 卡片的视觉尺寸。
 */
export const PLOT_TREE_SCENE_CARD = {
    width: 224,
    height: 160,
};

/**
 * 自动布局使用的全局尺寸。
 */
export const PLOT_TREE_LAYOUT = {
    rootX: 24,
    rootY: 108,
    threadX: 260,
    threadStartY: 88,
    threadGapY: 380,
    threadSceneX: 28,
    threadSceneY: 96,
    sceneGapX: 248,
    orphanStartX: 200,
    orphanStartY: 580,
    orphanGapY: 196,
};

/**
 * 计算场景的分支角色。
 */
export function resolvePlotTreeBranchRole(scene: PlotTreeScene): PlotTreeBranchRole {
    return scene.isMainBranch ? "main" : "side";
}
