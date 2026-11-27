import {describe, expect, it} from "vitest";
import {flushPromises, mount} from "@vue/test-utils";
import {defineComponent, h, nextTick, ref, shallowRef} from "vue";

import {NB_UI_CATALOGS, NB_UI_NAMESPACE} from "@notnotype/nb-ui/locales";
import {createMinimalTranslator} from "@notnotype/nb-ui/text/minimal";
import {TEXT_PORT_KEY} from "@notnotype/nb-ui/text-port";
import type {TextPort} from "@notnotype/nb-ui/text-port";

import type {AgentViewContribution} from "../registry";

import type {MarkdownActivation} from "../ports";
import {createAgentViewRegistry} from "../registry";
import {applyComposerAction} from "../composer-actions";
import {NB_AGENT_UI_CATALOGS, NB_AGENT_UI_NAMESPACE} from "../locales";
import type {AgentConversationContext, AgentConversationServices, AgentLocale, AgentViewAction, AgentWelcomeView} from "../types";
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

function mountView(locale: AgentLocale, services: Partial<AgentConversationServices> = {}, options: {ctx?: AgentConversationContext; registry?: typeof registry; plain?: boolean; header?: boolean; processDisclosure?: "collapsed" | "live"; bareServices?: boolean; markdownPreview?: (text: string) => string; promptBareness?: (texts: readonly string[]) => boolean; port?: TextPort; viewMode?: "turns" | "raw"} = {}) {
    return mount(AgentConversationView, {
        ...(options.port === undefined ? {} : {global: {provide: {[TEXT_PORT_KEY as symbol]: options.port}}}),
        props: {
            ...(options.header === undefined ? {} : {header: options.header}),
            ...(options.processDisclosure === undefined ? {} : {processDisclosure: options.processDisclosure}),
            ...(options.viewMode === undefined ? {} : {viewMode: options.viewMode}),
            ctx: options.ctx ?? context(),
            registry: options.registry ?? registry,
            locale,
            renderers: {...(options.plain === true ? {} : {markdown: FakeMarkdown}), ...(options.markdownPreview === undefined ? {} : {markdownPreview: options.markdownPreview}), ...(options.promptBareness === undefined ? {} : {promptBareness: options.promptBareness})},
            services: options.bareServices === true ? services : {resolveAttachmentUrl: () => null, resolveTriggerMenu: () => ({items: []}), ...services},
        },
        attachTo: document.body,
    });
}

/** 面板头给的几个位置：挂在 body 上的空元素，标题那格在一个按钮里（像工作台的标题按钮）。 */
function headTargets() {
    const make = (tag: string) => document.body.appendChild(document.createElement(tag));
    const anchor = make("button");
    const title = anchor.appendChild(document.createElement("span"));
    return {start: make("div"), title, end: make("div"), anchor};
}

/** 测头用：可以给会话列表与右列的插槽、`headTargets`、`draftProfile`。 */
function mountHeadView(options: {ctx?: AgentConversationContext; newSession?: boolean; sessions?: boolean; trailing?: boolean; headTargets?: ReturnType<typeof headTargets>; draftProfile?: {name: string; icon: string}} = {}) {
    return mount(AgentConversationView, {
        props: {
            ctx: options.ctx ?? context(),
            registry,
            locale: "zh-CN",
            services: {resolveAttachmentUrl: () => null, resolveTriggerMenu: () => ({items: []})},
            ...(options.newSession === undefined ? {} : {newSession: options.newSession}),
            ...(options.headTargets === undefined ? {} : {headTargets: options.headTargets}),
            ...(options.draftProfile === undefined ? {} : {draftProfile: options.draftProfile}),
        },
        slots: {
            ...(options.sessions === true ? {sessions: ({close}: {close: () => void}) => h("div", {"data-probe-sessions": ""}, [h("button", {type: "button", "data-probe-close": "", onClick: close}, "关")])} : {}),
            ...(options.trailing === true ? {"head-trailing": () => h("button", {type: "button", "data-probe-trailing": ""}, "子代理")} : {}),
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

    it("消息流带 data-nb-agent=\"skip\"，输入框不在它里面（边界与兼容）", () => {
        const view = mountView("zh-CN");
        expect(view.get("[data-agent-stream]").attributes("data-nb-agent")).toBe("skip");
        expect(view.get("[data-agent-composer]").element.closest("[data-nb-agent='skip']")).toBeNull();
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

    it("还没确认的消息：前面有别的话先跑时写“前面还有 N 条”，没有时写“发送中”", async () => {
        const ctx = context();
        const pending = (ahead?: number) => ({kind: "user" as const, id: "o1", timestamp: 3, intent: "normal" as const, blocks: [{kind: "text" as const, text: "合并的"}], contentOmitted: false, delivery: "pending" as const, ...(ahead === undefined ? {} : {ahead})});
        ctx.messages = [...ctx.messages, pending(2)];
        const view = mountView("zh-CN", {}, {ctx});
        await flushPromises();
        expect(view.get("[data-user-pending]").text()).toBe("前面还有 2 条");
        await view.setProps({ctx: {...ctx, messages: [...context().messages, pending(0)]}});
        expect(view.get("[data-user-pending]").text()).toBe("发送中");
        await view.setProps({ctx: {...ctx, messages: [...context().messages, pending()]}});
        expect(view.get("[data-user-pending]").text()).toBe("发送中");
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

describe("有子调用的卡片（Spec“有子调用的调用”，验收场景 37）", () => {
    const code: AgentViewContribution = {
        source: "test:code",
        tools: [{id: "code", toolNames: ["eval"], category: "other", icon: "i-lucide-square-code", label: "运行代码", presentation: "card", summary: (call) => String((call.args as {title?: string}).title ?? "")}],
    };
    const codeRegistry = createAgentViewRegistry([builtinRolesContribution, builtinToolsContribution, code]);
    const children = [
        {id: "n1", name: "read", status: "success" as const, args: {path: "大纲.md"}},
        {id: "n2", name: "write", status: "success" as const, args: {path: "第一章.md", content: "一"}},
        {id: "n3", name: "write", status: "denied" as const, args: {path: "第二章.md", content: "二"}},
    ];
    function withEval(call: Record<string, unknown>, running = false): AgentConversationContext {
        const ctx = context();
        ctx.run = running ? {status: "running", phase: ""} : ctx.run;
        ctx.now = 65_000;
        ctx.messages = [ctx.messages[0]!, {kind: "assistant", id: "a1", timestamp: 2, status: running ? "streaming" : "done", text: "", thinking: "", model: "m", contentOmitted: false, toolCalls: [{id: "e1", name: "eval", args: {title: "批量改"}, ...call} as never]}];
        return ctx;
    }
    const card = (view: ReturnType<typeof mountView>) => view.get(".acv-steps .nb-collapsible-card");

    it("收起的卡片副标题写计数；改了文件与被拒的子调用紧跟着露出，只读的不露；展开后列出全部，收起的那几行不再重复", async () => {
        const view = mountView("zh-CN", {}, {ctx: withEval({status: "error", children}, true), plain: true, processDisclosure: "live", registry: codeRegistry});
        expect(card(view).text()).toContain("批量改 · 调用了 3 次工具 · 读了 1 个文件，改了 1 个");
        expect(view.findAll("[data-card-child]").map((row) => row.text())).toEqual([expect.stringContaining("第一章.md"), expect.stringContaining("第二章.md")]);
        await card(view).get("button").trigger("click");
        expect(view.findAll("[data-card-children] .nb-collapsible-row").length).toBe(3);
        expect(view.find("[data-card-child]").exists()).toBe(false);
        view.unmount();
    });

    it("运行中：副标题写已用时、已调用几次与正在调的那一个（几个同时在跑时是最近受理的）；结束后不写用时", () => {
        const twoRunning = [children[0], {id: "n4", name: "read", status: "running", args: {path: "第十一章.md"}}, {id: "n5", name: "read", status: "running", args: {path: "第十二章.md"}}];
        const running = mountView("zh-CN", {}, {ctx: withEval({status: "running", startedAt: 3_000, children: twoRunning}, true), plain: true, processDisclosure: "live", registry: codeRegistry});
        expect(card(running).text()).toContain("批量改 · 1:02 · 已调用 3 次 · 读取 第十二章.md");
        running.unmount();
        const done = mountView("zh-CN", {}, {ctx: withEval({status: "success", startedAt: 3_000, children}, true), plain: true, processDisclosure: "live", registry: codeRegistry});
        expect(card(done).text()).toContain("批量改 · 调用了 3 次工具");
        expect(card(done).text()).not.toContain("1:02");
        done.unmount();
    });

    it("收起时出错、参数无效、结果未知的子调用也露出来", () => {
        const failing = [children[0], {id: "n6", name: "read", status: "error", args: {path: "番外.md"}, error: "文件不存在"}, {id: "n7", name: "read", status: "invalid", args: {}}, {id: "n8", name: "write", status: "unknown", args: {path: "第三章.md", content: "一"}}];
        const view = mountView("zh-CN", {}, {ctx: withEval({status: "error", children: failing}, true), plain: true, processDisclosure: "live", registry: codeRegistry});
        expect(view.findAll("[data-card-child]").length).toBe(3);
        view.unmount();
    });

    it("原始视图在这次调用下缩进列出全部子调用", () => {
        const view = mountView("zh-CN", {}, {ctx: withEval({status: "error", children}), plain: true, registry: codeRegistry, viewMode: "raw"});
        expect(view.findAll(".acv-raw__nested").map((row) => row.text())).toEqual([expect.stringContaining("大纲.md"), expect.stringContaining("第一章.md"), expect.stringContaining("第二章.md")]);
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

    it("停靠的事项不替换输入框；同步向导只收阻塞的，它在时停靠区收成一条；读屏状态区写来源", async () => {
        const docked = {kind: "approval" as const, id: "d1", toolCallId: "c-d1", tool: "write", args: {path: "user://a.md"}, preview: {state: "ready" as const, files: []}, source: {sessionId: "child-1", name: "核对员", icon: "i-lucide-bot"}};
        const blocking = {kind: "question" as const, id: "q1", toolCallId: "c-q1", questions: [{question: "视角？", options: [{label: "第一人称"}, {label: "第三人称"}]}]};
        const view = mountView("zh-CN", {}, {ctx: {...context(), pendingInputs: [docked]}});
        expect(view.find("[data-agent-dock]").exists()).toBe(true);
        expect(view.find("[data-agent-wizard]").exists()).toBe(false);
        expect(view.get(".acv-composer").isVisible()).toBe(true);
        expect(view.get("[role='status']").text()).toContain("子代理「核对员」：要你批准 write");

        await view.setProps({ctx: {...context(), pendingInputs: [docked, blocking]}});
        expect(view.get("[data-agent-wizard]").text()).toContain("视角？");
        expect(view.get("[data-agent-wizard]").text()).not.toContain("核对员");
        expect(view.find("[data-dock-collapsed]").exists()).toBe(true);
        view.unmount();
    });

    /** bot 档的会话：档位由 `ctx.interaction.placement` 给。 */
    const dockCtx = (pendingInputs: AgentConversationContext["pendingInputs"], session = context().session): AgentConversationContext => ({...context(), session, interaction: {...context().interaction, placement: "dock", canCreate: false}, pendingInputs});

    /** 打开头上的溢出菜单，交回菜单项的文字。 */
    async function overflowLabels(view: ReturnType<typeof mountView>): Promise<string[]> {
        const trigger = view.get("[aria-label='更多操作']");
        await trigger.trigger("pointerdown", {button: 0, ctrlKey: false, pointerType: "mouse"});
        await trigger.trigger("keydown", {key: "Enter"});
        await flushPromises();
        return [...document.querySelectorAll("[role='menuitem']")].map((item) => item.textContent?.trim() ?? "");
    }

    it("用法档的改写历史：canMutateHistory 为假时消息上没有编辑、重新生成、从此处新开分支；canOpenTree 为假时溢出菜单里没有分支树", async () => {
        const labels = (view: ReturnType<typeof mountView>) => view.findAll("button[aria-label]").map((button) => button.attributes("aria-label"));
        const open = mountView("zh-CN", {}, {ctx: {...context(), interaction: {...context().interaction, canMutateHistory: true, canOpenTree: true}}});
        expect(labels(open)).toEqual(expect.arrayContaining(["编辑", "重新生成", "从此处新开分支"]));
        expect(await overflowLabels(open)).toContain("分支树");
        open.unmount();
        const pinned = mountView("zh-CN", {}, {ctx: {...context(), interaction: {...context().interaction, canMutateHistory: false, canOpenTree: false, placement: "dock", canCreate: false}}});
        expect(labels(pinned).filter((label) => ["编辑", "重新生成", "从此处新开分支"].includes(label!))).toEqual([]);
        const items = await overflowLabels(pinned);
        expect(items).toContain("原始视图");
        expect(items).not.toContain("分支树");
        pinned.unmount();
    });

    it("placement 为 dock：阻塞的提问与审批也进停靠区，输入框不隐藏、照常可用；不给时照旧进向导", async () => {
        const blocking = {kind: "question" as const, id: "q1", toolCallId: "c-q1", questions: [{question: "视角？", options: [{label: "第一人称"}, {label: "第三人称"}]}]};
        const docked = mountView("zh-CN", {}, {ctx: dockCtx([blocking])});
        expect(docked.get("[data-agent-dock]").text()).toContain("视角？");
        expect(docked.find("[data-agent-wizard]").exists()).toBe(false);
        expect(docked.get(".acv-composer").isVisible()).toBe(true);
        // 可用：不在 inert 里、编辑器可写。
        expect(docked.get(".acv-composer").element.closest("[inert]")).toBeNull();
        expect(docked.get(".acv-composer [contenteditable], .acv-composer textarea").attributes("readonly")).toBeUndefined();
        docked.unmount();
        const wizard = mountView("zh-CN", {}, {ctx: {...context(), pendingInputs: [blocking]}});
        expect(wizard.find("[data-agent-wizard]").exists()).toBe(true);
        expect(wizard.find("[data-agent-dock]").exists()).toBe(false);
        wizard.unmount();
    });

    it("placement 为 dock：“本会话都批准”一并提交同一会话里同一记住范围的其余审批，别的工具、别的会话的不动", async () => {
        const approval = (id: string, tool: string, source?: {sessionId: string; name: string; icon: string}) => ({kind: "approval" as const, id, toolCallId: `c-${id}`, tool, args: {}, preview: {state: "ready" as const, files: []}, ...(source === undefined ? {} : {source})});
        const child = {sessionId: "child-1", name: "核对员", icon: "i-lucide-bot"};
        const view = mountView("zh-CN", {}, {ctx: dockCtx([approval("a1", "write"), approval("a2", "shell"), approval("a3", "write"), approval("a4", "write", child)])});
        await view.get("[data-approval-decision='allow-session']").trigger("click");
        const submitted = (view.emitted("action") ?? []).map(([action]) => action as AgentViewAction).filter((action) => action.type === "input.submit");
        expect(submitted.map((action) => action.type === "input.submit" ? [action.batchKey, action.resolutions, action.sessionId ?? null] : null)).toEqual([
            ["a1", {kind: "approval", decision: "allow-session"}, null],
            ["a3", {kind: "approval", decision: "allow-session"}, null],
        ]);
        view.unmount();
    });

    it("placement 为 dock：答完一个，焦点到停靠区的容器（不落到按钮上）；都答完回到输入框；换了会话不算答完", async () => {
        const question = (id: string, text: string) => ({kind: "question" as const, id, toolCallId: `c-${id}`, questions: [{question: text, options: [{label: "是"}, {label: "否"}]}]});
        const view = mountView("zh-CN", {}, {ctx: dockCtx([question("q1", "第一问"), question("q2", "第二问")])});
        view.get<HTMLElement>("[data-agent-dock] button:not(:disabled)").element.focus();
        expect(view.get("[data-agent-dock]").element.contains(document.activeElement)).toBe(true);
        await view.setProps({ctx: dockCtx([question("q2", "第二问")])});
        await flushPromises();
        expect(document.activeElement).toBe(view.get("[data-agent-dock]").element);
        await view.setProps({ctx: dockCtx([])});
        await flushPromises();
        expect(view.get(".acv-composer").element.contains(document.activeElement)).toBe(true);
        // 换到另一个 bot 档的会话：前一个会话的事项不在了，不是答完，焦点不动。
        await view.setProps({ctx: dockCtx([question("q3", "第三问")])});
        view.get<HTMLElement>("[data-agent-dock] button:not(:disabled)").element.focus();
        const focused = document.activeElement;
        await view.setProps({ctx: dockCtx([question("q4", "第四问")], {...context().session!, id: "other-session"})});
        await flushPromises();
        // 焦点没被挪到停靠区的容器上：还在原来那个按钮上，或随按钮卸载落回页面。
        expect(document.activeElement).not.toBe(view.get("[data-agent-dock]").element);
        expect(document.activeElement === focused || document.activeElement === document.body).toBe(true);
        view.unmount();
    });


    it("会话给了头像：顶栏画头像图片，不画 Profile 图标；头像读不出来时换回图标；不给时照旧画图标", async () => {
        const withAvatar = mountHeadView({ctx: {...context(), session: {...context().session!, title: "星璃", avatar: "/api/nbook.bots/avatar/lyra"}}});
        expect(withAvatar.get<HTMLImageElement>("[data-header-avatar]").attributes("src")).toBe("/api/nbook.bots/avatar/lyra");
        expect(withAvatar.find(".acv-head__icon").exists()).toBe(false);
        await withAvatar.get("[data-header-avatar]").trigger("error");
        expect(withAvatar.find("[data-header-avatar]").exists()).toBe(false);
        expect(withAvatar.find(".acv-head__icon").exists()).toBe(true);
        withAvatar.unmount();
        const plain = mountHeadView();
        expect(plain.find("[data-header-avatar]").exists()).toBe(false);
        expect(plain.find(".acv-head__icon").exists()).toBe(true);
        plain.unmount();
    });

    it("含进行中调用的轮次不自动收起：后台命令转了后台、这一轮回复完了，节点还在眼前", () => {
        const background = {id: "c1", name: "shell", status: "success" as const, args: {command: "bun run build", async: true}, invocation: "inv-1", result: {text: "已转到后台", truncated: false}};
        const ctx = (activeCalls?: string[]): AgentConversationContext => ({
            ...context(),
            messages: [
                {kind: "user", id: "u1", timestamp: 1, intent: "normal", blocks: [{kind: "text", text: "构建一下"}], contentOmitted: false},
                {kind: "assistant", id: "a1", timestamp: 2, status: "done", text: "", thinking: "", model: "m", toolCalls: [background], contentOmitted: false},
                {kind: "assistant", id: "a2", timestamp: 3, status: "done", text: "构建在后台跑。", thinking: "", model: "m", toolCalls: [], contentOmitted: false},
            ],
            ...(activeCalls === undefined ? {} : {activeCalls}),
        });
        const active = mountView("zh-CN", {}, {ctx: ctx(["inv-1"])});
        expect(active.find("[data-node]").exists()).toBe(true);
        active.unmount();
        const settled = mountView("zh-CN", {}, {ctx: ctx()});
        expect(settled.find("[data-node]").exists()).toBe(false);
        settled.unmount();
    });

    it("子会话的头左边只有返回，发 session.select 到直接的父会话（path 的最后一项）；没有面包屑", async () => {
        const session = {...context().session!, path: [{id: "root", title: "主创"}, {id: "child", title: "核对员"}]};
        const view = mountHeadView({ctx: {...context(), session}, newSession: true});
        expect(view.find("[data-header-new]").exists()).toBe(false);
        expect(view.find("nav").exists()).toBe(false);
        await view.get("[data-header-back]").trigger("click");
        expect(view.emitted("action")).toEqual([[{type: "session.select", sessionId: "child"}]]);
        view.unmount();
    });

    it("顶层会话左边是新建；没选会话时写“新对话”、图标用新会话的 Profile，左边空、没有“⋯”", async () => {
        const view = mountHeadView({newSession: true, draftProfile: {name: "主创", icon: "i-lucide-sparkles"}});
        await view.get("[data-header-new]").trigger("click");
        expect(view.emitted("action")).toEqual([[{type: "session.create"}]]);
        expect(view.get("[data-header-title]").text()).toBe("第三章");

        await view.setProps({ctx: {...context(), session: null}});
        expect(view.get("[data-header-title]").text()).toBe("新对话");
        expect(view.find(".i-lucide-sparkles").exists()).toBe(true);
        expect(view.find("[data-header-new]").exists()).toBe(false);
        expect(view.find("[data-header-more]").exists()).toBe(false);
        view.unmount();
    });

    it("有会话列表时点标题打开它，aria-expanded 跟着；插槽的 close 关掉它", async () => {
        const view = mountHeadView({sessions: true});
        const title = view.get("[data-header-sessions]");
        expect(title.attributes("aria-expanded")).toBe("false");
        await title.trigger("click");
        await flushPromises();
        expect(title.attributes("aria-expanded")).toBe("true");
        expect(document.querySelector("[data-probe-sessions]")).not.toBeNull();
        (document.querySelector("[data-probe-close]") as HTMLButtonElement).click();
        await flushPromises();
        expect(title.attributes("aria-expanded")).toBe("false");
        view.unmount();
    });

    it("给了 headTargets 时三列送到外面、内容里不画头；收回时回到内容里，开着的会话列表不关", async () => {
        const targets = headTargets();
        const view = mountHeadView({sessions: true, newSession: true, trailing: true, headTargets: targets});
        await flushPromises();
        expect(targets.start.querySelector("[data-header-new]")).not.toBeNull();
        expect(targets.title.textContent).toContain("第三章");
        expect(targets.end.querySelector("[data-probe-trailing]")).not.toBeNull();
        expect(targets.end.querySelector("[data-header-more]")).not.toBeNull();
        expect(view.get("[data-agent-head]").isVisible()).toBe(false);

        // 按下由宿主转来：改 sessionsOpen。
        await view.setProps({sessionsOpen: true});
        await flushPromises();
        expect(document.querySelector("[data-probe-sessions]")).not.toBeNull();
        await view.setProps({headTargets: null});
        await flushPromises();
        expect(targets.title.textContent).toBe("");
        expect(view.get("[data-agent-head] [data-header-title]").text()).toBe("第三章");
        expect(document.querySelector("[data-probe-sessions]")).not.toBeNull();
        view.unmount();
    });
});

describe("第一屏（Spec“消息”的空状态）", () => {
    const WELCOME: AgentWelcomeView = {
        title: "NeuroBook 创作工作区",
        recent: [{id: "s2", title: "第三章节奏调整", at: 3}, {id: "s3", title: "", at: 2}, {id: "s4", title: "查错别字", at: 1}, {id: "s5", title: "第四条不显示", at: 0}],
        total: 12,
        starters: [{text: "帮我润色一段环境描写", icon: "i-lucide-feather"}, {text: "规划第三幕的细纲"}, {text: "一致性体检"}, {text: "第四条不显示"}],
    };
    const empty = (): AgentConversationContext => ({...context(), session: null, messages: []});

    /** 像宿主那样处理输入框的动作：`composer.fill` 换草稿、加版本，视图跟着换编辑器里的文字。 */
    function mountWelcome(welcome: AgentWelcomeView | null, ctx = empty(), extra: {readonly newSession?: boolean} = {}) {
        const current = shallowRef<AgentConversationContext>(ctx);
        const actions: AgentViewAction[] = [];
        const Host = defineComponent({
            setup: () => () => h(AgentConversationView, {
                ctx: current.value,
                registry,
                locale: "zh-CN",
                services: {resolveAttachmentUrl: () => null, resolveTriggerMenu: () => ({items: []})},
                welcome,
                ...extra,
                onAction: (action: AgentViewAction) => {
                    actions.push(action);
                    const composer = applyComposerAction(current.value.composer, action);
                    if (composer !== null) current.value = {...current.value, composer};
                },
            }, {sessions: ({close}: {close: () => void}) => h("div", {"data-probe-sessions": ""}, [h("button", {type: "button", onClick: close}, "关")])}),
        });
        const wrapper = mount(Host, {attachTo: document.body});
        return {wrapper, actions};
    }

    it("canCreate 为 false（bot 的主对话）：给了 welcome 也不画第一屏，头上不画新建；为 true 时照画", () => {
        const bot = mountWelcome(WELCOME, {...empty(), session: context().session, interaction: {...context().interaction, canCreate: false}}, {newSession: true});
        expect(bot.wrapper.find("[data-agent-welcome]").exists()).toBe(false);
        expect(bot.wrapper.find("[data-header-new]").exists()).toBe(false);
        bot.wrapper.unmount();
        const plain = mountWelcome(WELCOME, {...empty(), session: context().session}, {newSession: true});
        expect(plain.wrapper.find("[data-agent-welcome]").exists()).toBe(true);
        expect(plain.wrapper.find("[data-header-new]").exists()).toBe(true);
        plain.wrapper.unmount();
    });

    it("三块各只显示前 3 条；标题由宿主给，空标题写未命名会话；没有最近对话与指令时两块都不画；没给 welcome 时写还没有消息", async () => {
        const {wrapper} = mountWelcome(WELCOME);
        expect(wrapper.get("[data-agent-welcome] h2").text()).toBe("NeuroBook 创作工作区");
        expect(wrapper.findAll("[data-welcome-session]").map((card) => card.text())).toEqual([expect.stringContaining("第三章节奏调整"), expect.stringContaining("未命名会话"), expect.stringContaining("查错别字")]);
        expect(wrapper.get("[data-welcome-all]").text()).toContain("查看全部（12）");
        expect(wrapper.findAll("[data-welcome-starter]")).toHaveLength(3);
        wrapper.unmount();

        const bare = mountWelcome({recent: [], total: 0, starters: []});
        expect(bare.wrapper.find("[data-welcome-recent]").exists()).toBe(false);
        expect(bare.wrapper.find("[data-welcome-starters]").exists()).toBe(false);
        expect(bare.wrapper.get("[data-agent-welcome]").text()).toContain("开始一段对话");
        bare.wrapper.unmount();

        const none = mountWelcome(null);
        expect(none.wrapper.find("[data-agent-welcome]").exists()).toBe(false);
        expect(none.wrapper.get(".acv-stream__empty").text()).toBe("还没有消息");
        none.wrapper.unmount();
    });

    it("点卡片切到那个会话；查看全部打开会话列表；点指令后输入框里是这段文字，焦点在输入框", async () => {
        const {wrapper, actions} = mountWelcome(WELCOME);
        await wrapper.get("[data-welcome-session='s2']").trigger("click");
        expect(actions).toContainEqual({type: "session.select", sessionId: "s2"});

        await wrapper.get("[data-welcome-all]").trigger("click");
        await flushPromises();
        expect(document.querySelector("[data-probe-sessions]")).not.toBeNull();

        await wrapper.findAll("[data-welcome-starter]")[1]!.trigger("click");
        await flushPromises();
        await nextTick();
        expect((wrapper.getComponent(PlainPromptEditor).get("textarea").element as HTMLTextAreaElement).value).toBe("规划第三幕的细纲");
        expect(document.activeElement?.closest(".acv-composer")).not.toBeNull();
        wrapper.unmount();
    });
});

describe("登记的顶栏动作（验收 36）", () => {
    it("允许常驻的按 order 取前两个放在顶栏，其余进溢出菜单、排在原始视图之前；点了发出它的 action", async () => {
        const action = (id: string) => ({type: `lab:${id}` as const});
        const headers: AgentViewContribution = {source: "lab:header", headerActions: [
            {id: "c", order: 30, icon: "i-lucide-activity", label: "第三个", target: {kind: "action", action: action("c")}, pinnable: true},
            {id: "a", order: 10, icon: "i-lucide-activity", label: "第一个", target: {kind: "action", action: action("a")}, pinnable: true, badge: () => 2},
            {id: "b", order: 20, icon: "i-lucide-activity", label: "第二个", target: {kind: "action", action: action("b")}, pinnable: true},
            {id: "d", order: 5, icon: "i-lucide-activity", label: "不常驻的", target: {kind: "action", action: action("d")}, pinnable: false},
            {id: "hidden", icon: "i-lucide-activity", label: "看不见的", target: {kind: "action", action: action("hidden")}, pinnable: true, when: () => false},
        ]};
        const view = mountView("zh-CN", {}, {registry: createAgentViewRegistry([builtinRolesContribution, builtinToolsContribution, builtinMessageActionsContribution, builtinComposerContribution, headers])});
        expect(view.findAll("[data-header-action]").map((button) => [button.attributes("data-header-action"), button.attributes("aria-label")])).toEqual([["a", "第一个 (2)"], ["b", "第二个"]]);
        const menu = view.findAllComponents({name: "DropdownMenu"}).find((item) => (item.props("items") as {id: string}[]).some((entry) => entry.id === "toggle-view-mode"))!;
        expect((menu.props("items") as {id: string; label: string}[]).map((entry) => entry.id).slice(-3)).toEqual(["header:d", "header:c", "toggle-view-mode"]);
        await view.get("[data-header-action='a']").trigger("click");
        menu.vm.$emit("select", "header:c");
        expect(view.emitted("action")).toEqual([[{type: "lab:a"}], [{type: "lab:c"}]]);
        view.unmount();
    });
});

describe("只有表情的用户消息不画气泡（Spec“消息”）", () => {
    // 宿主的判断：拼起来去掉空白后恰好是一个表情写法。
    const promptBareness = (texts: readonly string[]): boolean => texts.join("").trim() === ":lyra/开心:";
    function bareCtx(): AgentConversationContext {
        const ctx = context();
        ctx.messages = [
            {kind: "user", id: "u1", timestamp: 1, intent: "normal", blocks: [{kind: "text", text: " :lyra/开心: "}], contentOmitted: false},
            {kind: "user", id: "u2", timestamp: 2, intent: "normal", blocks: [{kind: "text", text: "写完啦:lyra/开心:"}], contentOmitted: false},
            {kind: "user", id: "u3", timestamp: 3, intent: "normal", blocks: [{kind: "text", text: ":lyra/开心:"}, {kind: "attachment", locator: "session://attachments/a.png", name: "a.png", mimeType: "image/png", bytes: 3}], contentOmitted: false},
            {kind: "user", id: "u4", timestamp: 4, intent: "normal", blocks: [{kind: "text", text: ":lyra/开心:"}], contentOmitted: true},
        ];
        return ctx;
    }
    const shapes = (view: ReturnType<typeof mountView>): string[] => view.findAll(".acv-user-bubble, .acv-user-bare").map((element) => (element.classes().includes("acv-user-bare") ? "bare" : "bubble"));

    it("宿主判为只有表情、没有附件、正文没被省略的不画气泡；其余照常", () => {
        const view = mountView("zh-CN", {}, {ctx: bareCtx(), promptBareness});
        expect(shapes(view)).toEqual(["bare", "bubble", "bubble", "bubble"]);
        view.unmount();
    });

    it("宿主没给判断时都画气泡", () => {
        const view = mountView("zh-CN", {}, {ctx: bareCtx()});
        expect(shapes(view)).toEqual(["bubble", "bubble", "bubble", "bubble"]);
        view.unmount();
    });
});

describe("放在可关的面板里（closable、close、escape）", () => {
    it("头的右列最后是“关闭”，点了发 close；不给 closable 时没有它", async () => {
        const plain = mountHeadView({trailing: true});
        expect(plain.find("[data-header-close]").exists()).toBe(false);
        plain.unmount();
        const wrapper = mount(AgentConversationView, {
            props: {ctx: context(), registry, locale: "zh-CN", services: {resolveAttachmentUrl: () => null, resolveTriggerMenu: () => ({items: []})}, closable: true},
            slots: {"head-trailing": () => h("button", {type: "button", "data-probe-trailing": ""}, "子代理")},
            attachTo: document.body,
        });
        const end = [...wrapper.get(".acv-head__end").element.querySelectorAll("button")];
        expect(end.at(0)?.hasAttribute("data-probe-trailing")).toBe(true);
        expect(end.at(-1)?.hasAttribute("data-header-close")).toBe(true);
        expect(end.at(-1)?.getAttribute("aria-label")).toBe("关闭");
        await wrapper.get("[data-header-close]").trigger("click");
        expect(wrapper.emitted("close")).toHaveLength(1);
        wrapper.unmount();
    });

    it("输入框里按 Esc 发 escape；输入法组字时不发", async () => {
        const wrapper = mountView("zh-CN", {}, {plain: true});
        const input = wrapper.get("textarea");
        await input.trigger("keydown", {key: "Escape", isComposing: true});
        expect(wrapper.emitted("escape")).toBeUndefined();
        await input.trigger("keydown", {key: "Escape"});
        expect(wrapper.emitted("escape")).toHaveLength(1);
        wrapper.unmount();
    });
});

describe("focusComposer", () => {
    it("输入框还是只读时（会话在加载）先记下，变成可写之后焦点进输入框", async () => {
        const loading = {...context(), availability: {status: "loading" as const, message: "", actions: []}};
        const wrapper = mountView("zh-CN", {}, {plain: true, ctx: loading});
        await flushPromises();
        (wrapper.vm as unknown as {focusComposer(): void}).focusComposer();
        await flushPromises();
        const input = wrapper.get("textarea").element;
        expect(document.activeElement).not.toBe(input);
        await wrapper.setProps({ctx: context()});
        await flushPromises();
        expect(document.activeElement).toBe(input);
        wrapper.unmount();
    });

    it("等可写的期间用户点了别处：变成可写后不再抢焦点", async () => {
        const loading = {...context(), availability: {status: "loading" as const, message: "", actions: []}};
        const wrapper = mountView("zh-CN", {}, {plain: true, ctx: loading});
        const elsewhere = document.body.appendChild(document.createElement("button"));
        await flushPromises();
        (wrapper.vm as unknown as {focusComposer(): void}).focusComposer();
        elsewhere.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
        elsewhere.focus();
        await wrapper.setProps({ctx: context()});
        await flushPromises();
        expect(document.activeElement).toBe(elsewhere);
        wrapper.unmount();
        elsewhere.remove();
    });
});

describe("轮与轮之间的分隔线（docs/specs/ui/agent-conversation-view.md 的“分轮视图”、验收 43）", () => {
    /** 本地时区的时刻：线按本地的日历日分。 */
    const local = (month: number, day: number, hour: number, year = 2026) => new Date(year, month - 1, day, hour).getTime();
    const turn = (n: number, at: number): AgentConversationContext["messages"] => [
        {kind: "user", id: `u${String(n)}`, timestamp: at, intent: "normal", blocks: [{kind: "text", text: `问 ${String(n)}`}], contentOmitted: false},
        {kind: "assistant", id: `a${String(n)}`, timestamp: at + 60_000, status: "done", text: `答 ${String(n)}`, thinking: "", model: "m", toolCalls: [], contentOmitted: false},
    ];
    const stream = (dividers?: AgentConversationContext["dividers"]): AgentConversationContext => ({
        ...context(),
        messages: [...turn(1, local(11, 18, 9)), ...turn(2, local(11, 21, 20)), ...turn(3, local(11, 22, 8)), ...turn(4, local(11, 22, 10))],
        now: local(11, 22, 12),
        ...(dividers === undefined ? {} : {dividers}),
    });
    /** 内容列里线与轮次的先后：线写它的字，轮次写它的第一句话。 */
    const order = (view: ReturnType<typeof mountView>) => view.findAll(".acv-stream__content > [data-day-divider], .acv-stream__content > [data-unread-divider], .acv-stream__content > .acv-turn")
        .map((node) => (node.classes("acv-turn") ? `轮:${node.text().match(/问 \d/u)![0]}` : `线:${node.text()}`));

    it("按天与未读：日子在轮前、同一天不重复，未读线在含起点的那一轮之前、日子之下", () => {
        const view = mountView("zh-CN", {}, {ctx: stream({day: true, unreadFrom: "a3"})});
        expect(order(view)).toEqual(["线:11月18日", "轮:问 1", "线:昨天", "轮:问 2", "线:今天", "线:以下是新消息", "轮:问 3", "轮:问 4"]);
        view.unmount();
    });

    it("英文界面：Today、Yesterday、月日与 New messages", () => {
        const view = mountView("en-US", {}, {ctx: stream({day: true, unreadFrom: "a4"})});
        expect(order(view)).toEqual(["线:Nov 18", "轮:问 1", "线:Yesterday", "轮:问 2", "线:Today", "轮:问 3", "线:New messages", "轮:问 4"]);
        view.unmount();
    });

    it("未读起点不在已加载的消息里时没有未读线；原始视图两种线都没有", () => {
        const missing = mountView("zh-CN", {}, {ctx: stream({day: true, unreadFrom: "older"})});
        expect(missing.find("[data-unread-divider]").exists()).toBe(false);
        missing.unmount();
        const raw = mountView("zh-CN", {}, {ctx: stream({day: true, unreadFrom: "a3"}), viewMode: "raw"});
        expect(raw.find("[data-day-divider]").exists()).toBe(false);
        expect(raw.find("[data-unread-divider]").exists()).toBe(false);
        raw.unmount();
    });

    it("缺省回归：不给 dividers 时没有线，内容列里只有轮次", () => {
        const view = mountView("zh-CN", {}, {ctx: stream()});
        expect(order(view)).toEqual(["轮:问 1", "轮:问 2", "轮:问 3", "轮:问 4"]);
        view.unmount();
    });

    it("未读线出现时视图不滚动：不把线滚进视口，滚动位置不变（打开时照旧在最新，t03 决定 1）", async () => {
        // happy-dom 没有布局：记下视图对滚动接口的调用。
        const scrolled: string[] = [];
        const original = {into: Element.prototype.scrollIntoView, to: Element.prototype.scrollTo};
        Element.prototype.scrollIntoView = function () {
            scrolled.push("into");
        };
        Element.prototype.scrollTo = function () {
            scrolled.push("to");
        } as typeof Element.prototype.scrollTo;
        try {
            const view = mountView("zh-CN", {}, {ctx: stream({day: true})});
            await flushPromises();
            const stream_ = view.get(".acv-stream").element as HTMLElement;
            stream_.scrollTop = 40;
            scrolled.length = 0;
            await view.setProps({ctx: stream({day: true, unreadFrom: "a3"})});
            await flushPromises();
            expect(view.find("[data-unread-divider]").exists()).toBe(true);
            expect(scrolled).toEqual([]);
            expect(stream_.scrollTop).toBe(40);
            view.unmount();
        } finally {
            Element.prototype.scrollIntoView = original.into;
            Element.prototype.scrollTo = original.to;
        }
    });

    it("线后来才出现（宿主算出未读起点）时轮次不重新挂载；now 过了零点，“今天”变“昨天”", async () => {
        const view = mountView("zh-CN", {}, {ctx: stream({day: true})});
        const third = view.findAll(".acv-turn")[2]!.element;
        await view.setProps({ctx: stream({day: true, unreadFrom: "a3"})});
        expect(view.findAll(".acv-turn")[2]!.element).toBe(third);
        expect(view.find("[data-unread-divider]").exists()).toBe(true);
        await view.setProps({ctx: {...stream({day: true, unreadFrom: "a3"}), now: local(11, 23, 0) + 60_000}});
        expect(order(view).filter((item) => item.startsWith("线:"))).toEqual(["线:11月18日", "线:11月21日", "线:昨天", "线:以下是新消息"]);
        view.unmount();
    });
});
