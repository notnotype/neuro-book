/**
 * 宿主合同测试与 e2e 的子进程入口：与 `main.ts` 相同的启动与退出流程，另按 `NBOOK_TEST_PLUGINS`
 * （逗号分隔的测试插件 id）在产品插件之外加入测试插件。有浏览器入口的测试插件（`test.remote-probe`）同时加进
 * 本进程清单，引导接口才会把它列给测试外壳。项目子进程用项目宿主的测试入口，同样按环境变量加入测试插件。
 * 只由测试启动。
 */

import {join} from "node:path";

import {productPlugins} from "nbook/manifest";
import {readServerConfig} from "nbook/server/config";
import {serverPluginFactories} from "nbook/server/plugins";
import {startServer} from "nbook/server/start";
import {remoteProbeDescriptor} from "nbook/shared/testing/remote-probe-contract";

import {createTestPlugin, TEST_PLUGIN_IDS} from "./test-plugins";
import type {TestPluginId} from "./test-plugins";

const requested = (process.env.NBOOK_TEST_PLUGINS ?? "").split(",").filter(Boolean);
const unknown = requested.filter((id) => !(TEST_PLUGIN_IDS as ReadonlyArray<string>).includes(id));
if (unknown.length > 0) throw new Error(`未知测试插件：${unknown.join(", ")}`);

const config = readServerConfig(process.argv.slice(2), process.env, process.cwd());
const server = startServer({
    config,
    manifest: [...productPlugins, ...(requested.includes(remoteProbeDescriptor.id) ? [remoteProbeDescriptor] : [])],
    stopInput: config.stopStdin ? process.stdin : null,
    projectEntry: join(import.meta.dir, "..", "..", "project", "testing", "fixture-entry.ts"),
    // 产品插件按产品清单取工厂（测试插件没有登记在产品工厂表里），工厂拿到的上下文仍是含测试插件的清单。
    plugins: (context) => [
        ...productPlugins.filter((plugin) => plugin.locations.includes("server")).map((plugin) => {
            const factory = serverPluginFactories[plugin.id];
            if (factory === undefined) throw new Error(`产品插件 ${plugin.id} 没有后端入口工厂`);
            return factory(context);
        }),
        ...requested.map((id) => createTestPlugin(id as TestPluginId)),
    ],
    onListening: (url) => {
        console.log(`Listening on ${url}`);
    },
    onRpcListening: (url) => {
        console.log(`RPC listening on ${url}`);
    },
});
const {exitCode} = await server.stopped;
process.exit(exitCode);
