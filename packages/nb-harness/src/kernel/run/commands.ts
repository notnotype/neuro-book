/**
 * 指令（提案第 3 节）。每条被受理的指令在受理批里写 `commandAccepted{commandId, name, value}`，重发同一个 `commandId`
 * 返回第一次的 `value` 与 `replayed: true`；校验失败不写，重发重新校验（session.md 输出 17）。
 * `value` 引用的 id 都在受理批里写出：空闲时会开始运行的指令，受理批就含 `runStarted`（输出 18）。
 *
 * 受理（校验加写）在队列的一项里做，所以两条指令的校验看到的状态不会交错。`send`、`enqueue` 的输入拦截链也在这一项里跑
 * （runtime.md 输出 24），拒绝时整条指令失败、不写日志。`abort` 不经队列（先触发信号），清空缓冲区作为之后的一项写入。
 */

import type {Attributed, CommandMap, CommandName, CommandResult, JsonValue, ModelPort, Resources, UserInput} from "../api/index.js";
import type {EventDraft, SessionCore} from "../dispatch/core.js";
import type {RunControl} from "./control.js";
import {takeInputDrafts} from "./loop.js";
import {writeAndReact, type ReactHost} from "../dispatch/reactions.js";
import type {ViewEnvironment} from "../extension/ctx.js";
import {interceptInput, queuedData} from "./input.js";
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
}

type Outcome<K extends CommandName> = {value: CommandMap[K]["value"]; drafts: EventDraft[]; launch?: string} | {fail: string; detail?: Attributed | Record<string, JsonValue>};

/** 受理一条指令：查重发、校验、写受理批、需要时开始运行。 */
async function accept<K extends CommandName>(host: CommandHost, name: K, commandId: string, decide: () => Outcome<K> | Promise<Outcome<K>>): Promise<CommandResult<K>> {
    const {core} = host;
    return core.queue.run(async () => {
        const previous = core.commands.get(commandId);
        if (previous !== undefined) return {ok: true, value: previous.value as CommandMap[K]["value"], seq: previous.seq, replayed: true} as CommandResult<K>;
        if (core.broken) return {ok: false, code: "log-broken"} as unknown as CommandResult<K>;
        const outcome = await decide();
        if ("fail" in outcome) return {ok: false, code: outcome.fail, ...(outcome.detail === undefined ? {} : {detail: outcome.detail})} as unknown as CommandResult<K>;
        const accepted: EventDraft = {type: "commandAccepted", kind: "ctrl", scope: "session", data: {commandId, name, value: outcome.value as JsonValue}};
        // commandAccepted 排在批的最后：它的 seq 就是受理批最后一条的 seq，重发时原样交回。
        const {events: written} = await writeAndReact(core, [...outcome.drafts, accepted], host.react);
        if (outcome.launch !== undefined) host.control.launch(outcome.launch);
        return {ok: true, value: outcome.value, seq: written.at(-1)!.seq, replayed: false} as CommandResult<K>;
    });
}

const isEmpty = (input: UserInput): boolean => input.text.trim() === "" && (input.attachments?.length ?? 0) === 0;

/** 开始运行前就能判定的失败：只读、没有模型、没有凭据。 */
function startProblem(host: CommandHost): string | null {
    if (host.readOnly() !== null) return "read-only";
    const resolution = host.models.resolve(host.core.session.kernel.core, "turn");
    if (resolution.ok) return null;
    return resolution.code === "no-credentials" ? "no-credentials" : "no-model";
}

export function sendCommand(host: CommandHost, args: CommandMap["send"]["args"] & {commandId: string}): Promise<CommandResult<"send">> {
    return accept(host, "send", args.commandId, async () => {
        if (isEmpty(args.input)) return {fail: "empty-input"};
        const {core, control} = host;
        const idle = control.idle;
        const problem = idle ? startProblem(host) : null;
        if (problem !== null) return {fail: problem};
        const intercepted = await interceptInput(host, args.input);
        if (!intercepted.ok) return {fail: "input-rejected", detail: intercepted.rejection};
        const inputId = core.newId();
        const queued: EventDraft = {type: "inputQueued", kind: "ctrl", scope: "session", data: queuedData(inputId, intercepted, args.mode ?? "followup")};
        if (!idle) return {value: {inputId, runId: null}, drafts: [...intercepted.failed, queued]};
        const runId = core.newId();
        // 受理批先把输入放进缓冲区，再取走它开第一轮；崩溃在这之后由恢复结算这次运行。
        const started: EventDraft = {type: "runStarted", kind: "ctrl", scope: "path", data: {runId, kind: "chat"}};
        return {value: {inputId, runId}, drafts: [...intercepted.failed, queued, started, ...takeInputDrafts(inputId, intercepted.input, core.newId())], launch: runId};
    });
}

export function enqueueCommand(host: CommandHost, args: CommandMap["enqueue"]["args"] & {commandId: string}): Promise<CommandResult<"enqueue">> {
    return accept(host, "enqueue", args.commandId, async () => {
        if (isEmpty(args.input)) return {fail: "empty-input"};
        if (host.readOnly() !== null) return {fail: "read-only"};
        const intercepted = await interceptInput(host, args.input);
        if (!intercepted.ok) return {fail: "input-rejected", detail: intercepted.rejection};
        const inputId = host.core.newId();
        return {value: {inputId, position: host.core.session.kernel.buffer.length}, drafts: [...intercepted.failed, {type: "inputQueued", kind: "ctrl", scope: "session", data: queuedData(inputId, intercepted, args.mode)}]};
    });
}

export function startCommand(host: CommandHost, args: CommandMap["start"]["args"] & {commandId: string}): Promise<CommandResult<"start">> {
    return accept(host, "start", args.commandId, () => {
        const {core, control} = host;
        if (!control.idle) return {fail: "already-running"};
        const problem = startProblem(host);
        if (problem !== null) return {fail: problem};
        const runId = core.newId();
        const started: EventDraft = {type: "runStarted", kind: "ctrl", scope: "path", data: {runId, kind: "chat"}};
        const next = core.session.kernel.buffer[0];
        if (next !== undefined) return {value: {runId}, drafts: [started, ...takeInputDrafts(next.id, next.input, core.newId())], launch: runId};
        // 缓冲区空：没有新输入的“继续”运行；末尾已经是完整的回复时没什么可继续的。
        const history = core.leafState.kernel.history;
        const last = history.current ?? (history.committed === null ? null : history.committed.head);
        if (last === null || last.status === "completed") return {fail: "nothing-to-continue"};
        return {value: {runId}, drafts: [started, {type: "turnStarted", kind: "ctrl", scope: "path", data: {turnId: core.newId(), inputId: null}}], launch: runId};
    });
}

/**
 * 中止不经队列：先触发信号，收口由运行循环作为队列里的一项写入。幂等：没有运行时 `aborted: false`。
 * 中止了运行时缺省清空缓冲区（每条 `inputRemoved{reason: "aborted"}`），`keepQueue` 保留（runtime.md 输出 30）。
 */
export async function abortCommand(host: CommandHost, args: CommandMap["abort"]["args"] = {}): Promise<CommandResult<"abort">> {
    const {core} = host;
    const aborted = await host.control.abort();
    if (aborted && args.keepQueue !== true && core.session.kernel.buffer.length > 0 && !core.broken) {
        await core.queue.run(() => writeAndReact(core, core.session.kernel.buffer.map((item) => ({type: "inputRemoved", kind: "ctrl", scope: "session", data: {id: item.id, reason: "aborted"}})), host.react));
    }
    return {ok: true, value: {aborted}, seq: core.head, replayed: false};
}

/** 缓冲区里的这条还在不在：不在时分清是从没入过队（`input-not-found`），还是已经取走或删掉（`input-consumed`）。 */
function bufferProblem(core: SessionCore, inputId: string): "input-not-found" | "input-consumed" | null {
    if (core.session.kernel.buffer.some((item) => item.id === inputId)) return null;
    return core.events.some((event) => event.type === "inputQueued" && (event.data as {id: string}).id === inputId) ? "input-consumed" : "input-not-found";
}

export function editCommand(host: CommandHost, args: CommandMap["edit"]["args"] & {commandId: string}): Promise<CommandResult<"edit">> {
    return accept(host, "edit", args.commandId, async () => {
        if (isEmpty(args.input)) return {fail: "empty-input"};
        const problem = bufferProblem(host.core, args.inputId);
        if (problem !== null) return {fail: problem};
        const intercepted = await interceptInput(host, args.input);
        if (!intercepted.ok) return {fail: "input-rejected", detail: intercepted.rejection};
        const data = queuedData(args.inputId, intercepted, "followup") as Record<string, JsonValue>;
        const {mode: _mode, ...edited} = data;
        return {value: {}, drafts: [...intercepted.failed, {type: "inputEdited", kind: "ctrl", scope: "session", data: edited}]};
    });
}

export function removeCommand(host: CommandHost, args: CommandMap["remove"]["args"] & {commandId: string}): Promise<CommandResult<"remove">> {
    return accept(host, "remove", args.commandId, () => {
        const problem = bufferProblem(host.core, args.inputId);
        if (problem !== null) return {fail: problem};
        return {value: {}, drafts: [{type: "inputRemoved", kind: "ctrl", scope: "session", data: {id: args.inputId, reason: "user"}}]};
    });
}

export function setTitleCommand(host: CommandHost, args: CommandMap["setTitle"]["args"] & {commandId: string}): Promise<CommandResult<"setTitle">> {
    return accept(host, "setTitle", args.commandId, () => {
        const title = args.title.trim();
        if (title === "") return {fail: "empty-title"};
        return {value: {}, drafts: [{type: "titleChanged", kind: "ctrl", scope: "session", data: {title, by: "user"}}]};
    });
}

export function archiveCommand(host: CommandHost, args: CommandMap["archive"]["args"] & {commandId: string}): Promise<CommandResult<"archive">> {
    return accept(host, "archive", args.commandId, () => ({value: {}, drafts: [{type: "archived", kind: "ctrl", scope: "session", data: {archived: args.archived}}]}));
}

/**
 * 改设置：整体校验，每个扩展一条 `settingsChanged`，受理时就写。运行中受理的也立刻写：模型按每次请求时的核心设置解析、
 * 视图只在算请求时读设置，所以效果就是“下一次请求前生效”（`scheduled: "next-boundary"`）。值没变的项不写。
 */
export function changeSettingsCommand(host: CommandHost, args: CommandMap["changeSettings"]["args"] & {commandId: string}): Promise<CommandResult<"changeSettings">> {
    return accept(host, "changeSettings", args.commandId, () => {
        const {core} = host;
        const problem = settingsProblem(core.assembly, args.patch);
        if (problem !== null) {
            const {code, ...detail} = problem;
            return {fail: code, ...(code === "unknown-extension" ? {} : {detail: detail as Record<string, JsonValue>})};
        }
        const drafts: EventDraft[] = [];
        const changed: string[] = [];
        for (const [extension, values] of Object.entries(args.patch)) {
            const current = (extension === "core" ? core.session.kernel.core : core.session.kernel.settings[extension] ?? {}) as Record<string, unknown>;
            const patch = Object.fromEntries(Object.entries(values).filter(([key, value]) => JSON.stringify(current[key]) !== JSON.stringify(value)));
            if (Object.keys(patch).length === 0) continue;
            changed.push(extension);
            drafts.push({type: "settingsChanged", kind: "ctrl", scope: "session", data: {extension, patch}});
        }
        return {value: {changed, scheduled: host.control.idle ? "now" : "next-boundary"}, drafts};
    });
}
