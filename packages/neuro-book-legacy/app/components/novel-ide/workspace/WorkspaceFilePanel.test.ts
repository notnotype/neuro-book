// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {defineComponent, nextTick, ref} from "vue";
import type {WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import WorkspaceFilePanel from "nbook/app/components/novel-ide/workspace/WorkspaceFilePanel.vue";

const fake = vi.hoisted(() => ({identity: {dev: 1, ino: 11, birthtimeMs: 10, mtimeMs: 10, size: 1}, store: null as unknown, expanded: null as unknown, mode: null as unknown, confirm: null as unknown, choose: null as unknown}));
vi.mock("nbook/app/utils/workbench/files-view-session", async () => {
    const {ref} = await import("vue");
    const expanded = {expandedPaths: ref<string[]>([]), loading: ref(false), notice: ref(null), commit: vi.fn(async (paths: string[]) => {expanded.expandedPaths.value = paths;}), retry: vi.fn(), abandon: vi.fn(), release: vi.fn()};
    const mode = {mode: ref<"ordinary" | "content">("ordinary"), loading: ref(false), notice: ref(null), commit: vi.fn(async (value: "ordinary" | "content") => {mode.mode.value = value;}), retry: vi.fn(), abandon: vi.fn(), release: vi.fn()};
    fake.expanded = expanded;
    fake.mode = mode;
    return {useWorkbenchFileTreeExpandedPaths: () => expanded, useWorkbenchFilesViewMode: () => mode};
});
vi.mock("nbook/app/stores/novel-ide", async () => {
    const {ref} = await import("vue");
    const generation = ref(1);
    const store = {canAccessWorkspace: ref(true), get workspaceGeneration() {return generation.value;}, set workspaceGeneration(value: number) {generation.value = value;}, loadingWorkspaceTree: ref(false), selectedFilePath: ref(""), workspaceTree: ref<WorkspaceFileNode[]>([]), workspaceBuffers: {} as Record<string, {content: string; lastSyncedContent: string}>, hasUnresolvedEditorChanges: false, flushEditorPending: vi.fn(() => "settled"), saveDirtyWorkspaceFiles: vi.fn(async () => true), openWorkspaceNode: vi.fn(async (node: WorkspaceFileNode) => node), loadWorkspaceTree: vi.fn(async () => []), statWorkspacePath: vi.fn(async (path: string) => ({path, sourceIdentity: fake.identity})), deleteWorkspacePath: vi.fn(async () => undefined), batchWorkspacePaths: vi.fn()};
    fake.store = store;
    return {useNovelIdeStore: () => store};
});
vi.mock("nbook/app/composables/useDialog", () => {const confirm = vi.fn(async () => false), choose = vi.fn(async () => "cancel"); fake.confirm = confirm; fake.choose = choose; return {useDialog: () => ({confirm, choose, prompt: vi.fn(async () => null)})};});
vi.mock("nbook/app/composables/useNotification", () => ({useNotification: () => ({error: vi.fn(), success: vi.fn()})}));
vi.mock("vue-i18n", () => ({useI18n: () => ({t: (key: string) => key})}));
const ViewStub = defineComponent({name: "FilesExplorerView", props: ["nodes", "mode", "expandedPaths", "selectedPath", "selectedPaths", "loading", "error"], emits: ["update:mode", "update:expandedPaths", "update:selectedPaths", "clipboard-intent", "select", "open", "retry"], template: '<div data-view :data-mode="mode" :data-expanded="JSON.stringify(expandedPaths)" :data-selected="JSON.stringify(selectedPaths)" :data-error="error"></div>'});
const mounted: VueWrapper[] = [];
const store = () => fake.store as {canAccessWorkspace: {value: boolean}; workspaceGeneration: number; loadingWorkspaceTree: {value: boolean}; workspaceTree: {value: WorkspaceFileNode[]}; workspaceBuffers: Record<string, {content: string; lastSyncedContent: string}>; hasUnresolvedEditorChanges: boolean; saveDirtyWorkspaceFiles: ReturnType<typeof vi.fn>; statWorkspacePath: ReturnType<typeof vi.fn>; deleteWorkspacePath: ReturnType<typeof vi.fn>; openWorkspaceNode: ReturnType<typeof vi.fn>; loadWorkspaceTree: ReturnType<typeof vi.fn>; batchWorkspacePaths: ReturnType<typeof vi.fn>};
const expanded = () => fake.expanded as {expandedPaths: {value: string[]}; loading: {value: boolean}; notice: {value: unknown}; commit: ReturnType<typeof vi.fn>};
const mode = () => fake.mode as {mode: {value: "ordinary" | "content"}; loading: {value: boolean}; notice: {value: unknown}; commit: ReturnType<typeof vi.fn>};
const confirmDialog = () => fake.confirm as ReturnType<typeof vi.fn>;
const chooseDialog = () => fake.choose as ReturnType<typeof vi.fn>;
function panel() {
    const wrapper = mount(WorkspaceFilePanel, {global: {stubs: {FilesExplorerView: ViewStub, ContextMenu: defineComponent({name: "ContextMenu", props: ["items"], template: "<div data-menu />"}), WorkspaceCreateFileDialog: true}}});
    mounted.push(wrapper);
    return wrapper;
}
const node = {path: "baseline.md", isDirectory: false, editable: true, title: "Baseline"} as WorkspaceFileNode;
beforeEach(() => {
    expanded().expandedPaths.value = [];
    expanded().loading.value = false;
    expanded().notice.value = null;
    expanded().commit.mockClear();
    mode().mode.value = "ordinary";
    mode().loading.value = false;
    mode().notice.value = null;
    mode().commit.mockClear();
    store().canAccessWorkspace.value = true;
    store().workspaceGeneration = 1;
    store().workspaceTree.value = [node];
    store().loadingWorkspaceTree.value = false;
    store().openWorkspaceNode.mockClear();
    store().batchWorkspacePaths.mockReset();
    store().statWorkspacePath.mockReset().mockImplementation(async (path: string) => ({path, sourceIdentity: fake.identity}));
    store().deleteWorkspacePath.mockReset().mockResolvedValue({});
    store().workspaceBuffers = {};
    store().hasUnresolvedEditorChanges = false;
    store().saveDirtyWorkspaceFiles.mockReset().mockResolvedValue(true);
    chooseDialog().mockReset().mockResolvedValue("cancel");
    confirmDialog().mockReset().mockResolvedValue(false);
    store().loadWorkspaceTree.mockClear();
});
afterEach(() => mounted.splice(0).forEach(wrapper => wrapper.unmount()));

describe("WorkspaceFilePanel", () => {
    it("记录首读前拒绝挂树，完成后保留展开项与模式", async () => {
        expanded().expandedPaths.value = ["chapter/"];
        expanded().loading.value = true;
        const wrapper = panel();
        expect(wrapper.find("[data-view]").exists()).toBe(false);
        expanded().loading.value = false;
        await nextTick();
        expect(wrapper.find("[data-view]").attributes("data-expanded")).toBe('["chapter/"]');
        expect(expanded().commit).not.toHaveBeenCalled();
    });
    it("模式切换只改受控偏好，打开仍使用真实节点身份", async () => {
        const wrapper = panel();
        wrapper.findComponent(ViewStub).vm.$emit("update:mode", "content");
        await nextTick();
        expect(mode().commit).toHaveBeenCalledWith("content");
        expect(wrapper.find("[data-view]").attributes("data-mode")).toBe("content");
        wrapper.findComponent(ViewStub).vm.$emit("select", node);
        wrapper.findComponent(ViewStub).vm.$emit("open", node);
        await nextTick();
        expect(store().openWorkspaceNode).toHaveBeenCalledWith(node, "preview");
        expect(store().openWorkspaceNode).toHaveBeenCalledWith(node, "permanent");
    });
    it("展开意图只提交既有记录，关闭项目不挂载旧树", async () => {
        const wrapper = panel();
        wrapper.findComponent(ViewStub).vm.$emit("update:expandedPaths", ["chapter/"]);
        await nextTick();
        expect(expanded().commit).toHaveBeenCalledWith(["chapter/"]);
        store().canAccessWorkspace.value = false;
        await nextTick();
        expect(wrapper.find("[data-view]").exists()).toBe(false);
    });
    it("目录剪切仅清除成功项，独立失败展示逐项结果", async () => {
        const directory = {...node, path: "chapter/", isDirectory: true};
        store().workspaceTree.value = [directory, node];
        confirmDialog().mockResolvedValue(true);
        store().batchWorkspacePaths.mockResolvedValueOnce({items: [{source: "chapter/", target: "destination/chapter", status: "success"}]})
            .mockResolvedValueOnce({items: [{source: "baseline.md", target: "destination/baseline.md", status: "failed", reason: "目标路径已存在"}]})
            .mockResolvedValueOnce({items: [{source: "baseline.md", target: "next/baseline.md", status: "success"}]});
        const wrapper = panel();
        const view = wrapper.findComponent(ViewStub);
        view.vm.$emit("update:selectedPaths", ["chapter/", "baseline.md"]);
        view.vm.$emit("clipboard-intent", {kind: "cut", sources: ["chapter/", "baseline.md"]});
        await vi.waitFor(() => expect(store().statWorkspacePath).toHaveBeenCalledTimes(2));
        view.vm.$emit("clipboard-intent", {kind: "paste", destination: "destination/"});
        await vi.waitFor(() => expect(store().batchWorkspacePaths).toHaveBeenCalledTimes(2));
        expect(store().batchWorkspacePaths).toHaveBeenCalledWith("move", ["chapter/"], "destination/", expect.objectContaining({expectedSources: {chapter: fake.identity}}));
        await vi.waitFor(() => expect(wrapper.find("[data-role='files-batch-results']").text()).toContain("目标路径已存在"));
        view.vm.$emit("clipboard-intent", {kind: "paste", destination: "next/"});
        await vi.waitFor(() => expect(store().batchWorkspacePaths).toHaveBeenCalledWith("move", ["baseline.md"], "next/", expect.any(Object)));
    });
    it("复制dirty文件由用户选择磁盘版本、保存或取消", async () => {
        store().workspaceBuffers = {"baseline.md": {content: "dirty", lastSyncedContent: "disk"}};
        store().batchWorkspacePaths.mockResolvedValue({items: [{source: "baseline.md", target: "copies/baseline.md", status: "success"}]});
        const wrapper = panel();
        const view = wrapper.findComponent(ViewStub);
        view.vm.$emit("clipboard-intent", {kind: "copy", sources: ["baseline.md"]});
        await vi.waitFor(() => expect(store().statWorkspacePath).toHaveBeenCalledOnce());
        view.vm.$emit("clipboard-intent", {kind: "paste", destination: "copies/"});
        await vi.waitFor(() => expect(chooseDialog()).toHaveBeenCalledOnce());
        expect(store().batchWorkspacePaths).not.toHaveBeenCalled();
        chooseDialog().mockResolvedValueOnce("disk");
        view.vm.$emit("clipboard-intent", {kind: "paste", destination: "copies/"});
        await vi.waitFor(() => expect(store().batchWorkspacePaths).toHaveBeenCalledOnce());
        expect(store().saveDirtyWorkspaceFiles).not.toHaveBeenCalled();
        chooseDialog().mockResolvedValueOnce("save");
        view.vm.$emit("clipboard-intent", {kind: "paste", destination: "copies/"});
        await vi.waitFor(() => expect(store().saveDirtyWorkspaceFiles).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(store().batchWorkspacePaths).toHaveBeenCalledTimes(2));
    });


    it("确认弹窗期间工作区换代不会提交旧剪贴板", async () => {
        let accept!: (value: boolean) => void;
        confirmDialog().mockImplementationOnce(() => new Promise<boolean>(resolve => {accept = resolve;}));
        const wrapper = panel();
        const view = wrapper.findComponent(ViewStub);
        view.vm.$emit("clipboard-intent", {kind: "copy", sources: ["baseline.md"]});
        await vi.waitFor(() => expect(store().statWorkspacePath).toHaveBeenCalledOnce());
        view.vm.$emit("clipboard-intent", {kind: "paste", destination: "next/"});
        await vi.waitFor(() => expect(confirmDialog()).toHaveBeenCalledOnce());
        store().workspaceGeneration++;
        await nextTick();
        accept(true);
        await nextTick();
        expect(store().batchWorkspacePaths).not.toHaveBeenCalled();
    });
    it("源路径被替换时不写盘，网络未知停止后续并锁定旧意图", async () => {
        store().workspaceTree.value = [node, {...node, path: "second.md"}];
        confirmDialog().mockResolvedValue(true);
        const wrapper = panel();
        const view = wrapper.findComponent(ViewStub);
        view.vm.$emit("clipboard-intent", {kind: "copy", sources: ["baseline.md", "second.md"]});
        await vi.waitFor(() => expect(store().statWorkspacePath).toHaveBeenCalledTimes(2));
        store().statWorkspacePath.mockImplementation(async (path: string) => ({path, sourceIdentity: path === "baseline.md" ? {...fake.identity, ino: 12} : fake.identity}));
        store().batchWorkspacePaths.mockRejectedValueOnce(new Error("network unavailable"));
        view.vm.$emit("clipboard-intent", {kind: "paste", destination: "copies/"});
        await vi.waitFor(() => expect(wrapper.find("[data-role='files-batch-results']").text()).toContain("来源已被替换"));
        await vi.waitFor(() => expect(wrapper.find("[data-role='files-batch-results']").text()).toContain("结果未知"));
        view.vm.$emit("clipboard-intent", {kind: "paste", destination: "again/"});
        await nextTick();
        expect(store().batchWorkspacePaths).toHaveBeenCalledTimes(1);
        expect(wrapper.text()).toContain("核对源和目标");
        const check = wrapper.findAll("button").find(button => button.text() === "核对源和目标");
        await check?.trigger("click");
        await vi.waitFor(() => expect(wrapper.find("[data-role='files-unknown-check']").text()).toContain("源 second.md：存在"));
        expect(wrapper.find("[data-role='files-unknown-check']").text()).toContain("目标 copies/second.md：存在");
        confirmDialog().mockResolvedValue(true);
        const clear = wrapper.findAll("button").find(button => button.text() === "放弃旧意图");
        await clear?.trigger("click");
        view.vm.$emit("clipboard-intent", {kind: "paste", destination: "again/"});
        await nextTick();
        expect(store().batchWorkspacePaths).toHaveBeenCalledTimes(1);
    });

    it("同目录复制遇同名可跳过，且不发起写请求", async () => {
        confirmDialog().mockResolvedValue(true);
        chooseDialog().mockResolvedValue("skip");
        const wrapper = panel();
        const view = wrapper.findComponent(ViewStub);
        view.vm.$emit("clipboard-intent", {kind: "copy", sources: ["baseline.md"]});
        await vi.waitFor(() => expect(store().statWorkspacePath).toHaveBeenCalledOnce());
        view.vm.$emit("clipboard-intent", {kind: "paste", destination: ""});
        await vi.waitFor(() => expect(wrapper.find("[data-role='files-batch-results']").text()).toContain("跳过"));
        expect(store().batchWorkspacePaths).not.toHaveBeenCalled();
    });

    it("多选删除仅确认一次，父目录覆盖子项且独立项失败后继续", async () => {
        const folder = {...node, path: "folder/", isDirectory: true};
        store().workspaceTree.value = [folder, {...node, path: "folder/child.md"}, {...node, path: "other.md"}];
        confirmDialog().mockResolvedValue(true);
        store().deleteWorkspacePath.mockRejectedValueOnce({statusCode: 400, message: "占用"}).mockResolvedValueOnce({});
        const wrapper = panel();
        const view = wrapper.findComponent(ViewStub);
        view.vm.$emit("update:selectedPaths", ["folder/child.md", "folder/", "other.md"]);
        await nextTick();
        view.vm.$emit("node-contextmenu", folder, new MouseEvent("contextmenu"));
        await nextTick();
        const menu = wrapper.findComponent({name: "ContextMenu"});
        const actions = menu.props("items") as Array<{label?: string; action?: () => void}>;
        actions.find(item => item.label === "ide.workspace.common.delete")?.action?.();
        await vi.waitFor(() => expect(store().deleteWorkspacePath).toHaveBeenCalledTimes(2));
        expect(confirmDialog()).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(wrapper.find("[data-role='files-batch-results']").text()).toContain("占用"));
        expect(wrapper.find("[data-role='files-batch-results']").text()).toContain("完成");
        expect(wrapper.find("[data-role='files-batch-results']").text()).not.toContain("child.md");
    });
});
