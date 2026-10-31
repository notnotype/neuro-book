/**
 * 宿主面：新建、打开、关闭会话，以及会话对外的 `SessionApi`（提案第 14 节）。
 *
 * 打开的顺序（session.md“状态与转换”）：取锁、修复与校验（存储）→ 按会话头解析 Profile 并装配 → 归约（要用扩展的
 * `reduce`，所以在装配之后）→ 比对 Profile 哈希，不同就写 `profileChanged{code-updated}` → 恢复 → 装上扩展。
 * 这些都完成之后才受理指令。Profile 解析不到或装配失败时会话以只读打开：能查询，不受理会改变对话的指令。
 *
 * 关闭的顺序：拒绝新指令 → 中止并等收口 → 等队列清空 → 关日志与锁。关闭之后迟到的回调不写日志。
 */

import {randomBytes} from "node:crypto";
import {Value} from "typebox/value";
import type {TSchema} from "typebox";
import type {AnyProfile, CommandName, CreateSessionOptions, Issuer, JsonValue, LogEvent, SessionApi, SessionEnv, SessionHeader, SessionSnapshot, StorageResult} from "../api/index.js";
import {LOG_FORMAT} from "../api/index.js";
import {SessionCore, type EventDraft} from "../dispatch/core.js";
import {assemble, type Assembly} from "../extension/assemble.js";
import {abortCommand, enqueueCommand, sendCommand, startCommand, type CommandHost} from "../run/commands.js";
import {RunControl} from "../run/control.js";
import {recoveryDrafts} from "../run/recover.js";
import {runResultOf} from "../run/results.js";

type CreateResult = StorageResult<SessionApi> | {ok: false; code: "profile-invalid" | "invalid-initial"; detail?: Record<string, JsonValue>};

interface Internals {
    readonly core: SessionCore;
    readonly control: RunControl;
    closed: boolean;
}
const internals = new WeakMap<SessionApi, Internals>();

/** 开发模式（冻结状态与事件）：测试与开发时开，生产环境可以关掉省一次遍历。 */
const FREEZE = process.env.NODE_ENV !== "production";

function newSessionId(now: number): string {
    return `${now.toString(36)}-${randomBytes(5).toString("hex")}`;
}

class NotYetImplemented extends Error {
    constructor(name: string) {
        super(`${name} is not implemented in the kernel yet`);
        this.name = "NotYetImplemented";
    }
}

/** Profile 解析不到时的占位：只为能归约内核事件、给出只读的快照。 */
function placeholderProfile(id: string): AnyProfile {
    return {id, version: "unknown", name: id, description: "", events: {}} as unknown as AnyProfile;
}

function assembleOrPlaceholder(env: SessionEnv, profile: AnyProfile | undefined, id: string): {assembly: Assembly; readOnly: string | null} {
    if (profile !== undefined) {
        const assembled = assemble(profile, env.extensions?.() ?? []);
        if (assembled.ok) return {assembly: assembled.assembly, readOnly: null};
    }
    const fallback = assemble(placeholderProfile(id), []);
    if (!fallback.ok) throw new Error("placeholder profile failed to assemble");
    return {assembly: fallback.assembly, readOnly: profile === undefined ? "unknown-profile" : "dependency-missing"};
}

function buildApi(env: SessionEnv, core: SessionCore, readOnly: string | null, issuer: Issuer, shared?: Internals): SessionApi {
    const state: Internals = shared ?? {core, control: new RunControl(core), closed: false};
    const {control} = state;
    if (shared === undefined) {
        const initial = (core.events.find((event) => event.type === "sessionCreated")?.data as {initial?: unknown} | undefined)?.initial ?? null;
        control.attach({
            core,
            models: env.models,
            environment: (model) => ({tools: [], model, now: core.clock.now(), initial}),
            tools: () => [],
        });
    }
    const host: CommandHost = {core, control, models: env.models, readOnly: () => readOnly};
    const closedGuard = <T>(run: () => Promise<T>): Promise<T> => (state.closed ? Promise.resolve({ok: false, code: "session-closed"} as T) : run());
    const notYet = (name: CommandName | string) => () => Promise.reject(new NotYetImplemented(name));
    const api: SessionApi = {
        id: core.header.id,
        issuer,
        as: (next) => buildApi(env, core, readOnly, next, state),
        send: (args) => closedGuard(() => sendCommand(host, args)),
        enqueue: (args) => closedGuard(() => enqueueCommand(host, args)),
        start: (args) => closedGuard(() => startCommand(host, args)),
        abort: () => closedGuard(() => abortCommand(host)),
        edit: notYet("edit"),
        remove: notYet("remove"),
        resolve: notYet("resolve"),
        rewind: notYet("rewind"),
        switchBranch: notYet("switchBranch"),
        fork: notYet("fork"),
        compact: notYet("compact"),
        changeSettings: notYet("changeSettings"),
        changeProfile: notYet("changeProfile"),
        setTitle: notYet("setTitle"),
        archive: notYet("archive"),
        async snapshot(): Promise<SessionSnapshot> {
            const kernel = core.session.kernel;
            const errors = core.diagnostics.all().filter((item) => item.level === "error").length;
            return {
                sessionId: core.header.id,
                header: core.header,
                head: core.head,
                leaf: core.leaf,
                profile: {id: core.assembly.profile.id, hash: core.assembly.hash},
                extensions: core.assembly.order.filter((item) => item.role !== "profile").map((item) => ({id: item.definition.id, plugin: item.plugin, version: item.version, status: "active", tags: item.definition.tags ?? []})),
                status: control.status,
                buffer: [...kernel.buffer],
                settings: kernel.core,
                title: kernel.title,
                archived: kernel.archived,
                readOnly: readOnly === null ? null : {code: readOnly as "unknown-profile"},
                pendingReassembly: null,
                diagnostics: {errors, warnings: core.diagnostics.all().length - errors},
            };
        },
        async log({afterSeq, limit = 500}) {
            const start = core.events.findIndex((event) => event.seq > afterSeq);
            const events: LogEvent[] = start < 0 ? [] : core.events.slice(start, start + limit);
            return {events, head: core.head, more: start >= 0 && start + limit < core.events.length};
        },
        rewindTargets: notYet("rewindTargets"),
        async path(args) {
            return core.pathTo(args?.leaf === undefined ? core.leaf : args.leaf);
        },
        siblings: notYet("siblings"),
        async runResult({runId}) {
            return runResultOf(core.events, runId);
        },
        preview: notYet("preview"),
        async diagnostics() {
            return core.diagnostics.all();
        },
        subscribe: (listener) => core.subscribe(listener),
        waitRun: (runId) => control.waitRun(runId),
    };
    internals.set(api, state);
    return api;
}

export async function createSession(env: SessionEnv, options: CreateSessionOptions): Promise<CreateResult> {
    const profile = await env.profiles.resolve(options.profile);
    if (profile === undefined) return {ok: false, code: "unknown-profile"};
    const assembled = assemble(profile, env.extensions?.() ?? []);
    if (!assembled.ok) return {ok: false, code: "profile-invalid", detail: {problems: assembled.problems as unknown as JsonValue}};
    const initial = (options.initial ?? {}) as JsonValue;
    const schema = (profile as {initial?: TSchema}).initial;
    if (schema !== undefined && !Value.Check(schema, initial)) return {ok: false, code: "invalid-initial"};
    const now = env.clock.now();
    const declaredResult = (profile as {result?: {mode: "optional" | "required"; schema: JsonValue}}).result;
    const result = options.result ?? declaredResult;
    const header: SessionHeader = {
        format: LOG_FORMAT,
        id: options.id ?? newSessionId(now),
        createdAt: now,
        profile: profile.id,
        ...(options.project === undefined ? {} : {project: options.project}),
        ...(options.caller === undefined ? {} : {caller: options.caller}),
        questions: options.questions ?? "user",
        ...(result === undefined ? {} : {result}),
    };
    const created = await env.store.create(header);
    if (!created.ok) return created;
    const core = new SessionCore({header, store: env.store, handle: created.value, assembly: assembled.assembly, clock: env.clock, freeze: FREEZE});
    const {assembly} = assembled;
    await core.queue.run(() => core.write([
        {type: "sessionCreated", kind: "ctrl", scope: "path", data: {initial}},
        {type: "profileChanged", kind: "ctrl", scope: "session", data: {profile: profile.id, hash: assembly.hash, from: null, reason: "created", manifest: assembly.manifest as unknown as JsonValue}},
    ]));
    return {ok: true, value: buildApi(env, core, null, {kind: "user"})};
}

export async function openSession(env: SessionEnv, id: string): Promise<StorageResult<SessionApi>> {
    const opened = await env.store.open(id);
    if (!opened.ok) return opened;
    const handle = opened.value;
    const {assembly, readOnly} = assembleOrPlaceholder(env, await env.profiles.resolve(handle.header.profile), handle.header.profile);
    const core = new SessionCore({header: handle.header, store: env.store, handle, assembly, clock: env.clock, freeze: FREEZE});
    core.load(handle.events);
    core.reportOpenNotices();
    if (readOnly === null) {
        const previous = core.session.kernel.profile;
        const drafts: EventDraft[] = [];
        if (previous?.hash !== assembly.hash) {
            drafts.push({type: "profileChanged", kind: "ctrl", scope: "session", data: {profile: assembly.profile.id, hash: assembly.hash, from: previous?.hash ?? null, reason: "code-updated", manifest: assembly.manifest as unknown as JsonValue}});
        }
        await core.queue.run(() => core.write(drafts));
        const recovery = recoveryDrafts(core);
        await core.queue.run(() => core.write(recovery));
    } else {
        core.diagnostics.add({code: "unknown-profile", entry: "host", params: {profile: handle.header.profile, reason: readOnly}, message: `profile ${handle.header.profile} could not be assembled; the session is read-only`}, core.head);
    }
    return {ok: true, value: buildApi(env, core, readOnly, {kind: "user"})};
}

/** 关闭：拒绝新指令 → 中止并等收口 → 等队列清空 → 关日志与锁。重复调用无事。 */
export async function closeSession(session: SessionApi): Promise<void> {
    const state = internals.get(session);
    if (state === undefined || state.closed) return;
    state.closed = true;
    if (!state.core.broken) await state.control.shutdown();
    await state.core.queue.drain();
    await state.core.store.close(state.core.handle);
}

/**
 * 某个扩展在当前叶子上的片（path 与 session 合在一起）。公开接口里没有“读某个扩展的片”，只给测试工具用，不从包入口导出。
 */
export function extensionState(session: SessionApi, id: string): Record<string, unknown> {
    const state = internals.get(session);
    if (state === undefined) throw new Error("not a kernel session");
    const at = state.core.stateAt();
    return {...at.path[id], ...at.session[id]};
}
