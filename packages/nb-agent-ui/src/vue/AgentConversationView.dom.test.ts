import {describe, expect, it} from "vitest";
import {flushPromises, mount} from "@vue/test-utils";
import {defineComponent, h, nextTick, ref} from "vue";

import {NB_UI_CATALOGS, NB_UI_NAMESPACE} from "@notnotype/nb-ui/locales";
import {createMinimalTranslator} from "@notnotype/nb-ui/text/minimal";
import {TEXT_PORT_KEY} from "@notnotype/nb-ui/text-port";
import type {TextPort} from "@notnotype/nb-ui/text-port";

import type {AgentViewContribution} from "../registry";

import type {MarkdownActivation} from "../ports";
import {createAgentViewRegistry} from "../registry";
import {NB_AGENT_UI_CATALOGS, NB_AGENT_UI_NAMESPACE} from "../locales";
import type {AgentConversationContext, AgentConversationServices, AgentLocale} from "../types";
import AgentConversationView from "./AgentConversationView.vue";
import PlainPromptEditor from "./fallback/PlainPromptEditor.vue";
import {builtinComposerContribution} from "./builtin-composer";
import {builtinMessageActionsContribution} from "./builtin-message-actions";
import {builtinRolesContribution} from "./builtin-roles";
import {builtinToolsContribution} from "./builtin-tools";

function context(): AgentConversationContext {
    return {
        session: {id: "s1", title: "第三章", summary: "", profileName: "写作助手", profileIcon: "i-lucide-feather", archived: false, summaryState: "idle"},
        availability: {status: "ready", message: "", actions: []},
        interaction: {canSend: true, canSteer: true, canQueue: true, canAnswer: true, canMutateHistory: true, canStop: true, canRegisterAttachments: false, canChangeRuntime: true, canArchive: true, canRestore: true, canManageModels: false},
        run: {status: "idle", phase: ""},
        messages: [
            {kind: "user", id: "u1", timestamp: 1, intent: "normal", blocks: [{kind: "text", text: "画张图"}], contentOmitted: false},
            {kind: "assistant", id: "a1", timestamp: 2, status: "done", text: "![甲](a.png) ![乙](b.png)", thinking: "", model: "m", toolCalls: [], contentOmitted: false},
        ],
        history: {hasMore: false, loading: false, error: null},
        branches: {},
        editing: null,
        pendingInputs: [],
        workflows: {},
        workspaceChanges: {groups: [], selectedPath: null, loading: false, error: null},
        composer: {models: [], modelKey: null, thinkingLevels: [], thinking: null, modes: [], mode: "normal", queued: [], attachments: [], recall: [], draft: {text: "", version: 1}},
        usage: {contextTokens: 0, contextLimit: null, totalTokens: 0, cacheRead: 0, cacheWrite: 0, cacheHitRate: null, cost: null, currency: "USD"},
        connection: {status: "connected", actionRequired: false},
        panels: {},
        now: 3,
        extensions: {},
    };
}

const registry = createAgentViewRegistry([builtinRolesContribution, builtinToolsContribution, builtinMessageActionsContribution, builtinComposerContribution]);

/** 注入的 Markdown 显示的替身：每张图一个按钮，点了发出 image 的 activate。 */
const FakeMarkdown = defineComponent({
    props: {text: {type: String, required: true}},
    emits: ["activate"],
    setup(props, {emit}) {
        return () => h("div", [...props.text.matchAll(/\]\(([^)]+)\)/gu)].map((match) => {
            const activation: MarkdownActivation = {kind: "image", address: match[1]!};
            return h("button", {"data-image": match[1], onClick: () => emit("activate", activation)});
        }));
    },
});

/** 可以手动完成的图片换算：记下每次请求、它的取消信号与归还次数。 */
function controllableResolver() {
    const requests: Array<{src: string; signal: AbortSignal; released: number; finish: () => void}> = [];
    const resolveMarkdownAsset: NonNullable<AgentConversationServices["resolveMarkdownAsset"]> = (src, signal) => new Promise((resolve) => {
        const request = {src, signal, released: 0, finish: () => resolve({url: `blob:lab/${src}`, release: () => { request.released += 1; }})};
        requests.push(request);
    });
    return {requests, resolveMarkdownAsset};
}

function mountView(locale: AgentLocale, services: Partial<AgentConversationServices> = {}, options: {ctx?: AgentConversationContext; registry?: typeof registry; plain?: boolean; header?: boolean; processDisclosure?: "collapsed" | "live"; bareServices?: boolean; markdownPreview?: (text: string) => string; port?: TextPort} = {}) {
    return mount(AgentConversationView, {
        ...(options.port === undefined ? {} : {global: {provide: {[TEXT_PORT_KEY as symbol]: options.port}}}),
        props: {
            ...(options.header === undefined ? {} : {header: options.header}),
            ...(options.processDisclosure === undefined ? {} : {processDisclosure: options.processDisclosure}),
            ctx: options.ctx ?? context(),
            registry: options.registry ?? registry,
            locale,
            renderers: {...(options.plain === true ? {} : {markdown: FakeMarkdown}), ...(options.markdownPreview === undefined ? {} : {markdownPreview: options.markdownPreview})},
            services: options.bareServices === true ? services : {resolveAttachmentUrl: () => null, resolveTriggerMenu: () => ({items: []}), ...services},
        },
        attachTo: document.body,
    });
}

describe("AgentConversationView", () => {
    it("视图自己的文字也跟着 locale：英文界面下顶栏按钮是英文", () => {
        const view = mountView("en-US");
        expect(view.find("[aria-label='More actions']").exists()).toBe(true);
        expect(view.find("[aria-label='更多操作']").exists()).toBe(false);
        view.unmount();
    });

    it("宿主注入了翻译端口时语言以端口为准，locale 不起作用；端口换语言，不重新挂载就跟着换", async () => {
        const translator = createMinimalTranslator({catalogs: {[NB_UI_NAMESPACE]: NB_UI_CATALOGS, [NB_AGENT_UI_NAMESPACE]: NB_AGENT_UI_CATALOGS}, strict: true});
        const locale = ref("en-US");
        const port: TextPort = {locale, t: (text) => translator.translate(text, locale.value), variants: (text) => translator.variants(text)};
        const view = mountView("zh-CN", {}, {port});
        expect(view.find("[aria-label='More actions']").exists()).toBe(true);
        locale.value = "zh-CN";
        await nextTick();
        expect(view.find("[aria-label='更多操作']").exists()).toBe(true);
        view.unmount();
    });

    it("回复里的图片：连点两张时先点的那次被取消、晚到的地址立即归还；关掉预览归还当前这张，卸载时不再多还", async () => {
        const {requests, resolveMarkdownAsset} = controllableResolver();
        const view = mountView("zh-CN", {resolveMarkdownAsset});
        await view.get("[data-image='a.png']").trigger("click");
        await flushPromises();
        await view.get("[data-image='b.png']").trigger("click");
        await flushPromises();
        expect(requests.map((request) => [request.src, request.signal.aborted])).toEqual([["a.png", true], ["b.png", false]]);

        expect(view.emitted("action") ?? []).toEqual([]);

        requests[0]!.finish();
        await flushPromises();
        expect(requests[0]!.released).toBe(1);
        expect(document.querySelector("[role='dialog'] img")).toBeNull();

        requests[1]!.finish();
        await flushPromises();
        expect(document.querySelector("[role='dialog'] img")?.getAttribute("src")).toBe("blob:lab/b.png");
        expect(requests[1]!.released).toBe(0);

        (document.querySelector("[role='dialog'] [aria-label='关闭']") as HTMLElement).click();
        await flushPromises();
        expect(requests[1]!.released).toBe(1);
        view.unmount();
        expect(requests.map((request) => request.released)).toEqual([1, 1]);
    });

    it("换算被取消后以失败告终也不打开预览；同步抛错不从点击里逸出", async () => {
        const view = mountView("zh-CN", {
            resolveMarkdownAsset: (src) => {
                if (src === "a.png") throw new Error("坏地址");
                return Promise.reject(new DOMException("aborted", "AbortError"));
            },
        });
        await view.get("[data-image='a.png']").trigger("click");
        await view.get("[data-image='b.png']").trigger("click");
        await flushPromises();
        expect(document.querySelector("[role='dialog']")).toBeNull();
        view.unmount();
    });
});

describe("宿主组件（验收 21）", () => {
    it("宿主登记的节点组件收到 ctx、服务与界面语言，它发出的 action 到达宿主", async () => {
        const seen: Array<{session: string | undefined; hasServices: boolean; locale: string}> = [];
        const Answer = defineComponent({
            props: {call: {type: Object, required: true}, ctx: {type: Object, required: true}, services: {type: Object, required: true}, locale: {type: String, required: true}},
            emits: ["action"],
            setup(props, {emit}) {
                return () => {
                    seen.push({session: (props.ctx as AgentConversationContext).session?.title, hasServices: typeof (props.services as AgentConversationServices).resolveAttachmentUrl === "function", locale: props.locale});
                    return h("button", {"data-source": "", onClick: () => emit("action", {type: "reference.open", target: "chapter://c3"})});
                };
            },
        });
        const plugin: AgentViewContribution = {
            source: "test:plugin",
            tools: [{id: "answer", toolNames: ["answer"], category: "interact", icon: "i-lucide-message-square-text", label: "作答", presentation: "node", node: Answer, summary: () => ""}],
        };
        const ctx = context();
        ctx.run = {status: "running", phase: ""};
        ctx.messages = [ctx.messages[0]!, {kind: "assistant", id: "a1", timestamp: 2, status: "streaming", text: "", thinking: "", model: "m", toolCalls: [{id: "q1", name: "answer", status: "running", args: {}}], contentOmitted: false}];
        const view = mountView("en-US", {}, {ctx, registry: createAgentViewRegistry([builtinRolesContribution, builtinToolsContribution, plugin]), plain: true});
        await view.get("[data-source]").trigger("click");
        expect(seen.at(-1)).toEqual({session: "第三章", hasServices: true, locale: "en-US"});
        expect(view.emitted("action")?.map((args) => args[0])).toEqual([{type: "reference.open", target: "chapter://c3"}]);
        view.unmount();
    });
});

describe("压缩的分隔线（t11）", () => {
    const divider = (id: string, patch: Partial<Extract<AgentConversationContext["messages"][number], {kind: "system"}>> = {}): AgentConversationContext["messages"][number] => ({
        kind: "system", id, timestamp: 3, source: "compaction", label: {key: "harness.compaction"} as never, text: "", ...patch,
    });
    const shaken = {method: "nbook.agent.shake", tokensBefore: 90_000, tokensAfter: 40_000, model: null, require: [], restored: [], omitted: 3, keptTurns: null} as const;
    const summarized = {method: "nbook.agent.summary", tokensBefore: 90_000, tokensAfter: 9_000, model: {name: "p/small", input: 2_000, output: 900, cacheRead: 6_000, cacheWrite: 0, cost: null}, require: ["保留人名"], restored: [{kind: "file", target: "project://a.md", tokens: 500, truncated: true}], omitted: 0, keptTurns: 2} as const;

    it("整理工具结果的压缩没有摘要也能点开：写“没有调用模型”与省略的条数，没有花费与放回", async () => {
        const ctx = context();
        ctx.messages = [...ctx.messages, divider("c1", {compaction: shaken})];
        const view = mountView("zh-CN", {}, {ctx});
        const toggle = view.get("[data-divider] button.acv-divider__toggle");
        expect(view.find("[data-compaction-detail]").exists()).toBe(false);
        await toggle.trigger("click");
        const text = view.get("[data-compaction-detail]").text();
        expect(text).toContain("精简工具结果");
        expect(text).toContain("没有调用模型");
        expect(text).toContain("省略了 3 条工具结果");
        expect(text).toContain("90.0k → 40.0k tokens");
        expect(text).not.toContain("用量");
        expect(text).not.toContain("放回");
        view.unmount();
    });

    it("摘要方法：模型、用量（单价未知）、要求、保留的轮数与放回的文件；摘要全文在详情下面", async () => {
        const ctx = context();
        ctx.messages = [...ctx.messages, divider("c1", {text: "摘要正文", compaction: summarized})];
        const view = mountView("zh-CN", {}, {ctx});
        await view.get("[data-divider] button.acv-divider__toggle").trigger("click");
        const text = view.get("[data-compaction-detail]").text();
        for (const expected of ["用压缩模型摘要", "p/small", "输入 8.0k（缓存读 6.0k），输出 900", "单价未知", "90.0k → 9.5k", "保留人名", "最近 2 轮的原文", "project://a.md", "只放回了前一部分"]) expect(text).toContain(expected);
        expect(view.find("[data-divider] .acv-divider__body").exists()).toBe(true);
        view.unmount();
    });

    it("一轮中途压缩过：整轮收起时分隔线仍在摘要行下面，点得开", async () => {
        const ctx = context();
        ctx.messages = [
            ctx.messages[0]!,
            {kind: "assistant", id: "a0", timestamp: 2, status: "done", text: "", thinking: "", model: "m", toolCalls: [{id: "t1", name: "read", status: "success", args: {path: "a.md"}}], contentOmitted: false},
            divider("c1", {compaction: summarized, text: "摘要"}),
            {kind: "assistant", id: "a1", timestamp: 4, status: "done", text: "写好了", thinking: "", model: "m", toolCalls: [], contentOmitted: false},
        ];
        const view = mountView("zh-CN", {}, {ctx});
        expect(view.find("[data-turn-summary]").attributes("aria-expanded")).toBe("false");
        expect(view.findAll("[data-divider]")).toHaveLength(1);
        await view.get("[data-divider] button.acv-divider__toggle").trigger("click");
        expect(view.find("[data-compaction-detail]").exists()).toBe(true);
        view.unmount();
    });

    it("一轮中途压缩过：整轮展开后分隔线只出现一次（在过程里），不再在摘要行下重复", async () => {
        const ctx = context();
        ctx.messages = [
            ctx.messages[0]!,
            {kind: "assistant", id: "a0", timestamp: 2, status: "done", text: "", thinking: "", model: "m", toolCalls: [{id: "t1", name: "read", status: "success", args: {path: "a.md"}}], contentOmitted: false},
            divider("c1", {compaction: summarized, text: "摘要"}),
            {kind: "assistant", id: "a1", timestamp: 4, status: "done", text: "写好了", thinking: "", model: "m", toolCalls: [], contentOmitted: false},
        ];
        const view = mountView("zh-CN", {}, {ctx});
        await view.get("[data-turn-summary]").trigger("click");
        expect(view.find("[data-turn-summary]").attributes("aria-expanded")).toBe("true");
        expect(view.findAll("[data-divider]")).toHaveLength(1);
        view.unmount();
    });
});

describe("被退回的结果（验收 29）", () => {
    it("展开整轮后宿主的节点组件只画作数的那一次，被退回的那次是一行，行上是渲染器写的退回原因", async () => {
        const rendered: string[] = [];
        const Answer = defineComponent({
            props: {call: {type: Object, required: true}},
            setup(props) {
                return () => {
                    rendered.push((props.call as {id: string}).id);
                    return h("div", {"data-answer": ""}, "答案卡片");
                };
            },
        });
        const plugin: AgentViewContribution = {
            source: "test:story",
            tools: [{
                id: "answer", toolNames: ["answer"], category: "interact", icon: "i-lucide-message-square-text", label: "交卷", presentation: "node", node: Answer, outcome: true,
                summary: (call) => (call.status === "error" ? `退回：${call.error ?? ""}` : ""),
            }],
        };
        const ctx = context();
        ctx.messages = [
            ctx.messages[0]!,
            {kind: "assistant", id: "a1", timestamp: 2, status: "done", text: "", thinking: "", model: "m", contentOmitted: false, toolCalls: [{id: "q1", name: "answer", status: "error", args: {}, error: "41.20 不是读过的段落"}]},
            {kind: "assistant", id: "a2", timestamp: 3, status: "done", text: "", thinking: "", model: "m", contentOmitted: false, toolCalls: [{id: "q2", name: "answer", status: "success", args: {}}]},
        ];
        const view = mountView("zh-CN", {}, {ctx, plain: true, registry: createAgentViewRegistry([builtinRolesContribution, builtinToolsContribution, plugin])});
        await view.get("[data-turn-summary]").trigger("click");
        await view.get("[data-chain-summary]").trigger("click");
        expect(view.findAll("[data-answer]")).toHaveLength(1);
        expect(new Set(rendered)).toEqual(new Set(["q2"]));
        expect(view.text()).toContain("退回：41.20 不是读过的段落");
        view.unmount();
    });
});

describe("附注与条目渲染器（验收 28）", () => {
    function setup(entryComponent: ReturnType<typeof defineComponent>) {
        const plugin: AgentViewContribution = {source: "test:story", entries: [{id: "refs", customType: "story.refs", component: entryComponent}]};
        const note = (refs: string[]) => ({customType: "story.refs", text: `没核实的出处：${refs.join("、")}`, details: {refs}});
        const ctx = context();
        ctx.messages = [
            ctx.messages[0]!,
            {kind: "assistant", id: "a1", timestamp: 2, status: "done", text: "先查目录", thinking: "", model: "m", contentOmitted: false, toolCalls: [{id: "r1", name: "read", status: "success", args: {path: "a.md"}}], annotations: [note(["1.1"])]},
            {kind: "assistant", id: "a2", timestamp: 3, status: "done", text: "第 37 章", thinking: "", model: "m", contentOmitted: false, toolCalls: [], annotations: [note(["41.20"]), {customType: "story.other", text: "没有登记的附注"}]},
        ];
        return mountView("en-US", {}, {ctx, plain: true, registry: createAgentViewRegistry([builtinRolesContribution, builtinToolsContribution, plugin])});
    }

    it("最终回复的附注在气泡里由宿主组件画，整轮收起后也在；组件收到附注、消息、ctx 与界面语言，发出的 action 到达宿主", async () => {
        const seen: string[] = [];
        const Refs = defineComponent({
            props: {annotation: {type: Object, required: true}, message: {type: Object, required: true}, ctx: {type: Object, required: true}, services: {type: Object, required: true}, locale: {type: String, required: true}},
            emits: ["action"],
            setup(props, {emit}) {
                return () => {
                    const refs = ((props.annotation as {details: {refs: string[]}}).details.refs);
                    seen.push(`${(props.message as {id: string}).id}:${props.locale}:${(props.ctx as AgentConversationContext).session?.id}`);
                    return h("button", {"data-ref": refs[0], onClick: () => emit("action", {type: "reference.open", target: `paragraph://${refs[0]}`})}, refs.join("、"));
                };
            },
        });
        const view = setup(Refs);
        const bubble = view.get("[data-final-reply]");
        await bubble.get("[data-ref='41.20']").trigger("click");
        expect(view.emitted("action")?.map((args) => args[0])).toEqual([{type: "reference.open", target: "paragraph://41.20"}]);
        expect(seen).toContain("a2:en-US:s1");
        expect(bubble.text()).toContain("没有登记的附注");
        // 过程里的中间 content：思维链展开后，附注在那段文字下面。
        expect(view.find("[data-ref='1.1']").exists()).toBe(false);
        await view.get("[data-turn-summary]").trigger("click");
        await view.get("[data-chain-summary]").trigger("click");
        expect(view.find(".acv-narration [data-ref='1.1']").exists()).toBe(true);
        view.unmount();
    });

    it("宿主组件抛错时这条附注退回自己的那一句，不画错误卡片", async () => {
        const Broken = defineComponent({
            setup() {
                return () => {
                    throw new Error("条目坏了");
                };
            },
        });
        const errors: unknown[] = [];
        const original = console.error;
        console.error = (...args: unknown[]) => errors.push(args[0]);
        try {
            const view = setup(Broken);
            await flushPromises();
            const bubble = view.get("[data-final-reply]");
            expect(bubble.text()).toContain("没核实的出处：41.20");
            expect(bubble.find("[data-render-failed]").exists()).toBe(false);
            expect(errors.some((message) => String(message).includes("条目 refs 的组件"))).toBe(true);
            view.unmount();
        } finally {
            console.error = original;
        }
    });

    it("没有文字的消息（只交了答案）的附注单独成一行，排在回复之后、不在回复气泡里，整轮收起后仍在", () => {
        const Refs = defineComponent({
            props: {annotation: {type: Object, required: true}},
            setup(props) {
                return () => h("span", {"data-ref": (props.annotation as {details: {refs: string[]}}).details.refs[0]});
            },
        });
        const plugin: AgentViewContribution = {source: "test:story", entries: [{id: "refs", customType: "story.refs", component: Refs}]};
        const ctx = context();
        ctx.messages = [
            ctx.messages[0]!,
            {kind: "assistant", id: "a1", timestamp: 2, status: "done", text: "第 37 章", thinking: "", model: "m", contentOmitted: false, toolCalls: []},
            {kind: "assistant", id: "a2", timestamp: 3, status: "done", text: "", thinking: "", model: "m", contentOmitted: false, toolCalls: [], annotations: [
                {customType: "story.refs", text: "没核实的出处：41.20", details: {refs: ["41.20"]}},
                {customType: "story.other", text: "没有登记的附注"},
            ]},
        ];
        const view = mountView("zh-CN", {}, {ctx, plain: true, registry: createAgentViewRegistry([builtinRolesContribution, builtinToolsContribution, plugin])});
        const block = view.get("[data-annotations]");
        expect(block.find("[data-ref='41.20']").exists()).toBe(true);
        expect(block.text()).toContain("没有登记的附注");
        expect(view.get("[data-final-reply]").find("[data-ref]").exists()).toBe(false);
        expect(view.find("[data-error]").exists()).toBe(false);
        view.unmount();
    });
});

describe("宿主的详情组件（验收 21）", () => {
    it("工具详情组件收到服务与界面语言，它发出的 action 到达宿主", async () => {
        const seen: string[] = [];
        const Detail = defineComponent({
            props: {call: {type: Object, required: true}, ctx: {type: Object, required: true}, services: {type: Object, required: true}, locale: {type: String, required: true}},
            emits: ["action"],
            setup(props, {emit}) {
                return () => {
                    seen.push(`${props.locale}:${typeof (props.services as AgentConversationServices).resolveAttachmentUrl}`);
                    return h("button", {"data-detail-link": "", onClick: () => emit("action", {type: "reference.open", target: "chapter://c1"})});
                };
            },
        });
        const plugin: AgentViewContribution = {
            source: "test:plugin",
            tools: [{id: "lookup", toolNames: ["lookup"], category: "other", icon: "i-lucide-search", label: "查", presentation: "card", detail: Detail, summary: () => "雨夜"}],
        };
        const ctx = context();
        ctx.run = {status: "running", phase: ""};
        ctx.messages = [ctx.messages[0]!, {kind: "assistant", id: "a1", timestamp: 2, status: "streaming", text: "", thinking: "", model: "m", contentOmitted: false, toolCalls: [{id: "k1", name: "lookup", status: "success", args: {}}]}];
        const view = mountView("en-US", {}, {ctx, plain: true, processDisclosure: "live", registry: createAgentViewRegistry([builtinRolesContribution, builtinToolsContribution, plugin])});
        await view.get(".acv-steps .nb-collapsible-card button").trigger("click");
        await view.get("[data-detail-link]").trigger("click");
        expect(seen.at(-1)).toBe("en-US:function");
        expect(view.emitted("action")?.map((args) => args[0])).toEqual([{type: "reference.open", target: "chapter://c1"}]);
        view.unmount();
    });
});

describe("运行中的投递开关（验收 23）", () => {
    function composing(status: "running" | "waiting" | "stopping", text: string, deliveries: {canSteer: boolean; canQueue: boolean}): AgentConversationContext {
        const ctx = context();
        ctx.run = {status, phase: ""};
        ctx.interaction = {...ctx.interaction, ...deliveries};
        ctx.composer = {...ctx.composer, draft: {text, version: 2}};
        return ctx;
    }
    const send = (view: ReturnType<typeof mountView>) => view.get("[data-composer-action='send']");

    it("运行中、等待回答与停止中都不允许投递时：能写，发送键禁用，标题与占位说明要等运行结束", () => {
        for (const status of ["running", "waiting", "stopping"] as const) {
            const view = mountView("zh-CN", {}, {ctx: composing(status, "加快节奏", {canSteer: false, canQueue: false}), plain: true});
            expect(send(view).attributes("disabled")).toBeDefined();
            expect(send(view).attributes("title")).toBe("运行结束后发送");
            expect(view.getComponent(PlainPromptEditor).props("placeholder")).toBe("运行结束后才能发送消息");
            expect(view.getComponent(PlainPromptEditor).props("readonly")).toBe(false);
            view.unmount();
        }
    });

    it("登记的命令照常可发，标题写“发送”；只许排队时标题写“排队”", () => {
        const command = mountView("zh-CN", {}, {ctx: composing("running", "/compact", {canSteer: false, canQueue: false}), plain: true});
        expect(send(command).attributes("disabled")).toBeUndefined();
        expect(send(command).attributes("title")).toBe("发送");
        command.unmount();
        const queue = mountView("zh-CN", {}, {ctx: composing("running", "加快节奏", {canSteer: false, canQueue: true}), plain: true});
        expect(send(queue).attributes("title")).toBe("排队");
        queue.unmount();
    });
});

describe("渲染器出错（验收 15）", () => {
    it("插件的节点组件与摘要回调抛错：只有这一项降级为“此内容无法显示”，其余消息照常显示", async () => {
        const Boom = defineComponent({
            setup() {
                return () => {
                    throw new Error("节点坏了");
                };
            },
        });
        const plugin: AgentViewContribution = {
            source: "test:plugin",
            tools: [{
                id: "boom", toolNames: ["boom"], category: "interact", icon: "i-lucide-bomb", label: "炸", presentation: "node", node: Boom,
                summary: () => {
                    throw new Error("摘要坏了");
                },
            }],
        };
        const ctx = context();
        ctx.messages = [
            ctx.messages[0]!,
            {kind: "assistant", id: "a1", timestamp: 2, status: "done", text: "前面的回复照常显示", thinking: "", model: "m", toolCalls: [{id: "b1", name: "boom", status: "success", args: {}}], contentOmitted: false},
            {kind: "assistant", id: "a2", timestamp: 3, status: "done", text: "后面的回复也照常显示", thinking: "", model: "m", toolCalls: [], contentOmitted: false},
        ];
        const view = mountView("zh-CN", {}, {ctx, registry: createAgentViewRegistry([builtinRolesContribution, builtinToolsContribution, plugin]), plain: true});
        // 已结束的轮次默认收起，节点在过程里：先展开整轮。
        await view.get("[data-turn-summary]").trigger("click");
        expect(view.findAll("[data-render-failed]")).toHaveLength(1);
        expect(view.text()).toContain("此内容无法显示");
        expect(view.text()).toContain("后面的回复也照常显示");
        view.unmount();
    });
});

describe("运行中逐步展开（验收 22）", () => {
    function runningCtx(): AgentConversationContext {
        const ctx = context();
        ctx.run = {status: "running", phase: ""};
        ctx.messages = [ctx.messages[0]!, {kind: "assistant", id: "a1", timestamp: 2, status: "streaming", text: "", thinking: "", model: "m", contentOmitted: false, toolCalls: [
            {id: "r1", name: "read", status: "success", args: {path: "第一章.md"}},
            {id: "r2", name: "read", status: "running", args: {path: "第二章.md"}},
        ]}];
        return ctx;
    }

    it("live 时运行中的思维链与工具组展开，逐项列出；缺省时折叠", () => {
        const live = mountView("zh-CN", {}, {ctx: runningCtx(), plain: true, processDisclosure: "live"});
        expect(live.find(".acv-steps").exists()).toBe(true);
        expect(live.text()).toContain("第一章.md");
        live.unmount();
        const collapsed = mountView("zh-CN", {}, {ctx: runningCtx(), plain: true});
        expect(collapsed.find(".acv-steps").exists()).toBe(false);
        collapsed.unmount();
    });

    it("用户点开的思考在思维链重新分组（下一次读取把它并进工具组）后仍是展开的", async () => {
        const ctx = runningCtx();
        const reading = (id: string, path: string, status: "success" | "running") => ({kind: "assistant" as const, id, timestamp: 2, status: "streaming" as const, text: "", thinking: "", model: "m", contentOmitted: false, toolCalls: [{id: `${id}:r`, name: "read", status, args: {path}}]});
        const thinking = {kind: "assistant" as const, id: "t1", timestamp: 2, status: "streaming" as const, text: "", thinking: "先想第二步\n要读第二章", model: "m", contentOmitted: false, toolCalls: []};
        ctx.messages = [ctx.messages[0]!, reading("a1", "第一章.md", "success"), thinking];
        const view = mountView("zh-CN", {}, {ctx, plain: true, processDisclosure: "live"});
        const row = view.findAll(".acv-steps button").find((button) => button.text().includes("先想第二步"));
        await row!.trigger("click");
        expect(view.text()).toContain("要读第二章");
        await view.setProps({ctx: {...ctx, messages: [...ctx.messages, reading("a2", "第二章.md", "running")]}});
        expect(view.text()).toContain("要读第二章");
        view.unmount();
    });

    it("运行出错结束：最新一轮仍展开，但思维链回到默认折叠", async () => {
        const ctx = runningCtx();
        const view = mountView("zh-CN", {}, {ctx, plain: true, processDisclosure: "live"});
        expect(view.find(".acv-steps").exists()).toBe(true);
        const failed = context();
        failed.messages = [ctx.messages[0]!, {...ctx.messages[1]!, status: "error", error: "连接断了"} as AgentConversationContext["messages"][number]];
        await view.setProps({ctx: failed});
        expect(view.find("[data-chain-summary]").exists()).toBe(true);
        expect(view.find(".acv-steps").exists()).toBe(false);
        view.unmount();
    });

    it("运行结束后回到折叠", async () => {
        const ctx = runningCtx();
        const view = mountView("zh-CN", {}, {ctx, plain: true, processDisclosure: "live"});
        const done = context();
        done.messages = [ctx.messages[0]!, {...ctx.messages[1]!, status: "done", toolCalls: [{id: "r1", name: "read", status: "success", args: {path: "第一章.md"}}, {id: "r2", name: "read", status: "success", args: {path: "第二章.md"}}]} as AgentConversationContext["messages"][number], {kind: "assistant", id: "a2", timestamp: 3, status: "done", text: "读完了。", thinking: "", model: "m", toolCalls: [], contentOmitted: false}];
        await view.setProps({ctx: done});
        expect(view.find(".acv-steps").exists()).toBe(false);
        view.unmount();
    });
});

describe("思考预览（验收 30）", () => {
    // 真实模型的思考摘要：几段粗体小标题首尾相接写在一个思考块里。
    function thinkingCtx(): AgentConversationContext {
        const ctx = context();
        ctx.run = {status: "running", phase: ""};
        ctx.messages = [ctx.messages[0]!, {kind: "assistant", id: "a1", timestamp: 2, status: "streaming", text: "", thinking: "**Gathering arcs****Checking summaries**\n\n先看目录", model: "m", contentOmitted: false, toolCalls: [{id: "r1", name: "read", status: "running", args: {path: "a.md"}}]}];
        return ctx;
    }
    const thinkingRow = (view: ReturnType<typeof mountView>) => view.findAll(".acv-steps .nb-collapsible-row__detail").map((detail) => detail.text());

    it("折叠的思考露出去掉 Markdown 标记的第一段", () => {
        const view = mountView("zh-CN", {}, {ctx: thinkingCtx(), plain: true, processDisclosure: "live"});
        expect(thinkingRow(view)).toContain("Gathering arcs");
        expect(view.text()).not.toContain("**");
        view.unmount();
    });

    function reminderCtx(): AgentConversationContext {
        const ctx = context();
        ctx.messages = [...ctx.messages, {kind: "system", id: "n1", timestamp: 9, source: "reminder", label: "提醒", text: "**注意**：先存盘\n\n细节"}];
        return ctx;
    }

    it("折叠的提醒同样去掉标记，宿主注入时用宿主的", () => {
        const view = mountView("zh-CN", {}, {ctx: reminderCtx(), plain: true});
        expect(view.get(".acv-notice__text").text()).toBe("注意：先存盘");
        view.unmount();
        const injected = mountView("zh-CN", {}, {ctx: reminderCtx(), plain: true, markdownPreview: (text) => `宿主：${text.length}`});
        expect(injected.get(".acv-notice__text").text()).toBe(`宿主：${"**注意**：先存盘\n\n细节".length}`);
        injected.unmount();
    });

    it("宿主的 markdownPreview 抛错时这一行按缺省写法，只报一次", () => {
        const errors: unknown[] = [];
        const original = console.error;
        console.error = (...args: unknown[]) => errors.push(args[0]);
        try {
            const ctx = reminderCtx();
            ctx.messages = [...ctx.messages, {kind: "system", id: "n2", timestamp: 10, source: "reminder", label: "提醒", text: "*再*提醒"}];
            const view = mountView("zh-CN", {}, {ctx, plain: true, markdownPreview: () => {
                throw new Error("方言坏了");
            }});
            expect(view.findAll(".acv-notice__text").map((line) => line.text())).toEqual(["注意：先存盘", "再提醒"]);
            expect(errors.filter((message) => String(message).includes("markdownPreview"))).toHaveLength(1);
            view.unmount();
        } finally {
            console.error = original;
        }
    });

    it("宿主注入了 markdownPreview 时用它", () => {
        const view = mountView("zh-CN", {}, {ctx: thinkingCtx(), plain: true, processDisclosure: "live", markdownPreview: (text) => `宿主：${text.length}`});
        expect(thinkingRow(view)).toContain(`宿主：${"**Gathering arcs****Checking summaries**\n\n先看目录".length}`);
        view.unmount();
    });
});

describe("没有数据的区域不显示（验收 24）", () => {
    it("header 为 false 时没有顶栏；没有模型与思考档位时没有模型下拉；会话加载中时消息流显示加载中", () => {
        const ctx = context();
        ctx.messages = [];
        ctx.availability = {status: "loading", message: "", actions: []};
        const view = mountView("zh-CN", {}, {ctx, plain: true, header: false});
        expect(view.find("[aria-label='更多操作']").exists()).toBe(false);
        expect(view.find(".acv-model-picker__trigger").exists()).toBe(false);
        expect(view.text()).toContain("正在加载会话");
        view.unmount();

        const withModels = context();
        withModels.composer = {...withModels.composer, models: [{key: "m", label: "模型甲", supportsImages: false}], modelKey: "m"};
        const shown = mountView("zh-CN", {}, {ctx: withModels, plain: true});
        expect(shown.find(".acv-model-picker__trigger").exists()).toBe(true);
        shown.unmount();
    });

    it("不提供附件地址与触发菜单两项服务：附件显示不可用占位，编辑器只拿到 / 触发字符", async () => {
        const ctx = context();
        ctx.messages = [{kind: "user", id: "u1", timestamp: 1, intent: "normal", contentOmitted: false, blocks: [
            {kind: "text", text: "看图"},
            {kind: "attachment", locator: "session://attachments/草图.png", name: "草图.png", mimeType: "image/png", bytes: 10},
        ]}];
        const view = mountView("zh-CN", {}, {ctx, plain: true, bareServices: true});
        expect(view.find(".acv-user-content__image--missing").exists()).toBe(true);
        expect(view.find(".acv-user-content__image-button").exists()).toBe(false);
        expect(view.getComponent(PlainPromptEditor).props("triggers")).toEqual(["/"]);
        view.unmount();
    });
});

describe("宿主每秒换 now", () => {
    it("整体替换 ctx 打节拍时，已结束的轮次不重新整理", async () => {
        let calls = 0;
        const counting: AgentViewContribution = {
            source: "test:count",
            tools: [{id: "count", toolNames: ["count"], category: "mutate", icon: "i-lucide-pen", label: "计数", presentation: "line", summary: () => "", effects: () => {
                calls += 1;
                return {read: [], changed: []};
            }}],
        };
        const ctx = context();
        ctx.messages = [ctx.messages[0]!, {kind: "assistant", id: "a1", timestamp: 2, status: "done", text: "", thinking: "", model: "m", contentOmitted: false, toolCalls: [{id: "c1", name: "count", status: "success", args: {}}]}, {kind: "assistant", id: "a2", timestamp: 3, status: "done", text: "改好了。", thinking: "", model: "m", toolCalls: [], contentOmitted: false}];
        const view = mountView("zh-CN", {}, {ctx, plain: true, registry: createAgentViewRegistry([builtinRolesContribution, builtinToolsContribution, counting])});
        const afterMount = calls;
        for (const now of [10, 11, 12]) await view.setProps({ctx: {...ctx, now}});
        expect(calls).toBe(afterMount);
        view.unmount();
    });
});

