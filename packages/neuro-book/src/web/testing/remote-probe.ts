/**
 * e2e 用的浏览器测试插件 `test.remote-probe`：启动时订阅服务端探针的 `ticks`，并把调用入口与观察结果挂到
 * `window.__nbRemoteProbe` 上供 Playwright 读取。窗口绑定了项目时，另订阅项目探针的 `ticks` 并挂上 `project`。
 * 服务端一侧见 `src/server/testing/test-plugins.ts`，项目一侧见 `src/project/testing/probe-plugin.ts`。
 * 只由测试外壳（`testing/e2e-main.ts`）装配，产品清单与产品构建不含它。
 */

import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import type {RemoteResult, RemoteUse} from "@notnotype/nb-runtime/remote";

import {windowProjectKey} from "nbook/shared/projects";
import {projectProbeContract, remoteProbeContract, remoteProbeDescriptor} from "nbook/shared/testing/remote-probe-contract";

/** 窗口绑定的项目里的探针：经 `project` 目标调用。 */
export interface ProjectProbeDebug {
    echo(): Promise<RemoteResult<unknown>>;
    tick(): Promise<RemoteResult<unknown>>;
    /** 让项目子进程以给定退出码立即退出；不等结果（进程没了，结果只会是 unknown-outcome）。 */
    crash(code: number): void;
    readonly ticks: number[];
    readonly ends: string[];
    resyncs: number;
}

/** `window.__nbRemoteProbe` 的形状。 */
export interface RemoteProbeDebug {
    /** 窗口没有绑定项目时为 null。 */
    readonly project: ProjectProbeDebug | null;
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
            dependencies: [{key: windowProjectKey}],
            activate: async (context) => {
                const atServer = context.remote.use(remoteProbeContract);
                const bound = context.services.require(windowProjectKey).project;
                const debug: RemoteProbeDebug = {
                    project: bound === null ? null : await projectProbe(context.remote.use(projectProbeContract)),
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

async function projectProbe(atProject: RemoteUse<typeof projectProbeContract>): Promise<ProjectProbeDebug> {
    const debug: ProjectProbeDebug = {
        echo: () => atProject.echo({}),
        tick: () => atProject.tick({}),
        crash: (code) => {
            void atProject.crash({code});
        },
        ticks: [],
        ends: [],
        resyncs: 0,
    };
    const subscribed = await atProject.events.ticks.subscribe({}, (payload) => debug.ticks.push(payload.n), {
        onResync: () => {
            debug.resyncs += 1;
        },
        onEnd: (reason) => debug.ends.push(reason),
    });
    if (!subscribed.ok) throw new Error(`订阅项目探针的 ticks 失败：${subscribed.code}`);
    return debug;
}
