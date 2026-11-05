/**
 * 就地压缩（docs/specs/agent/compaction.md 输出 2）：原样的请求末尾追加一条压缩请求，前缀和对话请求相同，吃得到缓存。
 * 工具声明不动，否则前缀就变了；有的端点不支持禁止工具调用（DeepSeek V4 Flash），回复带工具调用就算失败，换下一个方法。
 */

import {estimateTokens} from "@notnotype/nb-harness/kernel";
import type {CompactionMethodImpl} from "@notnotype/nb-harness/kernel/contracts";

import {pickCut, summaryResult} from "./cuts";
import {inplacePrompt} from "./prompts";
import {modelFailure, outputLimit, responseText, sumUsage} from "./replies";

export const inplaceMethod: CompactionMethodImpl = async (job) => {
    // 已经溢出的请求再加一段只会再溢出（t11 决定 2）。
    if (job.reason === "overflow") return {failed: "overflowed"};
    const info = job.modelInfo({sessionModel: true});
    if (info === null) return {failed: "no-session-model"};
    const {purpose: _purpose, model: _model, ...request} = job.request;
    const response = await job.model({
        ...request,
        params: {...request.params, maxTokens: outputLimit(info)},
        toolChoice: "none",
        messages: [...request.messages, {role: "user", content: [{kind: "text", text: inplacePrompt(job.require), origin: {kind: "fixed", by: "kernel"}}]}],
    }, {purpose: "compaction", sessionModel: true});
    const failure = modelFailure(response);
    if (failure !== null) return {failed: failure};
    const summary = responseText(response);
    const cut = pickCut(job.cuts, info.contextWindow);
    return {method: job.method, ...summaryResult(job, cut, estimateTokens(summary)), replacement: summary, omitted: [], details: {model: response.model, usage: sumUsage([response.usage]), require: [...job.require]}};
};
