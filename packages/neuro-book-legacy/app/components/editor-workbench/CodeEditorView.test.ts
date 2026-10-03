// @vitest-environment jsdom
import {mount, flushPromises, type VueWrapper} from "@vue/test-utils";
import {defineComponent, h, onMounted} from "vue";
import {describe, expect, it} from "vitest";
import CodeEditorView from "./CodeEditorView.vue";
import type {
    EditorChangeRequest,
    EditorChangeResult,
    EditorDocumentSnapshot,
    EditorViewHandle,
} from "./editor-view.types";
import {DEFAULT_MONACO_EDITOR_PREFERENCES} from "nbook/shared/editor-workbench";

const target = {workspaceKey: "novel:a", generation: 1, documentId: "1", path: "a.md"};
const baseline: EditorDocumentSnapshot = {target, content: "基线正文", contentRevision: 3, languageId: "markdown", readonly: false};

type KernelRecorder = {updates: string[]; flushes: number};

/** 内核替身：只记录被要求做的同步与结算，不引入真实 Monaco。 */
function kernelStub(recorder: KernelRecorder) {
    return defineComponent({
        name: "MonacoCodeEditor",
        props: {
            initialValue: {type: String, default: ""},
            modelPath: {type: String, default: ""},
            language: {type: String, default: "plaintext"},
            readonly: {type: Boolean, default: false},
        },
        emits: ["ready", "change", "save-request", "focus", "blur", "update-temporary-font-size"],
        setup(props, {emit, expose}) {
            let value = props.initialValue;
            expose({
                update: (text: string) => {
                    // 与真实内核同一契约：内容相同不算一次同步。
                    if (text === value) return;
                    value = text;
                    recorder.updates.push(text);
                },
                flushPendingChange: () => {
                    recorder.flushes += 1;
                },
                focus: () => undefined,
                undo: () => undefined,
                redo: () => undefined,
            });
            onMounted(() => emit("ready"));
            return () => h("div", {class: "kernel", "data-model-path": props.modelPath, "data-initial": props.initialValue});
        },
    });
}

function setup(recorder: KernelRecorder, viewInstanceId = "instance-1") {
    const Kernel = kernelStub(recorder);
    // 视图层的提交不含 token（token 由宿主在转发时补上），因此这里是"请求去掉 token"的形状。
    const commits: Array<Omit<EditorChangeRequest, "token">> = [];
    const reply = {current: (request: Omit<EditorChangeRequest, "token">): EditorChangeResult => ({status: "conflict", snapshot: baseline})};
    const wrapper = mount(CodeEditorView, {
        props: {
            document: baseline,
            visible: true,
            viewInstanceId,
            commitChange: (nextTarget, baseRevision, content) => {
                commits.push({target: nextTarget, baseRevision, content});
                return reply.current({target: nextTarget, baseRevision, content});
            },
            monacoPreferences: DEFAULT_MONACO_EDITOR_PREFERENCES,
        },
        global: {stubs: {MonacoCodeEditor: Kernel}},
    });
    return {Kernel, commits, reply, wrapper};
}

const readyHandle = (wrapper: VueWrapper): EditorViewHandle =>
    wrapper.emitted("ready")!.at(-1)![0] as EditorViewHandle;

describe("CodeEditorView", () => {
    it("conflict 保留候选、不调用内核 update，accepted 才推进确认快照且不回灌自己", async () => {
        const recorder: KernelRecorder = {updates: [], flushes: 0};
        const {Kernel, commits, reply, wrapper} = setup(recorder);
        await flushPromises();
        const handle = readyHandle(wrapper);

        wrapper.findComponent(Kernel).vm.$emit("change", "用户的候选");
        expect(commits).toEqual([{target, baseRevision: 3, content: "用户的候选"}]);
        expect(recorder.updates).toEqual([]);
        expect(handle.flushPendingChange()).toBe("conflict");
        expect(recorder.flushes).toBe(1);

        // 权威快照推进到新修订时，未裁决的候选仍不被覆盖。
        const rejectedEcho: EditorDocumentSnapshot = {...baseline, content: "别人的正文", contentRevision: 4};
        await wrapper.setProps({document: rejectedEcho});
        expect(recorder.updates).toEqual([]);

        reply.current = () => ({status: "accepted", snapshot: {...rejectedEcho, content: "用户的第二次候选", contentRevision: 5}});
        await wrapper.setProps({document: {...rejectedEcho, contentRevision: 5}});
        wrapper.findComponent(Kernel).vm.$emit("change", "用户的第二次候选");
        expect(commits.at(-1)).toEqual({target, baseRevision: 5, content: "用户的第二次候选"});
        expect(handle.flushPendingChange()).toBe("settled");
        // accepted 的回声只是确认快照，不重设内核内容，也不重设撤销基线。
        expect(recorder.updates).toEqual([]);
        wrapper.unmount();
    });

    it("外部与兄弟视图回灌走内核 update；同文档两个实例模型身份不同", async () => {
        const recorder: KernelRecorder = {updates: [], flushes: 0};
        const Kernel = kernelStub(recorder);
        // 两个视图挂在一个父级里：同一次挂载才能证明同文档双实例的模型身份确实分开。
        const Parent = defineComponent({
            props: {document: {type: Object, required: true}, first: {type: String, required: true}, second: {type: String, required: true}},
            render() {
                const shell = (viewInstanceId: string) => h(CodeEditorView, {
                    document: this.document as EditorDocumentSnapshot,
                    visible: true,
                    viewInstanceId,
                    commitChange: () => ({status: "stale"} as EditorChangeResult),
                    monacoPreferences: DEFAULT_MONACO_EDITOR_PREFERENCES,
                });
                return h("div", [shell(this.first), shell(this.second)]);
            },
        });
        const wrapper = mount(Parent, {
            props: {document: baseline, first: "instance-a", second: "instance-b"},
            global: {stubs: {MonacoCodeEditor: Kernel}},
        });
        await flushPromises();
        const paths = wrapper.findAll(".kernel").map((kernel) => kernel.attributes("data-model-path"));
        expect(paths).toHaveLength(2);
        expect(paths[0]).toBeTruthy();
        expect(paths[1]).toBeTruthy();
        expect(paths[0]).not.toBe(paths[1]);

        const external: EditorDocumentSnapshot = {...baseline, content: "兄弟组写入", contentRevision: 4};
        await wrapper.setProps({document: external, first: "instance-a", second: "instance-b"});
        // 两个实例各自收到同一条外部快照，互不共用内核实例。
        expect(recorder.updates).toEqual(["兄弟组写入", "兄弟组写入"]);
        wrapper.unmount();
    });

    it("冲突裁决：采用当前正文重设内核，保留此视图内容用最新修订重提候选", async () => {
        const recorder: KernelRecorder = {updates: [], flushes: 0};
        const {Kernel, commits, reply, wrapper} = setup(recorder);
        await flushPromises();
        const handle = readyHandle(wrapper);

        wrapper.findComponent(Kernel).vm.$emit("change", "冲突候选");
        const moved: EditorDocumentSnapshot = {...baseline, content: "别人的最新正文", contentRevision: 7};
        await wrapper.setProps({document: moved});
        // 候选未被裁决前，权威快照不覆盖产生它的实例。
        expect(recorder.updates).toEqual([]);
        expect(handle.resolveConflict!("adopt-current")).toBe("settled");
        expect(recorder.updates).toEqual(["别人的最新正文"]);
        expect(handle.flushPendingChange()).toBe("settled");

        wrapper.findComponent(Kernel).vm.$emit("change", "冲突候选");
        await wrapper.setProps({document: {...moved, content: "第三条权威正文", contentRevision: 8}});
        reply.current = () => ({status: "accepted", snapshot: {...moved, content: "冲突候选", contentRevision: 9}});
        expect(handle.resolveConflict!("keep-view")).toBe("settled");
        expect(commits.at(-1)).toEqual({target, baseRevision: 8, content: "冲突候选"});
        wrapper.unmount();
    });

    it("内核就绪前抵达的新正文在 ready 时同步，未编辑不反写", async () => {
        const recorder: KernelRecorder = {updates: [], flushes: 0};
        const {wrapper} = setup(recorder);
        await wrapper.setProps({document: {...baseline, content: "latest external content", contentRevision: 4}});
        await flushPromises();
        expect(recorder.updates).toEqual(["latest external content"]);
        expect(wrapper.emitted("ready")).toHaveLength(1);
        wrapper.unmount();
    });

    it("卸载回传空句柄，宿主据此撤下绑定", async () => {
        const recorder: KernelRecorder = {updates: [], flushes: 0};
        const {wrapper} = setup(recorder);
        await flushPromises();
        wrapper.unmount();
        expect(wrapper.emitted("ready")!.at(-1)![0]).toBeNull();
    });
});
