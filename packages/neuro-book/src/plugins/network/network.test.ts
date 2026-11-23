/**
 * `nbook.network` 的服务端（docs/specs/network/egress.md）：真实的服务端实例与设置文件，窗口经真实的远程合同调用；“测试代理”的
 * 目标由启动环境指到本机，经本机起的转发代理到达本机的假 trace 端点。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {startHttpProxy} from "@notnotype/nb-host/testing";
import type {HttpProxy} from "@notnotype/nb-host/testing";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {definitionAt} from "nbook/manifest";
import {RELOAD_DELAY_MS} from "nbook/plugins/settings/backend/layer-owner";
import {settingsWorld} from "nbook/plugins/settings/testing/world";
import type {SettingsWorld} from "nbook/plugins/settings/testing/world";
import {startupEnvKey} from "nbook/shared/host";

import {networkBackendPlugin} from "./backend/plugin";
import {descriptor} from "./plugin";
import {networkSettingsContract} from "./shared/contracts";

const trace = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => new Response("fl=1\nip=198.51.100.7\nts=1\n")});
let root = "";
let counter = 0;
let proxy: HttpProxy | null = null;
const worlds: SettingsWorld[] = [];

beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-network", "egress");
});
afterEach(async () => {
    proxy?.stop();
    proxy = null;
    for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
    trace.stop(true);
    if (root !== "") await rm(root, {recursive: true, force: true});
});

/** 一个服务端加一个窗口；`settings` 先写进用户设置文件。`trace.test` 由测试代理接到本机的假端点。 */
async function open(settings: Record<string, unknown>, env: Record<string, string> = {}) {
    counter += 1;
    const dir = join(root, `w${String(counter)}`);
    await mkdir(join(dir, "state"), {recursive: true});
    await writeFile(join(dir, "state", "settings.json"), JSON.stringify(settings));
    const world = await settingsWorld(dir, [definitionAt("server", descriptor, networkBackendPlugin)], {
        hubCapabilities: [{id: "host.startup-env", key: startupEnvKey, create: () => ({env: Object.freeze({NBOOK_NETWORK_TEST_URL: "http://trace.test/cdn-cgi/trace", ...env})})}],
    });
    worlds.push(world);
    let captured: ActivationContext | null = null;
    const page: PluginDefinition = {id: "test.network-page", entries: [defineEntry({id: "browser", location: "browser", activationEvents: ["onStartup"], activate: (context) => {
        captured = context;
        return {};
    }})]};
    await world.window("w", [page], {bound: false});
    if (captured === null) throw new Error("the test page did not activate");
    return {world, client: (captured as ActivationContext).remote.use(networkSettingsContract)};
}

const startProxy = (): HttpProxy => {
    proxy = startHttpProxy({resolve: (host, port) => (host === "trace.test" ? {host: "127.0.0.1", port: trace.port ?? 0} : {host, port})});
    return proxy;
};

const ok = <T>(result: {ok: boolean; value?: T}): T => {
    if (!result.ok) throw new Error(`remote call failed: ${JSON.stringify(result)}`);
    return result.value as T;
};

describe("网络页的远程合同", () => {
    it("自定义代理：describe 写出代理与选路，test 经代理取到出口 IP；改设置不用重启，下一次就按新的走", async () => {
        const local = startProxy();
        const {world, client} = await open({"nbook.network/proxyMode": "custom", "nbook.network/proxyUrl": local.url});
        expect(ok(await client.describe({}))).toEqual({mode: "custom", route: "proxy", source: {kind: "setting"}, origin: local.url, hasCredentials: false, error: null});
        expect(ok(await client.test({}))).toMatchObject({ok: true, ip: "198.51.100.7", summary: {route: "proxy"}});
        expect(local.requests.map((item) => item.target)).toEqual(["http://trace.test/cdn-cgi/trace"]);

        await writeFile(world.userFile, JSON.stringify({"nbook.network/proxyMode": "direct"}));
        await waitUntil("the direct setting is read", async () => {
            world.clock.advance(RELOAD_DELAY_MS);
            const summary = ok(await client.describe({}));
            return summary.mode === "direct" ? summary : undefined;
        });
        expect(ok(await client.describe({}))).toMatchObject({route: "direct", source: {kind: "direct"}});
    });

    it("跟随系统：写出环境变量的名字与去掉密码的代理；代理是 SOCKS 时 test 报不支持、不发请求", async () => {
        const {client} = await open({}, {HTTP_PROXY: "http://alice:hunter22@proxy.example:3128"});
        const summary = ok(await client.describe({}));
        expect(summary).toMatchObject({mode: "system", route: "proxy", source: {kind: "env", name: "HTTP_PROXY"}, origin: "http://proxy.example:3128", hasCredentials: true});
        expect(JSON.stringify(summary)).not.toContain("hunter22");

        const local = startProxy();
        const socks = await open({}, {HTTP_PROXY: "socks5://127.0.0.1:1080"});
        expect(ok(await socks.client.test({}))).toMatchObject({ok: false, reason: "proxy-unsupported", summary: {error: {code: "proxy-unsupported"}}});
        expect(local.connections()).toBe(0);
    });
});
