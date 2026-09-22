<script setup lang="ts">
/**
 * EditorWorkbench 的 Lab 场景装配。
 *
 * 演示重点：
 * 1. 真实受控外壳：消费真实 EditorTabBar 与 EditorToolbar，不接 Pinia store、不发起网络与磁盘 I/O；
 * 2. 多种标签状态拓扑：固定标签组、普通标签组、未保存脏标记、斜体预览标签、长标题单行截断与横向滚动；
 * 3. 完整受控生命周期：切换标签、右键上下文菜单、关闭标签、未保存修改退出拦截与确认/取消；
 * 4. 忙碌遮罩与诊断横幅：busy 遮罩保留下层实例与正文不卸载，诊断信息提供重试与以源码打开；
 * 5. 真实注册表与多视图同一正文：通过 mock-views 接入源码 (code)、Markdown 富文本 (markdown)
 *    以及第三注册视图 (test.preview)，在同一文档快照下切换不同呈现与操作，正文毫发无损；
 * 6. 语义化插槽与无障碍：tabpanel 与 roving tabindex 焦点管理；
 * 7. 高级分屏布局树：支持单次分屏与二次/多次分屏（1 -> 2 -> 3 -> 4 组），跨分屏拖拽与自动提升。
 */
import {computed, onMounted, provide, reactive, ref, shallowRef, watch} from "vue";
import type {MenubarItemData, MenubarMenuData} from "@notnotype/nb-ui/components";
import EditorWorkbench from "nbook/app/components/editor-workbench/EditorWorkbench.vue";
import EditorWelcome from "nbook/app/components/editor-workbench/EditorWelcome.vue";
import EditorViewHost from "nbook/app/components/editor-workbench/EditorViewHost.vue";
import WorkbenchStatusBar from "nbook/app/components/workbench/WorkbenchStatusBar.vue";
import WorkbenchStatusBarItem from "nbook/app/components/workbench/WorkbenchStatusBarItem.vue";
import LabFixtureControls from "../LabFixtureControls.vue";
import type {
    EditorChangeRequest,
    EditorChangeResult,
    EditorDocumentSnapshot,
    EditorDocumentTarget,
    EditorGroupState,
    EditorResource,
    EditorSplitDirection,
    EditorTabDropPosition,
    EditorTabPresentation,
    EditorViewHandle,
} from "nbook/app/components/editor-workbench/editor-view.types";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";
import {buildLabRegistry} from "./editor-workbench/mock-views";
import EditorWorkbenchCloseConfirm from "./editor-workbench/EditorWorkbenchCloseConfirm.vue";
import type {EditorSplitPayload, TabTransferPayload} from "nbook/app/components/editor-workbench/editor-intents";
import {DEFAULT_CONTENTS, SCENE_TABS} from "./editor-workbench/fixture-data";
import {createGrid, type Grid, type GridExtent, type GridGestureCommit, type GridLayoutResult, type GridNode} from "@notnotype/nb-ui/components";
import {
    applyEditorGesture,
    createEditorGrid,
    editorGroupIds,
    removeEditorGroup,
    splitEditorGroup,
} from "nbook/app/utils/editor-workbench/editor-groups";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();
const updateLabData = useLabDataSink();

const LAB_REGISTRY = buildLabRegistry();

const busy = ref<boolean>(false);
const diagnosis = ref<string | null>(null);
const currentEditorId = ref<string>("code");
const documentContents = reactive<Record<string, string>>({...DEFAULT_CONTENTS});
/** 每份文档的权威修订：夹具按基线判 accepted/conflict，与真实 Store 的输入回执同形。 */
const documentRevisions = reactive<Record<string, number>>({});
const closeConfirmTab = ref<EditorTabPresentation | null>(null);
const closeConfirmGroupId = ref<string>("primary");
const showComments = ref(true);
const activeViewHandle = shallowRef<EditorViewHandle | null>(null);

const groups = ref<EditorGroupState[]>([]);
const activeGroupId = ref("primary");
/** Lab 自持布局树与会话内尺寸：产品页由页面/组合函数持有，两者都不写任何记录。 */
const editorGrid = ref<Grid<string>>(createEditorGrid("primary"));
const layoutTree = ref<GridNode<string> | null>(null);
const layout = ref<GridLayoutResult>(editorGrid.value.layout({width: 0, height: 0}));
const editorExtent = ref<GridExtent>({width: 0, height: 0});
let groupCounter = 1;
/**
 * 外部版本：树被换掉（场景重置 / 分屏 / 关组）或内容区尺寸变化时递增。`EditorWorkbench` 把它
 * 原样冻结进手势会话，提交时复核——进行中的手势不会沿旧基线写进新上下文。
 */
const layoutRevision = ref(0);

/** 场景会话内单调的草稿序号；路径确认空闲后才写正文，因此移动/关闭标签不会让草稿复用旧身份。 */
let draftSequence = 0;

const SPLIT_DIRECTIONS: readonly EditorSplitDirection[] = ["left", "right", "top", "bottom"];

/** 分屏方向是产品词：载荷里的任何其它值都必须拒绝，不能落进几何映射的缺省分支。 */
function isSplitDirection(value: unknown): value is EditorSplitDirection {
    return typeof value === "string" && (SPLIT_DIRECTIONS as readonly string[]).includes(value);
}

/** 草稿序号 → 路径（两位补零，保持 Lab 既有命名）。 */
function draftPathOf(serial: number): string {
    return `src/draft/note-${String(serial).padStart(2, "0")}.md`;
}

/** 下一个空闲草稿序号：同时避开所有组的标签与既有正文占用，冲突就继续递增。 */
function nextDraftSerial(): number {
    const occupied = new Set<string>(Object.keys(documentContents));
    for (const group of groups.value) {
        for (const tab of group.tabs) {
            occupied.add(tab.path);
        }
    }
    for (;;) {
        draftSequence += 1;
        if (!occupied.has(draftPathOf(draftSequence))) {
            return draftSequence;
        }
    }
}

/** 组集合顺序必须等于布局树叶序；结构变化后统一过这一道，不靠 push 假定叶序。 */
function syncGroupOrder(): void {
    const byId = new Map(groups.value.map((group) => [group.id, group]));
    groups.value = editorGroupIds(editorGrid.value).flatMap((id) => {
        const group = byId.get(id);
        return group ? [group] : [];
    });
}

/** 空组塌陷后的组集合收口：摘掉该组，活动组落到相邻组（与产品的塌陷回落同一规则）。 */
function dropCollapsedGroup(groupId: string): void {
    const index = groups.value.findIndex((group) => group.id === groupId);
    groups.value = groups.value.filter((group) => group.id !== groupId);
    if (activeGroupId.value === groupId) {
        activeGroupId.value = groups.value[Math.min(Math.max(index - 1, 0), groups.value.length - 1)]?.id ?? "";
    }
}

/**
 * 几何候选树：结构变化（分屏 + 空源塌陷）先在独立树上全部跑通，通过后整体采纳。
 * 任一步失败都只丢弃候选，活树、组集合与正文一格不动——不发布半状态。
 *
 * `sashSize` 与 `createEditorGrid()` 保持一致；v2 快照只存结构与尺寸意图，运行约束由宿主给，
 * 而夹具的网格本来就没有额外约束，因此候选树与原树等价。
 */
function candidateTree(): Grid<string> | null {
    const candidate = createGrid<string>(null, {sashSize: 1});
    return candidate.restore(editorGrid.value.serialize(), (ref) => ({ref})).ok ? candidate : null;
}

/** 树或容器变了就重新发布呈现（测量来自 EditorWorkbench 的 container-extent）。 */
function recalcLayout(): void {
    layoutRevision.value += 1;
    layoutTree.value = editorGrid.value.root();
    layout.value = editorGrid.value.layout(editorExtent.value);
}

function setContainerExtent(extent: GridExtent): void {
    editorExtent.value = extent;
    recalcLayout();
}

/**
 * 一次分栏手势只走这一条路：`on-gesture-commit` 的同步 ack 里整批原子落账（`resizeBranches`），
 * 成功后重算呈现；Lab 不保存布局，只更新会话内几何。Lab 事件按 px 打点（`target`/`collapsed`），
 * 不再传百分比，也不再从 `gesture-start` 手工冻结基线。
 */
function onGestureCommit(commit: GridGestureCommit): {ok: true} | {ok: false; reason: string} {
    emitLabEvent("branch-gesture", {
        source: commit.source,
        changes: commit.changes.map((change) => ({
            branchId: change.branchId,
            axis: change.axis,
            active: [...change.active],
            target: {...change.target},
            collapsed: {...change.collapsed},
        })),
    });
    const applied = applyEditorGesture(editorGrid.value, commit);
    if (!applied.ok) {
        return applied;
    }
    recalcLayout();
    syncDataSink();
    return {ok: true};
}

/** 首个分支的方向（数据出口用）：树上几何词映射回产品词。 */
function splitDirectionOf(): EditorSplitDirection | null {
    const root = layoutTree.value;
    if (!root || root.kind !== "branch") return null;
    return root.orientation === "horizontal" ? "right" : "bottom";
}

const activeGroupPath = computed(() => getGroup(activeGroupId.value)?.activePath ?? "");

/** 组的外壳状态（菜单、忙碌、诊断）在 Lab 里是共享的：按组铺开交给外壳。 */
const displayGroups = computed<EditorGroupState[]>(() => groups.value.map((group) => ({
    ...group,
    menus: menus.value,
    busy: busy.value,
    diagnosis: diagnosis.value,
})));

const primaryGroup = computed(() => groups.value.find((g) => g.id === "primary") || groups.value[0]);
const tabs = computed<EditorTabPresentation[]>({
    get: () => primaryGroup.value?.tabs ?? [],
    set: (val) => {
        if (primaryGroup.value) primaryGroup.value.tabs = val;
    },
});
const activePath = computed<string>({
    get: () => primaryGroup.value?.activePath ?? "",
    set: (val) => {
        if (primaryGroup.value) primaryGroup.value.activePath = val;
    },
});

function getGroup(id: string): EditorGroupState | undefined {
    return groups.value.find((g) => g.id === id);
}

let lastEmittedJson = "";

/** 场景初值：全部校验通过后才发布，非法输入整份拒绝（不部分写内容、不伪造分屏）。 */
type SceneDraft = {
    tabs: EditorTabPresentation[];
    activePath: string;
    content: string | null;
    split: EditorSplitPayload | null;
};

/**
 * 自定义标签表的校验/归一：path 必须非空且组内唯一，任一不满足整份拒绝（返回 null）。
 * `preview` 与 `pinned` 互斥的收敛与产品恢复记录同规则。
 */
function normalizeSceneTabs(raw: readonly unknown[]): EditorTabPresentation[] | null {
    const seen = new Set<string>();
    const tabs: EditorTabPresentation[] = [];
    for (const entry of raw) {
        const item = (entry ?? {}) as Record<string, unknown>;
        const path = typeof item.path === "string" ? item.path : "";
        if (!path || seen.has(path)) {
            return null;
        }
        seen.add(path);
        const pinned = Boolean(item.pinned);
        tabs.push({
            path,
            title: typeof item.title === "string" && item.title ? item.title : path,
            pinned,
            preview: pinned ? false : Boolean(item.preview),
            dirty: Boolean(item.dirty),
            iconClass: typeof item.iconClass === "string" && item.iconClass ? item.iconClass : "i-lucide-file-text",
            statusText: typeof item.statusText === "string" ? item.statusText : undefined,
            description: typeof item.description === "string" ? item.description : undefined,
        });
    }
    return tabs;
}

/** 场景默认标签表（每次深拷一层，换场景不叠加上一次的写入）。 */
function sceneTabsOf(sceneId: string): EditorTabPresentation[] {
    return (SCENE_TABS[sceneId] ?? []).map((tab) => ({...tab}));
}

/**
 * 场景初值的整份校验：标签表（非空 path、组内唯一）、activePath 与分屏参数先全部核对，
 * 通过后才发布。任一非法（含与请求配对的正文）都整份拒绝：不写半份数据，也不回退到硬编码标签。
 */
function prepareScene(sceneId: string, rawData: Record<string, unknown>): SceneDraft {
    const tabs = Array.isArray(rawData.tabs) ? normalizeSceneTabs(rawData.tabs) : sceneTabsOf(sceneId);
    if (tabs === null) {
        const defaults = sceneTabsOf(sceneId);
        emitLabEvent("scene-rejected", {scene: sceneId, reason: "自定义标签表非法：存在空 path 或组内重复 path"});
        return {tabs: defaults, activePath: defaultActiveOf(defaults), content: null, split: null};
    }
    const requestedActive = typeof rawData.activePath === "string" ? rawData.activePath : null;
    const activeAccepted = requestedActive === null || tabs.some((tab) => tab.path === requestedActive);
    if (!activeAccepted) {
        emitLabEvent("active-path-rejected", {path: requestedActive, scene: sceneId});
    }
    const split = sceneSplitOf(rawData, tabs);
    return {
        tabs,
        activePath: activeAccepted && requestedActive !== null ? requestedActive : defaultActiveOf(tabs),
        content: activeAccepted && split !== undefined && typeof rawData.content === "string" ? rawData.content : null,
        split: activeAccepted ? split ?? null : null,
    };
}

/** 默认活动标签：优先既有的 chapter-02，否则第一个（没有标签就是空）。 */
function defaultActiveOf(tabs: readonly EditorTabPresentation[]): string {
    return tabs.find((tab) => tab.path === "src/story/chapter-02.md")?.path ?? tabs[0]?.path ?? "";
}

/** 未请求分屏返回 null；非法请求返回 undefined，并拒绝同一初始化请求的正文写入。 */
function sceneSplitOf(rawData: Record<string, unknown>, tabs: readonly EditorTabPresentation[]): EditorSplitPayload | null | undefined {
    const path = typeof rawData.splitPanePath === "string" ? rawData.splitPanePath : null;
    const direction = rawData.splitPaneDirection;
    if (!path && direction === undefined) {
        return null;
    }
    const rejection = (reason: string): undefined => {
        emitLabEvent("split-tab-rejected", {path, direction, sourceGroupId: "primary", targetGroupId: "primary", reason});
        return undefined;
    };
    if (!path || !tabs.some((tab) => tab.path === path)) {
        return rejection("场景分屏路径不在标签表里");
    }
    if (!isSplitDirection(direction)) {
        return rejection("场景分屏方向非法");
    }
    return {sourceGroupId: "primary", targetGroupId: "primary", path, direction, mode: "copy"};
}

function initScene(sceneId: string, customData?: unknown): void {
    const rawData = (customData ?? {}) as Record<string, unknown>;
    busy.value = typeof rawData.busy === "boolean" ? rawData.busy : sceneId === "loading";
    diagnosis.value = typeof rawData.diagnosis === "string"
        ? rawData.diagnosis
        : (sceneId === "diagnosis" ? "打开方式“diagram-viewer”不可用，当前使用源码编辑器。" : null);
    closeConfirmTab.value = null;
    // 每个场景会话从 0 起算；路径是否可写由占用检查决定，不靠计数器猜。
    draftSequence = 0;

    const draft = prepareScene(sceneId, rawData);

    groups.value = [
        {
            id: "primary",
            tabs: draft.tabs,
            activePath: draft.activePath,
        },
    ];
    editorGrid.value = createEditorGrid("primary");
    activeGroupId.value = "primary";
    groupCounter = 1;
    recalcLayout();

    if (draft.split) {
        handleSplitTab(draft.split);
    }

    const rawEditorId = typeof rawData.editorId === "string"
        ? rawData.editorId
        : (typeof rawData.currentEditorId === "string" ? rawData.currentEditorId : null);

    if (rawEditorId) {
        currentEditorId.value = rawEditorId;
    } else if (sceneId === "multi-view") {
        currentEditorId.value = "code";
    } else {
        currentEditorId.value = draft.activePath.endsWith(".md") ? "markdown" : "code";
    }

    if (draft.content !== null && draft.activePath) {
        writeExternalContent(draft.activePath, draft.content);
    }
    syncDataSink();
}

watch(() => props.scene, (scene) => {
    initScene(scene, props.data);
}, {immediate: true});

watch(() => props.data, (newData) => {
    if (!newData) return;
    const serialized = JSON.stringify(newData);
    if (serialized === lastEmittedJson) return;

    const raw = newData as Record<string, unknown>;
    if (typeof raw.busy === "boolean") busy.value = raw.busy;
    if (typeof raw.diagnosis === "string" || raw.diagnosis === null) diagnosis.value = raw.diagnosis as string | null;
    const rawEdId = typeof raw.editorId === "string" ? raw.editorId : (typeof raw.currentEditorId === "string" ? raw.currentEditorId : null);
    if (rawEdId && rawEdId !== currentEditorId.value) currentEditorId.value = rawEdId;

    // 非法 activePath 整条拒绝：不把组的活动标签指向不存在的标签，也不按它写正文。
    let activeAccepted = true;
    if (typeof raw.activePath === "string" && raw.activePath !== activePath.value) {
        if (primaryGroup.value?.tabs.some((tab) => tab.path === raw.activePath)) {
            activePath.value = raw.activePath;
        } else {
            activeAccepted = false;
            emitLabEvent("active-path-rejected", {path: raw.activePath, scene: props.scene});
        }
    }

    if (typeof raw.content === "string" && activeAccepted && activePath.value) {
        writeExternalContent(activePath.value, raw.content);
    }
    syncDataSink();
}, {deep: true});

function syncDataSink(): void {
    const payload = {
        scene: props.scene,
        activePath: activePath.value,
        currentEditorId: currentEditorId.value,
        busy: busy.value,
        diagnosis: diagnosis.value,
        tabCount: tabs.value.length,
        dirtyCount: tabs.value.filter((t) => t.dirty).length,
        pinnedCount: tabs.value.filter((t) => t.pinned).length,
        groupsCount: groups.value.length,
        splitPanePath: groups.value[1]?.activePath ?? null,
        splitPaneDirection: splitDirectionOf(),
    };
    lastEmittedJson = JSON.stringify(payload);
    updateLabData(payload);
}

const currentLanguageId = computed(() => {
    if (!activePath.value) return "plaintext";
    if (activePath.value.endsWith(".md")) return "markdown";
    if (activePath.value.endsWith(".json")) return "json";
    if (activePath.value.endsWith(".ts")) return "typescript";
    return "plaintext";
});

const currentResource = computed<EditorResource | null>(() => {
    if (!activePath.value) return null;
    return {
        path: activePath.value,
        readOnly: false,
        languageId: currentLanguageId.value,
        editable: true,
    };
});

function getSnapshot(path: string): EditorDocumentSnapshot | null {
    if (!path) return null;
    const lang = path.endsWith(".md")
        ? "markdown"
        : path.endsWith(".json")
        ? "json"
        : path.endsWith(".ts")
        ? "typescript"
        : "plaintext";
    return {
        target: {
            workspaceKey: "lab",
            generation: 1,
            documentId: path,
            path,
        },
        content: documentContents[path] ?? "",
        contentRevision: documentRevisions[path] ?? 0,
        languageId: lang,
        readonly: false,
    };
}

/** 夹具自己发起的权威写入（面板改数据、场景初值）：内容与修订一起推进。 */
function writeExternalContent(path: string, content: string): void {
    documentContents[path] = content;
    documentRevisions[path] = (documentRevisions[path] ?? 0) + 1;
}

const menus = computed<MenubarMenuData[]>(() => {
    if (!activePath.value || !currentResource.value) return [];
    const available = LAB_REGISTRY.available(currentResource.value);

    return [
        {
            id: "file",
            label: "文件",
            items: [
                {label: "保存", value: "save", shortcut: "Ctrl+S", iconClass: "i-lucide-save", disabled: !activePath.value},
                {label: "全部保存", value: "save-all", shortcut: "Ctrl+Shift+S", iconClass: "i-lucide-save-all"},
                {separator: true, label: "", value: "sep-file-1"},
                {
                    label: "导出作品",
                    value: "file.export",
                    iconClass: "i-lucide-download",
                    children: [
                        {label: "导出为 EPUB", value: "export:epub", iconClass: "i-lucide-book"},
                        {label: "导出为 PDF", value: "export:pdf", iconClass: "i-lucide-file-text"},
                        {separator: true, label: "", value: "sep-export-1"},
                        {label: "导出为纯文本 (TXT)", value: "export:txt", iconClass: "i-lucide-file"},
                    ],
                },
                {separator: true, label: "", value: "sep-file-2"},
                {label: "关闭当前", value: "close", shortcut: "Ctrl+W", iconClass: "i-lucide-x", disabled: !activeGroupPath.value},
                {label: "关闭全部", value: "close-all", iconClass: "i-lucide-x-circle", tone: "danger"},
            ],
        },
        {
            id: "openWith",
            label: "打开方式",
            items: [
                ...available.map((contrib) => ({
                    label: contrib.id === "code" ? "源码" : contrib.id === "markdown" ? "富文本" : contrib.titleKey,
                    value: `editor:${contrib.id}`,
                    iconClass: contrib.iconClass,
                    checked: currentEditorId.value === contrib.id,
                })),
                {separator: true, label: "", value: "sep-openwith"},
                {label: "重新加载打开方式", value: "reload-config", iconClass: "i-lucide-refresh-cw"},
            ],
        },
        {
            id: "viewActions",
            label: "视图操作",
            items: [
                {label: "批注侧面板", value: "action:toggle-comments", iconClass: "i-lucide-message-square", checked: showComments.value},
                {label: "撤销修改", value: "action:undo", shortcut: "Ctrl+Z", iconClass: "i-lucide-undo"},
                {label: "重做修改", value: "action:redo", shortcut: "Ctrl+Y", iconClass: "i-lucide-redo"},
            ],
        },
    ];
});

function handleSelectTab(path: string, groupId = "primary"): void {
    const group = getGroup(groupId);
    if (!group) return;
    group.activePath = path;
    const tab = group.tabs.find((t) => t.path === path);
    if (tab && currentResource.value) {
        const available = LAB_REGISTRY.available(currentResource.value);
        if (!available.some((e) => e.id === currentEditorId.value)) {
            currentEditorId.value = available[0]?.id ?? "code";
        }
    }
    emitLabEvent("select-tab", {path, groupId});
    syncDataSink();
}

function handleCloseTab(path: string, groupId = "primary"): void {
    const group = getGroup(groupId);
    if (!group) return;
    const tab = group.tabs.find((t) => t.path === path);
    if (!tab) return;

    if (tab.dirty) {
        closeConfirmTab.value = tab;
        closeConfirmGroupId.value = groupId;
        emitLabEvent("close-confirm-open", {path, groupId});
        return;
    }

    closeTabDirectly(path, groupId);
}

function closeTabDirectly(path: string, groupId = "primary"): void {
    const group = getGroup(groupId);
    if (!group) return;
    const closingIndex = group.tabs.findIndex((t) => t.path === path);
    group.tabs = group.tabs.filter((t) => t.path !== path);

    if (group.activePath === path) {
        if (group.tabs.length > 0) {
            const nextIndex = Math.min(closingIndex, group.tabs.length - 1);
            group.activePath = group.tabs[nextIndex]!.path;
        } else {
            group.activePath = "";
        }
    }

    // 若该组已清空且存在多个组，自动从布局树中移除该组
    if (group.tabs.length === 0 && groups.value.length > 1 && removeEditorGroup(editorGrid.value, groupId).ok) {
        dropCollapsedGroup(groupId);
        syncGroupOrder();
        recalcLayout();
        emitLabEvent("close-split", {closedGroupId: groupId});
    }

    emitLabEvent("close-tab", {path, groupId});
    syncDataSink();
}

function cancelClose(): void {
    if (closeConfirmTab.value) {
        emitLabEvent("close-confirm-cancel", {path: closeConfirmTab.value.path});
        closeConfirmTab.value = null;
    }
}

function confirmCloseDiscard(): void {
    if (closeConfirmTab.value) {
        const path = closeConfirmTab.value.path;
        const gId = closeConfirmGroupId.value;
        closeConfirmTab.value = null;
        emitLabEvent("close-confirm-discard", {path, groupId: gId});
        closeTabDirectly(path, gId);
    }
}

function confirmCloseSave(): void {
    if (closeConfirmTab.value) {
        const path = closeConfirmTab.value.path;
        const gId = closeConfirmGroupId.value;
        saveDocument(path);
        closeConfirmTab.value = null;
        emitLabEvent("close-confirm-save", {path, groupId: gId});
        closeTabDirectly(path, gId);
    }
}

function handleSetPin(path: string, pinned: boolean, groupId = "primary"): void {
    const group = getGroup(groupId);
    if (!group) return;
    group.tabs = group.tabs.map((t) => (t.path === path ? {...t, pinned} : t));
    emitLabEvent("set-pin", {path, pinned, groupId});
    syncDataSink();
}

function handleKeepTab(path: string, groupId = "primary"): void {
    const group = getGroup(groupId);
    if (!group) return;
    group.tabs = group.tabs.map((t) => (t.path === path ? {...t, preview: false} : t));
    emitLabEvent("keep-tab", {path, groupId});
    syncDataSink();
}

function handleMoveTab(path: string, targetPath: string | null, targetPinned: boolean, position: EditorTabDropPosition, groupId = "primary"): void {
    const group = getGroup(groupId);
    if (!group) return;
    const moving = group.tabs.find((t) => t.path === path);
    if (!moving) return;

    const remaining = group.tabs.filter((t) => t.path !== path);
    const updatedMoved = {...moving, pinned: targetPinned};

    const nextTabs = [...remaining];
    if (!targetPath) {
        if (position === "before") nextTabs.unshift(updatedMoved);
        else nextTabs.push(updatedMoved);
    } else {
        const targetIndex = nextTabs.findIndex((t) => t.path === targetPath);
        if (targetIndex === -1) nextTabs.push(updatedMoved);
        else nextTabs.splice(position === "before" ? targetIndex : targetIndex + 1, 0, updatedMoved);
    }
    group.tabs = nextTabs;
    emitLabEvent("move-tab", {path, targetPath, targetPinned, position, groupId});
    syncDataSink();
}

function handleMenuSelect(item: MenubarItemData, groupId = "primary"): void {
    emitLabEvent("select-menu", {value: item.value, label: item.label, groupId});
    const group = getGroup(groupId);
    if (item.value === "save" && group?.activePath) saveDocument(group.activePath);
    else if (item.value === "save-all") group?.tabs.filter((t) => t.dirty).forEach((t) => saveDocument(t.path));
    else if (item.value === "close" && group?.activePath) handleCloseTab(group.activePath, groupId);
    else if (item.value === "close-all" && group) { group.tabs = []; group.activePath = ""; syncDataSink(); }
    else if (item.value === "reload-config") { diagnosis.value = null; emitLabEvent("reload-config"); }
    else if (item.value.startsWith("editor:")) {
        currentEditorId.value = item.value.slice(7);
        emitLabEvent("switch-editor", {id: currentEditorId.value});
        syncDataSink();
    } else if (item.value === "action:toggle-comments") {
        showComments.value = !showComments.value;
        activeViewHandle.value?.runAction?.("markdown.comments");
    } else if (item.value === "action:undo") activeViewHandle.value?.undo?.();
    else if (item.value === "action:redo") activeViewHandle.value?.redo?.();
}

function saveDocument(path: string): void {
    groups.value.forEach((g) => {
        g.tabs = g.tabs.map((t) => (t.path === path ? {...t, dirty: false} : t));
    });
    emitLabEvent("document-saved", {path, length: documentContents[path]?.length ?? 0});
    syncDataSink();
}

function handleRetry(): void {
    diagnosis.value = null;
    emitLabEvent("retry");
    syncDataSink();
}

function handleOpenAsCode(): void {
    currentEditorId.value = "code";
    diagnosis.value = null;
    emitLabEvent("open-as-code");
    syncDataSink();
}

function handleDocumentChange(target: EditorDocumentTarget, content: string, path: string): void {
    if (path) {
        writeExternalContent(path, content);
        groups.value.forEach((g) => {
            if (g.tabs.some((t) => t.path === path && !t.dirty)) {
                g.tabs = g.tabs.map((t) => (t.path === path ? {...t, dirty: true} : t));
            }
        });
        emitLabEvent("content-change", {path, length: content.length});
    }
    void target;
}

/** 夹具扮演的权威缓冲：基线过期回 conflict，目标已换代回 stale，都不是 accepted。 */
function commitDocumentChange(request: EditorChangeRequest): EditorChangeResult {
    const snapshot = getSnapshot(request.target.path);
    if (!snapshot || request.target.documentId !== snapshot.target.documentId) {
        return {status: "stale"};
    }
    if (request.baseRevision !== snapshot.contentRevision) {
        emitLabEvent("content-rejected", {path: request.target.path, baseRevision: request.baseRevision, revision: snapshot.contentRevision});
        return {status: "conflict", snapshot};
    }
    handleDocumentChange(request.target, request.content, request.target.path);
    return {status: "accepted", snapshot: getSnapshot(request.target.path)!};
}

/**
 * 新增草稿：路径取自场景会话内单调的序号，并先确认**所有组标签与既有正文**都没占用，
 * 之后才写正文——移动/关闭标签让 primary 数量回落也不会复用旧身份、不会覆盖旧文档。
 */
function addTab(type: "normal" | "pinned" | "preview"): void {
    const group = primaryGroup.value;
    if (!group) return;
    const serial = nextDraftSerial();
    const label = `note-${String(serial).padStart(2, "0")}.md`;
    const newPath = draftPathOf(serial);
    writeExternalContent(newPath, `# 新建笔记 ${String(serial).padStart(2, "0")}\n\n这是动态添加的草稿。`);
    const newTab: EditorTabPresentation = {
        path: newPath, title: label, pinned: type === "pinned", preview: type === "preview",
        dirty: false, statusText: "U", iconClass: "i-lucide-file-text",
    };
    group.tabs = [...group.tabs, newTab];
    group.activePath = newPath;
    syncDataSink();
}

const activeTab = computed(() => tabs.value.find((t) => t.path === activePath.value));

const cursorState = ref({line: 1, column: 1, length: 0});

provide("lab-editor-cursor", (line: number, column: number, length: number) => {
    cursorState.value = {line, column, length};
});

/**
 * 一次分屏：`mode` 由载荷显式给出（工具栏 = copy，拖到边缘 = move），不再读全局拖动状态推断。
 *
 * 未知来源/目标/路径与非法方向一律拒绝：不伪造标签，也不改 groups、树、活动组与正文。
 * 分屏与空源塌陷先在同一棵几何候选树上跑通，任一步失败都不发布——不留半状态、不先删源再恢复。
 */
function handleSplitTab(payload: EditorSplitPayload): void {
    const {sourceGroupId, targetGroupId, path, direction, mode} = payload;
    const srcGroup = getGroup(sourceGroupId);
    const tgtGroup = getGroup(targetGroupId);
    const reject = (reason: string): void => {
        emitLabEvent("split-tab-rejected", {path, direction, sourceGroupId, targetGroupId, reason});
    };
    if (mode !== "copy" && mode !== "move") return reject("未知分屏模式");
    if (!isSplitDirection(direction)) return reject("非法分屏方向");
    if (!srcGroup || !tgtGroup) return reject("未知编辑组");

    const instanceIndex = srcGroup.tabs.findIndex((tab) => tab.path === path);
    if (instanceIndex === -1) return reject("源组没有该标签");
    // 只处理被选中的那一个实例：同组内 path 唯一，跨组的同 path 视图互不影响。
    const instance = srcGroup.tabs[instanceIndex]!;
    const remainingTabs = srcGroup.tabs.filter((_, index) => index !== instanceIndex);
    const detachSource = mode === "move";
    const collapseSource = detachSource && remainingTabs.length === 0;

    const newGroupId = `group-${groupCounter + 1}`;
    const candidate = candidateTree();
    if (!candidate) return reject("布局候选树不可用");
    if (!splitEditorGroup(candidate, targetGroupId, newGroupId, direction).ok) return reject("该位置无法分屏");
    if (collapseSource && !removeEditorGroup(candidate, sourceGroupId).ok) return reject("源组塌陷失败");

    // 全部通过：一次发布（候选树 + 组集合 + 活动组 + 呈现）。copy 保留源实例，move 只移除被选中的那一个。
    groupCounter += 1;
    editorGrid.value = candidate;
    groups.value = groups.value
        .filter((group) => !(collapseSource && group.id === sourceGroupId))
        .map((group) => detachSource && group.id === sourceGroupId
            ? {
                ...group,
                tabs: remainingTabs,
                activePath: group.activePath === path ? (remainingTabs[0]?.path ?? "") : group.activePath,
            }
            : group);
    // 副本/搬移出来的都是常驻标签（产品规则：避免两个 preview 互相顶替）。
    groups.value = [...groups.value, {id: newGroupId, tabs: [{...instance, preview: false}], activePath: path}];
    syncGroupOrder();
    activeGroupId.value = newGroupId;
    recalcLayout();

    emitLabEvent("split-tab", {path, direction, sourceGroupId, newGroupId});
    syncDataSink();
}

/** 轮转分屏的源标签：优先非活动标签，其次活动标签；没有真实标签就不造假（拒绝，不回退到硬编码路径）。 */
function splitSourceOf(group: EditorGroupState | undefined): string | null {
    if (!group || group.tabs.length === 0) return null;
    return group.tabs.find((tab) => tab.path !== group.activePath)?.path ?? group.tabs[0]!.path;
}

function cycleSplit(): void {
    const currentGroupIds = editorGroupIds(editorGrid.value);
    if (currentGroupIds.length <= 1) {
        // 第 1 次分屏：向右分屏（1 -> 2 组）
        const group = getGroup(currentGroupIds[0] ?? "primary") || groups.value[0];
        const source = splitSourceOf(group);
        if (!group || !source) {
            emitLabEvent("split-tab-rejected", {sourceGroupId: group?.id ?? "", targetGroupId: group?.id ?? "", reason: "没有可用的源标签"});
            return;
        }
        handleSplitTab({sourceGroupId: group.id, targetGroupId: group.id, path: source, direction: "right", mode: "copy"});
    } else if (currentGroupIds.length === 2) {
        // 第 2 次分屏（二次分屏！）：在副组处向下分屏（2 -> 3 组）
        const targetId = currentGroupIds[1]!;
        const targetGroup = getGroup(targetId);
        const source = splitSourceOf(targetGroup);
        if (!source) {
            emitLabEvent("split-tab-rejected", {sourceGroupId: targetId, targetGroupId: targetId, reason: "没有可用的源标签"});
            return;
        }
        handleSplitTab({sourceGroupId: targetId, targetGroupId: targetId, path: source, direction: "bottom", mode: "copy"});
    } else if (currentGroupIds.length === 3) {
        // 第 3 次分屏（三次分屏！）：在主组处向下分屏（3 -> 4 组 2x2 网格）
        const targetId = currentGroupIds[0]!;
        const targetGroup = getGroup(targetId);
        const source = splitSourceOf(targetGroup);
        if (!source) {
            emitLabEvent("split-tab-rejected", {sourceGroupId: targetId, targetGroupId: targetId, reason: "没有可用的源标签"});
            return;
        }
        handleSplitTab({sourceGroupId: targetId, targetGroupId: targetId, path: source, direction: "bottom", mode: "copy"});
    } else {
        // 还原回单组
        const group = getGroup(currentGroupIds[0] ?? "primary") || groups.value[0];
        if (!group) return;
        groups.value = [group];
        editorGrid.value = createEditorGrid(group.id);
        activeGroupId.value = group.id;
        recalcLayout();
        emitLabEvent("close-split");
        syncDataSink();
    }
}

/** 目标组插入：优先贴近参照标签；参照缺失或为空时按 pin 分区末尾追加（与产品事务同规则）。 */
function insertIntoTarget(
    tabs: readonly EditorTabPresentation[],
    moving: EditorTabPresentation,
    targetPath: string | null,
    position: EditorTabDropPosition,
): EditorTabPresentation[] {
    const next = [...tabs];
    const index = targetPath ? next.findIndex((tab) => tab.path === targetPath) : -1;
    if (index >= 0) {
        next.splice(position === "before" ? index : index + 1, 0, moving);
        return next;
    }
    const lastPartition = next.reduce((last, tab, at) => (tab.pinned === moving.pinned ? at : last), -1);
    next.splice(lastPartition + 1, 0, moving);
    return next;
}

/**
 * 跨组移动：源/目标/path 无效即拒绝（不改任何可见标签与组数）。
 *
 * 目标组已有同一 path 时只激活目标已有引用并删除来源实例，不插入重复标签；
 * 源组因此清空时按产品规则塌陷（先在一棵候选树上跑通叶移除，失败则整条拒绝），活动组落到目标组。
 */
function handleTransferTab(payload: TabTransferPayload): void {
    const {sourceGroupId, targetGroupId, path, targetPath, targetPinned, position} = payload;
    const srcGroup = getGroup(sourceGroupId);
    const tgtGroup = getGroup(targetGroupId);
    const reject = (reason: string): void => {
        emitLabEvent("transfer-tab-rejected", {path, sourceGroupId, targetGroupId, reason});
    };
    if (!srcGroup || !tgtGroup) return reject("未知编辑组");
    if (sourceGroupId === targetGroupId) return reject("同组投放不是跨组移动");
    const instanceIndex = srcGroup.tabs.findIndex((tab) => tab.path === path);
    if (instanceIndex === -1) return reject("源组没有该标签");

    const movingTab = srcGroup.tabs[instanceIndex]!;
    const remainingTabs = srcGroup.tabs.filter((_, index) => index !== instanceIndex);
    const collapseSource = remainingTabs.length === 0;
    const candidate = collapseSource ? candidateTree() : null;
    if (collapseSource && (!candidate || !removeEditorGroup(candidate, sourceGroupId).ok)) {
        return reject("源组塌陷失败");
    }

    // 目标组已有同 path：激活既有引用（实例状态留在目标组），来源实例只做删除——不产生重复身份。
    const existing = tgtGroup.tabs.find((tab) => tab.path === path);
    if (existing) {
        tgtGroup.tabs = tgtGroup.tabs.map((tab) => (tab.path === path ? {...tab, preview: false} : tab));
    } else {
        const targetItem: EditorTabPresentation = {
            ...movingTab,
            pinned: targetPinned !== undefined ? targetPinned : movingTab.pinned,
            preview: false,
        };
        tgtGroup.tabs = insertIntoTarget(tgtGroup.tabs, targetItem, targetPath, position);
    }
    tgtGroup.activePath = path;

    srcGroup.tabs = remainingTabs;
    if (srcGroup.activePath === path) {
        srcGroup.activePath = remainingTabs[0]?.path ?? "";
    }
    if (collapseSource && candidate) {
        editorGrid.value = candidate;
        dropCollapsedGroup(sourceGroupId);
    }
    syncGroupOrder();
    // 焦点跟着被投放的标签走（与产品 `transferTab` 一致），因此活动组永远指向存在的组。
    activeGroupId.value = targetGroupId;
    recalcLayout();

    emitLabEvent("transfer-tab", payload);
    syncDataSink();
}

const activeDocumentLanguage = computed(() => {
    if (!activePath.value) return "";
    if (activePath.value.endsWith(".md")) return "Markdown";
    if (activePath.value.endsWith(".json")) return "JSON";
    if (activePath.value.endsWith(".html")) return "HTML";
    if (activePath.value.endsWith(".ts")) return "TypeScript";
    return "纯文本";
});

watch(activePath, (p) => {
    cursorState.value = {line: 1, column: 1, length: p ? documentContents[p]?.length ?? 0 : 0};
});
</script>

<template>
    <div class="flex h-full w-full flex-col overflow-hidden text-[var(--text-main)]">
        <!-- Fixture 场景交互控制：挂载到底部抽屉面板 -->
        <LabFixtureControls>
            <div class="flex shrink-0 flex-wrap items-center justify-between gap-2 text-xs select-none">
                <div class="flex items-center gap-2">
                    <span class="text-[var(--text-secondary)]">受控模式 · 四主题自适应 · 支持二次分屏 (2x2) · 标签栏尾部按钮切换多行/单行（默认多行，拖窄容器即可看到折行）</span>
                </div>
                <div class="flex flex-wrap items-center gap-1.5">
                    <button type="button" class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]" @click="addTab('normal')">
                        + 新建标签
                    </button>
                    <button type="button" class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]" @click="addTab('preview')">
                        + 预览标签
                    </button>
                    <button type="button" class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]" @click="() => { busy = !busy; syncDataSink(); }">
                        {{ busy ? "关闭忙碌" : "开启忙碌 (busy)" }}
                    </button>
                    <button type="button" class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]" @click="() => { diagnosis = diagnosis ? null : '打开方式“diagram-viewer”不可用，当前使用源码编辑器。'; syncDataSink(); }">
                        {{ diagnosis ? "清除诊断" : "模拟未知视图" }}
                    </button>
                    <button v-if="activeTab" type="button" class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]" @click="() => { if (activePath) { tabs = tabs.map((t) => t.path === activePath ? {...t, dirty: !t.dirty} : t); syncDataSink(); } }">
                        {{ activeTab.dirty ? "清除未保存标记" : "标为未保存 (dirty)" }}
                    </button>
                    <button type="button" class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]" title="点击轮转分屏（单组 -> 双组 -> 三组(二次分屏) -> 四组 -> 还原）" @click="cycleSplit">
                        {{ groups.length > 1 ? `分屏: ${groups.length}组 (切下档)` : "分屏打开" }}
                    </button>
                </div>
            </div>
        </LabFixtureControls>

        <!-- 主体被测试零件：EditorWorkbench 接收 groups 与 layout 驱动多组分屏 -->
        <main class="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <EditorWorkbench
                data-lab-subject
                class="flex-1 min-w-[140px] min-h-[140px]"
                :groups="displayGroups"
                :tree="layoutTree"
                :layout="layout"
                :active-group-id="activeGroupId"
                :allow-split="true"
                :context-key="scene"
                :revision="layoutRevision"
                :on-gesture-commit="onGestureCommit"
                @select-tab="(g, p) => handleSelectTab(p, g)"
                @close-tab="(g, p) => handleCloseTab(p, g)"
                @set-pin="(g, p, pin) => handleSetPin(p, pin, g)"
                @keep-tab="(g, p) => handleKeepTab(p, g)"
                @move-tab="(g, p, tp, pin, pos) => handleMoveTab(p, tp, pin, pos, g)"
                @split-tab="handleSplitTab"
                @transfer-tab="handleTransferTab"
                @select-menu="(g, item) => handleMenuSelect(item, g)"
                @retry="() => handleRetry()"
                @open-as-code="() => handleOpenAsCode()"
                @focus-group="(g) => { activeGroupId = g; }"
                @container-extent="setContainerExtent"
            >
                <template #content="{ group, activePath: path }">
                    <EditorViewHost
                        v-if="path && getSnapshot(path)"
                        :document="getSnapshot(path)!"
                        :registry="LAB_REGISTRY"
                        :editor-id="path.endsWith('.md') ? 'markdown' : 'code'"
                        :commit-change="commitDocumentChange"
                        @save-request="() => saveDocument(path)"
                        @focus-change="(_t, _token, f) => emitLabEvent('editor-focus', {focused: f, path})"
                        @view-error="(_t, _token, m) => { diagnosis = m; emitLabEvent('view-error', {message: m}); }"
                    />
                    <EditorWelcome
                        v-else
                        :node="null"
                        :tabs="group?.tabs ?? []"
                        :compact="groups.length > 1"
                        workspace-mode="novel"
                        @select-tab="(p) => handleSelectTab(p, group?.id)"
                        @open-path="(p) => handleSelectTab(p, group?.id)"
                        @create-chapter="() => addTab('normal')"
                        @create-markdown-file="() => addTab('normal')"
                        @open-files="() => emitLabEvent('open-files')"
                        @open-agent-panel="() => emitLabEvent('open-agent-panel')"
                        @open-profile-workbench="() => emitLabEvent('open-profile-workbench')"
                    />
                </template>

                <template #empty="{ group }">
                    <EditorWelcome
                        :node="null"
                        :tabs="group?.tabs ?? []"
                        :compact="groups.length > 1"
                        workspace-mode="novel"
                        @select-tab="(p) => handleSelectTab(p, group?.id)"
                        @open-path="(p) => handleSelectTab(p, group?.id)"
                        @create-chapter="() => addTab('normal')"
                        @create-markdown-file="() => addTab('normal')"
                        @open-files="() => emitLabEvent('open-files')"
                        @open-agent-panel="() => emitLabEvent('open-agent-panel')"
                        @open-profile-workbench="() => emitLabEvent('open-profile-workbench')"
                    />
                </template>
            </EditorWorkbench>

            <!-- 脏文件关闭保护确认卡片：具备键盘 Escape 与无障碍模态支持 -->
            <EditorWorkbenchCloseConfirm
                v-if="closeConfirmTab"
                :tab="closeConfirmTab"
                @cancel="cancelClose"
                @discard="confirmCloseDiscard"
                @save="confirmCloseSave"
            />
        </main>

        <!-- 底部标准状态栏：对齐 VS Code 规范 -->
        <WorkbenchStatusBar class="shrink-0">
            <template #left>
                <WorkbenchStatusBarItem label="main*" icon-class="i-lucide-git-branch" />
                <WorkbenchStatusBarItem
                    v-if="activeTab?.dirty"
                    label="未保存修改"
                    icon-class="i-lucide-circle-dot text-[var(--status-warning)]"
                />
                <WorkbenchStatusBarItem
                    v-else-if="activePath"
                    label="就绪"
                    icon-class="i-lucide-check text-[var(--status-success)]"
                />
                <WorkbenchStatusBarItem
                    v-if="groups.length > 1"
                    :label="`分屏组: ${groups.length}`"
                    icon-class="i-lucide-columns"
                    @click="cycleSplit"
                />
            </template>
            <template #right>
                <WorkbenchStatusBarItem :label="`行 ${cursorState.line}, 列 ${cursorState.column}`" />
                <WorkbenchStatusBarItem :label="`${cursorState.length || (activePath ? documentContents[activePath]?.length : 0) || 0} 字符`" />
                <WorkbenchStatusBarItem label="空格: 4" />
                <WorkbenchStatusBarItem label="UTF-8" />
                <WorkbenchStatusBarItem label="CRLF" />
                <WorkbenchStatusBarItem :label="activeDocumentLanguage || 'Markdown'" icon-class="i-lucide-file-code" />
            </template>
        </WorkbenchStatusBar>
    </div>
</template>
