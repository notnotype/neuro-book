/**
 * `nbook.agent` 服务端的装配：把贡献点的接收者、Profile 目录、工具集、模型端口、审批与资源接进内核的插件宿主，再交出
 * 句柄表与服务（docs/specs/agent/sessions.md、contributions.md）。入口（`plugin.ts`）只管依赖、激活与停止。
 */

import {mkdir, readFile} from "node:fs/promises";
import {join, normalize, relative} from "node:path";

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import type {ContributionDeclarations} from "@notnotype/nb-runtime/plugins";

import {createAgentHost, createJsonlStore} from "@notnotype/nb-harness/kernel";
import type {AgentHost, ApproveHook, Clock, ModelPort, Resources} from "@notnotype/nb-harness/kernel/contracts";

import {serverHostModules} from "nbook/backend/plugin-host-modules";
import {SERVER_SHARED_MODULES} from "nbook/plugin-platform-profile";
import type {ModelsService} from "nbook/plugins/models/shared/contracts";
import type {SettingsService} from "nbook/shared/settings";

import type {AgentService} from "../shared/contracts";
import {ON_AGENT_SESSION} from "../shared/points";
import {agentSettings} from "../shared/settings";

import {ProfileBundles} from "./profile-bundles";
import {ProfileCatalog} from "./profiles";
import {SessionTable} from "./sessions";
import {AgentTools} from "./tools";

export interface AgentRuntimeOptions {
    readonly stateRoot: string;
    readonly settings: SettingsService;
    readonly models: ModelsService | null;
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
    stop(): Promise<void>;
}

const SESSION_SCHEME = "session://";

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

/** `session://<路径>` 落在会话目录的 `home/` 里；越出 `home/` 的当作不存在（t08 的其余方案以后由资源能力给）。 */
function sessionResources(sessionsRoot: string, sessionId: string): Resources {
    const home = join(sessionsRoot, sessionId, "home");
    const inside = (uri: string): string | null => {
        if (!uri.startsWith(SESSION_SCHEME)) return null;
        const path = normalize(join(home, uri.slice(SESSION_SCHEME.length)));
        const rel = relative(home, path);
        return rel.startsWith("..") ? null : path;
    };
    return {
        resolve: (uri) => {
            const path = inside(uri);
            return path === null ? uri : `${SESSION_SCHEME}${relative(home, path).split("\\").join("/")}`;
        },
        read: async (uri) => {
            const path = inside(uri);
            if (path === null) return undefined;
            try {
                return await readFile(path, "utf8");
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
                throw error;
            }
        },
    };
}

export async function createAgentRuntime(options: AgentRuntimeOptions): Promise<AgentRuntime> {
    const sessionsRoot = join(options.stateRoot, "agent", "sessions");
    await mkdir(sessionsRoot, {recursive: true});
    const bindings = () => options.settings.get(agentSettings.settings.toolBindings);
    const profileSettings = () => options.settings.get(agentSettings.settings.profileSettings);

    // 宿主要先建好、再接收贡献；Profile 变了要通知它，它又要按 Profile 解析：用一个先占位的引用把这个环断开。
    let hostRef: AgentHost | null = null;
    const tools = new AgentTools({declarations: options.declarations, clock: options.clock, activate: options.trigger, report: options.report});
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
        tools: {
            declarations: (context) => tools.forProfile(profiles.requirements(context.profile), bindings()[context.profile]),
            create: (id, context) => tools.create(id, context),
        },
        resources: (context) => sessionResources(sessionsRoot, context.sessionId),
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

    const service: AgentService = {
        async create(createOptions) {
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
        },
        session: (id, issuer) => table.view(id, issuer),
        list: (filter = {}) => store.list({archived: false, background: false, ...filter}),
        profiles: () => profiles.list(),
        running: () => table.running(),
    };

    return {
        host,
        tools,
        profiles,
        userProfiles,
        sessions: table,
        service,
        // 先停 Profile 的监听与打包（迟到的结果不再发布），再关会话（sessions.md 输出 14）。
        stop: async () => {
            table.closeGate();
            await userProfiles.stop();
            await table.stop();
        },
    };
}

