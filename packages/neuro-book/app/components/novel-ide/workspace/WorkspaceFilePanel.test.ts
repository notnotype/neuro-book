// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi, type MockInstance} from "vitest";
import {flushPromises, mount, type VueWrapper} from "@vue/test-utils";
import {defineComponent, nextTick, type Ref} from "vue";
import type {WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import WorkspaceFilePanel from "nbook/app/components/novel-ide/workspace/WorkspaceFilePanel.vue";

/**
 * 文件面板的组件边界：展开项只走记录（不再有任何裸 `localStorage` 写路径）、
 * 选中 / 打开转发到 store、三种明细面板按选中节点分派、记录诊断可见。
 *
 * 记录会话本身（首读门禁、条件初始化、旧键迁移与回读）在
 * `app/utils/workbench/files-view-session.test.ts` 用真实记录验证；这里只验证接线。
 */

const fake = vi.hoisted(() => ({
    refs: null as unknown,
    commits: [] as string[][],
    retries: 0,
    abandons: 0,
    store: null as unknown,
}));

vi.mock("nbook/app/utils/workbench/files-view-session", async () => {
    const {ref} = await import("vue");
    const expandedPaths = ref<string[]>([]);
    const notice = ref<{diagnosis: string; retryable: boolean; abandonable: boolean} | null>(null);
    const loading = ref(false);
    fake.refs = {expandedPaths, notice, loading};
    return {
        useWorkbenchFileTreeExpandedPaths: () => ({
            expandedPaths,
            loading,
            notice,
            async commit(paths: string[]) {
                fake.commits.push([...paths]);
                expandedPaths.value = [...paths];
            },
            async retry() {
                fake.retries += 1;
            },
            abandon() {
                fake.abandons += 1;
            },
            async release() {},
        }),
    };
});

vi.mock("nbook/app/stores/novel-ide", async () => {
    const {ref} = await import("vue");
    const store = {
        canAccessWorkspace: ref(true),
        loadingWorkspaceTree: ref(false),
        selectedFileNode: ref<WorkspaceFileNode | null>(null),
        selectedFilePath: ref(""),
        workspaceIssues: ref([]),
        workspaceTree: ref<WorkspaceFileNode[]>([]),
        openWorkspaceNode: vi.fn(async (node: WorkspaceFileNode) => node),
        loadWorkspaceTree: vi.fn(async () => []),
        clearActiveFile: vi.fn(),
    };
    fake.store = store;
    return {useNovelIdeStore: () => store};
});

vi.mock("nbook/app/composables/useDialog", () => ({
    useDialog: () => ({confirm: vi.fn(async () => false), prompt: vi.fn(async () => null), alert: vi.fn(), choose: vi.fn(), chooseCards: vi.fn()}),
}));

vi.mock("nbook/app/composables/useNotification", () => ({
    useNotification: () => ({
        error: vi.fn(),
        success: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
        notify: vi.fn(),
        remove: vi.fn(),
        clear: vi.fn(),
        notifications: [],
    }),
}));

vi.mock("vue-i18n", () => ({
    useI18n: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
            params === undefined ? key : `${key}(${Object.values(params).join(",")})`,
        locale: {value: "zh-CN"},
    }),
}));

const TreeStub = defineComponent({
    name: "WorkspaceFileTree",
    props: ["nodes", "selectedPath", "expandedPaths", "forcedExpandedPaths"],
    emits: ["update:expandedPaths", "select", "open", "move", "node-contextmenu", "root-contextmenu"],
    template: "<div data-stub=\"tree\" :data-expanded=\"JSON.stringify(expandedPaths)\" :data-selected=\"selectedPath\"></div>",
});

const detailStub = (name: string, marker: string) => defineComponent({
    name,
    props: ["node", "issues", "height", "dialogOnly"],
    emits: ["close", "refresh", "update:height", "create-index", "convert-file-to-directory"],
    template: `<div data-detail="${marker}"></div>`,
});

const DialogStub = defineComponent({
    name: "WorkspaceCreateFileDialog",
    props: ["modelValue", "kind", "defaultPath", "busy", "restrictLorebookScope"],
    emits: ["update:modelValue", "submit"],
    template: "<div data-stub=\"create-dialog\"></div>",
});

const ContextMenuStub = defineComponent({
    name: "ContextMenu",
    props: ["visible", "x", "y", "items", "contextValue"],
    emits: ["close", "select"],
    template: "<div data-stub=\"context-menu\"></div>",
});

const mounted: VueWrapper[] = [];

function nodeOf(overrides: Partial<WorkspaceFileNode>): WorkspaceFileNode {
    return {
        path: "manuscript/chapter-1.md",
        title: "chapter-1",
        summary: "",
        isDirectory: false,
        editable: true,
        hasIndex: false,
        ...overrides,
    } as WorkspaceFileNode;
}

const lorebookCharacter = nodeOf({
    path: "lorebook/hero/index.md",
    title: "hero",
    entryType: "character",
    contentNode: true,
});

const lorebookLocation = nodeOf({
    path: "lorebook/town/index.md",
    title: "town",
    entryType: "location",
    contentNode: true,
});

const manuscriptFile = nodeOf({path: "manuscript/chapter-1.md", title: "chapter-1"});

function recordRefs() {
    return fake.refs as {
        expandedPaths: Ref<string[]>;
        notice: Ref<{diagnosis: string; retryable: boolean; abandonable: boolean} | null>;
        loading: Ref<boolean>;
    };
}

function storeMock() {
    return fake.store as {
        selectedFileNode: Ref<WorkspaceFileNode | null>;
        workspaceTree: Ref<WorkspaceFileNode[]>;
        openWorkspaceNode: ReturnType<typeof vi.fn>;
    };
}

function mountPanel() {
    const wrapper = mount(WorkspaceFilePanel, {
        global: {
            stubs: {
                WorkspaceFileTree: TreeStub,
                WorkspaceFileDetailPanel: detailStub("WorkspaceFileDetailPanel", "file"),
                WorkspaceCharacterDetailPanel: detailStub("WorkspaceCharacterDetailPanel", "character"),
                WorkspaceLorebookDetailPanel: detailStub("WorkspaceLorebookDetailPanel", "lorebook"),
                WorkspaceCreateFileDialog: DialogStub,
                ContextMenu: ContextMenuStub,
            },
        },
    });
    mounted.push(wrapper);
    return wrapper;
}

let setItemSpy: MockInstance;
let getItemSpy: MockInstance;

beforeEach(() => {
    fake.commits = [];
    fake.retries = 0;
    fake.abandons = 0;
    recordRefs().expandedPaths.value = [];
    recordRefs().notice.value = null;
    recordRefs().loading.value = false;
    storeMock().selectedFileNode.value = null;
    storeMock().workspaceTree.value = [manuscriptFile, lorebookCharacter, lorebookLocation];
    storeMock().openWorkspaceNode.mockClear();
    setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    getItemSpy = vi.spyOn(Storage.prototype, "getItem");
});

afterEach(() => {
    for (const wrapper of mounted.splice(0)) {
        wrapper.unmount();
    }
    vi.restoreAllMocks();
});

describe("WorkspaceFilePanel", () => {
    it("展开项来自记录，且挂载不产生任何浏览器存储读写", () => {
        recordRefs().expandedPaths.value = ["lorebook/"];
        const wrapper = mountPanel();

        expect(wrapper.find("[data-stub=\"tree\"]").attributes("data-expanded")).toBe(JSON.stringify(["lorebook/"]));
        expect(setItemSpy).not.toHaveBeenCalled();
        expect(getItemSpy).not.toHaveBeenCalled();
    });

    it("记录读取中就绪前不渲染树（调整控件不可用），就绪后按记录的展开项渲染", async () => {
        recordRefs().expandedPaths.value = ["manuscript/"];
        recordRefs().loading.value = true;
        const wrapper = mountPanel();

        // 读取窗口：树不挂载（因此没有任何手势能 emit 整份默认数组），诊断条也不在。
        expect(wrapper.find("[data-stub=\"tree\"]").exists()).toBe(false);
        expect(wrapper.text()).toContain("ide.workspace.filePanel.loadingTree");
        expect(fake.commits).toEqual([]);

        recordRefs().loading.value = false;
        await nextTick();

        const tree = wrapper.findComponent(TreeStub);
        expect(tree.exists()).toBe(true);
        expect(tree.attributes("data-expanded")).toBe(JSON.stringify(["manuscript/"]));
        expect(fake.commits).toEqual([]);
    });

    it("树的展开变化只提交给记录（唯一写路径），不落裸键", async () => {
        const wrapper = mountPanel();
        const tree = wrapper.findComponent(TreeStub);

        tree.vm.$emit("update:expandedPaths", ["manuscript/", "lorebook/"]);
        await nextTick();

        expect(fake.commits).toEqual([["manuscript/", "lorebook/"]]);
        expect(tree.attributes("data-expanded")).toBe(JSON.stringify(["manuscript/", "lorebook/"]));
        expect(setItemSpy).not.toHaveBeenCalled();
    });

    it("选中走 preview、双击打开走 permanent，并把打开结果说出来", async () => {
        const wrapper = mountPanel();
        const tree = wrapper.findComponent(TreeStub);

        tree.vm.$emit("select", manuscriptFile);
        await nextTick();
        expect(storeMock().openWorkspaceNode).toHaveBeenCalledWith(manuscriptFile, "preview");
        expect(wrapper.find("[data-file-panel-open-notice]").exists()).toBe(false);

        tree.vm.$emit("open", manuscriptFile);
        await flushPromises();
        await nextTick();
        expect(storeMock().openWorkspaceNode).toHaveBeenCalledWith(manuscriptFile, "permanent");
        expect(wrapper.find("[data-file-panel-open-notice]").text()).toContain("manuscript/chapter-1.md");
    });

    it("明细面板按选中节点分派：角色 / Lorebook 条目 / 普通文件", async () => {
        const wrapper = mountPanel();

        expect(wrapper.find("[data-detail=\"file\"]").exists()).toBe(true);

        storeMock().selectedFileNode.value = lorebookCharacter;
        await nextTick();
        expect(wrapper.find("[data-detail=\"character\"]").exists()).toBe(true);
        expect(wrapper.find("[data-detail=\"file\"]").exists()).toBe(false);

        storeMock().selectedFileNode.value = lorebookLocation;
        await nextTick();
        expect(wrapper.find("[data-detail=\"lorebook\"]").exists()).toBe(true);
        expect(wrapper.find("[data-detail=\"character\"]").exists()).toBe(false);

        storeMock().selectedFileNode.value = manuscriptFile;
        await nextTick();
        expect(wrapper.find("[data-detail=\"file\"]").exists()).toBe(true);
    });

    it("记录诊断可见，并且带重试 / 放弃出口", async () => {
        recordRefs().notice.value = {diagnosis: "Storage 记录当前不可写，旧展开记录保留原位", retryable: true, abandonable: true};
        const wrapper = mountPanel();

        const notice = wrapper.find("[data-file-panel-record-notice]");
        expect(notice.exists()).toBe(true);
        expect(notice.text()).toContain("Storage 记录当前不可写，旧展开记录保留原位");

        await notice.findAll("button")[0]!.trigger("click");
        expect(fake.retries).toBe(1);
        await notice.findAll("button")[1]!.trigger("click");
        expect(fake.abandons).toBe(1);
    });

    it("没有可放弃的意图时不给出「放弃」按钮（宿主不可达仍可重试）", async () => {
        recordRefs().notice.value = {diagnosis: "Storage 宿主暂不可达（cold start）", retryable: true, abandonable: false};
        const wrapper = mountPanel();

        const notice = wrapper.find("[data-file-panel-record-notice]");
        expect(notice.exists()).toBe(true);
        expect(notice.text()).toContain("Storage 宿主暂不可达");

        const buttons = notice.findAll("button");
        expect(buttons).toHaveLength(1);
        await buttons[0]!.trigger("click");
        expect(fake.retries).toBe(1);
        expect(fake.abandons).toBe(0);
    });

    it("没有诊断时不显示记录提示条", () => {
        const wrapper = mountPanel();
        expect(wrapper.find("[data-file-panel-record-notice]").exists()).toBe(false);
    });
});
