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
import {Viewpoint, type ViewpointGrant} from "../core/viewpoint";
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

/** 一个调用方打开的视角：句柄到内核令牌与看的人、上限。 */
type Viewpoints = Map<string, {readonly token: string; readonly grant: ViewpointGrant}>;
let viewpointSequence = 0;

function remotePlot(canon: CanonProject, viewpoints: Viewpoints): RemoteImplementation<typeof plotWorldContract> {
    /** 取一份快照，在同一个同步段里算完。 */
    const withView = async <R>(run: (view: CanonReadView) => R): Promise<R | Failure> => {
        const snapshot = await canon.snapshot();
        if ("code" in snapshot) return fail(snapshot.code);
        return run(snapshot.view);
    };
    /** 带视角句柄的读取：取一份快照，在它上面建这张视图，同步算完。句柄不在（关了、别人的、从没有过）就是 `view-denied`。 */
    const withViewpoint = async <R>(handle: string, run: (viewpoint: Viewpoint) => R | string): Promise<{readonly ok: true; readonly value: R} | Failure> => {
        const held = viewpoints.get(handle);
        if (held === undefined) return fail("view-denied");
        const snapshot = await canon.snapshot();
        if ("code" in snapshot) return fail(snapshot.code);
        const viewpoint = new Viewpoint(snapshot.view, snapshot.viewed(held.token), held.grant, (method, blocked) => void canon.audit(held.token, {method, blocked: blocked.map((id) => ({kind: "entry" as const, id}))}));
        const result = run(viewpoint);
        return typeof result === "string" ? fail(result) : {ok: true as const, value: result};
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
            openViewpoint: async (input) => {
                const opened = await canon.openView({viewer: input.viewer, line: "main", until: input.until, purpose: input.purpose});
                if (!("token" in opened)) return fail(opened.code);
                const handle = `viewpoint-${String(++viewpointSequence)}`;
                viewpoints.set(handle, {token: opened.token, grant: {viewer: input.viewer, until: input.until}});
                return {ok: true as const, value: {handle}};
            },
            closeViewpoint: async (input) => {
                const held = viewpoints.get(input.handle);
                if (held !== undefined) {
                    viewpoints.delete(input.handle);
                    await canon.closeView(held.token);
                }
                return {ok: true as const, value: null};
            },
            viewpointEntry: (input) => withViewpoint(input.handle, (viewpoint) => viewpoint.entry(input.id)),
            viewpointLookup: (input) => withViewpoint(input.handle, (viewpoint) => viewpoint.lookup(input.names)),
            viewpointExperience: (input) => withViewpoint(input.handle, (viewpoint) => viewpoint.experience()),
            viewpointKnowing: (input) => withViewpoint(input.handle, (viewpoint) => viewpoint.knowing(input.who)),
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
            // 每个调用方一份：它打开的视角记在这里，调用方实例失效时关掉对应的内核视图。
            const owned = new WeakMap<object, Viewpoints>();
            const remote = provideRemote(plotWorldContract, () => {
                const viewpoints: Viewpoints = new Map();
                const implementation = remotePlot(canon, viewpoints);
                owned.set(implementation, viewpoints);
                return implementation;
            }, {
                release: async (implementation) => {
                    const viewpoints = owned.get(implementation);
                    if (viewpoints === undefined) return;
                    for (const {token} of viewpoints.values()) await canon.closeView(token);
                    viewpoints.clear();
                },
            });
            return {remote: [remote]};
        },
    })],
};
