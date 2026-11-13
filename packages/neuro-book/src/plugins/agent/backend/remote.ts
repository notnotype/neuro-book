/**
 * 远程合同 `nbook.agent/sessions` 的提供方（docs/specs/agent/sessions.md 输出 2、3、7–9）。经远程服务的调用一律以用户的身份进内核
 * （会话之间的身份只经同进程的 `agentKey`）。指令与查询都经句柄表的视图：视图每次调用时打开会话、执行期间持引用。
 */

import {randomUUID} from "node:crypto";
import {basename, join} from "node:path";

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import type {RemoteImplementation} from "@notnotype/nb-runtime/remote";

import {commandErrors, hostOnlyCommands} from "@notnotype/nb-harness/kernel/contracts";
import type {Diagnostic, SessionApi, SessionIndexEntry, StorageResult, ToolSessionContext} from "@notnotype/nb-harness/kernel/contracts";
import {PreviewUnavailable} from "@notnotype/nb-harness/kernel";
import {SessionUnavailable} from "@notnotype/nb-harness/kit/sessions";
import type {SessionTable} from "@notnotype/nb-harness/kit/sessions";
import {capLine, LINE_BYTES} from "@notnotype/nb-harness/kit/tools";

import {PushThrottle} from "nbook/shared/push-throttle";

import type {AgentService, ProfileAdmin} from "../shared/contracts";
import type {Rule} from "../shared/permissions";
import type {agentSessionsContract, ApprovalPreview, JobTail, RemoteCommandName} from "../shared/remote";
import type {AncestorItem, JobItem} from "../shared/subagents";

import {byteLength, chunkOf, FrameMerger, PAGE_BYTES, pageOf, pageOfItems, trimText} from "./frames";
import {jobDirectory, OUTPUT_FILE, readStatus} from "./builtin/shell-background";
import type {Job, JobCenter} from "./jobs/center";
import type {SkillCatalog} from "./skills/catalog";
import type {SkillInstaller} from "./skills/install";
import type {SessionRelations} from "./subagents/relations";
import {TREE_PUSH_MS, type SubagentTree} from "./subagents/tree";

type Contract = typeof agentSessionsContract;
type Methods = RemoteImplementation<Contract>["methods"];

/** 大预览的令牌活多久。 */
export const PREVIEW_TOKEN_MS = 5 * 60_000;

const HOST_ONLY: ReadonlySet<string> = new Set(hostOnlyCommands);
const COMMANDS = (Object.keys(commandErrors) as RemoteCommandName[]).filter((name) => !HOST_ONLY.has(name));

export interface AgentRemoteOptions {
    readonly service: AgentService;
    readonly profileAdmin: ProfileAdmin;
    readonly sessions: SessionTable;
    readonly clock: RuntimeClock;
    /** Skill 目录（skills.md 输出 1、5）。 */
    readonly skills: Pick<SkillCatalog, "list" | "onChanged">;
    readonly skillInstaller: Pick<SkillInstaller, "plan" | "init">;
    /** 审批预览（builtin-tools.md 输出 26）：按这个会话的资源权限试算。 */
    readonly previewApproval: (session: ToolSessionContext, tool: string, args: Readonly<Record<string, unknown>>, signal: AbortSignal) => Promise<ApprovalPreview>;
    readonly projectRules: (project: string, signal: AbortSignal) => Promise<Rule[] | "invalid">;
    /** 子代理与任务（subagents.md 输出 21、25，jobs.md 输出 9–11）。 */
    readonly subagents: {
        readonly relations: SessionRelations;
        readonly jobs: JobCenter;
        readonly tree: SubagentTree;
        readonly entry: (id: string) => Promise<StorageResult<SessionIndexEntry>>;
        /** 会话目录的根：后台命令的输出在 `<根>/<会话>/home/jobs/<任务>/`。 */
        readonly sessionsRoot: string;
        readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
    };
}

/** `jobTail` 缺省读几行。 */
const TAIL_LINES = 50;
/** 读输出文件末尾至多这么多字节再切行：200 行、每行至多 768 字节放得下。 */
const TAIL_BYTES = 200 * (LINE_BYTES + 1);

function jobItem(job: Job): JobItem {
    return {
        id: job.id,
        kind: job.kind,
        state: job.state as JobItem["state"],
        summary: job.summary,
        invocation: job.invocation,
        foreground: job.waiters > 0,
        startedAt: job.startedAt,
        ...(job.endedAt === undefined ? {} : {endedAt: job.endedAt}),
        ...(job.lastLine === undefined ? {} : {lastLine: job.lastLine}),
        ...(job.outcome?.exitCode === undefined ? {} : {exitCode: job.outcome.exitCode}),
        ...(job.outcome?.lines === undefined ? {} : {lines: job.outcome.lines}),
        ...(job.target === undefined ? {} : {sessionId: job.target.sessionId, runId: job.target.runId}),
    };
}

/** 会话 id 只当一段路径用：带分隔符或以点开头的不认。 */
const safeSegment = (value: string): boolean => value !== "" && basename(value) === value && !value.startsWith(".");

/** 输出文件的最后 `count` 行，每行截到一行的上限；没有文件时为 null。 */
async function tailOf(path: string, count: number): Promise<string[] | null> {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    if (count === 0) return [];
    const size = file.size;
    const text = await file.slice(Math.max(0, size - TAIL_BYTES)).text();
    const lines = text.split("\n");
    if (text.endsWith("\n")) lines.pop();
    // 从文件中间切开时第一行可能是半行，丢掉。
    if (size > TAIL_BYTES) lines.shift();
    return lines.slice(-count).map((line) => capLine(line));
}

/** 预览大到放不进一条消息时先存起来，经令牌分段读；所有调用方共用一张表。 */
export class PreviewTokens {
    readonly #texts = new Map<string, {readonly text: string; readonly cancel: () => void}>();

    constructor(private readonly clock: RuntimeClock) {}

    put(text: string): string {
        const token = randomUUID();
        const cancel = this.clock.schedule(() => this.#texts.delete(token), PREVIEW_TOKEN_MS);
        this.#texts.set(token, {text, cancel});
        return token;
    }

    get(token: string): string | undefined {
        return this.#texts.get(token)?.text;
    }

    clear(): void {
        for (const entry of this.#texts.values()) entry.cancel();
        this.#texts.clear();
    }
}

/**
 * 查询打开会话失败时视图抛 `SessionUnavailable`，这里换成合同里的失败码；别的错误照常抛出，通道报成 `provider-error`。
 */
async function query<T>(run: () => Promise<T>, fail: (code: string) => unknown): Promise<{ok: true; value: T} | unknown> {
    try {
        return {ok: true, value: await run()};
    } catch (error) {
        if (error instanceof SessionUnavailable) return fail(error.code);
        throw error;
    }
}

/** 诊断的长文字截短：一条诊断总放得进一页（sessions.md 输出 9）。 */
function trimDiagnostic(item: Diagnostic): Diagnostic {
    return {
        ...item,
        message: trimText(item.message),
        ...(item.hint === undefined ? {} : {hint: trimText(item.hint)}),
        ...(item.cause === undefined ? {} : {cause: {name: item.cause.name, message: trimText(item.cause.message), ...(item.cause.stack === undefined ? {} : {stack: trimText(item.cause.stack)})}}),
    };
}

/** 不分页的结果（快照、运行结果……）：编码后放不进一页就明确失败 `result-too-large`。 */
async function whole<T>(run: () => Promise<T>, context: {ok: (value: T) => unknown; fail: (code: "result-too-large" | "open-failed") => unknown}): Promise<unknown> {
    try {
        const value = await run();
        return byteLength(value) <= PAGE_BYTES ? context.ok(value) : context.fail("result-too-large");
    } catch (error) {
        if (error instanceof SessionUnavailable) return context.fail(error.code as "open-failed");
        throw error;
    }
}

/** 树的一页的字节上限：比通道的上限留出外壳的余量。 */
const TREE_PAGE_BYTES = PAGE_BYTES - 4096;

export function agentRemote(options: AgentRemoteOptions, previews: PreviewTokens): RemoteImplementation<Contract> {
    const {service} = options;
    const {relations, jobs, tree, entry, sessionsRoot, report} = options.subagents;
    const pushFailed = (event: string) => (error: unknown) => report("remote-push-failed", `computing ${event} failed`, {message: error instanceof Error ? error.message : String(error)});
    const view = (sessionId: string): SessionApi => service.session(sessionId, {kind: "user"});
    const activity = () => options.sessions.activity().map((item) => ({...item, root: relations.rootOf(item.id)}));
    const jobsOf = (sessionId: string): JobItem[] => jobs.list(sessionId).map(jobItem);

    const commandMethods = Object.fromEntries(COMMANDS.map((name) => [name, async ({sessionId, ...args}: {sessionId: string} & Record<string, unknown>, context: {ok: (value: unknown) => unknown; fail: (code: string, detail?: unknown) => unknown}) => {
        const result = await (view(sessionId)[name] as (args: unknown) => Promise<{ok: boolean; value?: unknown; seq?: number; replayed?: boolean; code?: string; detail?: unknown}>)(args);
        return result.ok ? context.ok({value: result.value, seq: result.seq, replayed: result.replayed}) : context.fail(result.code!, result.detail);
    }])) as unknown as Pick<Methods, RemoteCommandName>;

    const methods: Methods = {
        ...commandMethods,
        list: async (filter, context) => {
            const listed = await service.list(filter);
            return listed.ok
                ? context.ok(listed.value.map((session) => (session.caller?.kind === "session" ? {...session, parent: session.caller.id} : session)))
                : context.fail(listed.code, listed.detail as undefined);
        },
        ancestors: async ({sessionId}, context) => {
            const icons = new Map(service.profiles().map((profile) => [profile.key, profile.icon]));
            const items = await Promise.all(relations.ancestorsOf(sessionId).map(async (id): Promise<AncestorItem> => {
                const indexed = await entry(id);
                if (!indexed.ok) return {id, title: null, profile: null, archived: false};
                const icon = icons.get(indexed.value.profile);
                return {id, title: indexed.value.title, profile: indexed.value.profile, ...(icon === undefined ? {} : {icon}), archived: indexed.value.archived};
            }));
            return context.ok(items);
        },
        tree: async ({sessionId}, context) => {
            const items = await tree.tree(sessionId);
            return byteLength(items) <= PAGE_BYTES ? context.ok(items) : context.fail("result-too-large");
        },
        jobs: ({sessionId}, context) => context.ok(jobsOf(sessionId)),
        jobTail: async ({sessionId, jobId, lines = TAIL_LINES}, context) => {
            if (!safeSegment(sessionId)) return context.fail("job-unknown");
            const directory = jobDirectory(join(sessionsRoot, sessionId, "home"), jobId);
            const tail = await tailOf(join(directory, OUTPUT_FILE), lines);
            if (tail === null) return context.fail("job-unknown");
            const result: JobTail = {lines: tail, status: await readStatus(directory)};
            return context.ok(result);
        },
        jobStatuses: async ({sessionId, jobIds}, context) => {
            if (!safeSegment(sessionId)) return context.ok(jobIds.map(() => null));
            const home = join(sessionsRoot, sessionId, "home");
            return context.ok(await Promise.all(jobIds.map((jobId) => readStatus(jobDirectory(home, jobId)))));
        },
        killJob: async ({sessionId, jobId}, context) => {
            // 用户停这个会话启动的任何任务（前台、后台），别的会话的不认。
            if (jobs.get(jobId)?.owner !== sessionId) return context.fail("job-unknown");
            const outcome = await jobs.kill(null, jobId);
            return outcome === "job-unknown" ? context.fail("job-unknown") : context.ok({outcome});
        },
        create: async ({profile, initial, project}, context) => {
            const created = await service.create({profile, ...(initial === undefined ? {} : {initial: initial as never}), ...(project === undefined ? {} : {project})});
            return created.ok ? context.ok({sessionId: created.value.id}) : context.fail(created.code as "open-failed", created.detail as undefined);
        },
        snapshot: ({sessionId}, context) => whole(() => view(sessionId).snapshot(), context) as never,
        log: ({sessionId, afterSeq, limit}, context) => query(async () => {
            const page = await view(sessionId).log({afterSeq, ...(limit === undefined ? {} : {limit})});
            const {items, cut} = pageOfItems(page.events);
            // 按字节截断时 `through` 退到最后一条给出的事件，下一页从那里接着读。
            const through = cut ? items.at(-1)!.kind === "event" ? (items.at(-1) as {event: {seq: number}}).event.seq : (items.at(-1) as {seq: number}).seq : page.through;
            return {items, head: page.head, more: page.more || cut, through};
        }, (code) => context.fail(code as "open-failed")) as never,
        rewindTargets: ({sessionId}, context) => whole(() => view(sessionId).rewindTargets(), context) as never,
        path: ({sessionId, leaf, from = 0}, context) => query(async () => {
            const events = await view(sessionId).path(leaf === undefined ? undefined : {leaf});
            const {items, cut} = pageOfItems(events.slice(from));
            return {items, more: cut, next: from + items.length};
        }, (code) => context.fail(code as "open-failed")) as never,
        treeNodes: ({sessionId, afterSeq}, context) => whole(async () => {
            const page = await view(sessionId).treeNodes(afterSeq === undefined ? undefined : {afterSeq});
            // 内核按个数分页，通道按字节：中文标签 2,000 个节点就超了。多出来的放下一页，游标跟着往回收。
            let bytes = 0;
            let kept = 0;
            for (const node of page.nodes) {
                bytes += Buffer.byteLength(JSON.stringify(node)) + 1;
                if (bytes > TREE_PAGE_BYTES && kept > 0) break;
                kept += 1;
            }
            if (kept === page.nodes.length) return page;
            const nodes = page.nodes.slice(0, kept);
            return {nodes, more: true, through: nodes.at(-1)!.seq};
        }, context) as never,
        branchPoints: ({sessionId}, context) => whole(() => view(sessionId).branchPoints(), context) as never,
        siblings: ({sessionId, node}, context) => whole(() => view(sessionId).siblings({node}), context) as never,
        runResult: ({sessionId, runId}, context) => whole(() => view(sessionId).runResult({runId}), context) as never,
        preview: async ({sessionId, leaf}, context) => {
            try {
                const preview = await view(sessionId).preview(leaf === undefined ? undefined : {leaf});
                const text = JSON.stringify(preview);
                const bytes = Buffer.byteLength(text);
                // 工具声明里按参数算的 `effect` 是函数，通道编不了：直接交对象的话带这种工具的会话一律失败。分段读拿到的本来就是这份文字。
                return context.ok(bytes <= PAGE_BYTES ? {kind: "inline", preview: JSON.parse(text) as typeof preview} : {kind: "oversized", token: previews.put(text), bytes});
            } catch (error) {
                if (error instanceof SessionUnavailable) return context.fail(error.code as "open-failed");
                if (error instanceof PreviewUnavailable) return context.fail("preview-unavailable", {message: error.message});
                throw error;
            }
        },
        approvalPreview: async ({sessionId, interactionId}, context) => {
            try {
                const session = view(sessionId);
                const requested = (await session.path()).find((event) => event.type === "interactionRequested" && (event.data as {id: string}).id === interactionId)?.data as {kind: string; request: {tool: string; args: Readonly<Record<string, unknown>>}} | undefined;
                if (requested?.kind !== "approval") return context.fail("unknown-interaction");
                const snapshot = await session.snapshot();
                const preview = await options.previewApproval({sessionId, profile: snapshot.profile.id, ...(snapshot.header.project === undefined ? {} : {project: snapshot.header.project})}, requested.request.tool, requested.request.args, context.signal);
                const text = JSON.stringify(preview);
                const bytes = Buffer.byteLength(text);
                return context.ok(bytes <= PAGE_BYTES ? {kind: "inline", preview} : {kind: "oversized", token: previews.put(text), bytes});
            } catch (error) {
                if (error instanceof SessionUnavailable) return context.fail(error.code as "open-failed");
                throw error;
            }
        },
        diagnostics: ({sessionId, after, ...filter}, context) => query(async () => {
            const all = (await view(sessionId).diagnostics(filter)).map(trimDiagnostic);
            const start = after === undefined ? 0 : all.findIndex((item) => item.id === after) + 1;
            const {items, cut} = pageOf(all.slice(start));
            return {items, more: cut, next: cut ? items.at(-1)!.id : null};
        }, (code) => context.fail(code as "open-failed")) as never,
        eventChunk: async ({sessionId, seq, index}, context) => {
            try {
                const page = await view(sessionId).log({afterSeq: seq - 1, limit: 1});
                const event = page.events[0];
                if (event === undefined || event.seq !== seq) return context.fail("unknown-event");
                const chunk = chunkOf(JSON.stringify(event), index);
                return chunk === null ? context.fail("out-of-range") : context.ok(chunk);
            } catch (error) {
                if (error instanceof SessionUnavailable) return context.fail(error.code as "open-failed");
                throw error;
            }
        },
        previewChunk: ({token, index}, context) => {
            const text = previews.get(token);
            if (text === undefined) return context.fail("unknown-token");
            const chunk = chunkOf(text, index);
            return chunk === null ? context.fail("out-of-range") : context.ok(chunk);
        },
        profiles: (_input, context) => context.ok(service.profiles()),
        toolCatalog: (_input, context) => context.ok(options.profileAdmin.toolCatalog()),
        skills: (_input, context) => context.ok(options.skills.list()),
        skillInitPlan: async ({id}, context) => {
            const planned = await options.skillInstaller.plan(id);
            return planned.ok ? context.ok(planned.plan) : context.fail(planned.code);
        },
        initSkill: async ({id, resolve}, context) => {
            const done = await options.skillInstaller.init(id, {resolve: resolve === true});
            if (done.ok) return context.ok({});
            return done.code === "install-failed" ? context.fail("install-failed", {output: done.detail ?? ""}) : context.fail(done.code);
        },
        createUserProfile: async ({name, description, system}, context) => {
            const created = await options.profileAdmin.createUser(name, {description, system});
            return created.ok ? context.ok({key: created.key, address: created.address}) : context.fail(created.code);
        },
        deleteUserProfile: async ({key}, context) => {
            const deleted = await options.profileAdmin.deleteUser(key);
            return deleted.ok ? context.ok({}) : context.fail(deleted.code);
        },
        projectPermissionRules: async ({project}, context) => context.ok(await options.projectRules(project, context.signal)),
        activity: (_input, context) => context.ok(activity()),
        startTask: async ({initial, ...task}, context) => {
            const started = await service.startTask({...task, ...(initial === undefined ? {} : {initial: initial as never})});
            // 码是联合时 `fail` 的类型只收 undefined 的详情；运行时照传，合同里每个码的详情 schema 都收对象。
            return started.ok ? context.ok({sessionId: started.sessionId, runId: started.runId}) : context.fail(started.code as "task-conflict", started.detail as undefined);
        },
    };

    return {
        methods,
        events: {
            profileCatalogChanged: {
                subscribe(_filter, sink, context) {
                    if (context.signal.aborted) return;
                    const stop = options.profileAdmin.onCatalogChanged(() => sink.next({}));
                    context.signal.addEventListener("abort", stop, {once: true});
                },
            },
            skillsChanged: {
                subscribe(_filter, sink, context) {
                    if (context.signal.aborted) return;
                    const stop = options.skills.onChanged(() => sink.next({}));
                    context.signal.addEventListener("abort", stop, {once: true});
                },
            },
            activityChanged: {
                subscribe(_filter, sink, context) {
                    if (context.signal.aborted) return;
                    // 关系变了根也可能变（新派的子会话一开始跑就进活动）：活动推送本身就带着最新的根。
                    const stop = options.sessions.onActivityChanged(() => sink.next(activity()));
                    context.signal.addEventListener("abort", stop, {once: true});
                },
            },
            treeChanged: {
                subscribe({sessionId}, sink, context) {
                    if (context.signal.aborted) return;
                    // 与查询 `tree` 同一个上限：放不进一条消息时不推（写诊断），宿主照旧显示上一份；请求里的长文字已在算的时候截短。
                    const stop = tree.watch(sessionId, (items) => {
                        if (byteLength(items) <= PAGE_BYTES) sink.next(items);
                        else report("tree-too-large", `the sub-agent tree of session ${sessionId} does not fit in one message; the push was skipped`, {session: sessionId});
                    }, pushFailed("treeChanged"));
                    context.signal.addEventListener("abort", stop, {once: true});
                },
            },
            jobsChanged: {
                subscribe({sessionId}, sink, context) {
                    if (context.signal.aborted) return;
                    const throttle = new PushThrottle({clock: options.clock, intervalMs: TREE_PUSH_MS, compute: () => jobsOf(sessionId), push: (items) => sink.next(items), failed: pushFailed("jobsChanged")});
                    const stop = jobs.onChanged((owner) => {
                        if (owner === sessionId) throttle.trigger();
                    });
                    context.signal.addEventListener("abort", () => {
                        throttle.close();
                        stop();
                    }, {once: true});
                },
            },
            frames: {
                async subscribe({sessionId}, sink, context) {
                    if (context.signal.aborted) return;
                    // 每个远程订阅持有自己的内核订阅与合并缓冲；订阅结束（`signal`）时一起取消。等会话真的打开再算订阅成功：
                    // 打不开时抛错，通道以 provider-error 结束这个订阅，调用方的 onEnd 看得到。
                    const merger = new FrameMerger(options.clock, (frame) => sink.next(frame));
                    const opened = await options.sessions.subscribeOpened(sessionId, {kind: "user"}, (frame) => merger.push(frame));
                    if (!opened.ok) {
                        merger.close();
                        throw new Error(`session ${sessionId} could not be opened: ${opened.code}`);
                    }
                    if (context.signal.aborted) {
                        merger.close();
                        opened.release();
                        return;
                    }
                    context.signal.addEventListener("abort", () => {
                        merger.close();
                        opened.release();
                    }, {once: true});
                },
            },
        },
    };
}
