/**
 * `nbook.plot` 的项目入口：经 canon 的项目内接口（`canonProjectKey`）登记剧情的诊断计算、取世界的快照（ADR 0041：剧情插件
 * 只读世界，在内核的机制之上算语义），并提供剧情的读取视图（远程合同 `nbook.plot/world`）。
 *
 * 每次远程调用取一份快照，在同一个同步段里算完：快照在中间 `await` 过以后就不能再用（canon 的项目内接口）。
 */

import {createHash} from "node:crypto";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";
import type {RemoteImplementation} from "@notnotype/nb-runtime/remote";
import {pageOf} from "@notnotype/nb-canon/node";
import type {CanonReadView, Mode, ReadPosition} from "@notnotype/nb-canon/schema";

import {CANON_BUDGET_BYTES, canonProjectKey, encodedBytes} from "nbook/plugins/canon/shared/contracts";
import type {CanonProject} from "nbook/plugins/canon/shared/contracts";

import {foreshadowDiagnostics, ledger} from "../core/foreshadowing";
import {decisionDiagnostics} from "../core/decisions";
import {goalDiagnostics} from "../core/goal-checks";
import {guardDiagnostics} from "../core/guards";
import {instructionDiagnostics} from "../core/instruction-checks";
import {conflictsOf} from "../core/goals";
import {experienceChanges, firstReveal, knowingIndex, readerKnowing} from "../core/knowledge";
import {Viewpoint, type ViewpointGrant} from "../core/viewpoint";
import {knowingDiagnostics} from "../core/knowledge-checks";
import {descriptor} from "../plugin";
import {plotWorldContract} from "../shared/contracts";
import {plotInstructionsContract} from "../shared/instructions";
import {InstructionTable, PLOT_DATA_VERSION} from "./instructions";

export {PLOT_DATA_VERSION};


type Failure = {readonly ok: false; readonly code: "plot"; readonly detail: {readonly code: string}};
const fail = (code: string): Failure => ({ok: false, code: "plot", detail: {code}});

type Ok<T> = {readonly ok: true; readonly value: T};
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

/** 单个结果：编码后超过单次预算回 `too-large`（canon.project 输出 18）。 */
function fitted<T>(value: T): Ok<T> | Failure {
    return encodedBytes(value) > CANON_BUDGET_BYTES ? fail("too-large") : {ok: true, value};
}

/**
 * 列表的一页（canon.project 输出 18，与 canon 的列表同一套游标）：按调用方给的条数（缺省 50）取，编码后超过预算就把条数减半
 * 重取，单条都装不下才回 `too-large`。`extra` 是每页都带的那几项（例如没记参与者的条数）。
 */
function pagedList<T>(view: CanonReadView, items: readonly T[], input: {readonly cursor?: string; readonly limit?: number}, params: {readonly method: string} & Readonly<Record<string, unknown>>, extra: Readonly<Record<string, unknown>> = {}): Ok<unknown> | Failure {
    let size = input.limit ?? 50;
    for (;;) {
        const page = pageOf(view.stamp, items, input.cursor, size, params, digest);
        if (page === "cursor-stale") return fail("cursor-stale");
        const value = {version: view.version, inputDigest: view.stamp.inputDigest, ...extra, items: page.items, ...(page.next === undefined ? {} : {cursor: page.next})};
        if (encodedBytes(value) <= CANON_BUDGET_BYTES) return {ok: true, value};
        if (size === 1) return fail("too-large");
        size = Math.max(1, Math.floor(size / 2));
    }
}

/** 缺省的读取位置：最新一章的末尾，没有章时是初值（canon.model 输出 21）。 */
function latest(view: CanonReadView): ReadPosition {
    const last = view.chapters.at(-1);
    return last === undefined ? {kind: "initial"} : {kind: "chapter", chapter: last, edge: "end"};
}

/** 一个调用方打开的视角：句柄到内核令牌与看的人、上限、用途。 */
type Viewpoints = Map<string, {readonly token: string; readonly grant: ViewpointGrant; readonly purpose: string; readonly line: string}>;
/** 最近关掉的句柄的看的人与用途（每个调用方最多留这么多）：之后再用它被拒时，审计里照样写得出是谁。 */
const CLOSED_KEPT = 100;
let viewpointSequence = 0;

function remotePlot(canon: CanonProject, viewpoints: Viewpoints): RemoteImplementation<typeof plotWorldContract> {
    const closed = new Map<string, {readonly viewer: string | null; readonly purpose: string}>();
    /** 取一份快照，在同一个同步段里算完。 */
    const withView = async <R>(run: (view: CanonReadView) => R): Promise<R | Failure> => {
        const snapshot = await canon.snapshot();
        if ("code" in snapshot) return fail(snapshot.code);
        return run(snapshot.view);
    };
    /**
     * 读取位置那条线的视图（worldlines 输出 12）：位置写了线用写的，不写按活页夹那一章讲的线。线读不到（不存在、实际模式下的
     * 计划线、不可建）是 `line-not-found`。
     */
    const lineViewOf = (view: CanonReadView, position: ReadPosition, mode: Mode): CanonReadView | Failure => {
        const line = view.positionLine(position, mode);
        if (line === view.line) return view;
        const found = view.onLine(line, mode);
        return "code" in found ? fail(found.code) : found;
    };
    /**
     * 带视角句柄的读取：取一份快照，在它上面建这张视图，同步算完。句柄不在（关了、别人的、从没有过）就是 `view-denied`，并记进
     * 内核的视图审计（knowledge.md 输出 9：每次拒绝都记）。
     */
    const withViewpoint = async <R>(handle: string, method: string, run: (viewpoint: Viewpoint) => R | string, page?: (viewpoint: Viewpoint, result: R) => Ok<unknown> | Failure): Promise<Ok<unknown> | Failure> => {
        const held = viewpoints.get(handle);
        if (held === undefined) {
            await canon.deny(closed.get(handle) ?? {viewer: null, purpose: ""}, method);
            return fail("view-denied");
        }
        const snapshot = await canon.snapshot();
        if ("code" in snapshot) return fail(snapshot.code);
        // 视角挂在它开的那条线上：剧情的算法在这条线的读取视图上算。
        const lineView = snapshot.view.line === held.line ? snapshot.view : snapshot.view.onLine(held.line);
        if ("code" in lineView) return fail(lineView.code);
        const viewpoint = new Viewpoint(lineView, snapshot.viewed(held.token), held.grant, (method, blocked) => void canon.audit(held.token, {method, blocked: blocked.map((id) => ({kind: "entry" as const, id}))}));
        const result = run(viewpoint);
        if (typeof result === "string") return fail(result);
        return page === undefined ? fitted(result) : page(viewpoint, result);
    };
    return {
        methods: {
            knowing: (input) => withView((main) => {
                const position = input.position ?? latest(main);
                const mode = input.mode ?? "actual";
                const view = lineViewOf(main, position, mode);
                if ("ok" in view) return view;
                if (view.positionKey(position) === null) return fail("chapter-not-found");
                const index = knowingIndex(view, input.mode ?? "actual", position);
                const rows = input.point === undefined ? index.all(input.person) : [index.effective(input.person, input.point)].filter((row) => row !== null);
                return pagedList(view, rows, input, {method: "knowing", person: input.person, point: input.point ?? null, position, mode: input.mode ?? "actual"});
            }),
            experience: (input) => withView((main) => {
                const position = input.position ?? latest(main);
                const mode = input.mode ?? "actual";
                const view = lineViewOf(main, position, mode);
                if ("ok" in view) return view;
                if (view.positionKey(position) === null) return fail("chapter-not-found");
                const present = experienceChanges(view, input.mode ?? "actual", position, input.person);
                return pagedList(view, present.changes, input, {method: "experience", person: input.person, position, mode: input.mode ?? "actual"}, {uncast: present.uncast});
            }),
            conflicts: (input) => withView((main) => {
                const position = input.position ?? latest(main);
                const view = lineViewOf(main, position, input.mode ?? "actual");
                if ("ok" in view) return view;
                if (view.positionKey(position) === null) return fail("chapter-not-found");
                const conflicts = conflictsOf(view, input.goal, position, input.mode ?? "actual");
                // 目标不存在、已删或在这个位置还没出场：同 canon 的 `not-found`（canon.project 的失败码）。
                if (conflicts === null) return fail("not-found");
                return fitted({version: view.version, inputDigest: view.stamp.inputDigest, conflicts});
            }),
            reader: (input) => withView((view) => fitted({version: view.version, inputDigest: view.stamp.inputDigest, degree: readerKnowing(view, input.point, input.at), first: firstReveal(view, input.point)})),
            ledger: (input) => withView((main) => {
                const position = input.position ?? latest(main);
                const view = lineViewOf(main, position, input.mode ?? "actual");
                if ("ok" in view) return view;
                if (view.positionKey(position) === null) return fail("chapter-not-found");
                return pagedList(view, ledger(view, position, input.mode ?? "actual", input.filter ?? {}), input, {method: "ledger", position, mode: input.mode ?? "actual", filter: input.filter ?? {}});
            }),
            openViewpoint: async (input) => {
                // 线：写了用写的，不写按活页夹上限那一章讲的线。
                const snapshot = await canon.snapshot();
                if ("code" in snapshot) return fail(snapshot.code);
                const line = input.line ?? snapshot.view.positionLine(input.until);
                const opened = await canon.openView({viewer: input.viewer, line, until: input.until, purpose: input.purpose});
                if (!("token" in opened)) return fail(opened.code);
                const handle = `viewpoint-${String(++viewpointSequence)}`;
                viewpoints.set(handle, {token: opened.token, grant: {viewer: input.viewer, until: input.until}, purpose: input.purpose, line});
                return {ok: true as const, value: {handle}};
            },
            closeViewpoint: async (input) => {
                const held = viewpoints.get(input.handle);
                if (held !== undefined) {
                    viewpoints.delete(input.handle);
                    closed.set(input.handle, {viewer: held.grant.viewer, purpose: held.purpose});
                    if (closed.size > CLOSED_KEPT) closed.delete(closed.keys().next().value!);
                    await canon.closeView(held.token);
                }
                return {ok: true as const, value: null};
            },
            viewpointEntry: (input) => withViewpoint(input.handle, "viewpoint.entry", (viewpoint) => viewpoint.entry(input.id)),
            viewpointLookup: (input) => withViewpoint(input.handle, "viewpoint.lookup", (viewpoint) => viewpoint.lookup(input.names)),
            viewpointExperience: (input) => withViewpoint(input.handle, "viewpoint.experience", (viewpoint) => viewpoint.experience(), (viewpoint, experience) => pagedList(viewpoint.view, experience.items, input, {method: "viewpoint.experience", handle: input.handle}, {uncast: experience.uncast})),
            viewpointKnowing: (input) => withViewpoint(input.handle, "viewpoint.knowing", (viewpoint) => viewpoint.knowing(input.who), (viewpoint, rows) => pagedList(viewpoint.view, rows, input, {method: "viewpoint.knowing", handle: input.handle, who: input.who})),
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
        remoteProvides: [plotWorldContract, plotInstructionsContract],
        activate: (context) => {
            const canon = context.services.require(canonProjectKey);
            // 写作指示快照表：这个项目实例的所有调用方与诊断计算共用（闭包里，不放模块级）。
            const instructions = new InstructionTable();
            canon.register({compute: {...knowingDiagnostics(), ...foreshadowDiagnostics(), ...goalDiagnostics(), ...decisionDiagnostics(), ...guardDiagnostics(digest), ...instructionDiagnostics(instructions)}, dataVersion: instructions.dataVersion});
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
            const instructionsRemote = provideRemote(plotInstructionsContract, () => ({
                methods: {
                    put: (input) => {
                        // 单条消息的上限：整份快照一次装不下就拒（按章推，不要整书推）。
                        if (encodedBytes(input) > CANON_BUDGET_BYTES) return fail("too-large");
                        const result = instructions.put(input.chapter, input.snapshot, input.base);
                        if (!result.ok) return fail(result.code);
                        if (result.changed) canon.reportDataVersion(result.dataVersion);
                        return {ok: true as const, value: {dataVersion: result.dataVersion}};
                    },
                    current: () => ({ok: true as const, value: {dataVersion: instructions.dataVersion}}),
                },
                events: {},
            }));
            return {remote: [remote, instructionsRemote]};
        },
    })],
};
