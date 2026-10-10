/**
 * `nbook.projects` 的项目入口 `stats`：在项目实例里统计本项目，提供远程服务 `nbook.projects/stats` 给服务端的书架，
 * 把快照写进 user 分区的记录 `projects.stats`（docs/specs/runtime/projects.md 输出第 16、17 条）。项目一打开就开始
 * 统计，书架问到时多半已经算完；项目目录经宿主能力 `currentProjectKey` 取（docs/adr/0026-plugin-definitions-as-constants.md）。
 *
 * 停止时的最后一次写入放在入口登记的资源释放里：依赖的 Storage 门面在这之后才释放（docs/specs/runtime/plugins.md 输出
 * 第 13 条），user 记录经项目实例到服务端的链路写入，项目停止期间链路保持。这时 Files 的订阅已经或正在结束，统计不再更新。
 */

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";

import {projectFilesContract} from "nbook/plugins/files/shared/contracts";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {clockKey} from "nbook/shared/host";
import {currentProjectKey} from "nbook/shared/projects";

import {descriptor} from "../plugin";
import {projectStatsRemoteContract} from "../shared/contracts";
import {PROJECT_STATS_RECORD} from "../shared/stats-record";
import {createStatsTracker} from "./stats-tracker";
import {createStatsWriter} from "./stats-writer";

const ENTRY = "stats";

export const projectsProjectPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: ENTRY,
        location: "project",
        activationEvents: ["onStartup"],
        dependencies: [{key: diagnosticsKey}, {key: clockKey}, {key: currentProjectKey}, {key: storageKey}],
        remoteProvides: [projectStatsRemoteContract],
        activate: async (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const clock = context.services.require(clockKey);
            const project = context.services.require(currentProjectKey);
            const storage = context.services.require(storageKey);
            const record = (input: Omit<DiagnosticInput, "source">): void => void diagnostics.record({...input, source: {plugin: descriptor.id, entry: ENTRY}});
            const files = context.remote.use(projectFilesContract);

            const writer = createStatsWriter({
                clock,
                open: () => storage.open(PROJECT_STATS_RECORD, project.id),
                snapshot: () => tracker.snapshot(),
                record,
            });
            // 先读记录再开始：首扫完成前对外给的是记录里的快照，今天的基线与最近编辑也从它接着算。读不出就从空开始。
            const initial = await writer.load();
            const tracker = createStatsTracker({
                root: project.root,
                clock,
                initial,
                subscribe: (listener, options) => files.events.changes.subscribe({}, listener, options),
                record,
                changed: () => writer.changed(),
            });
            context.scope.register({
                kind: "project-stats",
                label: `${descriptor.id} ${ENTRY}`,
                value: tracker,
                release: async (value) => {
                    const final = await value.stop();
                    if (final === null) record({level: "info", event: "projects.stats.final-skipped", message: "整轮统计没有完成，停止时不写，保留旧记录"});
                    await writer.finish(final);
                },
            });
            tracker.start();
            return {remote: [provideRemote(projectStatsRemoteContract, () => ({methods: {current: () => ({ok: true, value: tracker.current()})}}))]};
        },
    })],
};
