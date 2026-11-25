/**
 * 对话宿主接真实的服务端（docs/specs/agent/conversation.md 输出 1、5–14）：配置场地里起 `nbook.agent`，窗口经真实的远程合同调用，模型是本机端点。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {defineProfile} from "@notnotype/nb-harness/kernel";
import type {SessionOwner} from "@notnotype/nb-harness/kernel/contracts";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {computed, shallowRef, watch} from "vue";
import {RELOAD_DELAY_MS} from "nbook/plugins/settings/backend/layer-owner";
import {PROVIDERS_SECTION, ROLES_SECTION} from "nbook/plugins/models/shared/contracts";
import {testTextPort} from "nbook/shared/testing/text-port";
import type {AgentConversationContext, AssistantMessageView, ComposerModelView, MessageView, PendingApprovalView, PendingInputView, PendingQuestionsView} from "@notnotype/nb-agent-ui";

import {EVENT_INLINE_BYTES} from "./backend/frames";
import {noticeSummary} from "./shared/remote";
import {MAIN_PROFILE} from "./shared/contracts";
import {AGENT_MODES_EXTENSION} from "./shared/permissions";
import type {Rule} from "./shared/permissions";
import {agentProfile} from "./shared/points";
import {AGENT_TEXT_NAMESPACE} from "./shared/text";
import {fakeEndpoint, localModelSettings} from "./testing/endpoint";
import type {FakeEndpoint} from "./testing/endpoint";
import {agentWorld} from "./testing/world";
import type {AgentWorld, SessionsClient} from "./testing/world";
import {createAgentActivity} from "./web/activity";
import {createSessionList} from "./web/session-list";
import {agentCatalogs} from "./web/text";
import {createSessionHost, displayToolName, pendingWithin, RELEASE_DELAY_MS} from "./web/session-host";
import type {PaintStart, SessionHost, SessionHostDeps, SessionOwners} from "./web/session-host";
import {OPEN_REQUEST_ACTION, OPEN_REQUESTS_ACTION} from "./web/request-entries";

let root = "";
let counter = 0;
let endpoint: FakeEndpoint;
const worlds: AgentWorld[] = [];
const hosts: SessionHost[] = [];

beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-agent", "session-host");
    endpoint = fakeEndpoint();
});
afterEach(async () => {
    for (const host of hosts.splice(0)) host.dispose();
    endpoint.reset();
    for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
    endpoint.stop();
    if (root !== "") await rm(root, {recursive: true, force: true});
});

const PROFILE = "test.sh.main";
/** 第三方插件的 Profile：声明里按 id 引用模式扩展，工具里没有 `switch_mode`（Agent 不能主动切，用户能切）。 */
const MODAL_PROFILE = "test.sh.modal";
const TOOLS = ["read", "write", "edit", "shell", "ask-form"].map((name) => `nbook.agent.${name}`);

function testPlugin(): PluginDefinition {
    const profile = agentProfile(PROFILE, {name: "测试", description: "测试用", icon: "i-lucide-feather", tools: {required: TOOLS, optional: []}});
    const modal = agentProfile(MODAL_PROFILE, {name: "有模式", description: "测试用", tools: {required: TOOLS, optional: []}, referencedExtensions: [AGENT_MODES_EXTENSION]});
    return {id: "test.sh", entries: [defineEntry({
        id: "server",
        location: "server",
        activationEvents: ["onStartup", profile.activationEvent, modal.activationEvent],
        contributions: [profile.contribution, modal.contribution],
        activate: () => ({contributions: {"agent.profiles": {
            [PROFILE]: defineProfile({id: PROFILE, version: "1", name: PROFILE, description: "测试用", system: "测试。", tools: {required: TOOLS}}),
            [MODAL_PROFILE]: defineProfile({id: MODAL_PROFILE, version: "1", name: MODAL_PROFILE, description: "测试用", system: "测试。", tools: {required: TOOLS}}),
        }}}),
    })]};
}

/** `extra` 盖在本机端点的设置上（例如多加一家服务商）。`dir` 给了时在这个目录起（重启：同一个状态根再起一次）。 */
async function world(extra: Readonly<Record<string, unknown>> = {}, dir?: string): Promise<AgentWorld> {
    counter += 1;
    const created = await agentWorld(dir ?? join(root, `w${String(counter)}`), {plugins: [testPlugin()], userSettings: {...localModelSettings(endpoint.baseUrl, {compactionRole: true}), "nbook.agent/profileSettings": {[PROFILE]: {approvalMode: "ask"}}, ...extra}});
    worlds.push(created);
    return created;
}

interface Harness {
    readonly host: SessionHost;
    readonly client: SessionsClient;
    readonly recent: {value: string | null};
    readonly copied: string[];
    /** 每次打开设置给的去处；不带去处时是 null。 */
    readonly settingsOpened: ({readonly section: string; readonly focus?: string; readonly layer?: string} | null)[];
    readonly requestsOpened: {readonly sessionId: string; readonly request?: number}[];
    ctx(): AgentConversationContext;
}

let windows = 0;
async function harness(w: AgentWorld, overrides: Partial<SessionHostDeps> = {}): Promise<Harness> {
    windows += 1;
    const {client} = await w.window(`sh-${String(windows)}`);
    const recent = {value: null as string | null};
    const copied: string[] = [];
    const settingsOpened: ({readonly section: string; readonly focus?: string; readonly layer?: string} | null)[] = [];
    const requestsOpened: {readonly sessionId: string; readonly request?: number}[] = [];
    const host = createSessionHost({
        remote: client,
        project: null,
        now: () => w.settings.clock.now(),
        schedule: (run, delay) => w.settings.clock.schedule(run, delay),
        text: {t: (value: unknown) => (typeof value === "string" ? value : (value as {key: string}).key), variants: () => []} as never,
        newId: () => crypto.randomUUID(),
        recent: {read: async () => recent.value, write: (id) => {
            recent.value = id;
        }},
        warnCost: () => 0,
        resumeMode: () => "merge",
        rememberRules: async () => ({ok: true}),
        models: () => [{key: "local/m", label: "M", supportsImages: false}],
        roles: () => null,
        groups: () => [],
        providers: () => null,
        drafts: {read: async () => null, write: () => undefined},
        attachments: {upload: async () => ({ok: false, code: "not-used"})},
        profiles: () => [{key: PROFILE, name: "测试", description: "", source: "test", status: "ok", icon: "i-lucide-feather"}],
        copy: (value) => void copied.push(value),
        openSettings: (target) => void settingsOpened.push(target ?? null),
        openRequests: (target) => void requestsOpened.push(target),
        openAddress: () => undefined,
        openLink: () => undefined,
        skills: {selected: () => undefined, address: () => null},
        report: (code, message) => {
            throw new Error(`host reported ${code}: ${message}`);
        },
        ...overrides,
    });
    hosts.push(host);
    return {host, client, recent, copied, settingsOpened, requestsOpened, ctx: () => host.ctx.value};
}

const assistants = (messages: readonly MessageView[]) => messages.filter((message): message is AssistantMessageView => message.kind === "assistant");
const until = <T>(what: string, check: () => T | Promise<T>) => waitUntil(what, check, {timeoutMs: 15_000});
const idle = (h: Harness) => until("运行结束", () => h.ctx().run.status === "idle");
const approvals = (ctx: AgentConversationContext) => ctx.pendingInputs.filter((item): item is PendingApprovalView => item.kind === "approval");

async function started(w: AgentWorld, overrides: Partial<SessionHostDeps> = {}): Promise<Harness> {
    const h = await harness(w, overrides);
    expect(await h.host.create(PROFILE)).not.toBeNull();
    return h;
}

describe("打开会话（输出 5）", () => {
    test("没有当前会话时第一次发送自动新建主创的会话", async () => {
        const w = await world();
        const h = await harness(w);
        endpoint.script("你好，作者。");
        expect(h.ctx().session).toBeNull();
        expect(h.ctx().availability.status).toBe("ready");
        h.host.act({type: "composer.submit", text: "你好", delivery: "prompt"});
        await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === "你好，作者。");
        await idle(h);
        expect(h.ctx().session).not.toBeNull();
        expect((await w.service.session(h.host.sessionId.value!).snapshot()).profile.id).toBe(MAIN_PROFILE);
    });

    test("发一条：乐观消息换成内核确认的；回复与用量到位；重开回到同一个", async () => {
        const w = await world();
        const h = await started(w);
        endpoint.script("这是回复。");
        h.host.act({type: "composer.submit", text: "你好", delivery: "prompt"});
        // 受理之前已经显示，输入框清空。
        expect(h.ctx().composer.draft.text).toBe("");
        await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === "这是回复.".replace(".", "。"));
        await idle(h);
        expect(h.ctx().messages.map((message) => message.kind)).toEqual(["user", "assistant"]);
        expect(h.ctx().messages[0]).not.toHaveProperty("delivery");
        expect(h.ctx().session).toMatchObject({profileName: "测试", profileIcon: "i-lucide-feather"});
        expect(h.ctx().usage.contextLimit).toBeGreaterThan(0);
        expect(h.recent.value).toBe(h.host.sessionId.value);

        const again = await harness(w);
        again.recent.value = h.recent.value;
        await again.host.restore();
        await until("重开", () => again.ctx().messages.length === 2);
        expect(again.host.sessionId.value).toBe(h.host.sessionId.value);
    });

    test("打开过程中：视图显示加载中；快照之后、路径之前的状态变化不丢", async () => {
        const w = await world();
        const first = await started(w);
        const id = first.host.sessionId.value!;
        let openPath = () => undefined as void;
        const pathGate = new Promise<void>((resolve) => {
            openPath = resolve;
        });
        const gated = new Proxy(first.client, {get(target, key, receiver) {
            if (key !== "path") return Reflect.get(target, key, receiver);
            return async (input: never) => {
                await pathGate;
                return target.path(input);
            };
        }}) as SessionsClient;
        const h = await harness(w, {remote: gated});
        const opening = h.host.open(id);
        await until("开始加载", () => h.ctx().availability.status === "loading");
        endpoint.script({tool: "write", args: {path: "session://一.md", content: "内容"}}, "好了");
        // 路径还没取回来时，别的窗口发了一条，运行进了等批准。
        first.host.act({type: "composer.submit", text: "写", delivery: "prompt"});
        await until("服务端在等批准", async () => (await w.service.session(id).snapshot()).status.state === "waiting");
        openPath();
        await opening;
        await until("这个窗口也知道在等批准", () => h.ctx().run.status === "waiting" && approvals(h.ctx()).length === 1);
        expect(h.ctx().availability.status).toBe("ready");
        first.host.act({type: "input.submit", batchKey: approvals(first.ctx())[0]!.id, resolutions: {kind: "approval", decision: "allow"}});
        await idle(first);
    });

    test("最近用过的会话不在了：显示未选择，记录清掉", async () => {
        const w = await world();
        const h = await harness(w);
        h.recent.value = "不存在的会话";
        await h.host.restore();
        expect(h.host.sessionId.value).toBeNull();
        expect(h.ctx().session).toBeNull();
        expect(h.recent.value).toBeNull();
    });

    test("回退：打开时只有当前路径；订阅期间回退按新叶子重建，不把分支接在一起", async () => {
        const w = await world();
        const h = await started(w);
        const id = h.host.sessionId.value!;
        endpoint.script("一", "二");
        h.host.act({type: "composer.submit", text: "第一问", delivery: "prompt"});
        await until("第一条回复", () => assistants(h.ctx().messages).at(-1)?.text === "一");
        await idle(h);
        h.host.act({type: "composer.submit", text: "第二问", delivery: "prompt"});
        await until("第二条回复", () => assistants(h.ctx().messages).at(-1)?.text === "二");
        await idle(h);

        const view = w.service.session(id);
        const target = (await view.rewindTargets()).find((item) => item.kind === "before-turn" && item.inputText === "第二问")!;
        expect((await view.rewind({commandId: crypto.randomUUID(), to: target.id})).ok).toBe(true);
        await until("重建路径", () => assistants(h.ctx().messages).map((message) => message.text).join() === "一");

        const fresh = await harness(w);
        await fresh.host.open(id);
        await until("打开回退后的会话", () => fresh.ctx().messages.length === 2);
        expect(assistants(fresh.ctx().messages).map((message) => message.text)).toEqual(["一"]);
    });

    test("内联放不下的大事件：经 eventChunk 拼回，后面的帧不插队", async () => {
        const w = await world();
        const h = await started(w);
        // 每段不同：一直重复的文字会被内核当成思考卡住（thinking-loop）。
        const huge = Array.from({length: Math.ceil(EVENT_INLINE_BYTES / 20)}, (_, index) => `第 ${String(index)} 段正文。`).join("\n");
        endpoint.script(huge, "后面这条");
        h.host.act({type: "composer.submit", text: "写长的", delivery: "prompt"});
        await until("大回复", () => assistants(h.ctx().messages).at(-1)?.text === huge);
        await idle(h);
        h.host.act({type: "composer.submit", text: "再来", delivery: "prompt"});
        await until("后面的回复", () => assistants(h.ctx().messages).at(-1)?.text === "后面这条");
        await idle(h);
        expect(h.ctx().messages.map((message) => message.kind)).toEqual(["user", "assistant", "user", "assistant"]);

        const fresh = await harness(w);
        await fresh.host.open(h.host.sessionId.value!);
        await until("重开也拼得回来", () => assistants(fresh.ctx().messages).some((message) => message.text === huge));
    }, 40_000);
});

describe("发送、排队与停止（输出 6）", () => {
    test("明确被拒：撤掉，文字放回输入框，说明原因", async () => {
        const w = await world();
        const base = await harness(w);
        const rejecting = new Proxy(base.client, {get(target, key, receiver) {
            return key === "send" ? async () => ({ok: false, code: "input-rejected", detail: {code: "lab", by: "lab"}}) : Reflect.get(target, key, receiver);
        }}) as SessionsClient;
        const h = await harness(w, {remote: rejecting});
        await h.host.create(PROFILE);
        h.host.act({type: "composer.submit", text: "不让发的", delivery: "prompt"});
        await until("被拒", () => h.ctx().composer.notice !== undefined);
        expect(h.ctx().messages).toEqual([]);
        expect(h.ctx().composer.draft.text).toBe("不让发的");
        expect(h.ctx().composer.notice).toMatchObject({key: "conversation.reject.inputRejected"});
    });

    test("结果未知：消息标出来；重发用同一个指令 id；服务端其实受理了也不会有两条；能移除", async () => {
        const w = await world();
        const base = await harness(w);
        /** 第一次 `send` 没到服务端就断了；`delivered` 时到了服务端、回应丢了。 */
        let mode: "lost" | "delivered" | "normal" = "lost";
        const seen: string[] = [];
        const flaky = new Proxy(base.client, {get(target, key, receiver) {
            if (key !== "send") return Reflect.get(target, key, receiver);
            return async (input: {sessionId: string; commandId: string; input: {text: string}}) => {
                seen.push(input.commandId);
                const current = mode;
                mode = "normal";
                if (current === "lost") return {ok: false, code: "unknown-outcome"};
                const real = await target.send(input as never);
                return current === "delivered" && real.ok ? {ok: false, code: "unknown-outcome"} : real;
            };
        }}) as SessionsClient;
        const h = await harness(w, {remote: flaky});
        await h.host.create(PROFILE);
        const before = endpoint.requests.length;

        h.host.act({type: "composer.submit", text: "丢了的", delivery: "prompt"});
        await until("标未确认", () => h.ctx().messages[0]?.kind === "user" && (h.ctx().messages[0] as {delivery?: string}).delivery === "unknown");
        const lost = h.ctx().messages[0]!.id;
        endpoint.script("回了");
        h.host.act({type: "message.resend", messageId: lost});
        await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === "回了");
        await idle(h);
        expect(seen[1]).toBe(seen[0]!);
        expect(h.ctx().messages.filter((message) => message.kind === "user")).toHaveLength(1);
        expect(endpoint.requests.length - before).toBe(1);

        mode = "lost";
        h.host.act({type: "composer.submit", text: "不要了", delivery: "prompt"});
        await until("又一条未确认", () => (h.ctx().messages.at(-1) as {delivery?: string}).delivery === "unknown");
        h.host.act({type: "message.dismiss", messageId: h.ctx().messages.at(-1)!.id});
        await until("移除", () => h.ctx().messages.filter((message) => message.kind === "user").length === 1);

        mode = "delivered";
        endpoint.script("这条其实到了");
        h.host.act({type: "composer.submit", text: "到了的", delivery: "prompt"});
        await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === "这条其实到了");
        await idle(h);
        // 内核的 input 事件换掉了乐观消息：只有两条用户消息，没有未确认的残留。
        expect(h.ctx().messages.filter((message) => message.kind === "user").map((message) => (message as {delivery?: string}).delivery)).toEqual([undefined, undefined]);
    });

    test("运行中回车插话、Ctrl 回车排队；排队的能删、能取出来改；停止时排队的留着", async () => {
        const w = await world();
        const h = await started(w);
        const hold = endpoint.hold();
        endpoint.script("第一条回复", "接着的回复");
        h.host.act({type: "composer.submit", text: "开始", delivery: "prompt"});
        await hold.arrived;
        await until("运行中", () => h.ctx().run.status === "running");
        h.host.act({type: "composer.submit", text: "排一条", delivery: "followup"});
        await until("进了排队", () => h.ctx().composer.queued.length === 1);
        expect(h.ctx().composer.queued[0]).toMatchObject({text: "排一条", delivery: "followup"});
        // 输入框里有没发的字：取出来接在后面，不丢。
        h.host.act({type: "composer.draftChanged", text: "正在写的"});
        h.host.act({type: "queued.edit", id: h.ctx().composer.queued[0]!.id});
        await until("取出到输入框", () => h.ctx().composer.draft.text === "正在写的\n排一条");
        await until("从队列拿掉了", () => h.ctx().composer.queued.length === 0);
        h.host.act({type: "composer.submit", text: "改过的", delivery: "followup"});
        await until("改过的重新排上", () => h.ctx().composer.queued[0]?.text === "改过的");
        h.host.act({type: "composer.submit", text: "要删的", delivery: "followup"});
        await until("两条", () => h.ctx().composer.queued.length === 2);
        h.host.act({type: "queued.remove", id: h.ctx().composer.queued[1]!.id});
        await until("删了", () => h.ctx().composer.queued.length === 1);

        h.host.act({type: "composer.stop"});
        expect(h.ctx().stopRequestedAt).toBeDefined();
        hold.release();
        await idle(h);
        // 服务端的缓冲区：运行收口时不带 keepQueue 会清空，事件和状态帧的先后这里不依赖。
        const view = w.service.session(h.host.sessionId.value!);
        await until("停止受理了", async () => (await view.log({afterSeq: 0})).events.some((event) => event.type === "commandAccepted" && (event.data as {name: string}).name === "abort"));
        expect((await view.snapshot()).buffer.map((item) => item.input.text)).toEqual(["改过的"]);
        await until("排队的还在", () => h.ctx().composer.queued.length === 1);
        expect(h.ctx().stopRequestedAt).toBeUndefined();
    });
});

describe("留着的话与继续（conversation.md 输出 47–50）", () => {
    const textOf = (message: MessageView): string => (message as {blocks: {text?: string}[]}).blocks.map((block) => block.text ?? "").join("");
    const userTexts = (h: Harness): string[] => h.ctx().messages.filter((message) => message.kind === "user").map(textOf);

    /** 开一轮挂着，排 `queued` 几条，再停下：排的话都留着。 */
    async function stoppedWithHeld(h: Harness, queued: readonly string[]): Promise<void> {
        const hold = endpoint.hold();
        endpoint.script("第一条回复");
        h.host.act({type: "composer.submit", text: "开始", delivery: "prompt"});
        await hold.arrived;
        await until("运行中", () => h.ctx().run.status === "running");
        for (const text of queued) h.host.act({type: "composer.submit", text, delivery: "followup"});
        await until("都排上", () => h.ctx().composer.queued.length === queued.length);
        expect(h.ctx().interaction.stopClearing).toEqual({count: queued.length});
        h.host.act({type: "composer.stop"});
        hold.release();
        await idle(h);
        await until("留着", () => h.ctx().composer.queued.every((item) => item.held !== undefined) && h.ctx().composer.queued.length === queued.length);
    }

    test("输出 48、49：停止后排的话留着、写明原因，只有空闲时没有停止的第二个选项；空着继续、只留一条时放行它接着跑", async () => {
        const w = await world();
        const h = await started(w);
        await stoppedWithHeld(h, ["排一条"]);
        expect(h.ctx().composer.queued[0]).toMatchObject({text: "排一条", held: {reason: "conversation.held.stoppedByYou"}});
        expect(h.ctx().composer.queued[0]!.author).toBeUndefined();
        expect(h.ctx().interaction.stopClearing).toBeNull();
        endpoint.script("处理了排的那条");
        h.host.act({type: "run.continue"});
        await until("接着跑完", () => assistants(h.ctx().messages).at(-1)?.text === "处理了排的那条");
        await idle(h);
        expect(h.ctx().composer.queued).toEqual([]);
        expect(userTexts(h).at(-1)).toBe("排一条");
    });

    test("输出 49：停止并清空排队，缓冲区不留", async () => {
        const w = await world();
        const h = await started(w);
        const hold = endpoint.hold();
        endpoint.script("第一条回复");
        h.host.act({type: "composer.submit", text: "开始", delivery: "prompt"});
        await hold.arrived;
        await until("运行中", () => h.ctx().run.status === "running");
        h.host.act({type: "composer.submit", text: "排一条", delivery: "followup"});
        await until("排上", () => h.ctx().composer.queued.length === 1);
        h.host.act({type: "composer.stop", clearQueue: true});
        hold.release();
        await idle(h);
        await until("清空", () => h.ctx().composer.queued.length === 0);
        expect((await w.service.session(h.host.sessionId.value!).snapshot()).buffer).toEqual([]);
    });

    test("输出 47、50：合并时用户留着的话与写的字合成一条（入队顺序、空一行），合成的一条换掉留着的", async () => {
        const w = await world();
        const h = await started(w);
        await stoppedWithHeld(h, ["排一", "排二"]);
        endpoint.script("三句一起处理了");
        h.host.act({type: "composer.submit", text: "新的话", delivery: "prompt"});
        await until("跑完", () => assistants(h.ctx().messages).at(-1)?.text === "三句一起处理了");
        await idle(h);
        expect(userTexts(h).at(-1)).toBe("排一\n\n排二\n\n新的话");
        expect(h.ctx().composer.queued).toEqual([]);
        expect(h.ctx().messages.some((message) => (message as {delivery?: string}).delivery !== undefined)).toBe(false);
    });

    test("输出 47、50：保留原插话与排队时空着继续放行，各自一条按排队顺序跑；恢复方式在点继续时现读", async () => {
        const w = await world();
        let mode: "merge" | "keep" = "keep";
        const h = await started(w, {resumeMode: () => mode});
        await stoppedWithHeld(h, ["排一", "排二"]);
        endpoint.script("处理了一", "处理了二");
        h.host.act({type: "run.continue"});
        await until("都跑完", () => assistants(h.ctx().messages).at(-1)?.text === "处理了二");
        await idle(h);
        expect(userTexts(h).slice(-2)).toEqual(["排一", "排二"]);

        // 同一个宿主里改成合并：下一次继续按新的方式走。
        mode = "merge";
        await stoppedWithHeld(h, ["再一", "再二"]);
        endpoint.script("合成的处理了");
        h.host.act({type: "run.continue"});
        await until("合成的跑完", () => assistants(h.ctx().messages).at(-1)?.text === "合成的处理了");
        await idle(h);
        expect(userTexts(h).at(-1)).toBe("再一\n\n再二");
    });

    test("输出 48–50：宿主排的话混在里面——标出发出者、只能取消，停止清空的条数算它，合并时不并进去、先跑并让合成的一条显示前面还有几条", async () => {
        const w = await world();
        const h = await started(w);
        const id = h.host.sessionId.value!;
        const hosted = w.service.session(id, {asUser: false, source: {label: "日程"}});
        const hold = endpoint.hold();
        endpoint.script("第一条回复");
        h.host.act({type: "composer.submit", text: "开始", delivery: "prompt"});
        await hold.arrived;
        await until("运行中", () => h.ctx().run.status === "running");
        h.host.act({type: "composer.submit", text: "排一", delivery: "followup"});
        h.host.act({type: "composer.submit", text: "排二", delivery: "followup"});
        await until("用户的排上", () => h.ctx().composer.queued.length === 2);
        for (const text of ["日程一", "日程二"]) expect((await hosted.enqueue({commandId: crypto.randomUUID(), input: {text}, mode: "followup"})).ok).toBe(true);
        await until("宿主的排上", () => h.ctx().composer.queued.length === 4);
        expect(h.ctx().composer.queued[2]).toMatchObject({text: "日程一", author: {label: "日程", icon: "i-lucide-puzzle"}, editable: false});
        expect(h.ctx().composer.queued[0]!.author).toBeUndefined();
        // 用户的停止清空全部：条数含宿主排的两条。
        expect(h.ctx().interaction.stopClearing).toEqual({count: 4});
        h.host.act({type: "composer.stop"});
        hold.release();
        await idle(h);
        await until("都留着", () => h.ctx().composer.queued.length === 4 && h.ctx().composer.queued.every((item) => item.held !== undefined));

        const second = endpoint.hold();
        endpoint.script("日程一的回复", "日程二的回复", "合成的处理了");
        h.host.act({type: "composer.submit", text: "新的话", delivery: "prompt"});
        await second.arrived;
        // 宿主的两条先跑，第一条已被取走，合成的一条前面还有 1 条。
        await until("合成的一条在等", () => h.ctx().messages.some((message) => message.kind === "user" && message.ahead === 1));
        second.release();
        await until("跑完", () => assistants(h.ctx().messages).at(-1)?.text === "合成的处理了");
        await idle(h);
        expect(userTexts(h).slice(-3)).toEqual(["日程一", "日程二", "排一\n\n排二\n\n新的话"]);
        const fromHost = h.ctx().messages.find((message) => message.kind === "user" && textOf(message) === "日程一");
        expect(fromHost).toMatchObject({author: {label: "日程", icon: "i-lucide-puzzle"}});
        expect(h.ctx().composer.queued).toEqual([]);

        // 空闲时宿主排的话留着；没有用户留着的话时写字回车照常发送，宿主那条先跑、不并进来。
        expect((await hosted.enqueue({commandId: crypto.randomUUID(), input: {text: "日程又排的"}, mode: "followup"})).ok).toBe(true);
        await until("宿主的留着", () => h.ctx().composer.queued[0]?.held?.reason === "conversation.held.idle");
        endpoint.script("又一条日程的回复", "单独的处理了");
        h.host.act({type: "composer.submit", text: "单独的话", delivery: "prompt"});
        await until("跑完", () => assistants(h.ctx().messages).at(-1)?.text === "单独的处理了");
        await idle(h);
        expect(userTexts(h).slice(-2)).toEqual(["日程又排的", "单独的话"]);
    }, 30_000);

    test("输出 50：运行中写字插话不合并，用户留着的话各自放行、保持原来的排队", async () => {
        const w = await world();
        const h = await started(w);
        await stoppedWithHeld(h, ["排一", "排二"]);
        const hold = endpoint.hold();
        endpoint.script("日程的回复", "回二", "回三", "回四");
        const hosted = w.service.session(h.host.sessionId.value!, {asUser: false, source: {label: "日程"}});
        expect((await hosted.send({commandId: crypto.randomUUID(), input: {text: "日程提醒"}})).ok).toBe(true);
        await hold.arrived;
        await until("运行中", () => h.ctx().run.status === "running");
        // 宿主开的运行里留着用户的话：停止的第二个选项照样在。
        expect(h.ctx().interaction.stopClearing).toEqual({count: 2});
        h.host.act({type: "composer.submit", text: "插一句", delivery: "steer"});
        await until("放行了", () => h.ctx().composer.queued.every((item) => item.held === undefined) && h.ctx().composer.queued.length === 3);
        hold.release();
        await until("都跑完", () => assistants(h.ctx().messages).at(-1)?.text === "回四");
        await idle(h);
        const texts = userTexts(h);
        expect(texts).toEqual(expect.arrayContaining(["插一句", "排一", "排二"]));
        expect(texts.some((text) => text.includes("\n\n"))).toBe(false);
    });

    test("输出 50：合并时空着继续被拒不放回合成的文字；结果未知时重发沿用指令 id 与 replaces", async () => {
        const w = await world();
        const base = await started(w);
        await stoppedWithHeld(base, ["排一", "排二"]);
        const sends: {commandId: string; replaces?: unknown}[] = [];
        const replies: ("reject" | "timeout")[] = ["reject", "timeout"];
        const flaky = new Proxy(base.client, {get(target, key, receiver) {
            if (key !== "send") return Reflect.get(target, key, receiver);
            return async (input: {commandId: string; replaces?: unknown}) => {
                sends.push(input);
                const reply = replies.shift();
                if (reply === "reject") return {ok: false, code: "input-rejected"};
                if (reply === "timeout") return {ok: false, code: "timeout"};
                return target.send(input as never);
            };
        }}) as SessionsClient;
        const h = await harness(w, {remote: flaky});
        await h.host.open(base.host.sessionId.value!);
        await until("读到留着的", () => h.ctx().composer.queued.length === 2);
        h.host.act({type: "run.continue"});
        await until("被拒", () => h.ctx().composer.notice !== undefined);
        expect(h.ctx().composer.draft.text).toBe("");
        expect(h.ctx().composer.queued).toHaveLength(2);

        h.host.act({type: "run.continue"});
        await until("结果未知", () => h.ctx().messages.some((message) => (message as {delivery?: string}).delivery === "unknown"));
        endpoint.script("合成的处理了");
        h.host.act({type: "message.resend", messageId: h.ctx().messages.find((message) => (message as {delivery?: string}).delivery === "unknown")!.id});
        await until("跑完", () => assistants(h.ctx().messages).at(-1)?.text === "合成的处理了");
        await idle(h);
        expect(sends).toHaveLength(3);
        expect(sends[2]!.commandId).toBe(sends[1]!.commandId);
        expect(sends[2]!.replaces).toEqual(sends[1]!.replaces);
        expect((sends[1]!.replaces as unknown[]).length).toBe(2);
        expect(userTexts(h).at(-1)).toBe("排一\n\n排二");
    });

    /**
     * 运行中排 `queued` 几条，服务端在请求挂着时停掉、在同一个状态根再起：这次运行按中断收口，排的话转成留着（会话关闭的恢复）。
     * 交回新起的服务端与会话 id。
     */
    async function interruptedWithHeld(queued: readonly string[]): Promise<{readonly w: AgentWorld; readonly id: string}> {
        counter += 1;
        const dir = join(root, `restart-${String(counter)}`);
        const first = await world({}, dir);
        const h = await started(first);
        const hold = endpoint.hold();
        endpoint.script("不会交回的回复");
        h.host.act({type: "composer.submit", text: "开始", delivery: "prompt"});
        await hold.arrived;
        for (const text of queued) h.host.act({type: "composer.submit", text, delivery: "followup"});
        await until("都排上", () => h.ctx().composer.queued.length === queued.length);
        const id = h.host.sessionId.value!;
        worlds.splice(worlds.indexOf(first), 1);
        await first.close();
        hold.release();
        endpoint.reset();
        return {w: await world({}, dir), id};
    }

    test("输出 50：留着的话加中断的运行，合并时先接着跑中断的那一轮，再合成发出；得 input-stale 时只重发合成的一条、不重做 start；进行中宿主标出在继续", async () => {
        const {w, id} = await interruptedWithHeld(["排一", "排二"]);
        const base = await harness(w);
        const calls: string[] = [];
        let openStart = () => undefined as void;
        const startGate = new Promise<void>((resolve) => {
            openStart = resolve;
        });
        let editFirst = true;
        const watched = new Proxy(base.client, {get(target, key, receiver) {
            if (key === "start") {
                return async (input: never) => {
                    calls.push("start");
                    await startGate;
                    return target.start(input);
                };
            }
            if (key !== "send") return Reflect.get(target, key, receiver);
            return async (input: {sessionId: string; replaces?: {id: string}[]}) => {
                calls.push("send");
                // 合成之后、发出之前，排一被改了：内核判出 input-stale。
                if (editFirst) {
                    editFirst = false;
                    const edited = await target.edit({sessionId: input.sessionId, commandId: crypto.randomUUID(), inputId: input.replaces![0]!.id, input: {text: "排一（改过）"}});
                    if (!edited.ok) throw new Error(edited.code);
                }
                return target.send(input as never);
            };
        }}) as SessionsClient;
        const h = await harness(w, {remote: watched});
        await h.host.open(id);
        await until("读到留着的", () => h.ctx().composer.queued.length === 2 && h.ctx().composer.queued.every((item) => item.held !== undefined));
        expect(h.ctx().composer.resume).toBe(true);

        h.host.act({type: "run.continue"});
        await until("在继续", () => h.ctx().interaction.continuing === true);
        expect(calls).toEqual(["start"]);
        // 接着跑的那次请求挂着，合成的一条在它跑着时发进去。
        const hold = endpoint.hold();
        endpoint.script("接着写完了", "合成的处理了");
        openStart();
        await hold.arrived;
        await until("合成的发出", () => calls.length === 3);
        hold.release();
        await until("跑完", () => assistants(h.ctx().messages).at(-1)?.text === "合成的处理了");
        await idle(h);
        expect(calls).toEqual(["start", "send", "send"]);
        expect(userTexts(h).at(-1)).toBe("排一（改过）\n\n排二");
        expect(h.ctx().interaction.continuing).toBe(false);
        expect(h.ctx().composer.queued).toEqual([]);
    }, 30_000);

    test("输出 50：中断后合并继续时 start 失败就停下、说明原因；第二步之前这次运行已收口就不再发合成的一条；空着继续都不往输入框放字", async () => {
        const {w, id} = await interruptedWithHeld(["排一", "排二"]);
        const base = await harness(w);
        let start: "fail" | "until-ended" = "fail";
        const sends: unknown[] = [];
        const watched = new Proxy(base.client, {get(target, key, receiver) {
            if (key === "start") {
                return async (input: {sessionId: string}) => {
                    if (start === "fail") return {ok: false, code: "not-allowed"};
                    // 回应晚到：等这次运行真的收口了才交回（运行很快结束时的先后）。
                    const started_ = await target.start(input as never);
                    if (started_.ok) await until("接着跑的运行收口", async () => {
                        const result = await target.runResult({sessionId: input.sessionId, runId: started_.value.value.runId});
                        return result.ok && result.value !== null;
                    });
                    return started_;
                };
            }
            if (key !== "send") return Reflect.get(target, key, receiver);
            return async (input: never) => {
                sends.push(input);
                return target.send(input);
            };
        }}) as SessionsClient;
        const h = await harness(w, {remote: watched});
        await h.host.open(id);
        await until("读到留着的", () => h.ctx().composer.queued.length === 2);

        h.host.act({type: "run.continue"});
        await until("开不起来", () => (h.ctx().composer.notice as {key?: string} | undefined)?.key === "conversation.continue.failed");
        expect(sends).toEqual([]);
        expect(h.ctx().composer.draft.text).toBe("");
        expect(h.ctx().composer.queued.map((item) => item.held !== undefined)).toEqual([true, true]);

        start = "until-ended";
        endpoint.script("接着写完了");
        h.host.act({type: "run.continue"});
        await until("已经结束", () => (h.ctx().composer.notice as {key?: string} | undefined)?.key === "conversation.continue.stopped");
        await idle(h);
        expect(sends).toEqual([]);
        expect(h.ctx().composer.draft.text).toBe("");
        expect(assistants(h.ctx().messages).at(-1)?.text).toBe("接着写完了");
        expect(h.ctx().composer.queued.map((item) => item.held !== undefined)).toEqual([true, true]);
    }, 30_000);

    test("输出 48：只有用户能放行的留着的话算等你处理，会话列表的行也标出来；放行之后就没有", async () => {
        const w = await world();
        const h = await started(w);
        const controller = new AbortController();
        const activity = createAgentActivity(h.client, (message) => {
            throw new Error(message);
        });
        await activity.start(controller.signal);
        await stoppedWithHeld(h, ["排一"]);
        await until("等你处理", () => activity.waiting.value === 1);
        expect(activity.target.value).toBe(h.host.sessionId.value);
        const list = createSessionList({remote: h.client, project: null, profileEntries: () => [], activity: () => activity.items.value, failed: (code) => code, now: () => 0});
        await list.refresh();
        expect(list.items.value.find((item) => item.id === h.host.sessionId.value)).toMatchObject({status: "waiting"});
        endpoint.script("处理了");
        h.host.act({type: "run.continue"});
        await until("跑完", () => assistants(h.ctx().messages).at(-1)?.text === "处理了");
        await idle(h);
        await until("没有了", () => !activity.active.value);
        controller.abort();
    });

    test("输出 50：合成的一条得 input-stale 时按新的快照重新合成、再发一次；被拒时只把写的字放回输入框", async () => {
        const w = await world();
        const base = await started(w);
        await stoppedWithHeld(base, ["排一", "排二"]);
        const sends: {replaces?: unknown; input: {text: string}}[] = [];
        let reply: "edit-first" | "reject" | "real" = "edit-first";
        const flaky = new Proxy(base.client, {get(target, key, receiver) {
            if (key !== "send") return Reflect.get(target, key, receiver);
            return async (input: {sessionId: string; commandId: string; input: {text: string}; replaces?: {id: string}[]}) => {
                sends.push(input);
                const current = reply;
                // 合成之后、发出之前，排一被改了：内核按 `replaces` 里的修改次数判出 input-stale。
                if (current === "edit-first") {
                    reply = "real";
                    const edited = await target.edit({sessionId: input.sessionId, commandId: crypto.randomUUID(), inputId: input.replaces![0]!.id, input: {text: "排一（改过）"}});
                    if (!edited.ok) throw new Error(edited.code);
                }
                if (current === "reject") return {ok: false, code: "input-rejected"};
                return target.send(input as never);
            };
        }}) as SessionsClient;
        const h = await harness(w, {remote: flaky});
        await h.host.open(base.host.sessionId.value!);
        await until("读到留着的", () => h.ctx().composer.queued.length === 2);
        endpoint.script("合成的处理了");
        h.host.act({type: "run.continue"});
        await until("跑完", () => assistants(h.ctx().messages).at(-1)?.text === "合成的处理了");
        await idle(h);
        expect(sends.map((item) => item.input.text)).toEqual(["排一\n\n排二", "排一（改过）\n\n排二"]);
        expect(userTexts(h).at(-1)).toBe("排一（改过）\n\n排二");

        await stoppedWithHeld(h, ["再排一", "再排二"]);
        reply = "reject";
        h.host.act({type: "composer.submit", text: "写的字", delivery: "prompt"});
        await until("被拒", () => h.ctx().composer.notice !== undefined);
        expect(h.ctx().composer.draft.text).toBe("写的字");
        expect(h.ctx().composer.queued).toHaveLength(2);
    });

    test("输出 50：继续进行中再点继续不再发；保留方式写了字时结果未知可重发，重发带上放行方式与同一个指令 id", async () => {
        const w = await world();
        const base = await started(w, {resumeMode: () => "keep"});
        await stoppedWithHeld(base, ["排一", "排二"]);
        const calls: {name: string; commandId: string; release?: string}[] = [];
        let lose = true;
        const counting = new Proxy(base.client, {get(target, key, receiver) {
            if (key !== "send" && key !== "resume") return Reflect.get(target, key, receiver);
            return async (input: {commandId: string; release?: string}) => {
                calls.push({name: String(key), commandId: input.commandId, ...(input.release === undefined ? {} : {release: input.release})});
                if (key === "send" && lose) {
                    lose = false;
                    return {ok: false, code: "timeout"};
                }
                return (target[key] as (value: unknown) => Promise<unknown>)(input);
            };
        }}) as SessionsClient;
        const h = await harness(w, {remote: counting, resumeMode: () => "keep"});
        await h.host.open(base.host.sessionId.value!);
        await until("读到留着的", () => h.ctx().composer.queued.length === 2);
        h.host.act({type: "composer.submit", text: "写的字", delivery: "prompt"});
        h.host.act({type: "run.continue"});
        await until("结果未知", () => h.ctx().messages.some((message) => (message as {delivery?: string}).delivery === "unknown"));
        expect(calls.map((call) => call.name)).toEqual(["send"]);
        expect(h.ctx().composer.draft.text).toBe("");
        endpoint.script("处理了一", "处理了二", "处理了写的字");
        h.host.act({type: "message.resend", messageId: h.ctx().messages.find((message) => (message as {delivery?: string}).delivery === "unknown")!.id});
        await until("都跑完", () => assistants(h.ctx().messages).at(-1)?.text === "处理了写的字");
        await idle(h);
        expect(calls).toEqual([calls[0]!, {name: "send", commandId: calls[0]!.commandId, release: "keep"}]);
    });

    test("验收 9：宿主开的运行里，用户停止时留下的话一直显示已暂停；点头行的继续后它们进在跑的这次运行", async () => {
        const w = await world();
        const h = await started(w);
        await stoppedWithHeld(h, ["排一", "排二"]);
        const hold = endpoint.hold();
        endpoint.script("日程的回复");
        const hosted = w.service.session(h.host.sessionId.value!, {asUser: false, source: {label: "日程"}});
        const sent = await hosted.send({commandId: crypto.randomUUID(), input: {text: "日程提醒"}});
        if (!sent.ok || sent.value.runId === null) throw new Error(JSON.stringify(sent));
        await hold.arrived;
        await until("运行中", () => h.ctx().run.status === "running");
        expect(h.ctx().composer.queued.map((item) => item.held?.reason)).toEqual(["conversation.held.stoppedByYou", "conversation.held.stoppedByYou"]);
        endpoint.script("合成的处理了");
        h.host.act({type: "run.continue"});
        await until("合成的进了排队", () => h.ctx().composer.queued.length === 1 && h.ctx().composer.queued[0]!.held === undefined);
        hold.release();
        await until("跑完", () => assistants(h.ctx().messages).at(-1)?.text === "合成的处理了");
        await idle(h);
        expect(userTexts(h).at(-1)).toBe("排一\n\n排二");
        expect((await w.service.session(h.host.sessionId.value!).path()).filter((event) => event.type === "runStarted").at(-1)!.data).toMatchObject({runId: sent.value.runId});
    });
});

describe("提醒（conversation.md 输出 51）", () => {
    /** 文案带上参数：断言标签里的来源名。 */
    const withParams = {text: {t: (value: unknown) => (typeof value === "string" ? value : [(value as {key: string}).key, ...Object.values((value as {params?: Record<string, unknown>}).params ?? {})].join(" · ")), variants: () => []} as never};
    const textOf = (message: MessageView): string => (message as {blocks: {text?: string}[]}).blocks.map((block) => block.text ?? "").join("");

    test("门开着时是普通的就绪行、排在话的后面：标签是提醒加来源名、只能取消；取消提醒走 removeNotice、取消话照旧；停止清空的条数不算提醒", async () => {
        const w = await world();
        const h = await started(w, withParams);
        const id = h.host.sessionId.value!;
        const hosted = w.service.session(id, {asUser: false, source: {label: "日程"}});
        // 新会话门开着、空闲：不带唤起的提醒不开运行，也不算留着。
        const idleNotice = await hosted.notice({commandId: crypto.randomUUID(), text: "空闲时的提醒"});
        if (!idleNotice.ok) throw new Error(`notice failed: ${JSON.stringify(idleNotice)}`);
        await until("提醒排上", () => h.ctx().composer.queued.length === 1);
        expect(h.ctx().composer.queued[0]).toEqual({id: idleNotice.value.noticeId, text: "空闲时的提醒", delivery: "steer", author: {label: "conversation.author.notice · 日程", icon: "i-lucide-bell"}, editable: false});
        expect(h.ctx().run.status).toBe("idle");
        // 只有发送方能撤回的（后台任务的回执）：排队区没有取消。
        const receipt = await hosted.notice({commandId: crypto.randomUUID(), text: "后台任务的回执", senderOnly: true});
        if (!receipt.ok) throw new Error(`notice failed: ${JSON.stringify(receipt)}`);
        await until("回执排上", () => h.ctx().composer.queued.length === 2);
        expect(h.ctx().composer.queued[1]).toMatchObject({id: receipt.value.noticeId, editable: false, removable: false});
        expect(h.ctx().composer.queued[0]!.removable).toBeUndefined();

        // 发话开一轮：空闲时的提醒随第一次请求带上。
        const hold = endpoint.hold();
        endpoint.script("第一条回复", "排的那条处理了");
        h.host.act({type: "composer.submit", text: "开始", delivery: "prompt"});
        await hold.arrived;
        await until("运行中、提醒取走", () => h.ctx().run.status === "running" && h.ctx().composer.queued.length === 0);
        expect(JSON.stringify(endpoint.requests.at(-1)!.messages)).toContain("空闲时的提醒");
        expect(JSON.stringify(endpoint.requests.at(-1)!.messages)).toContain("后台任务的回执");
        for (const text of ["排一", "排二"]) h.host.act({type: "composer.submit", text, delivery: "followup"});
        await until("话排上", () => h.ctx().composer.queued.length === 2);
        const queued = await hosted.notice({commandId: crypto.randomUUID(), text: "内核重置了"});
        if (!queued.ok) throw new Error(`notice failed: ${JSON.stringify(queued)}`);
        await until("提醒排上", () => h.ctx().composer.queued.length === 3);
        expect(h.ctx().composer.queued.map((item) => [item.text, item.author?.label ?? null, item.held ?? null])).toEqual([
            ["排一", null, null],
            ["排二", null, null],
            ["内核重置了", "conversation.author.notice · 日程", null],
        ]);
        expect(h.ctx().interaction.stopClearing).toEqual({count: 2});

        h.host.act({type: "queued.remove", id: h.ctx().composer.queued[1]!.id});
        await until("话取消了", () => h.ctx().composer.queued.length === 2);
        const afterWords = await w.service.session(id).snapshot();
        expect([afterWords.buffer.map((item) => item.input.text), afterWords.notices.map((item) => item.text)]).toEqual([["排一"], ["内核重置了"]]);
        h.host.act({type: "queued.remove", id: queued.value.noticeId});
        await until("提醒取消了", () => h.ctx().composer.queued.length === 1);
        expect((await w.service.session(id).snapshot()).notices).toEqual([]);
        hold.release();
        await until("跑完", () => assistants(h.ctx().messages).at(-1)?.text === "排的那条处理了");
        await idle(h);
        expect(JSON.stringify(endpoint.requests.map((request) => request.messages))).not.toContain("内核重置了");
        const reminder = h.ctx().messages.find((message) => message.kind === "system" && message.source === "reminder");
        expect(reminder).toMatchObject({label: {key: "kernel.hostNotice", params: {name: "日程"}}, text: "空闲时的提醒"});
    });

    test("门关着又没有运行时按留着画、宿主开的运行里不算留着；重开的窗口显示同样的开头；空着继续开一次运行把提醒送出去，消息流里是全文", async () => {
        const w = await world();
        const h = await started(w);
        const id = h.host.sessionId.value!;
        const hosted = w.service.session(id, {asUser: false, source: {label: "日程"}});
        const hold = endpoint.hold();
        endpoint.script("第一条回复");
        h.host.act({type: "composer.submit", text: "开始", delivery: "prompt"});
        await hold.arrived;
        await until("运行中", () => h.ctx().run.status === "running");
        h.host.act({type: "composer.stop"});
        hold.release();
        await idle(h);

        // 用户的停止关了门；宿主开的运行不开门，但运行里排的提醒下一次请求就会带上，不算留着。
        const second = endpoint.hold();
        endpoint.script("日程的回复");
        expect((await hosted.send({commandId: crypto.randomUUID(), input: {text: "日程的话"}})).ok).toBe(true);
        await second.arrived;
        await until("宿主的运行在跑", () => h.ctx().run.status === "running");
        const first = await hosted.notice({commandId: crypto.randomUUID(), text: "第一条提醒"});
        if (!first.ok) throw new Error(`notice failed: ${JSON.stringify(first)}`);
        await until("提醒排上", () => h.ctx().composer.queued.length === 1);
        expect(h.ctx().composer.queued[0]!.held).toBeUndefined();
        second.release();
        await idle(h);
        await until("运行收口后按留着", () => h.ctx().composer.queued[0]?.held?.reason === "conversation.held.notice");

        // 带唤起的也不开运行；排队区只显示开头，从快照重开的窗口一样。
        const text = `内核重置了${"。".repeat(300)}`;
        const woken = await hosted.notice({commandId: crypto.randomUUID(), text, wake: true});
        if (!woken.ok) throw new Error(`notice failed: ${JSON.stringify(woken)}`);
        await until("两条都留着", () => h.ctx().composer.queued.length === 2 && h.ctx().composer.queued.every((item) => item.held !== undefined));
        expect(h.ctx().composer.queued[1]!.text).toBe(noticeSummary(text));
        expect((await w.service.session(id).snapshot()).status.state).toBe("idle");
        const reopened = await harness(w);
        await reopened.host.open(id);
        await until("重开的窗口有两条", () => reopened.ctx().composer.queued.length === 2);
        expect(reopened.ctx().composer.queued).toEqual(h.ctx().composer.queued);

        endpoint.script("知道了");
        h.host.act({type: "run.continue"});
        await until("跑完", () => assistants(h.ctx().messages).at(-1)?.text === "知道了");
        await idle(h);
        expect(h.ctx().composer.queued).toEqual([]);
        const sent = JSON.stringify(endpoint.requests.at(-1)!.messages);
        expect([sent.includes("第一条提醒"), sent.includes("内核重置了")]).toEqual([true, true]);
        const reminders = h.ctx().messages.filter((message) => message.kind === "system" && message.source === "reminder");
        expect(reminders.map((message) => (message as {text: string}).text)).toEqual(expect.arrayContaining(["第一条提醒", text]));
    });

    test("只有提醒时的继续是一个操作：进行中标出在继续；被拒时说明原因，提醒留着", async () => {
        const w = await world();
        const base = await started(w);
        const id = base.host.sessionId.value!;
        const hold = endpoint.hold();
        endpoint.script("第一条回复");
        base.host.act({type: "composer.submit", text: "开始", delivery: "prompt"});
        await hold.arrived;
        base.host.act({type: "composer.stop"});
        hold.release();
        await idle(base);
        expect((await w.service.session(id, {asUser: false, source: {label: "日程"}}).notice({commandId: crypto.randomUUID(), text: "提醒"})).ok).toBe(true);

        // 远程的 resume 先挂着、再交回被拒（开不起运行的码由内核给，这里只看宿主怎样接）。
        let answer = () => undefined as void;
        const answered = new Promise<void>((resolve) => {
            answer = resolve;
        });
        const resumes: unknown[] = [];
        const watched = new Proxy(base.client, {get(target, key, receiver) {
            if (key !== "resume") return Reflect.get(target, key, receiver);
            return async (input: unknown) => {
                resumes.push(input);
                await answered;
                return {ok: false, code: "not-allowed"};
            };
        }}) as SessionsClient;
        const h = await harness(w, {remote: watched});
        await h.host.open(id);
        await until("留着", () => h.ctx().composer.queued[0]?.held !== undefined);
        h.host.act({type: "run.continue"});
        await until("在继续", () => h.ctx().interaction.continuing);
        h.host.act({type: "run.continue"});
        answer();
        await until("说明原因", () => (h.ctx().composer.notice as {key?: string} | undefined)?.key === "conversation.continue.failed");
        expect(resumes).toEqual([expect.objectContaining({sessionId: id, mode: "keep"})]);
        expect(h.ctx().interaction.continuing).toBe(false);
        expect(h.ctx().composer.queued).toHaveLength(1);
    });

    test("留着的话与提醒一起：合并时用户留着的两条合成一条发出，提醒随这次运行的第一次请求带上", async () => {
        const w = await world();
        const h = await started(w);
        const id = h.host.sessionId.value!;
        const hold = endpoint.hold();
        endpoint.script("第一条回复");
        h.host.act({type: "composer.submit", text: "开始", delivery: "prompt"});
        await hold.arrived;
        await until("运行中", () => h.ctx().run.status === "running");
        for (const text of ["排一", "排二"]) h.host.act({type: "composer.submit", text, delivery: "followup"});
        await until("都排上", () => h.ctx().composer.queued.length === 2);
        h.host.act({type: "composer.stop"});
        hold.release();
        await idle(h);
        expect((await w.service.session(id, {asUser: false, source: {label: "日程"}}).notice({commandId: crypto.randomUUID(), text: "合并时的提醒"})).ok).toBe(true);
        await until("三条都留着", () => h.ctx().composer.queued.length === 3 && h.ctx().composer.queued.every((item) => item.held !== undefined));
        endpoint.script("合成的处理了");
        h.host.act({type: "run.continue"});
        await until("跑完", () => assistants(h.ctx().messages).at(-1)?.text === "合成的处理了");
        await idle(h);
        expect(h.ctx().messages.filter((message) => message.kind === "user").map(textOf).at(-1)).toBe("排一\n\n排二");
        expect(JSON.stringify(endpoint.requests.at(-1)!.messages)).toContain("合并时的提醒");
        expect(h.ctx().composer.queued).toEqual([]);
    });

    test("中断的运行加提醒：继续接着跑那一轮，提醒随它的第一次请求带上，不另开一轮", async () => {
        counter += 1;
        const dir = join(root, `notice-restart-${String(counter)}`);
        const first = await world({}, dir);
        const a = await started(first);
        const hold = endpoint.hold();
        endpoint.script("不会交回的回复");
        a.host.act({type: "composer.submit", text: "中断前", delivery: "prompt"});
        await hold.arrived;
        const id = a.host.sessionId.value!;
        worlds.splice(worlds.indexOf(first), 1);
        await first.close();
        hold.release();
        endpoint.reset();

        const w = await world({}, dir);
        expect((await w.service.session(id, {asUser: false, source: {label: "日程"}}).notice({commandId: crypto.randomUUID(), text: "重启后的提醒"})).ok).toBe(true);
        const h = await harness(w);
        await h.host.open(id);
        await until("中断、提醒留着", () => h.ctx().composer.resume && h.ctx().composer.queued[0]?.held !== undefined);
        const users = h.ctx().messages.filter((message) => message.kind === "user").length;
        endpoint.script("接着写完了");
        h.host.act({type: "run.continue"});
        await until("跑完", () => assistants(h.ctx().messages).at(-1)?.text === "接着写完了");
        await idle(h);
        expect(JSON.stringify(endpoint.requests.at(-1)!.messages)).toContain("重启后的提醒");
        expect(h.ctx().messages.filter((message) => message.kind === "user")).toHaveLength(users);
        expect(h.ctx().composer.queued).toEqual([]);
        expect(h.ctx().composer.resume).toBe(false);
    });
});

describe("审批与提问（输出 10–14）", () => {
    test("一条回复的一批：都进向导；预览取到；批准与拒绝（附言）各走各的；模型收到附言", async () => {
        const w = await world();
        const h = await started(w);
        endpoint.script({tools: [{tool: "write", args: {path: "session://一.md", content: "一的内容"}}, {tool: "write", args: {path: "session://二.md", content: "二的内容"}}, {tool: "shell", args: {command: "touch 三"}}]}, "处理完了");
        h.host.act({type: "composer.submit", text: "写两个文件", delivery: "prompt"});
        await until("三个审批", () => approvals(h.ctx()).length === 3);
        await until("预览", () => approvals(h.ctx()).every((item) => item.preview.state === "ready"));
        expect(h.ctx().run.status).toBe("waiting");
        const [first, second, third] = approvals(h.ctx());
        expect(first).toMatchObject({tool: "write", preview: {files: [{kind: "diff", before: "", after: "一的内容"}]}});
        expect(third).toMatchObject({tool: "shell", args: {command: "touch 三"}, preview: {files: []}});

        h.host.act({type: "input.submit", batchKey: first!.id, resolutions: {kind: "approval", decision: "allow"}});
        h.host.act({type: "input.submit", batchKey: second!.id, resolutions: {kind: "approval", decision: "deny", note: "这个不要"}});
        h.host.act({type: "input.submit", batchKey: third!.id, resolutions: {kind: "approval", decision: "deny"}});
        await until("答完", () => h.ctx().pendingInputs.length === 0);
        await idle(h);
        const calls = assistants(h.ctx().messages)[0]!.toolCalls;
        expect(calls.map((call) => call.status)).toEqual(["success", "denied", "denied"]);
        expect(JSON.stringify(endpoint.requests.at(-1)!.messages)).toContain("这个不要");
    });

    test("别的窗口先答了：向导跟着消失；答复撞上 already-answered 不报错", async () => {
        const w = await world();
        const a = await started(w);
        const id = a.host.sessionId.value!;
        const b = await harness(w);
        await b.host.open(id);
        endpoint.script({tool: "write", args: {path: "session://一.md", content: "内容"}}, "好");
        a.host.act({type: "composer.submit", text: "写", delivery: "prompt"});
        await until("两个窗口都看到", () => approvals(a.ctx()).length === 1 && approvals(b.ctx()).length === 1);
        const pending = approvals(b.ctx())[0]!;
        a.host.act({type: "input.submit", batchKey: pending.id, resolutions: {kind: "approval", decision: "allow"}});
        await until("另一个窗口的向导消失", () => b.ctx().pendingInputs.length === 0);
        b.host.act({type: "input.submit", batchKey: pending.id, resolutions: {kind: "approval", decision: "deny"}});
        await idle(a);
        await until("b 跟上", () => b.ctx().run.status === "idle");
        expect(b.ctx().composer.notice).toBeUndefined();
    });

    test("提问：进向导；回答回到模型", async () => {
        const w = await world();
        const h = await started(w);
        endpoint.script({tool: "ask", args: {questions: [{question: "视角？", options: [{label: "第一人称"}, {label: "第三人称"}]}]}}, "知道了");
        h.host.act({type: "composer.submit", text: "问我", delivery: "prompt"});
        const question = await until("提问", () => h.ctx().pendingInputs.find((item): item is PendingQuestionsView => item.kind === "question"));
        expect(question.questions[0]!.question).toBe("视角？");
        h.host.act({type: "input.submit", batchKey: question.id, resolutions: {kind: "question", answer: {text: "第三人称", data: {answers: [{selected: ["第三人称"]}]}}}});
        await idle(h);
        expect(JSON.stringify(endpoint.requests.at(-1)!.messages)).toContain("第三人称");
    });

    test("向导的界面状态交给宿主：归还超过 30 秒再借回还在；这一批答完就清，下一批从头来", async () => {
        const w = await world();
        const h = await started(w);
        endpoint.script({tool: "write", args: {path: "session://一.md", content: "内容"}}, {tool: "write", args: {path: "session://二.md", content: "内容"}}, "好了");
        h.host.act({type: "composer.submit", text: "写", delivery: "prompt"});
        await until("审批", () => approvals(h.ctx()).length === 1);
        h.host.act({type: "wizard.state", state: {collapsed: true, step: 1}});
        const give = h.host.borrow();
        give();
        w.settings.clock.advance(RELEASE_DELAY_MS + 1);
        const back = h.host.borrow();
        await until("重新打开", () => approvals(h.ctx()).length === 1);
        expect(h.ctx().wizardState).toEqual({collapsed: true, step: 1});
        back();
        // 按会话存：切到别的会话再切回来还在；别的会话不带过去。
        const here = h.ctx().session!.id;
        const other = await h.host.create(MAIN_PROFILE);
        expect(h.ctx().wizardState).toBeUndefined();
        await h.host.open(here);
        await until("切回来", () => approvals(h.ctx()).length === 1);
        expect(h.ctx().wizardState).toEqual({collapsed: true, step: 1});
        expect(other).not.toBeNull();

        h.host.act({type: "input.submit", batchKey: approvals(h.ctx())[0]!.id, resolutions: {kind: "approval", decision: "allow"}});
        await until("这一批答完", () => h.ctx().wizardState === undefined);
        await until("下一批", () => approvals(h.ctx()).length === 1);
        expect(h.ctx().wizardState).toBeUndefined();
        h.host.act({type: "input.submit", batchKey: approvals(h.ctx())[0]!.id, resolutions: {kind: "approval", decision: "allow"}});
        await idle(h);
    });
});

describe("代码里调的工具的事项（agent-conversation-view.md 向导带 within）", () => {
    test("本会话的取适配器给的来源；后代会话的只有审批原文里带着；提问的原文没有，取不到", () => {
        expect(pendingWithin({within: {tool: "nbook.agent.eval"}, request: {tool: "nbook.agent.write"}})).toBe("nbook.agent.eval");
        expect(pendingWithin({request: {tool: "nbook.agent.write", within: {tool: "nbook.agent.eval", invocation: "i1"}}})).toBe("nbook.agent.eval");
        expect(pendingWithin({request: {question: "选哪个？", data: {}}})).toBeUndefined();
        expect(displayToolName("nbook.agent.eval")).toBe("eval");
    });
});

describe("自动判断（permissions.md 输出 19、21）", () => {
    test("审批控件有这一项；模型转人工时向导显示它的理由", async () => {
        const w = await world();
        const h = await started(w);
        expect(h.ctx().composer.approval?.options.map((option) => option.key)).toContain("auto");
        h.host.act({type: "approval.set", mode: "auto"});
        await until("切到自动判断", () => h.ctx().composer.approval?.value === "auto");
        endpoint.script({tools: [{tool: "shell", args: {command: "git push"}}]}, {tool: "submit_verdict", args: {decision: "escalate", reason: "用户没说要推送"}});
        h.host.act({type: "composer.submit", text: "看看状态", delivery: "prompt"});
        const pending = await until("审批", () => approvals(h.ctx())[0]);
        expect(pending.reason).toBe("conversation.approval.reason.autoEscalated");
        h.host.act({type: "input.submit", batchKey: pending.id, resolutions: {kind: "approval", decision: "deny"}});
        await idle(h);
    });
});

describe("还没有会话时选的模式", () => {
    test("打开别的会话就作废，不带到之后新建的会话", async () => {
        const w = await world();
        const first = await started(w);
        const existing = first.host.sessionId.value!;
        const h = await harness(w);
        h.host.act({type: "mode.set", mode: "plan"});
        await until("草稿模式", () => h.ctx().composer.mode === "plan");
        h.host.act({type: "session.select", sessionId: existing});
        await until("打开", () => h.host.sessionId.value === existing);
        const created = await h.host.create(MAIN_PROFILE);
        const snapshot = await w.service.session(created!).snapshot();
        expect(snapshot.extensionSettings[AGENT_MODES_EXTENSION]?.mode ?? "normal").toBe("normal");
    });
});

describe("以后都允许（permissions.md 输出 23）", () => {
    const shellCall = (command: string) => ({tools: [{tool: "shell", args: {command}}]});

    test("把请求里的规则写进用户规则，这次与本会话都批准", async () => {
        const w = await world();
        const remembered: Rule[] = [];
        const h = await harness(w, {rememberRules: async (rules) => {
            remembered.push(...rules);
            return {ok: true};
        }});
        await h.host.create(PROFILE);
        endpoint.script(shellCall("touch 一"), shellCall("touch 二"), "写好了");
        h.host.act({type: "composer.submit", text: "建两个文件", delivery: "prompt"});
        const pending = await until("审批", () => approvals(h.ctx())[0]);
        h.host.act({type: "input.submit", batchKey: pending.id, resolutions: {kind: "approval", decision: "allow-always"}});
        await idle(h);
        // 第二次 `touch` 没有再问：本会话的规则当场生效。
        expect(assistants(h.ctx().messages).at(-1)?.text).toBe("写好了");
        expect(remembered).toEqual([{tool: "nbook.agent.shell", when: {type: "command", pattern: "touch *"}, action: "allow"}]);
    });

    test("存不下也批准，界面提示下次还会问", async () => {
        const w = await world();
        const h = await harness(w, {rememberRules: async () => ({ok: false, code: "write-failed", detail: "磁盘满了"})});
        await h.host.create(PROFILE);
        endpoint.script(shellCall("touch 三"), "写好了");
        h.host.act({type: "composer.submit", text: "建文件", delivery: "prompt"});
        const pending = await until("审批", () => approvals(h.ctx())[0]);
        h.host.act({type: "input.submit", batchKey: pending.id, resolutions: {kind: "approval", decision: "allow-always"}});
        await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === "写好了");
        expect(JSON.stringify(h.ctx())).toContain("conversation.reject.ruleNotSaved");
    });
});

describe("命令、草稿与输入历史（输出 28–30）", () => {
    test("/new 开新会话；/rename 改标题，空的说明；/fork 复制路径打开新会话", async () => {
        const w = await world();
        const h = await started(w);
        endpoint.script("回复");
        h.host.act({type: "composer.submit", text: "问", delivery: "prompt"});
        await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === "回复");
        await idle(h);
        const first = h.host.sessionId.value!;
        expect(h.ctx().interaction.commands).toEqual(expect.arrayContaining(["new", "fork", "rename", "model", "compact"]));
        expect(h.ctx().interaction.triggers).toEqual(["@", "/", "$"]);

        h.host.act({type: "command.run", name: "rename", argsText: ""});
        await until("说明要写标题", () => h.ctx().composer.notice !== undefined);
        h.host.act({type: "command.run", name: "rename", argsText: "第三章"});
        await until("标题", () => h.ctx().session?.title === "第三章");

        h.host.act({type: "command.run", name: "fork", argsText: ""});
        await until("打开了新会话", () => h.host.sessionId.value !== first && h.ctx().messages.length > 0);
        expect(assistants(h.ctx().messages).at(-1)?.text).toBe("回复");

        const forked = h.host.sessionId.value!;
        h.host.act({type: "command.run", name: "new", argsText: ""});
        await until("又一个新会话", () => h.host.sessionId.value !== forked);
        expect(h.ctx().messages).toEqual([]);
    });

    test("/fork 结果未知：说明，再来一次用同一个指令 id，只有一个新会话", async () => {
        const w = await world();
        const first = await w.window("sh-fork-gate");
        let lose = true;
        const seen: string[] = [];
        const gated = new Proxy(first.client, {get(target, key, receiver) {
            if (key !== "fork") return Reflect.get(target, key, receiver);
            return async (input: {commandId: string}) => {
                seen.push(input.commandId);
                const result = await target.fork(input as never);
                if (lose) {
                    lose = false;
                    return {ok: false, code: "unknown-outcome"};
                }
                return result;
            };
        }}) as SessionsClient;
        const h = await harness(w, {remote: gated});
        expect(await h.host.create(PROFILE)).not.toBeNull();
        endpoint.script("回复");
        h.host.act({type: "composer.submit", text: "问", delivery: "prompt"});
        await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === "回复");
        await idle(h);
        const origin = h.host.sessionId.value!;
        const count = async (): Promise<number> => {
            const listed = await w.service.list({});
            if (!listed.ok) throw new Error(listed.code);
            return listed.value.length;
        };
        const before = await count();
        h.host.act({type: "command.run", name: "fork", argsText: ""});
        await until("说明", () => h.ctx().composer.notice !== undefined);
        expect(h.host.sessionId.value).toBe(origin);
        h.host.act({type: "command.run", name: "fork", argsText: ""});
        await until("打开了", () => h.host.sessionId.value !== origin);
        expect(new Set(seen).size).toBe(1);
        expect(await count()).toBe(before + 1);
    });

    test("草稿按会话：切走再切回还在；不带到别的会话；发送后清；晚到的读取不盖新打的字", async () => {
        const w = await world();
        const stored = new Map<string, string>();
        let gate: (() => void) | null = null;
        const h = await harness(w, {drafts: {
            read: async (session) => {
                if (gate !== null) await new Promise<void>((resolve) => { const release = gate!; gate = () => { release(); resolve(); }; });
                return stored.get(session) ?? null;
            },
            write: (session, text) => void (text === "" ? stored.delete(session) : stored.set(session, text)),
        }});
        expect(await h.host.create(PROFILE)).not.toBeNull();
        const a = h.host.sessionId.value!;
        h.host.act({type: "composer.draftChanged", text: "没写完的"});
        expect(await h.host.create(PROFILE)).not.toBeNull();
        const b = h.host.sessionId.value!;
        expect(stored.get(a)).toBe("没写完的");
        expect(h.ctx().composer.draft.text).toBe("");

        await h.host.open(a);
        await until("读回来", () => h.ctx().composer.draft.text === "没写完的");

        // 读得慢：用户先打了字。
        gate = () => undefined;
        await h.host.open(b);
        h.host.act({type: "composer.draftChanged", text: "新打的"});
        stored.set(b, "旧的");
        const release = gate;
        gate = null;
        release();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(h.ctx().composer.draft.text).not.toBe("旧的");

        endpoint.script("回复");
        await h.host.open(a);
        await until("读回来", () => h.ctx().composer.draft.text === "没写完的");
        h.host.act({type: "composer.submit", text: "没写完的", delivery: "prompt"});
        await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === "回复");
        await idle(h);
        await h.host.open(b);
        expect(stored.has(a)).toBe(false);
    });

    test("开场指令（composer.fill）：没选会话时也换掉输入框的文字、换版本；有会话时存成这个会话的草稿", async () => {
        const w = await world();
        const stored = new Map<string, string>();
        const h = await harness(w, {drafts: {read: async (session) => stored.get(session) ?? null, write: (session, text) => void stored.set(session, text)}});
        const before = h.ctx().composer.draft.version;
        h.host.act({type: "composer.fill", text: "帮我润色一段环境描写"});
        await until("填进去", () => h.ctx().composer.draft.text === "帮我润色一段环境描写");
        expect(h.ctx().composer.draft.version).toBeGreaterThan(before);

        expect(await h.host.create(PROFILE)).not.toBeNull();
        const session = h.host.sessionId.value!;
        h.host.act({type: "composer.fill", text: "规划第三幕的细纲"});
        expect(h.ctx().composer.draft.text).toBe("规划第三幕的细纲");
        // 切走时草稿落盘（与打的字同一条路），切回来还在。
        expect(await h.host.create(PROFILE)).not.toBeNull();
        expect(stored.get(session)).toBe("规划第三幕的细纲");
        await h.host.open(session);
        await until("读回来", () => h.ctx().composer.draft.text === "规划第三幕的细纲");
    });

    test("输入历史：当前路径上用户的话，最新在前，去重，不含补充说明", async () => {
        const w = await world();
        const h = await started(w);
        endpoint.script("一", "二", "三");
        for (const [text, reply] of [["同一句", "一"], ["另一句", "二"], ["同一句", "三"]] as const) {
            h.host.act({type: "composer.submit", text, delivery: "prompt"});
            await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === reply);
            await idle(h);
        }
        expect(h.ctx().composer.recall).toEqual(["同一句", "另一句"]);
    });
});

describe("附件（输出 31）", () => {
    const FILE = new File(["x"], "图.png", {type: "image/png"});
    const uploaded = (name: string) => ({uri: `sessions://s/home/attachments/${name}.png`, kind: "image" as const, name: `${name}.png`, mime: "image/png", width: 800, height: 600});

    test("新建还没建好就加附件：等这次新建、传到它建出的会话里，不另建一个", async () => {
        const w = await world();
        const base = await harness(w);
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let creates = 0;
        const slow = new Proxy(base.client, {get(target, key, receiver) {
            if (key !== "create") return Reflect.get(target, key, receiver);
            return async (input: unknown) => {
                creates += 1;
                await gate;
                return target.create(input as never);
            };
        }}) as SessionsClient;
        const sessions: string[] = [];
        const h = await harness(w, {remote: slow, attachments: {upload: async (session, file) => {
            sessions.push(session);
            return {ok: true, value: uploaded(file.name)};
        }}});
        const created = h.host.create(PROFILE);
        h.host.act({type: "composer.attachmentAdded", localId: "l1", kind: "image", file: FILE});
        await until("新建已发出", () => creates === 1);
        release();
        const id = await created;
        if (id === null) throw new Error("新建失败");
        await until("附件就绪", () => h.ctx().composer.attachments.find((item) => item.localId === "l1")?.state === "ready");
        expect(creates).toBe(1);
        expect(sessions).toEqual([id]);
        expect(h.host.sessionId.value).toBe(id);
    });

    test("第一次加附件就建会话，几个一起加只建一个；就绪后发送带上范围；迟到的结果不算；移除的不带", async () => {
        const w = await world();
        const gates: (() => void)[] = [];
        const h = await harness(w, {attachments: {upload: async (_session, file) => {
            await new Promise<void>((resolve) => gates.push(resolve));
            return {ok: true, value: uploaded(file.name)};
        }}});
        expect(h.ctx().interaction.canRegisterAttachments).toBe(true);
        h.host.act({type: "composer.attachmentAdded", localId: "l1", kind: "image", file: new File(["1"], "a", {type: "image/png"})});
        h.host.act({type: "composer.attachmentAdded", localId: "l2", kind: "image", file: new File(["2"], "b", {type: "image/png"})});
        await until("两个都在上传", () => gates.length === 2);
        expect(h.ctx().session).not.toBeNull();
        const listed = await w.service.list({});
        expect(listed.ok && listed.value).toHaveLength(1);
        gates[0]!();
        await until("第一个就绪", () => h.ctx().composer.attachments.find((item) => item.localId === "l1")?.state === "ready");
        h.host.act({type: "composer.attachmentRemoved", localId: "l2"});
        gates[1]!();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(h.ctx().composer.attachments.map((item) => item.localId)).toEqual(["l1"]);

        const label = `![image #1](${uploaded("a").uri})`;
        endpoint.script("看到了");
        h.host.act({type: "composer.submit", text: `看${label}这张`, delivery: "prompt"});
        await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === "看到了");
        await idle(h);
        expect(h.ctx().composer.attachments).toEqual([]);
        const view = w.service.session(h.host.sessionId.value!);
        const input = (await view.path()).find((event) => event.type === "input")!;
        expect((input.data as {attachments: unknown}).attachments).toEqual([{...uploaded("a"), from: 1, to: 1 + label.length}]);
        // 兜底标题不带附件的标签（tiny 角色没绑定时用第一句话）。
        await until("标题", () => h.ctx().session?.title === "看这张");
    });

    test("超限与失败写原因，能重试；切会话时草稿的附件清掉，迟到的结果不算；没用上的不带", async () => {
        const w = await world();
        let results: ({ok: true; value: ReturnType<typeof uploaded>} | {ok: false; code: string})[] = [{ok: false, code: "too-large"}, {ok: true, value: uploaded("a")}];
        const h = await harness(w, {attachments: {upload: async () => results.shift()!}});
        expect(await h.host.create(PROFILE)).not.toBeNull();
        h.host.act({type: "composer.attachmentAdded", localId: "l1", kind: "image", file: FILE});
        await until("失败", () => h.ctx().composer.attachments[0]?.state === "failed");
        h.host.act({type: "composer.attachmentRetry", localId: "l1"});
        await until("就绪", () => h.ctx().composer.attachments[0]?.state === "ready");

        endpoint.script("好");
        h.host.act({type: "composer.submit", text: "标签删掉了", delivery: "prompt"});
        await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === "好");
        await idle(h);
        const view = w.service.session(h.host.sessionId.value!);
        const input = (await view.path()).find((event) => event.type === "input")!;
        expect((input.data as {attachments?: unknown}).attachments).toBeUndefined();

        const first = h.host.sessionId.value!;
        results = [{ok: true, value: uploaded("b")}];
        h.host.act({type: "composer.attachmentAdded", localId: "l2", kind: "image", file: FILE});
        expect(await h.host.create(PROFILE)).not.toBeNull();
        expect(h.host.sessionId.value).not.toBe(first);
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(h.ctx().composer.attachments).toEqual([]);
    });

    test("建会话时用户去了别的会话：不抢界面", async () => {
        const w = await world();
        const first = await w.window("sh-create-gate");
        let release = () => undefined as void;
        let gating = false;
        const gated = new Proxy(first.client, {get(target, key, receiver) {
            if (key !== "create") return Reflect.get(target, key, receiver);
            return async (input: never) => {
                const result = await target.create(input);
                if (gating) await new Promise<void>((resolve) => { release = resolve; });
                return result;
            };
        }}) as SessionsClient;
        const h = await harness(w, {remote: gated});
        expect(await h.host.create(PROFILE)).not.toBeNull();
        const existing = h.host.sessionId.value!;
        const fresh = await harness(w, {remote: gated});
        gating = true;
        fresh.host.act({type: "composer.attachmentAdded", localId: "l1", kind: "image", file: FILE});
        await until("create 在等", () => release !== undefined && fresh.ctx().composer.attachments.length === 1);
        await new Promise<void>((resolve) => setImmediate(resolve));
        await fresh.host.open(existing);
        // 还没有会话时加的附件不带进打开的已有会话；迟到的建会话结果也不把它标成失败。
        expect(fresh.ctx().composer.attachments).toEqual([]);
        release();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(fresh.host.sessionId.value).toBe(existing);
        expect(fresh.ctx().composer.attachments).toEqual([]);
    });

    test("发送明确被拒：文字和附件都回到输入框，再发还带着；结果未知：重发带上附件", async () => {
        const w = await world();
        const base = await w.window("sh-attach-reject");
        let mode: "reject" | "lost" | "normal" = "reject";
        const flaky = new Proxy(base.client, {get(target, key, receiver) {
            if (key !== "send") return Reflect.get(target, key, receiver);
            return async (input: never) => {
                const now = mode;
                mode = "normal";
                if (now === "reject") return {ok: false, code: "empty-input"};
                if (now === "lost") return {ok: false, code: "unknown-outcome"};
                return target.send(input);
            };
        }}) as SessionsClient;
        const h = await harness(w, {remote: flaky, attachments: {upload: async () => ({ok: true, value: uploaded("a")})}});
        expect(await h.host.create(PROFILE)).not.toBeNull();
        h.host.act({type: "composer.attachmentAdded", localId: "l1", kind: "image", file: FILE});
        await until("就绪", () => h.ctx().composer.attachments[0]?.state === "ready");
        const label = `![image #1](${uploaded("a").uri})`;
        const text = `看${label}`;

        h.host.act({type: "composer.submit", text, delivery: "prompt"});
        await until("放回", () => h.ctx().composer.draft.text === text);
        expect(h.ctx().composer.attachments.map((item) => item.state)).toEqual(["ready"]);

        mode = "lost";
        h.host.act({type: "composer.submit", text, delivery: "prompt"});
        await until("标未确认", () => (h.ctx().messages.at(-1) as {delivery?: string} | undefined)?.delivery === "unknown");
        endpoint.script("看到了");
        h.host.act({type: "message.resend", messageId: h.ctx().messages.at(-1)!.id});
        await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === "看到了");
        await idle(h);
        const view = w.service.session(h.host.sessionId.value!);
        const input = (await view.path()).find((event) => event.type === "input")!;
        expect((input.data as {attachments: unknown}).attachments).toEqual([{...uploaded("a"), from: 1, to: 1 + label.length}]);
    });

    test("附件的范围按标签算：代码片段与转义里的地址不算，同一张的两个标签各算一处", async () => {
        const w = await world();
        const h = await harness(w, {attachments: {upload: async () => ({ok: true, value: uploaded("a")})}});
        expect(await h.host.create(PROFILE)).not.toBeNull();
        h.host.act({type: "composer.attachmentAdded", localId: "l1", kind: "image", file: FILE});
        await until("就绪", () => h.ctx().composer.attachments[0]?.state === "ready");
        const label = `![image #1](${uploaded("a").uri})`;
        const code = `\`${label}\``;
        const text = `${code}甲${label}乙${label}`;
        endpoint.script("好");
        h.host.act({type: "composer.submit", text, delivery: "prompt"});
        await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === "好");
        await idle(h);
        const view = w.service.session(h.host.sessionId.value!);
        const input = (await view.path()).find((event) => event.type === "input")!;
        const first = code.length + 1;
        const second = first + label.length + 1;
        expect((input.data as {attachments: {from: number; to: number}[]}).attachments.map(({from, to}) => [from, to])).toEqual([[first, first + label.length], [second, second + label.length]]);
    });

    test("编辑重发带上原来的附件", async () => {
        const w = await world();
        const h = await harness(w, {attachments: {upload: async () => ({ok: true, value: uploaded("a")})}});
        expect(await h.host.create(PROFILE)).not.toBeNull();
        h.host.act({type: "composer.attachmentAdded", localId: "l1", kind: "image", file: FILE});
        await until("就绪", () => h.ctx().composer.attachments[0]?.state === "ready");
        const label = `![image #1](${uploaded("a").uri})`;
        endpoint.script("一");
        h.host.act({type: "composer.submit", text: `看${label}`, delivery: "prompt"});
        await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === "一");
        await idle(h);
        const user = h.ctx().messages.find((item) => item.kind === "user")!;
        endpoint.script("二");
        h.host.act({type: "message.editSubmit", messageId: user.id, text: `再看看${label}`});
        await until("新回复", () => assistants(h.ctx().messages).at(-1)?.text === "二");
        await idle(h);
        const view = w.service.session(h.host.sessionId.value!);
        const input = (await view.path()).find((event) => event.type === "input")!;
        expect((input.data as {attachments: {from: number}[]}).attachments[0]!.from).toBe(3);
    });
});

describe("Agent 模式（agent/modes.md）", () => {
    const modeSwitch = (ctx: AgentConversationContext) => ctx.pendingInputs.find((item) => item.kind === "mode-switch") as Extract<PendingInputView, {kind: "mode-switch"}> | undefined;

    test("主创有三种模式；点切换走设置，别的窗口切了跟着变；状态栏与审批不变", async () => {
        const w = await world();
        const h = await harness(w, {});
        expect(await h.host.create(MAIN_PROFILE)).not.toBeNull();
        await until("有模式", () => h.ctx().composer.modes.length === 3);
        expect(h.ctx().composer.mode).toBe("normal");
        h.host.act({type: "mode.set", mode: "plan"});
        await until("切到计划", () => h.ctx().composer.mode === "plan");
        await w.service.session(h.host.sessionId.value!).changeSettings({commandId: crypto.randomUUID(), patch: {[AGENT_MODES_EXTENSION]: {mode: "discuss"}}});
        await until("别处切了", () => h.ctx().composer.mode === "discuss");
    });

    test("第三方插件的 Profile 声明里引用模式扩展、工具里没有 switch_mode：显示、用户能切；草稿里选的模式新建时提交", async () => {
        const w = await world();
        const h = await harness(w, {});
        h.host.act({type: "mode.set", mode: "plan"});
        await until("记下", () => h.ctx().composer.mode === "plan");
        expect(await h.host.create(MODAL_PROFILE)).not.toBeNull();
        await until("有模式、草稿的计划模式提交了", () => h.ctx().composer.modes.length === 3 && h.ctx().composer.mode === "plan");
        expect((await w.service.session(h.host.sessionId.value!).snapshot()).extensionSettings[AGENT_MODES_EXTENSION]?.mode).toBe("plan");
        h.host.act({type: "mode.set", mode: "discuss"});
        await until("切到讨论", () => h.ctx().composer.mode === "discuss");
        expect(h.ctx().composer.notice).toBeUndefined();
    });

    test("没有模式扩展的 Profile：不显示", async () => {
        const w = await world();
        const h = await started(w);
        await until("打开", () => h.ctx().session !== null);
        expect(h.ctx().composer.modes).toEqual([]);
    });

    test("还没有会话时选了模式：第一次发送前提交", async () => {
        const w = await world();
        const h = await harness(w, {});
        expect(h.ctx().interaction.canChangeMode).toBe(true);
        h.host.act({type: "mode.set", mode: "plan"});
        await until("记下", () => h.ctx().composer.mode === "plan");
        expect(h.host.sessionId.value).toBeNull();
        const before = endpoint.requests.length;
        endpoint.script({tool: "shell", args: {command: "touch a"}}, "好");
        h.host.act({type: "composer.submit", text: "第一条", delivery: "prompt"});
        await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === "好");
        expect(h.ctx().composer.mode).toBe("plan");
        // 第一条就在计划模式下跑：提示写了，写被闸门拦了。
        expect(JSON.stringify(endpoint.requests.slice(before).map((request) => request.messages))).toContain("现在是计划模式");
        const results = (await w.service.session(h.host.sessionId.value!).path()).filter((event) => event.type === "toolResult");
        expect((results[0]!.data as {code?: string}).code).toBe("mode-blocked");
    });

    test("/plan 与 /mode：已在不动，接显示名，名字不对提示且字留着", async () => {
        const w = await world();
        const h = await harness(w, {});
        expect(await h.host.create(MAIN_PROFILE)).not.toBeNull();
        await until("有模式", () => h.ctx().composer.modes.length === 3);
        h.host.act({type: "command.run", name: "plan", argsText: ""});
        await until("计划", () => h.ctx().composer.mode === "plan");
        // 显示名也认：这里的翻译端口把键原样交回，显示名就是键。
        h.host.act({type: "command.run", name: "mode", argsText: h.ctx().composer.modes[1]!.label});
        await until("讨论", () => h.ctx().composer.mode === "discuss");
        h.host.act({type: "command.run", name: "mode", argsText: "normal"});
        await until("按 key", () => h.ctx().composer.mode === "normal");
        h.host.act({type: "command.run", name: "mode", argsText: ""});
        await until("下一种", () => h.ctx().composer.mode === "discuss");
        h.host.act({type: "command.run", name: "mode", argsText: "没有这种"});
        await until("提示", () => h.ctx().composer.draft.text === "/mode 没有这种");
        expect(h.ctx().composer.mode).toBe("discuss");
    });

    /** 数 `changeSettings` 的调用：判据要做到“没有模式就不发请求”，只看结果分不出（服务端也会拒）。 */
    async function counting(w: AgentWorld, overrides: Partial<SessionHostDeps> = {}): Promise<{readonly h: Harness; readonly calls: () => number}> {
        let count = 0;
        const {client} = await w.window(`sh-count-${String((windows += 1))}`);
        const remote = new Proxy(client, {get: (target, key, receiver) => {
            const value = Reflect.get(target, key, receiver) as unknown;
            if (key !== "changeSettings" || typeof value !== "function") return value;
            return (...args: unknown[]) => {
                count += 1;
                return (value as (...a: unknown[]) => unknown).apply(target, args);
            };
        }});
        return {h: await harness(w, {remote, ...overrides}), calls: () => count};
    }

    test("没有模式的会话：/plan 文字、/mode 与模式控件都不发请求、不发消息，提示没有 Agent 模式", async () => {
        const w = await world();
        const {h, calls} = await counting(w);
        expect(await h.host.create(PROFILE)).not.toBeNull();
        await until("打开", () => h.ctx().session !== null && h.ctx().availability.status === "ready");
        const before = endpoint.requests.length;
        h.host.act({type: "command.run", name: "plan", argsText: "先想清楚再写"});
        await until("提示", () => h.ctx().composer.notice !== undefined);
        expect(h.ctx().composer.notice).toMatchObject({key: "conversation.mode.unavailable"});
        h.host.act({type: "command.run", name: "mode", argsText: "没有这种"});
        h.host.act({type: "mode.set", mode: "discuss"});
        await until("还是这个提示", () => (h.ctx().composer.notice as {readonly key?: string} | undefined)?.key === "conversation.mode.unavailable");
        expect(calls()).toBe(0);
        expect(endpoint.requests.length).toBe(before);
        expect(assistants(h.ctx().messages)).toEqual([]);
    });

    test("草稿里选了模式、新建的 Profile 没有模式：建好后不提交，也不提示", async () => {
        const w = await world();
        const {h, calls} = await counting(w);
        h.host.act({type: "mode.set", mode: "plan"});
        await until("记下", () => h.ctx().composer.mode === "plan");
        expect(await h.host.create(PROFILE)).not.toBeNull();
        await until("打开", () => h.ctx().session !== null && h.ctx().availability.status === "ready");
        expect(calls()).toBe(0);
        expect(h.ctx().composer.modes).toEqual([]);
    });

    test("目录说有模式、会话的装配里没有：切换发出去被拒，提示没有 Agent 模式", async () => {
        const w = await world();
        const entry = {key: PROFILE, name: "测试", description: "", source: "test", status: "ok" as const, referencedExtensions: [AGENT_MODES_EXTENSION]};
        const {h, calls} = await counting(w, {profiles: () => [entry]});
        expect(await h.host.create(PROFILE)).not.toBeNull();
        await until("有模式控件", () => h.ctx().session !== null && h.ctx().composer.modes.length === 3);
        h.host.act({type: "mode.set", mode: "plan"});
        await until("提示", () => h.ctx().composer.notice !== undefined);
        expect(h.ctx().composer.notice).toMatchObject({key: "conversation.mode.unavailable"});
        expect(calls()).toBe(1);
    });

    test("还没有会话时按主创判：目录里的主创引用了模式才有控件", async () => {
        const w = await world();
        const main = {key: MAIN_PROFILE, name: "主创", description: "", source: "nbook.agent", status: "ok" as const};
        const without = await harness(w, {profiles: () => [main]});
        expect(without.ctx().composer.modes).toEqual([]);
        const withModes = await harness(w, {profiles: () => [{...main, referencedExtensions: [AGENT_MODES_EXTENSION]}]});
        expect(withModes.ctx().composer.modes).toHaveLength(3);
    });

    test("退出计划：向导带计划与当前审批模式；批准同时改审批模式，模式跟着变", async () => {
        const w = await world();
        const h = await harness(w, {});
        expect(await h.host.create(MAIN_PROFILE)).not.toBeNull();
        await until("有模式", () => h.ctx().composer.modes.length === 3);
        h.host.act({type: "mode.set", mode: "plan"});
        await until("计划", () => h.ctx().composer.mode === "plan");
        endpoint.script({tool: "write", args: {path: "session://plan.md", content: "第一步"}}, {tool: "switch_mode", args: {mode: "normal"}}, "开始");
        h.host.act({type: "composer.submit", text: "规划", delivery: "prompt"});
        await until("向导", () => modeSwitch(h.ctx()) !== undefined);
        const item = modeSwitch(h.ctx())!;
        expect(item).toMatchObject({fromLabel: expect.any(String), plan: "第一步", approval: {value: "ask"}});
        h.host.act({type: "input.submit", batchKey: item.id, resolutions: {kind: "mode-switch", answer: {approved: true, approvalMode: "allow-writes"}}});
        await until("切回", () => h.ctx().composer.mode === "normal");
        await until("审批模式", () => h.ctx().composer.approval?.value === "allow-writes");
        await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === "开始");
    });

    test("继续改：附言交给模型，模式不变", async () => {
        const w = await world();
        const h = await harness(w, {});
        expect(await h.host.create(MAIN_PROFILE)).not.toBeNull();
        await until("有模式", () => h.ctx().composer.modes.length === 3);
        h.host.act({type: "mode.set", mode: "plan"});
        await until("计划", () => h.ctx().composer.mode === "plan");
        endpoint.script({tool: "write", args: {path: "session://plan.md", content: "第一步"}}, {tool: "switch_mode", args: {mode: "normal"}}, "再改");
        h.host.act({type: "composer.submit", text: "规划", delivery: "prompt"});
        await until("向导", () => modeSwitch(h.ctx()) !== undefined);
        h.host.act({type: "input.submit", batchKey: modeSwitch(h.ctx())!.id, resolutions: {kind: "mode-switch", answer: {approved: false, note: "第二步也要写"}}});
        await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === "再改");
        expect(h.ctx().composer.mode).toBe("plan");
        expect(JSON.stringify(endpoint.requests.at(-1)?.messages)).toContain("第二步也要写");
    });

    test("闸门拒绝单独说明，不算规则拒绝", async () => {
        const w = await world();
        const h = await harness(w, {});
        expect(await h.host.create(MAIN_PROFILE)).not.toBeNull();
        await until("有模式", () => h.ctx().composer.modes.length === 3);
        h.host.act({type: "mode.set", mode: "plan"});
        await until("计划", () => h.ctx().composer.mode === "plan");
        endpoint.script({tool: "shell", args: {command: "touch a"}}, "好");
        h.host.act({type: "composer.submit", text: "改", delivery: "prompt"});
        await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === "好");
        expect(JSON.stringify(h.ctx().messages)).toContain("kernel.tool.modeBlocked");
    });
});

describe("改写历史（输出 25、26）", () => {
    /** 一轮：回复带工具调用，工具结果之后再回复。 */
    async function twoStepTurn(h: Harness): Promise<void> {
        endpoint.script({tool: "read", args: {path: "session://没有.md"}}, "读完了");
        h.host.act({type: "approval.set", mode: "yolo"});
        await until("全部放行", () => h.ctx().composer.approval?.value === "yolo");
        h.host.act({type: "composer.submit", text: "读一下", delivery: "prompt"});
        await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === "读完了");
        await idle(h);
    }

    test("重试最后一条回复：新回复是兄弟，切换器 2/2；切回 1/2 看到旧回复", async () => {
        const w = await world();
        const h = await started(w);
        await twoStepTurn(h);
        expect(h.ctx().interaction.canMutateHistory).toBe(true);
        const last = assistants(h.ctx().messages).at(-1)!;
        expect(h.ctx().branches[last.id]).toBeUndefined();

        endpoint.script("重试的回复");
        h.host.act({type: "message.retry", messageId: last.id});
        await until("新回复", () => assistants(h.ctx().messages).at(-1)?.text === "重试的回复");
        await idle(h);
        const fresh = assistants(h.ctx().messages).at(-1)!;
        await until("分支切换", () => h.ctx().branches[fresh.id]?.total === 2);
        expect(h.ctx().branches[fresh.id]!.index).toBe(2);
        // 前面那一步不受影响：第一条回复（带工具调用）还在。
        expect(assistants(h.ctx().messages)).toHaveLength(2);

        h.host.act({type: "branch.switch", messageId: fresh.id, direction: "previous"});
        await until("切回旧回复", () => assistants(h.ctx().messages).at(-1)?.text === "读完了");
        const old = assistants(h.ctx().messages).at(-1)!;
        await until("位置是 1/2", () => h.ctx().branches[old.id]?.index === 1);
    });

    test("重试中间那条回复：退到它之前，后面的那步不在当前路径上", async () => {
        const w = await world();
        const h = await started(w);
        await twoStepTurn(h);
        const first = assistants(h.ctx().messages)[0]!;
        endpoint.script("这次不调工具");
        h.host.act({type: "message.retry", messageId: first.id});
        await until("新回复", () => assistants(h.ctx().messages).at(-1)?.text === "这次不调工具");
        await idle(h);
        expect(assistants(h.ctx().messages).map((item) => item.text)).toEqual(["这次不调工具"]);
    });

    test("编辑重发：两条文字相同的用户消息，改的是点的那条；原来的还在分支里", async () => {
        const w = await world();
        const h = await started(w);
        endpoint.script("一", "二");
        for (const expected of ["一", "二"]) {
            h.host.act({type: "composer.submit", text: "同一句话", delivery: "prompt"});
            await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === expected);
            await idle(h);
        }
        const users = h.ctx().messages.filter((item) => item.kind === "user");
        expect(users).toHaveLength(2);
        const firstUser = users[0]!;
        h.host.act({type: "message.editStart", messageId: firstUser.id});
        await until("编辑态", () => h.ctx().editing?.messageId === firstUser.id);
        expect(h.ctx().editing).toMatchObject({text: "同一句话", loading: false});
        h.host.act({type: "message.editCancel"});
        await until("取消", () => h.ctx().editing === null);

        h.host.act({type: "message.editStart", messageId: firstUser.id});
        endpoint.script("改过的回复");
        h.host.act({type: "message.editSubmit", messageId: firstUser.id, text: "改过的话"});
        await until("新回复", () => assistants(h.ctx().messages).at(-1)?.text === "改过的回复");
        await idle(h);
        const now = h.ctx().messages.filter((item) => item.kind === "user");
        // 第一条被改，第二条在旧分支上，不在当前路径。
        expect(now).toHaveLength(1);
        expect(now[0]!.blocks).toMatchObject([{kind: "text", text: "改过的话"}]);
        await until("分支切换在新消息上", () => h.ctx().branches[now[0]!.id]?.total === 2);
    });

    test("从此处分支：不发送，留下这条回复；用户消息留下这句话；运行中不能改", async () => {
        const w = await world();
        const h = await started(w);
        endpoint.script("第一轮", "第二轮");
        for (const expected of ["第一轮", "第二轮"]) {
            h.host.act({type: "composer.submit", text: expected, delivery: "prompt"});
            await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === expected);
            await idle(h);
        }
        const before = endpoint.requests.length;
        h.host.act({type: "message.branchFrom", messageId: assistants(h.ctx().messages)[0]!.id});
        await until("退回第一轮之后", () => assistants(h.ctx().messages).length === 1);
        expect(assistants(h.ctx().messages)[0]!.text).toBe("第一轮");
        expect(h.ctx().run.status).toBe("idle");
        expect(endpoint.requests.length).toBe(before);

        endpoint.script("接在第一轮后面");
        h.host.act({type: "composer.submit", text: "换个方向", delivery: "prompt"});
        await until("新分支的回复", () => assistants(h.ctx().messages).at(-1)?.text === "接在第一轮后面");
        await idle(h);
        expect(h.ctx().messages.filter((item) => item.kind === "user")).toHaveLength(2);
    });

    test("从此处分支退到用户消息后：重新生成直接接着跑", async () => {
        const w = await world();
        const h = await started(w);
        endpoint.script("第一次");
        h.host.act({type: "composer.submit", text: "问", delivery: "prompt"});
        await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === "第一次");
        await idle(h);
        const user = h.ctx().messages.find((item) => item.kind === "user")!;
        h.host.act({type: "message.branchFrom", messageId: user.id});
        await until("退到用户消息后", () => assistants(h.ctx().messages).length === 0);
        endpoint.script("接着跑的");
        h.host.act({type: "message.retry", messageId: user.id});
        await until("接着跑了", () => assistants(h.ctx().messages).at(-1)?.text === "接着跑的");
        await idle(h);
        expect(h.ctx().composer.notice).toBeUndefined();

    });

    test("结果未知再点一次用同一个指令 id；明确被拒时编辑器不关", async () => {
        const w = await world();
        const first = await w.window("sh-rewrite-gate");
        let lose = false;
        let refuse = false;
        const seen: string[] = [];
        const gated = new Proxy(first.client, {get(target, key, receiver) {
            if (key !== "rewind") return Reflect.get(target, key, receiver);
            return async (input: {commandId: string}) => {
                seen.push(input.commandId);
                if (refuse) return {ok: false, code: "input-rejected"};
                const result = await target.rewind(input as never);
                if (lose) {
                    lose = false;
                    return {ok: false, code: "unknown-outcome"};
                }
                return result;
            };
        }}) as SessionsClient;
        const h = await harness(w, {remote: gated});
        expect(await h.host.create(PROFILE)).not.toBeNull();
        endpoint.script("一");
        h.host.act({type: "composer.submit", text: "问", delivery: "prompt"});
        await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === "一");
        await idle(h);
        const user = h.ctx().messages.find((item) => item.kind === "user")!;

        refuse = true;
        h.host.act({type: "message.editStart", messageId: user.id});
        h.host.act({type: "message.editSubmit", messageId: user.id, text: "改过的"});
        await until("说明", () => h.ctx().composer.notice !== undefined);
        expect(h.ctx().editing?.messageId).toBe(user.id);
        refuse = false;
        h.host.act({type: "message.editCancel"});

        lose = true;
        const before = seen.length;
        const reply = assistants(h.ctx().messages)[0]!;
        h.host.act({type: "message.branchFrom", messageId: reply.id});
        // 等“结果未知”这条说明本身：上一步被拒的说明还留着，只等“有说明”会在第一次回退还在途时就放行，第二次点击被宿主拦下。
        await until("说明不确定", () => seen.length === before + 1 && (h.ctx().composer.notice as {key?: string} | undefined)?.key === "conversation.history.unknown");
        h.host.act({type: "message.branchFrom", messageId: reply.id});
        await until("再来一次", () => seen.length === before + 2);
        expect(seen[before + 1]).toBe(seen[before]);
    });

    test("分支树：读到全部节点与当前路径；切换到别的分支；关了放掉", async () => {
        const w = await world();
        const h = await started(w);
        endpoint.script("旧回复");
        h.host.act({type: "composer.submit", text: "问", delivery: "prompt"});
        await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === "旧回复");
        await idle(h);
        const oldId = assistants(h.ctx().messages).at(-1)!.id;
        endpoint.script("新回复");
        h.host.act({type: "message.retry", messageId: oldId});
        await until("新回复", () => assistants(h.ctx().messages).at(-1)?.text === "新回复");
        await idle(h);

        expect(h.ctx().interaction.canOpenTree).toBe(true);
        h.host.act({type: "tree.refresh"});
        await until("读完", () => h.ctx().panels.sessionTree?.state === "ready");
        const tree = h.ctx().panels.sessionTree;
        if (tree?.state !== "ready") throw new Error("not ready");
        const labels = tree.nodes.filter((node) => node.type === "assistant").map((node) => node.label);
        expect(labels).toEqual(["旧回复", "新回复"]);
        expect(tree.activePath).toContain(assistants(h.ctx().messages).at(-1)!.id);
        expect(tree.activePath).not.toContain(oldId);

        h.host.act({type: "tree.activate", entryId: oldId});
        await until("切过去", () => assistants(h.ctx().messages).at(-1)?.text === "旧回复");
        h.host.act({type: "tree.copyId", entryId: oldId});
        expect(h.copied).toContain(oldId);
        h.host.act({type: "tree.closed"});
        await until("放掉了", () => h.ctx().panels.sessionTree === undefined);
    });

    test("重开会话也看得到分叉；已归档的不能改写", async () => {
        const w = await world();
        const h = await started(w);
        endpoint.script("旧");
        h.host.act({type: "composer.submit", text: "问", delivery: "prompt"});
        await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === "旧");
        await idle(h);
        endpoint.script("新");
        h.host.act({type: "message.retry", messageId: assistants(h.ctx().messages).at(-1)!.id});
        await until("新回复", () => assistants(h.ctx().messages).at(-1)?.text === "新");
        await idle(h);
        const fresh = await harness(w);
        await fresh.host.open(h.host.sessionId.value!);
        const reply = await until("打开", () => assistants(fresh.ctx().messages).at(-1));
        await until("分叉", () => fresh.ctx().branches[reply.id]?.total === 2);
        fresh.host.act({type: "session.archive", sessionId: fresh.host.sessionId.value!});
        await until("归档", () => fresh.ctx().availability.status === "archived");
        expect(fresh.ctx().interaction.canMutateHistory).toBe(false);
    });
});

describe("中断、设置与模型（输出 7–9）", () => {
    test("改审批模式、模型、推理档写到核心设置；模型选项第一项是跟随默认", async () => {
        const w = await world();
        const h = await started(w);
        h.host.act({type: "approval.set", mode: "yolo"});
        await until("审批模式", () => h.ctx().composer.approval?.value === "yolo");
        h.host.act({type: "thinking.set", level: "high"});
        await until("推理档", () => h.ctx().composer.thinking === "high");
        expect(h.ctx().composer.models[0]).toMatchObject({key: ""});
        expect(h.ctx().composer.modelKey).toBe("");
    });

    test("推理档：选择器的档位状态来自内核的解析（角色的默认档、会话明确选的），选“跟随”回到角色的", async () => {
        const local = localModelSettings(endpoint.baseUrl, {compactionRole: true});
        const providers = (local["nbook.models/providers"] as {models: unknown[]}[]).map((provider) => ({...provider, models: [{id: "m", enabled: true, contextWindow: 32_000, reasoning: true}]}));
        const roles = {items: (local["nbook.models/roles"] as {items: {id: string}[]}).items.map((item) => (item.id === "main" ? {...item, effort: "medium"} : item.id === "deep" ? {...item, model: "local/m", effort: "low"} : item))};
        const w = await world({"nbook.models/providers": providers, "nbook.models/roles": roles});
        const h = await started(w);
        await until("跟随角色的默认档", () => h.ctx().composer.effort?.source === "role");
        expect(h.ctx().composer.effort).toMatchObject({kind: "levels", value: "medium", source: "role", follow: {source: "role"}});
        h.host.act({type: "thinking.set", level: "high"});
        await until("明确选了高", () => h.ctx().composer.effort?.source === "session");
        expect(h.ctx().composer.effort).toMatchObject({value: "high", source: "session"});
        h.host.act({type: "thinking.reset"});
        await until("回到跟随", () => h.ctx().composer.effort?.source === "role");
        expect(h.ctx().composer.effort).toMatchObject({value: "medium"});
        expect(h.ctx().composer.thinking).toBeNull();

        // “用默认”回到哪个角色看内核这次解析走的角色，不是 Profile 声明的：会话选了深度，跟随的就是深度的默认档。
        h.host.act({type: "model.set", modelKey: "role:deep"});
        await until("跟随深度的默认档", () => h.ctx().composer.effort?.value === "low");
        // 这个场地没有角色清单可查名字，名字落到角色 id。
        expect(h.ctx().composer.effort?.follow).toEqual({source: "role", name: "deep"});

        // 直接选模型没有角色的默认档；模型不知道默认是哪一档时，钉了档之后照样能回到“由模型决定”。
        h.host.act({type: "model.set", modelKey: "local/m"});
        await until("直接选模型", () => h.ctx().composer.effort?.source !== "role");
        h.host.act({type: "thinking.set", level: "high"});
        await until("钉了高", () => h.ctx().composer.effort?.source === "session");
        expect(h.ctx().composer.effort?.follow).toEqual({source: "model"});
    });

    test("模型能力提示（输出 32）：模型缺 Profile 要的能力时输入框上方写明，发送照常可用；满足时不说，查不到时不说", async () => {
        const w = await world();
        const models = shallowRef<readonly ComposerModelView[]>([{key: "local/m", label: "M", supportsImages: false, contextWindow: 1000}]);
        const entry = {key: PROFILE, name: "测试", description: "", source: "test", status: "ok" as const, modelNeeds: {vision: true, minContext: 2000}};
        const h = await harness(w, {models: () => models.value, profiles: () => [entry]});
        expect(await h.host.create(PROFILE)).not.toBeNull();
        // 这个场地的翻译端口交回键。
        await until("写明缺什么", () => h.ctx().availability.message.includes("profiles.needs.vision"));
        expect(h.ctx().availability.status).toBe("ready");
        expect(h.ctx().availability.message).toContain("profiles.needs.context");

        models.value = [{key: "local/m", label: "M", supportsImages: true, contextWindow: null}];
        await until("满足、窗口未知时不说", () => h.ctx().availability.message === "");
        models.value = [{key: "local/m", label: "M", supportsImages: false}];
        await until("又缺了", () => h.ctx().availability.message.includes("profiles.needs.vision"));
        models.value = [];
        await until("查不到时不说", () => h.ctx().availability.message === "");

        models.value = [{key: "local/m", label: "M", supportsImages: false}];
        await until("缺口又出现", () => h.ctx().availability.message !== "");
        endpoint.script("照常回复");
        h.host.act({type: "composer.submit", text: "有缺口也能发", delivery: "prompt"});
        await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === "照常回复");
    });

    test("选了没绑定的角色：不用重开就说明原因、还能改；绑定之后不刷新页面就能发送", async () => {
        const w = await world();
        const models = shallowRef<readonly ComposerModelView[]>([{key: "local/m", label: "M", supportsImages: false}]);
        const h = await harness(w, {models: () => models.value});
        expect(await h.host.create(PROFILE)).not.toBeNull();
        expect(h.ctx().composer.effectiveModel).toBe("M");

        h.host.act({type: "model.set", modelKey: "role:deep"});
        await until("说明没绑定", () => h.ctx().availability.status === "profile-unavailable");
        expect(h.ctx().composer.modelKey).toBe("role:deep");
        expect(h.ctx().composer.effectiveModel).toBeNull();

        const file = JSON.parse(await readFile(w.settings.userFile, "utf8")) as Record<string, {items: {id: string; model: string | null}[]}>;
        file["nbook.models/roles"]!.items.find((role) => role.id === "deep")!.model = "local/m";
        await writeFile(w.settings.userFile, JSON.stringify(file));
        // 模型库的 `changed` 由插件转成新的 `models`，这里按设置生效的时机换。
        await until("绑定生效", () => {
            w.settings.clock.advance(RELOAD_DELAY_MS);
            models.value = [...models.value];
            return h.ctx().availability.status === "ready";
        });
        expect(h.ctx().composer.effectiveModel).toBe("M");
        endpoint.script("绑好了");
        h.host.act({type: "composer.submit", text: "现在能发了吗", delivery: "prompt"});
        await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === "绑好了");
        await idle(h);
        // 本机端点不报缓存：不写 0%。
        expect(h.ctx().usage.cacheHitRate).toBeNull();
    });

    test("运行中模型库变了：对话不重建，运行状态与消息都还在；读得晚的结果不盖读得早的", async () => {
        const w = await world();
        const first = await w.window("sh-model-gate");
        const gates: (() => void)[] = [];
        let gating = false;
        const gated = new Proxy(first.client, {get(target, key, receiver) {
            if (key !== "snapshot") return Reflect.get(target, key, receiver);
            return async (input: never) => {
                const result = await target.snapshot(input);
                // 取到之后才等：这次读到的是旧的，交回得比后一次晚。
                if (gating) await new Promise<void>((resolve) => gates.push(resolve));
                return result;
            };
        }}) as SessionsClient;
        const models = shallowRef<readonly ComposerModelView[]>([{key: "local/m", label: "M", supportsImages: false}]);
        const h = await harness(w, {remote: gated, models: () => models.value});
        expect(await h.host.create(PROFILE)).not.toBeNull();
        const hold = endpoint.hold();
        endpoint.script("写完了");
        h.host.act({type: "composer.submit", text: "开始", delivery: "prompt"});
        await hold.arrived;
        await until("运行中", () => h.ctx().run.status === "running");
        const before = h.ctx().messages.length;

        gating = true;
        models.value = [...models.value];
        await until("第一次读取在等", () => gates.length === 1);
        gating = false;
        const view = w.service.session(h.host.sessionId.value!);
        await view.changeSettings({commandId: crypto.randomUUID(), patch: {core: {model: "没有/这个模型"}}});
        await until("第二次读取已生效", () => h.ctx().availability.status === "profile-unavailable");
        gates[0]!();
        // 第一次读取交回了旧的结果（模型还能用），不算数。等一轮事件循环，让它走完。
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(h.ctx().availability.status).toBe("profile-unavailable");
        await view.changeSettings({commandId: crypto.randomUUID(), patch: {core: {model: null}}});
        await until("改回来", () => h.ctx().availability.status === "ready");
        expect(h.ctx().run.status).toBe("running");
        expect(h.ctx().messages.length).toBe(before);
        hold.release();
        await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === "写完了");
        await idle(h);
    });

    test("上下文详情：打开时算下一次请求的组成，系统提示词要时才给，关了放掉；模型用不了时说明原因", async () => {
        const w = await world();
        const h = await started(w);
        expect(h.ctx().interaction.canInspectContext).toBe(true);
        expect(h.ctx().panels.contextInspection).toBeUndefined();
        h.host.act({type: "context.refresh"});
        await until("算好了", () => h.ctx().panels.contextInspection?.state === "ready");
        const ready = h.ctx().panels.contextInspection;
        if (ready?.state !== "ready") throw new Error("not ready");
        expect(ready.estimated).toBeGreaterThan(0);
        expect(ready.window).toBeGreaterThan(0);
        expect(ready.areas.map((area) => area.key)).toEqual(["system", "tools", "opening", "history", "turn"]);
        expect(h.ctx().panels.systemPrompt).toBeUndefined();
        h.host.act({type: "systemPrompt.load", refresh: false});
        await until("系统提示词", () => h.ctx().panels.systemPrompt !== undefined);

        h.host.act({type: "context.closed"});
        await until("放掉了", () => h.ctx().panels.contextInspection === undefined && h.ctx().panels.systemPrompt === undefined);

        h.host.act({type: "model.set", modelKey: "没有/这个模型"});
        await until("模型用不了", () => h.ctx().availability.status === "profile-unavailable");
        h.host.act({type: "context.refresh"});
        await until("说明原因", () => h.ctx().panels.contextInspection?.state === "unavailable");
    });

    test("没有模型：发送不可用，说明原因，能打开设置", async () => {
        const w = await world();
        const h = await started(w);
        const view = w.service.session(h.host.sessionId.value!);
        await view.changeSettings({commandId: crypto.randomUUID(), patch: {core: {model: "没有/这个模型"}}});
        const fresh = await harness(w);
        await fresh.host.open(h.host.sessionId.value!);
        await until("不可用", () => fresh.ctx().availability.status === "profile-unavailable");
        expect(fresh.ctx().composer.modelKey).toBe("没有/这个模型");
        expect(fresh.ctx().composer.models.at(-1)).toMatchObject({key: "没有/这个模型", unavailable: expect.any(String)});
        // 没有更具体的卡：标题写原因，按钮打开模型服务（输出 42 的最后一种）。
        expect(fresh.ctx().availability).toMatchObject({title: "conversation.model.unknown", actions: [{id: "open-settings"}]});
        fresh.host.act({type: "availability.act", action: "open-settings"});
        expect(fresh.settingsOpened).toEqual([{section: PROVIDERS_SECTION, layer: "user"}]);
    });

    /** 提示卡用真的目录（严格模式：缺键、缺插值参数会抛），断言写出来的字。 */
    const zh = () => testTextPort("zh-CN", {[AGENT_TEXT_NAMESPACE]: agentCatalogs});
    const DEEP_UNBOUND = {key: "role:deep", name: "深度", axis: "gradient", modelLabel: null, id: "deep", effort: null, status: "unbound"} as const;

    test("profileKey 是响应式的：打开一个会话时先是主创，快照到了换成它的 Profile（第一屏按它取开场指令，conversation.md 输出 41）", async () => {
        const w = await world();
        const h = await started(w);
        const fresh = await harness(w);
        const key = computed(() => fresh.host.profileKey());
        expect(key.value).toBe(MAIN_PROFILE);
        await fresh.host.open(h.host.sessionId.value!);
        await until("换成会话的 Profile", () => key.value === PROFILE);
    });

    test("提示卡：没选会话时只判一家服务商都没有，按钮打开服务商页的添加窗口；还没读到、有服务商时不出", async () => {
        const w = await world();
        const providers = shallowRef<readonly {id: string; name: string}[] | null>(null);
        const h = await harness(w, {text: zh(), providers: () => providers.value});
        expect(h.ctx().session).toBeNull();
        expect(h.ctx().availability.status).toBe("ready");
        providers.value = [];
        await until("出卡", () => h.ctx().availability.status === "profile-unavailable");
        expect(h.ctx().availability).toMatchObject({title: "还没有可用的模型", actions: [{id: "add-provider", label: "添加服务商"}]});
        h.host.act({type: "availability.act", action: "add-provider"});
        expect(h.settingsOpened).toEqual([{section: PROVIDERS_SECTION, focus: "add", layer: "user"}]);
        providers.value = [{id: "local", name: "本机"}];
        await until("卡消失", () => h.ctx().availability.status === "ready");
    });

    test("提示卡：角色没绑定写出角色与 Profile，去绑定打开角色页、定位到这个角色；服务商一家都没有时先说添加", async () => {
        const w = await world();
        const providers = shallowRef<readonly {id: string; name: string}[] | null>([{id: "local", name: "本机"}]);
        const h = await harness(w, {text: zh(), providers: () => providers.value, roles: () => [DEEP_UNBOUND]});
        expect(await h.host.create(PROFILE)).not.toBeNull();
        h.host.act({type: "model.set", modelKey: "role:deep"});
        await until("出卡", () => h.ctx().availability.status === "profile-unavailable");
        expect(h.ctx().availability).toMatchObject({title: "“深度”角色还没绑定模型", message: "测试用“深度”角色的模型对话。", actions: [{id: "bind-role", label: "去绑定"}]});
        h.host.act({type: "availability.act", action: "bind-role"});
        expect(h.settingsOpened.at(-1)).toEqual({section: ROLES_SECTION, focus: "deep", layer: "user"});

        providers.value = [];
        await until("换成添加服务商", () => h.ctx().availability.actions[0]?.id === "add-provider");
        // 卡换了，旧卡的按钮不再有去处。
        h.host.act({type: "availability.act", action: "bind-role"});
        expect(h.settingsOpened).toHaveLength(1);
    });

    test("提示卡：没有密钥写出服务商；绑在角色上时说明写角色，直接选的写模型；设置密钥打开服务商页、定位到这家", async () => {
        const local = localModelSettings(endpoint.baseUrl, {compactionRole: true});
        const roles = local["nbook.models/roles"] as {items: {id: string; model: string | null}[]};
        const w = await world({
            "nbook.models/providers": [...(local["nbook.models/providers"] as unknown[]), {id: "keyed", kind: "custom", name: "KeyCo", baseUrl: endpoint.baseUrl, api: "openai-completions", auth: "bearer", models: [{id: "k", enabled: true, contextWindow: 32_000}]}],
            "nbook.models/roles": {items: roles.items.map((role) => (role.id === "deep" ? {...role, model: "keyed/k"} : role))},
        });
        const h = await harness(w, {text: zh(), providers: () => [{id: "local", name: "本机"}, {id: "keyed", name: "KeyCo"}], roles: () => [{...DEEP_UNBOUND, status: "no-credentials"}]});
        expect(await h.host.create(PROFILE)).not.toBeNull();

        h.host.act({type: "model.set", modelKey: "role:deep"});
        await until("出卡", () => h.ctx().availability.status === "profile-unavailable");
        expect(h.ctx().availability).toMatchObject({title: "KeyCo 还没有设置密钥", message: "“深度”角色绑定的模型要用 KeyCo 的密钥。", actions: [{id: "set-key", label: "设置密钥"}]});
        h.host.act({type: "availability.act", action: "set-key"});
        expect(h.settingsOpened.at(-1)).toEqual({section: PROVIDERS_SECTION, focus: "keyed", layer: "user"});

        h.host.act({type: "model.set", modelKey: "keyed/k"});
        await until("写模型", () => h.ctx().availability.message === "keyed/k 要用 KeyCo 的密钥。");
    });

    test("归档：显示原因，能恢复", async () => {
        const w = await world();
        const h = await started(w);
        h.host.act({type: "session.archive", sessionId: h.host.sessionId.value!});
        await until("归档", () => h.ctx().availability.status === "archived");
        h.host.act({type: "availability.act", action: "restore"});
        await until("恢复", () => h.ctx().availability.status === "ready");
    });

    test("复制：消息与工具调用", async () => {
        const w = await world();
        const h = await started(w);
        endpoint.script("这段要复制");
        h.host.act({type: "composer.submit", text: "你好", delivery: "prompt"});
        await until("回复", () => assistants(h.ctx().messages).length === 1);
        await idle(h);
        h.host.act({type: "message.copy", messageId: assistants(h.ctx().messages)[0]!.id});
        expect(h.copied).toEqual(["这段要复制"]);
    });
});

describe("寿命", () => {
    test("组件都还回去之后等 30 秒才取消订阅；期间借回来不重新打开；之后借回来重新打开同一个，这不算一次打开（不加 opened、不写最近的会话）", async () => {
        const w = await world();
        const h = await started(w);
        const id = h.host.sessionId.value!;
        endpoint.script("回复");
        h.host.act({type: "composer.submit", text: "你好", delivery: "prompt"});
        await until("回复", () => assistants(h.ctx().messages).length === 1);
        await idle(h);
        const give = h.host.borrow();
        give();
        w.settings.clock.advance(RELEASE_DELAY_MS - 1);
        const again = h.host.borrow();
        again();
        w.settings.clock.advance(RELEASE_DELAY_MS + 1);
        // 只放开了订阅：记号还在，借回来重新打开。
        expect(h.host.sessionId.value).toBe(id);
        const openedBefore = h.host.opened.value;
        h.recent.value = null;
        const back = h.host.borrow();
        await until("重新打开", () => assistants(h.ctx().messages).length === 1);
        expect(h.host.opened.value).toBe(openedBefore);
        expect(h.recent.value).toBeNull();
        back();
    });
});

describe("模型请求的入口（request-trace.md 的入口表）", () => {
    test("顶栏的“查看模型请求”与回复上的“查看这次请求”补上当前会话交给宿主；回复带着它出自的请求序号", async () => {
        const w = await world();
        const h = await started(w);
        endpoint.script("你好，作者。");
        h.host.act({type: "composer.submit", text: "你好", delivery: "prompt"});
        await until("回复到了", () => h.ctx().messages.some((message) => message.kind === "assistant" && message.request !== undefined));
        const reply = h.ctx().messages.find((message) => message.kind === "assistant");
        const sessionId = h.host.sessionId.value!;
        h.host.act({type: OPEN_REQUESTS_ACTION});
        h.host.act({type: OPEN_REQUEST_ACTION, payload: {request: reply?.kind === "assistant" ? reply.request ?? null : null}});
        await until("两个入口都交给了宿主", () => h.requestsOpened.length === 2);
        expect(h.requestsOpened).toEqual([{sessionId}, {sessionId, request: 1}]);
    });
});

describe("活动条目（输出 19）", () => {
    test("先订阅后快照；运行中、等用户分开数；优先切到等用户的；结束就没有", async () => {
        const w = await world();
        const h = await started(w);
        const controller = new AbortController();
        const activity = createAgentActivity(h.client, (message) => {
            throw new Error(message);
        });
        await activity.start(controller.signal);
        expect(activity.active.value).toBe(false);
        endpoint.script({tool: "write", args: {path: "session://一.md", content: "内容"}}, "好");
        h.host.act({type: "composer.submit", text: "写", delivery: "prompt"});
        await until("等用户", () => activity.waiting.value === 1);
        expect(activity.target.value).toBe(h.host.sessionId.value);
        expect(activity.active.value).toBe(true);
        h.host.act({type: "input.submit", batchKey: approvals(h.ctx())[0]!.id, resolutions: {kind: "approval", decision: "allow"}});
        await idle(h);
        await until("没有了", () => !activity.active.value);
        controller.abort();
    });

    test("后台会话不算", async () => {
        const w = await world();
        const h = await harness(w);
        const hold = endpoint.hold();
        endpoint.script("好");
        const started_ = await w.service.startTask({taskId: crypto.randomUUID(), profile: PROFILE, input: {text: "后台"}, background: true});
        if (!started_.ok) throw new Error(started_.code);
        await hold.arrived;
        const listed = await h.client.activity({});
        expect(listed).toEqual({ok: true, value: []});
        hold.release();
        await w.service.session(started_.sessionId).waitRun(started_.runId);
    });
});

test("工具名：给模型的名字相同的画法也相同", () => {
    expect(displayToolName("nbook.agent.edit-replace")).toBe("edit");
    expect(displayToolName("nbook.agent.ask-form")).toBe("ask");
    expect(displayToolName("nbook.agent.shell")).toBe("shell");
    expect(displayToolName("lab.publish_chapter")).toBe("publish_chapter");
});

describe("手动压缩（输出 20）", () => {
    const compact = (h: Harness, argsText = "") => h.host.act({type: "command.run", name: "compact", argsText});
    const dividers = (ctx: AgentConversationContext) => ctx.messages.filter((message) => message.kind === "system" && message.source === "compaction");

    test("视图只列宿主做了的命令", async () => {
        const w = await world();
        const h = await harness(w);
        expect(h.ctx().interaction.commands).toEqual(["compact", "new", "fork", "rename", "model", "plan", "mode"]);
    });

    test("没有会话时不新建，说明还没有对话；有对话时压缩：要求进提示词，分隔线带详情，运行结束后输入框干净", async () => {
        const w = await world();
        const h = await harness(w);
        compact(h, "保留人名");
        await until("说明", () => h.ctx().composer.notice !== undefined);
        expect(h.ctx().composer.notice).toMatchObject({key: "conversation.compact.noSession"});
        expect(h.ctx().session).toBeNull();

        endpoint.script("答一");
        h.host.act({type: "composer.submit", text: "第一问", delivery: "prompt"});
        await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === "答一");
        await idle(h);
        endpoint.script("压缩后的摘要");
        const before = endpoint.requests.length;
        const hold = endpoint.hold();
        compact(h, "保留人名");
        await hold.arrived;
        // 压缩在跑：视图拿到 kind，上一轮不被画成运行中。
        expect(h.ctx().run).toMatchObject({status: "running", kind: "compact"});
        hold.release();
        await until("分隔线", () => dividers(h.ctx()).length === 1);
        await idle(h);
        expect(h.ctx().run.kind).toBeUndefined();
        const divider = dividers(h.ctx())[0] as Extract<MessageView, {kind: "system"}>;
        expect(divider.text).toBe("压缩后的摘要");
        expect(divider.compaction).toMatchObject({method: "nbook.agent.inplace", require: ["保留人名"], keptTurns: null});
        expect(JSON.stringify(endpoint.requests.slice(before).at(-1)!.messages)).toContain("保留人名");
        expect(h.ctx().composer.draft.text).toBe("");
        // 压缩的运行不属于任何一轮：上一轮的回复没被改。
        expect(assistants(h.ctx().messages).map((message) => message.status)).toEqual(["done"]);
    }, 40_000);

    test("没有可压缩的内容：文字放回输入框，说明原因，不留运行", async () => {
        const w = await world();
        const h = await started(w);
        compact(h, "保留人名");
        await until("被拒", () => h.ctx().composer.notice !== undefined);
        expect(h.ctx().composer.notice).toMatchObject({key: "conversation.compact.nothingToCompact"});
        expect(h.ctx().composer.draft.text).toBe("/compact 保留人名");
        expect(h.ctx().run.status).toBe("idle");
    });

    test("运行中受理：说明“将在这一步结束后压缩”，运行结束后收掉", async () => {
        const w = await world();
        const h = await started(w);
        endpoint.script("答一");
        h.host.act({type: "composer.submit", text: "第一问", delivery: "prompt"});
        await until("回复", () => assistants(h.ctx().messages).at(-1)?.text === "答一");
        await idle(h);
        const hold = endpoint.hold();
        endpoint.script("答二");
        h.host.act({type: "composer.submit", text: "第二问", delivery: "prompt"});
        await hold.arrived;
        compact(h);
        await until("说明", () => h.ctx().composer.notice !== undefined);
        expect(h.ctx().composer.notice).toMatchObject({key: "conversation.compact.queued"});
        endpoint.script("这次压缩的摘要");
        hold.release();
        await idle(h);
        await until("说明收掉", () => h.ctx().composer.notice === undefined);
    }, 40_000);
});

describe("子代理（w00032 t14）", () => {
    test("工具名：nbook.agent 的子代理与任务工具显式映射，别的插件的同名工具不认", () => {
        expect(["nbook.agent.spawn", "nbook.agent.send", "nbook.agent.answer", "nbook.agent.wait", "nbook.agent.kill", "nbook.agent.jobs"].map(displayToolName)).toEqual(["agent_spawn", "agent_send", "agent_answer", "agent.wait", "agent.kill", "agent.jobs"]);
        expect(displayToolName("other.plugin.wait")).toBe("wait");
    });

    test("后代的审批进停靠区、标来源、取预览，按事项所在的会话应答；进行中的调用在 activeCalls；子会话的顶栏有路径、父 Agent 的话标作者", async () => {
        const w = await world();
        const h = await harness(w);
        const parent = await h.host.create(MAIN_PROFILE);
        expect(parent).not.toBeNull();
        endpoint.scriptFor("改人物卡", {tool: "write", args: {path: "user://a.md", content: "新的人物卡"}}, "改好了");
        endpoint.script({tool: "agent_spawn", args: {profile: "nbook.agent.adhoc", prompt: "改人物卡", initial: {role: "设定核对员"}, async: true}}, "派出去了");
        h.host.act({type: "composer.submit", text: "派一个", delivery: "prompt"});
        const docked = () => {
            w.settings.clock.advance(250);
            return approvals(h.ctx()).find((item) => item.source !== undefined);
        };
        await until("子会话的审批进停靠区", () => docked() !== undefined);
        expect(docked()!.source).toMatchObject({name: "改人物卡", icon: "i-lucide-bot"});
        await until("取到预览", () => docked()?.preview.state === "ready");
        expect(h.ctx().activeCalls).toHaveLength(1);
        // 停靠区的界面状态同向导：归还超过 30 秒再借回还在。
        const dockState = {collapsed: true, index: 0, wizard: {collapsed: false, step: 0, approvals: {}, notes: {}, answers: {}}};
        h.host.act({type: "dock.state", state: dockState});
        const give = h.host.borrow();
        give();
        w.settings.clock.advance(RELEASE_DELAY_MS + 1);
        const back = h.host.borrow();
        await until("重新打开", () => docked() !== undefined);
        expect(h.ctx().dockState).toEqual(dockState);
        back();
        // 停靠的事项不替换输入框：阻塞的只有这个会话自己的同步事项。
        expect(h.ctx().pendingInputs.filter((item) => item.source === undefined && item.async !== true)).toEqual([]);
        const item = docked()!;
        const child = item.source!.sessionId;
        h.host.act({type: "input.submit", batchKey: item.id, resolutions: {kind: "approval", decision: "allow"}, sessionId: child});
        await until("子会话跑完", () => {
            w.settings.clock.advance(250);
            return h.ctx().pendingInputs.length === 0 && (h.ctx().activeCalls ?? []).length === 0;
        });
        expect(await readFile(join(w.stateRoot, "user", "a.md"), "utf8")).toBe("新的人物卡");

        await h.host.open(child);
        await until("顶栏路径", () => h.ctx().session?.path?.[0]?.id === parent);
        const first = h.ctx().messages.find((message) => message.kind === "user");
        expect(first?.kind === "user" && first.author).toMatchObject({icon: "i-lucide-feather"});
        // 父 Agent 发来的话不是用户说的：上方向键翻不到。
        expect(h.ctx().composer.recall).not.toContain("改人物卡");
    });

    test("会话面板：子会话带父会话、父会话带个数；搜索命中子会话时上级弱化列出；状态栏按会话树数运行中", async () => {
        const w = await world();
        const h = await harness(w);
        const parent = await h.host.create(MAIN_PROFILE);
        endpoint.scriptFor("慢慢查一遍", "查完了");
        const held = endpoint.holdFor("慢慢查一遍");
        endpoint.script({tool: "agent_spawn", args: {profile: "nbook.agent.adhoc", prompt: "慢慢查一遍", initial: {role: "核对员"}, async: true}}, "派了");
        h.host.act({type: "composer.submit", text: "派", delivery: "prompt"});
        await held.arrived;
        await idle(h);
        const controller = new AbortController();
        const activity = createAgentActivity(h.client, (message) => {
            throw new Error(message);
        });
        await activity.start(controller.signal);
        await until("子会话在跑", () => activity.running.value === 1);
        expect(activity.items.value).toEqual([expect.objectContaining({state: "running", root: parent})]);

        const list = createSessionList({remote: h.client, project: null, profileEntries: () => [], activity: () => activity.items.value, failed: (code) => code, now: () => 0});
        await list.refresh();
        const child = list.items.value.find((item) => item.parentId === parent);
        expect(child).toMatchObject({title: "慢慢查一遍", status: "running"});
        expect(list.items.value.find((item) => item.id === parent)).toMatchObject({childCount: 1});
        list.query.value = "慢慢查";
        expect(Object.fromEntries(list.items.value.map((item) => [item.id, item.dimmed === true]))).toEqual({[child!.id]: false, [parent!]: true});
        held.release();
        controller.abort();
    });
});

describe("Skill（skills.md 输出 26–28）", () => {
    test("`$` 菜单选中交给宿主，带上当前会话的 Profile；点开标签打开宿主给的地址，认不到时输入框上提示；别的菜单选中不管", async () => {
        const w = await world();
        const selected: Array<[string, string]> = [];
        const opened: string[] = [];
        const h = await harness(w, {
            skills: {selected: (id, profile) => void selected.push([id, profile]), address: (name, profile) => (name === "style-guide" ? `user://skills/${name}/SKILL.md#${profile}` : null)},
            openAddress: (address) => void opened.push(address),
        });
        h.host.act({type: "menu.selected", trigger: "$", id: "user.style-guide"});
        expect(selected).toEqual([["user.style-guide", MAIN_PROFILE]]);

        await h.host.create(PROFILE);
        h.host.act({type: "menu.selected", trigger: "$", id: "user.epub-export"});
        h.host.act({type: "menu.selected", trigger: "@", id: "设定/林雪.md"});
        expect(selected).toEqual([["user.style-guide", MAIN_PROFILE], ["user.epub-export", PROFILE]]);

        h.host.act({type: "skill.open", name: "style-guide"});
        await until("打开", () => opened.length === 1 || undefined);
        expect(opened).toEqual([`user://skills/style-guide/SKILL.md#${PROFILE}`]);
        h.host.act({type: "skill.open", name: "gone"});
        await until("提示", () => h.ctx().composer.notice !== undefined);
        expect(h.ctx().composer.notice).toMatchObject({key: "skills.open.missing", params: {name: "gone"}});
    });
});

describe("有归属的会话（conversation.md 输出 53：档位按归属）", () => {
    /** 像插件那样的归属表：读会话头、记住；`identities` 是归属插件给的身份，`failing` 里的会话读不到会话头。 */
    async function ownersFor(w: AgentWorld, identities: Readonly<Record<string, {name: string; avatar?: string}>> = {}, failing: ReadonlySet<string> = new Set(), seen: {readonly value: number | null} = {value: null}): Promise<SessionOwners> {
        windows += 1;
        const {client} = await w.window(`owners-${String(windows)}`);
        const table = new Map<string, SessionOwner | null>();
        return {
            known: (id) => table.get(id),
            ownerOf: async (id) => {
                if (failing.has(id)) return "unreadable";
                const known = table.get(id);
                if (known !== undefined) return known;
                const read = await client.header({sessionId: id});
                if (!read.ok) return read.code === "session-not-found" ? "missing" : "unreadable";
                const owner = read.value.owner ?? null;
                table.set(id, owner);
                return owner;
            },
            identity: (owner) => identities[owner.id] ?? null,
            seenOf: () => seen.value,
        };
    }
    async function ownedSession(w: AgentWorld, id = "lyra"): Promise<string> {
        const created = await w.service.create({profile: PROFILE, owner: {id}});
        if (!created.ok) throw new Error(created.code);
        return created.value.id;
    }

    test("同一个宿主在 bot 主对话与普通会话之间切换：档位、命令白名单、新建跟着变；顶栏写归属插件给的身份；有归属的也写最近的会话，恢复照常打开", async () => {
        const w = await world();
        const ownedId = await ownedSession(w);
        const plainId = (await started(w)).host.sessionId.value!;
        const owners = await ownersFor(w, {lyra: {name: "星璃", avatar: "/api/nbook.bots/avatar/lyra"}});
        const h = await harness(w, {owners});
        await h.host.open(ownedId);
        await until("bot 档", () => h.ctx().availability.status === "ready" && h.ctx().interaction.placement === "dock");
        expect(h.ctx().interaction).toMatchObject({canMutateHistory: false, canOpenTree: false, canArchive: false, canCreate: false, commands: ["compact", "plan", "mode"]});
        expect(h.ctx().session).toMatchObject({title: "星璃", avatar: "/api/nbook.bots/avatar/lyra"});
        expect(h.host.owner.value).toMatchObject({id: "lyra"});
        expect(h.recent.value).toBe(ownedId);

        await h.host.open(plainId);
        await until("会话档", () => h.ctx().session?.id === plainId && h.ctx().availability.status === "ready");
        expect(h.ctx().interaction).toMatchObject({placement: "wizard", canCreate: true, canArchive: true});
        expect(h.host.owner.value).toBeNull();

        const fresh = await harness(w, {owners});
        fresh.recent.value = ownedId;
        await fresh.host.restore();
        await until("恢复成 bot 档", () => fresh.ctx().session?.id === ownedId && fresh.ctx().interaction.placement === "dock");
    });

    /** 在会话里说一句、等回复；交回日志里计数消息（不带工具调用的回复）的 id 与 seq，按先后。 */
    async function replies(w: AgentWorld, id: string, texts: readonly string[]): Promise<{id: string; seq: number}[]> {
        const session = w.service.session(id);
        for (const text of texts) {
            endpoint.script(text);
            const sent = await session.send({commandId: crypto.randomUUID(), input: {text: "说"}});
            if (!sent.ok || sent.value.runId === null) throw new Error(JSON.stringify(sent));
            await session.waitRun(sent.value.runId);
        }
        return (await session.path()).filter((event) => event.type === "assistant" && (event.data as {toolCalls: unknown[]}).toolCalls.length === 0).map((event) => ({id: event.id, seq: event.seq}));
    }

    test("未读线（conversation.md 输出 55）：只标打开时就未读的回复；“看到”前进、看着时又来的回复都不挪它；markOpened 按此刻重算；普通会话不给", async () => {
        const w = await world();
        const ownedId = await ownedSession(w);
        const [first, second] = await replies(w, ownedId, ["第一句", "第二句"]);
        const seen = shallowRef<number | null>(first!.seq);
        const h = await harness(w, {owners: await ownersFor(w, {}, new Set(), seen)});
        await h.host.open(ownedId);
        await until("线定了", () => h.ctx().dividers?.unreadFrom !== undefined && h.ctx().availability.status === "ready");
        expect(h.ctx().dividers).toEqual({day: true, unreadFrom: second!.id});

        // 自己交的“看到”回来了，看着时又到一句：线不动。
        seen.value = second!.seq;
        endpoint.script("第三句");
        h.host.act({type: "composer.submit", text: "再说", delivery: "prompt"});
        await until("第三句", () => assistants(h.ctx().messages).length === 3);
        expect(h.ctx().dividers).toEqual({day: true, unreadFrom: second!.id});

        // 书房面板重开：按此刻的“看到”重算，都看过了就没有线。
        const third = assistants(h.ctx().messages)[2]!;
        seen.value = (await replies(w, ownedId, [])).find((item) => item.id === third.id)!.seq;
        h.host.markOpened();
        expect(h.ctx().dividers).toEqual({day: true, unreadFrom: null});

        const plainId = (await started(w)).host.sessionId.value!;
        await h.host.open(plainId);
        await until("普通会话", () => h.ctx().session?.id === plainId && h.ctx().availability.status === "ready");
        expect(h.ctx().dividers).toBeUndefined();
    });

    test("未读线：联系人晚到时读到的那一刻拍下基线，之后“看到”前进不改；重试与借用后的重新订阅沿用这次的线；换回来重新定", async () => {
        const w = await world();
        const ownedId = await ownedSession(w);
        const [first, second] = await replies(w, ownedId, ["第一句", "第二句"]);
        const seen = shallowRef<number | null>(null);
        const h = await harness(w, {owners: await ownersFor(w, {}, new Set(), seen)});
        await h.host.open(ownedId);
        await until("读完", () => h.ctx().availability.status === "ready");
        expect(h.ctx().dividers).toEqual({day: true, unreadFrom: null});
        // 联系人读到了；紧接着（同一拍里）自己交的“看到”也回来了：基线是第一次读到的。
        seen.value = first!.seq;
        seen.value = second!.seq;
        expect(h.ctx().dividers).toEqual({day: true, unreadFrom: second!.id});

        // 重试打开的是同一个会话；借用放开满 30 秒再借回来也是：线都还在。
        await h.host.open(ownedId);
        await until("重开", () => h.ctx().availability.status === "ready");
        expect(h.ctx().dividers).toEqual({day: true, unreadFrom: second!.id});
        const give = h.host.borrow();
        give();
        w.settings.clock.advance(RELEASE_DELAY_MS + 1);
        const back = h.host.borrow();
        await until("重新订阅", () => assistants(h.ctx().messages).length === 2 && h.ctx().availability.status === "ready");
        expect(h.ctx().dividers).toEqual({day: true, unreadFrom: second!.id});
        back();
        // 书房面板放开满 30 秒后再打开：借用就地重新订阅，紧接着 markOpened，线按此刻的“看到”重算（都看过了）。
        const giveAgain = h.host.borrow();
        giveAgain();
        w.settings.clock.advance(RELEASE_DELAY_MS + 1);
        const reopened = h.host.borrow();
        h.host.markOpened();
        await until("重开后重算", () => h.ctx().availability.status === "ready" && h.ctx().dividers?.unreadFrom === null);
        reopened();

        const plainId = (await started(w)).host.sessionId.value!;
        await h.host.open(plainId);
        await h.host.open(ownedId);
        await until("换回来", () => h.ctx().session?.id === ownedId && h.ctx().availability.status === "ready" && h.ctx().dividers?.unreadFrom !== undefined);
        expect(h.ctx().dividers).toEqual({day: true, unreadFrom: null});
    });

    test("压缩失败的说法按归属：有归属的会话不提开新会话，普通会话照旧（宿主给适配器的 pinned）", async () => {
        const w = await world();
        const ownedId = await ownedSession(w);
        await replies(w, ownedId, ["第一句", "第二句"]);
        const plainId = (await started(w)).host.sessionId.value!;
        await replies(w, plainId, ["第一句", "第二句"]);
        const h = await harness(w, {owners: await ownersFor(w)});
        const failedKey = async (id: string): Promise<unknown> => {
            await h.host.open(id);
            await until("打开", () => h.ctx().session?.id === id && h.ctx().availability.status === "ready");
            // 压缩模型请求失败一次后重试一次：两次都失败，压缩的运行以 compaction-failed 收口。脚本不多留，免得漏给后面的用例。
            const before = endpoint.requests.length;
            endpoint.script({status: 400}, {status: 400});
            h.host.act({type: "command.run", name: "compact", argsText: ""});
            await until("压缩跑完", () => h.ctx().run.status === "idle" && h.ctx().messages.length > 4);
            expect(endpoint.requests.length - before).toBe(2);
            const failed = h.ctx().messages.filter((message) => message.kind === "system" && message.source === "reminder").at(-1);
            return failed?.kind === "system" ? failed.label : null;
        };
        expect(await failedKey(ownedId)).toMatchObject({key: "kernel.error.compactionFailedPinned"});
        expect(await failedKey(plainId)).toMatchObject({key: "kernel.error.compactionFailed"});
    }, 40_000);

    test("首屏计时（conversation.md 输出 56）：开始时换一个起点，快照与路径应用完再换一个带事件数的；重试换新的，借用后的重新订阅标 reattach", async () => {
        const w = await world();
        const ownedId = await ownedSession(w);
        await replies(w, ownedId, ["第一句"]);
        const h = await harness(w, {owners: await ownersFor(w)});
        const seen: Array<PaintStart | null> = [];
        const stop = watch(h.host.painting, (value) => void seen.push(value), {flush: "sync"});
        const opening = h.host.open(ownedId);
        expect(seen.at(-1)).toMatchObject({sessionId: ownedId, reattach: false, loaded: null});
        const first = seen.at(-1)!;
        await opening;
        const head = (await w.service.session(ownedId).snapshot()).head;
        expect(h.host.painting.value).toEqual({...first, loaded: {events: head}});
        expect(h.ctx().availability.status).toBe("ready");

        // 重试（打开同一个会话）是又一次计时：先换一个新起点，再换成读完的。
        const firstLoaded = h.host.painting.value;
        const before = seen.length;
        await h.host.open(ownedId);
        expect(seen.slice(before).map((value) => value?.loaded ?? null)).toEqual([null, {events: head}]);
        expect(h.host.painting.value).not.toBe(firstLoaded);

        const give = h.host.borrow();
        give();
        w.settings.clock.advance(RELEASE_DELAY_MS + 1);
        const back = h.host.borrow();
        expect(h.host.painting.value).toMatchObject({reattach: true, loaded: null});
        await until("重新订阅读完", () => h.host.painting.value?.loaded !== null);
        back();
        stop();
    });

    test("归属插件读“看到”出错：记诊断，聊天照常打开、不画未读线（归属已知与晚到两条路）", async () => {
        const w = await world();
        const ownedId = await ownedSession(w);
        await replies(w, ownedId, ["第一句"]);
        const owners = await ownersFor(w);
        const reports: string[] = [];
        const broken: SessionOwners = {...owners, seenOf: () => {
            throw new Error("联系人读不了");
        }};
        const h = await harness(w, {owners: broken, report: (code) => void reports.push(code)});
        await h.host.open(ownedId);
        await until("打开了", () => h.ctx().availability.status === "ready");
        expect(h.ctx().dividers).toEqual({day: true, unreadFrom: null});
        expect(reports).toContain("conversation-owner-failed");
        // 归属表里已有（`known`）时在打开的同步段里读：同样不抛出去。
        const again = await harness(w, {owners: broken, report: () => undefined});
        await again.host.open(ownedId);
        await until("又打开了", () => again.ctx().availability.status === "ready");
    });

    test("读不到会话头：记打开失败（可重试）、档位不放宽；恢复时不清最近的会话", async () => {
        const w = await world();
        const ownedId = await ownedSession(w);
        const owners = await ownersFor(w, {}, new Set([ownedId]));
        const h = await harness(w, {owners});
        h.recent.value = ownedId;
        await h.host.restore();
        await until("打开失败", () => h.ctx().availability.status === "load-error");
        expect(h.ctx().interaction).toMatchObject({placement: "dock", canCreate: false, canMutateHistory: false});
        expect(h.recent.value).toBe(ownedId);
    });

    test("编辑区页面的宿主：有归属的会话交给消息视图，不在这里开；没有归属的照常开", async () => {
        const w = await world();
        const ownedId = await ownedSession(w);
        const plainId = (await started(w)).host.sessionId.value!;
        const elsewhere: string[] = [];
        const owners = await ownersFor(w);
        const h = await harness(w, {owners: {...owners, elsewhere: async (id) => void elsewhere.push(id)}});
        await h.host.open(ownedId);
        expect(elsewhere).toEqual([ownedId]);
        expect(h.host.sessionId.value).toBeNull();
        await h.host.open(plainId);
        expect(h.host.sessionId.value).toBe(plainId);
    });

    test("编辑区页面读会话头期间又打开了别的：较早的那次作废，不交出去、不抢界面", async () => {
        const w = await world();
        const ownedId = await ownedSession(w);
        const plainId = (await started(w)).host.sessionId.value!;
        const owners = await ownersFor(w);
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const elsewhere: string[] = [];
        const h = await harness(w, {owners: {...owners, ownerOf: async (id) => {
            if (id === ownedId) await gate;
            return owners.ownerOf(id);
        }, elsewhere: async (id) => void elsewhere.push(id)}});
        const late = h.host.open(ownedId);
        await h.host.open(plainId);
        release();
        await late;
        expect(elsewhere).toEqual([]);
        expect(h.host.sessionId.value).toBe(plainId);
    });

    test("在 bot 的主对话里派出的子会话：会话档；头上祖先路径的根写归属插件给的身份名，不写会话标题", async () => {
        const w = await world();
        const created = await w.service.create({profile: MAIN_PROFILE, owner: {id: "lyra"}});
        if (!created.ok) throw new Error(created.code);
        endpoint.scriptFor("先读一遍", "读完了");
        endpoint.script({tool: "agent_spawn", args: {profile: "nbook.agent.adhoc", prompt: "先读一遍", initial: {role: "设定核对员"}}}, "好");
        const sent = await created.value.send({commandId: crypto.randomUUID(), input: {text: "派"}});
        if (!sent.ok || sent.value.runId === null) throw new Error(JSON.stringify(sent));
        await created.value.waitRun(sent.value.runId);
        const spawned = (await created.value.path()).find((event) => event.type === "toolResult")?.data as {details?: {sessionId?: string}} | undefined;
        const child = spawned?.details?.sessionId;
        if (child === undefined) throw new Error("no child session");
        const h = await harness(w, {owners: await ownersFor(w, {lyra: {name: "星璃"}})});
        await h.host.open(child);
        await until("子会话打开", () => h.ctx().availability.status === "ready" && (h.ctx().session?.path?.length ?? 0) > 0);
        expect(h.ctx().interaction.placement).toBe("wizard");
        expect(h.ctx().session?.path?.[0]).toMatchObject({id: created.value.id, title: "星璃"});
    });

    test("读不到会话头、快照也失败：不论谁后到，恢复都不清最近的会话；会话确实不在了照样清", async () => {
        const w = await world();
        const owners = await ownersFor(w);
        const unreadable: SessionOwners = {...owners, ownerOf: async () => "unreadable"};
        const h = await harness(w, {owners: unreadable});
        h.recent.value = "no-such-session";
        await h.host.restore();
        await until("打开失败", () => h.ctx().availability.status === "load-error");
        expect(h.recent.value).toBe("no-such-session");

        const gone = await harness(w, {owners});
        gone.recent.value = "no-such-session";
        await gone.host.restore();
        expect(gone.recent.value).toBeNull();
        expect(gone.host.sessionId.value).toBeNull();
    });

    test("等审批时输入框上方写会拒绝几项；这时发话一并以拒绝结算，运行接着处理这句话", async () => {
        const w = await world();
        const ownedId = await ownedSession(w);
        const h = await harness(w, {owners: await ownersFor(w)});
        await h.host.open(ownedId);
        await until("打开", () => h.ctx().session?.id === ownedId && h.ctx().availability.status === "ready" && h.ctx().interaction.placement === "dock");
        endpoint.script({tool: "write", args: {path: "session://一.md", content: "内容"}}, "好的，不写了", "收到");
        h.host.act({type: "composer.submit", text: "写个文件", delivery: "prompt"});
        await until("等审批", () => approvals(h.ctx()).length === 1);
        expect(h.ctx().composer.notice).toMatchObject({key: expect.stringContaining("conversation.settleNotice"), params: {count: 1}});
        h.host.act({type: "composer.submit", text: "算了，别写了", delivery: "prompt"});
        await until("审批结算", () => h.ctx().pendingInputs.length === 0);
        await idle(h);
        const page = await h.client.log({sessionId: ownedId, afterSeq: 0});
        if (!page.ok) throw new Error(page.code);
        const resolved = page.value.items.flatMap((item) => (item.kind === "event" && item.event.type === "interactionResolved" ? [item.event.data] : []));
        expect(resolved).toEqual([expect.objectContaining({decision: "deny", note: "用户发了新消息"})]);
        expect(h.ctx().composer.notice).toBeUndefined();
    });

    test("运行中插话（steer）带投递方式与 settlePending，结果未知后的重发带同样的两项；/rename、/fork 不受理", async () => {
        const w = await world();
        const ownedId = await ownedSession(w);
        const base = await harness(w);
        const sends: {commandId: string; mode?: unknown; settlePending?: unknown}[] = [];
        const rewrites: string[] = [];
        let lose = false;
        const flaky = new Proxy(base.client, {get(target, key, receiver) {
            if (key === "setTitle" || key === "fork") return async () => {
                rewrites.push(key);
                return {ok: false, code: "not-used"};
            };
            if (key !== "send") return Reflect.get(target, key, receiver);
            return async (input: {commandId: string; mode?: unknown; settlePending?: unknown}) => {
                sends.push(input);
                if (lose) {
                    lose = false;
                    return {ok: false, code: "unknown-outcome"};
                }
                return target.send(input as never);
            };
        }}) as SessionsClient;
        const h = await harness(w, {remote: flaky, owners: await ownersFor(w)});
        await h.host.open(ownedId);
        await until("打开", () => h.ctx().session?.id === ownedId && h.ctx().availability.status === "ready" && h.ctx().interaction.placement === "dock");
        h.host.act({type: "command.run", name: "rename", argsText: "改名"});
        h.host.act({type: "command.run", name: "fork", argsText: ""});
        endpoint.script({tool: "write", args: {path: "session://二.md", content: "内容"}}, "好的，不写了");
        h.host.act({type: "composer.submit", text: "写个文件", delivery: "prompt"});
        await until("等审批", () => approvals(h.ctx()).length === 1);
        lose = true;
        h.host.act({type: "composer.submit", text: "算了", delivery: "steer"});
        await until("结果未知", () => h.ctx().messages.some((message) => (message as {delivery?: string}).delivery === "unknown"));
        h.host.act({type: "message.resend", messageId: h.ctx().messages.find((message) => (message as {delivery?: string}).delivery === "unknown")!.id});
        await until("审批结算、接着回复", () => h.ctx().pendingInputs.length === 0 && assistants(h.ctx().messages).at(-1)?.text === "好的，不写了");
        await idle(h);
        expect(sends.slice(-2).map((input) => [input.mode, input.settlePending])).toEqual([["steer", "deny"], ["steer", "deny"]]);
        expect(sends.at(-1)!.commandId).toBe(sends.at(-2)!.commandId);
        expect(rewrites).toEqual([]);
    });

    test("恢复在读“最近的会话”时用户点开了别的：让给用户点的，恢复不把它盖掉", async () => {
        const w = await world();
        const recentId = (await started(w)).host.sessionId.value!;
        const otherId = (await started(w)).host.sessionId.value!;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const h = await harness(w, {recent: {read: async () => {
            await gate;
            return recentId;
        }, write: () => undefined}});
        const restoring = h.host.restore();
        const clicked = h.host.open(otherId);
        release();
        await Promise.all([restoring, clicked]);
        expect(h.host.sessionId.value).toBe(otherId);
    });

    test("模式选择器看目录里的 Profile 引用了模式扩展没有：只列了 switch_mode 不显示，引用了就显示", async () => {
        const w = await world();
        const entry = {key: PROFILE, name: "测试", description: "", source: "test", status: "ok" as const, icon: "i-lucide-feather"};
        const without = await started(w, {profiles: () => [{...entry, tools: {required: [...TOOLS, "nbook.agent.switch-mode"], optional: []}}]});
        await until("打开", () => without.ctx().session !== null && without.ctx().availability.status === "ready");
        expect(without.ctx().composer.modes).toEqual([]);
        const withModes = await started(w, {profiles: () => [{...entry, tools: {required: TOOLS, optional: []}, referencedExtensions: [AGENT_MODES_EXTENSION]}]});
        await until("打开", () => withModes.ctx().session !== null && withModes.ctx().availability.status === "ready");
        expect(withModes.ctx().composer.modes.length).toBeGreaterThan(0);
    });
});
