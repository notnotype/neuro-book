/**
 * 项目宿主测试入口的故障插件：按 `NBOOK_TEST_PROJECT_FAULT` 在真实子进程里制造启动与停止的几种失败，
 * 供项目管理器的合同测试核对收口（docs/specs/runtime/projects.md 场景 9）。激活时打印一行带当前项目的输出，
 * 顺带核对 `currentProjectKey` 与输出转发。只由测试启动。
 */

import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provide} from "@notnotype/nb-runtime/plugins";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import type {CurrentProject} from "../current-project";

/** `start-on-signal`：激活停在就绪行之后，收到 SIGUSR2 才继续，测试据此在启动中途做别的事。 */
export const PROJECT_FAULTS = ["none", "hang-start", "start-on-signal", "exit-during-start", "startup-failure", "stop-fails", "stop-hangs"] as const;
export type ProjectFault = (typeof PROJECT_FAULTS)[number];

/** 激活时打印的那一行的开头；测试据此确认子进程的输出转发到了服务端。 */
export const FIXTURE_READY_LINE = "fixture ready";

const hookKey = defineServiceKey<object>("test.project-fault/hook");

function never(): Promise<never> {
    return new Promise<never>(() => undefined);
}

export function createProjectFaultPlugin(fault: ProjectFault, currentProject: ServiceKey<CurrentProject>): PluginDefinition {
    return {
        id: "test.project-fault",
        entries: [{
            id: "main",
            location: "project",
            provides: [hookKey],
            dependencies: [{key: currentProject}],
            activate: async (context) => {
                const current = context.services.require(currentProject);
                // 先挂上信号再打印就绪行：测试看到就绪行就可以发信号。
                const signalled = fault === "start-on-signal" ? new Promise<void>((resolve) => process.once("SIGUSR2", () => resolve())) : null;
                console.log(`${FIXTURE_READY_LINE} ${current.id}#${String(current.generation)} ${current.name} ${current.root} pid=${String(process.pid)}`);
                if (fault === "hang-start") await never();
                if (signalled !== null) await signalled;
                if (fault === "exit-during-start") process.exit(3);
                if (fault === "startup-failure") throw new Error("测试插件按要求激活失败");
                const release = fault === "stop-fails"
                    ? () => {
                        throw new Error("测试插件按要求收口失败");
                    }
                    : fault === "stop-hangs" ? never : undefined;
                return {services: [provide(hookKey, {}, release)]};
            },
        }],
    };
}
