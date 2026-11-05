/**
 * 宿主合同测试与 e2e 的子进程入口：与 `main.ts` 相同的认领、启动与退出流程，另按 `NBOOK_TEST_PLUGINS`
 * （逗号分隔的测试插件 id）在产品插件之外加入测试插件。有浏览器入口的测试插件（`test.remote-probe`、只有浏览器
 * 入口的 `test.sample-views`）同时加进本进程清单，引导接口才会把它列给测试外壳。项目子进程用项目宿主的测试入口，同样按环境变量加入测试插件。
 * `NBOOK_EXCLUDE_PLUGINS`（逗号分隔的产品插件 id）从本进程清单去掉产品插件，服务端入口也不启动：验证视图机制的用例只要
 * 测试插件的视图，产品视图（资源管理器、Agent 对话）会占住它们假定的位置。别的插件必需的不能去掉，它们会受阻。
 * `NBDEV_SAMPLE=1` 时与开发入口一样放样例作品，样例的包目录由 `NBOOK_TEST_SAMPLE_ROOT` 给出（不写进真实的包目录），
 * 截止可用 `NBOOK_TEST_SAMPLE_TIMEOUT_MS`、`NBOOK_TEST_SAMPLE_STOP_MS` 缩短。
 * 只由测试启动。
 */

// 第一条导入：启动环境要在任何导入 OMP 的模块之前拍下（server/startup-env.ts）。
import "nbook/server/startup-env";
// 第二条：接管 OMP 装的进程级处理（omp-process.ts）。
import "nbook/server/omp-process";

import {join} from "node:path";

import {descriptorsOf} from "nbook/plugin-platform/backend/installed";
import {prepareInstalledPlugins, safeModeOf} from "nbook/plugin-platform/backend/startup";
import type {PluginsPreparation} from "nbook/plugin-platform/backend/startup";
import {definitionAt, pluginsAt, productPlugins, thirdPartyDefinition} from "nbook/manifest";
import {readServerConfig} from "nbook/server/config";
import {claimStateRoot} from "nbook/server/instance";
import {claimReport, reportClaimFailure} from "nbook/server/process";
import {devSampleEnabled, startDevSample} from "nbook/server/dev/sample";
import {serverPlugin} from "nbook/server/plugins";
import {startServer} from "nbook/server/start";
import {manifestFormat, NEUROBOOK_PROFILE} from "nbook/plugin-platform-profile";
import {PRODUCT_VERSION} from "nbook/shared/product";
import type {DevTask, StartServerOptions} from "nbook/server/start";
import {remoteProbeDescriptor} from "nbook/shared/testing/remote-probe-contract";
import {testMenusDescriptor} from "nbook/shared/testing/menus-contract";
import {sampleViewsDescriptor} from "nbook/shared/testing/sample-views-contract";

import {createTestPlugin, TEST_PLUGIN_IDS} from "./test-plugins";
import type {TestPluginId} from "./test-plugins";

/** 有浏览器入口的测试插件：描述要进本进程清单。只有浏览器入口的（没有服务端定义）不进服务端的插件列表。 */
const BROWSER_TEST_PLUGINS = [remoteProbeDescriptor, sampleViewsDescriptor, testMenusDescriptor];
const BROWSER_ONLY_IDS: ReadonlyArray<string> = [sampleViewsDescriptor.id, testMenusDescriptor.id];

const requested = (process.env.NBOOK_TEST_PLUGINS ?? "").split(",").filter(Boolean);
const unknown = requested.filter((id) => !(TEST_PLUGIN_IDS as ReadonlyArray<string>).includes(id) && !BROWSER_ONLY_IDS.includes(id));
if (unknown.length > 0) throw new Error(`未知测试插件：${unknown.join(", ")}`);

const excluded = (process.env.NBOOK_EXCLUDE_PLUGINS ?? "").split(",").filter(Boolean);
const notProduct = excluded.filter((id) => !productPlugins.some((plugin) => plugin.id === id));
if (notProduct.length > 0) throw new Error(`只能去掉产品插件：${notProduct.join(", ")}`);
const manifest = productPlugins.filter((plugin) => !excluded.includes(plugin.id));

const config = readServerConfig(process.argv.slice(2), process.env, process.cwd());
function sampleTask(): StartServerOptions["devTask"] {
    if (!devSampleEnabled(process.env)) return undefined;
    const packageRoot = process.env.NBOOK_TEST_SAMPLE_ROOT;
    if (!packageRoot) throw new Error("NBDEV_SAMPLE=1 时要给 NBOOK_TEST_SAMPLE_ROOT");
    const milliseconds = (name: string): number | undefined => (process.env[name] ? Number(process.env[name]) : undefined);
    return ({registry, stateRoot}): DevTask => startDevSample({
        registry,
        stateRoot,
        packageRoot,
        report: (line) => console.log(line),
        timeoutMs: milliseconds("NBOOK_TEST_SAMPLE_TIMEOUT_MS"),
        stopMs: milliseconds("NBOOK_TEST_SAMPLE_STOP_MS"),
    });
}

// 参数错误（样例缺目录）在认领之前就报出来。
const devTask = sampleTask();
// 与产品入口一样先认领状态根：e2e 与宿主合同测试起的服务端同样受“一个状态根一个实例”约束。
const claimed = await claimStateRoot({stateRoot: config.stateRoot, kind: "fixture", version: PRODUCT_VERSION, report: claimReport});
if (!claimed.ok) {
    reportClaimFailure(claimed, config.stateRoot);
    process.exit(1);
}
// 与产品入口相同：安装过的第三方插件照常登记（插件管理的 e2e 用它）。认领交给 startServer 之前出错由这里放下。
let prepared: PluginsPreparation;
try {
    prepared = await prepareInstalledPlugins({root: join(config.stateRoot, "plugins"), profile: NEUROBOOK_PROFILE, safeMode: safeModeOf(process.env, NEUROBOOK_PROFILE)});
} catch (error) {
    await claimed.claim.release();
    throw error;
}

const server = startServer({
    config,
    claim: claimed.claim,
    manifest: [...manifest, ...BROWSER_TEST_PLUGINS.filter((descriptor) => requested.includes(descriptor.id))],
    stopInput: config.stopStdin ? process.stdin : null,
    devTask,
    projectEntry: join(import.meta.dir, "..", "..", "project", "testing", "fixture-entry.ts"),
    prepared,
    // 产品插件按产品清单取定义（测试插件不在产品的表里），宿主适配器拿到的上下文仍是含测试插件的清单。
    plugins: (context) => [
        ...pluginsAt("server", manifest).map((plugin) => definitionAt("server", plugin, plugin.locations.includes("server") ? serverPlugin(plugin.id, context) : undefined)),
        ...requested.filter((id) => !BROWSER_ONLY_IDS.includes(id)).map((id) => createTestPlugin(id as TestPluginId)),
        ...pluginsAt("server", descriptorsOf(context.installed, manifestFormat)).map(thirdPartyDefinition),
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
