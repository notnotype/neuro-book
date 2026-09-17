<script setup lang="ts">
/**
 * EditorWorkbench 的 Lab 场景装配。
 *
 * 演示重点：
 * 1. 真实受控外壳：消费真实 EditorTabBar 与 EditorToolbar，不接 Pinia store、不发起网络与磁盘 I/O；
 * 2. 多种标签状态拓扑：固定标签组、普通标签组、未保存脏标记、斜体预览标签、长标题单行截断与横向滚动；
 * 3. 完整受控生命周期：切换标签、右键上下文菜单、关闭标签、未保存修改退出拦截与确认/取消；
 * 4. 忙碌遮罩与诊断横幅：busy 遮罩保留下层实例与正文不卸载，诊断信息提供重试与以源码打开；
 * 5. 真实注册表与多视图同一正文：通过 createEditorRegistry 接入源码 (code)、Markdown 富文本 (markdown)
 *    以及第三注册视图 (test.preview)，在同一文档快照下切换不同呈现与操作，正文毫发无损；
 * 6. 语义化插槽与无障碍：tabpanel 与 roving tabindex 焦点管理，无标签时自动引导至 EditorWelcome 欢迎页。
 */
import {computed, defineComponent, h, inject, onBeforeUnmount, onMounted, provide, reactive, ref, shallowRef, watch, type PropType} from "vue";
import type {MenubarItemData, MenubarMenuData} from "@notnotype/nb-ui/components";
import EditorWorkbench from "nbook/app/components/editor-workbench/EditorWorkbench.vue";
import EditorWelcome from "nbook/app/components/editor-workbench/EditorWelcome.vue";
import EditorViewHost from "nbook/app/components/editor-workbench/EditorViewHost.vue";
import WorkbenchStatusBar from "nbook/app/components/workbench/WorkbenchStatusBar.vue";
import WorkbenchStatusBarItem from "nbook/app/components/workbench/WorkbenchStatusBarItem.vue";
import LabFixtureControls from "../LabFixtureControls.vue";
import type {
    EditorAction,
    EditorContribution,
    EditorDocumentSnapshot,
    EditorDocumentTarget,
    EditorResource,
    EditorSplitDirection,
    EditorTabDropPosition,
    EditorTabPresentation,
    EditorViewEvents,
    EditorViewHandle,
    EditorViewProps,
} from "nbook/app/components/editor-workbench/editor-view.types";
import {createEditorRegistry, type EditorRegistry} from "nbook/app/utils/editor-workbench/registry";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();
const updateLabData = useLabDataSink();

/**
 * --------------------------------------------------------------------------
 * 小型内联领域视图：遵循 ViewHost 实际生命周期合同（onMounted 发送 ready）
 * --------------------------------------------------------------------------
 */

/** 1. 源码视图示例 */
const LabCodeEditorView = defineComponent({
    name: "LabCodeEditorView",
    props: {
        document: {type: Object as PropType<EditorDocumentSnapshot>, required: true},
        visible: {type: Boolean, default: true},
    },
    emits: ["change", "save", "focus", "ready"],
    setup(viewProps, {emit}) {
        const textareaRef = ref<HTMLTextAreaElement | null>(null);
        const reportCursor = inject<((line: number, col: number, len: number) => void) | null>("lab-editor-cursor", null);

        function updateCursor(el: HTMLTextAreaElement | null): void {
            if (!el) return;
            const pos = el.selectionStart || 0;
            const textBefore = el.value.substring(0, pos);
            const lines = textBefore.split("\n");
            reportCursor?.(lines.length, lines[lines.length - 1]!.length + 1, el.value.length);
        }

        const handle: EditorViewHandle = {
            flushPendingChange() {},
            focus() { textareaRef.value?.focus(); },
            undo() { document.execCommand?.("undo"); },
            redo() { document.execCommand?.("redo"); },
        };

        onMounted(() => {
            emit("ready", handle);
            updateCursor(textareaRef.value);
        });
        onBeforeUnmount(() => emit("ready", null));

        return () => h("div", {class: "flex h-full w-full min-h-0 flex-1 flex-col overflow-hidden bg-[var(--panel-surface)] font-mono text-xs"}, [
            h("textarea", {
                ref: textareaRef,
                value: viewProps.document.content,
                class: "h-full w-full flex-1 resize-none bg-transparent p-3 font-mono text-xs leading-5 text-[var(--text-main)] outline-none selection:bg-[var(--accent-main)] selection:text-white",
                spellcheck: false,
                onInput: (e: Event) => {
                    const el = e.target as HTMLTextAreaElement;
                    emit("change", viewProps.document.target, el.value);
                    updateCursor(el);
                },
                onClick: (e: MouseEvent) => updateCursor(e.target as HTMLTextAreaElement),
                onKeyup: (e: KeyboardEvent) => updateCursor(e.target as HTMLTextAreaElement),
                onKeydown: (e: KeyboardEvent) => {
                    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
                        e.preventDefault();
                        emit("save", viewProps.document.target);
                    }
                },
                onFocus: (e: FocusEvent) => {
                    emit("focus", viewProps.document.target, true);
                    updateCursor(e.target as HTMLTextAreaElement);
                },
                onBlur: () => emit("focus", viewProps.document.target, false),
            }),
        ]);
    },
});

/** 2. Markdown 富文本视图示例 */
const LabMarkdownEditorView = defineComponent({
    name: "LabMarkdownEditorView",
    props: {
        document: {type: Object as PropType<EditorDocumentSnapshot>, required: true},
        visible: {type: Boolean, default: true},
    },
    emits: ["change", "save", "focus", "actions", "ready"],
    setup(viewProps, {emit}) {
        const textareaRef = ref<HTMLTextAreaElement | null>(null);
        const commentsOpen = ref(true);
        const reportCursor = inject<((line: number, col: number, len: number) => void) | null>("lab-editor-cursor", null);

        function updateCursor(el: HTMLTextAreaElement | null): void {
            if (!el) return;
            const pos = el.selectionStart || 0;
            const textBefore = el.value.substring(0, pos);
            const lines = textBefore.split("\n");
            reportCursor?.(lines.length, lines[lines.length - 1]!.length + 1, el.value.length);
        }

        function emitActions(): void {
            emit("actions", viewProps.document.target, [
                {id: "markdown.comments", label: "批注侧面板", iconClass: "i-lucide-message-square", disabled: false, checked: commentsOpen.value},
            ]);
        }

        const handle: EditorViewHandle = {
            flushPendingChange() {},
            focus() { textareaRef.value?.focus(); },
            runAction(actionId: string) {
                if (actionId === "markdown.comments") {
                    commentsOpen.value = !commentsOpen.value;
                    emitActions();
                }
            },
        };

        onMounted(() => {
            emit("ready", handle);
            emitActions();
            updateCursor(textareaRef.value);
        });
        onBeforeUnmount(() => emit("ready", null));

        return () => h("div", {class: "flex h-full w-full min-h-0 flex-1 flex-col overflow-hidden bg-[var(--panel-surface)] text-xs"}, [
            h("div", {class: "flex min-h-0 flex-1 overflow-hidden"}, [
                h("textarea", {
                    ref: textareaRef,
                    value: viewProps.document.content,
                    class: "min-h-0 flex-1 resize-none bg-transparent p-3 font-sans text-sm leading-6 text-[var(--text-main)] outline-none",
                    onInput: (e: Event) => {
                        const el = e.target as HTMLTextAreaElement;
                        emit("change", viewProps.document.target, el.value);
                        updateCursor(el);
                    },
                    onClick: (e: MouseEvent) => updateCursor(e.target as HTMLTextAreaElement),
                    onKeyup: (e: KeyboardEvent) => updateCursor(e.target as HTMLTextAreaElement),
                    onFocus: (e: FocusEvent) => {
                        emit("focus", viewProps.document.target, true);
                        updateCursor(e.target as HTMLTextAreaElement);
                    },
                    onBlur: () => emit("focus", viewProps.document.target, false),
                }),
                commentsOpen.value ? h("aside", {class: "w-56 shrink-0 border-l border-[var(--divider)] bg-[var(--bg-panel)] p-3 text-[11px] text-[var(--text-secondary)] flex flex-col gap-2"}, [
                    h("div", {class: "font-medium text-[var(--text-main)] border-b border-[var(--divider)] pb-1.5"}, "批注侧面板"),
                    h("div", {class: "rounded border border-[var(--border-color)] bg-[var(--panel-surface)] p-2"}, "示例批注：此处描写生动。"),
                ]) : null,
            ]),
        ]);
    },
});

/** 3. 第三注册视图 (test.preview) */
const LabPreviewEditorView = defineComponent({
    name: "LabPreviewEditorView",
    props: {
        document: {type: Object as PropType<EditorDocumentSnapshot>, required: true},
        visible: {type: Boolean, default: true},
    },
    emits: ["change", "save", "focus", "ready"],
    setup(viewProps, {emit}) {
        const handle: EditorViewHandle = {
            flushPendingChange() {},
            focus() {},
        };

        onMounted(() => emit("ready", handle));
        onBeforeUnmount(() => emit("ready", null));

        return () => h("div", {class: "flex h-full w-full min-h-0 flex-1 flex-col overflow-hidden bg-[var(--panel-surface)] text-xs"}, [
            h("div", {class: "flex min-h-0 flex-1 flex-col overflow-y-auto p-4 max-w-2xl mx-auto w-full"}, [
                h("div", {class: "prose max-w-none text-sm leading-6 text-[var(--text-main)] whitespace-pre-wrap font-serif"}, viewProps.document.content || "（空文档）"),
            ]),
        ]);
    },
});

/** 注册表构建 */
function buildLabRegistry(): EditorRegistry {
    const code: EditorContribution = {
        id: "code", titleKey: "editorWorkbench.code", iconClass: "i-lucide-file-code-2",
        supports: (res: EditorResource) => res.editable,
        render: (vp: EditorViewProps, ev: EditorViewEvents, bind: (h: EditorViewHandle | null) => void) => h(LabCodeEditorView, {
            document: vp.document, visible: vp.visible,
            onChange: ev.change, onSave: ev.save, onFocus: ev.focus, onReady: bind,
        }),
    };
    const markdown: EditorContribution = {
        id: "markdown", titleKey: "editorWorkbench.markdown", iconClass: "i-lucide-file-text",
        supports: (res: EditorResource) => res.editable && res.languageId === "markdown",
        render: (vp: EditorViewProps, ev: EditorViewEvents, bind: (h: EditorViewHandle | null) => void) => h(LabMarkdownEditorView, {
            document: vp.document, visible: vp.visible,
            onChange: ev.change, onSave: ev.save, onFocus: ev.focus, onActions: ev.actions, onReady: bind,
        }),
    };
    const preview: EditorContribution = {
        id: "test.preview", titleKey: "测试预览视图 (第3视图)", iconClass: "i-lucide-eye",
        supports: (res: EditorResource) => res.editable,
        render: (vp: EditorViewProps, ev: EditorViewEvents, bind: (h: EditorViewHandle | null) => void) => h(LabPreviewEditorView, {
            document: vp.document, visible: vp.visible,
            onChange: ev.change, onSave: ev.save, onFocus: ev.focus, onReady: bind,
        }),
    };

    const created = createEditorRegistry([code, markdown, preview]);
    if (!created.ok) throw new Error(`无法创建 Lab 注册表：${created.reason}`);
    return created.value;
}

const LAB_REGISTRY = buildLabRegistry();

/**
 * --------------------------------------------------------------------------
 * 场景假数据与响应式状态
 * --------------------------------------------------------------------------
 */
const SCENE_TABS: Record<string, EditorTabPresentation[]> = {
    empty: [],
    mixed: [
        {path: "docs/architecture.md", title: "architecture.md", pinned: true, preview: false, dirty: false, iconClass: "i-lucide-file-text"},
        {path: "src/config/app.json", title: "app.json", pinned: true, preview: false, dirty: true, iconClass: "i-lucide-file-code-2"},
        {path: "src/story/chapter-01.md", title: "chapter-01.md", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-text"},
        {path: "src/story/chapter-02.md", title: "chapter-02.md", pinned: false, preview: false, dirty: true, iconClass: "i-lucide-file-text"},
        {path: "src/notes/quick-draft.txt", title: "quick-draft.txt", pinned: false, preview: true, dirty: false, iconClass: "i-lucide-file"},
    ],
    "long-titles": [
        {path: "packages/neuro-book/app/components/novel-ide/settings/sections/providers/components/ProviderSettingsViewFixtureLongPathComponentName.vue", title: "ProviderSettingsViewFixtureLongPathComponentName.vue", pinned: false, preview: false, dirty: true, iconClass: "i-lucide-file-code-2"},
        {path: "docs/specifications/drafts/2026-09-16-editor-workbench-architecture-and-view-host-contract-specification.md", title: "2026-09-16-editor-workbench-architecture-and-view-host-contract-specification.md", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-text"},
        {path: "assets/workspace/deeply/nested/directory/structure/with-multiple-submodules/long-configuration-matrix-sample.json", title: "long-configuration-matrix-sample.json", pinned: false, preview: true, dirty: false, iconClass: "i-lucide-file-code-2"},
    ],
    loading: [{path: "src/heavy-dataset.json", title: "heavy-dataset.json", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-code-2"}],
    diagnosis: [{path: "assets/diagram.drawio", title: "diagram.drawio", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-question"}],
    "closing-cancel": [
        {path: "src/draft-chapter.md", title: "draft-chapter.md", pinned: false, preview: false, dirty: true, iconClass: "i-lucide-file-text"},
        {path: "src/saved-notes.md", title: "saved-notes.md", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-text"},
    ],
    "keyboard-menu": [{path: "src/main.ts", title: "main.ts", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-code-2"}],
    "multi-view": [{path: "chapter-01.md", title: "chapter-01.md", pinned: true, preview: false, dirty: false, iconClass: "i-lucide-file-text"}],
};

const DEFAULT_CONTENTS: Record<string, string> = {
    "src/story/chapter-01.md": "# 第一章：雨夜的信件\n\n雨水拍打着窗棂。文本由三重视图共享。",
    "src/story/chapter-02.md": "# 第二章：钟表匠的密室\n\n这段正文有未保存的修改，用于演示脏标记与关闭保护。",
    "docs/architecture.md": "# 系统架构概览\n\nEditorWorkbench 受控组合件与 EditorTabBar、EditorToolbar。",
    "src/config/app.json": '{\n  "appName": "NeuroBook",\n  "version": "1.0.0"\n}',
    "src/notes/quick-draft.txt": "随手草稿：\n1. 增加更多无障碍测试\n2. 检查移动端 390x844 表现",
    "src/heavy-dataset.json": '{\n  "dataset": "massive-corpus",\n  "status": "loading"\n}',
    "assets/diagram.drawio": "<mxfile host='app.diagrams.net'><diagram>...</diagram></mxfile>",
    "src/draft-chapter.md": "# 草稿章节\n\n这段文字修改后未保存。关闭会弹出确认横幅，点取消能完整保留输入内容。",
    "src/saved-notes.md": "# 已保存的笔记\n\n这是一份干净的文档，关闭无需确认。",
    "src/main.ts": "import { createApp } from 'vue';\nimport App from './App.vue';\ncreateApp(App).mount('#app');",
    "chapter-01.md": "# 第三注册视图演示正文\n\n本正文供源码视图、Markdown 视图和测试预览视图 (test.preview) 共享。\n请点击顶部菜单「打开方式」切换，文本内容实时保持同步。",
};

const tabs = ref<EditorTabPresentation[]>([]);
const activePath = ref<string>("");
const busy = ref<boolean>(false);
const diagnosis = ref<string | null>(null);
const currentEditorId = ref<string>("code");
const documentContents = reactive<Record<string, string>>({...DEFAULT_CONTENTS});
const closeConfirmTab = ref<EditorTabPresentation | null>(null);
const showComments = ref(true);
const activeViewHandle = shallowRef<EditorViewHandle | null>(null);

let lastEmittedJson = "";

function initScene(sceneId: string, customData?: unknown): void {
    const rawData = (customData ?? {}) as Record<string, unknown>;
    busy.value = typeof rawData.busy === "boolean" ? rawData.busy : sceneId === "loading";
    diagnosis.value = typeof rawData.diagnosis === "string"
        ? rawData.diagnosis
        : (sceneId === "diagnosis" ? "打开方式“diagram-viewer”不可用，当前使用源码编辑器。" : null);
    closeConfirmTab.value = null;

    if (Array.isArray(rawData.tabs)) {
        tabs.value = (rawData.tabs as EditorTabPresentation[]).map((t) => ({
            path: String(t.path || ""),
            title: String(t.title || ""),
            pinned: Boolean(t.pinned),
            preview: Boolean(t.preview),
            dirty: Boolean(t.dirty),
            iconClass: String(t.iconClass || "i-lucide-file-text"),
        }));
        activePath.value = typeof rawData.activePath === "string" ? rawData.activePath : (tabs.value[0]?.path ?? "");
    } else {
        const initialTabs = SCENE_TABS[sceneId] ?? [];
        tabs.value = initialTabs.map((t) => ({...t}));
        activePath.value = initialTabs[0]?.path ?? "";
    }

    const rawEditorId = typeof rawData.editorId === "string"
        ? rawData.editorId
        : (typeof rawData.currentEditorId === "string" ? rawData.currentEditorId : null);

    if (rawEditorId) {
        currentEditorId.value = rawEditorId;
    } else if (sceneId === "multi-view") {
        currentEditorId.value = "code";
    } else {
        currentEditorId.value = activePath.value.endsWith(".md") ? "markdown" : "code";
    }

    if (typeof rawData.content === "string" && activePath.value) {
        documentContents[activePath.value] = rawData.content;
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
    if (typeof raw.activePath === "string" && raw.activePath !== activePath.value) activePath.value = raw.activePath;
    if (Array.isArray(raw.tabs)) {
        tabs.value = (raw.tabs as EditorTabPresentation[]).map((t) => ({
            path: String(t.path || ""),
            title: String(t.title || ""),
            pinned: Boolean(t.pinned),
            preview: Boolean(t.preview),
            dirty: Boolean(t.dirty),
            iconClass: String(t.iconClass || "i-lucide-file-text"),
        }));
    }
    if (typeof raw.content === "string" && activePath.value) {
        documentContents[activePath.value] = raw.content;
    }
}, {deep: true});

function syncDataSink(): void {
    const activeTab = tabs.value.find((t) => t.path === activePath.value);
    const plainTabs = tabs.value.map((t) => ({
        path: String(t.path),
        title: String(t.title),
        pinned: Boolean(t.pinned),
        preview: Boolean(t.preview),
        dirty: Boolean(t.dirty),
        iconClass: String(t.iconClass),
    }));
    const payload = {
        scene: String(props.scene),
        activePath: String(activePath.value),
        editorId: String(currentEditorId.value),
        currentEditorId: String(currentEditorId.value),
        busy: Boolean(busy.value),
        diagnosis: diagnosis.value ? String(diagnosis.value) : null,
        tabs: plainTabs,
        activeTabDirty: Boolean(activeTab?.dirty),
        content: activePath.value ? String(documentContents[activePath.value] ?? "") : "",
    };
    lastEmittedJson = JSON.stringify(payload);
    // 传 JSON 纯对象副本，消除 Vue 响应式 Proxy，彻底避免 LabShell structuredClone 抛 DataCloneError
    updateLabData(JSON.parse(lastEmittedJson));
}
const documentSnapshot = computed<EditorDocumentSnapshot | null>(() => {
    if (!activePath.value) return null;
    const tab = tabs.value.find((t) => t.path === activePath.value);
    if (!tab) return null;

    const content = documentContents[activePath.value] ?? DEFAULT_CONTENTS[activePath.value] ?? "";
    const languageId = activePath.value.endsWith(".json")
        ? "json"
        : activePath.value.endsWith(".md")
            ? "markdown"
            : (activePath.value.endsWith(".ts") ? "typescript" : "plaintext");

    return {
        target: {
            workspaceKey: "lab-editor-workspace", generation: 1,
            documentId: `doc-${encodeURIComponent(activePath.value)}`, path: activePath.value,
        },
        content, languageId, readonly: false,
    };
});

const menus = computed<MenubarMenuData[]>(() => {
    const hasDoc = Boolean(activePath.value);
    const activeTab = tabs.value.find((t) => t.path === activePath.value);
    const resource: EditorResource | null = hasDoc ? {
        path: activePath.value, languageId: activePath.value.endsWith(".md") ? "markdown" : "plaintext", editable: true,
    } : null;
    const availableEditors = resource ? LAB_REGISTRY.available(resource) : [LAB_REGISTRY.get("code")!];

    return [
        {
            id: "file", label: "文件", items: [
                {value: "save", label: "保存", shortcut: "Ctrl+S", disabled: !hasDoc || !activeTab?.dirty},
                {value: "save-all", label: "全部保存", shortcut: "Ctrl+Shift+S", disabled: !tabs.value.some((t) => t.dirty)},
                {value: "close", label: "关闭标签", shortcut: "Ctrl+W", disabled: !hasDoc},
                {value: "close-all", label: "关闭所有标签", disabled: tabs.value.length === 0},
                {value: "reload-config", label: "重新加载打开方式", disabled: false},
            ],
        },
        {
            id: "open-with", label: "打开方式", disabled: !hasDoc,
            items: availableEditors.map((entry) => ({
                value: `editor:${entry.id}`,
                label: entry.id === "code" ? "源码" : (entry.id === "markdown" ? "富文本" : "测试预览视图 (第3视图)"),
                checked: entry.id === currentEditorId.value, type: "checkbox" as const,
            })),
        },
        {
            id: "view-actions", label: "当前视图操作", disabled: !hasDoc,
            items: [
                {value: "action:toggle-comments", label: "批注侧面板", checked: showComments.value, type: "checkbox" as const},
                {value: "action:undo", label: "撤销", shortcut: "Ctrl+Z", disabled: false},
                {value: "action:redo", label: "重做", shortcut: "Ctrl+Y", disabled: false},
            ],
        },
    ];
});

function handleSelectTab(path: string): void {
    activePath.value = path;
    const tab = tabs.value.find((t) => t.path === path);
    if (props.scene !== "multi-view") {
        currentEditorId.value = tab && !tab.pinned && path.endsWith(".md") ? "markdown" : "code";
    }
    emitLabEvent("select-tab", {path});
    syncDataSink();
}

function handleCloseTab(path: string): void {
    const tabToClose = tabs.value.find((t) => t.path === path);
    if (!tabToClose) return;
    if (tabToClose.dirty) {
        closeConfirmTab.value = tabToClose;
        emitLabEvent("intercept-dirty-close", {path});
        return;
    }
    performCloseTab(path);
}

function performCloseTab(path: string): void {
    const index = tabs.value.findIndex((t) => t.path === path);
    if (index === -1) return;
    const remaining = tabs.value.filter((t) => t.path !== path);
    tabs.value = remaining;
    emitLabEvent("close-tab", {path});
    if (activePath.value === path) {
        const nextIndex = Math.min(index, remaining.length - 1);
        activePath.value = remaining[nextIndex]?.path ?? "";
    }
    syncDataSink();
}

function confirmCloseSave(): void {
    if (!closeConfirmTab.value) return;
    const target = closeConfirmTab.value.path;
    saveDocument(target);
    closeConfirmTab.value = null;
    performCloseTab(target);
}

function confirmCloseDiscard(): void {
    if (!closeConfirmTab.value) return;
    const target = closeConfirmTab.value.path;
    tabs.value = tabs.value.map((t) => (t.path === target ? {...t, dirty: false} : t));
    documentContents[target] = DEFAULT_CONTENTS[target] ?? "";
    closeConfirmTab.value = null;
    performCloseTab(target);
}

function cancelClose(): void {
    if (closeConfirmTab.value) {
        emitLabEvent("cancel-close", {path: closeConfirmTab.value.path});
        closeConfirmTab.value = null;
    }
}

function handleSetPin(path: string, pinned: boolean): void {
    tabs.value = tabs.value.map((t) => (t.path === path ? {...t, pinned, preview: false} : t));
    emitLabEvent("set-pin", {path, pinned});
    syncDataSink();
}

function handleKeepTab(path: string): void {
    tabs.value = tabs.value.map((t) => (t.path === path ? {...t, preview: false} : t));
    emitLabEvent("keep-tab", {path});
    syncDataSink();
}

function handleMoveTab(path: string, targetPath: string | null, targetPinned: boolean, position: EditorTabDropPosition): void {
    const sourceIndex = tabs.value.findIndex((t) => t.path === path);
    if (sourceIndex === -1) return;
    const moved = tabs.value[sourceIndex];
    if (!moved) return;

    const nextTabs = tabs.value.filter((t) => t.path !== path);
    const updatedMoved: EditorTabPresentation = {...moved, pinned: targetPinned};

    if (!targetPath) {
        nextTabs.push(updatedMoved);
    } else {
        const targetIndex = nextTabs.findIndex((t) => t.path === targetPath);
        if (targetIndex === -1) nextTabs.push(updatedMoved);
        else nextTabs.splice(position === "before" ? targetIndex : targetIndex + 1, 0, updatedMoved);
    }
    tabs.value = nextTabs;
    emitLabEvent("move-tab", {path, targetPath, targetPinned, position});
    syncDataSink();
}

function handleMenuSelect(item: MenubarItemData): void {
    emitLabEvent("select-menu", {value: item.value, label: item.label});
    if (item.value === "save" && activePath.value) saveDocument(activePath.value);
    else if (item.value === "save-all") tabs.value.filter((t) => t.dirty).forEach((t) => saveDocument(t.path));
    else if (item.value === "close" && activePath.value) handleCloseTab(activePath.value);
    else if (item.value === "close-all") { tabs.value = []; activePath.value = ""; syncDataSink(); }
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
    tabs.value = tabs.value.map((t) => (t.path === path ? {...t, dirty: false} : t));
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

function handleDocumentChange(_target: EditorDocumentTarget, content: string): void {
    if (activePath.value) {
        documentContents[activePath.value] = content;
        const tab = tabs.value.find((t) => t.path === activePath.value);
        if (tab && !tab.dirty) {
            tabs.value = tabs.value.map((t) => (t.path === activePath.value ? {...t, dirty: true} : t));
            syncDataSink();
        }
        emitLabEvent("content-change", {path: activePath.value, length: content.length});
    }
}

function addTab(type: "normal" | "pinned" | "preview"): void {
    const count = tabs.value.length + 1;
    const newPath = `src/draft/note-0${count}.md`;
    documentContents[newPath] = `# 新建笔记 0${count}\n\n这是动态添加的草稿。`;
    tabs.value = [...tabs.value, {
        path: newPath, title: `note-0${count}.md`, pinned: type === "pinned", preview: type === "preview",
        dirty: false, iconClass: "i-lucide-file-text",
    }];
    activePath.value = newPath;
    syncDataSink();
}

const activeTab = computed(() => tabs.value.find((t) => t.path === activePath.value));

const cursorState = ref({line: 1, column: 1, length: 0});
const splitPanePath = ref<string | null>(null);
const splitPaneDirection = ref<EditorSplitDirection | null>(null);

provide("lab-editor-cursor", (line: number, column: number, length: number) => {
    cursorState.value = {line, column, length};
});

function handleSplitTab(path: string, direction: EditorSplitDirection): void {
    splitPanePath.value = path;
    splitPaneDirection.value = direction;
    emitLabEvent("split-tab", {path, direction});
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
    <div class="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--bg-main)] text-[var(--text-main)]">
        <!-- Fixture 场景交互控制：挂载到底部抽屉面板 -->
        <LabFixtureControls>
            <div class="flex shrink-0 flex-wrap items-center justify-between gap-2 text-xs select-none">
                <div class="flex items-center gap-2">
                    <span class="text-[var(--text-secondary)]">受控模式 · 四主题自适应 · 零网络/本地存储</span>
                </div>
                <div class="flex flex-wrap items-center gap-1.5">
                    <button
                        type="button"
                        class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                        @click="addTab('normal')"
                    >
                        + 新建标签
                    </button>
                    <button
                        type="button"
                        class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                        @click="addTab('preview')"
                    >
                        + 预览标签
                    </button>
                    <button
                        type="button"
                        class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                        @click="() => { busy = !busy; syncDataSink(); }"
                    >
                        {{ busy ? "关闭忙碌" : "开启忙碌 (busy)" }}
                    </button>
                    <button
                        type="button"
                        class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                        @click="() => { diagnosis = diagnosis ? null : '打开方式“diagram-viewer”不可用，当前使用源码编辑器。'; syncDataSink(); }"
                    >
                        {{ diagnosis ? "清除诊断" : "模拟未知视图" }}
                    </button>
                    <button
                        v-if="activeTab"
                        type="button"
                        class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                        @click="() => { if (activePath) { tabs = tabs.map((t) => t.path === activePath ? {...t, dirty: !t.dirty} : t); syncDataSink(); } }"
                    >
                        {{ activeTab.dirty ? "清除未保存标记" : "标为未保存 (dirty)" }}
                    </button>
                </div>
            </div>
        </LabFixtureControls>

        <!-- 主体被测试零件：EditorWorkbench 绑定 data-lab-subject -->
        <main class="relative flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
            <EditorWorkbench
                data-lab-subject
                class="flex-1 min-w-0"
                :tabs="tabs"
                :active-path="activePath"
                :menus="menus"
                :busy="busy"
                :diagnosis="diagnosis"
                @select-tab="handleSelectTab"
                @close-tab="handleCloseTab"
                @set-pin="handleSetPin"
                @keep-tab="handleKeepTab"
                @move-tab="handleMoveTab"
                @select-menu="handleMenuSelect"
                @retry="handleRetry"
                @open-as-code="handleOpenAsCode"
                @split-tab="handleSplitTab"
            >
                <template #status>
                    <div class="flex items-center gap-2 px-2 text-[11px]">
                        <span v-if="activeTab?.dirty" class="flex items-center gap-1 font-medium text-[var(--status-warning)]">
                            <span class="h-2 w-2 rounded-full bg-[var(--status-warning)]" />
                            未保存修改
                        </span>
                        <span v-else-if="activePath" class="flex items-center gap-1 text-[var(--text-muted)]">
                            <span class="i-lucide-check h-3.5 w-3.5 text-[var(--status-success)]" />
                            已保存
                        </span>
                    </div>
                </template>

                <template #default>
                    <EditorViewHost
                        v-if="documentSnapshot"
                        :document="documentSnapshot"
                        :registry="LAB_REGISTRY"
                        :editor-id="currentEditorId"
                        @change="handleDocumentChange"
                        @save-request="(_t) => { if (activePath) saveDocument(activePath); }"
                        @focus-change="(_t, f) => emitLabEvent('editor-focus', {focused: f})"
                        @view-error="(_t, m) => { diagnosis = m; emitLabEvent('view-error', {message: m}); }"
                        @handle-ready="(_t, _tk, h) => { activeViewHandle = h; }"
                    />
                </template>

                <template #empty>
                    <EditorWelcome
                        :node="null"
                        :tabs="tabs"
                        @create-chapter="() => addTab('normal')"
                        @create-markdown-file="() => addTab('normal')"
                    />
                </template>
            </EditorWorkbench>

            <!-- 拖拽分屏副视口 -->
            <section
                v-if="splitPanePath"
                class="flex w-80 shrink-0 flex-col border-l border-[var(--divider)] bg-[var(--bg-panel)] overflow-hidden text-xs"
            >
                <header class="flex h-9 shrink-0 items-center justify-between border-b border-[var(--divider)] bg-[var(--panel-surface)] px-3 select-none">
                    <div class="flex items-center gap-1.5 font-medium text-[var(--text-main)] truncate">
                        <span class="i-lucide-columns text-[var(--accent-text)] h-3.5 w-3.5 shrink-0" />
                        <span class="truncate">{{ splitPanePath }} (副屏)</span>
                    </div>
                    <button
                        type="button"
                        class="hover:bg-[var(--bg-hover)] p-1 rounded cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-main)]"
                        title="关闭分屏"
                        @click="splitPanePath = null"
                    >
                        <span class="i-lucide-x h-3.5 w-3.5" />
                    </button>
                </header>
                <div class="flex-1 overflow-y-auto p-3 font-mono text-xs whitespace-pre-wrap text-[var(--text-main)]">
                    {{ documentContents[splitPanePath] || "（空文件）" }}
                </div>
            </section>

            <!-- 脏文件关闭保护确认卡片 -->
            <div
                v-if="closeConfirmTab"
                role="dialog"
                aria-modal="true"
                class="absolute inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--bg-main)_75%,transparent)] backdrop-blur-xs p-4 select-none"
            >
                <div class="flex w-full max-w-sm flex-col gap-3 rounded-[var(--radius-panel)] border border-[var(--divider)] bg-[var(--panel-surface)] p-4 shadow-xl">
                    <div class="flex items-center gap-2 text-sm font-semibold text-[var(--text-main)]">
                        <span class="i-lucide-alert-circle text-[var(--status-warning)] h-4 w-4" />
                        <span>关闭未保存的文件</span>
                    </div>
                    <p class="text-xs text-[var(--text-secondary)] leading-5">
                        文件「<span class="font-medium text-[var(--text-main)]">{{ closeConfirmTab.title }}</span>」包含未保存的修改。关闭前要保存吗？
                    </p>
                    <div class="mt-2 flex items-center justify-end gap-2 text-xs">
                        <button
                            type="button"
                            class="rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-1.5 font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer"
                            @click="cancelClose"
                        >
                            取消
                        </button>
                        <button
                            type="button"
                            class="rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-1.5 font-medium text-[var(--status-error)] hover:bg-[var(--status-error-bg)] cursor-pointer"
                            @click="confirmCloseDiscard"
                        >
                            放弃更改并关闭
                        </button>
                        <button
                            type="button"
                            class="rounded-[var(--radius-control)] bg-[var(--accent-main)] px-3 py-1.5 font-medium text-white hover:opacity-90 cursor-pointer"
                            @click="confirmCloseSave"
                        >
                            保存并关闭
                        </button>
                    </div>
                </div>
            </div>
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
                    v-if="splitPanePath"
                    :label="`分屏: ${splitPanePath}`"
                    icon-class="i-lucide-columns"
                    @click="splitPanePath = null"
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
