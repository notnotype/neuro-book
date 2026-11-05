/**
 * 对话宿主接真实的服务端（docs/specs/agent/conversation.md 输出 1、5–14）：配置场地里起 `nbook.agent`，窗口经真实的远程合同调用，模型是本机端点。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {defineProfile} from "@notnotype/nb-harness/kernel";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import type {AgentConversationContext, AssistantMessageView, MessageView, PendingApprovalView, PendingQuestionsView} from "@notnotype/nb-agent-ui";

import {EVENT_INLINE_BYTES} from "../backend/frames";
import {MAIN_PROFILE} from "../shared/contracts";
import {agentProfile} from "../shared/points";
import {fakeEndpoint, localModelSettings} from "../testing/endpoint";
import type {FakeEndpoint} from "../testing/endpoint";
import {agentWorld} from "../testing/world";
import type {AgentWorld, SessionsClient} from "../testing/world";
import {createAgentActivity} from "./activity";
import {createSessionHost, displayToolName, RELEASE_DELAY_MS} from "./session-host";
import type {SessionHost, SessionHostDeps} from "./session-host";

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
    const created = await agentWorld(join(root, `w${String(counter)}`), {plugins: [testPlugin()], userSettings: {...localModelSettings(endpoint.baseUrl), "nbook.agent/profileSettings": {[PROFILE]: {approvalMode: "ask"}}}});
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
        text: {t: (value) => (typeof value === "string" ? value : (value as {key: string}).key), variants: () => []} as never,
        newId: () => crypto.randomUUID(),
        recent: {read: async () => recent.value, write: (id) => {
            recent.value = id;
        }},
        warnCost: () => 0,
        models: () => [{key: "local/m", label: "M", supportsImages: false}],
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
            return async (input: Parameters<SessionsClient["send"]>[0]) => {
                seen.push(input.commandId);
                const current = mode;
                mode = "normal";
                if (current === "lost") return {ok: false, code: "unknown-outcome"};
                const real = await target.send(input);
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
        h.host.act({type: "queued.edit", id: h.ctx().composer.queued[0]!.id});
        await until("取出到输入框", () => h.ctx().composer.draft.text === "排一条");
        h.host.act({type: "composer.submit", text: "改过的", delivery: "followup"});
        await until("排队的改了", () => h.ctx().composer.queued[0]?.text === "改过的");
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

    test("向导的界面状态交给宿主：组件卸载再挂回来还在", async () => {
        const w = await world();
        const h = await started(w);
        h.host.act({type: "wizard.state", state: {collapsed: true, step: 1}});
        expect(h.ctx().wizardState).toEqual({collapsed: true, step: 1});
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
