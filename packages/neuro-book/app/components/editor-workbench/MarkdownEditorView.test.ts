// @vitest-environment jsdom
import {mount, flushPromises, type VueWrapper} from "@vue/test-utils";
import {defineComponent, h, onMounted} from "vue";
import {describe, expect, it} from "vitest";
import MarkdownEditorView from "./MarkdownEditorView.vue";
import type {EditorChangeRequest, EditorChangeResult, EditorDocumentSnapshot, EditorViewHandle} from "./editor-view.types";
import {DEFAULT_MARKDOWN_EDITOR_PREFERENCES} from "nbook/shared/editor-workbench";

const target = {workspaceKey: "novel:a", generation: 1, documentId: "1", path: "a.md"};
const baseline: EditorDocumentSnapshot = {target, content: "基线正文", contentRevision: 2, languageId: "markdown", readonly: false};

Object.assign(globalThis, {useI18n: () => ({t: (key: string) => key})});

type CoreRecorder = {updates: string[]; flushes: number};

/** 富文本内核替身：只记录外部回灌与结算次数，不引入真实 TipTap。 */
function coreStub(recorder: CoreRecorder) {
    return defineComponent({
        name: "TipTapMarkdownEditor",
        props: {initialValue: {type: String, default: ""}},
        emits: ["ready", "change", "blur", "save-request", "inline-comments-change", "open-frontmatter-profile", "inline-ai-reference"],
        setup(props, {emit, expose}) {
            expose({
                update: (text: string) => {
                    if (text === props.initialValue) return;
                    recorder.updates.push(text);
                },
                flushPendingChange: () => {
                    recorder.flushes += 1;
                },
                focus: () => undefined,
            });
            onMounted(() => emit("ready"));
            return () => h("div", {class: "core"});
        },
    });
}

function setup(recorder: CoreRecorder) {
    const Core = coreStub(recorder);
    const commits: Array<Omit<EditorChangeRequest, "token">> = [];
    const reply = {current: (): EditorChangeResult => ({status: "conflict", snapshot: baseline})};
    const wrapper = mount(MarkdownEditorView, {
        props: {
            document: baseline,
            visible: true,
            viewInstanceId: "instance-1",
            commitChange: (nextTarget, baseRevision, content) => {
                commits.push({target: nextTarget, baseRevision, content});
                return reply.current();
            },
            editorPreferences: DEFAULT_MARKDOWN_EDITOR_PREFERENCES,
            showFrontmatterPanel: false,
        },
        global: {stubs: {TipTapMarkdownEditor: Core}},
    });
    return {Core, commits, reply, wrapper};
}

const readyHandle = (wrapper: VueWrapper): EditorViewHandle =>
    wrapper.emitted("ready")!.at(-1)![0] as EditorViewHandle;

describe("MarkdownEditorView", () => {
    it("conflict 保留候选，accepted 推进确认快照，外部快照走内核 update", async () => {
        const recorder: CoreRecorder = {updates: [], flushes: 0};
        const {Core, commits, reply, wrapper} = setup(recorder);
        await flushPromises();
        const handle = readyHandle(wrapper);

        wrapper.findComponent(Core).vm.$emit("change", "富文本候选");
        expect(commits).toEqual([{target, baseRevision: 2, content: "富文本候选"}]);
        expect(recorder.updates).toEqual([]);
        expect(handle.flushPendingChange()).toBe("conflict");
        expect(recorder.flushes).toBe(1);

        // 兄弟组写来的权威快照不覆盖未裁决的候选。
        const sibling: EditorDocumentSnapshot = {...baseline, content: "兄弟组写入", contentRevision: 3};
        await wrapper.setProps({document: sibling});
        expect(recorder.updates).toEqual([]);

        reply.current = () => ({status: "accepted", snapshot: {...sibling, content: "富文本回声", contentRevision: 4}});
        wrapper.findComponent(Core).vm.$emit("change", "富文本回声");
        expect(commits.at(-1)).toEqual({target, baseRevision: 3, content: "富文本回声"});
        expect(handle.flushPendingChange()).toBe("settled");

        // 无候选时外部正文才回灌：富文本的 history 基线由内核重设。
        await wrapper.setProps({document: {...sibling, content: "外部正文", contentRevision: 5}});
        expect(recorder.updates).toEqual(["外部正文"]);
        wrapper.unmount();
    });

    it("冲突裁决：采用当前正文丢弃候选，保留此视图内容重提候选", async () => {
        const recorder: CoreRecorder = {updates: [], flushes: 0};
        const {Core, commits, reply, wrapper} = setup(recorder);
        await flushPromises();
        const handle = readyHandle(wrapper);

        wrapper.findComponent(Core).vm.$emit("change", "第一份候选");
        const moved: EditorDocumentSnapshot = {...baseline, content: "权威正文", contentRevision: 6};
        await wrapper.setProps({document: moved});
        expect(handle.resolveConflict!("adopt-current")).toBe("settled");
        expect(recorder.updates).toEqual(["权威正文"]);
        expect(handle.flushPendingChange()).toBe("settled");

        wrapper.findComponent(Core).vm.$emit("change", "第二份候选");
        reply.current = () => ({status: "conflict", snapshot: moved});
        expect(handle.resolveConflict!("keep-view")).toBe("conflict");
        expect(commits.at(-1)).toEqual({target, baseRevision: 6, content: "第二份候选"});
        wrapper.unmount();
    });
});
