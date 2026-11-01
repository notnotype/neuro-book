/**
 * `nbook.models` 的测试场地：在配置的场地（`settings/testing/world.ts`：真实服务端、真实设置文件、经 JSON 编解码的链路）
 * 上装服务端入口，另给启动环境；窗口经真实的远程合同调用。测试拿到服务端的 `modelsKey` 与每个窗口的远程客户端。
 * 只由测试使用。
 */

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {definitionAt} from "nbook/manifest";
import {settingsWorld} from "nbook/plugins/settings/testing/world";
import type {SettingsWorld} from "nbook/plugins/settings/testing/world";
import {startupEnvKey} from "nbook/shared/host";

import {modelsBackendPlugin} from "../backend/plugin";
import {descriptor} from "../plugin";
import {modelsKey, modelsSettingsContract} from "../shared/contracts";
import type {ModelsService} from "../shared/contracts";

const useModels = (context: ActivationContext) => context.remote.use(modelsSettingsContract);

export type ModelsClient = ReturnType<typeof useModels>;

export interface ModelsWorld {
    readonly settings: SettingsWorld;
    /** 服务端的 `modelsKey`。 */
    readonly service: ModelsService;
    /** 起一个窗口，交回它的远程客户端。 */
    window(id: string): Promise<ModelsClient>;
    close(): Promise<void>;
}

export async function modelsWorld(root: string, options: {readonly env?: Readonly<Record<string, string>>} = {}): Promise<ModelsWorld> {
    const env = Object.freeze({...options.env});
    let service: ModelsService | null = null;
    const probe: PluginDefinition = {id: "test.models-probe", entries: [defineEntry({id: "server", location: "server", activationEvents: ["onStartup"], dependencies: [{key: modelsKey}], activate: (context) => {
        service = context.services.require(modelsKey);
        return {};
    }})]};
    const settings = await settingsWorld(root, [definitionAt("server", descriptor, modelsBackendPlugin), probe], {hubCapabilities: [{id: "host.startup-env", key: startupEnvKey, create: () => ({env})}]});
    if (service === null) throw new Error("nbook.models did not activate");
    return {
        settings,
        service,
        window: async (id) => {
            let captured: ActivationContext | null = null;
            const page: PluginDefinition = {id: `test.models-page-${id}`, entries: [defineEntry({id: "browser", location: "browser", activationEvents: ["onStartup"], activate: (context) => {
                captured = context;
                return {};
            }})]};
            await settings.window(id, [page], {bound: false});
            if (captured === null) throw new Error("the test page did not activate");
            return useModels(captured);
        },
        close: async () => {
            for (const result of await settings.close()) if (result.status !== "closed") throw new Error(`an instance did not close: ${JSON.stringify(result)}`);
        },
    };
}
