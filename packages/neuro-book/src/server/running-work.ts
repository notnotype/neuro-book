/**
 * 在跑的工作（docs/specs/runtime/server-host.md 的“在跑的工作”）：宿主能力 `runningWorkKey` 的登记表，服务端与项目子进程
 * 各建一份；服务端另有宿主接口 `GET /api/runtime/work`，把自己的与各项目的汇成一份。
 *
 * 登记方按调用方入口区分（`perConsumer`）：工作项归属的插件取自调用方身份，不由登记方自报；入口停止时它的全部登记随门面一起
 * 撤下，插件忘了调用 release 也不会留下已经停掉的报告方。
 */

import {Type} from "typebox";
import {Value} from "typebox/value";
import type {Static} from "typebox";

import type {HostRoute} from "@notnotype/nb-host/server";
import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";
import {perConsumer} from "@notnotype/nb-runtime/services";
import type {ConsumerIdentity, PerConsumerProvision} from "@notnotype/nb-runtime/services";

import type {RunningWork, RunningWorkItem} from "nbook/shared/host";
import type {RunningWorkReport} from "nbook/shared/running-work";
import {TextSchema} from "nbook/shared/text";

/** 一个运行实例里收集到的工作：项目子进程经 IPC 交回的也是这个形状（`ipc.ts` 的 `work`）。 */
export const RunningWorkCollectionSchema = Type.Object({
    items: Type.Array(Type.Object({plugin: Type.String(), text: TextSchema})),
    /** 报告方抛错或交回的不是工作项列表的插件，每个插件至多一次。 */
    failed: Type.Array(Type.String()),
});

export type RunningWorkCollection = Static<typeof RunningWorkCollectionSchema>;

const ItemsSchema = Type.Array(Type.Object({text: TextSchema}));

export interface RunningWorkRegistry {
    /** 宿主能力 `runningWorkKey` 的提供。 */
    readonly provision: PerConsumerProvision<RunningWork>;
    /** 按登记顺序同步调用全部报告方。一个报告方失败只让它的插件进 `failed`，不影响别的。 */
    collect(): RunningWorkCollection;
}

interface Registration {
    readonly plugin: string;
    readonly reporter: () => ReadonlyArray<RunningWorkItem>;
}

/** 插件 id；宿主自己（没有插件身份的调用方）按实例 id 记。 */
function ownerOf(consumer: ConsumerIdentity): string {
    return consumer.plugin ?? consumer.instanceId;
}

export function createRunningWork(report: (record: DiagnosticInput) => void): RunningWorkRegistry {
    // Set 保持插入顺序：`collect` 按登记顺序调用。
    const registrations = new Set<Registration>();
    const byFacade = new Map<RunningWork, Set<Registration>>();
    const provision = perConsumer(
        (consumer: ConsumerIdentity): RunningWork => {
            const own = new Set<Registration>();
            const facade: RunningWork = {
                register: (reporter) => {
                    const registration: Registration = {plugin: ownerOf(consumer), reporter};
                    registrations.add(registration);
                    own.add(registration);
                    return () => {
                        registrations.delete(registration);
                        own.delete(registration);
                    };
                },
            };
            byFacade.set(facade, own);
            return facade;
        },
        (facade) => {
            for (const registration of byFacade.get(facade) ?? []) registrations.delete(registration);
            byFacade.delete(facade);
        },
    );

    const collect = (): RunningWorkCollection => {
        const items: Array<RunningWorkCollection["items"][number]> = [];
        const failed = new Set<string>();
        for (const {plugin, reporter} of [...registrations]) {
            // 调用、校验与取值都在同一个隔离边界里：交回的对象在读取时也可能抛错（例如 getter）。一个插件出事只让它进
            // `failed`，别的照常列出；不合形状的照样算失败，否则整条应答过不了页面的校验，所有工作都看不到。
            try {
                const reported: unknown = reporter();
                if (!Value.Check(ItemsSchema, reported)) {
                    failed.add(plugin);
                    report({level: "warn", event: "runtime.work.reporter-failed", message: `插件 ${plugin} 交回的在跑的工作不是工作项列表`, source: {plugin}});
                    continue;
                }
                const own = reported.map((item) => ({plugin, text: Value.Clone(item.text)}));
                items.push(...own);
            } catch (error) {
                failed.add(plugin);
                report({level: "warn", event: "runtime.work.reporter-failed", message: `插件 ${plugin} 报告在跑的工作时出错`, error, source: {plugin}});
            }
        }
        return {items, failed: [...failed]};
    };

    return {provision, collect};
}

/** `ProjectManager.work` 的结果：各项目的工作与取不到的项目，形状同宿主接口的应答。 */
export type ProjectsRunningWork = RunningWorkReport;

/**
 * 宿主接口 `GET /api/runtime/work`（路径相对 `/api/runtime/`，完整路径见 `RUNNING_WORK_PATH`）。准入与停止后的 503 由
 * nb-host 的宿主接口门负责。`projects` 不会失败：取不到的项目已经记进它的 `failed`。
 */
export function createRunningWorkRoute(server: RunningWorkRegistry, projects: () => Promise<ProjectsRunningWork>): HostRoute {
    return {
        method: "GET",
        path: "/work",
        handle: async () => {
            const own = server.collect();
            const fromProjects = await projects();
            const body: RunningWorkReport = {
                items: [...own.items.map(({plugin, text}) => ({plugin, project: null, text})), ...fromProjects.items],
                failed: [...own.failed.map((plugin) => ({plugin, project: null})), ...fromProjects.failed],
            };
            return Response.json(body, {headers: {"cache-control": "no-store"}});
        },
    };
}
