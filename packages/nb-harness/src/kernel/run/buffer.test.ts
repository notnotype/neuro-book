/**
 * 输入缓冲区的条目状态：就绪与留着、放行、回到空闲时留着（docs/specs/harness/runtime.md 输出 103–110）。
 * 内核是真的（日志、归约、单写者）；日志里事先写好的事件经真实的 JSONL 存储写下、再打开。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import type {LogEvent} from "../api/index.js";
import {createJsonlStore} from "../log/jsonl-store.js";
import {createTestSession, defaultTestProfile} from "../testing/test-session.js";

let root: string;
beforeAll(async () => {
    root = await createTestTmpRoot("nb-harness-buffer-");
});
afterAll(async () => {
    await rm(root, {recursive: true, force: true});
});

/** 在 JSONL 存储里写下一个会话：会话创建、装配，再加上给定的 session 事件。 */
async function writeSession(id: string, events: readonly {type: string; data: unknown}[]): Promise<void> {
    const store = createJsonlStore({root});
    const created = await store.create({format: 1, id, createdAt: 0, profile: defaultTestProfile.id, questions: "user"});
    if (!created.ok) throw new Error(created.code);
    const at = (seq: number, type: string, parent: string | null, scope: "path" | "session", data: unknown): LogEvent => ({id: `e${seq}`, seq, at: seq, parent, scope, kind: "ctrl", type, version: 1, source: "kernel", data: data as never, batch: {id: `b${seq}`, n: 1, of: 1}});
    const head = [
        at(1, "sessionCreated", null, "path", {initial: {}}),
        at(2, "profileChanged", null, "session", {profile: defaultTestProfile.id, hash: "old", from: null, reason: "created", manifest: []}),
    ];
    const rest = events.map((event, index) => at(index + 3, event.type, null, "session", event.data));
    for (const event of [...head, ...rest]) {
        const appended = await store.append(created.value, [event]);
        if (!appended.ok) throw new Error(appended.code);
    }
    await store.close(created.value);
}

const queued = (id: string, extra: Record<string, unknown> = {}) => ({type: "inputQueued", data: {id, mode: "followup", input: {text: id}, ...extra}});

describe("缓冲区条目的状态（harness.runtime 输出 103、109）", () => {
    test("输出 103：状态只由会话级事件归约；留着带原因与停的人，放行转回就绪", async () => {
        await writeSession("states", [
            queued("a"),
            queued("b"),
            queued("c", {by: {kind: "host", source: {plugin: "nbook.schedule", label: "每周简报"}}, state: "held", cause: {queued: "idle"}}),
            queued("d", {mode: "steer"}),
            {type: "inputHeld", data: {ids: ["a", "b", "d"], cause: {end: "aborted"}, heldBy: {kind: "user"}}},
            {type: "inputReleased", data: {ids: ["b", "d"], mode: "followups"}},
        ]);
        await using session = await createTestSession({store: {root}, open: "states"});
        const buffer = (await session.raw.snapshot()).buffer;
        expect(buffer.map((item) => [item.id, item.state, item.mode])).toEqual([
            ["a", "held", "followup"],
            ["b", "ready", "followup"],
            ["c", "held", "followup"],
            ["d", "ready", "followup"],
        ]);
        expect(buffer[0]).toMatchObject({cause: {end: "aborted"}, heldBy: {kind: "user"}});
        expect(buffer[1]).not.toHaveProperty("cause");
        expect(buffer[1]).not.toHaveProperty("heldBy");
        expect(buffer[2]).toMatchObject({cause: {queued: "idle"}, by: {kind: "host", source: {plugin: "nbook.schedule"}}});
    });

    test("输出 109：已经留着的话再遇到收口不改原因与停的人", async () => {
        await writeSession("keep-cause", [
            queued("a"),
            {type: "inputHeld", data: {ids: ["a"], cause: {end: "error", code: "provider"}}},
            {type: "inputHeld", data: {ids: ["a"], cause: {end: "aborted"}, heldBy: {kind: "user"}}},
        ]);
        await using session = await createTestSession({store: {root}, open: "keep-cause"});
        const [entry] = (await session.raw.snapshot()).buffer;
        expect(entry).toMatchObject({state: "held", cause: {end: "error", code: "provider"}});
        expect(entry).not.toHaveProperty("heldBy");
    });

    test("旧日志：没有状态的条目都是就绪的，旧原因 user 的移除照样移除", async () => {
        await writeSession("legacy", [queued("a"), queued("b"), {type: "inputRemoved", data: {id: "a", reason: "user"}}]);
        await using session = await createTestSession({store: {root}, open: "legacy"});
        expect((await session.raw.snapshot()).buffer.map((item) => [item.id, item.state])).toEqual([["b", "ready"]]);
    });
});
