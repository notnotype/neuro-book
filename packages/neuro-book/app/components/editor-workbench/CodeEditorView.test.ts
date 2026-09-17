// @vitest-environment jsdom
import {mount} from "@vue/test-utils";
import {defineComponent, h, ref} from "vue";
import {describe, expect, it} from "vitest";
import CodeEditorView from "./CodeEditorView.vue";
import {DEFAULT_MONACO_EDITOR_PREFERENCES} from "nbook/shared/editor-workbench";

const DelayedCore = defineComponent({
    props: {initialValue: {type: String, default: ""}}, emits: ["ready"],
    setup(props, {emit, expose}) {
        const value = ref(props.initialValue);
        let ready = false;
        expose({update: (text: string) => {if (ready) value.value = text;}});
        return () => h("button", {onClick: () => {ready = true; emit("ready");}}, value.value);
    },
});

describe("CodeEditorView", () => {
    it("内核就绪前抵达的新正文在ready时同步，未编辑不反写", async () => {
        const document = {target: {workspaceKey: "novel:a", generation: 1, documentId: "1", path: "a.json"}, content: "old", languageId: "json", readonly: false};
        const wrapper = mount(CodeEditorView, {props: {document, visible: true, monacoPreferences: DEFAULT_MONACO_EDITOR_PREFERENCES}, global: {stubs: {MonacoCodeEditor: DelayedCore}}});
        await wrapper.setProps({document: {...document, content: "latest external content"}});
        await wrapper.get("button").trigger("click");
        expect(wrapper.get("button").text()).toBe("latest external content");
        expect(wrapper.emitted("change")).toBeUndefined();
        wrapper.unmount();
    });
});
