import {describe, expect, it} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {defineComponent, h} from "vue";

import type {PromptToken} from "../../ports";
import type {ContentBlockView, UserMessageView} from "../../types";
import {provideAgentView} from "../host";
import AgentUserContent from "./AgentUserContent.vue";

function message(blocks: ContentBlockView[]): UserMessageView {
    return {kind: "user", id: "u1", timestamp: 0, intent: "normal", blocks, contentOmitted: false};
}

/**
 * 注入的文字显示组件的替身：每个标签画成一个按钮，点了发出 token-activate。真组件把文字写法解析成标签，
 * 在应用的 Lab e2e 里对着 nbook.markdown 的实现测；这里只看对话视图怎样处理发出来的标签。
 */
const TOKENS: PromptToken[] = [
    {kind: "reference", label: "第一章", target: "chapter://c1"},
    {kind: "image", number: 2, target: "session://attachments/地图.png"},
    {kind: "command", name: "plan"},
];
const FakeTextView = defineComponent({
    props: {text: {type: String, required: true}, locale: {type: String, required: true}},
    emits: ["token-activate"],
    setup(props, {emit}) {
        return () => h("div", {"data-fake-text": props.text, "data-locale": props.locale}, TOKENS.map((token) => h("button", {"data-token": token.kind, onClick: () => emit("token-activate", token)})));
    },
});

function mountContent(blocks: ContentBlockView[], withRenderer = true): VueWrapper {
    const Host = defineComponent({
        setup() {
            provideAgentView({locale: () => "en-US", renderers: () => (withRenderer ? {promptTextView: FakeTextView} : {})});
            return () => h(AgentUserContent, {
                message: message(blocks),
                resolveAttachmentUrl: (locator: string) => locator.startsWith("ok:") ? `https://lab.invalid/${locator}` : null,
            });
        },
    });
    return mount(Host);
}

describe("AgentUserContent", () => {
    it("文字交给注入的显示组件，带上界面语言；标签按去向发出动作或请求预览，命令不做任何事", async () => {
        const wrapper = mountContent([{kind: "text", text: "[第一章](chapter://c1) ![image #2](session://attachments/地图.png) /plan"}]);
        const content = wrapper.getComponent(AgentUserContent);
        expect(wrapper.get("[data-fake-text]").attributes("data-locale")).toBe("en-US");
        for (const kind of ["reference", "image", "command"]) await wrapper.get(`[data-token='${kind}']`).trigger("click");
        expect(content.emitted("action")?.map((args) => args[0])).toEqual([
            {type: "reference.open", target: "chapter://c1"},
            {type: "image.preview", image: {locator: "session://attachments/地图.png", name: "Image #2 · 地图.png"}},
        ]);
    });

    it("没有注入时按纯文字显示原文", () => {
        const wrapper = mountContent([{kind: "text", text: "先读 [第一章](chapter://c1)"}], false);
        expect(wrapper.text()).toContain("先读 [第一章](chapter://c1)");
        expect(wrapper.find("button").exists()).toBe(false);
    });

    it("文字外面的旧附件：图片请求预览，文件发出 attachment.open，没有地址的图片不可点", async () => {
        const wrapper = mountContent([
            {kind: "text", text: "附件见下"},
            {kind: "attachment", locator: "ok:old", name: "旧图.png", mimeType: "image/png", bytes: 10},
            {kind: "attachment", locator: "gone", name: "过期.png", mimeType: "image/png", bytes: 10},
            {kind: "attachment", locator: "notes", name: "笔记.pdf", mimeType: "application/pdf", bytes: 2048},
        ]);
        const content = wrapper.getComponent(AgentUserContent);
        const buttons = wrapper.findAll(".acv-user-content__files button");
        expect(buttons).toHaveLength(2);
        await buttons[0]!.trigger("click");
        await buttons[1]!.trigger("click");
        expect(content.emitted("action")?.map((args) => args[0])).toEqual([
            {type: "image.preview", image: {locator: "ok:old", name: "旧图.png"}},
            {type: "attachment.open", target: "notes"},
        ]);
    });
});
