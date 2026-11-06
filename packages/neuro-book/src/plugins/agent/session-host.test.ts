/**
 * 对话宿主接真实的服务端（docs/specs/agent/conversation.md 输出 1、5–14）：配置场地里起 `nbook.agent`，窗口经真实的远程合同调用，模型是本机端点。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {defineProfile} from "@notnotype/nb-harness/kernel";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {shallowRef} from "vue";
import {RELOAD_DELAY_MS} from "nbook/plugins/settings/backend/layer-owner";
import type {AgentConversationContext, AssistantMessageView, ComposerModelView, MessageView, PendingApprovalView, PendingQuestionsView} from "@notnotype/nb-agent-ui";

import {EVENT_INLINE_BYTES} from "./backend/frames";
import {MAIN_PROFILE} from "./shared/contracts";
import {agentProfile} from "./shared/points";
import {fakeEndpoint, localModelSettings} from "./testing/endpoint";
import type {FakeEndpoint} from "./testing/endpoint";
import {agentWorld} from "./testing/world";
import type {AgentWorld, SessionsClient} from "./testing/world";
import {createAgentActivity} from "./web/activity";
import {createSessionHost, displayToolName, RELEASE_DELAY_MS} from "./web/session-host";
import type {SessionHost, SessionHostDeps} from "./web/session-host";

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
const TOOLS = ["read", "write", "edit", "shell", "ask-form"].map((name) => `nbook.agent.${name}`);

function testPlugin(): PluginDefinition {
    const profile = agentProfile(PROFILE, {name: "测试", description: "测试用", icon: "i-lucide-feather", tools: {required: TOOLS, optional: []}});
    return {id: "test.sh", entries: [defineEntry({
        id: "server",
        location: "server",
        activationEvents: ["onStartup", profile.activationEvent],
        contributions: [profile.contribution],
        activate: () => ({contributions: {"agent.profiles": {[PROFILE]: defineProfile({id: PROFILE, version: "1", name: PROFILE, description: "测试用", system: "测试。", tools: {required: TOOLS}})}}}),
    })]};
}

async function world(): Promise<AgentWorld> {
    counter += 1;
    const created = await agentWorld(join(root, `w${String(counter)}`), {plugins: [testPlugin()], userSettings: {...localModelSettings(endpoint.baseUrl, {compactionRole: true}), "nbook.agent/profileSettings": {[PROFILE]: {approvalMode: "ask"}}}});
    worlds.push(created);
    return created;
}

interface Harness {
    readonly host: SessionHost;
    readonly client: SessionsClient;
    readonly recent: {value: string | null};
    readonly copied: string[];
    readonly settingsOpened: {count: number};
    ctx(): AgentConversationContext;
}

let windows = 0;
async function harness(w: AgentWorld, overrides: Partial<SessionHostDeps> = {}): Promise<Harness> {
    windows += 1;
    const {client} = await w.window(`sh-${String(windows)}`);
    const recent = {value: null as string | null};
    const copied: string[] = [];
    const settingsOpened = {count: 0};
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
        models: () => [{key: "local/m", label: "M", supportsImages: false}],
        roles: () => null,
        drafts: {read: async () => null, write: () => undefined},
        profiles: () => [{key: PROFILE, name: "测试", description: "", source: "test", status: "ok", icon: "i-lucide-feather"}],
        copy: (value) => void copied.push(value),
        openSettings: () => {
            settingsOpened.count += 1;
        },
        openAddress: () => undefined,
        openLink: () => undefined,
        report: (code, message) => {
            throw new Error(`host reported ${code}: ${message}`);
        },
        ...overrides,
    });
    hosts.push(host);
    return {host, client, recent, copied, settingsOpened, ctx: () => host.ctx.value};
}

const assistants = (messages: readonly MessageView[]) => messages.filter((message): message is AssistantMessageView => message.kind === "assistant");
const until = <T>(what: string, check: () => T | Promise<T>) => waitUntil(what, check, {timeoutMs: 15_000});
const idle = (h: Harness) => until("运行结束", () => h.ctx().run.status === "idle");
const approvals = (ctx: AgentConversationContext) => ctx.pendingInputs.filter((item): item is PendingApprovalView => item.kind === "approval");

async function started(w: AgentWorld): Promise<Harness> {
    const h = await harness(w);
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

describe("审批与提问（输出 10–14）", () => {
    test("一条回复的一批：都进向导；预览取到；批准与拒绝（附言）各走各的；模型收到附言", async () => {
        const w = await world();
        const h = await started(w);
        endpoint.script({tools: [{tool: "write", args: {path: "session://一.md", content: "一的内容"}}, {tool: "write", args: {path: "session://二.md", content: "二的内容"}}, {tool: "shell", args: {command: "true"}}]}, "处理完了");
        h.host.act({type: "composer.submit", text: "写两个文件", delivery: "prompt"});
        await until("三个审批", () => approvals(h.ctx()).length === 3);
        await until("预览", () => approvals(h.ctx()).every((item) => item.preview.state === "ready"));
        expect(h.ctx().run.status).toBe("waiting");
        const [first, second, third] = approvals(h.ctx());
        expect(first).toMatchObject({tool: "write", preview: {files: [{kind: "diff", before: "", after: "一的内容"}]}});
        expect(third).toMatchObject({tool: "shell", args: {command: "true"}, preview: {files: []}});

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

        h.host.act({type: "input.submit", batchKey: approvals(h.ctx())[0]!.id, resolutions: {kind: "approval", decision: "allow"}});
        await until("这一批答完", () => h.ctx().wizardState === undefined);
        await until("下一批", () => approvals(h.ctx()).length === 1);
        expect(h.ctx().wizardState).toBeUndefined();
        h.host.act({type: "input.submit", batchKey: approvals(h.ctx())[0]!.id, resolutions: {kind: "approval", decision: "allow"}});
        await idle(h);
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
        expect(h.ctx().interaction.triggers).toEqual(["@", "/"]);

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
        await until("说明不确定", () => seen.length === before + 1 && h.ctx().composer.notice !== undefined);
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
        fresh.host.act({type: "availability.act", action: "open-settings"});
        expect(fresh.settingsOpened.count).toBe(1);
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
    test("组件都还回去之后等 30 秒才取消订阅；期间借回来不重新打开；之后借回来重新打开同一个", async () => {
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
        const back = h.host.borrow();
        await until("重新打开", () => assistants(h.ctx().messages).length === 1);
        back();
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
        expect(h.ctx().interaction.commands).toEqual(["compact", "new", "fork", "rename", "model"]);
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
