/**
 * 引导接口：经同进程启动的真实后端（真实监听与准入）取得，按产品清单列出有浏览器入口的插件。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {EventEmitter} from "node:events";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {Value} from "typebox/value";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {pluginsAt, productPlugins} from "nbook/manifest";
import type {PluginDescriptor} from "nbook/manifest";
import {BROWSER_BOOTSTRAP_PATH, BROWSER_PROTOCOL_VERSION, BrowserBootstrapSchema} from "nbook/shared/browser-bootstrap";

import {browserBootstrap} from "./browser-bootstrap";
import {PROJECT_LIMIT_DEFAULTS} from "./config";
import {startServer} from "./start";
import type {RunningServer} from "./start";

let tmp = "";
let server: RunningServer;

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-bootstrap", "browser-bootstrap");
    server = startServer({
        config: {host: "127.0.0.1", port: 0, stateRoot: tmp, logDirectory: join(tmp, "logs"), webRoot: null, stopStdin: false, rpcPort: 0, shiftPorts: false, allowedOrigins: [], projects: PROJECT_LIMIT_DEFAULTS},
        process: new EventEmitter(),
        writeFatal: () => undefined,
    });
    await server.ready;
});

afterAll(async () => {
    server.requestStop("test:done");
    await server.stopped;
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

describe("浏览器引导接口", () => {
    it("返回协议版本、修订号、清单里有浏览器入口的插件与 RPC 端口；不缓存，不带服务端路径", async () => {
        const response = await fetch(new URL(BROWSER_BOOTSTRAP_PATH, server.url!));
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        const text = await response.text();
        expect(text).not.toContain(tmp);
        const body: unknown = JSON.parse(text);
        expect(Value.Check(BrowserBootstrapSchema, body)).toBe(true);
        const expected = pluginsAt("browser", productPlugins).map(({id, version}) => ({id, version}));
        expect(body).toMatchObject({protocolVersion: BROWSER_PROTOCOL_VERSION, rpc: {port: Number(new URL(server.rpcUrl).port), path: "/"}});
        expect((body as {plugins: unknown[]}).plugins).toEqual(expect.arrayContaining(expected));
        expect((body as {plugins: unknown[]}).plugins).toHaveLength(expected.length);
    });

    it("修订号只随有浏览器入口的插件集合与版本变化，与清单顺序无关", () => {
        const a: PluginDescriptor = {id: "a", version: "1.0.0", locations: ["browser"]};
        const b: PluginDescriptor = {id: "b", version: "1.0.0", locations: ["server", "browser"]};
        const serverOnly: PluginDescriptor = {id: "s", version: "1.0.0", locations: ["server"]};
        const rpc = {port: 4100, path: "/"};
        const revision = browserBootstrap([a, b, serverOnly], rpc).revision;
        expect(browserBootstrap([serverOnly, b, a], rpc).revision).toBe(revision);
        expect(browserBootstrap([a, b], {port: 4200, path: "/"}).revision).toBe(revision);
        expect(browserBootstrap([{...a, version: "1.0.1"}, b], rpc).revision).not.toBe(revision);
        expect(browserBootstrap([a], rpc).revision).not.toBe(revision);
    });

    it("只有顶层声明式贡献的插件也列出（浏览器要登记它的声明），只有服务端入口、没有声明的不列；声明的插件版本变化改变修订号", () => {
        const browser: PluginDescriptor = {id: "a", version: "1.0.0", locations: ["browser"]};
        const declared: PluginDescriptor = {id: "d", version: "1.0.0", locations: ["server"], contributions: [{capability: "settings.properties", id: "d/x", declaration: {}}]};
        const serverOnly: PluginDescriptor = {id: "s", version: "1.0.0", locations: ["server"]};
        const rpc = {port: 4100, path: "/"};
        const body = browserBootstrap([serverOnly, declared, browser], rpc);
        expect(body.plugins).toEqual([{id: "a", version: "1.0.0"}, {id: "d", version: "1.0.0"}]);
        expect(browserBootstrap([serverOnly, {...declared, version: "1.0.1"}, browser], rpc).revision).not.toBe(body.revision);
    });
});
