/**
 * 工作台状态栏的“Agent：1 运行中 · 1 等你处理”（docs/specs/agent/conversation.md 输出 19）：先订阅后取快照，`onResync` 重取。
 * 只放声明与这个轻量模块，视图与宿主用到时才加载，打开窗口不多花时间。订阅失败时条目不显示、写诊断。
 */

import {computed, shallowRef} from "vue";
import type {ComputedRef, ShallowRef} from "vue";

import type {RemoteClient} from "@notnotype/nb-runtime/remote";

import type {ActivityItem, agentSessionsContract} from "../shared/remote";

export interface AgentActivity {
    readonly items: ShallowRef<readonly ActivityItem[]>;
    readonly active: ComputedRef<boolean>;
    /** 点击条目要去的会话：优先等用户的。 */
    readonly target: ComputedRef<string | null>;
    readonly running: ComputedRef<number>;
    readonly waiting: ComputedRef<number>;
    start(signal: AbortSignal): Promise<void>;
}

export function createAgentActivity(remote: RemoteClient<typeof agentSessionsContract>, report: (message: string) => void): AgentActivity {
    const items = shallowRef<readonly ActivityItem[]>([]);
    const refresh = async (): Promise<void> => {
        const result = await remote.activity({});
        if (result.ok) items.value = result.value;
        else report(`activity: ${result.code}`);
    };
    return {
        items,
        active: computed(() => items.value.length > 0),
        target: computed(() => (items.value.find((item) => item.state === "waiting") ?? items.value[0])?.id ?? null),
        running: computed(() => items.value.filter((item) => item.state === "running").length),
        waiting: computed(() => items.value.filter((item) => item.state === "waiting").length),
        async start(signal) {
            const subscription = await remote.events.activityChanged.subscribe({}, (next) => {
                items.value = next;
            }, {onResync: () => void refresh()});
            if (!subscription.ok) {
                report(`activity subscribe: ${subscription.code}`);
                return;
            }
            signal.addEventListener("abort", () => subscription.value.release(), {once: true});
            await refresh();
        },
    };
}
