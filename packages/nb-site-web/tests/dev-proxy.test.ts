/**
 * 开发服务的接口转发（`build/dev-proxy.ts`）：起一个真的 Vite 开发服务，用 `devApiProxy` 给出的转发配置，把请求转给一个回显请求头的
 * 假进程，看到了那边的 `Origin` 与 `Host` 是什么样。没设 `NB_SITE_DEV_API` 时没有转发配置，设错时起不来。浏览器里 `__Host-` Cookie
 * 能不能在 `http://localhost` 上存下，是 B10 用真进程与 Chrome 量的，写在 `build/dev-proxy.ts` 的文件头，这里不重复。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {createServer as createHttpServer, type Server} from "node:http";
import type {AddressInfo} from "node:net";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {createServer as createViteServer, type ViteDevServer} from "vite";

import {devApiProxy} from "../build/dev-proxy";

const SITE_URL = "https://site.test";

let root: string;
let upstream: Server;
let vite: ViteDevServer;
let viteUrl: string;

beforeAll(async () => {
    root = await createTestTmpRoot("nb-site-web-dev-proxy", "nb-site-web dev proxy");
    // 假进程：把收到的方法、路径与几项请求头原样回成 JSON。
    upstream = createHttpServer((request, response) => {
        response.writeHead(200, {"content-type": "application/json"});
        response.end(JSON.stringify({method: request.method, path: request.url, origin: request.headers.origin ?? null, host: request.headers.host ?? null}));
    });
    await new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done));
    const api = `http://127.0.0.1:${String((upstream.address() as AddressInfo).port)}`;
    vite = await createViteServer({
        configFile: false,
        root,
        logLevel: "silent",
        server: {host: "127.0.0.1", port: 0, strictPort: false, proxy: devApiProxy({NB_SITE_DEV_API: api, NB_SITE_URL: SITE_URL})},
    });
    await vite.listen();
    viteUrl = `http://127.0.0.1:${String((vite.httpServer!.address() as AddressInfo).port)}`;
}, 30_000);

afterAll(async () => {
    await vite?.close();
    await new Promise<void>((done) => (upstream === undefined ? done() : upstream.close(() => done())));
    if (root !== undefined) await rm(root, {recursive: true, force: true});
});

describe("开发服务的接口转发", () => {
    it("带 Origin 的写请求转过去时 Origin 换成站点地址，Host 不改", async () => {
        const response = await fetch(`${viteUrl}/api/identity/v1/login`, {method: "POST", headers: {Origin: "http://localhost:5173", "Content-Type": "application/json"}, body: "{}"});
        expect(await response.json()).toEqual({method: "POST", path: "/api/identity/v1/login", origin: SITE_URL, host: new URL(viteUrl).host});
    });

    it("没带 Origin 的请求不加；/.well-known 也转", async () => {
        const response = await fetch(`${viteUrl}/.well-known/openid-configuration`);
        expect(await response.json()).toEqual({method: "GET", path: "/.well-known/openid-configuration", origin: null, host: new URL(viteUrl).host});
    });

    it("别的路径不转，由开发服务自己回（前缀相同的页面路径也不转）", async () => {
        const response = await fetch(`${viteUrl}/apis-are-not-proxied`);
        expect(response.headers.get("content-type") ?? "").not.toContain("application/json");
    });

    it("没设 NB_SITE_DEV_API 时没有转发；设了却不是 http(s) 地址或没有 NB_SITE_URL 时抛错", () => {
        expect(devApiProxy({})).toBeUndefined();
        expect(devApiProxy({NB_SITE_DEV_API: "  ", NB_SITE_URL: SITE_URL})).toBeUndefined();
        expect(() => devApiProxy({NB_SITE_DEV_API: "http://127.0.0.1:4310"})).toThrow("NB_SITE_URL must be set");
        expect(() => devApiProxy({NB_SITE_DEV_API: "127.0.0.1:4310", NB_SITE_URL: SITE_URL})).toThrow("NB_SITE_DEV_API");
        expect(() => devApiProxy({NB_SITE_DEV_API: "http://127.0.0.1:4310", NB_SITE_URL: "ftp://site.test"})).toThrow("NB_SITE_URL must be an http or https URL");
    });
});
