/**
 * `nbook.agent` 的测试场地：在配置的场地（`settings/testing/world.ts`：真实服务端内核、真实设置文件、经 JSON 编解码的
 * 链路、手动时钟）上装 `nbook.models` 与 `nbook.agent` 的服务端入口，另装测试给的贡献方插件。用户层设置在起场地之前
 * 写好（例如本机端点的服务商）。测试拿到服务端的 `agentKey`。只由测试使用。
 */

import {mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition, RegisterPluginResult} from "@notnotype/nb-runtime/plugins";

import {definitionAt} from "nbook/manifest";
import {modelsBackendPlugin} from "nbook/plugins/models/backend/plugin";
import {descriptor as modelsDescriptor} from "nbook/plugins/models/plugin";
import {settingsWorld} from "nbook/plugins/settings/testing/world";
import type {SettingsWorld} from "nbook/plugins/settings/testing/world";
import {startupEnvKey} from "nbook/shared/host";

import {agentBackendPlugin} from "../backend/plugin";
import {descriptor} from "../plugin";
import {agentKey} from "../shared/contracts";
import type {AgentService} from "../shared/contracts";

export interface AgentWorld {
    readonly settings: SettingsWorld;
    readonly service: AgentService;
    readonly stateRoot: string;
    /** 运行中登记一个插件；交回的函数停掉它（关它的登记作用域，贡献随之撤回）。 */
    register(plugin: PluginDefinition): Promise<{readonly result: RegisterPluginResult; stop(): Promise<void>}>;
    close(): Promise<void>;
}

export async function agentWorld(root: string, options: {readonly plugins?: ReadonlyArray<PluginDefinition>; readonly userSettings?: Readonly<Record<string, unknown>>} = {}): Promise<AgentWorld> {
    const stateRoot = join(root, "state");
    await mkdir(stateRoot, {recursive: true});
    if (options.userSettings !== undefined) await writeFile(join(stateRoot, "settings.json"), JSON.stringify(options.userSettings));
    let service: AgentService | null = null;
    const probe: PluginDefinition = {id: "test.agent-probe", entries: [defineEntry({id: "server", location: "server", activationEvents: ["onStartup"], dependencies: [{key: agentKey}], activate: (context) => {
        service = context.services.require(agentKey);
        return {};
    }})]};
    const settings = await settingsWorld(root, [
        definitionAt("server", modelsDescriptor, modelsBackendPlugin),
        definitionAt("server", descriptor, agentBackendPlugin),
        ...(options.plugins ?? []),
        probe,
    ], {hubCapabilities: [{id: "host.startup-env", key: startupEnvKey, create: () => ({env: {}})}]});
    if (service === null) throw new Error("nbook.agent did not activate");
    return {
        settings,
        service,
        stateRoot,
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
