/**
 * `nbook.tasks` 的服务端入口（docs/specs/workbench/background-tasks.md）：建清单，按调用方交出登记服务，给窗口远程服务。
 *
 * 另向宿主的 `runningWorkKey` 登记在跑的任务（输出 17）。
 *
 * 登记服务按调用方提供：门面释放（发起方入口停止）时把它名下的任务按输出 5 收尾。入口自己不必启动即激活：发起方依赖
 * `tasksKey` 时、窗口第一次调用远程服务时都会拉起它。停止时最后释放清单：发起方先于它停（它们依赖它），各自的门面先释放。
 */

import {randomUUID} from "node:crypto";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry, provideServicePerConsumer} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";

import {clockKey, runningWorkKey} from "nbook/shared/host";

import {descriptor} from "../plugin";
import {tasksContract, tasksKey} from "../shared/contracts";
import {createTasksCore} from "./core";
import type {TasksDiagnostic} from "./core";
import {tasksRemote} from "./remote";

export const tasksBackendPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "server",
        location: "server",
        dependencies: [{key: diagnosticsKey}, {key: clockKey}, {key: runningWorkKey, required: false}],
        provides: [tasksKey],
        remoteProvides: [tasksContract],
        activate: async (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const clock = context.services.require(clockKey);
            const report: TasksDiagnostic = (event, message, data) => {
                diagnostics.record({level: "warn", event: `tasks.${event}`, message, ...(data === undefined ? {} : {data}), source: {plugin: descriptor.id}});
            };
            const core = createTasksCore({clock, newId: () => randomUUID().slice(0, 12), report});
            context.scope.register({kind: "tasks-core", label: `${descriptor.id} tasks`, value: core, release: (value) => value.close()});
            const remote = tasksRemote(core, {clock, report});
            // 关闭服务前报出在跑的任务（background-tasks.md 输出 17）；入口停止时宿主随门面撤下这条登记。没有这个能力的宿主（只装
            // 这个插件的测试场地、别的应用）照常运行，只是不报。
            const work = await context.services.resolve(runningWorkKey);
            if (work.status === "resolved") work.instance.register(() => core.list().filter((item) => item.state === "running").map((item) => ({text: item.title})));
            return {
                services: [provideServicePerConsumer(tasksKey, (consumer) => core.facade(consumer), {release: (_facade, consumer) => core.release(consumer)})],
                remote: [provideRemote(tasksContract, () => remote)],
            };
        },
    })],
};
