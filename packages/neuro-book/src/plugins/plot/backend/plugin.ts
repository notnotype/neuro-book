/**
 * `nbook.plot` 的项目入口：经 canon 的项目内接口（`canonProjectKey`）登记剧情的诊断计算、取世界的快照（ADR 0041：剧情插件
 * 只读世界，在内核的机制之上算语义），并提供剧情的读取视图（远程合同 `nbook.plot/world`）。
 *
 * 每次远程调用取一份快照，在同一个同步段里算完：快照在中间 `await` 过以后就不能再用（canon 的项目内接口）。
 */

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";
import type {RemoteImplementation} from "@notnotype/nb-runtime/remote";
import type {CanonReadView, ReadPosition} from "@notnotype/nb-canon/schema";

import {canonProjectKey} from "nbook/plugins/canon/shared/contracts";
import type {CanonProject} from "nbook/plugins/canon/shared/contracts";

import {firstReveal, readerKnowing} from "../core/knowledge";
import {knowingDiagnostics, knowingIndex} from "../core/knowledge-checks";
import {descriptor} from "../plugin";
import {plotWorldContract} from "../shared/contracts";

/** 剧情插件自己的数据版本：阶段 B 还没有插件自己存的数据（窄问题的答案在阶段 F），固定不变。 */
export const PLOT_DATA_VERSION = "1";

type Failure = {readonly ok: false; readonly code: "plot"; readonly detail: {readonly code: string}};
const fail = (code: string): Failure => ({ok: false, code: "plot", detail: {code}});

/** 缺省的读取位置：最新一章的末尾，没有章时是初值（canon.model 输出 21）。 */
function latest(view: CanonReadView): ReadPosition {
    const last = view.chapters.at(-1);
    return last === undefined ? {kind: "initial"} : {kind: "chapter", chapter: last, edge: "end"};
}

function remotePlot(canon: CanonProject): RemoteImplementation<typeof plotWorldContract> {
    /** 取一份快照，在同一个同步段里算完。 */
    const withView = async <R>(run: (view: CanonReadView) => R): Promise<R | Failure> => {
        const snapshot = await canon.snapshot();
        if ("code" in snapshot) return fail(snapshot.code);
        return run(snapshot.view);
    };
    return {
        methods: {
            knowing: (input) => withView((view) => {
                const position = input.position ?? latest(view);
                if (view.positionKey(position) === null) return fail("chapter-not-found");
                const index = knowingIndex(view, input.mode ?? "actual", position);
                const rows = input.point === undefined ? index.all(input.person) : [index.effective(input.person, input.point)].filter((row) => row !== null);
                return {ok: true as const, value: {version: view.version, inputDigest: view.stamp.inputDigest, rows}};
            }),
            reader: (input) => withView((view) => ({ok: true as const, value: {version: view.version, inputDigest: view.stamp.inputDigest, degree: readerKnowing(view, input.point, input.at), first: firstReveal(view, input.point)}})),
        },
        events: {},
    };
}

export const plotProjectPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "project",
        location: "project",
        activationEvents: ["onStartup"],
        dependencies: [{key: canonProjectKey}],
        remoteProvides: [plotWorldContract],
        activate: (context) => {
            const canon = context.services.require(canonProjectKey);
            canon.register({compute: {...knowingDiagnostics()}, dataVersion: PLOT_DATA_VERSION});
            return {remote: [provideRemote(plotWorldContract, () => remotePlot(canon))]};
        },
    })],
};
