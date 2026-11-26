/**
 * `nbook.web` 的服务端入口（docs/specs/web/tools.md）：贡献 `web_search`、`web_fetch` 两个工具，提供设置页用的远程合同。
 *
 * 激活时不读写密钥文件（输出 21）：内置插件的入口在应用启动时激活，这里失败会让整个应用起不来。选用哪家与各家的地址每次调用
 * 时从设置读，设置页改了选用、改了设置文件都不用重启。
 */

import {join} from "node:path";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";

import {TOOLS_POINT} from "nbook/plugins/agent/shared/contracts";
import {networkKey} from "nbook/plugins/network/shared/contracts";
import {settingsKey} from "nbook/plugins/settings/shared/contracts";
import {clockKey, stateRootKey} from "nbook/shared/host";

import {descriptor} from "../plugin";
import {FETCH_TOOL, SEARCH_TOOL, webSettingsContract} from "../shared/contracts";
import {webSettings} from "../shared/settings";
import {normalizeSites} from "../shared/sites";
import {createKeyStore} from "./keys";
import type {KeyStore, KeyStoreRecord} from "./keys";
import {createDeepSeekProvider} from "./providers/deepseek";
import {sleepOn} from "./providers/http";
import {createTavilyProvider} from "./providers/tavily";
import {webSettingsRemote} from "./settings-remote";
import {fetchImplementation, fetchTool, searchImplementation, searchTool} from "./tools";

/** 密钥的来源：产品用密钥文件；真实模型的测试换成只在内存里的（docs/testing/README.md 的“真实模型测试”：凭据不落盘）。 */
export type KeyStoreFactory = (path: string, record: KeyStoreRecord) => KeyStore;

export const webBackendPlugin: PluginDefinition = createWebBackendPlugin(createKeyStore);

/** 产品定义是上面的常量；带参数的只给 `testing/` 用（测试插件可以带参数，ADR 0026）。 */
export function createWebBackendPlugin(keyStore: KeyStoreFactory): PluginDefinition {
    return {
        id: descriptor.id,
        entries: [defineEntry({
            id: "server",
            location: "server",
            dependencies: [{key: diagnosticsKey}, {key: settingsKey}, {key: stateRootKey}, {key: clockKey}, {key: networkKey}],
            activationEvents: [searchTool.activationEvent, fetchTool.activationEvent],
            contributions: [searchTool.contribution, fetchTool.contribution],
            remoteProvides: [webSettingsContract],
            activate: (context) => {
                const diagnostics = context.services.require(diagnosticsKey);
                const settings = context.services.require(settingsKey);
                const clock = context.services.require(clockKey);
                const record = (level: "info" | "warn", event: string, message: string, data: Readonly<Record<string, unknown>>): void => {
                    diagnostics.record({level, event, message, data, source: {plugin: descriptor.id}});
                };
                const keys = keyStore(join(context.services.require(stateRootKey).path, "web", "keys.json"), record);
                // 经网络出口发（应用级的代理设置，docs/specs/network/egress.md）；重定向照旧不跟随（`postJson` 的 `manual`）。
                const fetch = context.services.require(networkKey).fetchFor();
                const http = {fetch, now: () => clock.now(), sleep: sleepOn(clock)};
                const providers = {
                    deepseek: createDeepSeekProvider(() => settings.get(webSettings.settings.deepseekBaseUrl), http),
                    tavily: createTavilyProvider(() => settings.get(webSettings.settings.tavilyBaseUrl), http),
                };
                const deps = () => ({
                    keys,
                    providers,
                    selected: () => settings.get(webSettings.settings.provider),
                    resultCount: () => settings.get(webSettings.settings.resultCount),
                    // 设置文件里手写错的项只跳过这一项（shared/sites.ts）。
                    blockedSites: () => normalizeSites(settings.get(webSettings.settings.blockedSites)),
                    searchDepth: () => settings.get(webSettings.settings.tavilySearchDepth),
                    clock,
                    record: (event: string, message: string, data: Readonly<Record<string, unknown>>) => record("warn", event, message, data),
                });
                return {
                    contributions: {[TOOLS_POINT]: {[SEARCH_TOOL]: searchImplementation(deps), [FETCH_TOOL]: fetchImplementation(deps)}},
                    remote: [provideRemote(webSettingsContract, () => webSettingsRemote(keys, providers, clock))],
                };
            },
        })],
    };
}
