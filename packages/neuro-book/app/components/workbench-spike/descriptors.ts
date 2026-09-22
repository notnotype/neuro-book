/**
 * 迷你工作台的 descriptor 表。字段名与语义取自 docs/proposals/workbench-view-host.md 的 descriptor 表。
 * 本文件只放**声明**：不实例化组件、不读存储、不发请求。
 */
export type ViewLayoutMode = "scroll" | "fill";
export type ViewWhen = {requires?: Array<"project" | "selection">};
export type ViewAuthority = "project" | "session" | "job" | "files";

export type SpikeViewDescriptor = {
    id: string;
    titleKey: string;
    icon: string;
    container: string;
    layout: ViewLayoutMode;
    when?: ViewWhen;
    requiredAuthority?: ViewAuthority[];
    order: number;
    weight?: number;
    canToggleVisibility: boolean;
    canMoveView: boolean;
    factoryKey: string;
    stateScope: "user" | "project" | "session";
};

export type SpikeContainerDescriptor = {
    id: string;
    titleKey: string;
    icon: string;
    /** 容器默认位置：主侧栏 / 右侧栏 / 面板 */
    location: "sidebar-left" | "sidebar-right" | "panel";
};

/** 路由仅存在于源码开发环境，因此标签用本地映射，不新增产品 locale 键。 */
export const SPIKE_LABELS: Record<string, string> = {
    "spike.container.explorer": "主侧栏容器",
    "spike.container.search": "搜索容器",
    "spike.container.inspector": "右侧栏容器",
    "spike.container.panel": "面板容器",
    "spike.view.files": "文件",
    "spike.view.outline": "大纲",
    "spike.view.characters": "角色",
    "spike.view.search": "搜索",
    "spike.view.recent": "最近打开",
    "spike.view.trace": "请求轨迹",
    "spike.view.jobs": "任务",
    "spike.view.problems": "问题",
    "spike.view.broken": "坏 factory",
};

export function labelOf(key: string): string {
    return SPIKE_LABELS[key] ?? key;
}

/** 视图可否跨容器移动：拖拽起点（`draggable`）与落账校验共用这一条判据，不允许两处各写一遍。 */
export function canMoveView(view: SpikeViewDescriptor): boolean {
    return view.canMoveView === true;
}

/** 每个位置可以按声明顺序放多个容器（活动栏逐个按钮，点击切换该位置显示哪个）。 */
export const SPIKE_CONTAINERS: SpikeContainerDescriptor[] = [
    {id: "spike.explorer", titleKey: "spike.container.explorer", icon: "i-lucide-files", location: "sidebar-left"},
    {id: "spike.search", titleKey: "spike.container.search", icon: "i-lucide-search", location: "sidebar-left"},
    {id: "spike.inspector", titleKey: "spike.container.inspector", icon: "i-lucide-panel-right", location: "sidebar-right"},
    {id: "spike.panel.problems", titleKey: "spike.container.panel", icon: "i-lucide-alert-triangle", location: "panel"},
];

export const SPIKE_VIEWS: SpikeViewDescriptor[] = [
    {id: "spike.files", titleKey: "spike.view.files", icon: "i-lucide-file-text", container: "spike.explorer", layout: "scroll", when: {requires: ["project"]}, requiredAuthority: ["files"], order: 10, weight: 1, canToggleVisibility: true, canMoveView: true, factoryKey: "spike.view.files", stateScope: "user"},
    {id: "spike.outline", titleKey: "spike.view.outline", icon: "i-lucide-list-tree", container: "spike.explorer", layout: "scroll", requiredAuthority: ["project"], order: 20, weight: 1, canToggleVisibility: true, canMoveView: true, factoryKey: "spike.view.outline", stateScope: "user"},
    {id: "spike.characters", titleKey: "spike.view.characters", icon: "i-lucide-users", container: "spike.explorer", layout: "fill", when: {requires: ["project", "selection"]}, order: 30, weight: 1, canToggleVisibility: true, canMoveView: false, factoryKey: "spike.view.characters", stateScope: "project"},
    {id: "spike.search", titleKey: "spike.view.search", icon: "i-lucide-search", container: "spike.search", layout: "fill", order: 10, weight: 1, canToggleVisibility: true, canMoveView: true, factoryKey: "spike.view.search", stateScope: "user"},
    {id: "spike.recent", titleKey: "spike.view.recent", icon: "i-lucide-history", container: "spike.search", layout: "scroll", order: 20, weight: 1, canToggleVisibility: true, canMoveView: true, factoryKey: "spike.view.recent", stateScope: "user"},
    {id: "spike.trace", titleKey: "spike.view.trace", icon: "i-lucide-activity", container: "spike.inspector", layout: "scroll", requiredAuthority: ["session"], order: 10, weight: 1, canToggleVisibility: true, canMoveView: true, factoryKey: "spike.view.trace", stateScope: "session"},
    {id: "spike.jobs", titleKey: "spike.view.jobs", icon: "i-lucide-list-checks", container: "spike.inspector", layout: "fill", requiredAuthority: ["job"], order: 20, weight: 1, canToggleVisibility: true, canMoveView: true, factoryKey: "spike.view.jobs", stateScope: "user"},
    {id: "spike.problems", titleKey: "spike.view.problems", icon: "i-lucide-circle-alert", container: "spike.panel.problems", layout: "scroll", order: 10, weight: 1, canToggleVisibility: true, canMoveView: true, factoryKey: "spike.view.problems", stateScope: "user"},
    {id: "spike.broken", titleKey: "spike.view.broken", icon: "i-lucide-unplug", container: "spike.inspector", layout: "scroll", order: 30, weight: 1, canToggleVisibility: true, canMoveView: true, factoryKey: "spike.broken", stateScope: "user"},
];
