<script setup lang="ts">
import {computed, ref, watch} from "vue";
import EditorWelcome from "nbook/app/components/editor-workbench/EditorWelcome.vue";
import type {EditorTabPresentation} from "nbook/app/components/editor-workbench/editor-view.types";
import type {WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import {useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();

type SceneKey = "novel-empty" | "novel-recent" | "user-assets" | "compact" | "readonly-node";

type SceneView = Readonly<{
    node: WorkspaceFileNode | null;
    tabs: EditorTabPresentation[];
    compact: boolean;
    workspaceMode: "novel" | "user-assets";
}>;

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

const sceneViews: Record<SceneKey, SceneView> = {
    "novel-empty": {node: chapterNode, tabs: [], compact: false, workspaceMode: "novel"},
    "novel-recent": {node: chapterNode, tabs: recentTabs, compact: false, workspaceMode: "novel"},
    "user-assets": {node: assetNode, tabs: [], compact: false, workspaceMode: "user-assets"},
    "compact": {node: chapterNode, tabs: fiveTabs, compact: true, workspaceMode: "novel"},
    // 只读分支压过最近标签：node 不可编辑时整块欢迎页与标签列表都不出现，所以这里故意带着标签。
    "readonly-node": {node: binaryNode, tabs: recentTabs, compact: false, workspaceMode: "novel"},
};

const lastEvent = ref("（还没有事件）");

// 切场景就把本地状态清干净：同一场景重复打开、或在右栏还原数据后，看到的必须是同一件事。
watch(() => props.scene, applyScene, {immediate: true});

function applyScene(): void {
    lastEvent.value = "（还没有事件）";
}

function isSceneKey(value: string): value is SceneKey {
    return Object.hasOwn(sceneViews, value);
}

const sceneKey = computed<SceneKey>(() => isSceneKey(props.scene) ? props.scene : "novel-empty");

/**
 * 右栏数据面板给的是 JSON，不是校验过的对象：这里只认夹具关心的四个键，
 * 缺项交回场景初值，写坏的项被忽略而不是让整个场景变空白。
 */
function readSceneData(value: unknown): Partial<SceneView> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const raw = value as Record<string, unknown>;
    return {
        node: raw.node === undefined ? undefined : raw.node === null ? null : raw.node as WorkspaceFileNode,
        tabs: Array.isArray(raw.tabs) ? raw.tabs.map(readTab) : undefined,
        compact: typeof raw.compact === "boolean" ? raw.compact : undefined,
        workspaceMode: raw.workspaceMode === "user-assets" ? "user-assets" : raw.workspaceMode === "novel" ? "novel" : undefined,
    };
}

function readTab(value: unknown): EditorTabPresentation {
    const raw = (value ?? {}) as Record<string, unknown>;
    return {
        path: String(raw.path ?? ""),
        title: String(raw.title ?? ""),
        pinned: Boolean(raw.pinned),
        preview: Boolean(raw.preview),
        dirty: Boolean(raw.dirty),
        iconClass: typeof raw.iconClass === "string" ? raw.iconClass : "i-lucide-file-text",
    };
}

const view = computed<SceneView>(() => {
    const fallback = sceneViews[sceneKey.value];
    const data = readSceneData(props.data);
    return {
        node: data.node === undefined ? fallback.node : data.node,
        tabs: data.tabs ?? fallback.tabs,
        compact: data.compact ?? fallback.compact,
        workspaceMode: data.workspaceMode ?? fallback.workspaceMode,
    };
});

/** 事件名与载荷一起显示：主按钮落在「继续 X」还是「新建章节」，只有载荷看得出来。 */
function forward(name: string, payload?: unknown): void {
    lastEvent.value = payload === undefined ? name : `${name} ${JSON.stringify(payload)}`;
    emitLabEvent(name, payload);
}
</script>

<template>
    <div class="flex h-full min-h-0 min-w-0 flex-col">
        <EditorWelcome
            data-lab-subject
            :node="view.node"
            :tabs="view.tabs"
            :compact="view.compact"
            :workspace-mode="view.workspaceMode"
            class="min-h-0 flex-1"
            @select-tab="(path: string) => forward('select-tab', path)"
            @open-path="(path: string) => forward('open-path', path)"
            @open-files="forward('open-files')"
            @create-chapter="forward('create-chapter')"
            @create-markdown-file="forward('create-markdown-file')"
            @create-lorebook-entry="forward('create-lorebook-entry')"
            @open-agent-panel="forward('open-agent-panel')"
            @open-profile-workbench="forward('open-profile-workbench')"
        />
        <p class="shrink-0 border-t border-[var(--divider)] px-3 py-2 font-mono text-xs text-[var(--text-muted)]">
            最近事件：{{ lastEvent }}
        </p>
    </div>
</template>
