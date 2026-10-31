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
        host.extensions.prepare(handleOf(counter));
        host.extensions.published(handleOf(counter));
        await waitIdleWrites(session);
        const added = (await session.log({afterSeq: 0})).events.filter((event) => event.type === "profileChanged").map((event) => (event.data as {reason: string}).reason);
        expect(added).toEqual(["created", "plugin-added"]);
        expect((await session.snapshot()).extensions.map((item) => [item.id, item.status])).toEqual([["lab.count", "active"]]);

        model.script({tools: [{tool: "lab.hold"}]}, "完成");
        const sent = await session.send({commandId: "s1", input: {text: "问"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("no run");
        await started.promise;
        host.extensions.revoke(handleOf(counter), "deactivated");
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
        host.extensions.prepare(handleOf(counter));
        host.extensions.published(handleOf(counter));
        const created = await host.create({profile: dependent.id});
        if (!created.ok) throw new Error(created.code);
        host.extensions.revoke(handleOf(counter), "uninstalled");
        await waitIdleWrites(created.value);
        expect((await created.value.snapshot()).readOnly).toEqual({code: "dependency-missing"});
        expect(await created.value.send({commandId: "x", input: {text: "问"}})).toMatchObject({ok: false, code: "read-only"});
        await host.close(created.value.id);
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
