/**
 * PromptTextView（同名 .md；docs/specs/ui/prompt-editor.md 输出 14）。由旧应用的同名测试移植（分支 `archive/legacy-ui-tuning`，
 * `865c9f593`），期望值不变；有意改变：小块换成 InlineChip，标记属性从 `data-prompt-token` 换成 `data-inline-chip`。
 */

import {mount, type VueWrapper} from "@vue/test-utils";
import {nextTick} from "vue";
import {describe, expect, it} from "vitest";

import type {PromptEditorToken} from "./prompt-editor.types";
import PromptTextView from "./PromptTextView.vue";

type Props = Omit<InstanceType<typeof PromptTextView>["$props"], "locale">;

function mountView(props: Props & {text: string}): VueWrapper {
    return mount(PromptTextView, {props: {locale: "zh-CN", ...props}});
}

function activated(wrapper: VueWrapper): PromptEditorToken[] {
    return (wrapper.emitted("token-activate") ?? []).map((args) => args[0] as PromptEditorToken);
}

const PASTE = ["<paste id=\"2\">", "a", "b", "c", "d", "e", "</paste>"].join("\n");

describe("PromptTextView", () => {
    it("写法显示成标签，普通文字与空行原样保留", () => {
        const wrapper = mountView({text: "看 [第一章](chapter://c1) 和 [[ch03.md#L2-L4]]，用 $writer\n\n第二段"});
        const kinds = [...wrapper.element.querySelectorAll("[data-inline-chip]")].map((node) => node.getAttribute("data-inline-chip"));
        expect(kinds).toEqual(["reference", "selection", "skill"]);
        const lines = wrapper.findAll(".prompt-text__line");
        expect(lines.map((line) => line.text())).toEqual(["看 第一章 和 ch03.md:2-4，用 writer", "", "第二段"]);
        expect(lines[1]!.find("br").exists()).toBe(true);
    });

    it("开头的命令只在登记过时显示为标签", () => {
        expect(mountView({text: "/plan 先读大纲"}).find("[data-inline-chip='command']").exists()).toBe(false);
        expect(mountView({text: "/plan 先读大纲", commands: ["plan"]}).find("[data-inline-chip='command']").exists()).toBe(true);
    });

    it("图片与文件按出现顺序进附件条，旧图片补显示号，缩略图取自 resolveThumbnail", () => {
        const wrapper = mountView({
            text: "![image #2](session://attachments/b.png) [file #1 · 设定.pdf](session://attachments/设定.pdf) ![旧图.png](old/path.png)",
            resolveThumbnail: (target) => target === "session://attachments/b.png" ? "data:image/png;base64,AAAA" : null,
        });
        const cards = wrapper.findAll("[data-prompt-card]");
        expect(cards.map((card) => card.text())).toEqual(expect.arrayContaining([expect.stringContaining("#2")]));
        expect(cards).toHaveLength(3);
        expect(wrapper.findAll("img").map((img) => img.attributes("src"))).toEqual(["data:image/png;base64,AAAA"]);
        const numbers = [...wrapper.element.querySelectorAll("[data-inline-chip='image']")].map((node) => node.textContent?.trim());
        expect(numbers).toEqual(["#2", "#3"]);
    });

    it("点击标签与卡片发出 token-activate", async () => {
        const wrapper = mountView({text: "[file #1 · 设定.pdf](session://attachments/设定.pdf) $writer"});
        await wrapper.find("[data-inline-chip='skill']").trigger("click");
        await wrapper.find("[data-prompt-card] .prompt-strip__main").trigger("click");
        expect(activated(wrapper)).toEqual([
            {kind: "skill", name: "writer"},
            {kind: "file", number: 1, name: "设定.pdf", target: "session://attachments/设定.pdf"},
        ]);
    });

    it("标签是可聚焦的按钮，回车与空格触发", async () => {
        const wrapper = mountView({text: "$writer 和 [第一章](chapter://c1)"});
        const skill = wrapper.find("[data-inline-chip='skill']");
        expect(skill.attributes("role")).toBe("button");
        expect(skill.attributes("tabindex")).toBe("0");
        await skill.trigger("keydown", {key: "Enter"});
        await wrapper.find("[data-inline-chip='reference']").trigger("keydown", {key: " "});
        await skill.trigger("keydown", {key: "a"});
        expect(activated(wrapper)).toEqual([
            {kind: "skill", name: "writer"},
            {kind: "reference", label: "第一章", target: "chapter://c1"},
        ]);
    });

    it("粘贴块默认收起，展开后显示全文，换了文字后重新收起", async () => {
        const wrapper = mountView({text: `[paste #2] 见下\n${PASTE}`});
        expect(wrapper.find("[data-prompt-paste] pre").text()).toBe("a\nb\nc");
        await wrapper.find("[data-prompt-paste-action='expand']").trigger("click");
        expect(wrapper.find("[data-prompt-paste] pre").text()).toBe("a\nb\nc\nd\ne");
        await wrapper.setProps({text: `${PASTE}\n结尾`});
        await nextTick();
        expect(wrapper.find("[data-prompt-paste] pre").text()).toBe("a\nb\nc");
    });

    it("悬停位置标记时同号的粘贴块高亮", async () => {
        const wrapper = mountView({text: `[paste #2] 见下\n${PASTE}`});
        await wrapper.find("[data-inline-chip='paste']").trigger("mouseenter");
        expect(wrapper.find(".prompt-paste").classes()).toContain("is-highlighted");
        await wrapper.find("[data-inline-chip='paste']").trigger("mouseleave");
        expect(wrapper.find(".prompt-paste").classes()).not.toContain("is-highlighted");
    });

    it("截在写法中间的预览按普通文字显示", () => {
        const wrapper = mountView({text: "看 [第一章](chapter://c1"});
        expect(wrapper.find("[data-inline-chip]").exists()).toBe(false);
        expect(wrapper.find(".prompt-text__line").text()).toBe("看 [第一章](chapter://c1");
    });
});
