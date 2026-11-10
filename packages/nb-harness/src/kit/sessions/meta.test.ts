/**
 * 会话的标题与说明（docs/specs/agent/builtin-profiles.md 输出 6–13；测试名里的编号是它的输出条目）：扩展在真实内核上何时通知、
 * 标题会话的 id。生成标题的完整流程（标题 Profile、材料、失败的诊断）经真实插件留在宿主的测试里。
 */

import {describe, expect, test} from "bun:test";

import type {CompactionJob, CompactionResult} from "../../kernel/contracts.js";
import {createTestSession} from "../../kernel/testing/index.js";
import {sessionMetaExtension, titleSessionId} from "./meta.js";
import type {MetaTrigger} from "./meta.js";

let commands = 0;

describe("会话元数据", () => {
    test("输出 6、8：触发器在真实内核上：一轮完成时通知、压缩带摘要时通知；压缩运行收口与失败的轮不通知", async () => {
        const seen: MetaTrigger[] = [];
        let summary: string | null = "前情摘要";
        const method = async (job: CompactionJob): Promise<CompactionResult> => {
            const cut = job.cuts.filter((item) => item.kind === "turn").at(-1);
            return cut === undefined ? {failed: "no-cut"} : {method: job.method, firstKeptEntryId: cut.entryId, replacement: summary, omitted: [], tokensBefore: 100, tokensAfter: 10};
        };
        await using session = await createTestSession({extensions: [sessionMetaExtension({id: "kit.session-meta", tag: "session-meta", notify: (_id, trigger) => seen.push(trigger)})], compaction: {methods: {shake: method, inplace: method}}});
        session.model.script("一", "二");
        await session.say("第一轮");
        await session.say("第二轮");
        expect(seen).toEqual([{kind: "turn"}, {kind: "turn"}]);

        const compactNow = async () => {
            const compacted = await session.raw.compact({commandId: `compact-${String((commands += 1))}`});
            if (!compacted.ok || compacted.value.runId === undefined) throw new Error(`compact failed: ${JSON.stringify(compacted)}`);
            await session.raw.waitRun(compacted.value.runId);
        };
        await compactNow();
        expect(seen.slice(2)).toEqual([{kind: "compaction", summary: "前情摘要"}]);

        session.model.script("三");
        await session.say("第三轮");
        summary = null;
        await compactNow();
        expect(seen.slice(3)).toEqual([{kind: "turn"}]);

        session.model.script({fail: "provider"});
        await session.say("这一轮失败");
        expect(seen.slice(4)).toEqual([]);
    });

    test("标题会话的 id 由前台会话 id 的哈希定：同一个会话总是同一个，不同会话不同，不超过 id 上限", () => {
        expect(titleSessionId("session-a")).toBe(titleSessionId("session-a"));
        expect(titleSessionId("session-a")).not.toBe(titleSessionId("session-b"));
        expect(titleSessionId("x".repeat(128))).toMatch(/^session-title-[0-9a-f]{32}$/u);
    });
});
