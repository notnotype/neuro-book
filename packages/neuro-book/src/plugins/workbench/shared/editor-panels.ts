/**
 * 编辑组的结构（docs/specs/ui/workbench-layout.md 输出 33）：工作台的布局文档持有编辑组、标签顺序、活动标签与活动编辑组，编辑器只持有标签的属性（地址、编辑器、固定、光标），
 * 两边靠 `tabId` 对上。这是编辑器改结构的唯一入口，语义就是 nb-layout 的领域操作加上“只认编辑组”这一条。
 *
 * 纯 TS（只用 `@vue/reactivity`）：编辑器的模型在 Bun 里直接测。`createMemoryEditorPanels` 是没有工作台的场合（单元测试、Lab 夹具）用的同一份操作，只是文档放在内存里。
 */

import {computed, shallowRef} from "@vue/reactivity";

import {activateTab, findTab, findTreeNode, GRID_SNAPSHOT_VERSION, insertTab, LAYOUT_DOC_VERSION, moveTabToEdge, moveTabToStrip, openPanelAtEdge, panelRef, removeTab, replaceTab, setCurrentEditor, treeLeaves} from "@notnotype/nb-layout";
import type {LayoutDoc, LayoutEdgeTarget, LayoutPolicy, LayoutResult, TabRef} from "@notnotype/nb-layout";

import {editorTabKey} from "./contracts";
import type {EditorPanels, EditorPanelsService, PanelEntry, PanelTabs, PanelTree} from "./contracts";

/** 布局文档里编辑器标签的类型：动态标签类型只给内置插件（“边界与兼容”）。 */
export const EDITOR_TAB_TYPE = "editor";
const TAB_KEY_PREFIX = "tab:";

const refOf = (tabId: string): TabRef => ({kind: "tab", type: EDITOR_TAB_TYPE, tabId});
/** 标签键对应的编辑器标签 id；工具视图的键是 null。 */
export const editorTabIdOf = (key: string): string | null => (key.startsWith(TAB_KEY_PREFIX) ? key.slice(TAB_KEY_PREFIX.length) : null);

/** 布局文档的持有者：工作台的布局 store，或内存。 */
export interface EditorLayoutHost {
    document(): LayoutDoc;
    /** 画出来的文档：拖动中可能是预览；缺省就是 `document`。 */
    rendered?(): LayoutDoc;
    /** `flush`：立刻存（手势）；缺省合并着存（打开、关闭、切标签）。 */
    apply(operation: (current: LayoutDoc) => LayoutResult, options?: {readonly flush?: boolean}): LayoutResult;
    readonly policy: LayoutPolicy;
}

const isEditor = (doc: LayoutDoc, id: string): boolean => doc.panels[id]?.role === "editor";

/** 编辑组，按树序：换一个组时“相邻”按这个顺序算（docs/specs/workbench/editor.md 输出 3）。 */
function editorEntries(doc: LayoutDoc): ReadonlyArray<PanelEntry> {
    return treeLeaves(doc.tree.root).flatMap((leaf): PanelEntry[] => {
        const panel = doc.panels[leaf.id];
        if (panel?.role !== "editor") return [];
        return [{id: leaf.id, tabs: panel.tabs.flatMap((tab) => (tab.kind === "tab" ? [tab.tabId] : [])), active: panel.active === null ? null : editorTabIdOf(panel.active)}];
    });
}

/**
 * 叶 `id` 右侧相邻的编辑组：自下而上看横向分支里排在它后面的兄弟，取里面树序第一个编辑组。
 */
function rightEditor(doc: LayoutDoc, id: string): string | null {
    type Node = LayoutDoc["tree"]["root"];
    const path: Node[] = [];
    const walk = (node: Node): boolean => {
        path.push(node);
        if (node.kind === "leaf" ? node.id === id : node.children.some(walk)) return true;
        path.pop();
        return false;
    };
    if (!walk(doc.tree.root)) return null;
    for (let at = path.length - 2; at >= 0; at -= 1) {
        const branch = path[at] as Node;
        if (branch.kind !== "branch" || branch.orientation !== "horizontal") continue;
        for (const sibling of branch.children.slice(branch.children.indexOf(path[at + 1] as Node) + 1)) {
            const found = treeLeaves(sibling).find((leaf) => isEditor(doc, leaf.id));
            if (found !== undefined) return found.id;
        }
    }
    return null;
}

const notFound = (detail: string): LayoutResult => ({ok: false, code: "not-found", detail});

export function createEditorPanels(host: EditorLayoutHost): EditorPanels {
    const panels = computed(() => editorEntries(host.document()));
    const shownPanels = computed(() => editorEntries(host.rendered?.() ?? host.document()));
    const current = computed(() => {
        const doc = host.document();
        // 文档校验保证有编辑组；活动编辑组没记下时（新文档）取树序第一个。
        return doc.currentEditor !== null && isEditor(doc, doc.currentEditor) ? doc.currentEditor : (panels.value[0]?.id ?? "");
    });
    const ok = (operation: (doc: LayoutDoc) => LayoutResult, options?: {readonly flush?: boolean}): boolean => host.apply(operation, options).ok;

    const tabs: PanelTabs = {
        panels,
        shownPanels,
        insert: (panel, tabId, index) => ok((doc) => (isEditor(doc, panel) ? insertTab(doc, {panel, tab: refOf(tabId), index}) : notFound(panel))),
        replace: (tabId, next) => ok((doc) => replaceTab(doc, {tab: editorTabKey(tabId), next: refOf(next)})),
        remove: (tabId) => ok((doc) => removeTab(doc, editorTabKey(tabId))),
        activate: (tabId) => ok((doc) => activateTab(doc, editorTabKey(tabId))),
        move: (tabId, panel, index, options) => ok((doc) => (isEditor(doc, panel) ? moveTabToStrip(doc, {tab: editorTabKey(tabId), panel, index, ...(options?.activate === undefined ? {} : {activate: options.activate})}, host.policy) : notFound(panel)), {flush: true}),
        moveToEdge: (tabId, target) => {
            const key = editorTabKey(tabId);
            let moved = false;
            const result = host.apply((doc) => {
                const next = moveTabToEdge(doc, {tab: key, target}, host.policy);
                moved = next.ok && next.doc !== doc;
                return next;
            }, {flush: true});
            return result.ok && moved ? (findTab(host.document(), key)?.panel ?? null) : null;
        },
    };
    const tree: PanelTree = {
        current,
        setCurrent: (panel) => ok((doc) => setCurrentEditor(doc, panel)),
        openAtEdge: (panel, edge) => {
            const id = host.policy.newId("panel");
            // 命令的拆分只分被拆的那一块；拖到两块之间才从两块取（输出 25 规则 4），那是 `moveToEdge` 的目标。
            const target: LayoutEdgeTarget = {kind: "split", panel, edge};
            return ok((doc) => (isEditor(doc, panel) ? openPanelAtEdge(doc, {id, panel: {role: "editor", tabs: [], active: null}, target, activate: false}, host.policy) : notFound(panel))) ? id : null;
        },
        rightOf: (panel) => rightEditor(host.document(), panel),
    };
    return {tabs, tree};
}

export interface MemoryEditorPanels extends EditorPanelsService {
    document(): LayoutDoc;
    /** 直接改文档：Lab 夹具落账拖缝的手势用。 */
    apply(operation: (current: LayoutDoc) => LayoutResult): LayoutResult;
}

/** 一块空编辑组的文档。 */
function firstDoc(): LayoutDoc {
    return {
        version: LAYOUT_DOC_VERSION,
        tree: {version: GRID_SNAPSHOT_VERSION, root: {kind: "leaf", id: "g0", ref: panelRef("g0"), size: {width: 1000, height: 600}}},
        panels: {g0: {role: "editor", tabs: [], active: null}},
        floats: [],
        hiddenBars: [],
        currentEditor: "g0",
    };
}

/** 文档放在内存里的实现（单元测试、Lab 夹具）：操作和工作台的是同一份，接受矩阵不限，它们只有编辑组。 */
export function createMemoryEditorPanels(seed: LayoutDoc = firstDoc()): MemoryEditorPanels {
    const doc = shallowRef(seed);
    let counter = 0;
    const policy: LayoutPolicy = {
        accepts: () => true,
        // 文档可能是恢复出来的：跳过已有的 id。
        newId: (kind) => {
            for (;;) {
                counter += 1;
                const id = `${kind === "panel" ? "g" : "b"}${String(counter)}`;
                if (findTreeNode(doc.value.tree.root, id) === null) return id;
            }
        },
    };
    const apply = (operation: (current: LayoutDoc) => LayoutResult): LayoutResult => {
        const result = operation(doc.value);
        if (result.ok) doc.value = result.doc;
        return result;
    };
    const panels = createEditorPanels({document: () => doc.value, apply, policy});
    return {...panels, ready: shallowRef(true), acceptSaveGate: () => undefined, flush: () => undefined, document: () => doc.value, apply};
}
