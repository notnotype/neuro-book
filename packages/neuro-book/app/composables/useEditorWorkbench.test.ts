// @vitest-environment jsdom
import {createPinia, defineStore, setActivePinia} from "pinia";
import {computed, defineComponent, h, nextTick, ref, watch} from "vue";
import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";
import type {BuiltinEditorBindings} from "nbook/app/utils/editor-workbench/builtin-editors";
import type {WorkspaceFileNode} from "nbook/app/stores/novel-ide";

/** 编辑器配置首读：默认已就绪；用例可置空以复现"解析晚于缓冲到达"。 */
const settingsRef = ref<{associations: Record<string, string>; languageAssociations: Record<string, string>} | null>({associations: {".md": "markdown"}, languageAssociations: {}});
vi.mock("nbook/app/composables/useEditorConfiguration", () => ({useEditorConfiguration: () => ({
    settings: settingsRef, loading: ref(false), diagnosis: ref(null), reload: vi.fn(),
})}));
vi.mock("nbook/app/utils/editor-workbench/builtin-editors", () => ({createBuiltinEditorContributions: () => ["code", "markdown"].map((id) => ({id, titleKey: id, iconClass: "", supports: () => true, render: () => h("div")}))}));
vi.mock("nbook/app/components/markdown-studio/load-monaco-editor", () => ({loadMonacoEditor: async () => ({languages: {getLanguages: () => [{id: "markdown"}]}})}));

const file: WorkspaceFileNode = {path: "a.md", title: "A", absolutePath: "a.md", mode: "file", entryType: null, icon: null, status: null, words: 0, refs: [], isDirectory: false, hasIndex: false, contentNode: false, summary: "", frontmatter: {}, frontmatterError: null, state: null, size: 0, mtimeMs: 1, editable: true};
let dispose = () => {};
afterEach(() => dispose());
async function setup(choice: string, failWrite = false) {
    Object.assign(globalThis, {defineStore, ref, computed, watch, piniaPluginPersistedstate: {sessionStorage: () => ({})}, useI18n: () => ({t: (key: string) => key})});
    setActivePinia(createPinia());
    const fetch = vi.fn(async (url: string) => {
        if (url.endsWith("/read")) return {content: "disk", mtimeMs: 1};
        if (url.endsWith("/tree")) return {nodes: [file], issues: [], revision: 1};
        if (url.endsWith("/stat")) return file;
        if (url.endsWith("/write")) {
            if (failWrite) throw new Error("disk unavailable");
            return {...file, mtimeMs: 2};
        }
        throw new Error(url);
    });
    Object.assign(globalThis, {$fetch: fetch});
    // Nuxt store auto-import globals必须先安装，再加载模块求值。
    const {useNovelIdeStore} = await import("nbook/app/stores/novel-ide");
    const store = useNovelIdeStore();
    store.currentProjectRoot = "A";
    await store.openWorkspaceNode(file, "permanent");
    const {useEditorWorkbench} = await import("./useEditorWorkbench");
    const wrapper = mount(defineComponent({setup() {
        const workbench = useEditorWorkbench({bindings: {} as BuiltinEditorBindings, chooseClose: async () => choice});
        return {workbench};
    }, render: () => h("div")}));
    const workbench = wrapper.vm.workbench;
    dispose = () => wrapper.unmount();
    await flushPromises();
    return {store, workbench, fetch};
}
/** 视图句柄替身：flush 把待上报输入写进 Store，与真实实例的回执形状一致。 */
function viewHandle(store: Awaited<ReturnType<typeof setup>>["store"]) {
    const target = store.activeWorkspaceDocumentTarget!;
    return {
        handle: {
            focus: vi.fn(),
            flushPendingChange: () => {
                store.updateWorkspaceDocument(target, "pending input");
                return "settled" as const;
            },
        },
        target,
    };
}

describe("编辑器编排", () => {
    it("切换视图结算输入，不读磁盘、不隐式保存", async () => {
        const {store, workbench, fetch} = await setup("cancel");
        const {handle, target} = viewHandle(store);
        workbench.bindViewHandle("main", target, "1", handle);
        fetch.mockClear();
        await workbench.switchEditor("main", "code");
        expect(store.selectedFileContent).toBe("pending input");
        expect(store.workspaceTabs[0]?.editorId).toBe("code");
        expect(fetch).not.toHaveBeenCalled();
    });
    it("保存失败选择关闭仍保留dirty正文与可见错误", async () => {
        const {store, workbench} = await setup("save", true);
        store.updateWorkspaceDocument(store.activeWorkspaceDocumentTarget!, "unsaved");
        await nextTick();
        await workbench.closeTab("main", "a.md");
        expect(store.selectedFileContent).toBe("unsaved");
        expect(store.workspaceTabs[0]?.dirty).toBe(true);
        expect(workbench.presentationOf("main").diagnosis).toContain("disk unavailable");
    });
    it("取消保留文档，明确放弃才允许丢弃", async () => {
        const cancelled = await setup("cancel");
        cancelled.store.updateWorkspaceDocument(cancelled.store.activeWorkspaceDocumentTarget!, "unsaved");
        await cancelled.workbench.closeTab("main", "a.md");
        expect(cancelled.store.selectedFileContent).toBe("unsaved");
        dispose();
        const discarded = await setup("discard");
        discarded.store.updateWorkspaceDocument(discarded.store.activeWorkspaceDocumentTarget!, "unsaved");
        await discarded.workbench.closeTab("main", "a.md");
        expect(discarded.store.workspaceTabs).toEqual([]);
        expect(discarded.store.selectedFilePath).toBe("");
    });
    it("分屏模式由载荷决定：复制保留来源标签，搬移把标签移出来源组", async () => {
        const {store, workbench} = await setup("cancel");
        // 工具栏复制：来源组保留自己的标签，第二组拿到同一文档的第二个视图。
        expect(workbench.splitToEdge({sourceGroupId: "main", targetGroupId: "main", path: "a.md", direction: "right", mode: "copy"})).toBe(true);
        expect(workbench.groupIds.value).toEqual(["main", "g1"]);
        expect(store.workspaceTabs.map((tab) => `${tab.editorGroupId}:${tab.path}`)).toEqual(["main:a.md", "g1:a.md"]);

        // 拖到组边缘是搬移：标签离开来源组，来源组因此为空时塌陷，没有残留空组。
        expect(workbench.splitToEdge({sourceGroupId: "g1", targetGroupId: "main", path: "a.md", direction: "bottom", mode: "move"})).toBe(true);
        expect(workbench.groupIds.value).toEqual(["main", "g2"]);
        expect(store.workspaceTabs.map((tab) => `${tab.editorGroupId}:${tab.path}`)).toEqual(["main:a.md", "g2:a.md"]);
    });
    it("解析晚于缓冲到达时组呈现仍会绑定，先算出的空呈现不能钉住", async () => {
        settingsRef.value = null;
        try {
            const {workbench} = await setup("cancel");
            // 首读还没回来就先算过一次呈现（页面在解析就绪前也这样渲染）。
            const observed = computed(() => workbench.presentationOf("main").document?.content ?? null);
            // 读两次：首次读会写入逐组运行时登记，等它稳定后再比较后续重算是否发生。
            expect(observed.value).toBeNull();
            expect(observed.value).toBeNull();

            settingsRef.value = {associations: {".md": "markdown"}, languageAssociations: {}};
            await flushPromises();
            expect(observed.value).toBe("disk");
            expect(workbench.presentationOf("main").editorId).toBe("markdown");
        } finally {
            settingsRef.value = {associations: {".md": "markdown"}, languageAssociations: {}};
        }
    });
    it("旧实例 token 的句柄不能接管重挂后的组", async () => {
        const {store, workbench} = await setup("cancel");
        const {handle, target} = viewHandle(store);
        workbench.bindViewHandle("main", target, "old", handle);
        const replacement = {focus: vi.fn(), flushPendingChange: () => "settled" as const};
        workbench.bindViewHandle("main", target, "new", replacement);
        // 旧 token 的释放不能把新句柄一起丢掉：后续内容提交仍走新实例。
        workbench.bindViewHandle("main", target, "old", null);
        expect(workbench.commitChange("main", {target, token: "new", baseRevision: store.workspaceBuffers["a.md"]!.contentRevision, content: "from new instance"}).status).toBe("accepted");
        expect(store.workspaceBuffers["a.md"]?.content).toBe("from new instance");
        expect(workbench.flush("main")).toBe("settled");
    });
    it("同文档双组各自绑定，回执按实例基线判定", async () => {
        const {store, workbench} = await setup("cancel");
        expect(workbench.splitToEdge({sourceGroupId: "main", targetGroupId: "main", path: "a.md", direction: "right", mode: "copy"})).toBe(true);
        expect(workbench.groupIds.value).toEqual(["main", "g1"]);

        const revision = store.workspaceBuffers["a.md"]!.contentRevision;
        const target = store.editorDocumentTarget("a.md");
        const second = workbench.commitChange("g1", {target, token: "g1-view", baseRevision: revision, content: "second group typing"});
        expect(second.status).toBe("accepted");

        // 第一组用旧基线提交（它没有跟随第二组的写入）⇒ 冲突并登记，不覆盖权威正文。
        const first = workbench.commitChange("main", {target, token: "main-view", baseRevision: revision, content: "first group typing"});
        expect(first.status).toBe("conflict");
        expect(store.workspaceBuffers["a.md"]?.content).toBe("second group typing");
        expect(workbench.unresolvedChanges.value.map((item) => item.token)).toEqual(["main-view"]);

        // 采用当前正文：登记清空，实例按最新快照对齐。
        workbench.resolveConflict("main", "main-view", "adopt-current");
        workbench.acknowledgeConflict("main-view", "settled");
        expect(workbench.unresolvedChanges.value).toEqual([]);
    });
});
