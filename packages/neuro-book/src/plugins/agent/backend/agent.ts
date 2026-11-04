/**
 * `nbook.agent` 服务端的装配：把贡献点的接收者、Profile 目录、工具集、模型端口、审批与资源接进内核的插件宿主，再交出
 * 句柄表与服务（docs/specs/agent/sessions.md、contributions.md）。入口（`plugin.ts`）只管依赖、激活与停止。
 */

import {mkdir} from "node:fs/promises";
import {join} from "node:path";

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import type {ContributionDeclarations} from "@notnotype/nb-runtime/plugins";

import {createAgentHost, createJsonlStore} from "@notnotype/nb-harness/kernel";
import type {AgentHost, ApproveHook, Clock, ModelPort, RunResult, SessionIndexEntry} from "@notnotype/nb-harness/kernel/contracts";

import {serverHostModules} from "nbook/backend/plugin-host-modules";
import {SERVER_SHARED_MODULES} from "nbook/plugin-platform-profile";
import type {WorkspaceFiles} from "nbook/plugins/files/shared/contracts";
import type {ModelsService} from "nbook/plugins/models/shared/contracts";
import type {SettingsService} from "nbook/shared/settings";

import {TASK_ID, taskSessionId} from "../shared/contracts";
import type {AgentService, StartTaskOptions, StartTaskResult} from "../shared/contracts";
import {ON_AGENT_SESSION} from "../shared/points";
import {agentSettings} from "../shared/settings";

import {ProfileBundles} from "./profile-bundles";
import {kernelResources, sessionArtifacts, sessionResources} from "./resources";
import {ProfileCatalog} from "./profiles";
import {SessionTable} from "./sessions";
import {AgentTools} from "./tools";

export interface AgentRuntimeOptions {
    readonly stateRoot: string;
    readonly settings: SettingsService;
    readonly models: ModelsService | null;
    /** `nbook.agent` 自己的服务端文件服务门面：资源视图经它读写并注明代表哪个会话。 */
    readonly files: WorkspaceFiles;
    readonly clock: RuntimeClock;
    readonly declarations: ContributionDeclarations;
    /** 触发本插件前缀下的激活事件；有入口激活失败或受阻时交回 false。 */
    readonly trigger: (event: string) => Promise<boolean>;
    readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
}

export interface AgentRuntime {
    readonly host: AgentHost;
    readonly tools: AgentTools;
    readonly profiles: ProfileCatalog;
    readonly userProfiles: ProfileBundles;
    readonly sessions: SessionTable;
    readonly service: AgentService;
    /** 会话目录的根：`sessions://` 的容器。 */
    readonly sessionsRoot: string;
    /** 存储层的会话列表，不加缺省的过滤（含归档与后台的），`sessions://` 与临时目录的清理用。 */
    listSessions(): Promise<readonly SessionIndexEntry[]>;
    stop(): Promise<void>;
}

/**
 * 审批的最小规则（sessions.md 输出 4，t06 规则表之前）：只读的放行；会话处在只读模式时其余都问（只读模式优先于审批
 * 模式，t06）；`yolo` 全放行；`allow-writes` 放行写入；其余都问。
 */
export const approveByMode: ApproveHook = async (_call, info) => {
    if (info.effect === "read") return {verdict: "allow", by: "mode:read"};
    if (info.readOnly) return {verdict: "ask", reason: "read-only mode"};
    if (info.mode === "yolo") return {verdict: "allow", by: "mode:yolo"};
    if (info.mode === "allow-writes" && info.effect === "write") return {verdict: "allow", by: "mode:allow-writes"};
    return {verdict: "ask"};
};

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

    // 宿主要先建好、再接收贡献；Profile 变了要通知它，它又要按 Profile 解析：用一个先占位的引用把这个环断开。
    let hostRef: AgentHost | null = null;
    const tools = new AgentTools({declarations: options.declarations, clock: options.clock, activate: options.trigger, report: options.report, services: (context, toolId) => ({resources: sessionResources(options.files, context, toolId), artifacts: sessionArtifacts(options.files, context)})});
    const profiles = new ProfileCatalog({
        declarations: options.declarations,
        activate: options.trigger,
        changed: (keys) => void hostRef?.profilesChanged(keys),
        toolIds: () => new Set(tools.all().keys()),
        report: options.report,
    });

    const store = createJsonlStore({root: sessionsRoot});
    let sessions: SessionTable | null = null;
    const host = createAgentHost({
        store,
        profiles: {resolve: (key) => profiles.resolve(key)},
        models: options.models === null ? NO_MODELS : options.models.port((profile) => {
            const setting = profileSettings()[profile];
            return {...(setting?.model === undefined ? {} : {model: setting.model}), ...(setting?.role === undefined ? {} : {role: setting.role})};
        }),
        retry: () => ({maxRetries: options.settings.get(agentSettings.settings.modelRetries)}),
        tools: {
            declarations: (context) => tools.forProfile(profiles.requirements(context.profile), bindings()[context.profile]),
            create: (id, context) => tools.create(id, context),
        },
        resources: (context) => kernelResources(sessionResources(options.files, context, null)),
        sessions: {get: async (id, issuer) => sessions!.view(id, issuer)},
        clock: kernelClock(options.clock),
        approve: approveByMode,
    });
    hostRef = host;

    const userProfiles = new ProfileBundles({
        stateRoot: options.stateRoot,
        sharedModules: SERVER_SHARED_MODULES,
        hostModules: serverHostModules,
        changed: (keys) => void host.profilesChanged(keys),
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
    sessions = new SessionTable({host, clock: options.clock, beforeOpen: activateExtensions, report: options.report});
    const table = sessions;

    const createSession = async (createOptions: Parameters<AgentService["create"]>[0]): ReturnType<AgentService["create"]> => {
        const created = await table.create(createOptions);
        if (!created.ok) return created;
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

    return {
        host,
        tools,
        profiles,
        userProfiles,
        sessions: table,
        service,
        sessionsRoot,
        listSessions: async () => {
            const listed = await store.list();
            if (!listed.ok) throw new Error(`读不了会话列表：${listed.code}`);
            return listed.value;
        },
        // 先停 Profile 的监听与打包（迟到的结果不再发布），再关会话（sessions.md 输出 14）。
        stop: async () => {
            table.closeGate();
            await userProfiles.stop();
            await table.stop();
        },
    };
}

