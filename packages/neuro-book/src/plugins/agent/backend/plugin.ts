/**
 * `nbook.agent` 的服务端入口：依赖、接收、激活与停止。装配在 `agent.ts`。
 *
 * 停止从 `context.signal` 开始：平台在停止时先撤回交给本入口接收者的贡献、再跑 `onStop`，而撤回会让打开着的会话
 * 重新装配、工具撤回还要等执行中的调用。所以信号一触发就关门、把会话按 `interrupted` 关掉（sessions.md 输出 14），
 * 之后的撤回落在已关的会话上什么也不做；`onStop` 等这次关闭完成。
 */

import {lstat, mkdir} from "node:fs/promises";
import {join} from "node:path";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry, provideService} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";
import type {PluginDefinition, TriggerActivationResult} from "@notnotype/nb-runtime/plugins";

import {SCHEMES_POINT, workspaceFilesKey} from "nbook/plugins/files/shared/contracts";
import {modelsKey} from "nbook/plugins/models/shared/contracts";
import {settingsKey} from "nbook/plugins/settings/shared/contracts";
import {clockKey, stateRootKey} from "nbook/shared/host";

import {descriptor} from "../plugin";
import {agentKey} from "../shared/contracts";
import {agentSessionsContract} from "../shared/remote";
import {AGENT_PROFILE_PREFIX, AGENT_SESSION_PREFIX, AGENT_TOOL_PREFIX, EXTENSIONS_POINT, extensionsPoint, PROFILES_POINT, profilesPoint, TOOLS_POINT, toolsPoint} from "../shared/points";

import {createAgentRuntime} from "./agent";
import {BUILTIN_TOOL_CONTRIBUTIONS, builtinTools} from "./builtin";
import {GUARD_CONTRIBUTIONS, runGuards} from "./guards";
import {extensionReceiver} from "./extensions";
import {locateDocsRoot} from "./docs-root";
import {agentRemote, PreviewTokens} from "./remote";
import {AGENT_SCHEMES, agentSchemes} from "./schemes";
import {prepareTempContainer, sweepTemps} from "./temps";

const allActivated = (result: TriggerActivationResult): boolean => result.status === "triggered" && result.results.every((item) => item.status === "activated");

export const agentBackendPlugin: PluginDefinition = {
    id: descriptor.id,
    activationEventPrefixes: [AGENT_SESSION_PREFIX, AGENT_TOOL_PREFIX, AGENT_PROFILE_PREFIX],
    contributionPoints: [extensionsPoint, toolsPoint, profilesPoint],
    entries: [defineEntry({
        id: "server",
        location: "server",
        dependencies: [{key: diagnosticsKey}, {key: settingsKey}, {key: stateRootKey}, {key: clockKey}, {key: workspaceFilesKey}, {key: modelsKey, required: false}],
        provides: [agentKey],
        remoteProvides: [agentSessionsContract],
        receives: [EXTENSIONS_POINT, TOOLS_POINT, PROFILES_POINT],
        contributions: [...AGENT_SCHEMES.map((id) => ({capability: SCHEMES_POINT, id, declaration: {}})), ...BUILTIN_TOOL_CONTRIBUTIONS, ...GUARD_CONTRIBUTIONS],
        activate: async (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const report = (code: string, message: string, data?: Readonly<Record<string, unknown>>): void => {
                diagnostics.record({level: "warn", event: `agent.${code}`, message, ...(data === undefined ? {} : {data}), source: {plugin: descriptor.id}});
            };
            const models = await context.services.resolve(modelsKey);
            const runtime = await createAgentRuntime({
                stateRoot: context.services.require(stateRootKey).path,
                settings: context.services.require(settingsKey),
                models: models.status === "resolved" ? models.instance : null,
                files: context.services.require(workspaceFilesKey),
                clock: context.services.require(clockKey),
                declarations: context.declarations,
                trigger: async (event) => allActivated(await context.activation.trigger(event, {signal: context.signal})),
                report,
            });
            const clock = context.services.require(clockKey);
            const previews = new PreviewTokens(clock);
            const stateRoot = context.services.require(stateRootKey).path;
            const profilesRoot = join(stateRoot, "agent", "profiles");
            await mkdir(profilesRoot, {recursive: true});
            const tempContainer = await prepareTempContainer(stateRoot, (message) => report("temps-unavailable", message));
            // 注册方案之前清：这时新进程里没有工具在用这些临时目录（resources.md 输出 7）。只删能确定的：索引说已归档的，或会话
            // 目录已经不在的。索引读不了的会话不在列表里，但目录还在，按活会话保留。
            if (tempContainer !== null) {
                const archived = new Set((await runtime.listSessions()).filter((session) => session.archived).map((session) => session.id));
                await sweepTemps(tempContainer, async (session) => !archived.has(session) && (await lstat(join(runtime.sessionsRoot, session)).then(() => true, () => false)), (message) => report("temps-sweep", message));
            }
            const schemes = agentSchemes({
                sessionsRoot: runtime.sessionsRoot,
                profilesRoot,
                tempContainer,
                docsRoot: locateDocsRoot(),
                listSessions: async () => (await runtime.listSessions()).filter((session) => !session.archived),
                profiles: () => runtime.service.profiles(),
            });
            let stopped: Promise<void> | null = null;
            const stop = () => (stopped ??= runtime.stop().finally(() => previews.clear()));
            context.signal.addEventListener("abort", () => void stop(), {once: true});
            context.onStop(stop);
            return {
                services: [provideService(agentKey, runtime.service)],
                remote: [provideRemote(agentSessionsContract, () => agentRemote({service: runtime.service, sessions: runtime.sessions, clock}, previews))],
                contributions: {[SCHEMES_POINT]: schemes, [TOOLS_POINT]: builtinTools(), [EXTENSIONS_POINT]: runGuards(context.services.require(settingsKey))},
                receivers: {
                    [EXTENSIONS_POINT]: extensionReceiver(runtime.host, (message, cause) => report("extension-revoke-failed", message, {message: cause instanceof Error ? cause.message : String(cause)})),
                    [TOOLS_POINT]: runtime.tools.receiver,
                    [PROFILES_POINT]: runtime.profiles.receiver,
                },
            };
        },
    })],
};
