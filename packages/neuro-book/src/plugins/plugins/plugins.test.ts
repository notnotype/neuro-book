/**
 * `nbook.plugins/registry` 经内核远程调用（docs/specs/runtime/plugin-install.md 输出 1–4 与失败码表）：真实的服务端
 * 运行实例与窗口运行实例经路由连起来，窗口里的插件只用合同。安装、启停与卸载的文件系统细节由
 * `src/plugin-platform/backend/plugins.test.ts` 覆盖，这里核对合同的输入输出与失败码到得了窗口。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createConsoleExporterFactory, createConsoleFallback} from "@notnotype/nb-host/web";
import type {Application} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode, createRemoteRouter} from "@notnotype/nb-runtime/remote";
import {createLinkPair} from "@notnotype/nb-runtime/remote/testing";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {createApplication} from "nbook/application";
import {createPluginInventory, pluginInventoryKey} from "nbook/plugin-platform/backend/inventory";
import {NO_INSTALLED_PLUGINS} from "nbook/plugin-platform/backend/startup";
import {NEUROBOOK_PROFILE} from "nbook/plugin-platform-profile";

import {pluginsBackendPlugin} from "./backend/plugin";
import {pluginsRegistryContract} from "./shared/contracts";

let tmp = "";
let cases = 0;
const apps: Application[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-plugins-contract", "nbook.plugins 的远程合同");
});

afterEach(async () => {
    for (const app of apps.splice(0).reverse()) expect(await app.stop()).toMatchObject({status: "closed"});
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

function silentDiagnostics(location: string, instanceId: string): PluginDefinition {
    const silent = {error: () => undefined};
    return createDiagnosticsPlugin({location, store: createDiagnosticsStore({identity: {location, instanceId}}), exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
}

/** 服务端装 `nbook.plugins`，窗口里一个只用合同的插件；返回它的合同客户端与临时目录。 */
async function world() {
    cases += 1;
    const base = join(tmp, `case-${String(cases)}`);
    const hubNode = createRemoteNode({instance: {id: "hub", kind: "server", role: "hub", project: null, client: null}});
    const hub = createApplication(
        {identity: {location: "server", instanceId: "hub"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {
            capabilities: [{
                id: "host.plugin-inventory",
                key: pluginInventoryKey,
                create: () => createPluginInventory({root: join(base, "state", "plugins"), profile: NEUROBOOK_PROFILE, builtin: [{id: "nbook.plugins", version: "0.1.0"}], startup: NO_INSTALLED_PLUGINS, record: () => undefined}),
            }],
            plugins: [silentDiagnostics("server", "hub"), pluginsBackendPlugin],
            gates: [],
            remote: hubNode,
        },
    );
    apps.push(hub);
    expect(await hub.startup).toMatchObject({status: "available", failures: []});
    const router = createRemoteRouter(hubNode, {bindProject: async () => ({ok: false, reason: "project-unavailable", message: "没有项目"})});

    const node = createRemoteNode({instance: {id: "window-1", kind: "browser", role: "client", project: null, client: "profile-1"}});
    const pair = createLinkPair();
    router.accept(pair.right);
    expect(await node.connect(pair.left)).toEqual({ok: true});
    let captured: ActivationContext | null = null;
    const page: PluginDefinition = {id: "test.page", entries: [{id: "browser", location: "browser", activationEvents: ["onStartup"], activate: (context) => {
        captured = context;
        return {};
    }}]};
    const window = createApplication(
        {identity: {location: "browser", instanceId: "window-1", client: "profile-1"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {capabilities: [], plugins: [page], gates: [], remote: node},
    );
    apps.push(window);
    expect(await window.startup).toMatchObject({status: "available"});
    const registry = (captured as unknown as ActivationContext).remote.use(pluginsRegistryContract);
    return {base, registry};
}

describe("nbook.plugins/registry", () => {
    it("列表、安装、禁用、卸载经合同往返；内置插件标为内置", async () => {
        const {base, registry} = await world();
        const source = join(base, "hello");
        await mkdir(source, {recursive: true});
        await writeFile(join(source, "package.json"), JSON.stringify({publisher: "example", name: "hello", version: "1.0.0", engines: {neurobook: ">=0.1.0"}}));

        expect(await registry.list({})).toEqual({ok: true, value: {safeMode: false, plugins: [{id: "nbook.plugins", version: "0.1.0", source: "builtin", state: "enabled", pending: [], notLoaded: null, displayName: null, description: null, problems: []}]}});
        expect(await registry.inspect({path: source})).toEqual({ok: true, value: {id: "example.hello", version: "1.0.0", installed: null, relation: "install", blocked: [], unchecked: []}});
        expect(await registry.install({path: source})).toMatchObject({ok: true, value: {plugin: {id: "example.hello", pending: [{kind: "install"}]}}});
        expect(await registry.disable({id: "example.hello"})).toMatchObject({ok: true, value: {plugin: {state: "disabled", pending: [{kind: "install"}, {kind: "disable"}]}}});
        expect(await registry.uninstall({id: "example.hello"})).toMatchObject({ok: true, value: {plugin: {state: "uninstalling", pending: [{kind: "uninstall"}]}}});
    });

    it("业务失败按失败码到达窗口：清单无效与目录无效带逐条问题，其余只带说明", async () => {
        const {base, registry} = await world();
        const source = join(base, "broken");
        await mkdir(source, {recursive: true});
        await writeFile(join(source, "package.json"), JSON.stringify({publisher: "example", name: "Broken", version: "1.0.0", engines: {neurobook: ">=0.1.0"}}));
        const catalogs = join(base, "catalogs");
        await mkdir(join(catalogs, "locales"), {recursive: true});
        await writeFile(join(catalogs, "package.json"), JSON.stringify({publisher: "example", name: "catalogs", version: "1.0.0", engines: {neurobook: ">=0.1.0"}, l10n: {source: "zh-CN", locales: ["zh-CN"]}}));
        await writeFile(join(catalogs, "locales", "zh-CN.json"), JSON.stringify({title: 1}));

        expect(await registry.install({path: source})).toMatchObject({ok: false, code: "manifest-invalid", detail: {problems: [expect.stringMatching(/^name：/u)]}});
        for (const result of [await registry.inspect({path: catalogs}), await registry.install({path: catalogs})]) {
            expect(result).toMatchObject({ok: false, code: "catalog-invalid", detail: {problems: [expect.stringMatching(/^locales\/zh-CN\.json：title：/u)]}});
        }
        expect(await registry.install({path: join(base, "nothing")})).toMatchObject({ok: false, code: "path-rejected", detail: {detail: expect.any(String)}});
        expect(await registry.enable({id: "nbook.plugins"})).toMatchObject({ok: false, code: "builtin-fixed"});
        expect(await registry.uninstall({id: "example.none"})).toMatchObject({ok: false, code: "not-installed"});
    });
});
