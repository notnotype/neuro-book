/**
 * 各步脚本共用的两件事：真实模型的配置，和把一次调用的回复打印出来。
 *
 * 服务由仓库根 `.env` 的 `NBOOK_LLM_BASE_URL`、`NBOOK_LLM_API_KEY`、`NBOOK_LLM_MODEL` 描述（与 `bun run test:llm` 同一组键，
 * 见 docs/testing/README.md 的“真实模型测试”）。内核不读环境变量：这里读出来，写进配置与 `apiKeys` 交给运行时。
 * 每个脚本跑一次就是几次真实模型调用，要花钱。
 */

import {mkdir, rm} from "node:fs/promises";
import {LLM_TEST_PROVIDER_ID, llmTestConfig} from "@notnotype/neuro-book-test-support/llm";
import {resolveAgentScratchPath} from "@notnotype/neuro-book-test-support/paths";
import type {SessionEntry} from "@notnotype/nb-harness";
import type {ApprovalMode, HarnessConfigInput} from "@notnotype/nb-harness/config";

export type LiveModel = {config: HarnessConfigInput; apiKeys: Record<string, string>};

/** 读 `.env` 里的服务，拼成一份配置：一个自建服务、它的一个模型、缺省模型指向它。 */
export function liveModel(approval: {mode?: ApprovalMode; tools?: Record<string, "allow" | "deny" | "ask">} = {}): LiveModel {
    // 运行示例就是要调真实模型：开关由这里打开，不要求运行者另设 NBOOK_LLM_TESTS
    const llm = llmTestConfig({env: {...process.env, NBOOK_LLM_TESTS: "1"}});
    if (llm === null) throw new Error("缺少 NBOOK_LLM_BASE_URL、NBOOK_LLM_API_KEY、NBOOK_LLM_MODEL：在仓库根 .env 里配置后再跑");
    return {
        config: {
            // 自建服务没有目录数据：contextWindow 要显式给，压缩阈值按它算
            providers: [{id: LLM_TEST_PROVIDER_ID, api: llm.api, baseUrl: llm.baseUrl, models: [{id: llm.model, contextWindow: 128_000}]}],
            models: {defaultModel: `${LLM_TEST_PROVIDER_ID}/${llm.model}`},
            approval: {...(approval.mode === undefined ? {} : {mode: approval.mode}), tools: approval.tools ?? {}},
        },
        apiKeys: {[LLM_TEST_PROVIDER_ID]: llm.apiKey},
    };
}

/** 最后一条助手消息的文字。 */
export function replyText(entries: readonly SessionEntry[]): string {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index]!;
        if (entry.type === "message" && entry.message.role === "assistant") {
            return entry.message.content.map((block) => (block.type === "text" ? block.text : "")).join("").trim();
        }
    }
    return "（没有助手回复）";
}

/**
 * 脚本用的临时目录：由测试支持包分配在系统 Temp 下的 Agent 临时根里（docs/testing/README.md 的临时数据规则），
 * 调用方拿到后要立刻进入 `try`，在 `finally` 里 `cleanup()`。
 */
export async function scratch(name: string): Promise<{root: string; cleanup(): Promise<void>}> {
    const root = resolveAgentScratchPath("nb-harness-examples", `${name}-${crypto.randomUUID().slice(0, 8)}`);
    await mkdir(root, {recursive: true});
    return {root, cleanup: () => rm(root, {recursive: true, force: true})};
}
