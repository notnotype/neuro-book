/**
 * 宿主合同测试的子进程入口：与 `main.ts` 相同的启动与退出流程，另按 `NBOOK_TEST_PLUGINS`
 * （逗号分隔的测试插件 id）在产品插件之外加入测试插件。只由测试启动。
 */

import {readServerConfig} from "nbook/server/config";
import {productServerPlugins} from "nbook/server/plugins";
import {startServer} from "nbook/server/start";

import {createTestPlugin, TEST_PLUGIN_IDS} from "./test-plugins";
import type {TestPluginId} from "./test-plugins";

const requested = (process.env.NBOOK_TEST_PLUGINS ?? "").split(",").filter(Boolean);
const unknown = requested.filter((id) => !(TEST_PLUGIN_IDS as ReadonlyArray<string>).includes(id));
if (unknown.length > 0) throw new Error(`未知测试插件：${unknown.join(", ")}`);

const config = readServerConfig(process.argv.slice(2), process.env, process.cwd());
const server = startServer({
    config,
    stopInput: config.stopStdin ? process.stdin : null,
    plugins: (context) => [...productServerPlugins(context), ...requested.map((id) => createTestPlugin(id as TestPluginId))],
    onListening: (url) => {
        console.log(`Listening on ${url}`);
    },
});
const {exitCode} = await server.stopped;
process.exit(exitCode);
