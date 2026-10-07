/**
 * e2e 用的浏览器测试插件 `test.remote-probe`：启动时订阅服务端探针的 `ticks`，并把调用入口与观察结果挂到
 * `window.__nbRemoteProbe` 上供 Playwright 读取。服务端一侧见 `src/server/testing/test-plugins.ts`。
 * 只由测试外壳（`testing/e2e-main.ts`）装配，产品清单与产品构建不含它。
 */

import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import type {RemoteResult} from "@notnotype/nb-runtime/remote";

import {remoteProbeContract, remoteProbeDescriptor} from "nbook/shared/testing/remote-probe-contract";

/** `window.__nbRemoteProbe` 的形状。 */
export interface RemoteProbeDebug {
    echo(): Promise<RemoteResult<unknown>>;
    /** 发出一个 `hold`，不等结果；结果到达后记进 `holds`。 */
    hold(name: string): void;
    readonly holds: Record<string, RemoteResult<unknown>>;
    readonly ticks: number[];
    readonly ends: string[];
    resyncs: number;
}

declare global {
    interface Window {
        __nbRemoteProbe?: RemoteProbeDebug;
    }
}

export function createRemoteProbeBrowserPlugin(): PluginDefinition {
    return {
        id: remoteProbeDescriptor.id,
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            activate: async (context) => {
                const atServer = context.remote.use(remoteProbeContract);
                const debug: RemoteProbeDebug = {
                    echo: () => atServer.echo({}),
                    hold: (name) => {
                        void atServer.hold({name}).then((outcome) => {
                            debug.holds[name] = outcome;
                        });
                    },
                    holds: {},
                    ticks: [],
                    ends: [],
                    resyncs: 0,
                };
                const subscribed = await atServer.events.ticks.subscribe({}, (payload) => debug.ticks.push(payload.n), {
                    onResync: () => {
                        debug.resyncs += 1;
                    },
                    onEnd: (reason) => debug.ends.push(reason),
                });
                if (!subscribed.ok) throw new Error(`订阅 ticks 失败：${subscribed.code}`);
                window.__nbRemoteProbe = debug;
                return {};
            },
        }],
    };
}
