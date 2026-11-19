/**
 * `nbook.web-tools` 的服务端入口（docs/specs/web/tools.md）：贡献 `web_search`、`web_fetch` 两个工具，提供设置页用的远程合同。
 *
 * 激活时不读写密钥文件（输出 21）：内置插件的入口在应用启动时激活，这里失败会让整个应用起不来。DeepSeek 的地址每次请求时从
 * 设置读，改了设置文件不用重启。
 */

import {join} from "node:path";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";

import {TOOLS_POINT} from "nbook/plugins/agent/shared/contracts";
import {settingsKey} from "nbook/plugins/settings/shared/contracts";
import {stateRootKey} from "nbook/shared/host";

import {descriptor} from "../plugin";
import {FETCH_TOOL, SEARCH_TOOL, webSettingsContract} from "../shared/contracts";
import {webSettings} from "../shared/settings";
import {createKeyStore} from "./keys";
import {createDeepSeekProvider} from "./providers/deepseek";
import {realSleep} from "./providers/http";
import {webSettingsRemote} from "./settings-remote";
import {fetchImplementation, fetchTool, searchImplementation, searchTool} from "./tools";

export const webBackendPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "server",
        location: "server",
        dependencies: [{key: diagnosticsKey}, {key: settingsKey}, {key: stateRootKey}],
        activationEvents: [searchTool.activationEvent, fetchTool.activationEvent],
        contributions: [searchTool.contribution, fetchTool.contribution],
        remoteProvides: [webSettingsContract],
        activate: (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const settings = context.services.require(settingsKey);
            const record = (level: "info" | "warn", event: string, message: string, data: Readonly<Record<string, unknown>>): void => {
                diagnostics.record({level, event, message, data, source: {plugin: descriptor.id}});
            };
            const keys = createKeyStore(join(context.services.require(stateRootKey).path, "web", "keys.json"), record);
            const provider = createDeepSeekProvider(() => settings.get(webSettings.settings.deepseekBaseUrl), {fetch, now: Date.now, sleep: realSleep});
            const deps = () => ({keys, provider, now: Date.now, record: (event: string, message: string, data: Readonly<Record<string, unknown>>) => record("warn", event, message, data)});
            return {
                contributions: {[TOOLS_POINT]: {[SEARCH_TOOL]: searchImplementation(deps), [FETCH_TOOL]: fetchImplementation(deps)}},
                remote: [provideRemote(webSettingsContract, () => webSettingsRemote(keys, () => provider, Date.now))],
            };
        },
    })],
};
