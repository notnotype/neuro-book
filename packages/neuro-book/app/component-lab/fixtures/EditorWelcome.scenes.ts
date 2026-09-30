import type EditorWelcome from "../../components/editor-workbench/EditorWelcome.vue";
import type {EditorTabPresentation} from "../../components/editor-workbench/editor-view.types";
import type {WorkspaceFileNode} from "../../stores/novel-ide";
import type {LabFixtureDefinition} from "./index";

/**
 * 节点常量写全字段并用 `satisfies` 而不是 `as`：WorkspaceFileNode 是磁盘扫描结果的原样投影，
 * 少写一个字段只会让夹具的输入与真实宿主不同，而 `as` 会把这种缺失静默吞掉。
 */
const chapterNode = {
    mode: "-rw-r--r--",
    entryType: null,
    icon: "file-text",
    status: null,
    words: 42,
    refs: [],
    path: "manuscript/volume-1/chapter-01.md",
    absolutePath: "/lab/workspace/destiny-poem/manuscript/volume-1/chapter-01.md",
    isDirectory: false,
    hasIndex: false,
    contentNode: false,
    summary: "卷首章节：主角在退潮的码头等一艘不会来的船。",
    title: "第一章 退潮",
    frontmatter: {title: "第一章 退潮", status: "draft", order: 1},
    frontmatterError: null,
    state: {
        path: "manuscript/volume-1/chapter-01.md",
        absolutePath: "/lab/workspace/destiny-poem/manuscript/volume-1/chapter-01.md",
        exists: true,
        frontmatter: {title: "第一章 退潮", status: "draft", order: 1},
        frontmatterError: null,
        body: "潮水退到最低处时，码头只剩下一排湿漉漉的桩子。\n\n他把第十一封信折好，塞回大衣内袋。\n",
        words: 42,
    },
    size: 5120,
    mtimeMs: 1758000000000,
    editable: true,
} satisfies WorkspaceFileNode;

// 用户资产工作区：根就是 Workspace Root 的 .nbook，所以相对路径从 agent/ 起算。
const assetNode = {
    mode: "-rw-r--r--",
    entryType: null,
    icon: "file-text",
    status: null,
    words: 58,
    refs: [],
    path: "agent/skills/style-guide/SKILL.md",
    absolutePath: "/lab/workspace/.nbook/agent/skills/style-guide/SKILL.md",
    isDirectory: false,
    hasIndex: false,
    contentNode: false,
    summary: "素材库里的行文口吻约定。",
    title: "style-guide",
    frontmatter: {name: "style-guide", description: "统一行文口吻"},
    frontmatterError: null,
    state: {
        path: "agent/skills/style-guide/SKILL.md",
        absolutePath: "/lab/workspace/.nbook/agent/skills/style-guide/SKILL.md",
        exists: true,
        frontmatter: {name: "style-guide", description: "统一行文口吻"},
        frontmatterError: null,
        body: "# 行文口吻\n\n短句优先，避免形容词堆叠。\n",
        words: 58,
    },
    size: 768,
    mtimeMs: 1757913600000,
    editable: true,
} satisfies WorkspaceFileNode;

// 不可编辑：二进制资产没有 state 快照，也解不出 entryType，所以只读卡片会把 type 显示成 "-"。
const binaryNode = {
    mode: "-rw-r--r--",
    entryType: null,
    icon: "file-question",
    status: null,
    words: 0,
    refs: [],
    path: "references/scans/tide-chart.png",
    absolutePath: "/lab/workspace/destiny-poem/references/scans/tide-chart.png",
    isDirectory: false,
    hasIndex: false,
    contentNode: false,
    summary: "",
    title: "tide-chart.png",
    frontmatter: {},
    frontmatterError: null,
    state: null,
    size: 2411724,
    mtimeMs: 1757412000000,
    editable: false,
} satisfies WorkspaceFileNode;

// 标签是展示投影：pinned 与 preview 互斥（真实 store 里钉住的标签不再是预览标签），所以第一个是 pinned + dirty。
const recentTabs: EditorTabPresentation[] = [
    {path: "manuscript/volume-1/chapter-01.md", title: "第一章 退潮", pinned: true, preview: false, dirty: true, iconClass: "i-lucide-file-text"},
    {path: "manuscript/volume-1/chapter-02.md", title: "第二章 灯塔", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-text"},
    {path: "lorebook/character/shen-yu/index.md", title: "沈屿", pinned: true, preview: false, dirty: false, iconClass: "i-lucide-user-round"},
    {path: "lorebook/location/tide-gate/index.md", title: "潮门", pinned: false, preview: true, dirty: false, iconClass: "i-lucide-map-pinned"},
];

const fiveTabs: EditorTabPresentation[] = [
    {path: "manuscript/volume-1/chapter-01.md", title: "第一章 退潮", pinned: true, preview: false, dirty: false, iconClass: "i-lucide-file-text"},
    {path: "manuscript/volume-1/chapter-02.md", title: "第二章 灯塔", pinned: true, preview: false, dirty: false, iconClass: "i-lucide-file-text"},
    {path: "manuscript/volume-1/chapter-03.md", title: "第三章 盐与铁", pinned: false, preview: false, dirty: true, iconClass: "i-lucide-file-text"},
    {path: "lorebook/character/shen-yu/index.md", title: "沈屿", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-user-round"},
    {path: "lorebook/location/tide-gate/index.md", title: "潮门", pinned: false, preview: true, dirty: false, iconClass: "i-lucide-map-pinned"},
];

const sceneViews: Record<"novel-empty" | "novel-recent" | "user-assets" | "compact" | "readonly-node", {node: WorkspaceFileNode; tabs: EditorTabPresentation[]; compact: boolean; workspaceMode: "novel" | "user-assets"}> = {
    "novel-empty": {node: chapterNode, tabs: [], compact: false, workspaceMode: "novel"},
    "novel-recent": {node: chapterNode, tabs: recentTabs, compact: false, workspaceMode: "novel"},
    "user-assets": {node: assetNode, tabs: [], compact: false, workspaceMode: "user-assets"},
    "compact": {node: chapterNode, tabs: fiveTabs, compact: true, workspaceMode: "novel"},
    // 只读分支压过最近标签：node 不可编辑时整块欢迎页与标签列表都不出现，所以这里故意带着标签。
    "readonly-node": {node: binaryNode, tabs: recentTabs, compact: false, workspaceMode: "novel"},
};

export const editorWelcomeScenes = [
    {id: "novel-empty", label: "小说工作区无标签（快捷动作）", input: {props: sceneViews["novel-empty"]}},
    {id: "novel-recent", label: "有最近标签（主按钮变继续）", input: {props: sceneViews["novel-recent"]}},
    {id: "user-assets", label: "素材库工作区", input: {props: sceneViews["user-assets"]}},
    {id: "compact", label: "紧凑档（只显示前 3 个标签）", input: {props: sceneViews.compact}},
    {id: "readonly-node", label: "节点不可编辑", input: {props: sceneViews["readonly-node"]}},
] satisfies LabFixtureDefinition<typeof EditorWelcome>["scenes"];
