import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {resolveAgentTempRoot} from "@notnotype/neuro-book-test-support/paths";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {resolvePiApiKeyForModelFromConfig, resolvePiModelFromConfig, type ResolvedPiModel} from "nbook/server/agent/harness/model-resolver";
import {resolvePiModelsFromConfig} from "nbook/server/agent/harness/pi-runtime-resolver";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {messageText} from "nbook/server/agent/messages/message-utils";
import {loadGlobalEffectiveConfigSync} from "nbook/server/config/config-service";
import {createVariableDefinitionArtifactPathContextResolver} from "nbook/server/agent/variables/definition-artifact";
import {resolveUserNbookRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import type {AgentInvocationResult} from "nbook/server/agent/harness/types";
import type {EffectiveConfig} from "nbook/server/config/types";

const PROFILE_KEY = "leader.default";
/** 应用包根：隔离 smoke workspace 没有 runtimePaths 时，变量 artifact 仍按应用资产的编译产物解析。 */
const APPLICATION_ROOT = path.resolve(import.meta.dirname, "../..");

export type AgentSmokeHarness = Pick<
    NeuroAgentHarness,
    "repo" | "createAgent" | "invokeAgent" | "runCommand" | "drainBackgroundTasks" | "dispose"
>;

export type AgentSmokeOptions = {
    workspaceRoot: string;
    modelLabel: string;
    createHarness: (workspaceRoot: string) => AgentSmokeHarness | Promise<AgentSmokeHarness>;
    compact?: boolean;
};

export type AgentSmokeReport = {
    ok: boolean;
    modelLabel: string;
    status: AgentInvocationResult["status"];
    compactionStatus: "completed" | "error" | "not-requested";
    sessionEntries: number;
    sessionPath: string;
    durationMs: number;
    output: string;
};

export function resolveAgentSmokeWorkspaceRoot(stamp = new Date().toISOString().replace(/[:.]/g, "-")): string {
    return path.resolve(resolveAgentTempRoot(), "agent-smoke", stamp);
}

/**
 * 执行一次 Agent smoke；Provider、模型和 Harness 构造由调用方注入，流程自身负责清理。
 * 只要 Harness 构造成功，任何 invoke、后台任务或 dispose 失败都不会跳过一次 dispose。
 */
export async function runAgentSmoke(options: AgentSmokeOptions): Promise<AgentSmokeReport> {
    const startedAt = Date.now();
    let harness: AgentSmokeHarness | undefined;
    try {
        await fs.mkdir(options.workspaceRoot, {recursive: true});
        harness = await options.createHarness(options.workspaceRoot);
        const agent = await harness.createAgent({
            profileKey: PROFILE_KEY,
            initial: {role: "smoke"},
        });
        const result = await harness.invokeAgent({
            sessionId: agent.sessionId,
            mode: "prompt",
            message: {text: "用一句中文回复：agent session smoke ok。"},
        });
        const snapshot = await harness.repo.readSession(agent.sessionId);
        const context = harness.repo.reduce(snapshot);
        const compactionStatus = options.compact
            ? await runCompactionSmoke(harness, agent.sessionId)
            : "not-requested";
        const finalSnapshot = await harness.repo.readSession(agent.sessionId);
        const sessionPath = path.join(
            options.workspaceRoot,
            ".nbook",
            "agent",
            "sessions",
            `${String(agent.sessionId)}.jsonl`,
        );
        const finalText = result.finalMessage ?? result.reportResult?.result ?? "";
        const output = [
            "# Agent Smoke",
            "",
            `Profile: ${PROFILE_KEY}`,
            `Model: ${options.modelLabel}`,
            `Workspace: ${options.workspaceRoot}`,
            `Session: ${String(agent.sessionId)}`,
            `Session JSONL: ${sessionPath}`,
            `Status: ${result.status}`,
            `Duration: ${String(Date.now() - startedAt)}ms`,
            `Session entries: ${String(finalSnapshot.entries.length)}`,
            `Compaction: ${compactionStatus}`,
            result.usage ? `Usage: ${JSON.stringify(result.usage)}` : "Usage: (not reported)",
            "",
            "## Result",
            "",
            result.reportResult ? JSON.stringify(result.reportResult, null, 2) : result.finalMessage ?? "(empty)",
            "",
            "## Last Messages",
            "",
            ...context.messages.slice(-6).map((message, index) => `${String(index + 1)}. ${message.role}: ${truncate(messageText(message as never))}`),
            "",
        ].join("\n");
        await harness.drainBackgroundTasks();
        return {
            ok: result.status !== "error" && compactionStatus !== "error" && finalText.includes("smoke"),
            modelLabel: options.modelLabel,
            status: result.status,
            compactionStatus,
            sessionEntries: finalSnapshot.entries.length,
            sessionPath,
            durationMs: Date.now() - startedAt,
            output,
        };
    } finally {
        try {
            await harness?.dispose();
        } finally {
            await fs.rm(options.workspaceRoot, {recursive: true, force: true});
        }
    }
}

/** `leader.default` smoke 的模型与凭据解析结果。 */
export type AgentSmokeModelSetup = {
    config: EffectiveConfig;
    model: ResolvedPiModel;
    apiKey: string;
};

/**
 * 解析 `leader.default` smoke 的模型与凭据；缺配置时抛错，由调用方决定 gate 语义
 * （CLI 直接失败退出，真实模型测试转为 skip）。
 */
export function resolveAgentSmokeModelSetup(): AgentSmokeModelSetup {
    const config = loadGlobalEffectiveConfigSync();
    const model = resolvePiModelFromConfig(config, PROFILE_KEY);
    const apiKey = resolvePiApiKeyForModelFromConfig(config, model);
    if (!apiKey) {
        throw new Error(`provider ${model.provider} 未配置 apiKey，请先在 workspace/.nbook/config.json 或设置页中填写真实 Provider 密钥`);
    }
    return {config, model, apiKey};
}

/**
 * 把当前 Global Config 复制进隔离 smoke workspace；Harness 运行期按 Workspace Root 读取
 * Provider 配置（apiKey、requestOptions、模型清单）。
 *
 * 副本含明文 Provider 密钥，因此只落在一次性隔离目录：随 smoke 结束删除，POSIX 下收紧为 0600；
 * Windows 依赖系统 Temp 的账户级 ACL。进程被强杀时副本可能残留（系统 Temp 内），不得挪作持久存储。
 */
export async function prepareAgentSmokeWorkspace(workspaceRoot: string): Promise<void> {
    const source = path.join(resolveUserNbookRoot(), "config.json");
    const target = path.join(workspaceRoot, ".nbook", "config.json");
    await fs.mkdir(path.dirname(target), {recursive: true});
    try {
        await fs.copyFile(source, target);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
    }
    if (process.platform !== "win32") {
        await fs.chmod(target, 0o600);
    }
}

/** 用当前 Provider 配置建立真实 Harness；CLI smoke 与真实模型测试共用同一装配。 */
export async function createAgentSmokeHarness(
    workspaceRoot: string,
    setup: AgentSmokeModelSetup,
): Promise<AgentSmokeHarness> {
    await prepareAgentSmokeWorkspace(workspaceRoot);
    return new NeuroAgentHarness({
        repo: new JsonlSessionRepository(workspaceRoot),
        definitionArtifactPathContextProvider: createVariableDefinitionArtifactPathContextResolver(APPLICATION_ROOT),
        modelResolver: () => setup.model,
        runtimeResolver: () => resolvePiModelsFromConfig(setup.config, setup.model),
    });
}

async function main(): Promise<void> {
    try {
        const setup = resolveAgentSmokeModelSetup();
        const report = await runAgentSmoke({
            workspaceRoot: resolveAgentSmokeWorkspaceRoot(),
            modelLabel: `${setup.model.provider}/${setup.model.id}`,
            compact: process.env.AGENT_SMOKE_COMPACT === "1",
            createHarness: (workspaceRoot) => createAgentSmokeHarness(workspaceRoot, setup),
        });
        console.log(report.output);
        if (!report.ok) process.exitCode = 1;
    } catch (error) {
        console.error(error instanceof Error ? error.stack ?? error.message : error);
        process.exitCode = 1;
    }
}

/** 执行一次真实手动 compaction，并等待 lifecycle 结束。 */
async function runCompactionSmoke(harness: AgentSmokeHarness, sessionId: number): Promise<"completed" | "error"> {
    await harness.runCommand(sessionId, {
        command: "compact",
        instructions: "保留本次 smoke 的用户目标、模型响应和验证结论。",
    });
    for (let attempt = 0; attempt < 300; attempt += 1) {
        const snapshot = await harness.repo.readSession(sessionId);
        const lifecycles = snapshot.entries.filter((entry) => entry.type === "invocation_lifecycle");
        const latest = lifecycles.at(-1);
        if (latest?.status === "end") return "completed";
        if (latest?.status === "error" || latest?.status === "aborted") return "error";
        const {promise, resolve} = Promise.withResolvers<void>();
        setTimeout(resolve, 200);
        await promise;
    }
    throw new Error("等待真实 compaction smoke 完成超时");
}

/** 限制 smoke 控制台输出，避免把完整注入 reference 打到终端。 */
function truncate(value: string): string {
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
}

if (import.meta.main) await main();
