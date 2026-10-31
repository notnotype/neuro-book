/**
 * 工具、拦截与收尾（t20 第 5 片）。测试名里的编号是 docs/specs/harness/runtime.md 的输出条目与验收场景，
 * “session 输出”“session 场景”指 docs/specs/harness/session.md。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {readdir, readFile, rm} from "node:fs/promises";
import {join} from "node:path";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import type {AnyProfile, ApproveHook, LogEvent, ToolCall} from "../api/index.js";
import {conv, defineExtension} from "../extension/define.js";
import {defineProfile} from "../extension/profile.js";
import {createTestClock} from "../testing/clock.js";
import {createTestSession, type TestSession, type TestTool} from "../testing/test-session.js";
import {ABORT_GRACE_MS} from "./tools.js";

let root = "";
beforeAll(async () => {
    root = await createTestTmpRoot("nb-harness", "kernel-tools");
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

const echo = (id: string, extra: Partial<TestTool> = {}): TestTool => ({id, execute: (args) => `${id} ${JSON.stringify(args)}`, ...extra});
const types = (events: readonly LogEvent[]) => events.map((event) => event.type);
const dataOf = <T = Record<string, unknown>>(events: readonly LogEvent[], type: string) => events.filter((event) => event.type === type).map((event) => event.data as T);
const codes = async (session: TestSession) => (await session.raw.diagnostics()).map((item) => item.code);

/** JSONL 会话目录里每条事件所在的写入批（内存里的事件不带批的标记）。 */
async function batchOf(session: TestSession): Promise<Map<string, string>> {
    const text = await readFile(join(root, session.id, "session.jsonl"), "utf8");
    const map = new Map<string, string>();
    for (const line of text.split("\n").slice(1)) {
        if (line.trim() === "") continue;
        const record = JSON.parse(line) as {id: string; batch: {id: string}};
        map.set(record.id, record.batch.id);
    }
    return map;
}

async function sendRaw(session: TestSession, text: string): Promise<string> {
    const sent = await session.raw.send({commandId: `raw-${text}`, input: {text}});
    if (!sent.ok || sent.value.runId === null) throw new Error("send did not start a run");
    return sent.value.runId;
}

describe("工具集", () => {
    test("输出 15：不合规则或换算后重名的声明不进工具集并诊断；必需工具缺失时运行收口、会话进只读", async () => {
        await using session = await createTestSession({tools: [echo("lab.read"), echo("lab__x"), echo("lab.a", {providerName: "same"}), echo("lab.b", {providerName: "same"})]});
        session.model.script("好");
        const {requests} = await session.say("问");
        expect(requests[0]!.raw.tools.map((tool) => tool.id)).toEqual(["lab.read", "lab.a"]);
        const invalid = (await session.raw.diagnostics()).filter((item) => item.code === "tool-declaration-invalid").map((item) => item.params.tool);
        expect(invalid.sort()).toEqual(["lab.b", "lab__x"]);

        const profile = defineProfile({id: "lab.needs", version: "1", name: "n", description: "n", tools: {required: ["lab.read", "lab.write"]}}) as AnyProfile;
        await using needy = await createTestSession({profile, tools: [echo("lab.read")]});
        const report = await needy.say("问");
        expect(report.result).toMatchObject({reason: "error", error: {kind: "local", code: "tools-missing"}});
        expect(report.requests).toHaveLength(0);
        expect(await needy.raw.send({commandId: "again", input: {text: "再来"}})).toMatchObject({ok: false, code: "read-only"});
    });

    test("输出 16：第一次请求前告诉模型工具集；变了就同批写新记录与 tools-changed 提醒；没变不写", async () => {
        let tools: TestTool[] = [echo("lab.read"), echo("lab.grep", {version: "1"})];
        await using session = await createTestSession({tools: () => tools});
        session.model.script("一", "二", "三");
        const first = await session.say("第一问");
        expect(dataOf(first.events, "toolsAnnounced")).toEqual([{tools: [{id: "lab.grep", version: "1"}, {id: "lab.read", version: "1"}]}]);
        const second = await session.say("第二问");
        expect(dataOf(second.events, "toolsAnnounced")).toEqual([]);
        tools = [echo("lab.grep", {version: "2"}), echo("lab.write")];
        const third = await session.say("第三问");
        const changed = third.events.filter((event) => event.type === "toolsAnnounced" || event.type === "notice");
        expect(new Set(changed.map((event) => event.seq)).size).toBe(2);
        expect((changed[1]!.data as {code: string; text: string}).code).toBe("tools-changed");
        expect((changed[1]!.data as {text: string}).text).toContain("added: lab.write; removed: lab.read; updated: lab.grep");
        expect(third.requests[0]!.outline().at(-1)).toBe("user: event:notice | event:input");
    });
});

describe("执行", () => {
    test("场景 3、输出 17：两个 shared 并发、exclusive 在它们之后；结果按调用顺序一个批，整批写完才派发反应", async () => {
        const started = {a: gate(), b: gate()};
        const finish = {a: gate(), b: gate()};
        const order: string[] = [];
        const shared = (name: "a" | "b"): TestTool => ({id: `lab.${name}`, concurrency: "shared", execute: async () => {
            order.push(`start ${name}`);
            started[name].open();
            await finish[name].promise;
            order.push(`end ${name}`);
            return name;
        }});
        const watcher = defineExtension({id: "lab.watch", events: {seen: conv<{text: string}>()}, on: {toolResult: (event, ctx) => {
            ctx.emit("seen", {text: `看过 ${event.data.tool}`});
        }}});
        await using session = await createTestSession({store: {root}, extensions: [watcher], tools: [shared("a"), shared("b"), {id: "lab.c", execute: () => {
            order.push("run c");
            return "c";
        }}]});
        session.model.script({tools: [{tool: "lab.a", args: {n: 1}}, {tool: "lab.b"}, {tool: "lab.c"}]}, "完成");
        const runId = await sendRaw(session, "并发");
        await Promise.all([started.a.promise, started.b.promise]);
        expect(order).toEqual(["start a", "start b"]);
        finish.b.open();
        finish.a.open();
        const result = await session.raw.waitRun(runId);
        expect(result.reason).toBe("completed");
        expect(order).toEqual(["start a", "start b", "end b", "end a", "run c"]);
        const events = await session.events();
        expect(dataOf(events, "toolStarted").map((data) => [data.tool, data.args, (data.approval as {by: string}).by])).toEqual([["lab.a", {n: 1}, "test-policy"], ["lab.b", {}, "test-policy"], ["lab.c", {}, "test-policy"]]);
        const results = events.filter((event) => event.type === "toolResult");
        expect(results.map((event) => (event.data as {text: string}).text)).toEqual(["a", "b", "c"]);
        const batches = await batchOf(session);
        expect(new Set(results.map((event) => batches.get(event.id))).size).toBe(1);
        // 反应补记的事件都在三条结果之后：结果整批写完才派发反应。
        const tail = types(events).filter((type) => type === "toolResult" || type === "lab.watch/seen");
        expect(tail).toEqual(["toolResult", "toolResult", "toolResult", "lab.watch/seen", "lab.watch/seen", "lab.watch/seen"]);
    });

    test("输出 18：未知工具、参数不合 schema、审批拒绝、执行抛错各得内核造的结果", async () => {
        const approve: ApproveHook = async (call) => (call.tool === "lab.danger" ? {verdict: "deny", rejection: {code: "rule-denied", by: "rule:no-danger"}} : {verdict: "allow", by: "rule:default"});
        await using session = await createTestSession({approve, tools: [
            echo("lab.typed", {parameters: {type: "object", properties: {path: {type: "string"}}, required: ["path"]}}),
            echo("lab.danger"),
            {id: "lab.broken", execute: () => {
                throw new Error("坏了");
            }},
        ]});
        session.model.script({tools: [{tool: "lab.nope"}, {tool: "lab.typed", args: {}}, {tool: "lab.danger"}, {tool: "lab.broken"}]}, "完成");
        const {events} = await session.say("问");
        expect(dataOf(events, "toolResult").map((data) => [data.status, data.code, data.by])).toEqual([
            ["error", "unknown-tool", undefined],
            ["error", "invalid-arguments", undefined],
            ["denied", "rule-denied", "rule:no-danger"],
            ["error", "tool-threw", undefined],
        ]);
        expect((dataOf(events, "toolResult")[1]!.text as string)).toContain("path");
        expect(dataOf(events, "toolStarted").map((data) => data.tool)).toEqual(["lab.broken"]);
    });

    test("输出 19：工具实现每个会话建一次，关闭会话时 dispose", async () => {
        let created = 0;
        let disposed = 0;
        const session = await createTestSession({tools: [{id: "lab.counter", create: () => {
            created += 1;
            return {execute: async () => "ok", dispose: () => {
                disposed += 1;
            }};
        }}]});
        session.model.script({tools: [{tool: "lab.counter"}, {tool: "lab.counter"}]}, {tools: [{tool: "lab.counter"}]}, "完成");
        await session.say("问");
        expect(created).toBe(1);
        expect(disposed).toBe(0);
        await session.close();
        expect(disposed).toBe(1);
    });

    test("输出 19：工具被移出工具集时在下一个运行边界释放，重新出现时重建", async () => {
        let created = 0;
        let disposed = 0;
        const counted: TestTool = {id: "lab.dynamic", create: () => {
            created += 1;
            return {execute: async () => "ok", dispose: () => {
                disposed += 1;
            }};
        }};
        let tools: TestTool[] = [counted];
        await using session = await createTestSession({tools: () => tools});
        session.model.script({tools: [{tool: "lab.dynamic"}]}, "一", "二", {tools: [{tool: "lab.dynamic"}]}, "三");
        await session.say("第一问");
        tools = [];
        await session.say("第二问");
        expect([created, disposed]).toEqual([1, 1]);
        tools = [counted];
        await session.say("第三问");
        expect([created, disposed]).toEqual([2, 1]);
    });
});

describe("拦截链", () => {
    const tracer = (id: string, trace: string[]) => defineExtension({id, intercept: {
        model: async (request, next) => {
            trace.push(`model ${id}`);
            return next(request);
        },
        tool: async (call, next) => {
            trace.push(`tool ${id}`);
            return next(call);
        },
    }});

    test("输出 20：从外到里是插件的扩展、Profile 的 extensions、Profile 自己，审批在最里层", async () => {
        const trace: string[] = [];
        const profile = defineProfile({
            id: "lab.chain", version: "1", name: "c", description: "c",
            extensions: [tracer("lab.chain.own", trace)],
            intercept: {tool: async (call, next) => {
                trace.push("tool profile");
                return next(call);
            }},
        }) as AnyProfile;
        const approve: ApproveHook = async () => {
            trace.push("approve");
            return {verdict: "allow", by: "rule"};
        };
        await using session = await createTestSession({profile, approve, extensions: [tracer("lab.z", trace), tracer("lab.a", trace)], tools: [echo("lab.read")]});
        session.model.script({tools: [{tool: "lab.read"}]}, "完成");
        await session.say("问");
        expect(trace.filter((line) => line.startsWith("tool") || line === "approve")).toEqual(["tool lab.a", "tool lab.z", "tool lab.chain.own", "tool profile", "approve"]);
        expect(trace.filter((line) => line.startsWith("model")).slice(0, 3)).toEqual(["model lab.a", "model lab.z", "model lab.chain.own"]);
    });

    test("输出 20、21：调用 next 之前超时的层被跳过，它之后再调 next 被拒绝；next 里的时间不算它的", async () => {
        const clock = createTestClock();
        const entered = gate();
        const stuck = gate();
        let calls = 0;
        let lateNext: Promise<unknown> | null = null;
        const slow = defineExtension({id: "lab.slow", intercept: {model: async (request, next) => {
            calls += 1;
            if (calls > 1) return next(request);
            entered.open();
            await stuck.promise;
            lateNext = next(request);
            return lateNext as never;
        }}});
        const patient = defineExtension({id: "lab.patient", timeoutMs: 1_000, intercept: {tool: async (call, next) => next(call)}});
        const executing = gate();
        const toolGate = gate();
        await using session = await createTestSession({clock, extensions: [slow, patient], tools: [{id: "lab.wait", execute: async () => {
            executing.open();
            await toolGate.promise;
            return "等到了";
        }}]});
        session.model.script({tools: [{tool: "lab.wait"}]}, "完成");
        const runId = await sendRaw(session, "问");
        await entered.promise;
        await clock.advance(30_000);
        await executing.promise;
        // lab.patient 的 next 里等工具的时间远超它的 1 秒时限，仍不算它超时。
        await clock.advance(5_000);
        toolGate.open();
        const result = await session.raw.waitRun(runId);
        expect(result.reason).toBe("completed");
        stuck.open();
        await clock.advance(0);
        expect(lateNext).not.toBeNull();
        await expect(lateNext!).rejects.toThrow("after its interceptor had failed or timed out");
        const events = await session.events();
        expect(dataOf(events, "extensionFailed")).toEqual([{extension: "lab.slow", entry: "intercept.model", code: "timeout"}]);
        expect(dataOf(events, "toolResult")[0]!.text).toBe("等到了");
        expect(session.model.requests).toHaveLength(2);
    });

    test("输出 20、21：next 完成之后重新起表，之后卡住超时的层用里层的回复", async () => {
        const clock = createTestClock();
        const returned = gate();
        const dawdle = defineExtension({id: "lab.dawdle", intercept: {model: async (request, next) => {
            const response = await next(request);
            returned.open();
            await new Promise(() => undefined);
            return response;
        }}});
        await using session = await createTestSession({clock, extensions: [dawdle]});
        session.model.script("里层的回答");
        const runId = await sendRaw(session, "问");
        await returned.promise;
        await clock.advance(30_000);
        const result = await session.raw.waitRun(runId);
        expect(result.text).toBe("里层的回答");
        expect(dataOf(await session.events(), "extensionFailed")).toEqual([{extension: "lab.dawdle", entry: "intercept.model", code: "timeout"}]);
    });

    test("输出 21：模型拦截 next 之后出错用里层的回复；工具拦截出错缺省拒绝，写 ignore 的跳过；输入拦截出错跳过", async () => {
        const afterThrow = defineExtension({id: "lab.after-throw", intercept: {model: async (request, next) => {
            await next(request);
            throw new Error("之后坏了");
        }}});
        const denyOnError = defineExtension({id: "lab.strict", intercept: {tool: async (call, next) => {
            if (call.tool === "lab.a") throw new Error("坏了");
            return next(call);
        }}});
        const ignoreOnError = defineExtension({id: "lab.lenient", onFailure: {tool: "ignore"}, intercept: {tool: async (call, next) => {
            if (call.tool === "lab.b") throw new Error("坏了");
            return next(call);
        }}});
        const brokenInput = defineExtension({id: "lab.input", intercept: {input: async () => {
            throw new Error("坏了");
        }}});
        await using session = await createTestSession({store: {root}, extensions: [afterThrow, denyOnError, ignoreOnError, brokenInput], tools: [echo("lab.a"), echo("lab.b")]});
        session.model.script({text: "查", tools: [{tool: "lab.a"}, {tool: "lab.b"}]}, "完成");
        const {events, result} = await session.say("问");
        expect(result.reason).toBe("completed");
        expect(dataOf(events, "toolResult").map((data) => [data.tool, data.status, data.code, data.by])).toEqual([["lab.a", "denied", "intercept-failed", "lab.strict"], ["lab.b", "ok", undefined, undefined]]);
        const failed = dataOf(events, "extensionFailed").map((data) => `${data.extension}:${data.entry}:${data.code}`);
        expect(failed).toEqual(["lab.input:intercept.input:threw", "lab.after-throw:intercept.model:threw", "lab.strict:intercept.tool:threw", "lab.lenient:intercept.tool:threw", "lab.after-throw:intercept.model:threw"]);
        expect(dataOf(events, "assistant")[0]!.content).toEqual([{kind: "text", text: "查"}]);
        expect(await codes(session)).toContain("intercept-threw");
        // extensionFailed 与它对应的结果同一个写入批。
        const toolFailure = events.find((event) => event.type === "extensionFailed" && (event.data as {entry: string}).entry === "intercept.tool")!;
        const firstResult = events.find((event) => event.type === "toolResult")!;
        const batches = await batchOf(session);
        expect(batches.get(firstResult.id)).toBe(batches.get(toolFailure.id));
    });

    test("输出 22：改了请求记进 modifiedBy；调两次 next 有两条 modelStarted；不调 next 直接给回复时没有 modelStarted", async () => {
        let mode: "edit" | "retry" | "block" = "edit";
        const router = defineExtension({id: "lab.router", intercept: {model: async (request, next) => {
            if (mode === "edit") return next({...request, params: {maxTokens: 100}});
            if (mode === "retry") {
                await next(request);
                return next(request);
            }
            return {content: [{kind: "text", text: "缓存的回答"}], toolCalls: [], stopReason: "stop", usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, complete: true}, model: "cache"};
        }}});
        await using session = await createTestSession({extensions: [router]});
        session.model.script("一", "二a", "二b");
        const edited = await session.say("第一问");
        expect(dataOf(edited.events, "modelStarted").map((data) => data.modifiedBy)).toEqual([[{extension: "lab.router", fields: ["params"]}]]);
        expect(edited.requests[0]!.raw.params).toEqual({maxTokens: 100});
        mode = "retry";
        const retried = await session.say("第二问");
        const started = dataOf<{request: number}>(retried.events, "modelStarted");
        expect(started).toHaveLength(2);
        expect(dataOf<{request: number}>(retried.events, "assistant")[0]!.request).toBe(started[1]!.request);
        expect(retried.result.text).toBe("二b");
        mode = "block";
        const blocked = await session.say("第三问");
        expect(blocked.events.some((event) => event.type === "extensionFailed")).toBe(false);
        expect(types(blocked.events)).not.toContain("modelStarted");
        expect(dataOf<{request: number}>(blocked.events, "assistant")[0]!.request).toBe(started[1]!.request + 1);
        expect(blocked.result.text).toBe("缓存的回答");
    });

    test("输出 22、23：交给拦截层的请求、调用与结果是冻结的，原地修改按这一层出错处理", async () => {
        const mutator = defineExtension({id: "lab.mutator", intercept: {
            model: async (request, next) => {
                (request.params as {maxTokens?: number}).maxTokens = 123;
                return next(request);
            },
            tool: async (call, next) => {
                const result = await next(call);
                (result as {text: string}).text = "改过";
                return result;
            },
        }});
        await using session = await createTestSession({extensions: [mutator], tools: [{id: "lab.read", execute: () => ({text: "原文"})}]});
        session.model.script({tools: [{tool: "lab.read"}]}, "完成");
        const {events, requests} = await session.say("问");
        expect(requests[0]!.raw.params).toEqual({});
        expect(dataOf(events, "modelStarted")[0]!.modifiedBy).toEqual([]);
        expect(dataOf(events, "toolResult")[0]).toMatchObject({status: "denied", code: "intercept-failed", by: "lab.mutator"});
        expect(dataOf(events, "extensionFailed").map((data) => `${data.entry}:${data.code}`)).toEqual(["intercept.model:threw", "intercept.tool:threw", "intercept.model:threw"]);
    });

    test("输出 23：不调 next 交回 denied 记 blocked；执行之后改了文字记 raw，标 redacted 只记 rawHash", async () => {
        const guard = defineExtension({id: "lab.guard", intercept: {tool: async (call: ToolCall, next) => {
            if (call.tool === "lab.secret") return {text: "不许", status: "denied"};
            const result = await next(call);
            if (call.tool === "lab.trim") return {...result, text: "首行"};
            if (call.tool === "lab.mask") return {...result, text: "[已脱敏]", redacted: true};
            return result;
        }}});
        await using session = await createTestSession({extensions: [guard], tools: [echo("lab.secret"), {id: "lab.trim", execute: () => "首行\n第二行"}, {id: "lab.mask", execute: () => ({text: "密钥 abc", details: {key: "abc"}})}]});
        session.model.script({tools: [{tool: "lab.secret"}, {tool: "lab.trim"}, {tool: "lab.mask"}]}, "完成");
        const {events} = await session.say("问");
        const results = dataOf(events, "toolResult");
        expect(results[0]).toMatchObject({status: "blocked", by: "lab.guard", text: "不许"});
        expect(results[1]).toMatchObject({status: "ok", text: "首行", raw: "首行\n第二行"});
        expect(results[2]).toMatchObject({text: "[已脱敏]"});
        expect(results[2]!.raw).toBeUndefined();
        expect(results[2]!.details).toBeUndefined();
        expect(results[2]!.rawHash).toMatch(/^[0-9a-f]{64}$/u);
        expect(dataOf(events, "toolStarted").map((data) => data.tool)).toEqual(["lab.trim", "lab.mask"]);
    });

    test("场景 3、输出 17：扩展改了参数，审批规则按改过的参数拒绝", async () => {
        const rewrite = defineExtension({id: "lab.rewrite", intercept: {tool: async (call, next) => next(call.tool === "lab.write" ? {...call, args: {path: "设定/人物.md"}} : call)}});
        const approve: ApproveHook = async (call) => (String(call.args.path ?? "").startsWith("设定/") ? {verdict: "deny", rejection: {code: "outside-scope", by: "rule:writer-scope"}} : {verdict: "allow", by: "rule:writer-scope"});
        await using session = await createTestSession({approve, extensions: [rewrite], tools: [echo("lab.write"), echo("lab.read")]});
        session.model.script({tools: [{tool: "lab.write", args: {path: "正文/第一章.md"}}, {tool: "lab.read", args: {path: "正文/第一章.md"}}]}, "完成");
        const {events} = await session.say("问");
        expect(dataOf(events, "toolResult").map((data) => [data.tool, data.status, data.code, data.by])).toEqual([["lab.write", "denied", "outside-scope", "rule:writer-scope"], ["lab.read", "ok", undefined, undefined]]);
        expect(dataOf(events, "toolStarted").map((data) => [data.tool, data.args])).toEqual([["lab.read", {path: "正文/第一章.md"}]]);
    });
});

describe("输入拦截", () => {
    const filter = defineExtension({id: "lab.filter", intercept: {input: async (input, next) => {
        if (input.text.includes("禁词")) return {reject: {code: "banned-word", params: {word: "禁词"}}};
        if (input.text.includes("密码")) {
            await next({...input, text: input.text.replace(/密码\S*/u, "[已脱敏]")});
            return {redacted: true};
        }
        if (input.text.includes("错字")) return next({...input, text: input.text.replace("错字", "正字")});
        if (input.text.includes("私事")) {
            await next(input);
            return {redacted: true};
        }
        return next(input);
    }}});

    test("输出 24：拒绝时指令失败、不写日志；改过的记原文；脱敏的只记哈希", async () => {
        await using session = await createTestSession({extensions: [filter]});
        session.model.script("一", "二", "三");
        const head = (await session.raw.snapshot()).head;
        const rejected = await session.raw.send({commandId: "bad", input: {text: "这里有禁词"}});
        expect(rejected).toEqual({ok: false, code: "input-rejected", detail: {code: "banned-word", params: {word: "禁词"}, by: "lab.filter"}});
        expect((await session.raw.snapshot()).head).toBe(head);
        expect((await session.raw.diagnostics()).find((item) => item.code === "input-rejected")).toMatchObject({extension: "lab.filter", params: {code: "banned-word", by: "lab.filter"}});
        const fixed = await session.say("有错字");
        expect(dataOf(fixed.events, "inputQueued")[0]).toMatchObject({input: {text: "有正字"}, original: "有错字"});
        expect(dataOf(fixed.events, "input")[0]).toMatchObject({text: "有正字"});
        const masked = await session.say("我的密码是hunter2");
        const queued = dataOf(masked.events, "inputQueued")[0]!;
        expect(queued).toMatchObject({input: {text: "我的[已脱敏]"}});
        expect(queued.original).toBeUndefined();
        expect(queued.originalHash).toMatch(/^[0-9a-f]{64}$/u);
        const marked = dataOf((await session.say("一件私事")).events, "inputQueued")[0]!;
        expect(marked.originalHash).toMatch(/^[0-9a-f]{64}$/u);
    });

    test("场景 4、session 输出 10、session 场景 6：输入与超过 16 KB 的工具结果脱敏后，重开一致，会话目录全文搜不到原文", async () => {
        const secretResult = `机密-${"长".repeat(9_000)}`;
        const masker = defineExtension({id: "lab.masker", intercept: {tool: async (call, next) => {
            const result = await next(call);
            return {...result, text: "[结果已脱敏]", redacted: true};
        }}});
        const big = `公开-${"大".repeat(9_000)}`;
        await using session = await createTestSession({store: {root}, extensions: [filter, masker], tools: [{id: "lab.leak", execute: () => secretResult}, {id: "lab.big", execute: () => big}]});
        session.model.script({tools: [{tool: "lab.leak"}]}, "完成");
        await session.say("我的密码是hunter2");
        const before = await session.events();
        await session.reopen();
        expect(await session.events()).toEqual(before);
        const files: string[] = [];
        const walk = async (dir: string): Promise<void> => {
            for (const entry of await readdir(dir, {withFileTypes: true})) {
                const path = join(dir, entry.name);
                if (entry.isDirectory()) await walk(path);
                else files.push(await readFile(path, "utf8"));
            }
        };
        await walk(join(root, session.id));
        const all = files.join("\n");
        expect(all).not.toContain("hunter2");
        expect(all).not.toContain("机密-");
        expect(all).toContain("[结果已脱敏]");
    });
});

describe("中止", () => {
    test("输出 25：宽限期内完成的照常写，没完成的记 unknown；之后才到的只诊断", async () => {
        const clock = createTestClock();
        const quickGate = gate();
        const slowGate = gate();
        const started = {quick: gate(), slow: gate()};
        await using session = await createTestSession({clock, tools: [
            {id: "lab.quick", concurrency: "shared", execute: async () => {
                started.quick.open();
                await quickGate.promise;
                return "快";
            }},
            {id: "lab.slow", concurrency: "shared", execute: async () => {
                started.slow.open();
                await slowGate.promise;
                return "慢";
            }},
            echo("lab.later"),
        ]});
        session.model.script({tools: [{tool: "lab.quick"}, {tool: "lab.slow"}, {tool: "lab.later"}]});
        const runId = await sendRaw(session, "问");
        await Promise.all([started.quick.promise, started.slow.promise]);
        const aborting = session.raw.abort({commandId: "stop"});
        quickGate.open();
        await clock.advance(0);
        await clock.advance(ABORT_GRACE_MS);
        await aborting;
        const result = await session.raw.waitRun(runId);
        expect(result.reason).toBe("aborted");
        const events = await session.events();
        expect(dataOf(events, "toolResult").map((data) => [data.tool, data.status, data.code ?? null])).toEqual([["lab.quick", "ok", null], ["lab.slow", "unknown", "aborted"], ["lab.later", "unknown", "aborted"]]);
        expect(types(events).slice(-2)).toEqual(["turnEnded", "runEnded"]);
        slowGate.open();
        await clock.advance(0);
        expect(await codes(session)).toContain("late-result-dropped");
        expect(types(await session.events())).toEqual(types(events));
    });
});

describe("中止（建实现）", () => {
    test("输出 25：中止时还在建实现的调用，建好之后（宽限期内外）都不再执行", async () => {
        const clock = createTestClock();
        const creating = gate();
        const release = gate<void>();
        let executed = 0;
        await using session = await createTestSession({clock, tools: [{id: "lab.lazy", create: () => {
            creating.open();
            return release.promise.then(() => ({execute: async () => {
                executed += 1;
                return "执行了";
            }}));
        }}]});
        session.model.script({tools: [{tool: "lab.lazy"}]});
        const runId = await sendRaw(session, "问");
        await creating.promise;
        const aborting = session.raw.abort({commandId: "stop"});
        // 宽限期内建好：中止之后不再开始执行。
        release.open();
        await clock.advance(0);
        await clock.advance(ABORT_GRACE_MS);
        await aborting;
        expect((await session.raw.waitRun(runId)).reason).toBe("aborted");
        expect(executed).toBe(0);
        const events = await session.events();
        expect(types(events)).not.toContain("toolStarted");
        expect(dataOf(events, "toolResult")[0]).toMatchObject({status: "unknown", code: "aborted"});
    });
});

describe("收尾", () => {
    const finishTool = (execute: TestTool["execute"]): TestTool => ({id: "lab.answer", finish: true, parameters: {type: "object", properties: {answer: {type: "string"}}, required: ["answer"]}, execute});

    test("输出 26：单独调用且成功时结果、turnEnded、runEnded{finished} 同批，不再请求模型", async () => {
        await using session = await createTestSession({store: {root}, tools: [finishTool(() => "收到")]});
        session.model.script({tools: [{tool: "lab.answer", args: {answer: "四十二"}}]});
        const report = await session.say("问");
        expect(report.result).toMatchObject({reason: "finished", stopReason: "finished", result: {via: "tool", tool: "lab.answer", value: {answer: "四十二"}, valid: true}});
        expect(report.requests).toHaveLength(1);
        const tail = report.events.slice(-3);
        expect(types(tail)).toEqual(["toolResult", "turnEnded", "runEnded"]);
        const batches = await batchOf(session);
        expect(new Set(tail.map((event) => batches.get(event.id))).size).toBe(1);
    });

    test("输出 26：执行结果不是 ok 时按普通工具继续；与别的工具混在一起时不执行、得 finish-not-alone", async () => {
        let attempts = 0;
        await using session = await createTestSession({tools: [finishTool(() => (attempts++ === 0 ? {text: "答案格式不对", status: "error"} : "收到")), echo("lab.read")]});
        session.model.script(
            {tools: [{tool: "lab.answer", args: {answer: "一"}}]},
            {tools: [{tool: "lab.answer", args: {answer: "二"}}, {tool: "lab.read"}]},
            {tools: [{tool: "lab.answer", args: {answer: "三"}}]},
        );
        const report = await session.say("问");
        expect(report.result).toMatchObject({reason: "finished", result: {value: {answer: "三"}}});
        expect(dataOf(report.events, "toolResult").map((data) => [data.tool, data.status, data.code ?? null])).toEqual([
            ["lab.answer", "error", null],
            ["lab.answer", "error", "finish-not-alone"],
            ["lab.read", "ok", null],
            ["lab.answer", "ok", null],
        ]);
        expect(attempts).toBe(2);
    });

    test("输出 26：执行中被中止、宽限期内完成的收尾结果仍以 finished 结束", async () => {
        const clock = createTestClock();
        const started = gate();
        const release = gate();
        await using session = await createTestSession({clock, tools: [finishTool(async () => {
            started.open();
            await release.promise;
            return "收到";
        })]});
        session.model.script({tools: [{tool: "lab.answer", args: {answer: "晚一点"}}]});
        const runId = await sendRaw(session, "问");
        await started.promise;
        const aborting = session.raw.abort({commandId: "stop"});
        release.open();
        await clock.advance(0);
        await clock.advance(ABORT_GRACE_MS);
        await aborting;
        expect((await session.raw.waitRun(runId)).reason).toBe("finished");
    });

    const schema = {type: "object", properties: {title: {type: "string"}}, required: ["title"]};

    test("输出 27：会话要交回结果时生成 yield 并在第一轮开头提醒；调用 yield 即收尾，参数不合格按普通错误", async () => {
        await using session = await createTestSession({result: {mode: "optional", schema}});
        session.model.script({tools: [{tool: "yield", args: {}}]}, {tools: [{tool: "yield", args: {title: "雨夜"}}]});
        const report = await session.say("起个标题");
        expect(report.requests[0]!.outline().at(-1)).toBe("user: event:notice | event:input");
        expect(report.requests[0]!.raw.tools.map((tool) => [tool.id, tool.finish])).toEqual([["yield", true]]);
        expect(dataOf(report.events, "toolResult")[0]).toMatchObject({status: "error", code: "invalid-arguments"});
        expect(report.result).toMatchObject({reason: "finished", result: {via: "tool", tool: "yield", value: {title: "雨夜"}, valid: true}});
    });

    test("输出 27：optional 没调用 yield 以最后一条回复作结果；required 先催一次，仍没有以 result-missing 收口", async () => {
        await using optional = await createTestSession({result: {mode: "optional", schema}});
        optional.model.script("雨夜");
        expect((await optional.say("起个标题")).result).toMatchObject({reason: "completed", result: {via: "text", value: "雨夜", valid: false}});

        await using required = await createTestSession({result: {mode: "required", schema}});
        required.model.script("雨夜", "还是雨夜");
        const report = await required.say("起个标题");
        expect(dataOf(report.events, "continued")).toEqual([{text: expect.stringContaining("yield"), by: "core", count: 1}]);
        expect(report.requests).toHaveLength(2);
        expect(report.result).toMatchObject({reason: "error", error: {kind: "local", code: "result-missing"}, result: {via: "text", value: "还是雨夜", valid: false}});
    });
});
