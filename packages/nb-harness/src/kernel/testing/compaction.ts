/**
 * 测试用的压缩方法（t20 计划 3.8：真实方法在 t11）：`fail` 总是失败；`summarize` 经 `job.model` 请假模型写摘要，
 * 保留最后一个“轮”切点及其后的内容。
 */

import type {CompactionMethodImpl} from "../api/index.js";

export const failingCompaction: CompactionMethodImpl = async () => ({failed: "test-failure"});

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
