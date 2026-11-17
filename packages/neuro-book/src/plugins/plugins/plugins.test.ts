/**
 * `nbook.plugins/registry` 经内核远程调用（docs/specs/runtime/plugin-install.md 输出 1–4 与失败码表）：真实的服务端
 * 运行实例与窗口运行实例经路由连起来，窗口里的插件只用合同。安装、启停与卸载的文件系统细节由
 * `src/plugin-platform/backend/plugins.test.ts` 覆盖，这里核对合同的输入输出与失败码到得了窗口。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, readdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createConsoleExporterFactory, createConsoleFallback} from "@notnotype/nb-host/web";
import type {Application} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import {createRemoteNode, createRemoteRouter} from "@notnotype/nb-runtime/remote";
import {createLinkPair} from "@notnotype/nb-runtime/remote/testing";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {createApplication} from "nbook/application";
import {createPluginInventory, pluginInventoryKey} from "nbook/plugin-platform/backend/inventory";
import {NO_INSTALLED_PLUGINS} from "nbook/plugin-platform/backend/startup";
import {createPluginUploads, pluginUploadsKey} from "nbook/plugin-platform/backend/uploads";
import type {PluginUploads} from "nbook/plugin-platform/backend/uploads";
import {encodeFrameHeader} from "nbook/plugin-platform/shared/plugin-upload";
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
    // 能力在第一次被依赖时才建；测试要直接用它造上传，所以先建好、能力只交出这一份。
    const uploads = createPluginUploads({root: join(base, "state", "plugin-uploads"), clock: systemClock, record: () => undefined});
    const hubNode = createRemoteNode({instance: {id: "hub", kind: "server", role: "hub", project: null, client: null}});
    const hub = createApplication(
        {identity: {location: "server", instanceId: "hub"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {
            capabilities: [{
                id: "host.plugin-inventory",
                key: pluginInventoryKey,
                create: () => createPluginInventory({root: join(base, "state", "plugins"), profile: NEUROBOOK_PROFILE, builtin: [{id: "nbook.plugins", version: "0.1.0"}], startup: NO_INSTALLED_PLUGINS, record: () => undefined}),
            }, {
                id: "host.plugin-uploads",
                key: pluginUploadsKey,
                create: () => uploads,
                release: (created: PluginUploads) => created.stop(),
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
    return {base, registry, uploads};
}

/** 一个上传的文件夹：分帧的请求体交给上传暂存区，交回它的 id。 */
async function uploaded(uploads: PluginUploads, files: Record<string, string>): Promise<string> {
    const parts: Uint8Array[] = [];
    for (const [path, content] of Object.entries(files)) parts.push(encodeFrameHeader(path, new TextEncoder().encode(content).length), new TextEncoder().encode(content));
    const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
    }
    return (await uploads.receive(new Blob([bytes]).stream())).id;
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

    it("上传的文件夹：预览不删它，安装成功后服务端删掉它；失效的上传（不存在、已安装用掉的）以 path-rejected 拒绝", async () => {
        const {base, registry, uploads} = await world();
        const id = await uploaded(uploads, {"package.json": JSON.stringify({publisher: "example", name: "dropped", version: "1.0.0", engines: {neurobook: ">=0.1.0"}}), "dist/index.js": "export {};\n"});
        const uploadsRoot = join(base, "state", "plugin-uploads");

        expect(await registry.inspect({upload: id})).toEqual({ok: true, value: {id: "example.dropped", version: "1.0.0", installed: null, relation: "install", blocked: [], unchecked: []}});
        expect(await readdir(uploadsRoot)).toEqual([id]);
        expect(await registry.install({upload: id})).toMatchObject({ok: true, value: {plugin: {id: "example.dropped", pending: [{kind: "install"}]}}});
        expect(await readdir(uploadsRoot)).toEqual([]);
        // 已装好的插件的文件在安装目录里，不是暂存目录；再用同一个 id 就是失效。
        expect(await registry.install({upload: id})).toMatchObject({ok: false, code: "path-rejected", detail: {detail: expect.stringContaining("失效")}});
        expect(await registry.inspect({upload: "00000000-0000-4000-8000-000000000000"})).toMatchObject({ok: false, code: "path-rejected"});
        expect(await registry.inspect({upload: "../plugins"})).toMatchObject({ok: false, code: "path-rejected"});
        // 路径与上传二者给一个：两个都给、都不给都是 path-rejected，不碰文件系统。
        expect(await registry.inspect({path: base, upload: id})).toMatchObject({ok: false, code: "path-rejected", detail: {detail: expect.stringContaining("其中一个")}});
        expect(await registry.install({})).toMatchObject({ok: false, code: "path-rejected"});
    });

    it("上传的文件夹里的插件不合格：清单无效照常给 manifest-invalid 与逐条问题，安装失败后上传照样被删", async () => {
        const {base, registry, uploads} = await world();
        const id = await uploaded(uploads, {"package.json": JSON.stringify({publisher: "example", name: "Broken", version: "1.0.0", engines: {neurobook: ">=0.1.0"}})});
        expect(await registry.inspect({upload: id})).toMatchObject({ok: false, code: "manifest-invalid", detail: {problems: [expect.stringMatching(/^name：/u)]}});
        expect(await registry.install({upload: id})).toMatchObject({ok: false, code: "manifest-invalid"});
        expect(await readdir(join(base, "state", "plugin-uploads"))).toEqual([]);
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
