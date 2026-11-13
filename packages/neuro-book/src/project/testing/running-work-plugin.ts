/**
 * `test.running-work` 的项目入口：向项目位置的宿主能力 `runningWorkKey` 登记一个报告方，交回一项带当前项目名的工作，
 * 供项目管理器核对经 IPC 取项目的在跑的工作（docs/specs/runtime/server-host.md 的“在跑的工作”）。只由测试启动。
 */

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {runningWorkKey} from "nbook/shared/host";
import {currentProjectKey} from "nbook/shared/projects";

export const RUNNING_WORK_PROBE_ID = "test.running-work";

/** 报告方交回的那一项的文字。 */
export function projectWorkText(projectName: string): string {
    return `检查《${projectName}》`;
}

export function createRunningWorkProjectPlugin(): PluginDefinition {
    return {
        id: RUNNING_WORK_PROBE_ID,
        entries: [defineEntry({
            id: "project",
            location: "project",
            activationEvents: ["onStartup"],
            dependencies: [{key: currentProjectKey}, {key: runningWorkKey}],
            activate: (context) => {
                const current = context.services.require(currentProjectKey);
                // 入口停止时宿主随门面撤下登记，这里不必自己释放。
                context.services.require(runningWorkKey).register(() => [{text: projectWorkText(current.name)}]);
                return {};
            },
        })],
    };
}
