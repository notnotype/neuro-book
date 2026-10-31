/**
 * 纵切：存储、归约、队列、不带工具的循环、视图与会话的宿主面连起来跑（t20 第 2 片）。
 * 测试名里的编号是 docs/specs/harness/session.md 的输出条目与验收场景。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import type {AnyProfile, LogEvent, SessionEnv} from "../api/index.js";
import {defineProfile} from "../extension/profile.js";
import {nodeFiles, type FilePort} from "../log/files.js";
import {createJsonlStore} from "../log/jsonl-store.js";
import {createTestClock} from "../testing/clock.js";
import {createTestModel} from "../testing/model.js";
import {createTestSession, defaultTestProfile} from "../testing/test-session.js";
import {closeSession, createSession, openSession} from "./session.js";

let root = "";
beforeAll(async () => {
    root = await createTestTmpRoot("nb-harness", "kernel-session");
});
afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

const types = (events: readonly LogEvent[]) => events.map((event) => event.type);

describe.each([["内存存储", false], ["JSONL 存储", true]] as const)("一轮对话（%s）", (_name, jsonl) => {
    const options = () => (jsonl ? {store: {root}} : {});

    test("输出 18：发送受理批含 runStarted 与取走输入；回复写成 assistant，轮与运行收口", async () => {
        await using session = await createTestSession(options());
        session.model.script("你好，我在。");
        const report = await session.say("你好");
        expect(report.result).toMatchObject({reason: "completed", stopReason: "stop", text: "你好，我在。", error: null});
        expect(types(report.events)).toEqual(["inputQueued", "runStarted", "inputConsumed", "turnStarted", "input", "commandAccepted", "modelStarted", "assistant", "turnEnded", "runEnded"]);
        expect(report.events.find((event) => event.type === "input")?.position).toEqual({kind: "attachment", turn: (report.events.find((event) => event.type === "turnStarted")!.data as {turnId: string}).turnId});
        expect(report.requests[0]!.outline()).toEqual(["system: fixed:profile", "user: event:input"]);
    });

    test("已提交的轮进下一次请求的历史；重开之后接着聊，历史还在", async () => {
        await using session = await createTestSession(options());
        session.model.script("一", "二", "三");
        await session.say("第一句");
        const second = await session.say("第二句");
        expect(second.requests[0]!.outline()).toEqual(["system: fixed:profile", "user: event:input", "assistant: event:assistant", "user: event:input"]);
        await session.reopen();
        const third = await session.say("第三句");
        expect(third.requests[0]!.outline()).toHaveLength(6);
        expect(third.requests[0]!.raw.messages.at(-1)!.content).toMatchObject([{kind: "text", text: "第三句"}]);
        expect(third.result.text).toBe("三");
    });

    test("输出 17：重发同一个 commandId 只生效一次，重启之后同样", async () => {
        await using session = await createTestSession(options());
        session.model.script("好");
        const first = await session.raw.send({commandId: "same", input: {text: "一次"}});
        if (!first.ok || first.value.runId === null) throw new Error("send failed");
        await session.raw.waitRun(first.value.runId);
        const again = await session.raw.send({commandId: "same", input: {text: "一次"}});
        expect(again).toEqual({ok: true, value: first.value, seq: first.seq, replayed: true});
        await session.reopen();
        const afterRestart = await session.raw.send({commandId: "same", input: {text: "一次"}});
        expect(afterRestart).toMatchObject({ok: true, value: first.value, replayed: true});
        expect((await session.raw.log({afterSeq: 0})).events.filter((event) => event.type === "commandAccepted")).toHaveLength(1);
    });
});

describe("指令与失败", () => {
    test("空输入不写日志", async () => {
        await using session = await createTestSession();
        const head = (await session.raw.snapshot()).head;
        expect(await session.raw.send({commandId: "c", input: {text: "  "}})).toEqual({ok: false, code: "empty-input"});
        expect((await session.raw.snapshot()).head).toBe(head);
    });

    test("模型失败：写 modelFailed，运行以 error 收口，结果带错误类别", async () => {
        await using session = await createTestSession();
        session.model.script({fail: "rate_limit"});
        const report = await session.say("你好");
        expect(types(report.events).slice(-3)).toEqual(["modelFailed", "turnEnded", "runEnded"]);
        expect(report.result).toMatchObject({reason: "error", stopReason: "error", error: {kind: "rate_limit"}});
    });

    test("空闲时入队的 followup 在这一轮结束后开下一轮，同一次运行", async () => {
        await using session = await createTestSession();
        session.model.script("答 B", "答 A");
        await session.raw.enqueue({commandId: "q", input: {text: "A"}, mode: "followup"});
        const report = await session.say("B");
        expect(report.requests.map((request) => request.raw.messages.at(-1)!.content[0])).toMatchObject([{text: "B"}, {text: "A"}]);
        expect(types(report.events).filter((type) => type === "runStarted" || type === "runEnded" || type === "turnStarted")).toEqual(["runStarted", "turnStarted", "turnStarted", "runEnded"]);
        expect(report.result.text).toBe("答 A");
    });

    test("用量是这次运行全部回复的和", async () => {
        await using session = await createTestSession();
        session.model.script({text: "一", usage: {input: 100, output: 7}}, {text: "二", usage: {input: 120, output: 3}});
        await session.raw.enqueue({commandId: "q", input: {text: "下一个"}, mode: "followup"});
        const report = await session.say("第一个");
        expect(report.result.usage).toMatchObject({input: 220, output: 10, complete: true});
    });
});

describe("打开、恢复与只读", () => {
    function env(store: SessionEnv["store"], profile: AnyProfile, model = createTestModel()): SessionEnv {
        return {
            store,
            profiles: {resolve: (key) => (key === profile.id ? profile : undefined)},
            models: model.port,
            tools: {declarations: () => [], create: () => Promise.reject(new Error("no tools"))},
            resources: () => ({read: async () => undefined, resolve: (uri) => uri}),
            sessions: {get: () => Promise.reject(new Error("no sessions"))},
            clock: createTestClock(),
            approve: async () => ({verdict: "allow", by: "test-policy"}),
        };
    }

    test("场景 2、输出 12：写失败后等运行的调用方以 log-broken 完成；关闭成功；重开看到 runEnded{interrupted}", async () => {
        let writes = 0;
        let failFrom = Number.POSITIVE_INFINITY;
        const failing: FilePort = {
            ...nodeFiles,
            async openAppend(path) {
                const file = await nodeFiles.openAppend(path);
                return {...file, async write(data, position) {
                    writes += 1;
                    if (writes >= failFrom) throw Object.assign(new Error("ENOSPC: no space left on device"), {code: "ENOSPC"});
                    await file.write(data, position);
                }};
            },
        };
        const model = createTestModel();
        model.script("不会写下的回复");
        const created = await createSession(env(createJsonlStore({root, files: failing}), defaultTestProfile, model), {profile: defaultTestProfile.id, id: "broken-write"});
        if (!created.ok) throw new Error(created.code);
        const session = created.value;
        // 受理批写下之后，下一次写（modelStarted）失败。
        failFrom = writes + 2;
        const sent = await session.send({commandId: "c", input: {text: "你好"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send failed");
        const result = await session.waitRun(sent.value.runId);
        expect(result).toMatchObject({reason: "error", error: {kind: "local", code: "log-broken"}});
        expect((await session.snapshot()).status).toEqual({state: "broken", code: "log-broken"});
        expect(await session.send({commandId: "d", input: {text: "再来"}})).toEqual({ok: false, code: "log-broken"});
        await closeSession(session);

        const reopened = await openSession(env(createJsonlStore({root}), defaultTestProfile), "broken-write");
        if (!reopened.ok) throw new Error(reopened.code);
        const events = await reopened.value.path();
        expect(types(events).slice(-2)).toEqual(["turnEnded", "runEnded"]);
        expect(events.at(-1)!.data).toMatchObject({runId: sent.value.runId, reason: "interrupted"});
        expect(await reopened.value.runResult({runId: sent.value.runId})).toMatchObject({reason: "interrupted", stopReason: "aborted"});
        await closeSession(reopened.value);
    });

    test("打开时 Profile 哈希变了：受理任何指令之前写 profileChanged{code-updated}", async () => {
        const store = createJsonlStore({root});
        const v1 = defineProfile({id: "test.versioned", version: "1", name: "v", description: "v"});
        const v2 = defineProfile({id: "test.versioned", version: "2", name: "v", description: "v"});
        const created = await createSession(env(store, v1), {profile: v1.id, id: "versioned"});
        if (!created.ok) throw new Error(created.code);
        await closeSession(created.value);
        const same = await openSession(env(store, v1), "versioned");
        if (!same.ok) throw new Error(same.code);
        expect((await same.value.log({afterSeq: 0})).events.filter((event) => event.type === "profileChanged")).toHaveLength(1);
        await closeSession(same.value);
        const updated = await openSession(env(store, v2), "versioned");
        if (!updated.ok) throw new Error(updated.code);
        const changes = (await updated.value.log({afterSeq: 0})).events.filter((event) => event.type === "profileChanged");
        expect(changes.map((event) => (event.data as {reason: string}).reason)).toEqual(["created", "code-updated"]);
        expect((changes[1]!.data as {from: string}).from).toBe((changes[0]!.data as {hash: string}).hash);
        await closeSession(updated.value);
    });

    test("会话头里的 Profile 解析不到：以只读打开，能查询，发送得 read-only", async () => {
        const store = createJsonlStore({root});
        const created = await createSession(env(store, defaultTestProfile), {profile: defaultTestProfile.id, id: "orphan"});
        if (!created.ok) throw new Error(created.code);
        await closeSession(created.value);
        const other = defineProfile({id: "test.other", version: "1", name: "o", description: "o"});
        const opened = await openSession(env(store, other), "orphan");
        if (!opened.ok) throw new Error(opened.code);
        expect((await opened.value.snapshot()).readOnly).toEqual({code: "unknown-profile"});
        expect(await opened.value.send({commandId: "c", input: {text: "你好"}})).toEqual({ok: false, code: "read-only"});
        await closeSession(opened.value);
    });

    test("输出 11：同一会话打开时再打开得 session-busy，关闭后能打开", async () => {
        const store = createJsonlStore({root});
        const created = await createSession(env(store, defaultTestProfile), {profile: defaultTestProfile.id, id: "busy"});
        if (!created.ok) throw new Error(created.code);
        expect(await openSession(env(store, defaultTestProfile), "busy")).toMatchObject({ok: false, code: "session-busy"});
        await closeSession(created.value);
        const opened = await openSession(env(store, defaultTestProfile), "busy");
        expect(opened.ok).toBe(true);
        if (opened.ok) await closeSession(opened.value);
    });
});
