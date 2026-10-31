/**
 * 宿主面（t20 第 9 片）：关闭与迟到的写入、出站过滤、进程收尾、单次请求。测试名里的编号是 docs/specs/harness/runtime.md
 * 的输出条目，“session 输出”指 session.md。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import type {AnyProfile, LogEvent, SessionEnv} from "../api/index.js";
import {defineExtension, ext} from "../extension/define.js";
import {defineProfile} from "../extension/profile.js";
import {createTestClock} from "../testing/clock.js";
import {createTestModel} from "../testing/model.js";
import {createTestSession, type TestSession} from "../testing/test-session.js";
import {ABORT_GRACE_MS} from "../run/tools.js";
import {createMemoryStore} from "../log/memory-store.js";
import {createAgentHost, ExtensionRejected} from "./agent-host.js";
import {complete} from "./complete.js";
import {closeSession} from "./session.js";

let root = "";
beforeAll(async () => {
    root = await createTestTmpRoot("nb-harness", "kernel-host");
});
afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

let commands = 0;
const id = () => `h-${(commands += 1)}`;
const types = (events: readonly LogEvent[]) => events.map((event) => event.type);
const dataOf = <T = Record<string, unknown>>(events: readonly LogEvent[], type: string) => events.filter((event) => event.type === type).map((event) => event.data as T);

function gate() {
    let open!: () => void;
    const promise = new Promise<void>((resolve) => {
        open = resolve;
    });
    return {promise, open};
}

async function sendRaw(session: TestSession, text: string): Promise<string> {
    const sent = await session.raw.send({commandId: id(), input: {text}});
    if (!sent.ok || sent.value.runId === null) throw new Error("send did not start a run");
    return sent.value.runId;
}

describe("关闭", () => {
    test("输出 53：关闭时中止在跑的运行、等收口；之后的指令得 session-closed；摘下后再写的外部事实只写诊断", async () => {
        let late: ((name: "ping") => void) | null = null;
        const watcher = defineExtension({id: "lab.watch", events: {ping: ext()}, mount: (ctx) => {
            late = (name) => ctx.emit(name);
            return () => undefined;
        }});
        const clock = createTestClock();
        const started = gate();
        const session = await createTestSession({store: {root}, clock, extensions: [watcher], tools: [{id: "lab.hold", execute: async () => {
            started.open();
            return new Promise<string>(() => undefined);
        }}]});
        session.model.script({tools: [{tool: "lab.hold"}]});
        await sendRaw(session, "问");
        await started.promise;
        const closing = closeSession(session.raw);
        await clock.advance(0);
        await clock.advance(ABORT_GRACE_MS);
        await closing;
        expect(await session.raw.send({commandId: id(), input: {text: "再来"}})).toEqual({ok: false, code: "session-closed"});
        late!("ping");
        expect((await session.raw.diagnostics()).some((item) => item.code === "late-result-dropped" && item.extension === "lab.watch")).toBe(true);
        await using reopened = await createTestSession({store: {root}, open: session.id, extensions: [watcher]});
        const events = await reopened.events();
        expect(types(events)).not.toContain("lab.watch/ping");
        expect(dataOf(events, "runEnded").at(-1)).toMatchObject({reason: "aborted"});
        expect(dataOf(events, "toolResult").at(-1)).toMatchObject({status: "unknown", code: "aborted"});
    });

    test("session 输出 16：进程收尾按 interrupted 收口，与重开时的恢复一致（含等审批的调用）", async () => {
        const clock = createTestClock();
        const asked = gate();
        const session = await createTestSession({
            store: {root},
            clock,
            tools: [{id: "lab.write", effect: "write", execute: () => "写了"}],
            approve: async () => {
                asked.open();
                return {verdict: "ask"};
            },
        });
        session.model.script({tools: [{tool: "lab.write"}]});
        await sendRaw(session, "写");
        await asked.promise;
        await new Promise<void>((resolve) => {
            const stop = session.raw.subscribe((frame) => {
                if (frame.type === "status" && frame.status.state === "waiting") {
                    stop();
                    resolve();
                }
            });
        });
        // 等中断的结算写下再推过宽限期：结算要经过一次真实的文件写入，注入的时钟不等 I/O。
        const settled = new Promise<void>((resolve) => {
            const stop = session.raw.subscribe((frame) => {
                if (frame.type === "log" && frame.event.type === "interactionResolved") {
                    stop();
                    resolve();
                }
            });
        });
        const closing = closeSession(session.raw, {reason: "interrupted"});
        await settled;
        // 帧在写入途中推出：先让写入的后续（交回拒绝的结果）跑完，再推过宽限期。
        await clock.advance(0);
        await clock.advance(ABORT_GRACE_MS);
        await closing;
        await using reopened = await createTestSession({store: {root}, open: session.id});
        const events = await reopened.events();
        expect(dataOf(events, "interactionResolved")).toEqual([expect.objectContaining({decision: "interrupted", code: "interrupted-before-approval"})]);
        expect(dataOf(events, "toolResult").at(-1)).toMatchObject({status: "denied", code: "interrupted-before-approval"});
        expect(dataOf(events, "turnEnded").at(-1)).toMatchObject({reason: "interrupted"});
        expect(dataOf(events, "runEnded").at(-1)).toMatchObject({reason: "interrupted"});
        expect(types(events).filter((type) => type === "runEnded")).toHaveLength(1);
    });
});

describe("关闭的竞态", () => {
    test("输出 53：关闭开始时还在受理的指令得 session-closed、不开运行；并发的关闭等同一个，摘下的清理照样等到", async () => {
        const entered = gate();
        const held = gate();
        const slowInput = defineExtension({id: "lab.slow-input", intercept: {input: async (input, next) => {
            entered.open();
            await held.promise;
            return next(input);
        }}});
        const cleaning = gate();
        let cleaned = 0;
        const watcher = defineExtension({id: "lab.watch", mount: () => async () => {
            await cleaning.promise;
            cleaned += 1;
        }});
        const session = await createTestSession({store: {root}, extensions: [slowInput, watcher]});
        session.model.script("答");
        const sending = session.raw.send({commandId: id(), input: {text: "问"}});
        await entered.promise;
        const first = closeSession(session.raw);
        const second = closeSession(session.raw);
        held.open();
        expect(await sending).toEqual({ok: false, code: "session-closed"});
        let secondDone = false;
        void second.then(() => {
            secondDone = true;
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(secondDone).toBe(false);
        cleaning.open();
        await second;
        expect(cleaned).toBe(1);
        await first;
        await using reopened = await createTestSession({store: {root}, open: session.id, extensions: [slowInput, watcher]});
        expect(types(await reopened.events())).not.toContain("runStarted");
        expect(session.model.requests).toHaveLength(0);
    });

    test("输出 53、34：进程收尾时开始了的工具得 unknown/interrupted，还没开始的得 denied/interrupted-before-approval，与重开的恢复一致", async () => {
        const clock = createTestClock();
        const started = gate();
        let secondRan = false;
        const session = await createTestSession({store: {root}, clock, tools: [
            {id: "lab.first", execute: async () => {
                started.open();
                return new Promise<string>(() => undefined);
            }},
            {id: "lab.second", execute: () => {
                secondRan = true;
                return "第二个";
            }},
        ]});
        session.model.script({tools: [{tool: "lab.first"}, {tool: "lab.second"}]});
        await sendRaw(session, "问");
        await started.promise;
        const closing = closeSession(session.raw, {reason: "interrupted"});
        await clock.advance(0);
        await clock.advance(ABORT_GRACE_MS);
        await closing;
        await using reopened = await createTestSession({store: {root}, open: session.id});
        const events = await reopened.events();
        expect(dataOf(events, "toolResult").map((data) => [data.tool, data.status, data.code])).toEqual([["lab.first", "unknown", "interrupted"], ["lab.second", "denied", "interrupted-before-approval"]]);
        expect(dataOf(events, "toolStarted").map((data) => data.tool)).toEqual(["lab.first"]);
        expect(secondRan).toBe(false);
    });
});

describe("出站过滤", () => {
    test("输出 54：按视图的发出者过滤帧、日志查询与路径；过滤抛错时不给看并诊断", async () => {
        let broken = false;
        const outbound: SessionEnv["outbound"] = {
            event: (event, reader) => {
                if (broken && event.type === "assistant") throw new Error("坏了");
                if (reader.kind === "session" && event.type === "assistant" && JSON.stringify(event.data).includes("剧透")) return null;
                return event;
            },
            delta: (frame, reader) => (reader.kind === "session" && frame.text.includes("剧透") ? null : frame),
        };
        await using session = await createTestSession({outbound});
        const reader = session.raw.as({kind: "session", id: "child"});
        const seen: string[] = [];
        const stop = reader.subscribe((frame) => {
            if (frame.type === "log") seen.push(frame.event.type);
        });
        session.model.script("结局是剧透");
        await session.say("结局是什么");
        stop();
        expect(seen).toContain("input");
        expect(seen).not.toContain("assistant");
        expect(types((await reader.log({afterSeq: 0})).events)).not.toContain("assistant");
        expect(types(await reader.path())).not.toContain("assistant");
        expect(types(await session.raw.path())).toContain("assistant");
        broken = true;
        expect(types(await session.raw.path())).not.toContain("assistant");
        expect((await session.raw.diagnostics()).some((item) => item.code === "outbound-filter-threw")).toBe(true);
    });
});

describe("出站过滤（增量编号）", () => {
    test("输出 54：过滤掉的增量不占号，每个订阅者收到的 n 在一次请求里从 1 起连续", async () => {
        const outbound: SessionEnv["outbound"] = {event: (event) => event, delta: (frame, reader) => (reader.kind === "session" && frame.part === "thinking" ? null : frame)};
        await using session = await createTestSession({outbound});
        const numbers = (reader: Pick<typeof session.raw, "subscribe">) => {
            const seen: string[] = [];
            reader.subscribe((frame) => {
                if (frame.type === "delta") seen.push(`${frame.request}.${frame.n}:${frame.part}`);
            });
            return seen;
        };
        const owner = numbers(session.raw);
        const child = numbers(session.raw.as({kind: "session", id: "child"}));
        session.model.script({thinking: "先想想", text: "回答"}, "再答");
        await session.say("问");
        await session.say("再问");
        expect(owner).toEqual(["1.1:thinking", "1.2:thinking", "1.3:text", "1.4:text", "2.1:text", "2.2:text"]);
        expect(child).toEqual(["1.1:text", "1.2:text", "2.1:text", "2.2:text"]);
    });
});

describe("出站过滤（异步）", () => {
    test("输出 54：过滤是异步的、后到的先过滤完，订阅者看到的先后仍与日志一致；日志查询逐条按顺序", async () => {
        const order: string[] = [];
        const outbound: SessionEnv["outbound"] = {
            // 越早的事件让出越多次事件循环：不排队的话后面的会先到。
            event: async (event) => {
                for (let turn = 0; turn < Math.max(0, 12 - event.seq); turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
                order.push(event.type);
                return event.type === "assistant" ? {...event, data: {...(event.data as object), content: [{kind: "text", text: "（已过滤）"}]}} : event;
            },
        };
        await using session = await createTestSession({outbound});
        const seen: string[] = [];
        const done = new Promise<void>((resolve) => {
            session.raw.subscribe((frame) => {
                if (frame.type !== "log") return;
                seen.push(frame.event.type);
                if (frame.event.type === "runEnded") resolve();
            });
        });
        session.model.script("原文");
        await session.say("问");
        await done;
        const logged = (await session.raw.log({afterSeq: 0})).events;
        // 订阅是会话建好之后开始的：看到的应当正好是日志的最后几条，先后一致。
        expect(seen).toEqual(logged.slice(logged.length - seen.length).map((event) => event.type));
        expect(seen.length).toBeGreaterThan(5);
        expect((logged.find((event) => event.type === "assistant")!.data as {content: {text: string}[]}).content[0]!.text).toBe("（已过滤）");
    });
});

describe("出站过滤的订阅与分页", () => {
    test("输出 53、54：取消订阅或关闭会话之后，已排进过滤队列的帧不再交出", async () => {
        // 第一帧的过滤挂在 held 上，后面的帧排在它后面；放开之后它返回（released），排着的帧随即被丢掉。
        let held = gate();
        let holding = true;
        let released = gate();
        const outbound: SessionEnv["outbound"] = {
            event: async (event) => {
                if (holding) {
                    await held.promise;
                    released.open();
                }
                return event;
            },
        };
        const session = await createTestSession({outbound});
        const seen: string[] = [];
        const stop = session.raw.subscribe((frame) => seen.push(frame.type));
        session.model.script("答一", "答二");
        await session.raw.waitRun(await sendRaw(session, "问一"));
        stop();
        holding = false;
        held.open();
        await released.promise;
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(seen).toEqual([]);

        held = gate();
        holding = true;
        released = gate();
        const afterClose: string[] = [];
        session.raw.subscribe((frame) => afterClose.push(frame.type));
        await session.raw.waitRun(await sendRaw(session, "问二"));
        await closeSession(session.raw);
        holding = false;
        held.open();
        await released.promise;
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(afterClose).toEqual([]);
    });

    test("输出 54：订阅者抛错只写诊断，不打断提交，后面的订阅者与帧照常；有没有出站过滤都一样", async () => {
        for (const outbound of [undefined, {event: async (event: LogEvent) => event}]) {
            await using session = await createTestSession(outbound === undefined ? {} : {outbound});
            // 在每一帧上都抛，包括诊断帧：诊断帧上抛错不再写诊断，否则会一直循环。
            session.raw.subscribe(() => {
                throw new Error("订阅者坏了");
            });
            const seen: string[] = [];
            const ended = gate();
            session.raw.subscribe((frame) => {
                if (frame.type !== "log") return;
                seen.push(frame.event.type);
                if (frame.event.type === "runEnded") ended.open();
            });
            session.model.script("答");
            const runId = await sendRaw(session, "问");
            expect((await session.raw.waitRun(runId)).reason).toBe("completed");
            await ended.promise;
            expect(seen.slice(-2)).toEqual(["turnEnded", "runEnded"]);
            expect((await session.raw.snapshot()).head).toBe((await session.raw.log({afterSeq: 0})).events.at(-1)!.seq);
            expect((await session.raw.diagnostics()).some((item) => item.code === "subscriber-threw")).toBe(true);
        }
    });

    test("输出 54：日志分页的边界在读取开始时定下；整页被过滤时 through 照样前进；limit 不合法时夹到范围内", async () => {
        let hold: Promise<void> | null = null;
        const outbound: SessionEnv["outbound"] = {
            event: async (event) => {
                if (hold !== null) await hold;
                return event.type === "inputQueued" || event.type === "commandAccepted" ? null : event;
            },
        };
        await using session = await createTestSession({outbound});
        for (const text of ["一", "二", "三"]) await session.raw.enqueue({commandId: id(), input: {text}, mode: "followup"});
        const head = (await session.raw.snapshot()).head;
        // 三次入队各写 inputQueued 与 commandAccepted，全被过滤掉。
        expect(await session.raw.log({afterSeq: head - 6, limit: 2})).toEqual({events: [], head, more: true, through: head - 4});
        expect(await session.raw.log({afterSeq: head - 4})).toEqual({events: [], head, more: false, through: head});
        // 不合法的 limit 夹到 1 到 2000：每页至少扫描一条，through 不会越过没读到的事件。
        for (const limit of [0, -1, 0.5]) expect(await session.raw.log({afterSeq: head - 6, limit})).toEqual({events: [], head, more: true, through: head - 5});

        const held = gate();
        hold = held.promise;
        const reading = session.raw.log({afterSeq: 0});
        await session.raw.setTitle({commandId: id(), title: "新标题"});
        hold = null;
        held.open();
        const page = await reading;
        expect([page.head, page.through, page.more]).toEqual([head, head, false]);
        expect(types((await session.raw.log({afterSeq: page.through})).events)).toContain("titleChanged");
    });
});

describe("单次请求", () => {
    const plain = defineProfile({id: "lab.plain", version: "1", name: "p", description: "p", system: "你是校对。", prompt: () => null as never}) as AnyProfile;
    const withTools = defineProfile({id: "lab.tools", version: "1", name: "t", description: "t", tools: {required: ["lab.read"]}}) as AnyProfile;

    test("输出 56：只用系统提示词与这一条输入，purpose 为 background；声明了工具的 Profile 得 profile-has-tools", async () => {
        const model = createTestModel();
        const env = {models: model.port, resources: () => ({read: async () => undefined, resolve: (uri: string) => uri}), clock: createTestClock(), profiles: {resolve: (key: string) => [plain, withTools].find((profile) => profile.id === key)}};
        model.script("改好了");
        const done = await complete(env, {profile: "lab.plain", input: {text: "改这句"}});
        expect(done).toMatchObject({ok: true, result: {reason: "completed", stopReason: "stop", text: "改好了", error: null}});
        const request = model.requests[0]!;
        expect(request.purpose).toBe("background");
        expect(request.system.map((block) => (block as {text: string}).text)).toEqual(["你是校对。"]);
        expect(request.messages.map((message) => [message.role, (message.content[0] as {text: string}).text])).toEqual([["user", "改这句"]]);
        expect(await complete(env, {profile: "lab.tools", input: {text: "x"}})).toEqual({ok: false, code: "profile-has-tools"});
        expect(await complete(env, {profile: "lab.nope", input: {text: "x"}})).toEqual({ok: false, code: "unknown-profile"});
        model.script({fail: "rate_limit"});
        expect(await complete(env, {profile: "lab.plain", input: {text: "再改"}})).toMatchObject({ok: true, result: {reason: "error", error: {kind: "rate_limit"}}});
    });
});

describe("预览", () => {
    test("输出 55：跑视图与模型拦截链但不发请求、不写日志；给出拦截前后、改动、槽、各区 token", async () => {
        const phases: string[] = [];
        const router = defineExtension({id: "lab.router", intercept: {model: async (request, next, ctx) => {
            phases.push(ctx.phase);
            return next({...request, headers: {...request.headers, "x-route": "fast"}});
        }}});
        const notes = defineExtension({id: "lab.notes", contribute: {notes: {value: () => "笔记"}, stray: {value: () => "没人摆"}}});
        await using session = await createTestSession({extensions: [router, notes]});
        session.model.script("答一");
        await session.say("第一问");
        const head = (await session.raw.snapshot()).head;
        const preview = await session.raw.preview();
        expect(preview.fidelity).toBe("next");
        expect(preview.original.headers).toEqual({});
        expect(preview.request.headers).toEqual({"x-route": "fast"});
        expect(preview.changes).toEqual([{extension: "lab.router", path: {area: "headers", key: "x-route"}, op: "insert", after: "fast"}]);
        expect(preview.slots.map((slot) => [slot.name, slot.placed])).toEqual([["notes", true], ["stray", true]]);
        expect(preview.tokens.byArea.history).toBeGreaterThan(0);
        expect(preview.tokens.threshold).toBe(83_616);
        expect(phases).toEqual(["run", "preview"]);
        expect((await session.raw.snapshot()).head).toBe(head);
        expect(session.model.requests).toHaveLength(1);
        await expect(session.raw.preview({atRequest: 1})).rejects.toMatchObject({code: "past-request-unsupported"});
    });

    test("输出 55：预览里原地改请求按这一层失败、不改坏之后的真实请求；拦截失败交在 diagnostics；改动覆盖消息的插入、字段与顶层字段", async () => {
        let mode: "off" | "mutate" | "throw" | "rewrite" = "off";
        const meddle = defineExtension({id: "lab.meddle", intercept: {model: async (request, next, ctx) => {
            if (ctx.phase !== "preview" || mode === "off") return next(request);
            if (mode === "mutate") {
                (request.messages[0]!.content[0] as {text: string}).text = "预览改坏了";
                return next(request);
            }
            if (mode === "throw") throw new Error("坏了");
            const [first, ...rest] = request.messages;
            return next({...request, model: "other/model", effort: "high", messages: [{...first!, role: "assistant"}, {role: "user", content: [{kind: "text", text: "插进来的", origin: first!.content[0]!.origin}]}, ...rest]});
        }}});
        await using session = await createTestSession({extensions: [meddle]});
        session.model.script("答一", "答二");
        await session.say("第一问");
        const head = (await session.raw.snapshot()).head;

        mode = "mutate";
        const mutated = await session.raw.preview();
        expect(mutated.diagnostics.map((item) => [item.code, item.extension, item.persisted])).toEqual([["intercept-threw", "lab.meddle", false]]);
        expect(mutated.changes).toEqual([]);
        mode = "throw";
        expect((await session.raw.preview()).diagnostics.map((item) => [item.code, item.extension])).toEqual([["intercept-threw", "lab.meddle"]]);
        mode = "rewrite";
        const rewritten = await session.raw.preview();
        expect(rewritten.changes.map((change): [unknown, string] => [change.path, change.op])).toEqual([
            [{area: "messages", message: 0, field: "role"}, "replace"],
            [{area: "messages", message: 1}, "insert"],
            [{area: "request", key: "model"}, "replace"],
            [{area: "request", key: "effort"}, "insert"],
        ]);
        expect((await session.raw.snapshot()).head).toBe(head);

        mode = "off";
        await session.say("第二问");
        expect((session.model.requests[1]!.messages[0]!.content[0] as {text: string}).text).toBe("第一问");
    });

    test("输出 55：缓冲区里排着的输入投影进下一次请求；工具调用的参数算进 token", async () => {
        await using session = await createTestSession({tools: [{id: "lab.search", execute: () => "结果"}]});
        const query = "查".repeat(3000);
        session.model.script({tools: [{tool: "lab.search", args: {query}}]}, "答一", "答二");
        await session.say("第一问");
        expect((await session.raw.preview()).tokens.byArea.history).toBeGreaterThan(3000);
        await session.raw.enqueue({commandId: id(), input: {text: "下一问"}, mode: "followup"});
        const preview = await session.raw.preview();
        const last = preview.request.messages.at(-1)!;
        expect([last.role, (last.content[0] as {text: string}).text]).toEqual(["user", "下一问"]);
        expect(preview.tokens.byArea.turn).toBeGreaterThan(0);
        const started = await session.raw.start({commandId: id()});
        if (!started.ok) throw new Error(started.code);
        await session.raw.waitRun(started.value.runId);
        expect(session.model.requests.at(-1)!.messages).toEqual(preview.request.messages.map((message) => expect.objectContaining({role: message.role})));
    });
});

describe("插件宿主", () => {
    const counter = defineExtension({id: "lab.count", events: {seen: ext()}, on: {toolResult: (_event, ctx) => ctx.emit("seen")}, contribute: {count: {value: () => "计数器在"}}});
    const handleOf = (extension: ReturnType<typeof defineExtension>, plugin = "lab", dependsOn: string[] = []) => ({id: extension.id, plugin, declaration: {dependsOn}, implementation: () => extension as never});

    function hostEnv(model = createTestModel(), tools: {id: string; execute: () => Promise<string> | string}[] = []): Omit<SessionEnv, "extensions"> {
        return {
            store: createMemoryStore(),
            profiles: {resolve: (key) => [defaultProfile, dependent].find((profile) => profile.id === key)},
            models: model.port,
            tools: {declarations: () => tools.map((tool) => ({id: tool.id, description: tool.id, parameters: {type: "object"}, provider: "test", version: "1", finish: false, concurrency: "exclusive" as const, strict: false, effect: "read" as const})), create: (toolId) => ({execute: async () => tools.find((tool) => tool.id === toolId)!.execute()})},
            resources: () => ({read: async () => undefined, resolve: (uri) => uri}),
            sessions: {get: () => Promise.reject(new Error("no sessions"))},
            clock: createTestClock(),
            approve: async () => ({verdict: "allow", by: "test-policy"}),
        };
    }

    test("输出 57：prepare 否决不合规则、重名与成环的贡献", () => {
        const host = createAgentHost(hostEnv());
        expect(() => host.extensions.prepare(handleOf(counter, "other"))).toThrow(ExtensionRejected);
        host.extensions.prepare(handleOf(counter));
        expect(() => host.extensions.prepare(handleOf(counter))).toThrow(expect.objectContaining({code: "duplicate-extension-id"}));
        const a = defineExtension({id: "lab.a"});
        const b = defineExtension({id: "lab.b"});
        host.extensions.prepare(handleOf(a, "lab", ["lab.b"]));
        expect(() => host.extensions.prepare(handleOf(b, "lab", ["lab.a"]))).toThrow(expect.objectContaining({code: "dependency-cycle"}));
        expect(host.diagnostics().map((item) => item.code)).toEqual(["bad-extension-id", "duplicate-extension-id", "dependency-cycle"]);
    });

    test("输出 57：发布后空闲的会话立刻装上；运行中撤回的这次运行跳过它，运行结束后重新装配", async () => {
        const model = createTestModel();
        const started = gate();
        const release = gate();
        const host = createAgentHost(hostEnv(model, [{id: "lab.hold", execute: async () => {
            started.open();
            await release.promise;
            return "好了";
        }}]));
        const created = await host.create({profile: defaultProfile.id});
        if (!created.ok) throw new Error(created.code);
        const session = created.value;
        const handle = handleOf(counter);
        host.extensions.prepare(handle);
        host.extensions.published(handle);
        await waitIdleWrites(session);
        const added = (await session.log({afterSeq: 0})).events.filter((event) => event.type === "profileChanged").map((event) => (event.data as {reason: string}).reason);
        expect(added).toEqual(["created", "plugin-added"]);
        expect((await session.snapshot()).extensions.map((item) => [item.id, item.status])).toEqual([["lab.count", "active"]]);

        model.script({tools: [{tool: "lab.hold"}]}, "完成");
        const sent = await session.send({commandId: "s1", input: {text: "问"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("no run");
        await started.promise;
        host.extensions.revoke(handle, "deactivated");
        const during = await session.snapshot();
        expect(during.extensions.map((item) => [item.id, item.status])).toEqual([["lab.count", "revoked"]]);
        expect(during.pendingReassembly).toEqual({added: [], removed: ["lab.count"]});
        release.open();
        await session.waitRun(sent.value.runId);
        await waitIdleWrites(session);
        const events = (await session.log({afterSeq: 0})).events;
        expect(events.some((event) => event.type === "lab.count/seen")).toBe(false);
        expect(events.filter((event) => event.type === "profileChanged").map((event) => (event.data as {reason: string}).reason)).toEqual(["created", "plugin-added", "plugin-removed"]);
        const after = await session.snapshot();
        expect([after.extensions, after.pendingReassembly]).toEqual([[], null]);
        expect((await session.diagnostics()).some((item) => item.code === "extension-revoked")).toBe(true);
        expect(model.requests[1]!.system.some((block) => (block as {text: string}).text === "计数器在")).toBe(false);
        await host.close(session.id);
    });

    test("输出 57：撤回后重新装配失败（依赖没了）时会话进只读", async () => {
        const host = createAgentHost(hostEnv());
        const handle = handleOf(counter);
        host.extensions.prepare(handle);
        host.extensions.published(handle);
        const created = await host.create({profile: dependent.id});
        if (!created.ok) throw new Error(created.code);
        host.extensions.revoke(handle, "uninstalled");
        await waitIdleWrites(created.value);
        expect((await created.value.snapshot()).readOnly).toEqual({code: "dependency-missing"});
        expect(await created.value.send({commandId: "x", input: {text: "问"}})).toMatchObject({ok: false, code: "read-only"});
        await host.close(created.value.id);
    });

    test("输出 57、extensions 输出 19：重新装配装上扩展之前不受理指令；关闭等它做完，迟到装上的清理照样调用", async () => {
        const model = createTestModel();
        const host = createAgentHost(hostEnv(model));
        const created = await host.create({profile: defaultProfile.id});
        if (!created.ok) throw new Error(created.code);
        const session = created.value;
        const slowMount = (extensionId: string, entered: ReturnType<typeof gate>, release: ReturnType<typeof gate>, cleaned: {count: number}) => defineExtension({id: extensionId, mount: async () => {
            entered.open();
            await release.promise;
            return () => {
                cleaned.count += 1;
            };
        }});
        const entered = gate();
        const release = gate();
        const cleaned = {count: 0};
        const handle = handleOf(slowMount("lab.slow", entered, release, cleaned));
        host.extensions.prepare(handle);
        host.extensions.published(handle);
        await entered.promise;
        expect((await session.snapshot()).pendingReassembly).toEqual({added: ["lab.slow"], removed: []});
        model.script("答");
        let answered = false;
        const sending = session.send({commandId: "s1", input: {text: "问"}}).then((result) => {
            answered = true;
            return result;
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(answered).toBe(false);
        release.open();
        const sent = await sending;
        if (!sent.ok || sent.value.runId === null) throw new Error("no run");
        await session.waitRun(sent.value.runId);

        const entered2 = gate();
        const release2 = gate();
        const cleaned2 = {count: 0};
        const handle2 = handleOf(slowMount("lab.slow2", entered2, release2, cleaned2));
        host.extensions.prepare(handle2);
        host.extensions.published(handle2);
        await entered2.promise;
        const closing = host.close(session.id);
        let closed = false;
        void closing.then(() => {
            closed = true;
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(closed).toBe(false);
        release2.open();
        await closing;
        // lab.slow 的清理调用两次：第二次重新装配先摘下全部再装回，关闭时又摘下一次。
        expect([cleaned.count, cleaned2.count]).toEqual([2, 1]);
    });

    test("输出 57：依赖补回、重新装配成功后解除只读；旧代次的句柄重复撤回不影响同 id 的新代次", async () => {
        const host = createAgentHost(hostEnv());
        const first = handleOf(counter);
        host.extensions.prepare(first);
        host.extensions.published(first);
        const created = await host.create({profile: dependent.id});
        if (!created.ok) throw new Error(created.code);
        const session = created.value;
        host.extensions.revoke(first, "uninstalled");
        await waitIdleWrites(session);
        expect((await session.snapshot()).readOnly).toEqual({code: "dependency-missing"});
        const second = handleOf(counter);
        host.extensions.prepare(second);
        host.extensions.published(second);
        await waitIdleWrites(session);
        expect((await session.snapshot()).readOnly).toBeNull();
        host.extensions.revoke(first, "uninstalled");
        await waitIdleWrites(session);
        expect(host.list().map((item) => item.id)).toEqual(["lab.count"]);
        expect((await session.snapshot()).readOnly).toBeNull();
        await host.close(session.id);
    });

    test("输出 57：revoke 交回的 Promise 在各会话摘下扩展、清理函数跑完之后完成；运行中的会话等这次运行结束", async () => {
        const log: string[] = [];
        const watcher = defineExtension({id: "lab.watcher", mount: () => () => void log.push("cleanup")});
        const started = gate();
        const release = gate();
        const model = createTestModel();
        const host = createAgentHost(hostEnv(model, [{id: "lab.hold", execute: async () => {
            started.open();
            await release.promise;
            return "好了";
        }}]));
        const idle = handleOf(watcher);
        host.extensions.prepare(idle);
        host.extensions.published(idle);
        const created = await host.create({profile: defaultProfile.id});
        if (!created.ok) throw new Error(created.code);
        await host.extensions.revoke(idle, "uninstalled");
        expect(log).toEqual(["cleanup"]);

        const busy = handleOf(watcher);
        host.extensions.prepare(busy);
        host.extensions.published(busy);
        await waitIdleWrites(created.value);
        const session = created.value;
        model.script({tools: [{tool: "lab.hold"}]}, "完成");
        const sent = await session.send({commandId: "run", input: {text: "问"}});
        if (!sent.ok) throw new Error(sent.code);
        await started.promise;
        let revoked = false;
        const revoking = host.extensions.revoke(busy, "uninstalled").then(() => void (revoked = true));
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(revoked).toBe(false);
        release.open();
        await revoking;
        expect(log).toEqual(["cleanup", "cleanup"]);
        await host.close(session.id);
    });

    test("输出 57：重新装配中途失败——写日志失败时依赖缺失的只读不解除；宿主建资源失败进只读 reassembly-failed，不抛出、能关闭", async () => {
        const base = hostEnv();
        let failWrites = false;
        const store: SessionEnv["store"] = {...base.store, append: async (handle, events) => (failWrites ? {ok: false, code: "storage-failed", detail: {message: "injected"}} : base.store.append(handle, events))};
        const host = createAgentHost({...base, store});
        const first = handleOf(counter);
        host.extensions.prepare(first);
        host.extensions.published(first);
        const created = await host.create({profile: dependent.id});
        if (!created.ok) throw new Error(created.code);
        host.extensions.revoke(first, "uninstalled");
        await waitIdleWrites(created.value);
        failWrites = true;
        // 补回的是新版本：装配哈希变了，要写 profileChanged（哈希不变时不写日志、直接解除只读）。
        const second = handleOf(defineExtension({...counter, version: "2"}));
        host.extensions.prepare(second);
        host.extensions.published(second);
        await waitIdleWrites(created.value);
        expect((await created.value.snapshot()).readOnly).toEqual({code: "dependency-missing"});

        let failResources = false;
        const other = createAgentHost({...hostEnv(), resources: () => {
            if (failResources) throw new Error("建资源失败");
            return {read: async () => undefined, resolve: (uri) => uri};
        }});
        const opened = await other.create({profile: defaultProfile.id});
        if (!opened.ok) throw new Error(opened.code);
        failResources = true;
        const handle = handleOf(counter);
        other.extensions.prepare(handle);
        other.extensions.published(handle);
        await waitIdleWrites(opened.value);
        expect((await opened.value.snapshot()).readOnly).toEqual({code: "reassembly-failed"});
        expect((await opened.value.diagnostics()).some((item) => item.code === "reassembly-failed")).toBe(true);
        await other.close((await opened.value.snapshot()).header.id);
    });

    test("输出 57：运行中撤回时，链里还没走到的那层拦截跳过、mount 里拿着的回调不再执行；进行中的反应的输出丢掉", async () => {
        const model = createTestModel();
        const host = createAgentHost(hostEnv(model));
        const outerEntered = gate();
        const outerRelease = gate();
        let innerCalls = 0;
        let callbackRuns = 0;
        let later: (() => void) | null = null;
        // 拦截序按 id：lab.a-outer 在外层，lab.b-inner 在里层。
        const outer = defineExtension({id: "lab.a-outer", intercept: {model: async (request, next) => {
            outerEntered.open();
            await outerRelease.promise;
            return next(request);
        }}});
        const inner = defineExtension({id: "lab.b-inner", intercept: {model: async (request, next) => {
            innerCalls += 1;
            return next(request);
        }}, mount: (ctx) => {
            later = ctx.callback(() => {
                callbackRuns += 1;
            });
        }});
        const handles = [handleOf(outer), handleOf(inner)];
        for (const handle of handles) host.extensions.prepare(handle);
        for (const handle of handles) host.extensions.published(handle);
        const created = await host.create({profile: defaultProfile.id});
        if (!created.ok) throw new Error(created.code);
        const session = created.value;
        model.script("答");
        const sent = await session.send({commandId: "s1", input: {text: "问"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("no run");
        await outerEntered.promise;
        host.extensions.revoke(handles[1]!, "deactivated");
        later!();
        outerRelease.open();
        expect((await session.waitRun(sent.value.runId)).reason).toBe("completed");
        expect([innerCalls, callbackRuns]).toEqual([0, 0]);
        await host.close(session.id);

        const reactEntered = gate();
        const reactRelease = gate();
        const reacting = defineExtension({id: "lab.react", events: {leak: ext()}, on: {assistant: async (_event, ctx) => {
            reactEntered.open();
            await reactRelease.promise;
            ctx.emit("leak");
        }}});
        const host2 = createAgentHost(hostEnv(model));
        const reactHandle = handleOf(reacting);
        host2.extensions.prepare(reactHandle);
        host2.extensions.published(reactHandle);
        const created2 = await host2.create({profile: defaultProfile.id});
        if (!created2.ok) throw new Error(created2.code);
        model.script("答");
        const sent2 = await created2.value.send({commandId: "s2", input: {text: "问"}});
        if (!sent2.ok || sent2.value.runId === null) throw new Error("no run");
        await reactEntered.promise;
        host2.extensions.revoke(reactHandle, "deactivated");
        reactRelease.open();
        await created2.value.waitRun(sent2.value.runId);
        expect(types((await created2.value.log({afterSeq: 0})).events)).not.toContain("lab.react/leak");
        expect((await created2.value.diagnostics()).some((item) => item.code === "late-result-dropped" && item.extension === "lab.react")).toBe(true);
        await host2.close(created2.value.id);
    });

    const defaultProfile = defineProfile({id: "test.host", version: "1", name: "h", description: "h", system: "系统"}) as AnyProfile;
    const dependent = defineProfile({id: "test.dependent", version: "1", name: "d", description: "d", dependsOn: [counter]}) as AnyProfile;
});

/** 重新装配在空闲时异步进行：等它的写入落盘（队列空了、没有待重新装配的）。 */
async function waitIdleWrites(session: import("../api/index.js").SessionApi): Promise<void> {
    for (;;) {
        const snapshot = await session.snapshot();
        if (snapshot.pendingReassembly === null) {
            await new Promise<void>((resolve) => setImmediate(resolve));
            if ((await session.snapshot()).head === snapshot.head) return;
            continue;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
}
