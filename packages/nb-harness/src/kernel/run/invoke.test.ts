/**
 * 工具里调工具（嵌套调用）。测试名里的编号是 docs/specs/harness/runtime.md 的输出条目与验收场景。
 * 父工具是一个声明了 `invokes` 的测试工具，它要做的事由每个用例给的 `program` 决定（eval 在应用里就是这样用它的）。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import type {ApproveHook, InteractionSummary, LogEvent, NestedOutcome, ToolContext} from "../api/index.js";
import {mapEventContent} from "../helpers/content.js";
import {createTestClock} from "../testing/clock.js";
import {createTestSession, type TestSession, type TestTool} from "../testing/test-session.js";
import {ABORT_GRACE_MS, INVOKE_LIMIT} from "./tools.js";

let root = "";
beforeAll(async () => {
    root = await createTestTmpRoot("nb-harness", "kernel-invoke");
});
afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

function gate<T = void>() {
    let open!: (value: T) => void;
    const promise = new Promise<T>((resolve) => {
        open = resolve;
    });
    return {promise, open};
}

let commands = 0;
const id = () => `n-${(commands += 1)}`;
const dataOf = <T = Record<string, unknown>>(events: readonly LogEvent[], type: string) => events.filter((event) => event.type === type).map((event) => event.data as T);

/** 父工具：执行 `program`，把它交回的文字当结果。 */
let program: (ctx: ToolContext) => Promise<string> = async () => "";
const code: TestTool = {id: "lab.code", invokes: true, execute: (_args, ctx) => program(ctx)};
const reader = (extra: Partial<TestTool> = {}): TestTool => ({id: "lab.read", concurrency: "shared", effect: "read", execute: (args) => `读到 ${String(args.path)}`, ...extra});
const writer = (extra: Partial<TestTool> = {}): TestTool => ({id: "lab.write", effect: "write", execute: (args) => `写好 ${String(args.path)}`, ...extra});

const askForWrites: ApproveHook = async (_call, info) => (info.effect === "read" ? {verdict: "allow", by: "rule:read"} : {verdict: "ask", reason: "会改文件"});

/** 等运行进 waiting、有 `count` 个待处理事项。 */
function waitingFor(session: TestSession, count: number): Promise<InteractionSummary[]> {
    return new Promise((resolve) => {
        const check = (status: {state: string; pending?: InteractionSummary[]}) => {
            if (status.state === "waiting" && status.pending!.length === count) {
                stop();
                resolve(status.pending!);
            }
        };
        const stop = session.raw.subscribe((frame) => {
            if (frame.type === "status") check(frame.status);
        });
        void session.raw.snapshot().then((snapshot) => check(snapshot.status));
    });
}

async function sendRaw(session: TestSession, text: string): Promise<string> {
    const sent = await session.raw.send({commandId: id(), input: {text}});
    if (!sent.ok || sent.value.runId === null) throw new Error("send did not start a run");
    return sent.value.runId;
}

const summary = (outcome: NestedOutcome) => [outcome.status, outcome.code ?? null];

describe("嵌套调用", () => {
    test("输出 90、91、96、97：代码并发调两个 shared 工具；嵌套调用有自己的身份与来源、拿不到 invoke；事件都在父调用的结果之前，请求里只有父调用的结果", async () => {
        const seen: Array<{callId: string; within: unknown; canInvoke: boolean}> = [];
        program = async (ctx) => {
            const [a, b] = await Promise.all([ctx.invoke!("lab.read", {path: "一.md"}), ctx.invoke!("lab.read", {path: "二.md"})]);
            return `读了两章：${a.status}、${b.status}`;
        };
        await using session = await createTestSession({tools: [code, reader({execute: (args, ctx) => {
            seen.push({callId: ctx.callId, within: ctx.within, canInvoke: ctx.invoke !== undefined});
            return `读到 ${String(args.path)}`;
        }})]});
        session.model.script({tools: [{tool: "lab.code"}]}, "完成");
        const {events} = await session.say("批量读");
        const parent = dataOf<{callId: string; invocation: string}>(events, "toolStarted")[0]!;
        expect(seen.map((item) => item.within)).toEqual([{tool: "lab.code", invocation: parent.invocation}, {tool: "lab.code", invocation: parent.invocation}]);
        expect(seen.every((item) => !item.canInvoke && item.callId !== parent.callId)).toBe(true);
        expect(new Set(seen.map((item) => item.callId)).size).toBe(2);

        const order = events.map((event) => event.type).filter((type) => type === "nestedToolStarted" || type === "nestedToolResult" || type === "toolResult");
        expect(order.slice(-1)).toEqual(["toolResult"]);
        expect(order.filter((type) => type === "nestedToolResult")).toHaveLength(2);
        const results = dataOf<{id: string; status: string; preview: string; args: unknown}>(events, "nestedToolResult");
        expect(results.map((item) => [item.status, item.preview]).sort()).toEqual([["ok", "读到 一.md"], ["ok", "读到 二.md"]]);
        expect(new Set(results.map((item) => item.id))).toEqual(new Set(seen.map((item) => item.callId)));

        // 请求里只有父调用的结果：嵌套调用读到的正文没进下一次请求。
        const next = JSON.stringify(session.requests[1]!.raw);
        expect(next).toContain("读了两章");
        expect(next).not.toContain("读到 一.md");

        // 出站过滤走到嵌套调用的参数与预览。
        const nested = events.find((event) => event.type === "nestedToolResult")!;
        const mapped = await mapEventContent(nested, {text: (text) => text.replaceAll("读到", "■")});
        expect((mapped?.data as {preview: string}).preview).toMatch(/^■ /u);
    });

    test("输出 92：不在工具集、收尾工具、声明了 invokes 的、codeCallable: false 的、参数不是 JSON 的都不执行，各有一条结果、没有开始的记录", async () => {
        program = async (ctx) => {
            const outcomes = [
                await ctx.invoke!("lab.nope", {}),
                await ctx.invoke!("lab.done", {}),
                await ctx.invoke!("lab.code", {}),
                await ctx.invoke!("lab.todo", {}),
                await ctx.invoke!("lab.read", {n: Number.NaN}),
                await ctx.invoke!("lab.read", {m: new Map()} as unknown as Record<string, unknown>),
            ];
            return JSON.stringify(outcomes.map(summary));
        };
        await using session = await createTestSession({tools: [code, reader(), {id: "lab.done", finish: true, execute: () => "完"}, {id: "lab.todo", codeCallable: false, execute: () => "记下了"}]});
        session.model.script({tools: [{tool: "lab.code"}]}, "完成");
        const {events} = await session.say("试");
        expect(JSON.parse(dataOf<{text: string}>(events, "toolResult")[0]!.text)).toEqual([
            ["error", "unknown-tool"],
            ["error", "invoke-not-allowed"],
            ["error", "invoke-not-allowed"],
            ["error", "invoke-not-allowed"],
            ["error", "invalid-arguments"],
            ["error", "invalid-arguments"],
        ]);
        expect(dataOf(events, "nestedToolStarted")).toEqual([]);
        expect(dataOf<{tool: string}>(events, "nestedToolResult").map((item) => item.tool)).toEqual(["lab.nope", "lab.done", "lab.code", "lab.todo", "lab.read", "lab.read"]);
    });

    test("输出 93：只走代码的工具不进请求的工具清单；模型直接调它得 code-only，代码里调得到；加进来时不写 tools-changed", async () => {
        const page: TestTool = {id: "lab.page", global: {object: "page", method: "read"}, execute: () => "页面快照"};
        let withPage = false;
        program = async (ctx) => (await ctx.invoke!("lab.page", {})).text;
        // 模型直接调它时审批会问：不执行的调用不该先问用户（它不进审批阶段）。
        const approve: ApproveHook = async (call, info) => (call.tool === "lab.page" && info.within === undefined ? {verdict: "ask", reason: "不该问到这里"} : {verdict: "allow", by: "rule"});
        await using session = await createTestSession({approve, tools: () => (withPage ? [code, page] : [code])});
        session.model.script("先聊", {tools: [{tool: "lab.page"}]}, {tools: [{tool: "lab.code"}]}, "完成");
        await session.say("先聊");
        withPage = true;
        const {events, requests} = await session.say("看页面");
        for (const request of requests) {
            expect(JSON.stringify(request.raw.tools ?? [])).not.toContain("lab.page");
            expect(JSON.stringify(request.raw.tools ?? [])).not.toContain("lab__page");
        }
        expect(dataOf<{tool: string; code?: string; text: string}>(events, "toolResult").map((item) => [item.tool, item.code ?? null])).toEqual([["lab.page", "code-only"], ["lab.code", null]]);
        expect(dataOf<{text: string}>(events, "toolResult")[1]!.text).toBe("页面快照");
        const all = await session.events();
        expect(dataOf(all, "interactionRequested")).toEqual([]);
        expect(dataOf(all, "toolsAnnounced")).toHaveLength(2);
        expect(dataOf<{code: string}>(all, "notice").filter((item) => item.code === "tools-changed")).toEqual([]);
    });

    test("输出 94：嵌套调用要审批时当场问，事项带来源；等的前后告诉父工具；拒绝之后代码照样往下走", async () => {
        const waiting: boolean[] = [];
        program = async (ctx) => {
            const outcome = await ctx.invoke!("lab.write", {path: "正文.md"}, {onWaiting: (value) => waiting.push(value)});
            return `写：${outcome.status} ${outcome.code ?? ""}`;
        };
        await using session = await createTestSession({approve: askForWrites, tools: [code, writer()]});
        session.model.script({tools: [{tool: "lab.code"}]}, "完成");
        const runId = await sendRaw(session, "写");
        const [pending] = await waitingFor(session, 1);
        expect(waiting).toEqual([true]);
        const requested = dataOf<{id: string; callId: string; within: unknown; request: {tool: string}}>(await session.events(), "interactionRequested")[0]!;
        const parent = dataOf<{invocation: string}>(await session.events(), "toolStarted")[0]!;
        expect(requested.within).toEqual({tool: "lab.code", invocation: parent.invocation});
        expect(requested.request.tool).toBe("lab.write");
        await session.raw.resolve({commandId: id(), id: pending!.id, decision: "deny", note: "先别改"});
        await session.raw.waitRun(runId);
        expect(waiting).toEqual([true, false]);
        const events = await session.events();
        expect(dataOf<{text: string}>(events, "toolResult")[0]!.text).toBe("写：denied user-denied");
        expect(dataOf<{id: string; status: string; args: unknown}>(events, "nestedToolResult")).toEqual([expect.objectContaining({id: requested.callId, status: "denied", args: {path: "正文.md"}})]);
    });

    test("输出 90：嵌套调用经 waitingForUser 自报等用户：promise 结算时收回；永不结算的在调用结算时收回；被取消时收回且只报一次", async () => {
        const log: string[] = [];
        const answered = gate<string>();
        const started = {settles: gate(), cancelled: gate()};
        // 被取消的那次：工具看到取消之后还要等它才交回，用来区分“取消时收回”与“结算时收回”。
        const release = gate();
        program = async (ctx) => {
            const track = (name: string) => ({onWaiting: (value: boolean) => void log.push(`${name} ${String(value)}`)});
            const settles = ctx.invoke!("lab.wait", {mode: "settles"}, track("settles"));
            await started.settles.promise;
            log.push("答之前");
            answered.open("答了");
            const first = await settles;
            const forgotten = await ctx.invoke!("lab.wait", {mode: "forgotten"}, track("forgotten"));
            const stop = new AbortController();
            const cancelled = ctx.invoke!("lab.wait", {mode: "cancelled"}, {...track("cancelled"), signal: stop.signal});
            await started.cancelled.promise;
            stop.abort();
            log.push("停之后");
            release.open();
            const third = await cancelled;
            return JSON.stringify([first.text, forgotten.text, summary(third)]);
        };
        await using session = await createTestSession({tools: [code, {id: "lab.wait", effect: "read", execute: async (args, ctx) => {
            if (args.mode === "settles") {
                const waited = ctx.waitingForUser!(answered.promise);
                started.settles.open();
                return await waited;
            }
            if (args.mode === "forgotten") {
                // 提供方忘了收回：永不结算的等待。
                void ctx.waitingForUser!(new Promise<never>(() => undefined));
                return "交回了";
            }
            const never = ctx.waitingForUser!(new Promise<never>(() => undefined));
            started.cancelled.open();
            await Promise.race([never, new Promise((resolve) => ctx.signal.addEventListener("abort", resolve, {once: true}))]);
            await release.promise;
            return "停了";
        }}]});
        session.model.script({tools: [{tool: "lab.code"}]}, "完成");
        const {events} = await session.say("等");
        expect(dataOf<{text: string}>(events, "toolResult")[0]!.text).toBe(JSON.stringify(["答了", "交回了", ["ok", null]]));
        expect(log).toEqual(["settles true", "答之前", "settles false", "forgotten true", "forgotten false", "cancelled true", "cancelled false", "停之后"]);
    });

    test("输出 98：经 waitingForUser 等用户期间仍占着并发名额：之后的 exclusive 调用等它结束", async () => {
        const order: string[] = [];
        const answered = gate();
        const waiting = gate();
        program = async (ctx) => {
            const first = ctx.invoke!("lab.wait", {});
            await waiting.promise;
            const write = ctx.invoke!("lab.write", {path: "c"});
            await new Promise<void>((resolve) => setImmediate(resolve));
            order.push("答");
            answered.open();
            await Promise.all([first, write]);
            return order.join(" ");
        };
        await using session = await createTestSession({tools: [code, {id: "lab.wait", effect: "read", execute: async (_args, ctx) => {
            const waited = ctx.waitingForUser!(answered.promise);
            waiting.open();
            await waited;
            order.push("等完");
            return "好";
        }}, writer({execute: () => {
            order.push("写");
            return "c";
        }})]});
        session.model.script({tools: [{tool: "lab.code"}]}, "完成");
        const {events} = await session.say("锁");
        expect(dataOf<{text: string}>(events, "toolResult")[0]!.text).toBe("答 等完 写");
    });

    test("输出 98：同一个父调用里 shared 的并发，exclusive 的等它们都结束、独占执行", async () => {
        const order: string[] = [];
        const started = {a: gate(), b: gate()};
        const finish = {a: gate(), b: gate()};
        program = async (ctx) => {
            const reads = [ctx.invoke!("lab.read", {path: "a"}), ctx.invoke!("lab.read", {path: "b"})];
            await Promise.all([started.a.promise, started.b.promise]);
            const write = ctx.invoke!("lab.write", {path: "c"});
            finish.b.open();
            finish.a.open();
            await Promise.all([...reads, write]);
            return order.join(" ");
        };
        await using session = await createTestSession({tools: [code, reader({execute: async (args) => {
            const name = String(args.path) as "a" | "b";
            order.push(`start ${name}`);
            started[name].open();
            await finish[name].promise;
            order.push(`end ${name}`);
            return name;
        }}), writer({execute: () => {
            order.push("write");
            return "c";
        }})]});
        session.model.script({tools: [{tool: "lab.code"}]}, "完成");
        const {events} = await session.say("并发");
        expect(dataOf<{text: string}>(events, "toolResult")[0]!.text).toBe("start a start b end b end a write");
    });

    test("输出 98：排队等 exclusive 的调用被代码取消：它不再挡着排在后面的 shared", async () => {
        const started = {a: gate(), b: gate()};
        const finishA = gate();
        // 让已发起的调用走完判定、排进队列：从发起到排队之间只有微任务。
        const queued = () => new Promise<void>((resolve) => setImmediate(resolve));
        program = async (ctx) => {
            const a = ctx.invoke!("lab.read", {path: "a"});
            await started.a.promise;
            const stop = new AbortController();
            const write = ctx.invoke!("lab.write", {path: "c"}, {signal: stop.signal});
            await queued();
            const b = ctx.invoke!("lab.read", {path: "b"});
            await queued();
            stop.abort();
            // a 还占着锁：b 能开始，说明取消的 exclusive 已经出队。
            await started.b.promise;
            finishA.open();
            return JSON.stringify([summary(await a), summary(await write), summary(await b)]);
        };
        await using session = await createTestSession({tools: [code, reader({execute: async (args) => {
            const name = String(args.path) as "a" | "b";
            started[name].open();
            if (name === "a") await finishA.promise;
            return name;
        }}), writer()]});
        session.model.script({tools: [{tool: "lab.code"}]}, "完成");
        const {events} = await session.say("取消");
        expect(dataOf<{text: string}>(events, "toolResult")[0]!.text).toBe(JSON.stringify([["ok", null], ["denied", "aborted"], ["ok", null]]));
    });

    test("输出 92：批准之后在排队等锁时会话改成只读，写调用不执行", async () => {
        const ran: string[] = [];
        const startedA = gate();
        const finishA = gate();
        program = async (ctx) => {
            const a = ctx.invoke!("lab.read", {path: "a"});
            await startedA.promise;
            const write = await ctx.invoke!("lab.write", {path: "c"});
            await a;
            return JSON.stringify(summary(write));
        };
        await using session = await createTestSession({approve: askForWrites, tools: [code, reader({execute: async () => {
            startedA.open();
            await finishA.promise;
            return "a";
        }}), writer({execute: () => {
            ran.push("write");
            return "c";
        }})]});
        session.model.script({tools: [{tool: "lab.code"}]}, "完成");
        const runId = await sendRaw(session, "写");
        const [pending] = await waitingFor(session, 1);
        await session.raw.resolve({commandId: id(), id: pending!.id, decision: "allow"});
        // 批准了，写调用排在还没读完的 a 后面；这时改成只读，再让 a 读完。
        await session.raw.changeSettings({commandId: id(), patch: {core: {readOnly: true}}});
        finishA.open();
        await session.raw.waitRun(runId);
        expect(ran).toEqual([]);
        const events = await session.events();
        expect(dataOf<{text: string}>(events, "toolResult")[0]!.text).toBe(JSON.stringify(["denied", "read-only"]));
        expect(dataOf(events, "nestedToolStarted").map((data) => data.tool)).toEqual(["lab.read"]);
    });

    test("输出 99：一个父调用至多 2,000 个嵌套调用", async () => {
        program = async (ctx) => {
            for (let index = 0; index < INVOKE_LIMIT; index += 1) await ctx.invoke!("lab.read", {path: `${String(index)}.md`});
            return JSON.stringify(summary(await ctx.invoke!("lab.read", {path: "多出来的.md"})));
        };
        await using session = await createTestSession({tools: [code, reader()]});
        session.model.script({tools: [{tool: "lab.code"}]}, "完成");
        const {events} = await session.say("循环");
        expect(dataOf<{text: string}>(events, "toolResult")[0]!.text).toBe(JSON.stringify(["error", "invoke-limit"]));
    }, 30_000);

    test("输出 100：父调用交回时还有没 await 的嵌套调用：按宽限期结算，结果写在父调用的结果之前；之后再调得 parent-finished", async () => {
        const clock = createTestClock();
        const slowStarted = gate();
        const slowStopped = gate();
        const release = gate();
        let kept: ToolContext["invoke"];
        program = async (ctx) => {
            kept = ctx.invoke;
            void ctx.invoke!("lab.slow", {});
            await slowStarted.promise;
            return "先交了";
        };
        await using session = await createTestSession({clock, tools: [code, {id: "lab.slow", execute: async (_args, ctx) => {
            // 父调用交回时这次调用收到中止；宽限期的计时在中止时同步登记，测试等到这里再推时钟。
            ctx.signal.addEventListener("abort", () => slowStopped.open(), {once: true});
            slowStarted.open();
            await release.promise;
            return "慢的完了";
        }}]});
        session.model.script({tools: [{tool: "lab.code"}]}, "完成");
        const runId = await sendRaw(session, "跑");
        await slowStopped.promise;
        await clock.advance(0);
        await clock.advance(ABORT_GRACE_MS);
        await session.raw.waitRun(runId);
        release.open();
        const events = await session.events();
        const order = events.map((event) => event.type).filter((type) => type === "nestedToolResult" || type === "toolResult");
        expect(order).toEqual(["nestedToolResult", "toolResult"]);
        expect(dataOf<{status: string; code: string}>(events, "nestedToolResult").map((item) => [item.status, item.code])).toEqual([["unknown", "aborted"]]);
        expect(summary(await kept!("lab.slow", {}))).toEqual(["error", "parent-finished"]);
    });

    /** 崩溃夹具（tests/kernel/fixtures/crash-session.ts）：子进程停在指定的时刻，宣布之后被 kill -9。 */
    async function crash(mode: "nested-approval" | "nested-running"): Promise<{store: {root: string}; open: string}> {
        const dir = join(root, mode);
        const child = Bun.spawn(["bun", join(import.meta.dir, "../../../tests/kernel/fixtures/crash-session.ts"), dir, mode], {stdout: "pipe", stderr: "inherit"});
        try {
            const stream = child.stdout.getReader();
            let text = "";
            while (!text.includes("\n")) {
                const {value, done} = await stream.read();
                if (done) throw new Error(`the child exited before announcing: ${text}`);
                text += new TextDecoder().decode(value);
            }
            const [what, sessionId] = text.trim().split(" ");
            expect(what).toBe(mode === "nested-approval" ? "waiting" : "started");
            return {store: {root: dir}, open: sessionId!};
        } finally {
            child.kill(9);
            await child.exited;
        }
    }

    test("输出 101、场景 7：在等嵌套调用的审批时被 kill -9：重开后它结算为 denied{interrupted-before-approval}，排在父调用的结果之前", async () => {
        await using session = await createTestSession(await crash("nested-approval"));
        const events = await session.events();
        expect(dataOf<{tool: string; status: string; code: string; args: unknown}>(events, "nestedToolResult").map((item) => [item.tool, item.status, item.code, item.args])).toEqual([["lab.gated", "denied", "interrupted-before-approval", {path: "正文.md"}]]);
        const order = events.map((event) => event.type).filter((type) => type === "nestedToolResult" || type === "toolResult");
        expect(order).toEqual(["nestedToolResult", "toolResult"]);
        expect(dataOf<{tool: string; status: string}>(events, "toolResult").map((item) => [item.tool, item.status])).toEqual([["lab.coder", "unknown"]]);
    });

    test("输出 101：嵌套调用执行中被 kill -9：重开后它结算为 unknown{interrupted}", async () => {
        await using session = await createTestSession(await crash("nested-running"));
        const events = await session.events();
        expect(dataOf<{tool: string; status: string; code: string}>(events, "nestedToolResult").map((item) => [item.tool, item.status, item.code])).toEqual([["lab.block", "unknown", "interrupted"]]);
        expect(events.map((event) => event.type).filter((type) => type === "nestedToolResult" || type === "toolResult")).toEqual(["nestedToolResult", "toolResult"]);
    });

    test("输出 102：同一条回复里的调用拿到同一个 leafMoves；回退之后的下一批变大", async () => {
        const seen: number[] = [];
        program = async (ctx) => {
            seen.push(ctx.leafMoves);
            return "记下";
        };
        await using session = await createTestSession({tools: [code]});
        session.model.script({tools: [{tool: "lab.code"}, {tool: "lab.code"}]}, "完成", {tools: [{tool: "lab.code"}]}, "又完成");
        await session.say("第一轮");
        expect(seen).toEqual([0, 0]);
        const target = (await session.raw.rewindTargets()).find((item) => item.kind === "after-turn");
        await session.raw.rewind({commandId: id(), to: target!.id});
        await session.say("第二轮");
        expect(seen[2]).toBe(1);
    });

    test("输出 96：嵌套事件里超过 2 KB 的参数字符串截短并标出 argsClipped，结果只记前 2 KB 的预览与全文字节数", async () => {
        const long = "字".repeat(1_000);
        program = async (ctx) => {
            await ctx.invoke!("lab.write", {path: "短.md", content: "一行"});
            return (await ctx.invoke!("lab.write", {path: "长.md", content: long})).status;
        };
        await using session = await createTestSession({tools: [code, writer({execute: () => "x".repeat(5_000)})]});
        session.model.script({tools: [{tool: "lab.code"}]}, "完成");
        const {events} = await session.say("写长的");
        const [short, started] = dataOf<{args: {path: string; content: string}; argsClipped?: true}>(events, "nestedToolStarted");
        expect(short!.argsClipped).toBeUndefined();
        expect(started!.args.path).toBe("长.md");
        expect(Buffer.byteLength(started!.args.content, "utf8")).toBeLessThan(2_200);
        expect(started!.args.content).toContain("共 3000 字节");
        expect(started!.argsClipped).toBe(true);
        const result = dataOf<{preview: string; size: number; argsClipped?: true}>(events, "nestedToolResult")[1]!;
        expect(result.argsClipped).toBe(true);
        expect(result.preview).toHaveLength(2_048);
        expect(result.size).toBe(5_000);
    });
});
