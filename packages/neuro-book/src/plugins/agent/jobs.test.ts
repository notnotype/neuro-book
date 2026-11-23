/**
 * 任务中心（docs/specs/agent/jobs.md）。测试名里的编号是那份 Spec 的输出条目与验收场景。任务的驱动在这里是测试自己写的：任务中心
 * 不认识子会话与进程，驱动只是“怎样停、交回什么文字”的回调；子代理与后台命令的驱动在各自的测试里经真实运行时测。
 */
import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import type {SessionApi} from "@notnotype/nb-harness/kernel/contracts";
import {createAgentHost, createMemoryStore} from "@notnotype/nb-harness/kernel";
import {createTestClock, createTestModel, defaultTestProfile} from "@notnotype/nb-harness/kernel/testing";
import {SessionTable} from "@notnotype/nb-harness/kit/sessions";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {JobCenter, KEPT_PER_OWNER, type Job} from "./backend/jobs/center";
import {watchSteer} from "./backend/jobs/steer";
import {MAIN_PROFILE} from "./shared/contracts";
import {fakeEndpoint, localModelSettings} from "./testing/endpoint";
import type {FakeEndpoint, Scripted} from "./testing/endpoint";
import {agentWorld} from "./testing/world";
import type {AgentWorld} from "./testing/world";

let ids = 0;

function center(limits = {perSession: 8, global: 16}) {
    const clock = createTestClock();
    const jobs = new JobCenter({clock, limits: () => limits, newId: () => `${String((ids += 1)).padStart(12, "0")}`});
    /** 起一个在跑的任务；`kill` 照实把它记成已停止。 */
    const run = (owner: string, kind: "agent" | "shell" = "agent", summary = "活"): Job => {
        const reserved = jobs.reserve(owner, kind, `inv-${String(ids)}`, summary);
        if (!reserved.ok) throw new Error(reserved.code);
        const job = reserved.job;
        jobs.start(job, {kill: async () => jobs.end(job, "aborted", {reason: "aborted"}), result: async () => `${summary}的结果`});
        return job;
    };
    return {clock, jobs, run};
}

const never = new AbortController().signal;

describe("上限", () => {
    test("输出 2：每个会话只数子代理，全局都数；检查中的也占名额，退回后能再派", () => {
        const {jobs, run} = center({perSession: 2, global: 3});
        run("p");
        const second = jobs.reserve("p", "agent", "i", "第二个");
        expect(second.ok).toBe(true);
        expect(jobs.reserve("p", "agent", "i", "第三个")).toEqual({ok: false, code: "concurrency-limit", scope: "session"});
        expect(jobs.reserve("p", "shell", "i", "命令").ok).toBe(true);
        expect(jobs.reserve("q", "shell", "i", "别人的命令")).toEqual({ok: false, code: "concurrency-limit", scope: "global"});
        if (second.ok) jobs.release(second.job);
        expect(jobs.reserve("q", "agent", "i", "退回之后").ok).toBe(true);
    });

    test("检查中的任务不出现在 jobs 里", () => {
        const {jobs} = center();
        jobs.reserve("p", "agent", "i", "还在检查");
        expect(jobs.list("p")).toEqual([]);
    });
});

describe("wait", () => {
    test("场景 2：交回先结束的那个，再等交回另一个，第三次 no-jobs", async () => {
        const {jobs, run} = center();
        const a = run("p", "agent", "甲");
        const b = run("p", "agent", "乙");
        jobs.end(b, "completed", {reason: "completed", line: "乙完成了"});
        const first = await jobs.wait("p", {timeoutMs: 1_000, signal: never});
        expect(first).toMatchObject({kind: "ready", job: {id: b.id}});
        const waiting = jobs.wait("p", {timeoutMs: 1_000, signal: never});
        jobs.end(a, "failed", {reason: "error"});
        expect(await waiting).toMatchObject({kind: "ready", job: {id: a.id}});
        expect(await jobs.wait("p", {timeoutMs: 1_000, signal: never})).toEqual({kind: "failed", code: "no-jobs"});
    });

    test("输出 3：只认自己启动的后台任务；正被前台等着的得 job-foreground", async () => {
        const {jobs, run} = center();
        const mine = run("p");
        const theirs = run("q");
        expect(await jobs.wait("p", {ids: [theirs.id], timeoutMs: 1_000, signal: never})).toEqual({kind: "failed", code: "job-unknown", job: theirs.id});
        jobs.attach(mine);
        expect(await jobs.wait("p", {ids: [mine.id], timeoutMs: 1_000, signal: never})).toEqual({kind: "failed", code: "job-foreground", job: mine.id});
        // 不点名时不等前台的：自己只有这一个，于是没有可等的。
        expect(await jobs.wait("p", {timeoutMs: 1_000, signal: never})).toEqual({kind: "failed", code: "no-jobs"});
    });

    test("输出 3：同一个提问只让 wait 立即返回一次，之后照常等别的", async () => {
        const {clock, jobs, run} = center();
        const asking = run("p", "agent", "问的");
        const other = run("p", "agent", "另一个");
        jobs.question(asking, {id: "q1", text: "要几章？"});
        expect(await jobs.wait("p", {timeoutMs: 1_000, signal: never})).toMatchObject({kind: "ready", job: {id: asking.id}});
        const again = jobs.wait("p", {timeoutMs: 1_000, signal: never});
        jobs.end(other, "completed", {reason: "completed"});
        expect(await again).toMatchObject({kind: "ready", job: {id: other.id}});
        const timeout = jobs.wait("p", {timeoutMs: 1_000, signal: never});
        await clock.advance(1_000);
        expect(await timeout).toMatchObject({kind: "timeout"});
    });

    test("输出 3：插话与中止都提前结束等待，任务不变", async () => {
        const {jobs, run} = center();
        const job = run("p");
        let arrive!: () => void;
        const interrupted = new Promise<void>((resolve) => {
            arrive = resolve;
        });
        const waiting = jobs.wait("p", {timeoutMs: 60_000, signal: never, interrupted});
        arrive();
        expect(await waiting).toMatchObject({kind: "interrupted", jobs: [{id: job.id, state: "running"}]});
        const stop = new AbortController();
        const aborted = jobs.wait("p", {timeoutMs: 60_000, signal: stop.signal});
        stop.abort();
        expect(await aborted).toMatchObject({kind: "aborted"});
        expect(job.state).toBe("running");
    });
});

describe("回执只交一次（jobs.md 的回执）", () => {
    test("两个并发的 wait 不交回同一件：一个拿到，另一个照常等到超时", async () => {
        const {clock, jobs, run} = center();
        const job = run("p");
        const both = Promise.all([jobs.wait("p", {timeoutMs: 1_000, signal: never}), jobs.wait("p", {timeoutMs: 1_000, signal: never})]);
        jobs.end(job, "completed", {reason: "completed"});
        await clock.advance(1_000);
        const kinds = (await both).map((outcome) => outcome.kind).sort();
        expect(kinds).toEqual(["ready", "timeout"]);
    });

    test("被用户停的任务收口时记成用户停的", async () => {
        const {jobs, run} = center();
        const job = run("p");
        expect(await jobs.kill(null, job.id)).toBe("killed");
        expect(job.outcome).toMatchObject({reason: "aborted", byUser: true});
    });
});

describe("插话的到达（输出 3）", () => {
    test("只认就绪的插话：留着的不算；放行出来、仍是插话的算到达", async () => {
        const model = createTestModel();
        const host = createAgentHost({
            store: createMemoryStore(),
            profiles: {resolve: (key) => (key === defaultTestProfile.id ? defaultTestProfile : undefined)},
            models: model.port,
            tools: {declarations: () => [], create: (id) => Promise.reject(new Error(`no tool ${id}`))},
            resources: () => ({read: async () => undefined, resolve: (uri) => uri}),
            sessions: {get: (id) => Promise.reject(new Error(`no session ${id}`))},
            clock: createTestClock(),
            approve: async () => ({verdict: "allow", by: "test-policy"}),
        });
        const table = new SessionTable({host, clock: {schedule: () => () => undefined, now: () => 0}, beforeOpen: async () => undefined, report: (code, message) => {
            throw new Error(`${code}: ${message}`);
        }});
        const created = await table.create({profile: defaultTestProfile.id, id: "p"});
        if (!created.ok) throw new Error(created.code);
        const other = table.view("p", {kind: "host", source: {plugin: "test.other", label: "别的"}});
        const starter = table.view("p", {kind: "host", source: {plugin: "test.starter", label: "开的"}});
        // 空闲时别的宿主排的插话留着；开运行的宿主放行不了它（harness/runtime.md 输出 105）。
        const steer = await other.enqueue({commandId: "c-1", input: {text: "别的插话"}, mode: "steer"});
        if (!steer.ok) throw new Error(steer.code);
        model.script({text: "半句", hold: true});
        expect((await starter.send({commandId: "c-2", input: {text: "开始"}})).ok).toBe(true);
        await waitUntil("在跑", async () => (await table.view("p").snapshot()).status.state === "running");

        let arrived = false;
        const watch = await watchSteer(table, "p", (error) => {
            throw error;
        });
        void watch.arrived.then(() => {
            arrived = true;
        });
        // 走同一条订阅、看得见的一步：开运行的宿主排一条排队，后接上的监听收到它时，前面的监听也已经收到过。
        const seen: string[] = [];
        const after = await table.subscribeOpened("p", {kind: "user"}, (frame) => {
            if (frame.type === "log") seen.push(frame.event.type);
        });
        if (!after.ok) throw new Error(after.code);
        expect((await starter.enqueue({commandId: "c-3", input: {text: "排队的"}, mode: "followup"})).ok).toBe(true);
        await waitUntil("排队的到了", () => seen.includes("inputQueued"));
        await Promise.resolve();
        expect(arrived).toBe(false);

        // 别的宿主放行自己的插话：仍是插话，算到达。
        expect((await other.release({commandId: "c-4", inputIds: [steer.value.inputId]})).ok).toBe(true);
        await watch.arrived;
        watch.release();
        after.release();
        await table.view("p").abort({commandId: "c-5"});
        await table.stop();
    });
});

describe("停止与提前交回", () => {
    test("输出 8：关门之后不再登记新任务，在跑的照常可停", async () => {
        const {jobs, run} = center();
        const job = run("p", "shell");
        jobs.close();
        expect(jobs.reserve("p", "shell", "i", "停止期间的命令")).toEqual({ok: false, code: "unavailable"});
        expect(await jobs.kill(null, job.id)).toBe("killed");
    });

    test("输出 6：前台以中止交回的任务，收口后直接移出，wait 不再交回它", async () => {
        const {jobs, run} = center();
        const aborted = run("p", "agent", "中止的");
        const other = run("p", "agent", "后台的");
        jobs.attach(aborted);
        jobs.settleEarly(aborted);
        jobs.detach(aborted, false);
        jobs.end(aborted, "aborted", {reason: "aborted"});
        expect(jobs.get(aborted.id)).toBeUndefined();
        const waiting = jobs.wait("p", {timeoutMs: 1_000, signal: never});
        jobs.end(other, "completed", {reason: "completed"});
        expect(await waiting).toMatchObject({kind: "ready", job: {id: other.id}});
    });
});

describe("kill 与寿命", () => {
    test("输出 4、11：只停自己的；已结束的说已经结束；用户经远程能停这个会话的任何任务", async () => {
        const {jobs, run} = center();
        const job = run("p");
        expect(await jobs.kill("q", job.id)).toBe("job-unknown");
        expect(await jobs.kill("p", job.id)).toBe("killed");
        expect(job.state).toBe("aborted");
        expect(await jobs.kill("p", job.id)).toBe("already-ended");
        const another = run("p");
        expect(await jobs.kill(null, another.id)).toBe("killed");
    });

    test("输出 6：前台以终态交回就移出；没取过的后台任务每个会话至多留 32 个，先丢最早结束的", async () => {
        const {jobs, run} = center({perSession: 100, global: 100});
        const foreground = run("p");
        jobs.attach(foreground);
        jobs.end(foreground, "completed", {reason: "completed"});
        jobs.detach(foreground, true);
        expect(jobs.get(foreground.id)).toBeUndefined();
        const ended: Job[] = [];
        for (let index = 0; index < KEPT_PER_OWNER + 1; index += 1) {
            const job = run("p");
            jobs.end(job, "completed", {reason: "completed"});
            ended.push(job);
        }
        expect(jobs.get(ended[0]!.id)).toBeUndefined();
        expect(jobs.list("p")).toHaveLength(KEPT_PER_OWNER);
    });
});

// ====================================================================
// 后台命令：真实运行时、真实命令，本机假端点指定模型的调用。
// ====================================================================

describe("后台命令", () => {
    let root = "";
    let endpoint: FakeEndpoint;
    let counter = 0;
    const worlds: AgentWorld[] = [];

    beforeAll(async () => {
        root = await createTestTmpRoot("neuro-book-agent", "jobs");
        endpoint = fakeEndpoint();
    });
    afterEach(async () => {
        endpoint.reset();
        for (const world of worlds.splice(0)) await world.close();
    });
    afterAll(async () => {
        endpoint.stop();
        if (root !== "") await rm(root, {recursive: true, force: true});
    });

    interface Result {
        readonly tool: string;
        readonly text: string;
        readonly status: string;
        readonly code?: string;
        readonly details?: {readonly jobId?: string; readonly output?: string};
    }

    async function open(): Promise<{readonly w: AgentWorld; readonly session: SessionApi; readonly home: string}> {
        counter += 1;
        const w = await agentWorld(join(root, `w${String(counter)}`), {userSettings: {...localModelSettings(endpoint.baseUrl), "nbook.agent/profileSettings": {[MAIN_PROFILE]: {approvalMode: "yolo"}}}});
        worlds.push(w);
        const created = await w.service.create({profile: MAIN_PROFILE});
        if (!created.ok) throw new Error(created.code);
        return {w, session: created.value, home: join(w.stateRoot, "agent", "sessions", created.value.id, "home")};
    }

    async function turn(session: SessionApi, replies: readonly Scripted[]): Promise<void> {
        endpoint.script(...replies);
        const sent = await session.send({commandId: crypto.randomUUID(), input: {text: "做"}});
        if (!sent.ok || sent.value.runId === null) throw new Error(JSON.stringify(sent));
        await session.waitRun(sent.value.runId);
    }

    const results = async (session: SessionApi, tool: string): Promise<Result[]> => (await session.path()).filter((event) => event.type === "toolResult").map((event) => event.data as unknown as Result).filter((data) => data.tool === tool);

    test("输出 7、场景 9：async 立即交回任务 id 与输出文件；wait 取到退出码与输出；status.json；Agent 写不了 jobs/", async () => {
        const {session, home} = await open();
        await turn(session, [{tool: "shell", args: {command: "echo 第一行; echo 完成", async: true}}, {tool: "wait"}, {tool: "write", args: {path: "session://jobs/x.txt", content: "x"}}, "好"]);
        const [started] = await results(session, "nbook.agent.shell");
        const jobId = started!.details!.jobId!;
        expect(started!.details!.output).toBe(`sessions://${session.id}/home/jobs/${jobId}/output.log`);
        expect(started!.text).toContain(jobId);
        // 回执恰好到一次（jobs.md 的回执）：命令在 `wait` 那次请求之前跑完时作为提醒送来，否则由 `wait` 交回。
        const [waited] = await results(session, "nbook.agent.wait");
        const notices = (await session.path()).filter((event) => event.type === "hostNotice").map((event) => (event.data as {text: string}).text);
        const receipts = [waited!.text, ...notices].filter((text) => text.includes("退出码 0"));
        expect(receipts).toHaveLength(1);
        expect(receipts[0]).toContain("第一行\n完成");
        expect(JSON.parse(await readFile(join(home, "jobs", jobId, "status.json"), "utf8"))).toMatchObject({state: "completed", exitCode: 0, lines: 2, truncated: false});
        expect(await readFile(join(home, "jobs", jobId, "output.log"), "utf8")).toBe("第一行\n完成\n");
        expect((await results(session, "nbook.agent.write"))[0]).toMatchObject({status: "error", code: "permission-denied"});
    });

    test("输出 4、7：父会话的运行被中止不影响后台命令；kill 停掉它，回执随下一次请求送来，之后 wait 没有可等的", async () => {
        const {session, home} = await open();
        endpoint.script({tool: "shell", args: {command: "sleep 30", async: true}});
        // 第一个请求交回 `shell` 调用，挂住的是工具结算之后的第二个：这时命令已经转到后台，再中止父会话的运行。
        const first = endpoint.hold();
        const sent = await session.send({commandId: crypto.randomUUID(), input: {text: "跑"}});
        if (!sent.ok || sent.value.runId === null) throw new Error(JSON.stringify(sent));
        await first.arrived;
        const next = endpoint.hold();
        first.release();
        await next.arrived;
        expect((await session.abort({commandId: crypto.randomUUID()})).ok).toBe(true);
        next.release();
        await session.waitRun(sent.value.runId);
        const jobId = (await results(session, "nbook.agent.shell"))[0]!.details!.jobId!;

        await turn(session, [{tool: "jobs"}, {tool: "kill", args: {job: jobId}}, {tool: "wait"}, "好"]);
        expect((await results(session, "nbook.agent.jobs"))[0]!.text).toContain(`${jobId}（命令：sleep 30）运行中`);
        expect((await results(session, "nbook.agent.kill"))[0]!.text).toBe(`已停止 ${jobId}。`);
        // 停掉之后回执作为提醒进了 `kill` 之后的那次请求（jobs.md 的回执），`wait` 不再交回一次。
        const receipt = (await session.path()).find((event) => event.type === "hostNotice");
        expect((receipt?.data as {text?: string} | undefined)?.text).toContain(`命令 ${jobId}：sleep 30｜已停止`);
        expect((await results(session, "nbook.agent.wait"))[0]!.text).toContain("没有可等的任务");
        expect(JSON.parse(await readFile(join(home, "jobs", jobId, "status.json"), "utf8"))).toMatchObject({state: "aborted"});
    });

    /** 一条等测试放行的命令：测试建出 `go` 文件它才结束，不靠固定时长。 */
    const gated = (w: AgentWorld, text: string) => {
        const go = join(w.stateRoot, `go-${String((counter += 1))}`);
        return {command: `while [ ! -f ${go} ]; do sleep 0.05; done; echo ${text}`, release: () => writeFile(go, "")};
    };
    const notices = async (session: SessionApi) => (await session.path()).filter((event) => event.type === "hostNotice").map((event) => (event.data as {text: string}).text);

    test("回执：后台命令在父会话空闲时结束，唤起它，回执恰好进一次请求；账本随之清空", async () => {
        const {w, session} = await open();
        const cmd = gated(w, "做完了");
        await turn(session, [{tool: "shell", args: {command: cmd.command, async: true}}, "好"]);
        const before = endpoint.requests.length;
        await cmd.release();
        await waitUntil("回执送到", async () => (await notices(session)).length === 1);
        await waitUntil("唤起的运行跑完", async () => (await session.snapshot()).status.state === "idle");
        const runs = (await session.log({afterSeq: 0})).events.filter((event) => event.type === "runStarted").map((event) => event.data as {wake?: true; by?: {kind: string}});
        expect(runs.at(-1)).toMatchObject({wake: true, by: {kind: "host"}});
        const asked = endpoint.requests.slice(before).map((request) => JSON.stringify(request.messages));
        expect(asked.filter((text) => text.includes("做完了"))).toHaveLength(1);
        expect((await notices(session))[0]).toContain("退出码 0");
        await waitUntil("账本清空", async () => !(await Bun.file(join(w.stateRoot, "agent", "jobs", "ledger.json")).exists()));
    });

    test("回执：用户停掉的任务照送、不唤起；只有发送方能撤回，用户删不掉；下一句话把它带进请求", async () => {
        const {w, session} = await open();
        await turn(session, [{tool: "shell", args: {command: "sleep 30", async: true}}, "好"]);
        const jobId = (await results(session, "nbook.agent.shell"))[0]!.details!.jobId!;
        const {client} = await w.window("u");
        expect(await client.killJob({sessionId: session.id, jobId})).toMatchObject({ok: true});
        await waitUntil("回执待发", async () => (await session.snapshot()).notices.length === 1);
        const snapshot = await session.snapshot();
        expect(snapshot.notices[0]).toMatchObject({senderOnly: true, wake: false});
        expect(snapshot.notices[0]!.text).toContain("被用户停止");
        expect(snapshot.status.state).toBe("idle");
        expect((await session.log({afterSeq: 0})).events.filter((event) => event.type === "runStarted")).toHaveLength(1);
        expect(await client.removeNotice({sessionId: session.id, commandId: crypto.randomUUID(), noticeId: snapshot.notices[0]!.id})).toMatchObject({ok: false, code: "not-allowed"});
        await turn(session, ["收到"]);
        expect(JSON.stringify(endpoint.requests.at(-1)!.messages)).toContain("被用户停止");
    });

    test("回执：模型在生成要调 wait 的那条回复时任务结束，wait 撤回待发的回执自己交回（审查第 1 条）", async () => {
        const {w, session} = await open();
        const cmd = gated(w, "好了");
        endpoint.script({tool: "shell", args: {command: cmd.command, async: true}}, {tool: "wait"}, "收到");
        const first = endpoint.hold();
        const sent = await session.send({commandId: crypto.randomUUID(), input: {text: "跑"}});
        if (!sent.ok || sent.value.runId === null) throw new Error(JSON.stringify(sent));
        await first.arrived;
        const generating = endpoint.hold();
        first.release();
        await generating.arrived;
        await cmd.release();
        await waitUntil("回执待发", async () => (await session.snapshot()).notices.length === 1);
        generating.release();
        await session.waitRun(sent.value.runId);
        expect((await results(session, "nbook.agent.wait"))[0]!.text).toContain("好了");
        expect(await notices(session)).toEqual([]);
        const removed = (await session.log({afterSeq: 0})).events.filter((event) => event.type === "noticeRemoved").map((event) => event.data);
        expect(removed).toEqual([expect.objectContaining({reason: "withdrawn"})]);
    });

    test("回执：插件停止时在跑的后台命令记进账本，同一个状态根再起时补发“回执没来得及送出”，不唤起，账本清空", async () => {
        counter += 1;
        const dir = join(root, `ledger-${String(counter)}`);
        const settings = {...localModelSettings(endpoint.baseUrl), "nbook.agent/profileSettings": {[MAIN_PROFILE]: {approvalMode: "yolo"}}};
        const first = await agentWorld(dir, {userSettings: settings});
        const created = await first.service.create({profile: MAIN_PROFILE});
        if (!created.ok) throw new Error(created.code);
        await turn(created.value, [{tool: "shell", args: {command: "sleep 30", async: true}}, "好"]);
        await first.close();
        const ledger = join(first.stateRoot, "agent", "jobs", "ledger.json");
        expect(JSON.parse(await readFile(ledger, "utf8"))).toEqual([expect.objectContaining({owner: created.value.id, state: "interrupted"})]);
        const second = await agentWorld(dir, {userSettings: settings});
        worlds.push(second);
        const session = second.service.session(created.value.id);
        await waitUntil("补发的回执", async () => (await session.snapshot()).notices.some((item) => item.text.includes("回执没来得及送出")));
        expect((await session.snapshot()).status.state).toBe("idle");
        await waitUntil("账本清空", async () => !(await Bun.file(ledger).exists()));
    });

    test("输出 8：插件停止时在跑的后台命令按 interrupted 收口，status.json 照写", async () => {
        const {w, session, home} = await open();
        await turn(session, [{tool: "shell", args: {command: "sleep 30", async: true}}, "好"]);
        const jobId = (await results(session, "nbook.agent.shell"))[0]!.details!.jobId!;
        worlds.splice(worlds.indexOf(w), 1);
        await w.close();
        expect(JSON.parse(await readFile(join(home, "jobs", jobId, "status.json"), "utf8"))).toMatchObject({state: "interrupted"});
    });
});
