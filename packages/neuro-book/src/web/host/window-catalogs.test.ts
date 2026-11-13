/**
 * 窗口取消息目录（docs/specs/runtime/browser-host.md 输出 2、docs/specs/runtime/plugin-code-loading.md 的目录端点）：第三方
 * 插件经真实的安装与启动准备装进状态根，同进程启动真实后端，窗口经真实 fetch 与 WebSocket 取引导、目录并登记插件。
 *
 * 引导集合里另有一个测试内置插件 `test.notes-owner`（服务端的产品清单与窗口的构建各加一份）：它提供贡献点 `test.notes`，
 * 第三方插件往里声明，用来观察目录坏了时插件功能照常；它也带一份随构建的目录，验证内置插件的目录登记。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {EventEmitter} from "node:events";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import type {DiagnosticsConsole} from "@notnotype/nb-host/web";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {productPlugins} from "nbook/manifest";
import {createPluginInventory} from "nbook/plugin-platform/backend/inventory";
import {NO_INSTALLED_PLUGINS, prepareInstalledPlugins} from "nbook/plugin-platform/backend/startup";
import type {StartupPlugins} from "nbook/plugin-platform/backend/startup";
import {pluginCatalogUrl} from "nbook/plugin-platform/shared/plugin-files";
import type {PluginProblem} from "nbook/plugin-platform/shared/types";
import {NEUROBOOK_PROFILE} from "nbook/plugin-platform-profile";
import {PROJECT_LIMIT_DEFAULTS} from "nbook/server/config";
import {startClaimedServer} from "nbook/server/testing/claimed-server";
import type {RunningServer} from "nbook/server/start";
import {BROWSER_BOOTSTRAP_PATH} from "nbook/shared/browser-bootstrap";
import type {BrowserBootstrap} from "nbook/shared/browser-bootstrap";
import {windowPluginsKey} from "nbook/shared/host";
import type {WindowPlugins} from "nbook/shared/host";

import {browserPluginDefinitions, builtinBrowserPlugins} from "../plugins";
import {createConnection} from "./connection";
import {createBrowserWindow} from "./window";

let tmp = "";
let cases = 0;

const quietConsole: DiagnosticsConsole = {error: () => undefined};

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-window-catalogs", "窗口取消息目录");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 测试内置插件：提供 `test.notes`，激活时记下看到的声明，并拿到本窗口的插件问题。 */
function notesOwner() {
    const seen: {listed: string[]; plugins: WindowPlugins | null} = {listed: [], plugins: null};
    const descriptor = {id: "test.notes-owner", version: "0.1.0", locations: ["browser"] as const};
    const definition = {
        id: "test.notes-owner",
        contributionPoints: [{id: "test.notes", implementation: "none" as const, validate: () => null}],
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            dependencies: [{key: windowPluginsKey, required: false}],
            activate: async (context: ActivationContext) => {
                seen.listed = context.declarations.list("test.notes").map((declaration) => `${declaration.plugin}:${declaration.id}`);
                const plugins = await context.services.resolve(windowPluginsKey);
                seen.plugins = plugins.status === "resolved" ? plugins.instance : null;
                return {};
            },
        }],
    } satisfies PluginDefinition;
    return {seen, descriptor, definition};
}

interface Case {
    readonly root: string;
    readonly stateRoot: string;
    /** 在 `sources/<name>` 写一个插件文件夹并安装；`startup` 是当前这次启动的插件集合（升级时要传）。 */
    install(name: string, manifest: Record<string, unknown>, files: Readonly<Record<string, string>>, startup?: StartupPlugins): Promise<void>;
}

async function newCase(): Promise<Case> {
    cases += 1;
    const root = join(tmp, `case-${String(cases)}`);
    const stateRoot = join(root, "state");
    return {
        root,
        stateRoot,
        install: async (name, manifest, files, startup = NO_INSTALLED_PLUGINS) => {
            const directory = join(root, "sources", name);
            await mkdir(directory, {recursive: true});
            await writeFile(join(directory, "package.json"), JSON.stringify(manifest));
            for (const [path, text] of Object.entries(files)) {
                await mkdir(join(directory, path, ".."), {recursive: true});
                await writeFile(join(directory, path), text);
            }
            const inventory = createPluginInventory({root: join(stateRoot, "plugins"), profile: NEUROBOOK_PROFILE, builtin: [], startup, record: () => undefined});
            const installed = await inventory.install(directory);
            if (!installed.ok) throw new Error(`安装 ${name} 失败：${installed.code} ${installed.detail}`);
        },
    };
}

async function serve(world: Case, owner: ReturnType<typeof notesOwner>): Promise<{readonly server: RunningServer; readonly startup: StartupPlugins}> {
    const prepared = await prepareInstalledPlugins({root: join(world.stateRoot, "plugins"), profile: NEUROBOOK_PROFILE, safeMode: false});
    const server = await startClaimedServer({
        config: {host: "127.0.0.1", port: 0, stateRoot: world.stateRoot, logDirectory: join(world.stateRoot, "logs"), webRoot: null, stopStdin: false, rpcPort: 0, shiftPorts: false, allowedOrigins: [], projects: PROJECT_LIMIT_DEFAULTS},
        manifest: [...productPlugins, owner.descriptor],
        prepared,
        process: new EventEmitter(),
        writeFatal: () => undefined,
    });
    await server.ready;
    return {server, startup: prepared.startup};
}

async function stopServer(server: RunningServer): Promise<void> {
    server.requestStop("test:done");
    await server.stopped;
}

async function bootstrapOf(server: RunningServer): Promise<BrowserBootstrap> {
    return (await (await fetch(new URL(BROWSER_BOOTSTRAP_PATH, server.url!))).json()) as BrowserBootstrap;
}

function openWindow(server: RunningServer, owner: ReturnType<typeof notesOwner>, extra: Partial<Parameters<typeof createBrowserWindow>[0]> = {}) {
    return createBrowserWindow({
        connection: createConnection(server.url!),
        page: new EventTarget(),
        console: quietConsole,
        clientIdentity: "profile-test",
        navigation: {navigateDocument: () => undefined, reloadDocument: () => undefined, openExternal: () => "opened", currentUrl: () => "http://localhost/", replaceUrl: () => undefined},
        builtin: [...builtinBrowserPlugins, owner.descriptor],
        definitions: {...browserPluginDefinitions, [owner.descriptor.id]: owner.definition},
        ...extra,
    });
}

const BILINGUAL = {source: "zh-CN", locales: ["zh-CN", "en-US"]};

function notes(version: string, title: string): {readonly manifest: Record<string, unknown>; readonly files: Readonly<Record<string, string>>} {
    return {
        manifest: {publisher: "example", name: "notes", version, engines: {neurobook: ">=0.1.0"}, l10n: BILINGUAL, contributes: [{capability: "test.notes", id: "example.notes/first", declaration: {}}]},
        files: {"locales/zh-CN.json": JSON.stringify({title: `${title}（中文）`}), "locales/en-US.json": JSON.stringify({title})},
    };
}

describe("窗口取消息目录", () => {
    it("目录集合不限于浏览器登记集合：只有后端入口的插件不在引导的插件里，目录照样取到；内置插件的目录随构建登记", async () => {
        const world = await newCase();
        const owner = notesOwner();
        const first = notes("1.0.0", "Notes");
        await world.install("notes", first.manifest, first.files);
        await world.install("worker", {
            publisher: "example",
            name: "worker",
            version: "1.0.0",
            engines: {neurobook: ">=0.1.0"},
            entries: {server: {location: "server", main: "server.js"}},
            l10n: {source: "en-US", locales: ["en-US"]},
        }, {"server.js": "export const activate = () => ({});\n", "locales/en-US.json": JSON.stringify({status: {idle: "Idle"}})});
        const {server} = await serve(world, owner);
        try {
            const bootstrap = await bootstrapOf(server);
            expect(bootstrap.plugins.map((plugin) => plugin.id)).toContain("example.notes");
            expect(bootstrap.plugins.map((plugin) => plugin.id)).not.toContain("example.worker");
            expect(bootstrap.catalogs.map(({plugin, source, locales}) => ({plugin, source, locales}))).toEqual([
                {plugin: "example.notes", source: "zh-CN", locales: ["zh-CN", "en-US"]},
                {plugin: "example.worker", source: "en-US", locales: ["en-US"]},
            ]);

            // 端点只给清单列出的语言；路径不是 `<语言>.json` 时 400。
            const worker = bootstrap.catalogs.find((catalog) => catalog.plugin === "example.worker")!;
            const statusOf = async (path: string): Promise<number> => (await fetch(new URL(path, server.url!))).status;
            expect([await statusOf(pluginCatalogUrl(worker.prefix, "en-US")), await statusOf(pluginCatalogUrl(worker.prefix, "zh-CN")), await statusOf(`${worker.prefix}en-US.txt`)]).toEqual([200, 404, 400]);

            const browserWindow = openWindow(server, owner, {builtinCatalogs: {"test.notes-owner": {source: "zh-CN", catalogs: {"zh-CN": {hello: "你好"}, "en-US": {hello: "Hello"}}}}});
            await browserWindow.start();
            expect(browserWindow.state.status).toBe("ready");
            const t = (ns: string, key: string): string => browserWindow.text.port.t({kind: "text", ns, key});
            expect([t("example.notes", "title"), t("example.worker", "status.idle"), t("test.notes-owner", "hello")]).toEqual(["Notes（中文）", "Idle", "你好"]);
            // 两种语言都登记了（当前语言由设置插件推送，这里不切换，只看各语言的文字）。
            expect(browserWindow.text.port.variants({kind: "text", ns: "example.notes", key: "title"})).toEqual(["Notes（中文）", "Notes"]);
            expect(browserWindow.text.port.variants({kind: "text", ns: "test.notes-owner", key: "hello"})).toEqual(["你好", "Hello"]);
            expect(owner.seen.plugins?.problems()).toEqual([]);
            await browserWindow.stop();
        } finally {
            await stopServer(server);
        }
    });

    it("装好之后目录坏了或文件没了：插件照常登记，窗口照常就绪，本窗口的插件问题里有这两种语言的目录问题", async () => {
        const world = await newCase();
        const owner = notesOwner();
        const first = notes("1.0.0", "Notes");
        await world.install("notes", first.manifest, first.files);
        const {server, startup} = await serve(world, owner);
        try {
            // 运行中的服务端照旧服务版本目录；坏的是装进去之后的文件，下次窗口启动才会取到。
            const [plugin] = startup.plugins.flatMap((item) => (item.installed === null ? [] : [item.installed]));
            await writeFile(join(plugin!.root, "locales", "zh-CN.json"), JSON.stringify({title: 1}));
            await rm(join(plugin!.root, "locales", "en-US.json"));

            const browserWindow = openWindow(server, owner);
            await browserWindow.start();
            expect(browserWindow.state.status).toBe("ready");
            expect(owner.seen.listed).toEqual(["example.notes:example.notes/first"]);
            const problems: ReadonlyArray<PluginProblem> = owner.seen.plugins?.problems() ?? [];
            expect(problems).toEqual([
                {kind: "catalog-unavailable", plugin: "example.notes", location: "browser", locale: "en-US", reason: "not-found", detail: null},
                {kind: "catalog-unavailable", plugin: "example.notes", location: "browser", locale: "zh-CN", reason: "invalid", detail: expect.stringContaining("title：")},
            ]);
            await browserWindow.stop();
        } finally {
            await stopServer(server);
        }
    });

    it("升级之后新目录重启才生效：运行中的服务端照旧给旧摘要与旧目录；重启后摘要换了，旧地址 404", async () => {
        const world = await newCase();
        const owner = notesOwner();
        const first = notes("1.0.0", "Notes v1");
        await world.install("notes-v1", first.manifest, first.files);
        const running = await serve(world, owner);
        let before: BrowserBootstrap["catalogs"][number];
        try {
            [before] = (await bootstrapOf(running.server)).catalogs as [BrowserBootstrap["catalogs"][number]];
            const second = notes("2.0.0", "Notes v2");
            await world.install("notes-v2", second.manifest, second.files, running.startup);

            const browserWindow = openWindow(running.server, owner);
            await browserWindow.start();
            expect(browserWindow.text.port.t({kind: "text", ns: "example.notes", key: "title"})).toBe("Notes v1（中文）");
            expect((await bootstrapOf(running.server)).catalogs[0]?.digest).toBe(before.digest);
            await browserWindow.stop();
        } finally {
            await stopServer(running.server);
        }

        const restarted = await serve(world, owner);
        try {
            const [after] = (await bootstrapOf(restarted.server)).catalogs;
            expect(after?.digest).toEqual(expect.any(String));
            expect(after?.digest).not.toBe(before.digest);
            const browserWindow = openWindow(restarted.server, owner);
            await browserWindow.start();
            expect(browserWindow.text.port.t({kind: "text", ns: "example.notes", key: "title"})).toBe("Notes v2（中文）");
            await browserWindow.stop();

            const old = await fetch(new URL(pluginCatalogUrl(before.prefix, "zh-CN"), restarted.server.url!));
            expect([old.status, old.headers.get("cache-control")]).toEqual([404, "no-store"]);
            const fresh = await fetch(new URL(pluginCatalogUrl(after!.prefix, "en-US"), restarted.server.url!));
            expect([fresh.status, fresh.headers.get("cache-control"), await fresh.json()]).toEqual([200, "public, max-age=31536000, immutable", {title: "Notes v2"}]);
        } finally {
            await stopServer(restarted.server);
        }
    });
});
