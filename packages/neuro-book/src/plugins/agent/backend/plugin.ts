/**
 * `nbook.agent` 的服务端入口：依赖、接收、激活与停止。装配在 `agent.ts`。
 *
 * 停止从 `context.signal` 开始：平台在停止时先撤回交给本入口接收者的贡献、再跑 `onStop`，而撤回会让打开着的会话
 * 重新装配、工具撤回还要等执行中的调用。所以信号一触发就关门、把会话按 `interrupted` 关掉（sessions.md 输出 14），
 * 之后的撤回落在已关的会话上什么也不做；`onStop` 等这次关闭完成。
 */

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry, provideService} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";
import type {PluginDefinition, TriggerActivationResult} from "@notnotype/nb-runtime/plugins";

import {modelsKey} from "nbook/plugins/models/shared/contracts";
import {settingsKey} from "nbook/plugins/settings/shared/contracts";
import {clockKey, stateRootKey} from "nbook/shared/host";

import {descriptor} from "../plugin";
import {agentKey} from "../shared/contracts";
import {agentSessionsContract} from "../shared/remote";
import {AGENT_PROFILE_PREFIX, AGENT_SESSION_PREFIX, AGENT_TOOL_PREFIX, EXTENSIONS_POINT, extensionsPoint, PROFILES_POINT, profilesPoint, TOOLS_POINT, toolsPoint} from "../shared/points";

import {createAgentRuntime} from "./agent";
import {extensionReceiver} from "./extensions";
import {agentRemote, PreviewTokens} from "./remote";

const allActivated = (result: TriggerActivationResult): boolean => result.status === "triggered" && result.results.every((item) => item.status === "activated");

export const agentBackendPlugin: PluginDefinition = {
    id: descriptor.id,
    activationEventPrefixes: [AGENT_SESSION_PREFIX, AGENT_TOOL_PREFIX, AGENT_PROFILE_PREFIX],
    contributionPoints: [extensionsPoint, toolsPoint, profilesPoint],
    entries: [defineEntry({
        id: "server",
        location: "server",
        dependencies: [{key: diagnosticsKey}, {key: settingsKey}, {key: stateRootKey}, {key: clockKey}, {key: modelsKey, required: false}],
        provides: [agentKey],
        remoteProvides: [agentSessionsContract],
        receives: [EXTENSIONS_POINT, TOOLS_POINT, PROFILES_POINT],
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
                clock: context.services.require(clockKey),
                declarations: context.declarations,
                trigger: async (event) => allActivated(await context.activation.trigger(event, {signal: context.signal})),
                report,
            });
            const clock = context.services.require(clockKey);
            const previews = new PreviewTokens(clock);
            let stopped: Promise<void> | null = null;
            const stop = () => (stopped ??= runtime.stop().finally(() => previews.clear()));
            context.signal.addEventListener("abort", () => void stop(), {once: true});
            context.onStop(stop);
            return {
                services: [provideService(agentKey, runtime.service)],
                remote: [provideRemote(agentSessionsContract, () => agentRemote({service: runtime.service, sessions: runtime.sessions, clock}, previews))],
                receivers: {
                    [EXTENSIONS_POINT]: extensionReceiver(runtime.host, (message, cause) => report("extension-revoke-failed", message, {message: cause instanceof Error ? cause.message : String(cause)})),
                    [TOOLS_POINT]: runtime.tools.receiver,
                    [PROFILES_POINT]: runtime.profiles.receiver,
                },
            };
        },
    })],
};
