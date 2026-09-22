import {createPinia, defineStore, setActivePinia} from "pinia";
import {computed, ref, watch} from "vue";
import {describe, expect, it, vi} from "vitest";
import type {WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import type {EditorChangeRequest} from "nbook/app/components/editor-workbench/editor-view.types";
import type {GridAxis, GridBranchChange, GridGestureCommit} from "@notnotype/nb-ui/layout";

function node(path: string): WorkspaceFileNode {
    return {path, title: path, absolutePath: path, mode: "file", entryType: null, icon: null, status: null, words: 0, refs: [], isDirectory: false, hasIndex: false, contentNode: false, summary: "", frontmatter: {}, frontmatterError: null, state: null, size: 0, mtimeMs: 1, editable: true};
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {resolve = done;});
    return {promise, resolve};
}
type Request = {query?: {path?: string; projectRoot?: string}; body?: {path?: string; content?: string}};
async function setup(handler?: (url: string, request: Request) => unknown) {
    Object.assign(globalThis, {defineStore, ref, computed, watch, piniaPluginPersistedstate: {sessionStorage: () => ({})}});
    setActivePinia(createPinia());
    const fetch = vi.fn(async (url: string, request: Request = {}) => {
        const custom = handler?.(url, request);
        if (custom !== undefined) return custom;
        if (url.endsWith("/tree")) return {nodes: [node("a.md"), node("b.json")], issues: [], revision: 1};
        if (url.endsWith("/stat")) return node(request.query?.path ?? "a.md");
        if (url.endsWith("/read")) return {content: request.query?.projectRoot ?? "original", mtimeMs: 1};
        if (url.endsWith("/write")) return {...node(request.body?.path ?? "a.md"), mtimeMs: 2};
        throw new Error(url);
    });
    Object.assign(globalThis, {$fetch: fetch});
    // store使用Nuxt自动导入全局，必须先安装再加载模块求值。
    const {useNovelIdeStore} = await import("nbook/app/stores/novel-ide");
    const store = useNovelIdeStore();
    store.currentProjectRoot = "A";
    return {store, fetch};
}
/**
 * 播种一份会话记忆（sessionStorage 形状），随后由恢复流程消费。
 *
 * 先离开当前 Project：`switchToNovelWorkspace` 会把**当前**会话写回它自己的键，
 * 若种子先写就会在切换时被空会话覆盖。
 */
async function seedSessionForProject(
    store: Awaited<ReturnType<typeof setup>>["store"],
    tabs: Array<{path: string; title?: string; editorId?: string | null}>,
    activePath: string,
    buffers: Record<string, {content: string; lastSyncedContent: string}>,
): Promise<void> {
    await store.switchToNovelWorkspace("seed");
    store.workspaceSessions["novel:A"] = {
        activeWorkspaceTabPath: activePath,
        workspaceTabs: tabs.map((tab) => ({path: tab.path, title: tab.title ?? tab.path, editorGroupId: "main", editorId: tab.editorId ?? null, pinned: false, preview: false, dirty: false})),
        workspaceBuffers: Object.fromEntries(Object.entries(buffers).map(([path, buffer]) => [path, {node: node(path), content: buffer.content, lastSyncedContent: buffer.lastSyncedContent, lastSyncedMtimeMs: 1, contentRevision: 1}])),
        monacoFontSizeOverridesByPath: {},
    };
}

describe("编辑器文档生命周期", () => {
    it("恢复请求被用户打开取代后仍结束恢复门禁", async () => {
        const delayed = deferred<{content: string; mtimeMs: number}>();
        const {store} = await setup((url, request) => url.endsWith("/read") && request.query?.path === "a.md" ? delayed.promise : undefined);
        await seedSessionForProject(store, [{path: "a.md"}], "a.md", {"a.md": {content: "disk", lastSyncedContent: "disk"}});
        const restoring = store.switchToNovelWorkspace("A");
        await vi.waitFor(() => expect(store.restoringWorkspaceFile).toBe(true));
        await store.openWorkspaceNode(node("b.json"), "permanent");
        delayed.resolve({content: "late restored", mtimeMs: 1});
        await restoring;
        expect(store.selectedFilePath).toBe("b.json");
        expect(store.restoringWorkspaceFile).toBe(false);
        expect(store.workspaceReady).toBe(true);
    });

    it("旧标签源码模式转换为code且保留dirty正文和固定状态", async () => {
        const {store} = await setup();
        await seedSessionForProject(store, [{path: "a.md", title: "A", editorId: null}], "a.md", {"a.md": {content: "unsaved original", lastSyncedContent: "disk"}});
        const legacyTab = store.workspaceSessions["novel:A"]!.workspaceTabs[0] as unknown as Record<string, unknown>;
        delete legacyTab.editorId;
        legacyTab.editorKind = "markdown";
        legacyTab.viewMode = "source";
        legacyTab.pinned = true;
        await store.switchToNovelWorkspace("A");
        expect(store.workspaceTabs[0]).toEqual({path: "a.md", title: "a.md", editorGroupId: "main", editorId: "code", pinned: true, preview: false, dirty: true});
        expect(store.selectedFileContent).toBe("unsaved original");
    });

    it("最后一次打开拥有激活权，旧read不能覆盖新文件", async () => {
        const delayed = deferred<{content: string; mtimeMs: number}>();
        const {store} = await setup((url, request) => url.endsWith("/read") && request.query?.path === "a.md" ? delayed.promise : undefined);
        const first = store.openWorkspaceNode(node("a.md"), "permanent");
        await store.openWorkspaceNode(node("b.json"), "permanent");
        delayed.resolve({content: "old A", mtimeMs: 1});
        await first;
        expect(store.selectedFilePath).toBe("b.json");
        expect(store.selectedFileContent).toBe("A");
    });

    it("切文档前结算输入，旧登记清理不能移除新句柄", async () => {
        const {store} = await setup();
        await store.openWorkspaceNode(node("a.md"), "permanent");
        const target = store.activeWorkspaceDocumentTarget!;
        const oldCleanup = store.registerEditorFlush(target, "old", () => {
            store.updateWorkspaceDocument(target, "old");
            return "settled";
        });
        store.registerEditorFlush(target, "current", () => {
            store.updateWorkspaceDocument(target, "last input");
            return "settled";
        });
        oldCleanup();
        expect(store.flushEditorPending()).toBe("settled");
        await store.openWorkspaceNode(node("b.json"), "permanent");
        expect(store.workspaceBuffers["a.md"]?.content).toBe("last input");
        expect(store.workspaceTabs.find((tab) => tab.path === "a.md")?.dirty).toBe(true);
    });

    it("保存中继续输入仍dirty且磁盘确认仅推进提交内容", async () => {
        const write = deferred<WorkspaceFileNode>();
        const {store} = await setup((url) => url.endsWith("/write") ? write.promise : undefined);
        await store.openWorkspaceNode(node("a.md"), "permanent");
        const target = store.activeWorkspaceDocumentTarget!;
        store.updateWorkspaceDocument(target, "submitted");
        const saving = store.saveCurrentFile();
        store.updateWorkspaceDocument(target, "new typing");
        write.resolve({...node("a.md"), mtimeMs: 2});
        await saving;
        expect(store.selectedFileContent).toBe("new typing");
        expect(store.lastSyncedFileContent).toBe("submitted");
        expect(store.workspaceTabs[0]?.dirty).toBe(true);
    });

    it("跨项目同路径旧保存不能覆盖新内容或结束新保存", async () => {
        const oldWrite = deferred<WorkspaceFileNode>();
        let delayed = true;
        const {store} = await setup((url) => url.endsWith("/write") && delayed ? oldWrite.promise : undefined);
        await store.openWorkspaceNode(node("a.md"), "permanent");
        const oldTarget = store.activeWorkspaceDocumentTarget!;
        store.updateWorkspaceDocument(oldTarget, "submitted A");
        const saving = store.saveCurrentFile();
        await store.switchToNovelWorkspace("B");
        await store.openWorkspaceNode(node("a.md"), "permanent");
        oldWrite.resolve({...node("a.md"), mtimeMs: 99});
        await saving;
        expect(store.selectedFileContent).toBe("B");
        expect(store.lastSyncedFileContent).toBe("B");
        expect(store.updateWorkspaceDocument(oldTarget, "late callback")).toBe(false);
        delayed = false;
    });

    it("同路径关闭再打开使旧句柄失效且旧buffer不复活", async () => {
        const {store} = await setup();
        await store.openWorkspaceNode(node("a.md"), "permanent");
        const oldTarget = store.activeWorkspaceDocumentTarget!;
        store.updateWorkspaceDocument(oldTarget, "discarded");
        await store.closeWorkspaceTab("main", "a.md", true);
        await store.openWorkspaceNode(node("a.md"), "permanent");
        expect(store.activeWorkspaceDocumentTarget?.documentId).not.toBe(oldTarget.documentId);
        expect(store.selectedFileContent).toBe("A");
        expect(store.updateWorkspaceDocument(oldTarget, "late")).toBe(false);
    });

    it("恢复dirty缓存不被forceDisk或读取失败覆盖", async () => {
        const {store, fetch} = await setup();
        await seedSessionForProject(store, [{path: "a.md"}], "a.md", {"a.md": {content: "unsaved", lastSyncedContent: "disk"}});
        await store.switchToNovelWorkspace("A");
        await store.switchToNovelWorkspace("B");
        fetch.mockImplementation(async (url: string) => {
            if (url.endsWith("/tree")) return {nodes: [], issues: [], revision: 2};
            throw new Error("offline");
        });
        await store.switchToNovelWorkspace("A");
        expect(store.selectedFileContent).toBe("unsaved");
        expect(store.workspaceTabs[0]?.dirty).toBe(true);
    });

    it("关闭前先flush，尚未上报输入不能被当作干净标签关闭", async () => {
        const {store} = await setup();
        await store.openWorkspaceNode(node("a.md"), "permanent");
        const target = store.activeWorkspaceDocumentTarget!;
        store.registerEditorFlush(target, "view-1", () => {
            store.updateWorkspaceDocument(target, "last keystroke");
            return "settled";
        });
        await store.closeWorkspaceTab("main", "a.md");
        expect(store.workspaceTabs[0]?.path).toBe("a.md");
        expect(store.selectedFileContent).toBe("last keystroke");
    });
});

describe("编辑组与内容回执", () => {
    it("同文档两组各自提交，关闭一个实例后另一个继续可写", async () => {
        const {store} = await setup();
        await store.openWorkspaceNode(node("a.md"), "permanent");
        expect(store.splitEditorTab({sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "a.md", direction: "right", mode: "copy"})).toBe(true);
        expect(store.editorGroups.map((group) => group.id)).toEqual(["main", "g2"]);
        const second = store.editorGroups[1]!;
        expect(second.activePath).toBe("a.md");
        expect(store.workspaceBuffers["a.md"]).toBeDefined();

        // 第二组提交：基线取自当前修订 ⇒ 受理。
        const revision = store.workspaceBuffers["a.md"]!.contentRevision;
        const accepted = store.commitEditorChange({target: store.activeWorkspaceDocumentTarget!, token: "t2", baseRevision: revision, content: "from second group"});
        expect(accepted.status).toBe("accepted");
        expect(store.workspaceBuffers["a.md"]?.content).toBe("from second group");
        expect(store.workspaceBuffers["a.md"]?.contentRevision).toBe(revision + 1);

        // 关闭第二组实例：文档仍被第一组引用，缓冲不能被释放。
        await store.closeWorkspaceTab("g2", "a.md", true);
        expect(store.editorGroups.map((group) => group.id)).toEqual(["main"]);
        expect(store.workspaceBuffers["a.md"]?.content).toBe("from second group");
    });

    it("落后基线的候选记为未解决输入，不覆盖权威正文", async () => {
        const {store} = await setup();
        await store.openWorkspaceNode(node("a.md"), "permanent");
        const target = store.activeWorkspaceDocumentTarget!;
        const stale: EditorChangeRequest = {target, token: "slow", baseRevision: store.workspaceBuffers["a.md"]!.contentRevision, content: "candidate"};
        store.updateWorkspaceDocument(target, "authoritative");

        const conflicted = store.commitEditorChange(stale);
        expect(conflicted.status).toBe("conflict");
        expect(store.workspaceBuffers["a.md"]?.content).toBe("authoritative");
        expect(store.unresolvedEditorChanges.map((item) => item.token)).toEqual(["slow"]);
        expect(store.hasUnresolvedEditorChanges).toBe(true);

        // 保留此视图内容：用最新修订重提一次 ⇒ 受理并清登记。
        const retried = store.commitEditorChange({...stale, baseRevision: store.workspaceBuffers["a.md"]!.contentRevision});
        expect(retried.status).toBe("accepted");
        expect(store.workspaceBuffers["a.md"]?.content).toBe("candidate");
        expect(store.hasUnresolvedEditorChanges).toBe(false);
    });

    it("采用当前正文会丢弃候选登记，未解决输入阻止保存", async () => {
        const {store} = await setup();
        await store.openWorkspaceNode(node("a.md"), "permanent");
        const target = store.activeWorkspaceDocumentTarget!;
        store.updateWorkspaceDocument(target, "authoritative");
        const request: EditorChangeRequest = {target, token: "slow", baseRevision: 0, content: "candidate"};
        expect(store.commitEditorChange(request).status).toBe("conflict");

        expect(await store.saveCurrentFile()).toBeNull();
        expect(store.readUnresolvedEditorChange("slow")?.content).toBe("candidate");
        store.discardUnresolvedEditorChange("slow");
        expect(store.hasUnresolvedEditorChanges).toBe(false);
        expect(store.workspaceBuffers["a.md"]?.content).toBe("authoritative");
    });

    it("旧代次目标的回执是stale，不产生登记", async () => {
        const {store} = await setup();
        await store.openWorkspaceNode(node("a.md"), "permanent");
        const target = store.activeWorkspaceDocumentTarget!;
        await store.closeWorkspaceTab("main", "a.md", true);
        expect(store.commitEditorChange({target, token: "t", baseRevision: 1, content: "x"}).status).toBe("stale");
        expect(store.hasUnresolvedEditorChanges).toBe(false);
    });

    it("preview 顶替只发生在目标组内，别组同路径的缓冲不被释放", async () => {
        const {store} = await setup();
        await store.openWorkspaceNode(node("a.md"), "preview");
        expect(store.splitEditorTab({sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "a.md", direction: "right", mode: "copy"})).toBe(true);

        // 第一组里的 preview a.md 被新 preview 顶替；第二组仍引用 a.md，缓冲必须存活。
        await store.openWorkspaceNodeInGroup("main", node("b.json"), "preview");
        expect(store.editorGroups.find((group) => group.id === "main")?.tabs.map((tab) => tab.path)).toEqual(["b.json"]);
        expect(store.editorGroups.find((group) => group.id === "g2")?.tabs.map((tab) => tab.path)).toEqual(["a.md"]);
        expect(store.workspaceBuffers["a.md"]?.content).toBe("A");
    });

    it("分屏被几何拒绝时不产生半更新", async () => {
        const {store} = await setup();
        await store.openWorkspaceNode(node("a.md"), "permanent");
        expect(store.splitEditorTab({sourceGroupId: "main", targetGroupId: "main", newGroupId: "main", path: "a.md", direction: "right", mode: "copy"})).toBe(false);
        expect(store.editorGroups.map((group) => group.id)).toEqual(["main"]);
        expect(store.editorGroups[0]!.tabs.map((tab) => tab.path)).toEqual(["a.md"]);
    });

    it("跨组移动在目标已有同路径时只保留一个引用", async () => {
        const {store} = await setup();
        await store.openWorkspaceNode(node("a.md"), "permanent");
        expect(store.splitEditorTab({sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "a.md", direction: "right", mode: "copy"})).toBe(true);
        expect(store.editorGroups.map((group) => group.id)).toEqual(["main", "g2"]);

        expect(store.transferEditorTab({sourceGroupId: "main", targetGroupId: "g2", path: "a.md"})).toBe(true);
        expect(store.editorGroups.map((group) => group.id)).toEqual(["g2"]);
        expect(store.editorGroups[0]!.tabs.map((tab) => tab.path)).toEqual(["a.md"]);
        expect(store.workspaceBuffers["a.md"]?.content).toBe("A");
    });
});

const GESTURE_CONTAINER = {width: 900, height: 600};

/** 提交里某个分支的变化：baseline/target 是该分支直接子节点的 px；其余字段只是提交结构。 */
function gestureChange(branchId: string, axis: GridAxis, baseline: Record<string, number>, target: Record<string, number>): GridBranchChange {
    return {branchId, axis, baseline, target, extent: GESTURE_CONTAINER, active: Object.keys(target), compensated: [], collapsed: {}};
}

/** 一次按下产出的提交：交汇处的两根轴属于同一场手势、走同一个 `changes`。 */
function gestureCommit(contextKey: string, ...changes: GridBranchChange[]): GridGestureCommit {
    return {sessionId: "session-1", contextKey, source: "pointer", revision: 0, extent: GESTURE_CONTAINER, changes};
}

describe("编辑区分栏手势落账", () => {
    /** 主区左右分屏后再把右侧上下分屏：`branch-side` 与 `branch-bottom` 在交汇处正交。 */
    async function splitTwice() {
        const {store} = await setup();
        await store.openWorkspaceNode(node("a.md"), "permanent");
        store.setEditorExtent(GESTURE_CONTAINER);
        expect(store.splitEditorTab({sourceGroupId: "main", targetGroupId: "main", newGroupId: "side", path: "a.md", direction: "right", mode: "copy"})).toBe(true);
        expect(store.splitEditorTab({sourceGroupId: "side", targetGroupId: "side", newGroupId: "bottom", path: "a.md", direction: "bottom", mode: "copy"})).toBe(true);
        return store;
    }

    it("一场手势一次落账：两根轴一起改，修订只推进一次", async () => {
        const store = await splitTwice();
        expect(store.editorLayout.sizes.main?.width).toBeCloseTo(449.5);
        expect(store.editorLayout.sizes.side?.height).toBeCloseTo(299.5);
        const before = store.editorSessionRevision;

        const applied = store.commitEditorGesture(gestureCommit(store.currentWorkspaceRoot,
            gestureChange("branch-side", "width", {main: 449.5, "branch-bottom": 449.5}, {main: 600, "branch-bottom": 299}),
            gestureChange("branch-bottom", "height", {side: 299.5, bottom: 299.5}, {side: 200, bottom: 399}),
        ));

        expect(applied).toEqual({ok: true});
        expect(store.editorSessionRevision).toBe(before + 1);
        expect(store.editorLayout.sizes.main?.width).toBeCloseTo(600);
        expect(store.editorLayout.sizes["branch-bottom"]?.width).toBeCloseTo(299);
        expect(store.editorLayout.sizes.side?.height).toBeCloseTo(200);
        expect(store.editorLayout.sizes.bottom?.height).toBeCloseTo(399);
    });

    it("整批里任一项失败或工作面已过期时不落账，也不推进修订", async () => {
        const store = await splitTwice();
        const revision = store.editorSessionRevision;
        const width = store.editorLayout.sizes.main?.width;
        const valid = gestureChange("branch-side", "width", {main: 449.5, side: 449.5}, {main: 300, side: 599});

        // 第二项引用未知分支：整批不落账（第一项也不生效）。
        expect(store.commitEditorGesture(gestureCommit(store.currentWorkspaceRoot, valid, gestureChange("ghost", "width", {main: 1, side: 1}, {main: 1, side: 1}))).ok).toBe(false);
        // 旧工作面的提交：拒绝。
        expect(store.commitEditorGesture(gestureCommit(`${store.currentWorkspaceRoot}:stale`, valid)).ok).toBe(false);

        expect(store.editorSessionRevision).toBe(revision);
        expect(store.editorLayout.sizes.main?.width).toBeCloseTo(width!);
    });
});
