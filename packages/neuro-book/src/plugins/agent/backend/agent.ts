/**
 * `nbook.agent` 服务端的装配：把贡献点的接收者、Profile 目录、工具集、模型端口、审批与资源接进内核的插件宿主，再交出
 * 句柄表与服务（docs/specs/agent/sessions.md、contributions.md）。入口（`plugin.ts`）只管依赖、激活与停止。
 */

import {mkdir} from "node:fs/promises";
import {join} from "node:path";

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import {ServiceRevokedError} from "@notnotype/nb-runtime/services";
import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";
import type {ContributionDeclarations} from "@notnotype/nb-runtime/plugins";

import {createAgentHost, createJsonlStore} from "@notnotype/nb-harness/kernel";
import type {AgentHost, Clock, CompactionRestoreArgs, CreateSessionOptions, Issuer, CompactionRestored, ModelPort, RunResult, SessionApi, SessionIndexEntry, StorageResult, ToolDeclaration, ToolSessionContext} from "@notnotype/nb-harness/kernel/contracts";
import type {Dialects} from "@notnotype/nb-harness/kit/commands";
import {CompactionRestore} from "@notnotype/nb-harness/kit/compaction";
import {RequestRecorder, RequestTraceUnavailable, traceModelPort} from "@notnotype/nb-harness/kit/requests";
import {SessionMeta, SessionTable} from "@notnotype/nb-harness/kit/sessions";
import {kernelResources} from "@notnotype/nb-harness/kit/files";
import type {SessionEditStores} from "@notnotype/nb-harness/kit/tools";

import {serverHostModules} from "nbook/backend/plugin-host-modules";
import {SERVER_SHARED_MODULES} from "nbook/plugin-platform-profile";
import type {WorkspaceFiles} from "nbook/plugins/files/shared/contracts";
import type {ModelsService} from "nbook/plugins/models/shared/contracts";
import type {TaskProvider} from "nbook/plugins/tasks/shared/contracts";
import type {RunningWorkItem} from "nbook/shared/host";
import type {SettingsService} from "nbook/shared/settings";

import {agentKey, SESSION_TITLE_PROFILE, TASK_ID, taskSessionId} from "../shared/contracts";
import type {AgentRuntimeService, AgentService, CreateResult, ProfileAdmin, SessionViewOptions, StartTaskOptions, StartTaskResult} from "../shared/contracts";
import {ON_AGENT_SESSION} from "../shared/points";
import {agentSettings} from "../shared/settings";

import {BUILTIN_TOOL_IDS} from "./builtin/ids";
import {JobCenter} from "./jobs/center";
import {agentRunningWork, SessionTitles} from "./running-work";
import {agentTaskRows} from "./task-rows";
import {RequestOwners} from "./requests";
import {ChildRuns} from "./subagents/children";
import {JobDelivery} from "./jobs/delivery";
import {JobLedger} from "./jobs/ledger";
import {toolJobs} from "./jobs/tool-jobs";
import {evalNotices, type EvalNotices} from "./eval/notices";
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
import {objectDoc, validEvalObjects, type EvalObject} from "./eval/objects";
import {EVAL_TOOL, evalDeclarationFor, KERNEL_NAMES, type CodeTool} from "./eval/tool";
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
    readonly service: AgentRuntimeService;
    readonly profileAdmin: ProfileAdmin;
    /** 会话之间的父子关系（subagents.md）。 */
    readonly relations: SessionRelations;
    /** 任务中心（jobs.md）。 */
    readonly jobs: JobCenter;
    /** eval 内核重置的提醒（eval.md）：eval 工具经它给会话发提醒、撤回。 */
    readonly evalNotices: EvalNotices;
    /** 此刻在跑、停止服务端会中断的会话与任务（sessions.md 输出 20），给宿主的 `runningWorkKey` 登记用；同步。 */
    runningWork(): ReadonlyArray<RunningWorkItem>;
    /** 交给后台任务清单的提供方（jobs.md 输出 20、sessions.md 输出 30）；每次调用新建一个，登记一次用一个。 */
    taskRows(): TaskProvider;
    /** 会话树的累计花费：费用守卫按树比（run-guards.md 输出 13）。 */
    readonly treeSpend: TreeSpend;
    /** 子代理运行与任务中心之间的跟踪（subagents.md 输出 6、7）。 */
    readonly children: ChildRuns;
    /** 子代理的进度（subagents.md 输出 21、22）。 */
    readonly tree: SubagentTree;
    /** 只读一个会话的索引（不打开会话）。 */
    sessionEntry(id: string): Promise<StorageResult<SessionIndexEntry>>;
    /** 模型端口：派子代理时先解析指名的模型（subagents.md 输出 1 的 `model-unavailable`）。经它发出的请求都进 `requests`。 */
    readonly models: ModelPort;
    /** 模型请求记录（request-trace.md）：远程服务 `nbook.agent/requests` 读它。 */
    readonly requests: RequestRecorder;
    /** 后台标题会话属于哪个会话（request-trace.md 输出 14）。 */
    readonly requestOwners: RequestOwners;
    /** 会话标题（索引里的，跟着打开着的会话更新）。 */
    readonly titles: Pick<SessionTitles, "of">;
    /** 插件开始停止之后为真：子代理工具据此不对子会话发中止，交给会话的关闭按 interrupted 收口（subagents.md 输出 16）。 */
    stopping(): boolean;
    /** 内核用的时钟（注入的，测试推进它）。 */
    readonly kernelClock: Clock;
    /** 会话目录的根：`sessions://` 的容器。 */
    readonly sessionsRoot: string;
    /** 这个会话此刻能经代码调的工具（eval 用，eval.md 输出 6）：与内核的生效工具集同一份来源，带交给服务商的名字与 `returns`。 */
    codeTools(context: ToolSessionContext): readonly CodeTool[];
    /** 有效的全局对象，按名字（contributions.md 输出 25）。 */
    readonly evalObjects: ReadonlyMap<string, EvalObject>;
    /** 每个全局对象的文档（`docs://eval/<名>.md` 的内容，resources.md 输出 16）。 */
    evalDocs(): ReadonlyMap<string, string>;
    /** 存储层的会话列表，不加缺省的过滤（含归档与后台的），`sessions://` 与临时目录的清理用。 */
    listSessions(): Promise<readonly SessionIndexEntry[]>;
    stop(): Promise<void>;
}

/** 模型服务不在时的端口：会话照常打开、能读，发请求时失败（sessions.md 输出 13）。 */
const NO_MODELS: ModelPort = {resolve: () => ({ok: false, code: "no-model"})};

const DAY_MS = 24 * 60 * 60 * 1000;

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
    // 会话、标题、子代理与审批、压缩的请求都经下面包过的端口，所以都进记录（request-trace.md 输出 1）。
    const requests = new RequestRecorder({
        root: join(options.stateRoot, "agent", "requests"),
        settings: () => ({
            enabled: options.settings.get(agentSettings.settings.requestTrace),
            payload: options.settings.get(agentSettings.settings.requestTracePayload),
            headers: options.settings.get(agentSettings.settings.requestTraceHeaders),
        }),
        report: options.report,
        now: () => options.clock.now(),
    });
    const requestOwners = new RequestOwners();
    requests.onChange((change) => {
        if (change.kind === "added") requestOwners.note(change.row.session);
    });
    let sweepTimer: (() => void) | null = null;
    const bindings = () => options.settings.get(agentSettings.settings.toolBindings);
    const profileSettings = () => options.settings.get(agentSettings.settings.profileSettings);

    const catalogListeners = new Set<() => void>();
    const catalogChanged = (): void => {
        for (const listener of catalogListeners) listener();
    };

    const sessionFilesFor = filesFor(options.files);
    // 宿主要先建好、再接收贡献；Profile 变了要通知它，它又要按 Profile 解析：用一个先占位的引用把这个环断开。
    let hostRef: AgentHost | null = null;
    // 全局对象（contributions.md 输出 25）：声明在进程生命期内不变，挑一次。
    const evalObjects = validEvalObjects(options.declarations, KERNEL_NAMES, options.report);
    const tools = new AgentTools({catalogChanged, evalObjectOf: (object) => evalObjects.get(object), declarations: options.declarations, clock: options.clock, activate: options.trigger, report: options.report, services: (context, toolId, scope) => ({resources: sessionResources(options.files, context, toolId), artifacts: sessionArtifacts(options.files, context), jobs: toolJobs(jobs, scope, {report: options.report})})});
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
    /** 有归属的根会话（sessions.md 输出 23、25）：后台任务清单不给它们的树出会话的行（jobs.md 输出 20），`rows()` 同步要用，记在内存里。 */
    const owned = new Set<string>();
    // 根按会话关系表的认法：调用方不是会话的就是根（例如 Workflow 起的会话）。
    const noteOwned = (entry: Pick<SessionIndexEntry, "id" | "owner" | "caller">): void => {
        if (entry.owner !== undefined && entry.caller?.kind !== "session") owned.add(entry.id);
    };
    const scanned = await store.list();
    if (scanned.ok) {
        relations.load(scanned.value);
        treeSpend.load(scanned.value);
        titles.load(scanned.value);
        for (const entry of scanned.value) noteOwned(entry);
    }
    else options.report("relations-scan-failed", `could not list sessions to load sub-agent relations: ${scanned.code}`, {code: scanned.code});
    let sessions: SessionTable | null = null;
    const clock = kernelClock(options.clock);
    // 送达在会话表建好之后才有；任务中心在那之前建，经这个引用接上（`wait` 接过回执、开始前移出已被取走的）。
    let delivery: JobDelivery | null = null;
    const jobs = new JobCenter({
        clock,
        newId: () => crypto.randomUUID().replaceAll("-", ""),
        limits: () => ({perSession: options.settings.get(agentSettings.settings.subagentsPerSession), global: options.settings.get(agentSettings.settings.backgroundJobs)}),
        takeover: (job, exit) => delivery?.takeover(job, exit) ?? Promise.resolve("maybe"),
        prune: async (owner) => {
            await delivery?.prune(owner);
        },
    });
    let stopping = false;
    const models = traceModelPort(options.models === null ? NO_MODELS : options.models.port((profile) => {
        const setting = profileSettings()[profile];
        const role = setting?.role ?? profiles.defaultRole(profile);
        return {...(setting?.model === undefined ? {} : {model: setting.model}), ...(role === undefined ? {} : {role})};
    }), requests);
    const host = createAgentHost({
        store,
        profiles: {resolve: (key) => profiles.resolve(key)},
        models,
        retry: () => ({maxRetries: options.settings.get(agentSettings.settings.modelRetries)}),
        tools: {
            declarations: (context) => sessionDeclarations(tools.forSession(profiles.requirements(context.profile), bindings()[context.profile], context), evalObjects),
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
            noteOwned(entry.value);
        }
        else options.report("relations-fork-failed", `could not read the index of forked session ${id}: ${entry.code}`, {session: id, code: entry.code});
    };
    /** 程序自己开的会话（起标题与说明）：不是用户的工作，停止服务端时不必提示（sessions.md 输出 20）。 */
    const internal = new Set<string>();
    sessions = new SessionTable({host, clock: options.clock, beforeOpen: activateExtensions, closed: (id) => {
        restore.forget(id);
        internal.delete(id);
        delivery?.sessionClosed(id);
    }, forked: (id) => void registerFork(id), userOnly: (request) => isModeSwitch(request as PendingItem), refuse: (header) => (header.owner === undefined ? null : "owned-session"), report: options.report});
    const table = sessions;
    titles.follow(table);

    const createSession = async (createOptions: CreateSessionOptions): Promise<CreateResult> => {
        const created = await table.create(createOptions);
        if (!created.ok) return created;
        if (createOptions.caller !== undefined) relations.register({id: created.value.id, caller: createOptions.caller});
        // 建好就记，在第一次运行之前：清单不会先给它出一行会话行。
        noteOwned({id: created.value.id, owner: createOptions.owner, caller: createOptions.caller});
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
    const startTask = async (task: StartTaskOptions, issuer?: Issuer): Promise<StartTaskResult & {readonly result?: Promise<RunResult>}> => {
        if (!new RegExp(TASK_ID, "u").test(task.taskId)) return {ok: false, code: "invalid-task-id"};
        const sessionId = taskSessionId(task.taskId);
        const created = await createSession({profile: task.profile, id: sessionId, ...(task.initial === undefined ? {} : {initial: task.initial}), ...(task.project === undefined ? {} : {project: task.project}), ...(task.background === true ? {background: true} : {})});
        if (!created.ok && created.code !== "session-exists") return created;
        const view = table.view(sessionId, issuer);
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
    const service: AgentRuntimeService = {
        create: async (createOptions, issuer) => {
            const created = await table.accept(() => createSession(createOptions));
            return created.ok && issuer !== undefined ? {ok: true, value: created.value.as(issuer)} : created;
        },
        startTask: (task, issuer) => table.accept(() => startTask(task, issuer)),
        session: (id, issuer) => {
            table.gate();
            return table.view(id, issuer);
        },
        hold: (id) => table.hold(id),
        header: (id) => table.header(id),
        list: async (filter = {}) => {
            table.gate();
            const all = await store.list();
            if (!all.ok) return all;
            const wanted = {archived: false, background: false, ...filter};
            const owned = ownedTrees(all.value);
            return {ok: true, value: all.value.filter((entry) => !owned.has(entry.id)
                && (wanted.project === undefined || entry.project === wanted.project)
                && (wanted.archived === undefined || entry.archived === wanted.archived)
                && (wanted.background === undefined || entry.background === wanted.background))};
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

    // 程序自己的会话由标题生成器认定（新建的，或核对过、复用的）；id 被普通会话占着的不认，那是用户的会话，照常报。
    const meta = new SessionMeta({table, create: (metaOptions) => createSession(metaOptions), adopted: (id) => internal.add(id), models, titleProfile: SESSION_TITLE_PROFILE, material: SESSION_META_MATERIAL, report: options.report, issuer: {kind: "host", source: {plugin: "nbook.agent", label: "标题生成"}}});
    const children = new ChildRuns({table, jobs, report: options.report});
    // 根会话：会话头没有调用方（读索引，不看会话关系表：启动时关系表可能还没载全）。
    const isRoot = async (id: string) => {
        const entry = await store.entry(id);
        return !entry.ok || entry.value.caller === undefined;
    };
    // 账本：先跟着任务中心写，再补发上次留下的回执（jobs.md 输出 17）。补发要开会话，不挡住启动。
    const ledger = new JobLedger({file: join(options.stateRoot, "agent", "jobs", "ledger.json"), jobs, report: options.report});
    delivery = new JobDelivery({jobs, table, clock, isRoot, newId: () => crypto.randomUUID(), report: options.report, persist: () => ledger.flush()});
    const kernelNotices = evalNotices(table, () => crypto.randomUUID(), options.report);
    delivery.start();
    ledger.follow();
    const replayed = ledger.replay(table).catch((error: unknown) => options.report("job-ledger-replay-failed", "replaying the job ledger threw", {message: error instanceof Error ? error.message : String(error)}));
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

    // 记录目录的读入与清理放在最后：前面的装配失败时不留下计时。不等目录读完再交出服务，读完之前的请求在记录器里排队等它
    // （`start` 先等打开）；读不了的目录记录器打开时自己报。
    const unreadable = (error: unknown): boolean => error instanceof RequestTraceUnavailable;
    void requests.open().then(async () => {
        for (const {id} of (await requests.list({limit: 1})).facets.sessions) requestOwners.note(id);
    }).catch((error: unknown) => {
        if (!unreadable(error)) options.report("requests.open-failed", `could not load model request records: ${error instanceof Error ? error.message : String(error)}`);
    });
    // 启动时清一次，之后每天一次（request-trace.md 输出 11）；天数在每次清理时读。
    const sweepRequests = (): void => {
        requests.sweep(options.settings.get(agentSettings.settings.requestTraceDays)).catch((error: unknown) => {
            if (!unreadable(error)) options.report("requests.sweep-failed", `could not clean up model request records: ${error instanceof Error ? error.message : String(error)}`);
        });
        sweepTimer = options.clock.schedule(sweepRequests, DAY_MS);
    };
    sweepRequests();

    return {
        host,
        tools,
        codeTools: (context) => tools.codeToolsOf(tools.forSession(profiles.requirements(context.profile), bindings()[context.profile], context)),
        evalObjects,
        evalDocs: () => {
            const methods = tools.evalMethods();
            return new Map([...evalObjects.values()].map((object) => [object.name, objectDoc(object, methods.filter((method) => method.object === object.name))]));
        },
        compaction,
        profiles,
        userProfiles,
        sessions: table,
        meta,
        service,
        profileAdmin,
        relations,
        jobs,
        evalNotices: kernelNotices,
        runningWork: () => agentRunningWork({table, relations, titles, jobs, internal}),
        taskRows: () => agentTaskRows({table, jobs, relations, titles, internal, owned, report: options.report}),
        children,
        tree,
        sessionEntry: (id) => store.entry(id),
        treeSpend,
        models,
        requests,
        requestOwners,
        titles,
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
            sweepTimer?.();
            sweepTimer = null;
            table.closeGate();
            // 先停送达（之后不再发回执，没送出的留在账本里、下次启动补发），再关任务中心的门：之后已打开会话里的工具起不了新的后台命令
            // （否则它在 `jobs.clear()` 之后没人收口）。
            delivery?.close();
            jobs.close();
            // 后台命令与插件登记的任务在这里按中断停下（后台命令写完 `status.json`）；子代理的运行由下面关会话收口。
            await Promise.allSettled(jobs.live().filter((job) => job.kind !== "agent").map((job) => job.driver?.kill("interrupted")));
            await userProfiles.stop();
            // 排着的 eval 提醒在会话关闭之前发完或撤完：之后才执行就只剩会话已关的诊断。
            await kernelNotices.settled();
            await table.stop();
            await meta.settled();
            // 会话都关了，不会再有模型请求：等记录写完。
            await requests.close();
            // 账本记下收口了、回执还没有出口的任务，再丢任务表（丢的时候账本已不再跟）。
            await replayed;
            await ledger.stop();
            jobs.clear();
        },
    };
}

/**
 * 有归属的会话与它们的后代（sessions.md 输出 25）：父链取自同一次读到的全部索引（`caller`），不看会话关系表，所以刚 fork 或刚派出、
 * 关系表还没登记的子会话也算得到。中间的祖先没有索引时，断开处以下的不算（已知限制）。
 */
function ownedTrees(entries: readonly SessionIndexEntry[]): Set<string> {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const known = new Map<string, boolean>();
    const owned = (id: string, seen: Set<string>): boolean => {
        const memo = known.get(id);
        if (memo !== undefined) return memo;
        const entry = byId.get(id);
        if (entry === undefined || seen.has(id)) return false;
        seen.add(id);
        const result = entry.owner !== undefined || (entry.caller?.kind === "session" && owned(entry.caller.id, seen));
        known.set(id, result);
        return result;
    };
    return new Set(entries.filter((entry) => owned(entry.id, new Set())).map((entry) => entry.id));
}

/** 一个会话的工具集交给内核之前：eval 的说明按这个会话里的全局对象算（eval.md 输出 16）。 */
function sessionDeclarations(declarations: ToolDeclaration[], objects: ReadonlyMap<string, EvalObject>): ToolDeclaration[] {
    const index = declarations.findIndex((declaration) => declaration.id === EVAL_TOOL);
    if (index < 0) return declarations;
    const present = new Set(declarations.flatMap((declaration) => (declaration.global === undefined ? [] : [declaration.global.object])));
    const listed = [...present].flatMap((name) => {
        const object = objects.get(name);
        return object === undefined ? [] : [object];
    });
    const next = [...declarations];
    next[index] = evalDeclarationFor(declarations[index]!, listed);
    return next;
}

/** 门面作废（调用方这次激活结束）时调：放掉它的持有、取消它建立的订阅，之后经它的视图调用抛错（sessions.md 输出 24）。 */
const revokers = new WeakMap<AgentService, () => void>();
export function revokeAgentFacade(facade: AgentService): void {
    revokers.get(facade)?.();
}

const USER: Issuer = Object.freeze({kind: "user"});

/**
 * 交给别的插件的门面（sessions.md 输出 21、23、24）：视图的发出者按调用方盖章，缺省是它的插件的宿主身份，`asUser` 时代替用户；
 * 盖章的发出者冻结，调用方改不动。宿主自己（没有插件身份的调用方）按实例 id 记。交出的视图的 `as` 同样经这里盖章：换成用户照准
 * （本来就能 `asUser`），换成宿主时 `plugin` 仍是调用方，换成会话身份抛错；建会话时不能指定会话的 `caller`（子代理关系只由
 * `nbook.agent` 自己建），`owner` 的 `plugin` 由这里填成调用方。
 *
 * 运行时的作废代理只挡门面本身；门面交出的视图、持有与订阅由这里登记，作废时（`revokeAgentFacade`）一起收掉。
 */
export function agentFacade(service: AgentRuntimeService, consumer: ConsumerIdentity): AgentService {
    const plugin = consumer.plugin ?? consumer.instanceId;
    let revoked = false;
    /** 还没放掉的持有与订阅：各自的收口函数，放掉或取消时从这里摘掉。 */
    const holds = new Set<() => void>();
    const subscriptions = new Set<() => void>();
    const check = (): void => {
        if (revoked) throw new ServiceRevokedError(agentKey.name, consumer, "released");
    };
    const hostIssuer = (source: SessionViewOptions["source"]): Issuer =>
        Object.freeze({kind: "host", source: Object.freeze({plugin, label: source?.label ?? plugin, ...(source?.ref === undefined ? {} : {ref: source.ref}), ...(source?.at === undefined ? {} : {at: source.at})})});
    const issuerOf = (view: SessionViewOptions | undefined): Issuer => (view?.asUser === true ? USER : hostIssuer(view?.source));
    const restamp = (next: Issuer): Issuer => {
        if (next.kind === "user") return USER;
        if (next.kind === "host") return hostIssuer(next.source);
        throw new TypeError(`plugin ${plugin} cannot act as session ${next.id} (sessions.md output 21)`);
    };
    const guarded = (view: SessionApi): SessionApi => {
        const wrapped: Record<string, unknown> = {};
        for (const [name, value] of Object.entries(view)) {
            wrapped[name] = typeof value !== "function" ? value : (...args: unknown[]): unknown => {
                check();
                return (value as (...args: unknown[]) => unknown)(...args);
            };
        }
        wrapped.as = (next: Issuer) => {
            check();
            return guarded(view.as(restamp(next)));
        };
        // 取消不过作废的门：作废时正是靠它收掉订阅，调用方作废之后再取消也不该抛错。
        wrapped.subscribe = (listener: Parameters<SessionApi["subscribe"]>[0]) => {
            check();
            const unsubscribe = view.subscribe(listener);
            const cancel = (): void => {
                if (subscriptions.delete(cancel)) unsubscribe();
            };
            subscriptions.add(cancel);
            return cancel;
        };
        return wrapped as unknown as SessionApi;
    };
    const facade: AgentService = {
        create: async (options, view) => {
            if (options.caller?.kind === "session") return {ok: false, code: "not-allowed", detail: "only nbook.agent creates sub-agent sessions"};
            const {owner, ...rest} = options;
            const created = await service.create({...rest, ...(owner === undefined ? {} : {owner: {plugin, id: owner.id}})}, issuerOf(view));
            return created.ok ? {ok: true, value: guarded(created.value)} : created;
        },
        session: (id, view) => guarded(service.session(id, issuerOf(view))),
        startTask: (task, view) => service.startTask(task, issuerOf(view)),
        hold: async (id) => {
            check();
            const held = await service.hold(id);
            if (!held.ok) return held;
            // 打开期间门面作废了：没有人会放掉它，立即放掉。
            if (revoked) {
                held.value.release();
                check();
            }
            const release = (): void => {
                if (holds.delete(release)) held.value.release();
            };
            holds.add(release);
            return {ok: true, value: {opened: held.value.opened, release}};
        },
        header: (id) => service.header(id),
        list: (filter) => service.list(filter),
        profiles: () => service.profiles(),
        running: () => service.running(),
    };
    revokers.set(facade, () => {
        revoked = true;
        for (const release of [...holds]) release();
        for (const cancel of [...subscriptions]) cancel();
    });
    return facade;
}
