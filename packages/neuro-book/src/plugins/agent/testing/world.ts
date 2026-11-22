/**
 * `nbook.agent` 的测试场地：在配置的场地（`settings/testing/world.ts`：真实服务端内核、真实设置文件、经 JSON 编解码的
 * 链路、手动时钟）上装 `nbook.files`、`nbook.models` 与 `nbook.agent` 的服务端入口，另装测试给的贡献方插件。用户层设置在起场地之前
 * 写好（例如本机端点的服务商）。测试拿到服务端的 `agentKey`。只由测试使用。
 */

import {mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {RemoteLink} from "@notnotype/nb-runtime/remote";
import type {ActivationContext, PluginDefinition, RegisterPluginResult} from "@notnotype/nb-runtime/plugins";

import {definitionAt} from "nbook/manifest";
import {filesBackendPlugin} from "nbook/plugins/files/backend/plugin";
import {descriptor as filesDescriptor} from "nbook/plugins/files/plugin";
import {modelsBackendPlugin} from "nbook/plugins/models/backend/plugin";
import {descriptor as modelsDescriptor} from "nbook/plugins/models/plugin";
import {settingsWorld} from "nbook/plugins/settings/testing/world";
import type {HostCapability, SettingsWorld, WorldWindow} from "nbook/plugins/settings/testing/world";
import {createRunningWork} from "nbook/server/running-work";
import type {RunningWorkRegistry} from "nbook/server/running-work";
import {runningWorkKey, startupEnvKey} from "nbook/shared/host";

import {agentBackendPlugin} from "../backend/plugin";
import {descriptor} from "../plugin";
import {agentKey} from "../shared/contracts";
import type {AgentService} from "../shared/contracts";
import {agentSessionsContract} from "../shared/remote";
import {agentRequestsContract} from "../shared/requests";

const useSessions = (context: ActivationContext) => context.remote.use(agentSessionsContract);
export type SessionsClient = ReturnType<typeof useSessions>;
const useRequests = (context: ActivationContext) => context.remote.use(agentRequestsContract);
export type RequestsClient = ReturnType<typeof useRequests>;

export interface AgentWorld {
    readonly settings: SettingsWorld;
    readonly service: AgentService;
    readonly stateRoot: string;
    /** 服务端的在跑的工作登记表（宿主能力 `runningWorkKey`，与产品同一个实现）；报告方失败的诊断进服务端的诊断。 */
    readonly work: RunningWorkRegistry;
    /** 起一个窗口，交回它的远程客户端与窗口（断线、重连用）。 */
    /** `wrapLink`：包住窗口这一端的链路，测试据此在帧上做手脚（例如丢掉一次结果再断线）。 */
    /** `requests` 是同一个窗口的 `nbook.agent/requests` 客户端；`remote` 是窗口的远程入口，测试用它按旧版本的合同调用。 */
    window(id: string, options?: {readonly wrapLink?: (link: RemoteLink) => RemoteLink}): Promise<{readonly client: SessionsClient; readonly requests: RequestsClient; readonly remote: ActivationContext["remote"]; readonly window: WorldWindow}>;
    /** 运行中登记一个插件；交回的函数停掉它（关它的登记作用域，贡献随之撤回）。 */
    register(plugin: PluginDefinition): Promise<{readonly result: RegisterPluginResult; stop(): Promise<void>}>;
    close(): Promise<void>;
}

/**
 * `withoutModels`：不装 `nbook.models`（看模型服务不在时的行为）。`env`：启动环境（真实模型的密钥只进这里）。`capabilities`：另外的
 * 宿主能力（例如服务端宿主提供的插件包查询）。
 */
export async function agentWorld(root: string, options: {readonly plugins?: ReadonlyArray<PluginDefinition>; readonly userSettings?: Readonly<Record<string, unknown>>; readonly withoutModels?: boolean; readonly env?: Readonly<Record<string, string>>; readonly capabilities?: ReadonlyArray<HostCapability>} = {}): Promise<AgentWorld> {
    const stateRoot = join(root, "state");
    await mkdir(stateRoot, {recursive: true});
    // 模型列表的自动更新缺省关（用例没写这一项时）：开着时模型服务启动就会去拉本机端点的 `/models`，改变服务商的模型清单。
    await writeFile(join(stateRoot, "settings.json"), JSON.stringify({"nbook.models/catalogAutoUpdate": false, ...options.userSettings}));
    let service: AgentService | null = null;
    const probe: PluginDefinition = {id: "test.agent-probe", entries: [defineEntry({id: "server", location: "server", activationEvents: ["onStartup"], dependencies: [{key: agentKey}], activate: (context) => {
        // 测试世界代替用户操作会话（sessions.md 输出 21 的 asUser）：现有用例按用户的身份写。按插件身份的另有用例。
        const facade = context.services.require(agentKey);
        service = {
            ...facade,
            create: (options, view) => facade.create(options, {asUser: true, ...view}),
            session: (id, view) => facade.session(id, {asUser: true, ...view}),
            startTask: (task, view) => facade.startTask(task, {asUser: true, ...view}),
        };
        return {};
    }})]};
    const work = createRunningWork((record) => settings.diagnostics("hub").record(record));
    const settings = await settingsWorld(root, [
        definitionAt("server", filesDescriptor, filesBackendPlugin),
        ...(options.withoutModels === true ? [] : [definitionAt("server", modelsDescriptor, modelsBackendPlugin)]),
        definitionAt("server", descriptor, agentBackendPlugin),
        ...(options.plugins ?? []),
        probe,
    ], {hubCapabilities: [
        // 模型服务不取在线目录（docs/specs/models/service.md“模型来源”）：测试不出本机。
        {id: "host.startup-env", key: startupEnvKey, create: () => ({env: Object.freeze({NBOOK_MODELS_CATALOG_URL: "", ...options.env})})},
        {id: "host.running-work", key: runningWorkKey, create: () => work.provision},
        ...(options.capabilities ?? []),
    ]});
    if (service === null) throw new Error("nbook.agent did not activate");
    return {
        settings,
        service,
        stateRoot,
        work,
        window: async (id, windowOptions = {}) => {
            let captured: ActivationContext | null = null;
            const page: PluginDefinition = {id: `test.agent-page-${id}`, entries: [defineEntry({id: "browser", location: "browser", activationEvents: ["onStartup"], activate: (context) => {
                captured = context;
                return {};
            }})]};
            const window = await settings.window(id, [page], {bound: false, ...(windowOptions.wrapLink === undefined ? {} : {wrapLink: windowOptions.wrapLink})});
            if (captured === null) throw new Error("the test page did not activate");
            return {client: useSessions(captured), requests: useRequests(captured), remote: (captured as ActivationContext).remote, window};
        },
        register: async (plugin) => {
            const scope = settings.hub.root.createChild(`test:${plugin.id}`);
            const result = settings.hub.plugins.register(plugin, {scope});
            return {result, stop: async () => {
                await scope.close();
            }};
        },
        close: async () => {
            for (const result of await settings.close()) if (result.status !== "closed") throw new Error(`an instance did not close: ${JSON.stringify(result)}`);
        },
    };
}
