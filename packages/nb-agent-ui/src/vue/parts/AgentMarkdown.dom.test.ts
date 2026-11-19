import {describe, expect, it} from "vitest";
import {mount} from "@vue/test-utils";
import {defineComponent, h} from "vue";

import type {MarkdownActivation} from "../../ports";
import {provideAgentView} from "../host";
import AgentMarkdown from "./AgentMarkdown.vue";

/** 注入的 Markdown 显示组件的替身：每个按钮各发出一种 activate，并把收到的属性写在属性上。 */
const ACTIVATIONS: MarkdownActivation[] = [
    {kind: "reference", target: "chapter://c3"},
    {kind: "link", href: "https://example.com/a"},
    {kind: "image", address: "设定/地图.png"},
    {kind: "sticker", sticker: {raw: ":lyra/开心:", url: "/s/开心.webp", name: "开心", packTitle: "星璃", width: 128, height: 128}},
];
const FakeMarkdown = defineComponent({
    props: {text: String, locale: String, streaming: Boolean, resolveAsset: Function},
    emits: ["activate"],
    setup(props, {emit}) {
        return () => h("div", {"data-fake-markdown": props.text, "data-locale": props.locale, "data-streaming": String(props.streaming), "data-has-resolver": String(props.resolveAsset !== undefined)},
            ACTIVATIONS.map((activation) => h("button", {"data-kind": activation.kind, onClick: () => emit("activate", activation)})));
    },
});

const resolveAsset = async () => null;

function mountMarkdown(withRenderer: boolean) {
    const Host = defineComponent({
        setup() {
            provideAgentView({locale: () => "en-US", renderers: () => (withRenderer ? {markdown: FakeMarkdown} : {})});
            return () => h(AgentMarkdown, {text: "**雨夜**", resolveAsset, streaming: true});
        },
    });
    return mount(Host);
}

describe("AgentMarkdown", () => {
    it("把原文、语言、流式与图片换算交给注入的组件；引用、外链、图片、表情分别成为 reference.open、link.open 与预览请求", async () => {
        const wrapper = mountMarkdown(true);
        const display = wrapper.get("[data-fake-markdown]");
        expect(display.attributes()).toMatchObject({"data-fake-markdown": "**雨夜**", "data-locale": "en-US", "data-streaming": "true", "data-has-resolver": "true"});
        for (const kind of ["reference", "link", "image", "sticker"]) await wrapper.get(`[data-kind='${kind}']`).trigger("click");
        const markdown = wrapper.getComponent(AgentMarkdown);
        expect(markdown.emitted("action")?.map((args) => args[0])).toEqual([
            {type: "reference.open", target: "chapter://c3"},
            {type: "link.open", href: "https://example.com/a"},
            {type: "image.preview", image: {markdownSrc: "设定/地图.png", name: "设定/地图.png"}},
            // 表情（stickers.md 输出 46）：标题是“名字 · 包的显示名”，复制的是写法，小图放大到 320。
            {type: "image.preview", image: {url: "/s/开心.webp", name: "开心 · 星璃", copyText: ":lyra/开心:", minSize: 320}},
        ]);
    });

    it("没有注入时按纯文字显示原文", () => {
        expect(mountMarkdown(false).text()).toBe("**雨夜**");
    });
});
