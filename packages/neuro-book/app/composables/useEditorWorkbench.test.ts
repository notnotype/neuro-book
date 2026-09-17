// @vitest-environment jsdom
import {createPinia, defineStore, setActivePinia} from "pinia";
import {computed, defineComponent, h, nextTick, ref, watch} from "vue";
import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";
import type {BuiltinEditorBindings} from "nbook/app/utils/editor-workbench/builtin-editors";
import type {WorkspaceFileNode} from "nbook/app/stores/novel-ide";

vi.mock("nbook/app/composables/useEditorConfiguration", () => ({useEditorConfiguration: () => ({
    settings: ref({associations: {".md": "markdown"}, languageAssociations: {}}), loading: ref(false), diagnosis: ref(null), reload: vi.fn(),
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

describe("编辑器编排", () => {
    it("切换视图结算输入，不读磁盘、不隐式保存", async () => {
        const {store, workbench, fetch} = await setup("cancel");
        const target = store.activeWorkspaceDocumentTarget!;
        workbench.bindViewHandle(target, "1", {focus: vi.fn(), flushPendingChange: () => store.updateWorkspaceDocument(target, "pending input")});
        fetch.mockClear();
        await workbench.switchEditor("code");
        expect(store.selectedFileContent).toBe("pending input");
        expect(store.workspaceTabs[0]?.editorId).toBe("code");
        expect(fetch).not.toHaveBeenCalled();
    });
    it("保存失败选择关闭仍保留dirty正文与可见错误", async () => {
        const {store, workbench} = await setup("save", true);
        store.updateWorkspaceDocument(store.activeWorkspaceDocumentTarget!, "unsaved");
        await nextTick();
        await workbench.closeTab("a.md");
        expect(store.selectedFileContent).toBe("unsaved");
        expect(store.workspaceTabs[0]?.dirty).toBe(true);
        expect(workbench.diagnosis.value).toContain("disk unavailable");
    });
    it("取消保留文档，明确放弃才允许丢弃", async () => {
        const cancelled = await setup("cancel");
        cancelled.store.updateWorkspaceDocument(cancelled.store.activeWorkspaceDocumentTarget!, "unsaved");
        await cancelled.workbench.closeTab("a.md");
        expect(cancelled.store.selectedFileContent).toBe("unsaved");
        dispose();
        const discarded = await setup("discard");
        discarded.store.updateWorkspaceDocument(discarded.store.activeWorkspaceDocumentTarget!, "unsaved");
        await discarded.workbench.closeTab("a.md");
        expect(discarded.store.workspaceTabs).toEqual([]);
        expect(discarded.store.selectedFilePath).toBe("");
    });
});
