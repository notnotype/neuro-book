/**
 * 测试用的压缩方法（t20 计划 3.8：真实方法在 t11）：`fail` 总是失败；`summarize` 经 `job.model` 请假模型写摘要，
 * 保留最后一个“轮”切点及其后的内容。
 */

import type {CompactionMethodImpl} from "../api/index.js";
import {gate} from "./gate.js";

export const failingCompaction: CompactionMethodImpl = async () => ({failed: "test-failure"});

/** 停在中途的压缩：开始时 `entered` 完成，`release()` 之后交回一段固定的摘要。测试在压缩进行中发指令。 */
export function heldCompaction(): {readonly method: CompactionMethodImpl; readonly entered: Promise<void>; release(): void} {
    const entered = gate();
    const hold = gate();
    const method: CompactionMethodImpl = async (job) => {
        entered.open();
        await hold.promise;
        return {method: job.method, firstKeptEntryId: null, replacement: "摘要", omitted: [], tokensBefore: job.tokens, tokensAfter: 1, details: {require: []}};
    };
    return {method, entered: entered.promise, release: () => hold.open()};
}

export const summarizingCompaction: CompactionMethodImpl = async (job) => {
    const cut = job.cuts.filter((item) => item.kind === "turn").at(-1);
    if (cut === undefined) return {failed: "no-turn-to-keep"};
    const response = await job.model({
        params: {},
        headers: {},
        system: [{kind: "text", text: "把之前的对话写成摘要。", origin: {kind: "fixed", by: "kernel"}}],
        messages: [...job.request.messages, {role: "user", content: [{kind: "text", text: ["写摘要。", ...job.require].join("\n"), origin: {kind: "fixed", by: "kernel"}}]}],
        tools: [],
    }, {purpose: "compaction"});
    if (response.stopReason === "error" || response.stopReason === "aborted") return {failed: "model-failed"};
    const replacement = response.content.map((block) => (block.kind === "text" ? block.text : "")).join("");
    return {method: job.method, firstKeptEntryId: cut.entryId, replacement, omitted: [], tokensBefore: job.tokens, tokensAfter: cut.tokensKept + Math.ceil(replacement.length)};
};
