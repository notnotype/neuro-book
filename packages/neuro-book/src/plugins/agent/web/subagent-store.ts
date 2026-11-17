/**
 * 子代理卡片与后台命令卡片的数据入口（docs/specs/agent/conversation.md 输出 33–39）：对话位置的组件从会话宿主取出来 `provide`，卡片 `inject`。
 * 不进 ctx：子树一推就换整个 ctx 的话，每张卡片、每一轮都要重算；这里推送只替换变了的项，`now` 只在有进行中的项时每秒走。
 */

import type {InjectionKey, Ref, ShallowRef} from "vue";
import {GENERIC_TOOL_RENDERER} from "@notnotype/nb-agent-ui";
import type {AgentViewRegistry} from "@notnotype/nb-agent-ui";
import type {Text} from "@notnotype/nb-ui/text";

import type {RunResult} from "@notnotype/nb-harness/kernel/contracts";

import type {CommandStatus} from "../shared/subagents";
import type {SubagentData} from "./session-host";

export interface SubagentStore {
    readonly data: ShallowRef<SubagentData>;
    /** 有进行中的子代理或后台命令时每秒走，卡片按它算用时。 */
    readonly now: Ref<number>;
    /** 后台命令输出的最后几行与 `status.json`；读不到交回 null。 */
    tail(jobId: string, lines: number): Promise<{readonly lines: readonly string[]; readonly status: CommandStatus | null} | null>;
    /** 后台命令的 `status.json`（任务已移出或重启之后，卡片从这里取终态）。 */
    status(jobId: string): Promise<CommandStatus | null>;
    /** 以用户的身份停掉一个任务。 */
    kill(jobId: string): Promise<void>;
    /**
     * 停掉一个后代会话这次的运行（conversation.md 输出 43）：与在那个会话里按停止同一条路，排队的消息与会话都留着；孙代理也能停。
     * 停不成时在会话的提示里写原因。
     */
    stopRun(sessionId: string): Promise<void>;
    /** 一个后代会话某次运行的收口结果；读不到交回 null。收口了的结果不会变，调用方可以缓存。 */
    runResult(sessionId: string, runId: string): Promise<RunResult | null>;
}

export const subagentStoreKey: InjectionKey<SubagentStore> = Symbol("nbook.agent/subagent-store");

/**
 * 工具名（`displayToolName` 给的视图键）→ 动作名：卡片写子代理正在做什么、等批准的是什么（conversation.md 输出 33）。卡片是工具节点，
 * 拿不到视图的注册表，由对话位置的组件按同一个注册表提供；没有提供时（单独挂载）卡片写工具名。
 */
export const toolActionKey: InjectionKey<(tool: string) => Text | null> = Symbol("nbook.agent/tool-action");

/** 注册表里没有这个工具（插件贡献、没有渲染器）时给 null：通用项的“工具”不是动作名，卡片改写工具名。 */
export function toolActionOf(registry: AgentViewRegistry, tool: string): Text | null {
    const entry = registry.resolveTool(tool);
    return entry.id === GENERIC_TOOL_RENDERER.id ? null : entry.label;
}
