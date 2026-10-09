/**
 * 宿主合同测试与 e2e 的子进程入口：与 `main.ts` 相同的启动与退出流程，另按 `NBOOK_TEST_PLUGINS`
 * （逗号分隔的测试插件 id）在产品插件之外加入测试插件。有浏览器入口的测试插件（`test.remote-probe`、只有浏览器
 * 入口的 `test.sample-views`）同时加进本进程清单，引导接口才会把它列给测试外壳。项目子进程用项目宿主的测试入口，同样按环境变量加入测试插件。
 * `NBOOK_EXCLUDE_PLUGINS`（逗号分隔的产品插件 id）从本进程清单去掉只有浏览器入口的产品插件：验证视图机制的用例只要
 * 测试插件的视图，产品视图（资源管理器）会占住它们假定的位置。
 * 只由测试启动。
 */

import {join} from "node:path";

import {definitionAt, pluginsAt, productPlugins} from "nbook/manifest";
import {readServerConfig} from "nbook/server/config";
import {serverPlugin} from "nbook/server/plugins";
import {startServer} from "nbook/server/start";
import {remoteProbeDescriptor} from "nbook/shared/testing/remote-probe-contract";
import {sampleViewsDescriptor} from "nbook/shared/testing/sample-views-contract";

import {createTestPlugin, TEST_PLUGIN_IDS} from "./test-plugins";
import type {TestPluginId} from "./test-plugins";

/** 有浏览器入口的测试插件：描述要进本进程清单。只有浏览器入口的（没有服务端定义）不进服务端的插件列表。 */
const BROWSER_TEST_PLUGINS = [remoteProbeDescriptor, sampleViewsDescriptor];
const BROWSER_ONLY_IDS: ReadonlyArray<string> = [sampleViewsDescriptor.id];

const requested = (process.env.NBOOK_TEST_PLUGINS ?? "").split(",").filter(Boolean);
const unknown = requested.filter((id) => !(TEST_PLUGIN_IDS as ReadonlyArray<string>).includes(id) && !BROWSER_ONLY_IDS.includes(id));
if (unknown.length > 0) throw new Error(`未知测试插件：${unknown.join(", ")}`);

const excluded = (process.env.NBOOK_EXCLUDE_PLUGINS ?? "").split(",").filter(Boolean);
const notExcludable = excluded.filter((id) => !productPlugins.some((plugin) => plugin.id === id && plugin.locations.length === 1 && plugin.locations[0] === "browser"));
if (notExcludable.length > 0) throw new Error(`只能去掉只有浏览器入口的产品插件：${notExcludable.join(", ")}`);
const manifest = productPlugins.filter((plugin) => !excluded.includes(plugin.id));

const config = readServerConfig(process.argv.slice(2), process.env, process.cwd());
const server = startServer({
    config,
    manifest: [...manifest, ...BROWSER_TEST_PLUGINS.filter((descriptor) => requested.includes(descriptor.id))],
    stopInput: config.stopStdin ? process.stdin : null,
    projectEntry: join(import.meta.dir, "..", "..", "project", "testing", "fixture-entry.ts"),
    // 产品插件按产品清单取定义（测试插件不在产品的表里），宿主适配器拿到的上下文仍是含测试插件的清单。
    plugins: (context) => [
        ...pluginsAt("server", manifest).map((plugin) => definitionAt("server", plugin, plugin.locations.includes("server") ? serverPlugin(plugin.id, context) : undefined)),
        ...requested.filter((id) => !BROWSER_ONLY_IDS.includes(id)).map((id) => createTestPlugin(id as TestPluginId)),
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
