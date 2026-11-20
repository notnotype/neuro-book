/**
 * 输入框的单行版式、前置的触发按钮、上下文大小与“管理模型…”（同名 .md 的“单行版式”）。编辑器用包内真实的
 * PlainPromptEditor；注入 nb-markdown 的 PromptEditor 时 openTrigger 的补空格与开菜单在那边测（PromptEditor.dom.test.ts）。
 */

import {describe, expect, it, vi} from "vitest";
import {flushPromises, mount} from "@vue/test-utils";
import {DropdownMenu} from "@notnotype/nb-ui/components";

import {createAgentContext, type AgentContextPatch} from "../../context";
import {createAgentViewRegistry, type AgentViewContribution, type ToolbarPopoverProps} from "../../registry";
import {builtinComposerContribution} from "../builtin-composer";
import {provideAgentView} from "../host";
import AgentConversationComposer from "./AgentConversationComposer.vue";
import AgentModelPicker from "./AgentModelPicker.vue";
import AgentRoleModelPicker from "./AgentRoleModelPicker.vue";
import PlainPromptEditor from "../fallback/PlainPromptEditor.vue";
import {defineComponent, h, nextTick, shallowRef} from "vue";
import type {PropType} from "vue";

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

describe("AgentRoleModelPicker", () => {
    const roles = [
        {key: "role:main", name: "主力", axis: "gradient" as const, modelLabel: "DeepSeek V4"},
        {key: "role:deep", name: "深度", axis: "gradient" as const, modelLabel: null, unavailable: "还没有绑定"},
        {key: "role:lore", name: "设定考据", axis: "specialist" as const, modelLabel: "GPT"},
    ];
    const models = [
        {key: "", label: "跟随默认", supportsImages: false},
        {key: "d/v4", label: "DeepSeek V4", supportsImages: false, group: "DeepSeek", contextWindow: 1_000_000, reasoning: true, price: {input: 0.3, output: 1.2}},
        {key: "o/g", label: "GPT", supportsImages: true, group: "OpenAI"},
        {key: "o/x", label: "坏的", supportsImages: true, group: "OpenAI", unavailable: "没有密钥"},
    ];
    const panel = (): HTMLElement => document.body.querySelector<HTMLElement>("[data-model-picker-panel]")!;
    const inside = (selector: string): HTMLElement => panel().querySelector<HTMLElement>(selector)!;
    /** 外框的退场由上游原语收尾，等它从文档里没了。 */
    const closed = () => vi.waitFor(() => expect(document.body.querySelector("[data-model-picker-panel]")).toBeNull());
    const open = async (props: Partial<InstanceType<typeof AgentRoleModelPicker>["$props"]> = {}) => {
        const picker = mount(AgentRoleModelPicker, {attachTo: document.body, props: {roles, models, modelKey: "role:main", effectiveModel: "DeepSeek V4", thinkingLevels: ["low", "high"], thinking: "high", canManage: true, ...props}});
        await picker.get("[data-model-picker]").trigger("click");
        await nextTick();
        return picker;
    };

    it("触发器写选的角色、实际用的模型与档位；直接选模型时不重复", async () => {
        const byRole = mount(AgentRoleModelPicker, {props: {roles, models, modelKey: "role:main", effectiveModel: "DeepSeek V4", thinkingLevels: ["high"], thinking: "high"}});
        expect(byRole.get("[data-model-picker]").attributes("title")).toBe("主力 · DeepSeek V4 · 高");
        expect(byRole.get("[data-model-picker]").text().replace(/\s+/gu, "")).toBe("主力·DeepSeekV4·高");
        byRole.unmount();
        const byModel = mount(AgentRoleModelPicker, {props: {roles, models, modelKey: "o/g", effectiveModel: "GPT", thinkingLevels: [], thinking: null}});
        expect(byModel.get("[data-model-picker]").attributes("title")).toBe("GPT");
        byModel.unmount();
    });

    it("选角色不关面板，没绑定的也能选；选模型关面板，用不了的不能选", async () => {
        const picker = await open();
        inside("[data-model-picker-role='role:deep']").click();
        expect(picker.emitted("select-model")).toEqual([["role:deep"]]);
        expect(panel()).not.toBeNull();
        expect(inside("[data-model-picker-role='role:deep']").textContent).toContain("未绑定");

        inside("[data-model-picker-pages] button:last-child").click();
        await nextTick();
        expect(inside("[data-model-picker-model='o/x']").hasAttribute("disabled")).toBe(true);
        inside("[data-model-picker-model='d/v4']").click();
        expect(picker.emitted("select-model")).toEqual([["role:deep"], ["d/v4"]]);
        await closed();
        picker.unmount();
    });

    it("模型库能搜索：跟随默认不在里面；没有匹配时说明", async () => {
        const picker = await open();
        inside("[data-model-picker-pages] button:last-child").click();
        await nextTick();
        expect(panel().querySelectorAll("[data-model-picker-model]")).toHaveLength(3);
        const input = inside("[data-model-picker-search] input, input[data-model-picker-search]") as HTMLInputElement;
        input.value = "openai";
        input.dispatchEvent(new Event("input"));
        await nextTick();
        expect([...panel().querySelectorAll("[data-model-picker-model]")].map((item) => item.getAttribute("data-model-picker-model"))).toEqual(["o/g", "o/x"]);
        input.value = "没有这个";
        input.dispatchEvent(new Event("input"));
        await nextTick();
        expect(panel().querySelectorAll("[data-model-picker-model]")).toHaveLength(0);
        expect(panel().textContent).toContain("没有匹配的模型");
        picker.unmount();
    });

    it("Esc 与点外面关闭；Esc 把焦点还给触发器；“管理模型…”发出 manage", async () => {
        const picker = await open();
        panel().dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        await closed();
        expect(document.activeElement).toBe(picker.get("[data-model-picker]").element);

        await picker.get("[data-model-picker]").trigger("click");
        await nextTick();
        document.body.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
        await closed();

        await picker.get("[data-model-picker]").trigger("click");
        await nextTick();
        inside("[data-model-picker-manage]").click();
        await nextTick();
        expect(picker.emitted("manage")).toHaveLength(1);
        picker.unmount();
    });

    const levels = (patch: Partial<NonNullable<InstanceType<typeof AgentRoleModelPicker>["$props"]["effort"]>> = {}) => ({kind: "levels" as const, levels: ["low", "medium", "high"], canOff: true, verified: true, value: "low", source: "session" as const, follow: {source: "role" as const, name: "主力"}, ...patch});
    const radios = () => [...panel().querySelectorAll<HTMLElement>("[data-model-picker-thinking] button[role='radio']")];

    it("思考档：选了立刻显示、停下才发一次；连选只发最后一档（方向键即选中，宿主不会收到每一档）", async () => {
        const picker = await open({effort: levels()});
        // 面板窄于 400px 时分段里写缩写，全名在悬停与可访问名称里。
        expect(radios().map((item) => item.textContent?.trim())).toEqual(["关", "低", "中", "高"]);
        expect(radios()[0]!.getAttribute("title")).toBe("关闭");
        radios()[2]!.click();
        radios()[3]!.click();
        await nextTick();
        expect(radios().map((item) => item.getAttribute("aria-checked"))).toEqual(["false", "false", "false", "true"]);
        expect(picker.emitted("select-thinking")).toBeUndefined();
        await vi.waitFor(() => expect(picker.emitted("select-thinking")).toEqual([["high"]]));
        picker.unmount();
    });

    it("跟随来的档：写跟随谁，再选它就钉成明确选择；明确选了档时有“用默认”回到跟随", async () => {
        const following = await open({effort: levels({value: "high", source: "role"})});
        expect(inside("[data-model-picker-effort-note]").textContent).toContain("跟随主力的默认");
        expect(inside("[data-model-picker-reset]")).toBeNull();
        expect(radios()[3]!.getAttribute("aria-checked")).toBe("true");
        radios()[3]!.click();
        await vi.waitFor(() => expect(following.emitted("select-thinking")).toEqual([["high"]]));
        following.unmount();

        const pinned = await open({effort: levels({value: "low", source: "session"})});
        expect(inside("[data-model-picker-effort-note]").textContent).not.toContain("跟随");
        inside("[data-model-picker-reset]").click();
        expect(pinned.emitted("reset-thinking")).toHaveLength(1);
        expect(inside("[data-model-picker-reset]").textContent).toContain("用主力的默认");
        pinned.unmount();
    });

    it("模型不推理或不能调档时没有控件，写原因；没验证的档位加问号说明；只能降档的模型没有“关闭”", async () => {
        const none = await open({effort: {kind: "none", levels: [], canOff: false, verified: true, value: null, source: null}});
        expect(panel().querySelector("[data-model-picker-thinking]")).toBeNull();
        expect(inside("[data-model-picker-effort-note]").textContent).toContain("这个模型不支持思考");
        none.unmount();

        const fixed = await open({effort: {kind: "fixed", levels: [], canOff: false, verified: true, value: null, source: null}});
        expect(panel().querySelector("[data-model-picker-thinking]")).toBeNull();
        expect(inside("[data-model-picker-effort-note]").textContent).toContain("会思考，但不能调档");
        fixed.unmount();

        const unverified = await open({effort: levels({verified: false, canOff: false})});
        expect(radios().map((item) => item.textContent?.trim())).toEqual(["低", "中", "高"]);
        expect(inside("[data-model-picker-effort-note] [role='img']").getAttribute("aria-label")).toContain("没写支持哪几档");
        unverified.unmount();
    });

    it("旧宿主只给档位列表时照旧：多于一档才有控件", async () => {
        const single = await open({thinkingLevels: ["high"]});
        expect(panel().querySelector("[data-model-picker-thinking]")).toBeNull();
        single.unmount();
        const several = await open({thinkingLevels: ["off", "low", "high"], thinking: "low"});
        expect(radios().map((item) => item.getAttribute("title"))).toEqual(["关闭", "低", "高"]);
        several.unmount();
    });

    describe("模型库的大组", () => {
        const big = Array.from({length: 587}, (_, index) => ({key: `or/m-${String(index)}`, label: `模型 ${String(index)}`, supportsImages: true, groupId: "or"}));
        const bigModels = [{key: "", label: "跟随默认", supportsImages: false}, ...big, {key: "d/v4", label: "DeepSeek V4", supportsImages: false, groupId: "ds"}];
        const groups = [{id: "or", name: "OpenRouter"}, {id: "ds", name: "DeepSeek"}];
        const rows = () => panel().querySelectorAll("[data-model-picker-model]").length;
        const toModels = async () => {
            inside("[data-model-picker-pages] button:last-child").click();
            await nextTick();
        };

        it("超过 30 个的组默认收起；当前模型在里面时只展开它前后各 10 行，“显示全部”才展开整组", async () => {
            const away = await open({models: bigModels, groups, modelKey: "d/v4", roles: []});
            await toModels();
            expect(rows()).toBe(1);
            expect(inside("[data-group-head='or']").getAttribute("aria-expanded")).toBe("false");
            expect(inside("[data-group-head='or']").getAttribute("aria-label")).toBe("OpenRouter，587 个模型");
            away.unmount();

            const here = await open({models: bigModels, groups, modelKey: "or/m-300", roles: []});
            await toModels();
            expect(rows()).toBe(21 + 1);
            expect(inside("[data-model-picker-model='or/m-300']").getAttribute("aria-current")).toBe("true");
            inside("[data-model-picker-show-all]").click();
            await nextTick();
            expect(rows()).toBe(588);
            expect(panel().querySelector("[data-model-picker-show-all]")).toBeNull();
            here.unmount();
        });

        it("搜索时只渲染命中项，清空后回到默认的收起；焦点所在的行被收起时落到那一组的组头", async () => {
            const picker = await open({models: bigModels, groups, modelKey: "d/v4", roles: []});
            await toModels();
            const input = inside("input[data-model-picker-search], [data-model-picker-search] input") as HTMLInputElement;
            input.value = "模型 58";
            input.dispatchEvent(new Event("input"));
            await nextTick();
            expect(rows()).toBe(8);
            (inside("[data-model-picker-model='or/m-58']") as HTMLElement).focus();
            input.value = "";
            input.dispatchEvent(new Event("input"));
            await nextTick();
            await vi.waitFor(() => expect(document.activeElement).toBe(inside("[data-group-head='or']")));
            expect(rows()).toBe(1);
            picker.unmount();
        });

        it("键盘：搜索框、组头、行在同一条方向键序列里；Home、End 到首末", async () => {
            const picker = await open({models: bigModels, groups, modelKey: "or/m-300", roles: []});
            await toModels();
            const input = inside("input[data-model-picker-search], [data-model-picker-search] input") as HTMLInputElement;
            input.focus();
            const press = (target: Element, key: string) => target.dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true}));
            press(input, "ArrowDown");
            expect(document.activeElement).toBe(inside("[data-group-head='or']"));
            press(document.activeElement!, "ArrowDown");
            expect((document.activeElement as HTMLElement).dataset.modelPickerModel).toBe("or/m-290");
            press(document.activeElement!, "ArrowUp");
            press(document.activeElement!, "ArrowUp");
            press(document.activeElement!, "ArrowUp");
            expect(document.activeElement).toBe(input);
            press(inside("[data-group-head='or']"), "End");
            expect(document.activeElement).toBe(inside("[data-model-picker-model='d/v4']"));
            press(document.activeElement!, "Home");
            expect(document.activeElement).toBe(input);
            picker.unmount();
        });
    });

    it("图标只是视图里的键：表晚到时首字母块换成图标，不用重建视图", async () => {
        const table = shallowRef<Record<string, string>>({});
        const Host = defineComponent({
            setup() {
                provideAgentView({locale: () => "zh-CN", renderers: () => ({icons: (icon) => (icon.kind === "key" && table.value[icon.key] !== undefined ? {kind: "image", src: table.value[icon.key]!} : null)})});
                return () => h(AgentRoleModelPicker, {roles: [{key: "role:main", name: "主力", axis: "gradient", modelLabel: "DeepSeek V4", modelIcon: {kind: "key", set: "provider", key: "deepseek", fallback: "DeepSeek"}}], models, modelKey: "role:main", effectiveModel: "DeepSeek V4", thinkingLevels: [], thinking: null});
            },
        });
        const view = mount(Host, {attachTo: document.body});
        await view.get("[data-model-picker]").trigger("click");
        await nextTick();
        const row = () => document.body.querySelector("[data-model-picker-role='role:main']")!;
        expect(row().querySelector("img")).toBeNull();
        expect(row().textContent).toContain("D");
        table.value = {deepseek: "data:image/svg+xml,%3Csvg%3E%3C/svg%3E"};
        await nextTick();
        expect(row().querySelector("img")?.getAttribute("src")).toContain("data:image/svg+xml");
        view.unmount();
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

describe("AgentConversationComposer 可用性的说明（ui/agent-conversation-view.md 的“输入框与待处理区”）", () => {
    function mountWith(context: ReturnType<typeof ctx>) {
        const actions: unknown[] = [];
        const Host = defineComponent({
            setup() {
                provideAgentView({locale: () => "zh-CN", renderers: () => ({})});
                return () => h(AgentConversationComposer, {ctx: context, services: {}, registry, onAction: (action: unknown) => actions.push(action)});
            },
        });
        return {wrapper: mount(Host, {attachTo: document.body}), actions};
    }
    const placeholder = (wrapper: ReturnType<typeof mount>) => wrapper.get("textarea").attributes("placeholder");

    it("模型用不了时是提示卡：标题、说明、第一个动作是主按钮，点了发 availability.act；占位写标题，原因优先于中断后继续", async () => {
        const {wrapper, actions} = mountWith(ctx({
            availability: {status: "profile-unavailable", title: "“深度”角色还没绑定模型", message: "主创用“深度”角色的模型对话。", icon: "i-lucide-link-2-off", actions: [{id: "bind-role", label: "去绑定"}]},
            composer: {resume: true},
        }));
        const card = wrapper.get("[data-notice-card]");
        expect(card.get(".acv-notice-card__title").text()).toBe("“深度”角色还没绑定模型");
        expect(card.get(".acv-notice-card__message").text()).toBe("主创用“深度”角色的模型对话。");
        expect(card.find(".i-lucide-link-2-off").exists()).toBe(true);
        expect(placeholder(wrapper)).toBe("“深度”角色还没绑定模型");
        await card.get("[data-availability-action='bind-role']").trigger("click");
        expect(actions).toEqual([{type: "availability.act", action: "bind-role"}]);
        expect(wrapper.find("textarea").attributes("readonly") ?? wrapper.find("textarea").attributes("disabled")).toBeDefined();
        wrapper.unmount();
    });

    it("别的不可用状态保留一行，占位写说明；ready 时的能力提示也是一行，占位照常", () => {
        const archived = mountWith(ctx({availability: {status: "archived", message: "此会话已归档。", actions: [{id: "restore", label: "恢复"}]}}));
        expect(archived.wrapper.find("[data-notice-card]").exists()).toBe(false);
        expect(archived.wrapper.get("[data-composer-availability]").text()).toContain("此会话已归档。");
        expect(placeholder(archived.wrapper)).toBe("此会话已归档。");
        archived.wrapper.unmount();

        const gap = mountWith(ctx({availability: {status: "ready", message: "这个模型不能看图。", actions: []}}));
        expect(gap.wrapper.find("[data-notice-card]").exists()).toBe(false);
        expect(gap.wrapper.get("[data-composer-availability]").text()).toContain("这个模型不能看图。");
        expect(placeholder(gap.wrapper)).toBe("输入消息，回车发送");
        gap.wrapper.unmount();
    });
});

describe("AgentConversationComposer 带弹层的按钮（ui/agent-conversation-view.md 的“输入框与待处理区”）", () => {
    /** 宿主登记的弹层组件：两个按钮，一个插一段文字、一个关上。 */
    const Picker = defineComponent({
        props: {
            insert: {type: Function as PropType<ToolbarPopoverProps["insert"]>, required: true},
            close: {type: Function as PropType<ToolbarPopoverProps["close"]>, required: true},
        },
        setup: (props) => () => h("div", [
            h("button", {"data-test-insert": "", onClick: () => props.insert(":lyra/开心:")}, "插"),
            h("button", {"data-test-close": "", onClick: () => props.close()}, "关"),
            h("button", {"data-test-blur": "", onClick: () => props.close({restoreFocus: false})}, "失焦"),
        ]),
    });
    const stickers: AgentViewContribution = {source: "test-stickers", toolbarButtons: [{id: "stickers", icon: "i-lucide-smile-plus", label: "表情", placement: "after-add", popover: async () => Picker}]};
    const withStickers = createAgentViewRegistry([builtinComposerContribution, plus, stickers]);
    function mountWith(context: ReturnType<typeof ctx>, layout: "stacked" | "inline" = "stacked") {
        const Host = defineComponent({
            setup() {
                // 显式注入编辑器：`+` 菜单才列出触发字符（缺省的普通文本框没有触发菜单）。
                provideAgentView({locale: () => "zh-CN", renderers: () => ({promptEditor: PlainPromptEditor})});
                return () => h(AgentConversationComposer, {ctx: context, services: {}, registry: withStickers, layout});
            },
        });
        return mount(Host, {attachTo: document.body});
    }

    it("两层版式里在 `+` 后面；单行版式里并入前置按钮", () => {
        const stacked = mountWith(ctx({interaction: {triggers: ["/"]}}));
        const tools = [...stacked.get(".acv-composer__tools").element.querySelectorAll<HTMLElement>("[data-composer-action='plus'], [data-composer-toolbar]")].map((element) => element.dataset.composerAction ?? element.dataset.composerToolbar);
        expect(tools.indexOf("stickers")).toBe(tools.indexOf("plus") + 1);
        stacked.unmount();
        const inline = mountWith(ctx(), "inline");
        expect(inline.find(".acv-composer__leading [data-composer-toolbar='stickers']").exists()).toBe(true);
        inline.unmount();
    });

    it("点了开弹层；组件插的文字落在光标处；关上后焦点回编辑器、光标不动；再点按钮关上", async () => {
        const wrapper = mountWith(ctx({composer: {draft: {text: "今天写完啦明天见", version: 1}}}));
        const textarea = wrapper.get("textarea").element as HTMLTextAreaElement;
        textarea.focus();
        textarea.setSelectionRange(5, 5);
        await wrapper.get("[data-composer-toolbar='stickers']").trigger("click");
        await flushPromises();
        expect(wrapper.get("[data-composer-toolbar='stickers']").attributes("aria-expanded")).toBe("true");
        document.querySelector<HTMLButtonElement>("[data-composer-popover] [data-test-insert]")!.click();
        await nextTick();
        expect(textarea.value).toBe("今天写完啦:lyra/开心:明天见");
        document.querySelector<HTMLButtonElement>("[data-composer-popover] [data-test-close]")!.click();
        await flushPromises();
        expect(document.activeElement).toBe(textarea);
        expect(textarea.selectionStart).toBe(5 + ":lyra/开心:".length);
        expect(wrapper.get("[data-composer-toolbar='stickers']").attributes("aria-expanded")).toBe("false");
        // 按钮按下不夺焦点：开着时再点，面板不会先失焦关上、再被这次点击打开。
        const press = new MouseEvent("mousedown", {bubbles: true, cancelable: true});
        wrapper.get("[data-composer-toolbar='stickers']").element.dispatchEvent(press);
        expect(press.defaultPrevented).toBe(true);
        await wrapper.get("[data-composer-toolbar='stickers']").trigger("click");
        await flushPromises();
        await wrapper.get("[data-composer-toolbar='stickers']").trigger("click");
        expect(wrapper.get("[data-composer-toolbar='stickers']").attributes("aria-expanded")).toBe("false");
        // 组件说焦点已到别处：关上，不把焦点抢回编辑器。
        await wrapper.get("[data-composer-toolbar='stickers']").trigger("click");
        await flushPromises();
        const blur = document.querySelector<HTMLButtonElement>("[data-composer-popover] [data-test-blur]")!;
        blur.focus();
        blur.click();
        await flushPromises();
        expect(wrapper.get("[data-composer-toolbar='stickers']").attributes("aria-expanded")).toBe("false");
        expect(document.activeElement).not.toBe(textarea);
        wrapper.unmount();
    });

    it("不能发送时按钮禁用", () => {
        const wrapper = mountWith(ctx({interaction: {canSend: false}}));
        expect(wrapper.get("[data-composer-toolbar='stickers']").attributes("disabled")).toBeDefined();
        wrapper.unmount();
    });
});

describe("AgentConversationComposer 留着的话与停止的两个选项", () => {
    const heldItem = {id: "h1", text: "留着的", delivery: "followup" as const, held: {reason: "你停止了运行"}};
    const actionsOf = (view: ReturnType<typeof mountComposer>) => (view.findComponent(AgentConversationComposer).emitted("action") ?? []).map((args) => args[0]);
    const placeholderOf = (view: ReturnType<typeof mountComposer>) => view.get("textarea").attributes("placeholder");

    it("空闲有留着的：占位与发送键是继续，空着发送与头行的继续都发 run.continue；中断与留着同时成立时占位合成一句", async () => {
        const view = mountComposer({ctx: ctx({composer: {queued: [heldItem]}})});
        expect(placeholderOf(view)).toBe("按回车继续排队的话，或输入新消息一起发");
        const primary = view.get(".acv-composer__primary");
        expect(primary.attributes("data-composer-action")).toBe("resume");
        await primary.trigger("click");
        await view.get("[data-queued-continue]").trigger("click");
        expect(actionsOf(view)).toEqual([{type: "run.continue"}, {type: "run.continue"}]);
        view.unmount();

        const both = mountComposer({ctx: ctx({composer: {queued: [heldItem], resume: true}})});
        expect(placeholderOf(both)).toBe("上次运行已中断，排队的话已暂停。按回车继续");
        both.unmount();
    });

    it("宿主正在继续：编辑器照常可写，发送键与头行的继续不可用、写明原因；点头行的继续后焦点回编辑器", async () => {
        const busy = mountComposer({ctx: ctx({interaction: {continuing: true}, composer: {queued: [heldItem]}})});
        expect(busy.get("textarea").attributes("readonly")).toBeUndefined();
        expect(busy.get(".acv-composer__primary").attributes("disabled")).toBeDefined();
        expect(busy.get("[data-queued-continue]").attributes("title")).toBe("正在继续");
        busy.unmount();

        const view = mountComposer({ctx: ctx({composer: {queued: [heldItem]}})});
        (view.get("[data-queued-continue]").element as HTMLElement).focus();
        await view.get("[data-queued-continue]").trigger("click");
        await flushPromises();
        expect(document.activeElement).toBe(view.get("textarea").element);
        view.unmount();
    });

    it("运行中有留着的按运行中的规则；停止中、不可用、不允许发送时头行的继续不可用", () => {
        const running = mountComposer({ctx: ctx({run: {status: "running"}, interaction: {canStop: true, canSteer: true, canQueue: true}, composer: {queued: [heldItem]}})});
        expect(running.get(".acv-composer__primary").attributes("data-composer-action")).toBe("stop");
        expect(running.get("[data-queued-continue]").attributes("aria-disabled")).toBe("false");
        expect(placeholderOf(running)).toBe("回车补充说明，Ctrl+回车排队");
        running.unmount();

        const cannotSend = mountComposer({ctx: ctx({interaction: {canSend: false}, composer: {queued: [heldItem]}})});
        expect(cannotSend.get("[data-queued-continue]").attributes("aria-disabled")).toBe("true");
        cannotSend.unmount();

        const stopping = mountComposer({ctx: ctx({run: {status: "stopping"}, composer: {queued: [heldItem]}})});
        expect(stopping.get("[data-queued-continue]").attributes("aria-disabled")).toBe("true");
        stopping.unmount();

        const archived = mountComposer({ctx: ctx({availability: {status: "archived", message: "此会话已归档。", actions: []}, composer: {queued: [heldItem]}})});
        expect(archived.get("[data-queued-continue]").attributes("title")).toBe("此会话已归档。");
        archived.unmount();
    });

    /** 像用户一样打开停止旁的下拉：聚焦箭头、按下方向键，等菜单挂到 body 上（测试写法的“组件测试经用户操作触发子组件的事件”）。 */
    async function openStopMenu(view: ReturnType<typeof mountComposer>): Promise<void> {
        const more = view.get("[data-composer-action='stop-more']");
        (more.element as HTMLElement).focus();
        await more.trigger("keydown", {key: "ArrowDown"});
        for (let round = 0; round < 5; round += 1) await nextTick();
    }
    const menuItems = () => [...document.body.querySelectorAll("[role=menuitem]")] as HTMLElement[];

    it("stopClearing 不为空时停止旁有下拉箭头，选“停止并清空排队”发出 clearQueue；点停止本身不带；停止中箭头 aria-disabled、不开菜单；有字时不出现", async () => {
        const base = {run: {status: "running" as const}, interaction: {canStop: true, canQueue: true, stopClearing: {count: 3}}};
        const view = mountComposer({ctx: ctx(base)});
        const more = view.get("[data-composer-action='stop-more']");
        expect(more.attributes("aria-haspopup")).toBe("menu");
        expect(more.attributes("aria-label")).toBe("更多停止方式");
        await openStopMenu(view);
        expect(menuItems().map((item) => item.textContent?.trim())).toEqual(["停止并清空排队（3 条）"]);
        menuItems()[0]!.click();
        await flushPromises();
        await view.get(".acv-composer__primary").trigger("click");
        expect(actionsOf(view)).toEqual([{type: "composer.stop", clearQueue: true}, {type: "composer.stop"}]);
        view.unmount();

        const stopping = mountComposer({ctx: ctx({...base, run: {status: "stopping"}})});
        expect(stopping.get("[data-composer-action='stop-more']").attributes("aria-disabled")).toBe("true");
        await openStopMenu(stopping);
        expect(menuItems()).toEqual([]);
        expect(stopping.get("[data-composer-action='stop-more']").attributes("aria-expanded")).toBe("false");
        stopping.unmount();

        const typed = mountComposer({ctx: ctx({...base, composer: {draft: {text: "还要说", version: 1}}})});
        expect(typed.find("[data-composer-action='stop-more']").exists()).toBe(false);
        typed.unmount();

        const none = mountComposer({ctx: ctx({...base, interaction: {canStop: true, stopClearing: null}})});
        expect(none.find("[data-composer-action='stop-more']").exists()).toBe(false);
        none.unmount();
    });

    it("菜单开着时 stopClearing 变空：菜单关上、箭头消失；之后箭头再出现时菜单不自己打开", async () => {
        const running = ctx({run: {status: "running"}, interaction: {canStop: true, canQueue: true, stopClearing: {count: 2}}});
        const current = shallowRef(running);
        const Host = defineComponent({
            setup() {
                provideAgentView({locale: () => "zh-CN", renderers: () => ({})});
                return () => h(AgentConversationComposer, {ctx: current.value, services: {}, registry});
            },
        });
        const view = mount(Host, {attachTo: document.body});
        await openStopMenu(view as ReturnType<typeof mountComposer>);
        expect(menuItems()).toHaveLength(1);
        // 用户的话都被取走了，运行还在跑。
        current.value = ctx({run: {status: "running"}, interaction: {canStop: true, canQueue: true, stopClearing: null}});
        for (let round = 0; round < 5; round += 1) await nextTick();
        await flushPromises();
        expect(menuItems()).toEqual([]);
        expect(view.find("[data-composer-action='stop-more']").exists()).toBe(false);
        // 又排了一条：箭头回来，菜单是关着的。
        current.value = running;
        for (let round = 0; round < 5; round += 1) await nextTick();
        await flushPromises();
        expect(view.find("[data-composer-action='stop-more']").attributes("aria-expanded")).toBe("false");
        expect(menuItems()).toEqual([]);
        view.unmount();
    });
});
