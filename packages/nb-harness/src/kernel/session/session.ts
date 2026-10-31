/**
 * 宿主面：新建、打开、关闭会话，以及会话对外的 `SessionApi`（提案第 14 节）。
 *
 * 打开的顺序（session.md“状态与转换”）：取锁、修复与校验（存储）→ 按会话头解析 Profile 并装配 → 归约（要用扩展的
 * `reduce`，所以在装配之后）→ 比对 Profile 哈希，不同就写 `profileChanged{code-updated}` → 恢复 → 装上扩展。
 * 这些都完成之后才受理指令。Profile 解析不到或装配失败时会话以只读打开：能查询，不受理会改变对话的指令。
 *
 * 关闭的顺序：拒绝新指令 → 中止并等收口 → 等队列清空 → 摘下扩展 → 释放工具实现 → 关日志与锁。关闭之后迟到的回调不写日志。
 */

import {createHash, randomBytes} from "node:crypto";
import {Value} from "typebox/value";
import type {TSchema} from "typebox";
import type {AnyProfile, Frame, ModelInfo, Resources, ToolSessionContext, CreateSessionOptions, Issuer, JsonValue, LogEvent, SessionApi, SessionEnv, SessionHeader, SessionSnapshot, StorageResult} from "../api/index.js";
import {LOG_FORMAT} from "../api/index.js";
import {LogBrokenError, SessionCore, type EventDraft} from "../dispatch/core.js";
import {Mounts} from "../dispatch/mount.js";
import {writeAndReact, type ReactHost} from "../dispatch/reactions.js";
import type {ViewEnvironment} from "../extension/ctx.js";
import {assemble, type Assembly} from "../extension/assemble.js";
import {abortCommand, accept, archiveCommand, type Outcome, changeSettingsCommand, editCommand, enqueueCommand, removeCommand, sendCommand, setTitleCommand, startCommand, type CommandHost} from "../run/commands.js";
import {compact, compactionCuts, estimateContext, triggerPoint} from "../compaction/compact.js";
import {resolveCommand} from "../run/interaction.js";
import {previewRequest} from "./preview.js";
import {ProcessInterrupt} from "../run/writes.js";
import {rewindCommand, rewindTargets, siblingsOf, switchBranchCommand} from "../run/tree.js";
import {RunControl} from "../run/control.js";
import {recoveryDrafts} from "../run/recover.js";
import {runResultOf} from "../run/results.js";
import {ToolBox, toolInfo} from "../run/tools.js";

type CreateResult = StorageResult<SessionApi> | {ok: false; code: "profile-invalid" | "invalid-initial"; detail?: Record<string, JsonValue>};

interface Internals {
    readonly core: SessionCore;
    readonly control: RunControl;
    readonly react: ReactHost;
    readonly mounts: Mounts;
    readonly box: ToolBox;
    readonly environment: Omit<ViewEnvironment, "now">;
    /** 会话为什么只读；可写时为 null。运行中发现必需工具缺失时变成 `tools-missing`（直到重开）。 */
    readOnly: string | null;
    closed: boolean;
    /** 换了 Profile 之后重建交给宿主的资源与工具实现。 */
    refreshContext(): Promise<void>;
    /** 插件贡献的扩展变了、还没开始重新装配的部分（运行中时等这次运行结束）。 */
    pendingReassembly: Pending | null;
    /** 正在做的重新装配（含装上扩展）与它处理的变化。指令等它做完再受理，关闭等它做完再摘下（extensions.md 输出 19）。 */
    reassembling: {readonly promise: Promise<void>; readonly change: Pending} | null;
    /** 关闭进行中或已完成：重复与并发的 `closeSession` 等同一个。 */
    closing: Promise<void> | null;
}
type Pending = {readonly added: Set<string>; readonly removed: Set<string>};
const mergePending = (...parts: (Pending | null | undefined)[]): Pending => {
    const merged: Pending = {added: new Set(), removed: new Set()};
    for (const part of parts) {
        for (const id of part?.added ?? []) merged.added.add(id);
        for (const id of part?.removed ?? []) merged.removed.add(id);
    }
    return merged;
};
const internals = new WeakMap<SessionApi, Internals>();

/** 开发模式（冻结状态与事件、视图的开发检查）：测试与开发时开，生产环境关掉省遍历与比较。 */
const DEV = process.env.NODE_ENV !== "production";

function newSessionId(now: number): string {
    return `${now.toString(36)}-${randomBytes(5).toString("hex")}`;
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

/** 视图与反应用的模型信息：按当前的核心设置解析；解析不到时给一个占位（视图仍能算，发请求时才失败）。 */
const UNKNOWN_MODEL: ModelInfo = {id: "unknown/unknown", contextWindow: 0, capabilities: {vision: false, thinking: false}, efforts: []};

/** 一个会话的内部对象：运行控制、反应与装上的宿主。`as()` 得到的视图共用它。 */
function internalsFor(env: SessionEnv, core: SessionCore, readOnly: string | null): Internals {
    const control = new RunControl(core);
    // 交给宿主的上下文按当前装配取 Profile：换过 Profile（或重开时按最后一条 profileChanged 装配）后不是会话头里最初的。
    const context = (): ToolSessionContext => ({sessionId: core.header.id, profile: core.assembly.profile.id, ...(core.header.project === undefined ? {} : {project: core.header.project})});
    const box = new ToolBox(core, env, context);
    const tools = () => box.current().map(toolInfo);
    // 初始输入在 sessionCreated 里；新建会话时它在这个对象建好之后才写下，所以用到时再找（找到一次就记住）。
    let initialCache: {value: unknown} | null = null;
    const initialOf = (): unknown => {
        if (initialCache !== null) return initialCache.value;
        const created = core.events.find((event) => event.type === "sessionCreated");
        if (created === undefined) return null;
        initialCache = {value: (created.data as {initial?: unknown}).initial ?? null};
        return initialCache.value;
    };
    const modelInfo = (): ModelInfo => {
        const resolution = env.models.resolve(core.session.kernel.core, "turn");
        return resolution.ok ? resolution.info : UNKNOWN_MODEL;
    };
    const environment = {get tools() {
        return tools();
    }, get model() {
        return modelInfo();
    }, get initial() {
        return initialOf();
    }};
    // 资源按上下文建；换 Profile 时重建（`refreshContext`），各处拿着的都是这个转发对象。
    let currentResources = env.resources(context());
    const resources: Resources = {read: (uri) => currentResources.read(uri), resolve: (uri) => currentResources.resolve(uri)};
    const react: ReactHost = {environment: () => ({tools: tools(), model: modelInfo(), now: core.clock.now(), initial: initialOf()}), resources};
    const mounts = new Mounts(core, {...react, running: () => !control.idle});
    const state: Internals = {core, control, react, mounts, box, environment, readOnly, closed: false, pendingReassembly: null, reassembling: null, closing: null, refreshContext: async () => {
        currentResources = env.resources(context());
        // 工具实现是按上一个 Profile 的上下文建的：全部释放，下次调用按新上下文重建。
        await box.retire([]);
    }};
    control.attach({
        core,
        react,
        models: env.models,
        box,
        resources,
        approve: env.approve,
        compaction: {
            estimate: () => estimateContext(core),
            // Profile 写了 compaction: false 时不按阈值压缩，也就不必每个边界估算。
            trigger: (model) => ((core.assembly.profile as {compaction?: unknown}).compaction === false ? Number.POSITIVE_INFINITY : triggerPoint(model)),
            run: (args) => compact({
                core,
                resources,
                methods: env.compaction?.methods ?? {},
                ...(env.compaction?.restore === undefined ? {} : {restore: (restoreContext, signal) => env.compaction!.restore!(restoreContext, signal)}),
                context: context(),
                model: args.caller,
                write: args.write,
            }, args),
        },
        environment: (model, list) => ({tools: list, model, now: core.clock.now(), initial: initialOf()}),
        markReadOnly: (code) => {
            state.readOnly = code;
        },
    });
    return state;
}

function buildApi(env: SessionEnv, core: SessionCore, readOnly: string | null, issuer: Issuer, shared?: Internals): SessionApi {
    const state: Internals = shared ?? internalsFor(env, core, readOnly);
    const {control} = state;
    const host: CommandHost = {
        core,
        control,
        react: state.react,
        models: env.models,
        resources: state.react.resources,
        environment: () => state.react.environment(),
        readOnly: () => state.readOnly,
        closed: () => state.closed,
    };
    // 指令等进行中的重新装配做完（装上扩展之前不受理指令，extensions.md 输出 19）；关闭之后得 session-closed。
    const closedGuard = async <T>(run: () => Promise<T>): Promise<T> => {
        while (state.reassembling !== null && !state.closed) await state.reassembling.promise;
        return state.closed ? ({ok: false, code: "session-closed"} as T) : run();
    };
    // 出站过滤（runtime.md 输出 54）：推帧与日志查询之前按这个视图的发出者过滤；过滤可以是异步的，按日志顺序逐条等
    // （nb-story 的防剧透处理工具结果时要用前面那条调用记下的词）。过滤函数抛错或失败时不给看，写诊断。
    const outbound = env.outbound;
    const withheld = (subject: string, error: unknown) => core.diagnostics.add({code: "outbound-filter-threw", entry: "host", subject, message: `the outbound filter failed on ${subject}; it is withheld`, cause: error}, core.head);
    const visible = async (event: LogEvent): Promise<LogEvent | null> => {
        if (outbound === undefined) return event;
        try {
            return await outbound.event(event, issuer);
        } catch (error) {
            withheld(event.type, error);
            return null;
        }
    };
    const visibleAll = async (events: readonly LogEvent[]): Promise<LogEvent[]> => {
        if (outbound === undefined) return [...events];
        const out: LogEvent[] = [];
        for (const event of events) {
            const shown = await visible(event);
            if (shown !== null) out.push(shown);
        }
        return out;
    };
    const api: SessionApi = {
        id: core.header.id,
        issuer,
        as: (next) => buildApi(env, core, state.readOnly, next, state),
        send: (args) => closedGuard(() => sendCommand(host, args)),
        enqueue: (args) => closedGuard(() => enqueueCommand(host, args)),
        start: (args) => closedGuard(() => startCommand(host, args)),
        abort: (args) => closedGuard(() => abortCommand(host, args)),
        edit: (args) => closedGuard(() => editCommand(host, args)),
        remove: (args) => closedGuard(() => removeCommand(host, args)),
        resolve: (args) => closedGuard(() => resolveCommand({...host, interactions: control.interactions}, issuer, args)),
        rewind: (args) => closedGuard(() => rewindCommand(host, args)),
        switchBranch: (args) => closedGuard(() => switchBranchCommand(host, args)),
        fork: (args) => closedGuard(() => accept(host, "fork", args.commandId, async (): Promise<Outcome<"fork">> => {
            if (!control.idle) return {fail: "running", detail: {runId: control.active?.runId ?? ""}};
            const leaf = args.leaf === undefined ? core.leaf : args.leaf;
            if (leaf !== null && core.byId.get(leaf)?.scope !== "path") return {fail: "unknown-node"};
            const forked = await forkSession(env, core, leaf, args.commandId);
            if (!forked.ok) return {fail: "log-broken"};
            return {value: {sessionId: forked.id}, drafts: []};
        })),
        compact: (args) => closedGuard(() => accept(host, "compact", args.commandId, async (): Promise<Outcome<"compact">> => {
            if (state.readOnly !== null) return {fail: "read-only"};
            const asked = args.requirement === undefined || args.requirement.trim() === "" ? [] : [args.requirement];
            if (!env.models.resolve(core.session.kernel.core, "compaction").ok) return {fail: "no-compaction-model"};
            // 运行中（或叶子上有暂停的运行）：到这次运行的下一个边界做；空闲：开一次只压缩的运行（runtime.md 输出 52）。
            if (!control.idle || control.paused !== null) {
                control.requestCompaction(control.active?.runId ?? control.paused!, asked);
                return {value: {scheduled: "next-boundary"}, drafts: []};
            }
            if (compactionCuts(core).cuts.length === 0) return {fail: "nothing-to-compact"};
            const runId = core.newId();
            return {value: {scheduled: "now", runId}, drafts: [{type: "runStarted", kind: "ctrl", scope: "path", data: {runId, kind: "compact"}}], launch: runId, launchOptions: {compact: {require: asked}}};
        })),
        changeSettings: (args) => closedGuard(() => changeSettingsCommand(host, args)),
        changeProfile: (args) => closedGuard(() => accept(host, "changeProfile", args.commandId, async (): Promise<Outcome<"changeProfile">> => {
            if (!control.idle) return {fail: "running", detail: {runId: control.active?.runId ?? ""}};
            const profile = await env.profiles.resolve(args.profile);
            if (profile === undefined) return {fail: "unknown-profile"};
            const assembled = assemble(profile, env.extensions?.() ?? []);
            if (!assembled.ok) {
                const problem = assembled.problems[0]!;
                if (problem.code === "dependency-missing") return {fail: problem.code, detail: {extension: problem.extension, dependency: problem.dependency ?? ""}};
                return {fail: problem.code === "dependency-cycle" ? problem.code : "profile-invalid"};
            }
            const next = assembled.assembly;
            if (next.hash === core.assembly.hash) return {value: {changed: false, hash: next.hash, diagnostics: 0}, drafts: []};
            // 换装配（harness/profile.md 输出 11）：profileChanged 写下之后才摘下旧扩展、按新的归约函数重新归约（写失败时
            // 内存不领先日志）；装上新扩展在队列项之外，并等它写的外部事实落盘再返回，与打开会话一样。
            const from = core.assembly.hash;
            return {
                value: {changed: true, hash: next.hash, diagnostics: next.warnings.length},
                drafts: [{type: "profileChanged", kind: "ctrl", scope: "session", data: {profile: profile.id, hash: next.hash, from, reason: "user", manifest: next.manifest as unknown as JsonValue}}],
                written: async () => {
                    await state.mounts.unmountAll();
                    core.reassemble(next);
                    state.readOnly = null;
                    await state.refreshContext();
                    reportAssemblyWarnings(core);
                },
                after: async () => {
                    await state.mounts.mountAll(state.environment);
                    await core.queue.drain();
                },
            };
        })),
        setTitle: (args) => closedGuard(() => setTitleCommand(host, args)),
        archive: (args) => closedGuard(() => archiveCommand(host, args)),
        async snapshot(): Promise<SessionSnapshot> {
            const kernel = core.session.kernel;
            const errors = core.diagnostics.all().filter((item) => item.level === "error").length;
            return {
                sessionId: core.header.id,
                header: core.header,
                head: core.head,
                leaf: core.leaf,
                profile: {id: core.assembly.profile.id, hash: core.assembly.hash},
                extensions: core.assembly.order.filter((item) => item.role !== "profile").map((item) => ({id: item.definition.id, plugin: item.plugin, version: item.version, status: core.revoked.has(item.definition.id) ? "revoked" : core.failedExtensions.has(item.definition.id) ? "failed" : "active", tags: item.definition.tags ?? []})),
                status: control.status,
                buffer: [...kernel.buffer],
                settings: kernel.core,
                title: kernel.title,
                archived: kernel.archived,
                readOnly: state.readOnly === null ? null : {code: state.readOnly as "unknown-profile"},
                pendingReassembly: state.pendingReassembly === null && state.reassembling === null ? null : (() => {
                    const pending = mergePending(state.reassembling?.change, state.pendingReassembly);
                    return {added: [...pending.added], removed: [...pending.removed]};
                })(),
                diagnostics: {errors, warnings: core.diagnostics.all().length - errors},
            };
        },
        async log({afterSeq, limit = 500}) {
            // 分页的边界在读取时就定下：过滤是异步的，等待期间新写下的事件不算这一页，`head`、`more` 与 `through`
            // 都按这一刻的日志算。过滤掉的事件也算扫描过，下一页从 `through` 接着读（整页被过滤时 events 为空、through 照样前进）。
            const head = core.head;
            const total = core.events.length;
            const start = core.events.findIndex((event) => event.seq > afterSeq);
            const page = start < 0 ? [] : core.events.slice(start, Math.min(start + limit, total));
            const events: LogEvent[] = await visibleAll(page);
            return {events, head, more: start >= 0 && start + limit < total, through: page.at(-1)?.seq ?? Math.max(afterSeq, head)};
        },
        rewindTargets: async () => rewindTargets(core),
        async path(args) {
            return await visibleAll(core.pathTo(args?.leaf === undefined ? core.leaf : args.leaf));
        },
        siblings: async ({node}) => siblingsOf(core, node),
        async runResult({runId}) {
            return runResultOf(core.events, runId, core.byId);
        },
        preview: (args) => previewRequest({core, models: env.models, box: state.box, resources: state.react.resources, environment: (model, tools) => ({tools, model, now: core.clock.now(), initial: state.environment.initial})}, args),
        async diagnostics() {
            return core.diagnostics.all();
        },
        subscribe: (listener) => {
            if (outbound === undefined) return core.subscribe(listener);
            // 有出站过滤时帧排成一条队列：异步的过滤完一帧再交下一帧，订阅者看到的先后与日志一致。取消订阅或会话关闭之后，
            // 已排进队列的帧不再交出（过滤返回之后、交出之前再查一次）；订阅者抛错只写诊断，不让后面的帧停掉。
            let queue: Promise<void> = Promise.resolve();
            let active = true;
            const deliver = (frame: Frame) => {
                if (!active || state.closed) return;
                try {
                    listener(frame);
                } catch (error) {
                    core.diagnostics.add({code: "subscriber-threw", entry: "host", subject: frame.type, message: `a subscriber threw on a ${frame.type} frame`, cause: error}, core.head);
                }
            };
            const unsubscribe = core.subscribe((frame) => {
                queue = queue.then(async () => {
                    if (!active || state.closed) return;
                    if (frame.type === "log") {
                        const event = await visible(frame.event);
                        if (event !== null) deliver(event === frame.event ? frame : {...frame, event});
                        return;
                    }
                    if (frame.type === "delta" && outbound.delta !== undefined) {
                        let delta: typeof frame | null = null;
                        try {
                            delta = await outbound.delta(frame, issuer);
                        } catch (error) {
                            withheld("delta", error);
                        }
                        if (delta !== null) deliver(delta);
                        return;
                    }
                    deliver(frame);
                });
            });
            return () => {
                active = false;
                unsubscribe();
            };
        },
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
    const core = new SessionCore({header, store: env.store, handle: created.value, assembly: assembled.assembly, clock: env.clock, dev: DEV});
    const {assembly} = assembled;
    reportAssemblyWarnings(core);
    const api = buildApi(env, core, null, {kind: "user"});
    const state = internals.get(api)!;
    await core.queue.run(() => writeAndReact(core, [
        {type: "sessionCreated", kind: "ctrl", scope: "path", data: {initial}},
        {type: "profileChanged", kind: "ctrl", scope: "session", data: {profile: profile.id, hash: assembly.hash, from: null, reason: "created", manifest: assembly.manifest as unknown as JsonValue}},
    ], state.react));
    await state.mounts.mountAll(state.environment);
    await core.queue.drain();
    return {ok: true, value: api};
}

export async function openSession(env: SessionEnv, id: string): Promise<StorageResult<SessionApi>> {
    const opened = await env.store.open(id);
    if (!opened.ok) return opened;
    const handle = opened.value;
    // 会话现在用的 Profile：最后一条 profileChanged 的（`changeProfile` 换过时与会话头里最初的不同）。
    const lastChange = [...handle.events].reverse().find((event) => event.type === "profileChanged");
    const profileId = (lastChange?.data as {profile?: string} | undefined)?.profile ?? handle.header.profile;
    const {assembly, readOnly} = assembleOrPlaceholder(env, await env.profiles.resolve(profileId), profileId);
    const core = new SessionCore({header: handle.header, store: env.store, handle, assembly, clock: env.clock, dev: DEV});
    core.load(handle.events);
    core.reportOpenNotices();
    reportAssemblyWarnings(core);
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
        core.diagnostics.add({code: "unknown-profile", entry: "host", params: {profile: profileId, reason: readOnly}, message: `profile ${profileId} could not be assembled; the session is read-only`}, core.head);
    }
    const api = buildApi(env, core, readOnly, {kind: "user"});
    if (readOnly === null) {
        const state = internals.get(api)!;
        await state.mounts.mountAll(state.environment);
        await core.queue.drain();
    }
    return {ok: true, value: api};
}

/**
 * fork：把到 `leaf` 为止的路径复制成新会话（session.md 输出 20、runtime.md 输出 37）。事件保留 id 与父节点、重新编号；
 * 另带上最后一条 `profileChanged` 与全部 `settingsChanged`（新会话沿用 Profile 与设置），缓冲区与标题不带。会话头记来源。
 *
 * 新会话的 id 由来源会话与 `commandId` 定：原会话的受理批没写下就崩溃、或写失败，重发同一个 `commandId` 撞到已有的
 * 会话时直接交回它，不会多出第二个 fork（session.md 输出 17）。
 */
async function forkSession(env: SessionEnv, core: SessionCore, leaf: string | null, commandId: string): Promise<{ok: true; id: string} | {ok: false}> {
    const now = core.clock.now();
    const id = `fork-${createHash("sha256").update(`${core.header.id}\u0000${commandId}`).digest("hex").slice(0, 24)}`;
    const header: SessionHeader = {
        format: LOG_FORMAT,
        id,
        createdAt: now,
        profile: core.assembly.profile.id,
        ...(core.header.project === undefined ? {} : {project: core.header.project}),
        origin: {session: core.header.id, entry: leaf},
        // caller 与 questions 一起带上：复制过去的待处理提问仍归那个父会话应答（runtime.md 输出 41）。
        ...(core.header.caller === undefined ? {} : {caller: core.header.caller}),
        questions: core.header.questions,
        ...(core.header.result === undefined ? {} : {result: core.header.result}),
    };
    const created = await env.store.create(header);
    if (!created.ok) return created.code === "session-exists" ? {ok: true, id} : {ok: false};
    const lastProfile = [...core.events].reverse().find((event) => event.type === "profileChanged");
    const carried = [...(lastProfile === undefined ? [] : [lastProfile]), ...core.events.filter((event) => event.type === "settingsChanged")];
    let seq = 0;
    const events = [...core.pathTo(leaf), ...carried].map((event): LogEvent => ({...event, seq: (seq += 1)}));
    const appended = await env.store.append(created.value, events);
    await env.store.close(created.value);
    return appended.ok ? {ok: true, id} : {ok: false};
}

/**
 * 插件贡献的扩展变了（runtime.md 输出 57）：空闲的会话立刻按 `env.extensions()` 重新装配，运行中的会话把撤回的扩展
 * 标为不参与、等这次运行结束再装配。装配结果的哈希变了才写 `profileChanged{reason}`；装配失败（例如依赖被撤回）时
 * 会话进只读、码 `dependency-missing`。
 */
export function notifyExtensionsChanged(session: SessionApi, env: SessionEnv, change: {readonly added?: readonly string[]; readonly removed?: readonly string[]}): void {
    const state = internals.get(session);
    if (state === undefined || state.closed) return;
    const {core, control} = state;
    const pending = state.pendingReassembly ?? {added: new Set<string>(), removed: new Set<string>()};
    for (const id of change.added ?? []) pending.added.add(id);
    for (const id of change.removed ?? []) {
        pending.removed.add(id);
        if (!control.idle && core.assembly.order.some((item) => item.definition.id === id)) {
            core.revoked.add(id);
            // 撤回的扩展在 mount 里拿着的信号立刻触发：之后它的外部写入与回调都不再生效。
            state.mounts.revoke(id);
            core.diagnostics.add({code: "extension-revoked", extension: id, entry: "host", message: `${id} was revoked while a run is in progress; its handlers, interceptors and slots are skipped until the run ends`}, core.head);
        }
    }
    state.pendingReassembly = pending;
    if (control.idle) scheduleReassembly(state, env);
    else control.onIdle = () => {
        control.onIdle = null;
        scheduleReassembly(state, env);
    };
}

/** 重新装配一次只做一个：进行中时新的变化攒在 `pendingReassembly` 里，等这一次做完接着做。 */
function scheduleReassembly(state: Internals, env: SessionEnv): void {
    if (state.reassembling !== null || state.pendingReassembly === null || state.closed) return;
    const change = state.pendingReassembly;
    state.pendingReassembly = null;
    const promise = reassembleNow(state, env, change).finally(() => {
        state.reassembling = null;
        scheduleReassembly(state, env);
    });
    state.reassembling = {promise, change};
}

async function reassembleNow(state: Internals, env: SessionEnv, pending: Pending): Promise<void> {
    const {core} = state;
    const reason = pending.added.size > 0 && pending.removed.size > 0 ? "plugin-updated" : pending.added.size > 0 ? "plugin-added" : "plugin-removed";
    const profile = core.assembly.profile;
    const assembled = assemble(profile, env.extensions?.() ?? []);
    if (!assembled.ok) {
        const problem = assembled.problems[0]!;
        state.readOnly = "dependency-missing";
        core.revoked.clear();
        core.diagnostics.add({code: "dependency-missing", extension: problem.extension, entry: "assembly", params: {...(problem.dependency === undefined ? {} : {dependency: problem.dependency})}, message: `reassembling after a plugin change failed (${problem.message}); the session is read-only`, persisted: false}, core.head);
        return;
    }
    const next = assembled.assembly;
    // 装配成功：之前因依赖缺失进的只读解除（别的原因的只读，例如必需工具缺失，留到重开）。
    if (state.readOnly === "dependency-missing") state.readOnly = null;
    if (next.hash === core.assembly.hash) {
        core.revoked.clear();
        return;
    }
    const from = core.assembly.hash;
    try {
        await core.queue.run(async () => {
            await writeAndReact(core, [{type: "profileChanged", kind: "ctrl", scope: "session", data: {profile: profile.id, hash: next.hash, from, reason, manifest: next.manifest as unknown as JsonValue}}], state.react);
            await state.mounts.unmountAll();
            core.reassemble(next);
            await state.refreshContext();
            reportAssemblyWarnings(core);
        });
        await state.mounts.mountAll(state.environment);
        await core.queue.drain();
    } catch (error) {
        // 写日志失败：句柄已进损坏状态，内存里的装配没换（profileChanged 没写下）。
        if (!(error instanceof LogBrokenError)) throw error;
    }
}

function reportAssemblyWarnings(core: SessionCore): void {
    for (const warning of core.assembly.warnings) core.diagnostics.add({code: warning.code, extension: warning.extension, entry: "assembly", params: warning.params, subject: Object.values(warning.params).join("|"), message: warning.message, hint: warning.hint}, core.head);
}

/**
 * 关闭（runtime.md 输出 53）：拒绝新指令 → 中止在跑的运行并等收口 → 等队列清空 → 摘下扩展（等清理）→ 释放工具实现 →
 * 清空订阅 → 关日志与锁。重复调用无事。`reason: "interrupted"` 是进程收尾：在跑的运行按 `interrupted` 收口
 * （session.md 输出 16），否则按 `aborted`。
 */
export function closeSession(session: SessionApi, options: {readonly reason?: "interrupted"} = {}): Promise<void> {
    const state = internals.get(session);
    if (state === undefined) return Promise.resolve();
    state.closing ??= closeNow(state, options);
    return state.closing;
}

async function closeNow(state: Internals, options: {readonly reason?: "interrupted"}): Promise<void> {
    state.closed = true;
    // 进行中的重新装配先做完：它装上的扩展要在下面一起摘下，清理函数才不会漏调。
    if (state.reassembling !== null) await state.reassembling.promise;
    if (!state.core.broken) await state.control.shutdown(options.reason === "interrupted" ? new ProcessInterrupt() : undefined);
    await state.core.queue.drain();
    await state.mounts.unmountAll();
    await state.box.dispose();
    state.core.close();
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
