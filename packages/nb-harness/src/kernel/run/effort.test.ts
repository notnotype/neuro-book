/**
 * 请求的推理档（docs/specs/models/service.md“角色的思考档”、docs/specs/harness/models.md）：会话选的优先于角色默认，
 * 就地压缩沿用本轮的档，摘要压缩按自己模型的角色默认档、不吃会话档，审批不套档；快照给出夹取后的有效档与来源。
 */

import {describe, expect, test} from "bun:test";
import type {CompactionMethodImpl, ModelInfo} from "../api/index.js";
import {defineProfile} from "../extension/profile.js";
import {createTestSession} from "../testing/test-session.js";

const REASONING: ModelInfo = {
    id: "test/model",
    contextWindow: 100_000,
    capabilities: {vision: false, thinking: true},
    efforts: ["low", "medium", "high"],
    reasoning: {kind: "levels", levels: ["low", "medium", "high"], off: "disable", unset: null, verified: true},
};

let commands = 0;
const id = () => `effort-${(commands += 1)}`;
const HEAVY = {cacheRead: 90_000};

/** 解析到压缩角色 `lab.summary` 时给的角色默认档，别的解析给“主力”的默认档。 */
const roleDefault = (query: {readonly role?: string}): string => (query.role === "lab.summary" ? "high" : "medium");

describe("对话请求的档位", () => {
    test("会话没选时用解析到的角色的默认档；会话选了就用会话的；选“跟随”回到角色的", async () => {
        await using session = await createTestSession({modelInfo: REASONING, defaultEffort: roleDefault});
        session.model.script("一", "二", "三");
        const first = await session.say("问一");
        expect(first.requests[0]!.raw).toMatchObject({purpose: "turn", effort: "medium"});
        await session.raw.changeSettings({commandId: id(), patch: {core: {effort: "low"}}});
        const second = await session.say("问二");
        expect(second.requests[0]!.raw).toMatchObject({effort: "low"});
        await session.raw.changeSettings({commandId: id(), patch: {core: {effort: null}}});
        const third = await session.say("问三");
        expect(third.requests[0]!.raw).toMatchObject({effort: "medium"});
    });

    test("会话选了关闭：协议能关就显式关，不再发档", async () => {
        await using session = await createTestSession({modelInfo: REASONING, defaultEffort: roleDefault});
        session.model.script("好");
        await session.raw.changeSettings({commandId: id(), patch: {core: {effort: "off"}}});
        const turn = await session.say("问");
        expect(turn.requests[0]!.raw.params).toEqual({disableReasoning: true});
        expect(turn.requests[0]!.raw.effort).toBeUndefined();
    });

    test("不推理的模型：选什么都不发档", async () => {
        const plain: ModelInfo = {...REASONING, capabilities: {vision: false, thinking: false}, efforts: [], reasoning: {kind: "none"}};
        await using session = await createTestSession({modelInfo: plain, defaultEffort: roleDefault});
        session.model.script("好");
        await session.raw.changeSettings({commandId: id(), patch: {core: {effort: "high"}}});
        const turn = await session.say("问");
        expect(turn.requests[0]!.raw.effort).toBeUndefined();
    });
});

describe("会话快照里的有效档", () => {
    test("给出夹取后的有效档与来源；选的档不在模型的档里时夹到最近一档", async () => {
        await using session = await createTestSession({modelInfo: REASONING, defaultEffort: roleDefault});
        expect((await session.raw.snapshot()).model).toMatchObject({ok: true, effectiveEffort: "medium", effortSource: "role"});
        await session.raw.changeSettings({commandId: id(), patch: {core: {effort: "xhigh"}}});
        expect((await session.raw.snapshot()).model).toMatchObject({effectiveEffort: "high", effortSource: "session"});
    });
});

describe("压缩与摘要的档位", () => {
    function profileWith(onThreshold: string[]) {
        return defineProfile({id: "lab.compact", system: () => "系统", compaction: {onThreshold}} as never);
    }

    test("就地压缩沿用本轮对话的会话档；摘要压缩按它自己模型的角色默认档，不吃会话档", async () => {
        const inplace: CompactionMethodImpl = async (job) => {
            const response = await job.model({...job.request}, {purpose: "compaction", sessionModel: true});
            return {method: job.method, firstKeptEntryId: job.cuts[0]!.entryId, replacement: response.content.map((block) => (block.kind === "text" ? block.text : "")).join(""), omitted: [], tokensBefore: job.tokens, tokensAfter: 1};
        };
        const summary: CompactionMethodImpl = async (job) => {
            const response = await job.model({params: {}, headers: {}, system: [], messages: job.request.messages, tools: []}, {purpose: "compaction", role: "lab.summary"});
            return {method: job.method, firstKeptEntryId: job.cuts[0]!.entryId, replacement: response.content.map((block) => (block.kind === "text" ? block.text : "")).join(""), omitted: [], tokensBefore: job.tokens, tokensAfter: 1};
        };
        for (const [name, method, expected] of [["就地", "inplace", "low"], ["摘要", "summary", "high"]] as const) {
            await using session = await createTestSession({modelInfo: REASONING, defaultEffort: roleDefault, profile: profileWith([method]), compaction: {methods: {inplace, summary}}});
            await session.raw.changeSettings({commandId: id(), patch: {core: {effort: "low"}}});
            session.model.script("答一", {text: "答二", usage: HEAVY}, "摘要", "答三");
            await session.say("第一问");
            await session.say("第二问");
            const third = await session.say("第三问");
            const compaction = third.requests.find((request) => request.raw.purpose === "compaction");
            expect(compaction?.raw.effort, name).toBe(expected);
            expect(third.requests.find((request) => request.raw.purpose === "turn")?.raw.effort, name).toBe("low");
        }
    });
});
