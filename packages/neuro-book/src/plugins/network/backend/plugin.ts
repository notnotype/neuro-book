/**
 * `nbook.network` 的服务端入口（docs/specs/network/egress.md）：按设置建 nb-host 的网络出口，交出 `networkKey` 与网络页的远程合同。
 * 设置每次选路现读，改了代理从下一个请求起生效，不用重启；系统的代理设置由出口缓存 60 秒。
 */

import {createEgress} from "@notnotype/nb-host/network";
import {defineEntry, provideService} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";

import {settingsKey} from "nbook/plugins/settings/shared/contracts";
import {startupEnvKey} from "nbook/shared/host";

import {descriptor} from "../plugin";
import {networkKey, networkSettingsContract} from "../shared/contracts";
import type {NetworkService} from "../shared/contracts";
import {networkSettings} from "../shared/settings";

export const networkBackendPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "server",
        location: "server",
        dependencies: [{key: settingsKey}, {key: startupEnvKey}],
        provides: [networkKey],
        remoteProvides: [networkSettingsContract],
        activate: (context) => {
            const settings = context.services.require(settingsKey);
            const env = context.services.require(startupEnvKey).env;
            // “测试代理”的目标可由启动环境改（e2e 指向本机，用例不出本机）。
            const testUrl = env.NBOOK_NETWORK_TEST_URL?.trim();
            const egress = createEgress({
                setting: () => ({mode: settings.get(networkSettings.settings.proxyMode), url: settings.get(networkSettings.settings.proxyUrl)}),
                startupEnv: env,
                platform: process.platform,
                ...(testUrl === undefined || testUrl === "" ? {} : {testUrl}),
            });
            const service: NetworkService = {routeFor: egress.routeFor, fetchFor: egress.fetchFor, describe: egress.describe};
            return {
                services: [provideService(networkKey, service)],
                remote: [provideRemote(networkSettingsContract, () => ({
                    methods: {
                        describe: async (_input, ctx) => ctx.ok(await egress.describe()),
                        test: async (_input, ctx) => ctx.ok(await egress.test(undefined, ctx.signal)),
                    },
                }))],
            };
        },
    })],
};
