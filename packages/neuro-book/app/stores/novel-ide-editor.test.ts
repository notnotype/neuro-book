import {createPinia, defineStore, setActivePinia} from "pinia";
import {computed, ref, watch} from "vue";
import {describe, expect, it, vi} from "vitest";
import type {WorkspaceFileNode} from "nbook/app/stores/novel-ide";

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

describe("编辑器文档生命周期", () => {
    it("恢复请求被用户打开取代后仍结束恢复门禁", async () => {
        const delayed = deferred<{content: string; mtimeMs: number}>();
        const {store} = await setup((url, request) => url.endsWith("/read") && request.query?.path === "a.md" ? delayed.promise : undefined);
        store.workspaceTabs = [{path: "a.md", title: "A", editorId: null, editorGroupId: "main", pinned: false, preview: false, dirty: false}];
        store.activeWorkspaceTabPath = "a.md";
        const restoring = store.restoreWorkspaceTabFromPersistedState();
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
        const file = node("a.md");
        const legacySession = {
            activeWorkspaceTabPath: "a.md",
            workspaceTabs: [{path: "a.md", title: "A", editorKind: "markdown", viewMode: "source", pinned: true, preview: false, dirty: true}],
            workspaceBuffers: {"a.md": {node: file, content: "unsaved original", lastSyncedContent: "disk", lastSyncedMtimeMs: 1}},
            monacoFontSizeOverridesByPath: {},
        };
        store.workspaceSessions["novel:legacy"] = legacySession as never;
        await store.switchToNovelWorkspace("legacy");
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

    it("结算最后输入后切文件，旧登记清理不能移除新句柄", async () => {
        const {store} = await setup();
        await store.openWorkspaceNode(node("a.md"), "permanent");
        const target = store.activeWorkspaceDocumentTarget!;
        const oldCleanup = store.registerActiveEditorFlush(target, () => store.updateWorkspaceDocument(target, "old"));
        store.registerActiveEditorFlush(target, () => store.updateWorkspaceDocument(target, "last input"));
        oldCleanup();
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
        await store.closeWorkspaceTab("a.md", true);
        await store.openWorkspaceNode(node("a.md"), "permanent");
        expect(store.activeWorkspaceDocumentTarget?.documentId).not.toBe(oldTarget.documentId);
        expect(store.selectedFileContent).toBe("A");
        expect(store.updateWorkspaceDocument(oldTarget, "late")).toBe(false);
    });

    it("恢复dirty缓存不被forceDisk或读取失败覆盖", async () => {
        const {store, fetch} = await setup();
        await store.openWorkspaceNode(node("a.md"), "permanent");
        store.updateWorkspaceDocument(store.activeWorkspaceDocumentTarget!, "unsaved");
        store.persistWorkspaceSession();
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
        store.registerActiveEditorFlush(target, () => store.updateWorkspaceDocument(target, "last keystroke"));
        await store.closeWorkspaceTab("a.md");
        expect(store.workspaceTabs[0]?.path).toBe("a.md");
        expect(store.selectedFileContent).toBe("last keystroke");
    });
});
