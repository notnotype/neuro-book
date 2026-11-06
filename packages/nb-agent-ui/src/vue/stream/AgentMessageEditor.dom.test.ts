import {flushPromises, mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";

import AgentMessageEditor from "./AgentMessageEditor.vue";

const show = (props: {text: string; loading?: boolean}) => mount(AgentMessageEditor, {attachTo: document.body, props: {loading: false, ...props}});

describe("AgentMessageEditor", () => {
    it("回车发送，发的是改过的文字；Esc 取消", async () => {
        const view = show({text: "原文"});
        await flushPromises();
        const input = view.get("textarea");
        expect((input.element as HTMLTextAreaElement).value).toBe("原文");
        await input.setValue("改过");
        await input.trigger("keydown", {key: "Enter"});
        expect(view.emitted("submit")).toEqual([["改过"]]);
        await input.trigger("keydown", {key: "Escape"});
        expect(view.emitted("cancel")).toHaveLength(1);
        view.unmount();
    });

    it("空的不能发；原文加载中只读", async () => {
        const empty = show({text: "原文"});
        await flushPromises();
        await empty.get("textarea").setValue("   ");
        await empty.get("[data-message-editor-submit]").trigger("click");
        expect(empty.emitted("submit")).toBeUndefined();
        empty.unmount();
        const loading = show({text: "", loading: true});
        await flushPromises();
        expect(loading.get("textarea").attributes("readonly")).toBeDefined();
        loading.unmount();
    });
});
