/**
 * 指令（提案第 3 节）。每条被受理的指令在受理批里写 `commandAccepted{commandId, name, value}`，重发同一个 `commandId`
 * 返回第一次的 `value` 与 `replayed: true`；校验失败不写，重发重新校验（session.md 输出 17）。
 * `value` 引用的 id 都在受理批里写出：空闲时会开始运行的指令，受理批就含 `runStarted`（输出 18）。
 *
 * 受理（校验加写）在队列的一项里做，所以两条指令的校验看到的状态不会交错。`send`、`enqueue` 的输入拦截链也在这一项里跑
 * （runtime.md 输出 24），拒绝时整条指令失败、不写日志。`abort` 不经队列（先判权限、触发信号），清空或留着由收口批写下。
 * 发出者的权限都经 `permissions.ts`（输出 108）。
 */

import type {Attributed, CommandMap, CommandName, CommandResult, InputMode, Issuer, JsonValue, LogEvent, ModelPort, Placement, ReleaseMode, Resources, UserInput} from "../api/index.js";
import {LogBrokenError, type EventDraft, type SessionCore} from "../dispatch/core.js";
import {canonicalJson, sha256} from "../log/json.js";
import type {RunControl} from "./control.js";
import {blockedByUser, canAbort, canContinue, canEdit, canRemove, continuableEnded, ownerOf, sameIssuer} from "./permissions.js";
import {openRunDrafts, projectSession, releaseDrafts} from "./settle.js";
import {ctrl} from "./writes.js";
import {writeAndReact, type ReactHost} from "../dispatch/reactions.js";
import {defaultSettings, type ViewEnvironment} from "../extension/ctx.js";
import {byField, interceptInput, queuedData} from "./input.js";
import {settingsProblem} from "./settings.js";

export interface CommandHost {
    readonly core: SessionCore;
    readonly react: ReactHost;
    readonly control: RunControl;
    readonly models: ModelPort;
    readonly resources: Resources;
    /** 输入拦截的视图环境。 */
    environment(): ViewEnvironment;
    /** 会话为什么只读；可写时为 null。 */
    readOnly(): string | null;
    /** 会话已开始关闭：在队列里等到这一项的指令（例如输入拦截还没返回时关闭开始了）不再写入、不再开运行。 */
    closed(): boolean;
    /** 进行中的重新装配；没有时为 null。排在它之前进了队列的指令要等它做完再判定（runtime.md 输出 57）。 */
    reassembling(): Promise<void> | null;
}

/** 受理项发现有进行中的重新装配：让出队列，等它做完再从头受理。 */
const AFTER_REASSEMBLY = Symbol("after-reassembly");

/**
 * `written`：受理批写下之后、还在这一个队列项里做的事（写失败就不做，内存不会领先日志）。
 * `after`：队列项结束之后再做的事（例如装上扩展：它自己要排队写日志，不能在这一项里等）。
 */
export type Outcome<K extends CommandName> = {value: CommandMap[K]["value"]; drafts: EventDraft[]; launch?: string; launchOptions?: {compact?: {require: readonly string[]}}; written?: () => Promise<void>; after?: () => Promise<void>} | {fail: string; detail?: Attributed | Record<string, JsonValue>};

/** 受理一条指令：查重发、校验、写受理批、需要时开始运行。 */
export async function accept<K extends CommandName>(host: CommandHost, name: K, args: CommandMap[K]["args"] & {commandId: string}, decide: () => Outcome<K> | Promise<Outcome<K>>): Promise<CommandResult<K>> {
    const {core} = host;
    const {commandId} = args;
    const argsHash = argsHashOf(args);
    let after: (() => Promise<void>) | undefined;
    let waitFor: Promise<void> | null = null;
    // 这次受理批写失败：句柄进损坏状态，指令以 `log-broken` 交回（session.md 输出 12），不把错误抛给调用方。
    const result = await core.queue.run(async (): Promise<CommandResult<K> | typeof AFTER_REASSEMBLY> => {
        const previous = core.commands.get(commandId);
        if (previous !== undefined) return replay(previous, name, argsHash) as CommandResult<K>;
        if (core.broken) return {ok: false, code: "log-broken"} as unknown as CommandResult<K>;
        // 运行收口时排下的重新装配先做：在它之前就排进队列的指令也等它（重新装配要占队列，不能在这一项里等）。
        waitFor = host.reassembling();
        if (waitFor !== null) return AFTER_REASSEMBLY;
        const outcome = await decide();
        if (host.closed()) return {ok: false, code: "session-closed"} as unknown as CommandResult<K>;
        if ("fail" in outcome) return {ok: false, code: outcome.fail, ...(outcome.detail === undefined ? {} : {detail: outcome.detail})} as unknown as CommandResult<K>;
        const accepted: EventDraft = {type: "commandAccepted", kind: "ctrl", scope: "session", data: {commandId, name, value: outcome.value as JsonValue, argsHash}};
        // commandAccepted 排在批的最后：它的 seq 就是受理批最后一条的 seq，重发时原样交回。
        let written: readonly LogEvent[];
        try {
            ({events: written} = await writeAndReact(core, [...outcome.drafts, accepted], host.react));
        } catch (error) {
            if (error instanceof LogBrokenError) return {ok: false, code: "log-broken"} as unknown as CommandResult<K>;
            throw error;
        }
        await outcome.written?.();
        // 写下之后关闭才开始的：不开运行，已写下的 runStarted 由重开时的恢复收口（runtime.md 输出 104）。
        if (outcome.launch !== undefined && !host.closed()) host.control.launch(outcome.launch, outcome.launchOptions);
        after = outcome.after;
        return {ok: true, value: outcome.value, seq: written.at(-1)!.seq, replayed: false} as CommandResult<K>;
    });
    if (result === AFTER_REASSEMBLY) {
        await waitFor;
        return accept(host, name, args, decide);
    }
    if (after !== undefined) await after();
    return result;
}

/** 指令参数（去掉 `commandId`）的哈希：重发同一个 `commandId` 时核对是不是同一条指令。 */
function argsHashOf(args: {commandId: string}): string {
    const {commandId: _commandId, ...rest} = args;
    return sha256(canonicalJson(rest));
}

/**
 * 重发：同名、同参数交回第一次的结果；名字或参数不同说明调用方把 `commandId` 用重了，得 `command-id-conflict`，
 * 不当成重发（否则第二条指令静默地拿到第一条的结果）。早先写下的受理记录没有参数哈希，只比名字。
 */
function replay(previous: {name: string; value: JsonValue; seq: number; argsHash?: string}, name: string, argsHash: string): {ok: true; value: never; seq: number; replayed: true} | {ok: false; code: "command-id-conflict"} {
    if (previous.name !== name || (previous.argsHash !== undefined && previous.argsHash !== argsHash)) return {ok: false, code: "command-id-conflict"};
    return {ok: true, value: previous.value as never, seq: previous.seq, replayed: true};
}

export const isEmpty = (input: UserInput): boolean => input.text.trim() === "" && (input.attachments?.length ?? 0) === 0;

/** 开始运行前就能判定的失败：只读、解析不到模型（码原样交回，见 `ModelResolutionCode`）。 */
export function startProblem(host: CommandHost): string | null {
    if (host.readOnly() !== null) return "read-only";
    const resolution = host.models.resolve({settings: host.core.session.kernel.core, purpose: "turn", profile: host.core.assembly.profile.id});
    return resolution.ok ? null : resolution.code;
}

const USER: Issuer = {kind: "user"};

/** 接着跑暂停的运行时写的事件（runtime.md 输出 36）。 */
const resumedDraft = (runId: string, issuer: Issuer): EventDraft => ({type: "runResumed", kind: "ctrl", scope: "session", data: {runId, ...byField(issuer)} as JsonValue});

/** 叶子上暂停的运行与它的开启者（旧日志没有 `by` 时是用户）。 */
function pausedRun(host: CommandHost): {runId: string; by: Issuer} | null {
    const runId = host.control.paused;
    return runId === null ? null : {runId, by: host.core.leafState.kernel.runBy ?? USER};
}

/** `replaces` 的条件写入（输出 107）：每条要还在、改过的次数对得上、是这个发出者能移除的。 */
function replaceDrafts(core: SessionCore, issuer: Issuer, replaces: readonly {id: string; edits: number}[], replacedBy: string): {drafts: EventDraft[]} | {fail: "input-stale" | "not-allowed"} {
    const drafts: EventDraft[] = [];
    for (const target of replaces) {
        const item = core.session.kernel.buffer.find((entry) => entry.id === target.id);
        if (item === undefined || item.edits !== target.edits) return {fail: "input-stale"};
        if (!canRemove(item, issuer)) return {fail: "not-allowed"};
        drafts.push({type: "inputRemoved", kind: "ctrl", scope: "session", data: {id: item.id, reason: "replaced", replacedBy, ...byField(issuer)} as JsonValue});
    }
    return {drafts};
}

type Delivered = {value: {inputId: string; runId: string | null; currentRunId?: string; placement: Placement}; drafts: EventDraft[]; launch?: string; written?: () => Promise<void>};

/**
 * 送一条新话（`send` 与用户的 `enqueue`，输出 2、3、105、110）：先替换、再放行这个发出者能放行的，再写新话；空闲时开运行
 * （或接着跑叶子上能接着跑的暂停的运行），运行不再取输入时推迟到收口。
 */
async function deliver(host: CommandHost, issuer: Issuer, args: {commandId: string; input: UserInput; mode: InputMode; release?: ReleaseMode; replaces?: readonly {id: string; edits: number}[]}): Promise<Delivered | {fail: string; detail?: Attributed}> {
    const {core, control} = host;
    const active = control.active;
    const window = active !== null && !control.takesInput;
    const paused = active === null ? pausedRun(host) : null;
    const resumable = paused !== null && canContinue(paused.by, null, issuer);
    if (active === null && (paused === null || resumable)) {
        const problem = startProblem(host);
        if (problem !== null) return {fail: problem};
    }
    const intercepted = await interceptInput(host, args.input);
    if (!intercepted.ok) return {fail: "input-rejected", detail: intercepted.rejection};
    const inputId = core.newId();
    const replaced = replaceDrafts(core, issuer, args.replaces ?? [], inputId);
    if ("fail" in replaced) return replaced;
    const mode = args.release ?? "keep";
    if (paused !== null && !resumable) {
        // 不能接着跑叶子上别人的暂停的运行：话按空闲时排的留着，不放行、不开运行（输出 36）。
        const queued: EventDraft = {type: "inputQueued", kind: "ctrl", scope: "session", data: queuedData(inputId, intercepted, args.mode, issuer, {commandId: args.commandId, held: {queued: "idle"}})};
        return {value: {inputId, runId: null, currentRunId: paused.runId, placement: "held"}, drafts: [...intercepted.failed, ...replaced.drafts, queued]};
    }
    const queued: EventDraft = {type: "inputQueued", kind: "ctrl", scope: "session", data: queuedData(inputId, intercepted, args.mode, issuer, {commandId: args.commandId})};
    if (window) {
        // 运行不再取输入（只压缩、停止中）：话照常排进去，放行与开运行推迟到收口批（输出 104）。
        return {value: {inputId, runId: null, currentRunId: active.runId, placement: "later"}, drafts: [...intercepted.failed, ...replaced.drafts, queued], written: async () => control.defer({issuer, mode, inputIds: [inputId]})};
    }
    const before = [...intercepted.failed, ...replaced.drafts];
    const released = releaseDrafts(projectSession(core.session.kernel, before, core.head).buffer, issuer, mode);
    const drafts = [...before, ...released.drafts, queued];
    if (active !== null) return {value: {inputId, runId: null, currentRunId: active.runId, placement: "taken"}, drafts};
    if (paused !== null) return {value: {inputId, runId: paused.runId, placement: "taken"}, drafts: [...drafts, resumedDraft(paused.runId, issuer)], launch: paused.runId};
    // 放行出来的排在新话前面：取投影后就绪的第一条开第一轮（输出 2）。
    const opened = openRunDrafts(core, projectSession(core.session.kernel, drafts, core.head).buffer, issuer)!;
    return {value: {inputId, runId: opened.runId, placement: "taken"}, drafts: [...drafts, ...opened.drafts], launch: opened.runId};
}

export function sendCommand(host: CommandHost, issuer: Issuer, args: CommandMap["send"]["args"] & {commandId: string}): Promise<CommandResult<"send">> {
    return accept(host, "send", args, async () => {
        if (isEmpty(args.input)) return {fail: "empty-input"};
        return deliver(host, issuer, {...args, mode: args.mode ?? "followup"});
    });
}

export function enqueueCommand(host: CommandHost, issuer: Issuer, args: CommandMap["enqueue"]["args"] & {commandId: string}): Promise<CommandResult<"enqueue">> {
    return accept(host, "enqueue", args, async (): Promise<Outcome<"enqueue">> => {
        if (isEmpty(args.input)) return {fail: "empty-input"};
        if (host.readOnly() !== null) return {fail: "read-only"};
        const {core, control} = host;
        const position = core.session.kernel.buffer.length;
        const running = control.active !== null && control.takesInput;
        if (!running && issuer.kind !== "user") {
            // 会话、宿主空闲时（含运行不再取输入）排的：留着，不放行、不开运行（输出 3）。
            const intercepted = await interceptInput(host, args.input);
            if (!intercepted.ok) return {fail: "input-rejected", detail: intercepted.rejection};
            const inputId = core.newId();
            const current = control.active?.runId ?? control.paused ?? undefined;
            return {value: {inputId, position, placement: "held", ...(current === undefined ? {} : {currentRunId: current})}, drafts: [...intercepted.failed, {type: "inputQueued", kind: "ctrl", scope: "session", data: queuedData(inputId, intercepted, args.mode, issuer, {commandId: args.commandId, held: {queued: "idle"}})}]};
        }
        // 用户空闲时排的等于发送；有运行在取输入时只入队（输出 3）。
        const delivered = await deliver(host, issuer, args);
        if ("fail" in delivered) return delivered;
        const {inputId, runId, currentRunId, placement} = delivered.value;
        return {...delivered, value: {inputId, position, placement, ...(runId === null ? {} : {runId}), ...(currentRunId === undefined ? {} : {currentRunId})}};
    });
}

/** 叶子上能接着跑的已收口运行（中断、出错、停止在一轮当中），或暂停的运行；交回接着跑要写的事件。 */
function continueDrafts(host: CommandHost, issuer: Issuer, which: "any" | "interrupted"): {runId: string; drafts: EventDraft[]; launch: string} | {fail: "not-allowed"} | null {
    const {core} = host;
    const paused = pausedRun(host);
    if (paused !== null) {
        if (!canContinue(paused.by, null, issuer)) return {fail: "not-allowed"};
        return {runId: paused.runId, drafts: [resumedDraft(paused.runId, issuer)], launch: paused.runId};
    }
    const last = continuableEnded(core.leafState.kernel.lastChat);
    if (last === null || (which === "interrupted" && last.end !== "interrupted")) return null;
    if (!canContinue(last.by, last.stoppedBy, issuer)) return {fail: "not-allowed"};
    const runId = core.newId();
    return {runId, launch: runId, drafts: [ctrl("runStarted", {runId, kind: "chat", ...byField(issuer)}), ctrl("turnStarted", {turnId: core.newId(), inputId: null})]};
}

export function startCommand(host: CommandHost, issuer: Issuer, args: CommandMap["start"]["args"] & {commandId: string}): Promise<CommandResult<"start">> {
    return accept(host, "start", args, () => {
        const {core, control} = host;
        if (!control.idle) return {fail: "already-running"};
        // 接着跑叶子上没有正常结束的那一轮，不取留着的话（输出 4）。
        const continued = continueDrafts(host, issuer, "any");
        if (continued !== null && "fail" in continued) return continued;
        if (continued !== null) {
            const problem = startProblem(host);
            if (problem !== null) return {fail: problem};
            return {value: {runId: continued.runId}, drafts: continued.drafts, launch: continued.launch};
        }
        // 只有升级前的旧日志会有空闲会话里就绪的话：取走第一条开一轮。
        const opened = openRunDrafts(core, core.session.kernel.buffer, issuer);
        if (opened === null) return {fail: "nothing-to-continue"};
        const problem = startProblem(host);
        if (problem !== null) return {fail: problem};
        return {value: {runId: opened.runId}, drafts: opened.drafts, launch: opened.runId};
    });
}

/** 空闲时放行（`resume`、`release`，输出 106、107）：先接着跑能接着跑的中断或暂停的运行，否则用放行出来的开新运行。 */
function releaseWhileIdle(host: CommandHost, issuer: Issuer, released: {drafts: EventDraft[]; ids: string[]}): Outcome<"resume"> {
    const {core} = host;
    const continued = continueDrafts(host, issuer, "interrupted");
    if (continued !== null && "fail" in continued && pausedRun(host) !== null) return continued;
    if (continued !== null && !("fail" in continued)) {
        const problem = startProblem(host);
        if (problem !== null) return {fail: problem};
        return {value: {runId: continued.runId, released: released.ids}, drafts: [...released.drafts, ...continued.drafts], launch: continued.launch};
    }
    if (released.ids.length === 0) return {fail: blockedByUser(core.session.kernel.buffer, issuer) ? "held-by-user" : "nothing-to-resume"};
    const problem = startProblem(host);
    if (problem !== null) return {fail: problem};
    const opened = openRunDrafts(core, projectSession(core.session.kernel, released.drafts, core.head).buffer, issuer);
    if (opened === null) return {value: {runId: null, released: released.ids}, drafts: released.drafts};
    return {value: {runId: opened.runId, released: released.ids}, drafts: [...released.drafts, ...opened.drafts], launch: opened.runId};
}

export function resumeCommand(host: CommandHost, issuer: Issuer, args: CommandMap["resume"]["args"] & {commandId: string}): Promise<CommandResult<"resume">> {
    return accept(host, "resume", args, () => {
        const {core, control} = host;
        const mode = args.mode ?? "keep";
        if (control.active !== null && !control.takesInput) return {value: {runId: null, released: []}, drafts: [], written: async () => control.defer({issuer, mode, inputIds: []})};
        const released = releaseDrafts(core.session.kernel.buffer, issuer, mode);
        if (control.active === null) return releaseWhileIdle(host, issuer, released);
        if (released.ids.length === 0) return {fail: blockedByUser(core.session.kernel.buffer, issuer) ? "held-by-user" : "nothing-to-resume"};
        return {value: {runId: null, released: released.ids}, drafts: released.drafts};
    });
}

export function releaseCommand(host: CommandHost, issuer: Issuer, args: CommandMap["release"]["args"] & {commandId: string}): Promise<CommandResult<"release">> {
    return accept(host, "release", args, (): Outcome<"release"> => {
        const {core, control} = host;
        const buffer = core.session.kernel.buffer;
        const items = args.inputIds.map((id) => buffer.find((entry) => entry.id === id && entry.state === "held"));
        const missing = args.inputIds.filter((_id, index) => items[index] === undefined);
        if (missing.length > 0) return {fail: "nothing-to-release", detail: {ids: missing}};
        if (issuer.kind !== "user") {
            if (items.some((item) => item!.heldBy?.kind === "user")) return {fail: "held-by-user"};
            if (items.some((item) => !sameIssuer(ownerOf(item!), issuer))) return {fail: "not-allowed"};
        }
        if (control.active !== null && !control.takesInput) return {value: {runId: null, released: []}, drafts: [], written: async () => control.defer({issuer, mode: "keep", inputIds: [], only: args.inputIds})};
        const released = releaseDrafts(buffer, issuer, "keep", args.inputIds);
        if (control.active === null) return releaseWhileIdle(host, issuer, released) as Outcome<"release">;
        return {value: {runId: null, released: released.ids}, drafts: released.drafts};
    });
}

/** 进行中与已完成的中止，按 `commandId`：中止不经队列，重发可能在第一次还没写下受理记录时就到。 */
const aborting = new WeakMap<SessionCore, Map<string, Promise<CommandResult<"abort">>>>();

/**
 * 中止（输出 30）：权限判定、读下范围、触发信号在同一个同步步骤里；受理记录与清空或留着由收口批写下（`settle.ts`）。
 * 没有运行、或这次运行已在组收口批时 `aborted: false`、不写日志。重发同一个 `commandId`（重开之后也一样）交回第一次的结果。
 */
export function abortCommand(host: CommandHost, issuer: Issuer, args: CommandMap["abort"]["args"] & {commandId: string}): Promise<CommandResult<"abort">> {
    const {core, control} = host;
    const argsHash = argsHashOf(args);
    const previous = core.commands.get(args.commandId);
    if (previous !== undefined) return Promise.resolve(replay(previous, "abort", argsHash) as CommandResult<"abort">);
    const inflight = aborting.get(core) ?? new Map<string, Promise<CommandResult<"abort">>>();
    aborting.set(core, inflight);
    const running = inflight.get(args.commandId);
    if (running !== undefined) return running.then((result) => (result.ok ? {...result, replayed: true} : result));
    if (control.active !== null && !canAbort(core.header, core.leafState.kernel.runBy ?? USER, issuer)) return Promise.resolve({ok: false, code: "not-allowed"} as CommandResult<"abort">);
    const settled = control.recordStop({by: issuer, keep: args.keepQueue === true, scope: core.session.kernel.buffer.map((item) => item.id)}, {commandId: args.commandId, argsHash});
    if (settled === null) return Promise.resolve({ok: true, value: {aborted: false}, seq: core.head, replayed: false});
    const first = (async (): Promise<CommandResult<"abort">> => {
        void control.abort();
        const seq = await settled;
        return {ok: true, value: {aborted: true}, seq, replayed: false};
    })();
    inflight.set(args.commandId, first);
    return first;
}

/** 缓冲区里的这条还在不在：不在时分清是从没入过队（`input-not-found`），还是已经取走或删掉（`input-consumed`）。 */
function bufferProblem(core: SessionCore, inputId: string): "input-not-found" | "input-consumed" | null {
    if (core.session.kernel.buffer.some((item) => item.id === inputId)) return null;
    return core.events.some((event) => event.type === "inputQueued" && (event.data as {id: string}).id === inputId) ? "input-consumed" : "input-not-found";
}

export function editCommand(host: CommandHost, issuer: Issuer, args: CommandMap["edit"]["args"] & {commandId: string}): Promise<CommandResult<"edit">> {
    return accept(host, "edit", args, async () => {
        if (isEmpty(args.input)) return {fail: "empty-input"};
        const problem = bufferProblem(host.core, args.inputId);
        if (problem !== null) return {fail: problem};
        // 只能改自己排的；条目的发出者不变（输出 29、108）。
        const item = host.core.session.kernel.buffer.find((entry) => entry.id === args.inputId)!;
        if (!canEdit(item, issuer)) return {fail: "not-allowed"};
        const intercepted = await interceptInput(host, args.input);
        if (!intercepted.ok) return {fail: "input-rejected", detail: intercepted.rejection};
        const data = queuedData(args.inputId, intercepted, "followup", USER) as Record<string, JsonValue>;
        const {mode: _mode, ...edited} = data;
        return {value: {}, drafts: [...intercepted.failed, {type: "inputEdited", kind: "ctrl", scope: "session", data: edited}]};
    });
}

export function removeCommand(host: CommandHost, issuer: Issuer, args: CommandMap["remove"]["args"] & {commandId: string}): Promise<CommandResult<"remove">> {
    return accept(host, "remove", args, () => {
        const problem = bufferProblem(host.core, args.inputId);
        if (problem !== null) return {fail: problem};
        const item = host.core.session.kernel.buffer.find((entry) => entry.id === args.inputId)!;
        if (!canRemove(item, issuer)) return {fail: "not-allowed"};
        return {value: {}, drafts: [{type: "inputRemoved", kind: "ctrl", scope: "session", data: {id: args.inputId, reason: "cancelled", ...byField(issuer)} as JsonValue}]};
    });
}

export function setTitleCommand(host: CommandHost, args: CommandMap["setTitle"]["args"] & {commandId: string}): Promise<CommandResult<"setTitle">> {
    return accept(host, "setTitle", args, () => {
        const title = args.title.trim();
        if (title === "") return {fail: "empty-title"};
        return {value: {}, drafts: [{type: "titleChanged", kind: "ctrl", scope: "session", data: {title, by: "user"}}]};
    });
}

export function setGeneratedMetaCommand(host: CommandHost, args: CommandMap["setGeneratedMeta"]["args"] & {commandId: string}): Promise<CommandResult<"setGeneratedMeta">> {
    return accept(host, "setGeneratedMeta", args, () => {
        const title = args.title?.trim() ?? "";
        const description = args.description?.trim() ?? "";
        if (title === "" && description === "") return {fail: "empty-meta"};
        // 在受理的队列项里判断：用户的 `setTitle` 不会夹在判断与写入之间，晚到的自动结果盖不掉它。
        const titleApplied = title !== "" && host.core.session.kernel.titleBy !== "user";
        const drafts: EventDraft[] = [];
        if (titleApplied) drafts.push({type: "titleChanged", kind: "ctrl", scope: "session", data: {title, by: "auto"}});
        if (description !== "") drafts.push({type: "descriptionChanged", kind: "ctrl", scope: "session", data: {description}});
        return {value: {titleApplied}, drafts};
    });
}

export function archiveCommand(host: CommandHost, args: CommandMap["archive"]["args"] & {commandId: string}): Promise<CommandResult<"archive">> {
    return accept(host, "archive", args, () => ({value: {}, drafts: [{type: "archived", kind: "ctrl", scope: "session", data: {archived: args.archived}}]}));
}

/**
 * 改设置：整体校验，每个扩展一条 `settingsChanged`，受理时就写。运行中受理的也立刻写：模型按每次请求时的核心设置解析、
 * 视图只在算请求时读设置，所以效果就是“下一次请求前生效”（`scheduled: "next-boundary"`）。值没变的项不写。
 */
export function changeSettingsCommand(host: CommandHost, args: CommandMap["changeSettings"]["args"] & {commandId: string}): Promise<CommandResult<"changeSettings">> {
    return accept(host, "changeSettings", args, () => {
        const {core} = host;
        const problem = settingsProblem(core.assembly, args.patch);
        if (problem !== null) {
            const {code, ...detail} = problem;
            return {fail: code, ...(code === "unknown-extension" ? {} : {detail: detail as Record<string, JsonValue>})};
        }
        const drafts: EventDraft[] = [];
        const changed: string[] = [];
        for (const [extension, values] of Object.entries(args.patch)) {
            // 扩展的组按生效值比：缺省值合并用户改过的（与视图读到的一样），提交与缺省相同的值不算变化。
            const item = core.assembly.order.find((entry) => entry.definition.id === extension);
            const current = (extension === "core" ? core.session.kernel.core : {...(item === undefined ? {} : defaultSettings(item.definition)), ...core.session.kernel.settings[extension]}) as Record<string, unknown>;
            const patch = Object.fromEntries(Object.entries(values).filter(([key, value]) => JSON.stringify(current[key]) !== JSON.stringify(value)));
            if (Object.keys(patch).length === 0) continue;
            changed.push(extension);
            drafts.push({type: "settingsChanged", kind: "ctrl", scope: "session", data: {extension, patch}});
        }
        return {value: {changed, scheduled: host.control.idle ? "now" : "next-boundary"}, drafts};
    });
}
