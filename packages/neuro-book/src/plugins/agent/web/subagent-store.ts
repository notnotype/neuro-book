/**
 * 子代理卡片与后台命令卡片的数据入口（docs/specs/agent/conversation.md 输出 33–39）：对话位置的组件从会话宿主取出来 `provide`，卡片 `inject`。
 * 不进 ctx：子树一推就换整个 ctx 的话，每张卡片、每一轮都要重算；这里推送只替换变了的项，`now` 只在有进行中的项时每秒走。
 */

import type {InjectionKey, Ref, ShallowRef} from "vue";

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
}

export const subagentStoreKey: InjectionKey<SubagentStore> = Symbol("nbook.agent/subagent-store");
