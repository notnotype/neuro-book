/**
 * 子代理的会话树（docs/specs/agent/subagents.md 输出 21）：真实内核、内存存储与句柄表，读索引的函数包一层改时序。
 */

import {describe, expect, test} from "bun:test";

import {createAgentHost, createMemoryStore} from "@notnotype/nb-harness/kernel";
import {createTestClock, createTestModel, defaultTestProfile} from "@notnotype/nb-harness/kernel/testing";
import {SessionTable} from "@notnotype/nb-harness/kit/sessions";
import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

import {JobCenter} from "./backend/jobs/center";
import {SessionRelations} from "./backend/subagents/relations";
import {SubagentTree} from "./backend/subagents/tree";

describe("会话树（subagents.md 输出 21）", () => {
    test("读索引的途中后代写了日志：读到的旧索引不留在缓存里，下一次取到这次运行的收口", async () => {
        const model = createTestModel();
        const store = createMemoryStore();
        const host = createAgentHost({
            store,
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
        for (const id of ["p", "c"]) {
            const created = await table.create({profile: defaultTestProfile.id, id});
            if (!created.ok) throw new Error(created.code);
        }
        const relations = new SessionRelations();
        relations.register({id: "c", caller: {kind: "session", id: "p", callId: "k1", invocation: "inv-1"}});
        // 第一次读索引：先读到（运行之前的）索引，再挂住，等子会话跑完一次运行才交回。
        let release: () => void = () => undefined;
        let hold: Promise<void> | null = new Promise<void>((resolve) => {
            release = resolve;
        });
        let arrived: () => void = () => undefined;
        const readStarted = new Promise<void>((resolve) => {
            arrived = resolve;
        });
        const tree = new SubagentTree({
            relations,
            table,
            jobs: new JobCenter({clock: createTestClock(), limits: () => ({perSession: 8, global: 16}), newId: () => crypto.randomUUID()}),
            entry: async (id) => {
                const read = await store.entry(id);
                if (id === "c" && hold !== null) {
                    const waiting = hold;
                    hold = null;
                    arrived();
                    await waiting;
                }
                return read;
            },
            catalog: () => [],
            clock: {now: () => 0, schedule: () => () => undefined} as unknown as RuntimeClock,
        });
        try {
            const reading = tree.tree("p");
            await readStarted;
            model.script("好了。");
            const sent = await table.view("c").send({commandId: "c-1", input: {text: "做"}});
            if (!sent.ok || sent.value.runId === null) throw new Error(JSON.stringify(sent));
            await table.view("c").waitRun(sent.value.runId);
            release();
            await reading;
            const [item] = await tree.tree("p");
            expect(item!.runs).toContainEqual(expect.objectContaining({runId: sent.value.runId, reason: "completed"}));
        } finally {
            release();
            await table.stop();
        }
    });
});
