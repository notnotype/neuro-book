/**
 * 输入框的单行版式、前置的触发按钮、上下文大小与“管理模型…”（同名 .md 的“单行版式”）。编辑器用包内真实的
 * PlainPromptEditor；注入 nb-markdown 的 PromptEditor 时 openTrigger 的补空格与开菜单在那边测（PromptEditor.dom.test.ts）。
 */

import {describe, expect, it} from "vitest";
import {flushPromises, mount} from "@vue/test-utils";
import {DropdownMenu} from "@notnotype/nb-ui/components";

import {createAgentContext, type AgentContextPatch} from "../../context";
import {createAgentViewRegistry, type AgentViewContribution} from "../../registry";
import {builtinComposerContribution} from "../builtin-composer";
import {provideAgentView} from "../host";
import AgentConversationComposer from "./AgentConversationComposer.vue";
import AgentModelPicker from "./AgentModelPicker.vue";
import PlainPromptEditor from "../fallback/PlainPromptEditor.vue";
import {defineComponent, h} from "vue";

const plus: AgentViewContribution = {source: "test-plus", toolbarButtons: [{id: "insert-ref", icon: "i-lucide-plus", label: "插入引用", placement: "leading", trigger: "@"}]};
const registry = createAgentViewRegistry([builtinComposerContribution, plus]);

function ctx(patch: AgentContextPatch = {}) {
    return createAgentContext({
        ...patch,
        interaction: {canSend: true, canChangeRuntime: true, ...patch.interaction},
        composer: {models: [{key: "a", label: "模型 A", supportsImages: false}], modelKey: "a", ...patch.composer},
    });
}

/** 输入框要视图提供的宿主（语言与渲染组件）：包一层只做 provide 的父组件。 */
function mountComposer(props: {ctx: ReturnType<typeof ctx>; layout?: "stacked" | "inline"; injectedEditor?: boolean}) {
    const Host = defineComponent({
        setup() {
            // 显式注入编辑器时视图认为它收得了附件（缺省的普通文本框收不了）。
            provideAgentView({locale: () => "zh-CN", renderers: () => (props.injectedEditor === true ? {promptEditor: PlainPromptEditor} : {})});
            return () => h(AgentConversationComposer, {ctx: props.ctx, services: {}, registry, ...(props.layout === undefined ? {} : {layout: props.layout})});
        },
    });
    return mount(Host, {attachTo: document.body});
}

describe("AgentConversationComposer 单行版式", () => {
    it("正文与控件同一行，前置按钮在正文前；允许登记附件时退回两层", () => {
        const inline = mountComposer({ctx: ctx(), layout: "inline"});
        const frame = inline.get("[data-composer-layout]");
        expect(frame.attributes("data-composer-layout")).toBe("inline");
        const order = [...frame.element.children].map((child) => (child as HTMLElement).className);
        expect(order[0]).toContain("acv-composer__leading");
        expect(order[1]).toContain("acv-composer__editor");
        inline.unmount();

        const withFiles = mountComposer({ctx: ctx({interaction: {canRegisterAttachments: true}}), layout: "inline", injectedEditor: true});
        expect(withFiles.get("[data-composer-layout]").attributes("data-composer-layout")).toBe("stacked");
        withFiles.unmount();

        const stacked = mountComposer({ctx: ctx()});
        expect(stacked.get("[data-composer-layout]").attributes("data-composer-layout")).toBe("stacked");
        // 两层版式里前置按钮在工具栏最前。
        expect(stacked.find(".acv-composer__tools [data-composer-toolbar='insert-ref']").exists()).toBe(true);
        stacked.unmount();
    });

    it("带 trigger 的按钮往编辑器末尾插触发字符（中文结尾先补空格），不发登记的 action", async () => {
        const view = mountComposer({ctx: ctx({composer: {draft: {text: "介绍一下", version: 1}}}), layout: "inline"});
        await view.get("[data-composer-toolbar='insert-ref']").trigger("click");
        await flushPromises();
        expect((view.get("textarea").element as HTMLTextAreaElement).value).toBe("介绍一下 @");
        const actions = (view.findComponent(AgentConversationComposer).emitted("action") ?? []).map((args) => args[0]);
        expect(actions).toEqual([{type: "composer.draftChanged", text: "介绍一下 @"}]);
        view.unmount();
    });

    it("上下文大小：70% 起黄、90% 起红，超过窗口时写实际百分比；没有用量、不知道窗口或两层版式时不画", () => {
        const tone = (contextTokens: number, contextLimit: number | null, layout: "stacked" | "inline" = "inline") => {
            const view = mountComposer({ctx: ctx({usage: {contextTokens, contextLimit}}), layout});
            const meter = view.find("[data-context-meter]");
            const result = meter.exists() ? [meter.attributes("data-tone"), meter.attributes("aria-label")] : null;
            view.unmount();
            return result;
        };
        expect(tone(41_820, 200_000)).toEqual(["normal", "上下文 41,820 / 200,000（21%）"]);
        expect(tone(150, 200)?.[0]).toBe("warning");
        expect(tone(180, 200)?.[0]).toBe("danger");
        expect(tone(240, 200)).toEqual(["danger", "上下文 240 / 200（120%）"]);
        expect(tone(0, 200)).toBeNull();
        expect(tone(330, 1_050_000)?.[1]).toBe("上下文 330 / 1,050,000（<1%）");
        expect(tone(10, null)).toBeNull();
        expect(tone(150, 200, "stacked")).toBeNull();
    });
});

describe("AgentModelPicker", () => {
    it("“管理模型…”只在 canManage 时有，选中发出 manage；用不了的模型灰掉并写原因；组名写在右侧", () => {
        const models = [{key: "a", label: "Sonnet", supportsImages: true, group: "OpenRouter"}, {key: "b", label: "Sonnet", supportsImages: true, group: "Anthropic", unavailable: "ANTHROPIC_API_KEY 没有值"}];
        const picker = mount(AgentModelPicker, {props: {models, modelKey: "a", thinkingLevels: [], thinking: null, canManage: true}});
        const items = picker.getComponent(DropdownMenu).props("items") as {id: string; disabled?: boolean; title?: string; shortcut?: string}[];
        expect(items.map((item) => item.id)).toEqual(["model:a", "model:b", "sep-manage", "manage"]);
        expect(items[0]).toMatchObject({shortcut: "OpenRouter"});
        expect(items[1]).toMatchObject({disabled: true, title: "ANTHROPIC_API_KEY 没有值", shortcut: "Anthropic"});
        picker.getComponent(DropdownMenu).vm.$emit("select", "manage");
        expect(picker.emitted("manage")).toHaveLength(1);
        picker.unmount();

        const plain = mount(AgentModelPicker, {props: {models, modelKey: "a", thinkingLevels: [], thinking: null}});
        expect((plain.getComponent(DropdownMenu).props("items") as {id: string}[]).some((item) => item.id === "manage")).toBe(false);
        plain.unmount();
    });
});
