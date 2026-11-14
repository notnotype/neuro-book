/**
 * `nbook.agent` 服务端的装配：把贡献点的接收者、Profile 目录、工具集、模型端口、审批与资源接进内核的插件宿主，再交出
 * 句柄表与服务（docs/specs/agent/sessions.md、contributions.md）。入口（`plugin.ts`）只管依赖、激活与停止。
 */

import {mkdir} from "node:fs/promises";
import {join} from "node:path";

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import type {ContributionDeclarations} from "@notnotype/nb-runtime/plugins";

import {createAgentHost, createJsonlStore} from "@notnotype/nb-harness/kernel";
import type {AgentHost, Clock, CompactionRestoreArgs, CompactionRestored, ModelPort, RunResult, SessionIndexEntry, StorageResult} from "@notnotype/nb-harness/kernel/contracts";
import type {Dialects} from "@notnotype/nb-harness/kit/commands";
import {CompactionRestore} from "@notnotype/nb-harness/kit/compaction";
import {SessionMeta, SessionTable} from "@notnotype/nb-harness/kit/sessions";
import {kernelResources} from "@notnotype/nb-harness/kit/files";
import type {SessionEditStores} from "@notnotype/nb-harness/kit/tools";

import {serverHostModules} from "nbook/backend/plugin-host-modules";
import {SERVER_SHARED_MODULES} from "nbook/plugin-platform-profile";
import type {WorkspaceFiles} from "nbook/plugins/files/shared/contracts";
import type {ModelsService} from "nbook/plugins/models/shared/contracts";
import type {RunningWorkItem} from "nbook/shared/host";
import type {SettingsService} from "nbook/shared/settings";

import {SESSION_TITLE_PROFILE, TASK_ID, taskSessionId} from "../shared/contracts";
import type {AgentService, ProfileAdmin, StartTaskOptions, StartTaskResult} from "../shared/contracts";
import {ON_AGENT_SESSION} from "../shared/points";
import {agentSettings} from "../shared/settings";

import {BUILTIN_TOOL_IDS} from "./builtin/ids";
import {JobCenter} from "./jobs/center";
import {agentRunningWork, SessionTitles} from "./running-work";
import {ChildRuns} from "./subagents/children";
import {SessionRelations} from "./subagents/relations";
import {isModeSwitch, type PendingItem} from "./subagents/result";
import {SubagentTree} from "./subagents/tree";
import {TreeSpend} from "./subagents/tree-spend";
import {ProfileBundles} from "./profile-bundles";
import {filesFor, sessionArtifacts, sessionResources} from "./resources";
import {createAttachmentPort} from "./attachments";
import {ProfileCatalog} from "./profiles";
import {SESSION_META_MATERIAL} from "./session-meta";
import {CompactionMethods, DEFAULT_COMPACTION_ORDER} from "./compaction";
import {createPermissionHook} from "./permissions";
import {modesContract} from "./permissions/modes";
import {AgentTools} from "./tools";

export interface AgentRuntimeOptions {
    readonly stateRoot: string;
    readonly settings: SettingsService;
    readonly models: ModelsService | null;
    /** `nbook.agent` 自己的服务端文件服务门面：资源视图经它读写并注明代表哪个会话。 */
    readonly files: WorkspaceFiles;
    readonly clock: RuntimeClock;
    readonly declarations: ContributionDeclarations;
    /** 行锚的快照：内置工具与压缩后的放回共用。 */
    readonly editStores: SessionEditStores;
    readonly dialects: Dialects;
    /** 触发本插件前缀下的激活事件；有入口激活失败或受阻时交回 false。 */
    readonly trigger: (event: string) => Promise<boolean>;
    /** 接在文件与计划之后放回的内容（Skill，skills.md 输出 16）；交回合并后的放回。 */
    readonly restoreMore?: (args: CompactionRestoreArgs, previous: CompactionRestored) => Promise<CompactionRestored>;
    readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
}

export interface AgentRuntime {
    readonly host: AgentHost;
    readonly tools: AgentTools;
    readonly compaction: CompactionMethods;
    readonly profiles: ProfileCatalog;
    readonly userProfiles: ProfileBundles;
    readonly sessions: SessionTable;
    readonly meta: SessionMeta;
    readonly service: AgentService;
    readonly profileAdmin: ProfileAdmin;
    /** 会话之间的父子关系（subagents.md）。 */
    readonly relations: SessionRelations;
    /** 任务中心（jobs.md）。 */
    readonly jobs: JobCenter;
    /** 此刻在跑、停止服务端会中断的会话与任务（sessions.md 输出 20），给宿主的 `runningWorkKey` 登记用；同步。 */
    runningWork(): ReadonlyArray<RunningWorkItem>;
    /** 会话树的累计花费：费用守卫按树比（run-guards.md 输出 13）。 */
    readonly treeSpend: TreeSpend;
    /** 子代理运行与任务中心之间的跟踪（subagents.md 输出 6、7）。 */
    readonly children: ChildRuns;
    /** 子代理的进度（subagents.md 输出 21、22）。 */
    readonly tree: SubagentTree;
    /** 只读一个会话的索引（不打开会话）。 */
    sessionEntry(id: string): Promise<StorageResult<SessionIndexEntry>>;
    /** 模型端口：派子代理时先解析指名的模型（subagents.md 输出 1 的 `model-unavailable`）。 */
    readonly models: ModelPort;
    /** 插件开始停止之后为真：子代理工具据此不对子会话发中止，交给会话的关闭按 interrupted 收口（subagents.md 输出 16）。 */
    stopping(): boolean;
    /** 内核用的时钟（注入的，测试推进它）。 */
    readonly kernelClock: Clock;
    /** 会话目录的根：`sessions://` 的容器。 */
    readonly sessionsRoot: string;
    /** 存储层的会话列表，不加缺省的过滤（含归档与后台的），`sessions://` 与临时目录的清理用。 */
    listSessions(): Promise<readonly SessionIndexEntry[]>;
    stop(): Promise<void>;
}

/** 模型服务不在时的端口：会话照常打开、能读，发请求时失败（sessions.md 输出 13）。 */
const NO_MODELS: ModelPort = {resolve: () => ({ok: false, code: "no-model"})};

function kernelClock(clock: RuntimeClock): Clock {
    return {
        now: () => clock.now(),
        wait: (ms, signal) => new Promise<void>((resolve, reject) => {
            if (signal?.aborted === true) {
                reject(signal.reason);
                return;
            }
            const onAbort = () => {
                cancel();
                reject(signal?.reason);
            };
            const cancel = clock.schedule(() => {
                signal?.removeEventListener("abort", onAbort);
                resolve();
            }, ms);
            signal?.addEventListener("abort", onAbort, {once: true});
        }),
    };
}

export async function createAgentRuntime(options: AgentRuntimeOptions): Promise<AgentRuntime> {
    const sessionsRoot = join(options.stateRoot, "agent", "sessions");
    await mkdir(sessionsRoot, {recursive: true});
    const bindings = () => options.settings.get(agentSettings.settings.toolBindings);
    const profileSettings = () => options.settings.get(agentSettings.settings.profileSettings);

    const catalogListeners = new Set<() => void>();
    const catalogChanged = (): void => {
        for (const listener of catalogListeners) listener();
    };

    const sessionFilesFor = filesFor(options.files);
    // 宿主要先建好、再接收贡献；Profile 变了要通知它，它又要按 Profile 解析：用一个先占位的引用把这个环断开。
    let hostRef: AgentHost | null = null;
    const tools = new AgentTools({catalogChanged, declarations: options.declarations, clock: options.clock, activate: options.trigger, report: options.report, services: (context, toolId) => ({resources: sessionResources(options.files, context, toolId), artifacts: sessionArtifacts(options.files, context)})});
    const profiles = new ProfileCatalog({
        declarations: options.declarations,
        activate: options.trigger,
        changed: (keys) => void hostRef?.profilesChanged(keys),
        catalogChanged,
        toolIds: () => new Set(tools.all().keys()),
        report: options.report,
    });

    const compaction = new CompactionMethods({declarations: options.declarations, activate: options.trigger});
    const restore = new CompactionRestore({
        files: sessionFilesFor,
        editStores: options.editStores,
        tools: BUILTIN_TOOL_IDS,
        planOf: () => "session://plan.md",
        logOf: (context) => `sessions://${context.sessionId}/session.jsonl`,
        report: options.report,
    });

    const store = createJsonlStore({root: sessionsRoot});
    // 扫完才交出服务（深度与费用上限靠它）：之后的派发与 fork 增量登记。读不了的索引不在列表里，那些会话按没有父会话算。
    const relations = new SessionRelations();
    const treeSpend = new TreeSpend(relations);
    const titles = new SessionTitles();
    const scanned = await store.list();
    if (scanned.ok) {
        relations.load(scanned.value);
        treeSpend.load(scanned.value);
        titles.load(scanned.value);
    }
    else options.report("relations-scan-failed", `could not list sessions to load sub-agent relations: ${scanned.code}`, {code: scanned.code});
    let sessions: SessionTable | null = null;
    const clock = kernelClock(options.clock);
    const jobs = new JobCenter({
        clock,
        newId: () => crypto.randomUUID().replaceAll("-", ""),
        limits: () => ({perSession: options.settings.get(agentSettings.settings.subagentsPerSession), global: options.settings.get(agentSettings.settings.backgroundJobs)}),
    });
    let stopping = false;
    const models = options.models === null ? NO_MODELS : options.models.port((profile) => {
        const setting = profileSettings()[profile];
        const role = setting?.role ?? profiles.defaultRole(profile);
        return {...(setting?.model === undefined ? {} : {model: setting.model}), ...(role === undefined ? {} : {role})};
    });
    const host = createAgentHost({
        store,
        profiles: {resolve: (key) => profiles.resolve(key)},
        models,
        retry: () => ({maxRetries: options.settings.get(agentSettings.settings.modelRetries)}),
        tools: {
            declarations: (context) => tools.forProfile(profiles.requirements(context.profile), bindings()[context.profile]),
            create: (id, context) => tools.create(id, context),
        },
        resources: (context) => kernelResources(sessionFilesFor(context, null)),
        sessions: {get: async (id, issuer) => sessions!.view(id, issuer)},
        clock,
        approve: createPermissionHook({
            files: options.files,
            userRules: () => options.settings.get(agentSettings.settings.permissionRules),
            dialects: options.dialects,
            modeWriteAction: () => options.settings.get(agentSettings.settings.modeWriteAction),
            subjectsOf: (tool, args, activate) => tools.subjectsOf(tool, args, activate),
            modeOf: (read) => read(modesContract)?.mode ?? "normal",
            report: options.report,
        }),
        attachments: createAttachmentPort(options.files),
        compaction: {methods: compaction.table, order: DEFAULT_COMPACTION_ORDER, restore: async (context, args) => {
            const restored = await restore.run(context, args);
            return options.restoreMore === undefined ? restored : options.restoreMore(args, restored);
        }},
    });
    hostRef = host;

    const userProfiles = new ProfileBundles({
        stateRoot: options.stateRoot,
        sharedModules: SERVER_SHARED_MODULES,
        hostModules: serverHostModules,
        changed: (keys) => void host.profilesChanged(keys),
        catalogChanged,
        report: options.report,
    });
    profiles.attachUser(userProfiles);
    await userProfiles.start();

    // 同一时刻只触发一次，后到的等它（contributions.md 输出 2）。
    let activating: Promise<void> | null = null;
    const activateExtensions = (): Promise<void> => {
        activating ??= options.trigger(ON_AGENT_SESSION).then((ok) => {
            if (!ok) options.report("extension-activation-failed", "some extension providers failed to activate; sessions continue without them");
        }).finally(() => {
            activating = null;
        });
        return activating;
    };
    // fork 出来的会话：会话头照抄了 `caller`、另有 `origin`，从它的索引读出来登记。
    const registerFork = async (id: string): Promise<void> => {
        const entry = await store.entry(id);
        if (entry.ok) {
            relations.register(entry.value);
            titles.set(entry.value.id, entry.value.title);
        }
        else options.report("relations-fork-failed", `could not read the index of forked session ${id}: ${entry.code}`, {session: id, code: entry.code});
    };
    /** 程序自己开的会话（起标题与说明）：不是用户的工作，停止服务端时不必提示（sessions.md 输出 20）。 */
    const internal = new Set<string>();
    sessions = new SessionTable({host, clock: options.clock, beforeOpen: activateExtensions, closed: (id) => {
        restore.forget(id);
        internal.delete(id);
    }, forked: (id) => void registerFork(id), userOnly: (request) => isModeSwitch(request as PendingItem), report: options.report});
    const table = sessions;
    titles.follow(table);

    const createSession = async (createOptions: Parameters<AgentService["create"]>[0]): ReturnType<AgentService["create"]> => {
        const created = await table.create(createOptions);
        if (!created.ok) return created;
        if (createOptions.caller !== undefined) relations.register({id: created.value.id, caller: createOptions.caller});
        const view = table.view(created.value.id);
        // Profile 设置里的审批模式是新会话的初值（contributions.md 输出 13）。
        const approvalMode = profileSettings()[createOptions.profile]?.approvalMode;
        if (approvalMode !== undefined) {
            const changed = await view.changeSettings({commandId: `initial-approval-${created.value.id}`, patch: {core: {approvalMode}}});
            if (!changed.ok) options.report("initial-settings-failed", `could not apply the profile's approval mode to session ${created.value.id}`, {session: created.value.id, code: changed.code});
        }
        return {ok: true, value: view};
    };

    /**
     * 任务的幂等记录就是会话日志本身（sessions.md 输出 11）：会话 id 由 `taskId` 定，`send` 的 `commandId` 就是 `taskId`。
     * 重发时会话已在就核对参数、再发同一个 `send`（内核按 `commandId` 交回第一次的结果）；上次建了会话、没来得及 `send` 的，
     * 这次补上。
     */
    const startTask = async (task: StartTaskOptions): Promise<StartTaskResult & {readonly result?: Promise<RunResult>}> => {
        if (!new RegExp(TASK_ID, "u").test(task.taskId)) return {ok: false, code: "invalid-task-id"};
        const sessionId = taskSessionId(task.taskId);
        const created = await createSession({profile: task.profile, id: sessionId, ...(task.initial === undefined ? {} : {initial: task.initial}), ...(task.project === undefined ? {} : {project: task.project}), ...(task.background === true ? {background: true} : {})});
        if (!created.ok && created.code !== "session-exists") return created;
        const view = table.view(sessionId);
        if (!created.ok) {
            const {header} = await view.snapshot();
            if (header.profile !== task.profile || header.project !== task.project || (header.background === true) !== (task.background === true)) {
                return {ok: false, code: "task-conflict", detail: {reason: "the session for this task was started with other parameters"}};
            }
        }
        const sent = await view.send({commandId: task.taskId, input: task.input});
        if (!sent.ok) return sent.code === "command-id-conflict" ? {ok: false, code: "task-conflict", detail: {reason: "this task was started with another input"}} : {ok: false, code: sent.code, ...("detail" in sent && sent.detail !== undefined ? {detail: sent.detail} : {})};
        // 新会话一定空闲，`send` 同时开始运行；`runId` 为空说明会话里已有运行在跑，任务的输入排在它后面。
        if (sent.value.runId === null) return {ok: false, code: "already-running"};
        const runId = sent.value.runId;
        const result = view.waitRun(runId);
        // 远程调用方不等它：标记为已处理，免得没人接时成为未处理的拒绝；等它的调用方照样拿到拒绝。
        result.catch(() => undefined);
        return {ok: true, sessionId, runId, result};
    };

    // 每个入口先过停止门；建会话与发起任务整段登记成在途，停止等它们登记完（sessions.md 输出 14）。
    const service: AgentService = {
        create: (createOptions) => table.accept(() => createSession(createOptions)),
        startTask: (task) => table.accept(() => startTask(task)),
        session: (id, issuer) => {
            table.gate();
            return table.view(id, issuer);
        },
        list: (filter = {}) => {
            table.gate();
            return store.list({archived: false, background: false, ...filter});
        },
        profiles: () => {
            table.gate();
            return profiles.list();
        },
        running: () => {
            table.gate();
            return table.running();
        },
    };

    const meta = new SessionMeta({table, create: async (metaOptions) => {
        // 建成了才是程序自己的会话；id 被普通会话占着（session-exists）时不记，那是用户的会话，照常报。
        const created = await createSession(metaOptions);
        if (created.ok) internal.add(metaOptions.id);
        return created;
    }, models, titleProfile: SESSION_TITLE_PROFILE, material: SESSION_META_MATERIAL, report: options.report});
    const children = new ChildRuns({table, jobs, report: options.report});
    const tree = new SubagentTree({relations, table, jobs, entry: (id) => store.entry(id), catalog: () => profiles.list(), clock: options.clock});

    const profileAdmin: ProfileAdmin = {
        toolCatalog: () => {
            table.gate();
            return tools.catalog();
        },
        createUser: (name, texts) => {
            table.gate();
            return userProfiles.create(name, texts);
        },
        deleteUser: (key) => {
            table.gate();
            return userProfiles.delete(key);
        },
        onCatalogChanged: (listener) => {
            catalogListeners.add(listener);
            return () => catalogListeners.delete(listener);
        },
    };

    return {
        host,
        tools,
        compaction,
        profiles,
        userProfiles,
        sessions: table,
        meta,
        service,
        profileAdmin,
        relations,
        jobs,
        runningWork: () => agentRunningWork({table, relations, titles, jobs, internal}),
        children,
        tree,
        sessionEntry: (id) => store.entry(id),
        treeSpend,
        models,
        stopping: () => stopping,
        kernelClock: clock,
        sessionsRoot,
        listSessions: async () => {
            const listed = await store.list();
            if (!listed.ok) throw new Error(`读不了会话列表：${listed.code}`);
            return listed.value;
        },
        // 先停 Profile 的监听与打包（迟到的结果不再发布），再关会话（sessions.md 输出 14）。
        // 停止的先后（jobs.md 输出 8）：关门之后子代理工具就不再对子会话发中止，子代理运行由会话的关闭按 interrupted 收口；任务表最后丢。
        stop: async () => {
            stopping = true;
            table.closeGate();
            // 先关任务中心的门：之后已打开会话里的工具起不了新的后台命令（否则它在 `jobs.clear()` 之后没人收口）。
            jobs.close();
            // 后台命令按 interrupted 收口、写完 `status.json`；子代理运行不在这里停，由下面关会话收口。
            await Promise.allSettled(jobs.live().filter((job) => job.kind === "shell").map((job) => job.driver?.kill("interrupted")));
            await userProfiles.stop();
            await table.stop();
            await meta.settled();
            jobs.clear();
        },
    };
}

