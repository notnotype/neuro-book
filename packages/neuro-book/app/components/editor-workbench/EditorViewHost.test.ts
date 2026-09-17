// @vitest-environment jsdom
import {mount, flushPromises} from "@vue/test-utils";
import {defineComponent, h, nextTick, onMounted} from "vue";
import {describe, expect, it, vi} from "vitest";
import EditorViewHost from "./EditorViewHost.vue";
import {createEditorRegistry} from "nbook/app/utils/editor-workbench/registry";
import type {EditorContribution, EditorDocumentSnapshot, EditorViewEvents, EditorViewHandle} from "./editor-view.types";

const target = {workspaceKey: "novel:a", generation: 1, documentId: "1", path: "a.md"};
const document: EditorDocumentSnapshot = {target, content: "unmodified **source**\n", languageId: "markdown", readonly: false};

describe("EditorViewHost", () => {
    it("目标异步就绪前继续输入，隐藏旧视图时结算并同步目标", async () => {
        let oldEvents!: EditorViewEvents;
        let complete!: (handle: EditorViewHandle | null) => void;
        const Old = defineComponent({emits: ["ready"], setup(_props, {emit}) {
            onMounted(() => emit("ready", {focus() {}, flushPendingChange() {oldEvents.change(target, "typed while loading");}}));
            return () => h("div", "old");
        }});
        const built = createEditorRegistry([
            {id: "code", titleKey: "code", iconClass: "", supports: () => true, render: (_props, events, bind) => {
                oldEvents = events;
                return h(Old, {onReady: bind});
            }},
            {id: "delayed", titleKey: "delayed", iconClass: "", supports: () => true, render: (props, _events, bind) => {
                complete = bind;
                return h("textarea", {"data-view": "delayed", value: props.document.content});
            }},
        ]);
        if (!built.ok) throw new Error(built.reason);
        const wrapper = mount(EditorViewHost, {props: {document, editorId: "code", registry: built.value}});
        await flushPromises();
        await wrapper.setProps({editorId: "delayed"});
        complete({focus() {}, flushPendingChange() {}});
        await nextTick();
        expect(wrapper.emitted("change")?.at(-1)).toEqual([target, "typed while loading"]);
        expect((wrapper.get('[data-view="delayed"]').element as HTMLTextAreaElement).value).toBe("typed while loading");
        wrapper.unmount();
    });

    it("第三视图无需外壳分支，隐藏视图惰性同步且切回保留实例", async () => {
        const events: Record<string, EditorViewEvents> = {};
        const mounts: string[] = [];
        function contribution(id: string): EditorContribution {
            const View = defineComponent({
                props: {content: String}, emits: ["ready"],
                setup(props, {emit}) {
                    onMounted(() => {mounts.push(id); emit("ready", {focus: vi.fn(), flushPendingChange: vi.fn()});});
                    return () => h("textarea", {"data-view": id, value: props.content});
                },
            });
            return {id, titleKey: id, iconClass: "", supports: () => true, render: (props, callbacks, bind) => {
                events[id] = callbacks;
                return h(View, {content: props.document.content, onReady: bind});
            }};
        }
        const built = createEditorRegistry([contribution("code"), contribution("test.preview")]);
        if (!built.ok) throw new Error(built.reason);
        const wrapper = mount(EditorViewHost, {props: {document, editorId: "code", registry: built.value}});
        await flushPromises();
        expect(wrapper.emitted("change")).toBeUndefined();
        await wrapper.setProps({editorId: "test.preview"});
        await flushPromises();
        await wrapper.setProps({document: {...document, content: "unsaved"}});
        expect((wrapper.get('[data-view="code"]').element as HTMLTextAreaElement).value).toBe(document.content);
        expect((wrapper.get('[data-view="test.preview"]').element as HTMLTextAreaElement).value).toBe("unsaved");
        events.code!.change(target, "stale hidden input");
        expect(wrapper.emitted("change")).toBeUndefined();
        await wrapper.setProps({editorId: "code"});
        await nextTick();
        expect((wrapper.get('[data-view="code"]').element as HTMLTextAreaElement).value).toBe("unsaved");
        expect(mounts).toEqual(["code", "test.preview"]);
        const old = events.code!;
        await wrapper.setProps({document: {...document, target: {...target, generation: 2, documentId: "2"}}});
        await flushPromises();
        old.change(target, "late previous document");
        expect(wrapper.emitted("change")).toBeUndefined();
        wrapper.unmount();
    });
});
