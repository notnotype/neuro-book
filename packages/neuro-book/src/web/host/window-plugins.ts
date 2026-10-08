/**
 * 宿主能力 `windowPluginsKey` 的实现（docs/specs/workbench/views.md 输出 8，runtime/browser-host.md“失败呈现”）：把本窗口
 * 运行实例的插件宿主收窄成“查入口状态、听变化、重试激活失败的入口”三件事交给插件。
 *
 * 能力在建立运行实例的 manifest 里就要给出，那时插件宿主还没创建，所以经 `host()` 晚取：运行实例建立之前查询得到
 * null。变化通知不精确：插件机制每记一条诊断（激活开始、失败、停止、恢复都会记）就通知一次，读方重新查询。
 */

import type {PluginDiagnostic, PluginHost} from "@notnotype/nb-runtime/plugins";

import type {WindowPluginRetry, WindowPlugins} from "nbook/shared/host";

export interface WindowPluginsFeed {
    readonly capability: WindowPlugins;
    /** 接在插件观察者上：每条插件诊断之后调用。 */
    diagnosticRecorded(diagnostic: PluginDiagnostic): void;
}

export function createWindowPlugins(host: () => PluginHost | null, report: (error: unknown) => void): WindowPluginsFeed {
    const listeners = new Set<() => void>();
    const notify = (): void => {
        for (const listener of [...listeners]) {
            try {
                listener();
            } catch (error) {
                report(error);
            }
        }
    };
    const capability: WindowPlugins = {
        entryState: (ref) => host()?.entryState(ref) ?? null,
        onChange: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        retry: async (ref): Promise<WindowPluginRetry> => {
            const plugins = host();
            if (plugins === null) return {status: "failed", reason: "运行实例还没有建立"};
            const recovered = await plugins.recover(ref);
            if (recovered.status === "not-failed") return {status: "not-failed"};
            if (recovered.status !== "reset") return {status: "failed", reason: recovered.status === "rejected" ? recovered.reason : recovered.status};
            const activated = await plugins.activate(ref);
            notify();
            if (activated.status === "activated") return {status: "activated"};
            if (activated.status === "failed") return {status: "failed", reason: activated.error?.message ?? activated.reason};
            return {status: "failed", reason: activated.status === "rejected" ? activated.reason : activated.status};
        },
    };
    return {capability, diagnosticRecorded: () => notify()};
}
