/**
 * w00058 t01 资源管理器静态稿的样本：按已定的注意力排序（Task README 的“决定”第 4 行）摆出八个根。行是写死的，
 * 不接文件服务；产品里的行由树模型按列出结果投影（explorer/web/tree/rows.ts）。
 */
import type {CatppuccinIcon} from "nbook/ui/file-icons/catppuccin";

export type DraftRow =
    | {readonly kind: "root"; readonly id: string; readonly label: string; readonly scheme: string; readonly expanded: boolean; readonly readonly?: boolean}
    | {readonly kind: "divider"; readonly id: string}
    | {
        readonly kind: "entry";
        readonly id: string;
        readonly depth: number;
        readonly label: string;
        /** 文件图标；会话一层用 `session`，由草稿按候选画。 */
        readonly icon: CatppuccinIcon | "session";
        readonly expandable?: boolean;
        readonly expanded?: boolean;
        readonly subtitle?: string;
        /** 当前对话的会话、当前 Profile。 */
        readonly current?: boolean;
        readonly readonly?: boolean;
        /** 字色调淡（`session.jsonl`）。 */
        readonly dim?: boolean;
        readonly selected?: boolean;
    }
    | {readonly kind: "more"; readonly id: string; readonly depth: number; readonly label: string}
    | {readonly kind: "empty"; readonly id: string; readonly depth: number; readonly label: string};

export type DraftScene = "overview" | "sessions-few" | "temps-empty" | "profiles" | "readonly";

const root = (scheme: string, label: string, expanded = false, readonly = false): DraftRow => ({kind: "root", id: `${scheme}://`, label, scheme, expanded, readonly});
const divider = (id: string): DraftRow => ({kind: "divider", id});

const PROJECT: DraftRow[] = [
    root("project", "雾港钟声", true),
    {kind: "entry", id: "p-text", depth: 1, label: "正文", icon: "folder-content-open", expandable: true, expanded: true},
    {kind: "entry", id: "p-1", depth: 2, label: "第一章 雾起", icon: "markdown"},
    {kind: "entry", id: "p-2", depth: 2, label: "第二章 旧钟", icon: "markdown"},
    {kind: "entry", id: "p-3", depth: 2, label: "第三章 雨夜", icon: "markdown"},
    {kind: "entry", id: "p-lore", depth: 1, label: "设定", icon: "folder-docs", expandable: true},
    {kind: "entry", id: "p-outline", depth: 1, label: "大纲.md", icon: "markdown"},
];

const RECENT = ["伏笔检查", "人物关系梳理", "查第五章的错别字", "统一人物称谓", "雨夜那场改写", "第二卷大纲", "未命名会话", "港口地图草图", "对白口吻校对", "章节标题候选"];

/** 当前会话展开到 `home/`：`home/` 在前并连带展开，`session.jsonl` 调淡、只读。 */
const currentSession = (selectedPlan: boolean): DraftRow[] => [
    {kind: "entry", id: "s-cur", depth: 1, label: "第三章节奏调整", icon: "session", expandable: true, expanded: true, current: true},
    {kind: "entry", id: "s-cur-home", depth: 2, label: "home", icon: "folder-open", expandable: true, expanded: true},
    {kind: "entry", id: "s-cur-plan", depth: 3, label: "plan.md", icon: "markdown", selected: selectedPlan},
    {kind: "entry", id: "s-cur-draft", depth: 3, label: "第三章改写稿.md", icon: "markdown"},
    {kind: "entry", id: "s-cur-art", depth: 3, label: "artifacts", icon: "folder", expandable: true},
    {kind: "entry", id: "s-cur-att", depth: 3, label: "attachments", icon: "folder-images", expandable: true},
    {kind: "entry", id: "s-cur-log", depth: 2, label: "session.jsonl", icon: "json", readonly: true, dim: true},
];

const sessions = (count: number, more: number | null, selectedPlan: boolean): DraftRow[] => [
    root("sessions", "会话", true),
    ...currentSession(selectedPlan),
    ...RECENT.slice(0, count).map((label, index): DraftRow => ({kind: "entry", id: `s-${String(index)}`, depth: 1, label, icon: "session", expandable: true})),
    ...(more === null ? [] : [{kind: "more", id: "s-more", depth: 1, label: `显示更多（还有 ${String(more)} 个）`} as const]),
];

const AGENT_REST = (profilesOpen: boolean, tempsOpen: "collapsed" | "empty" | "current"): DraftRow[] => [
    root("profiles", "Profile 笔记", profilesOpen),
    ...(profilesOpen
        ? [
            {kind: "entry", id: "pr-lyra", depth: 1, label: "星璃", icon: "folder", expandable: true, current: true},
            {kind: "entry", id: "pr-writer", depth: 1, label: "写手", icon: "folder", expandable: true},
            {kind: "entry", id: "pr-review", depth: 1, label: "审稿", icon: "folder", expandable: true},
        ] satisfies DraftRow[]
        : []),
    root("temps", "临时文件", tempsOpen !== "collapsed"),
    ...(tempsOpen === "empty" ? [{kind: "empty", id: "t-empty", depth: 1, label: "没有临时文件"} as const] : []),
    ...(tempsOpen === "current"
        ? [
            {kind: "entry", id: "t-cur", depth: 1, label: "第三章节奏调整", icon: "session", expandable: true, current: true},
            {kind: "entry", id: "t-1", depth: 1, label: "港口地图草图", icon: "session", expandable: true},
        ] satisfies DraftRow[]
        : []),
];

const REFERENCE = (open: boolean): DraftRow[] => [
    root("skills", "Skill", open, true),
    ...(open
        ? [
            {kind: "entry", id: "sk-1", depth: 1, label: "伏笔追踪", icon: "folder", expandable: true},
            {kind: "entry", id: "sk-2", depth: 1, label: "章节体检", icon: "folder", expandable: true},
        ] satisfies DraftRow[]
        : []),
    root("stickers", "表情", false, true),
    root("docs", "文档", false, true),
];

export function rowsOf(scene: DraftScene): DraftRow[] {
    const work = [...PROJECT, root("user", "用户资产")];
    switch (scene) {
        case "overview":
            return [...work, divider("d1"), ...sessions(10, 37, true), ...AGENT_REST(false, "collapsed"), divider("d2"), ...REFERENCE(false)];
        case "sessions-few":
            return [...work, divider("d1"), ...sessions(3, null, true), ...AGENT_REST(false, "collapsed"), divider("d2"), ...REFERENCE(false)];
        case "temps-empty":
            return [root("project", "雾港钟声"), root("user", "用户资产"), divider("d1"), root("sessions", "会话"), ...AGENT_REST(false, "empty"), divider("d2"), ...REFERENCE(false)];
        case "profiles":
            return [root("project", "雾港钟声"), root("user", "用户资产"), divider("d1"), root("sessions", "会话"), ...AGENT_REST(true, "current"), divider("d2"), ...REFERENCE(false)];
        case "readonly":
            return [root("project", "雾港钟声"), root("user", "用户资产"), divider("d1"), root("sessions", "会话", true), ...currentSession(false), root("profiles", "Profile 笔记"), root("temps", "临时文件"), divider("d2"), ...REFERENCE(true)];
    }
}
