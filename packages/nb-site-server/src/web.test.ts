/**
 * 发网页（`site.operations` 输出 12）：产品入口 `main.ts` 装着两个真模块起真子进程，`NB_SITE_WEB_DIR` 指向测试自己造的一份小产物。
 * 用真模块是因为“模块的地址先匹配”“身份库下没人接的地址仍 404”要看真实的挂载与兜底路由。
 *
 * 三个进程在 `beforeAll` 里起（各约 300 毫秒，超出快速类的预算；用例只发请求）：设了产物目录的、另设了测试控制口令的、
 * 没设产物目录的。“与没有网页时一样回 404”拿后者的回应逐字比。
 *
 * 路径穿越的几种写法经原始套接字发：`fetch` 在发出之前就按 URL 标准消解了点段与反斜杠，测不到服务端。服务端的 Bun 同样先规范化
 * `request.url`，所以 `/../x` 这类写法到 `web.ts` 时已是 `/x`；能到它那里的越界写法是编码在一段里的分隔符与符号链接。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, rm, symlink, writeFile} from "node:fs/promises";
import {connect} from "node:net";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {MAIN_SCRIPT, startServing, stopAllSiteProcesses, type SiteProcess} from "./testing/process";

const INDEX_HTML = '<!doctype html><html><head><script type="module" src="/assets/app-abc123.js"></script></head><body></body></html>\n';
const APP_JS = "document.title = 'site';\n";
const FAVICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg"/>\n';
/** 产物目录之外、与它同级的文件：任何写法都不许把它发出去。 */
const SECRET = "outside-the-web-dir-5d1c\n";
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
const TOKEN = "web-test-control-token-0123456789abcdef";

let root: string;
let webDir: string;
let web: {readonly site: SiteProcess; readonly url: string};
let withControl: {readonly site: SiteProcess; readonly url: string};
let plain: {readonly site: SiteProcess; readonly url: string};

function env(dataDir: string, extra: Readonly<Record<string, string>> = {}): Record<string, string> {
    return {
        NB_SITE_URL: "https://site.example",
        NB_SITE_TELEMETRY_URL: "https://ingest.example",
        NB_SITE_DATA_DIR: dataDir,
        NB_SITE_PORT: "0",
        NB_SITE_SESSION_SECRET: "SESSION-SECRET-7f3a-0123456789abcdef0123456789",
        NB_SITE_IDENTITY_TERMS_VERSION: "2026-11-20",
        ...extra,
    };
}

beforeAll(async () => {
    root = await createTestTmpRoot("nb-site-web", "nb-site-server web.test.ts");
    webDir = join(root, "web");
    await mkdir(join(webDir, "assets"), {recursive: true});
    await writeFile(join(webDir, "index.html"), INDEX_HTML);
    await writeFile(join(webDir, "assets", "app-abc123.js"), APP_JS);
    await writeFile(join(webDir, "favicon.svg"), FAVICON_SVG);
    await writeFile(join(root, "secret.txt"), SECRET);
    // 产物目录里指向目录外的两种链接：一个文件、一个目录。
    await symlink(join(root, "secret.txt"), join(webDir, "leak.txt"));
    await symlink(root, join(webDir, "outside"));
    const dataDirs = ["data-web", "data-control", "data-plain"].map((name) => join(root, name));
    for (const dir of dataDirs) await mkdir(dir);
    [web, withControl, plain] = await Promise.all([
        startServing({root, script: MAIN_SCRIPT, env: env(dataDirs[0]!, {NB_SITE_WEB_DIR: webDir})}),
        startServing({root, script: MAIN_SCRIPT, env: env(dataDirs[1]!, {NB_SITE_WEB_DIR: webDir, NB_SITE_TEST_CONTROL: TOKEN})}),
        startServing({root, script: MAIN_SCRIPT, env: env(dataDirs[2]!)}),
    ]);
}, 30_000);

afterAll(async () => {
    await stopAllSiteProcesses();
    await rm(root, {recursive: true, force: true});
});

interface Got {
    readonly status: number;
    readonly headers: Headers;
    readonly body: string;
}

async function get(base: string, path: string, init?: RequestInit): Promise<Got> {
    const response = await fetch(`${base}${path.slice(1)}`, {redirect: "manual", ...init});
    return {status: response.status, headers: response.headers, body: await response.text()};
}

/** 经原始套接字发一个 GET，请求目标原样写进请求行；返回状态码与响应体。 */
function rawGet(base: string, target: string): Promise<{status: number; body: string}> {
    const {hostname, port} = new URL(base);
    return new Promise((resolve, reject) => {
        let received = "";
        const socket = connect(Number(port), hostname, () => socket.write(`GET ${target} HTTP/1.1\r\nHost: site.example\r\nConnection: close\r\n\r\n`));
        socket.on("data", (chunk) => (received += chunk.toString("utf8")));
        socket.on("end", () => resolve({status: Number(received.split(" ")[1]), body: received.slice(received.indexOf("\r\n\r\n") + 4)}));
        socket.on("error", reject);
    });
}

/** 这个请求在服务端记下的那一行 `http.request`（按响应头里的请求编号找）。 */
async function requestLine(site: SiteProcess, got: Got): Promise<Readonly<Record<string, unknown>>> {
    const requestId = got.headers.get("X-Request-Id");
    return site.waitForLog(`request line ${String(requestId)}`, (line) => line.event === "http.request" && line.requestId === requestId);
}

describe("文件（输出 12）", () => {
    it("路径对应产物目录里的文件时发这个文件，Content-Type 按扩展名", async () => {
        for (const [path, body, type] of [
            ["/index.html", INDEX_HTML, "text/html"],
            ["/assets/app-abc123.js", APP_JS, "text/javascript"],
            ["/favicon.svg", FAVICON_SVG, "image/svg+xml"],
        ] as const) {
            const got = await get(web.url, path);
            expect({path, status: got.status, body: got.body, type: got.headers.get("Content-Type")?.split(";")[0]}).toEqual({path, status: 200, body, type});
        }
    });

    it("HEAD 只回头部：状态、类型、缓存头与安全头同 GET，没有响应体", async () => {
        const got = await get(web.url, "/assets/app-abc123.js", {method: "HEAD"});
        expect({status: got.status, body: got.body, cache: got.headers.get("Cache-Control"), length: got.headers.get("Content-Length")}).toEqual({
            status: 200,
            body: "",
            cache: "public, max-age=31536000, immutable",
            length: String(Buffer.byteLength(APP_JS)),
        });
        const fallback = await get(web.url, "/account", {method: "HEAD"});
        expect({status: fallback.status, body: fallback.body, csp: fallback.headers.get("Content-Security-Policy")}).toEqual({status: 200, body: "", csp: CSP});
    });

    it("编码在一段里的分隔符、编码过的反斜杠与空字节回 404，不读目录外的文件", async () => {
        for (const target of ["/..%2fsecret.txt", "/assets/..%2f..%2fsecret.txt", "/..%2Fsecret.txt", "/..%5csecret.txt", "/%2e%2e%2fsecret.txt", "/index.html%00.js", "/a%00b"]) {
            const got = await rawGet(web.url, target);
            expect({target, status: got.status, leaked: got.body.includes(SECRET.trim())}).toEqual({target, status: 404, leaked: false});
        }
        // 解码后会落回目录里的写法也回 404：这样的段只能来自编码过的写法，不去推算它落在哪里。
        expect((await rawGet(web.url, "/assets/..%2findex.html")).status).toBe(404);
    });

    it("点段与反斜杠在到达之前已被规范化成目录里的路径：落不到目录外，目录外的文件发不出去", async () => {
        for (const target of ["/../secret.txt", "/assets/../../secret.txt", "/%2e%2e/secret.txt", "/.%2e/secret.txt", "/..\\secret.txt", "/assets\\..\\..\\secret.txt"]) {
            const got = await rawGet(web.url, target);
            expect({target, status: got.status, leaked: got.body.includes(SECRET.trim())}).toEqual({target, status: 404, leaked: false});
        }
    });

    it("符号链接指向目录外时回 404，不论链接的是文件还是目录", async () => {
        // 判断的是解开链接之后的真实路径：`/outside/web/index.html` 解开后就是目录里的 index.html，照常发，这里不列。
        for (const path of ["/leak.txt", "/outside/secret.txt", "/outside/data-web/identity.lock"]) {
            const got = await get(web.url, path);
            expect({path, status: got.status, leaked: got.body.includes(SECRET.trim())}).toEqual({path, status: 404, leaked: false});
        }
        // 链接到目录外的目录，最后一段不带扩展名：也不回退。
        expect((await get(web.url, "/outside")).status).toBe(404);
    });
});

describe("单页回退（输出 12）", () => {
    it("没有对应文件、最后一段不带扩展名的地址回 200 与 index.html 的内容，地址不变", async () => {
        for (const path of ["/", "/login", "/account", "/admin/users", "/privacy", "/assets", "/oauth/consent"]) {
            const got = await get(web.url, path);
            expect({path, status: got.status, body: got.body, type: got.headers.get("Content-Type")?.split(";")[0], location: got.headers.get("Location")}).toEqual({
                path,
                status: 200,
                body: INDEX_HTML,
                type: "text/html",
                location: null,
            });
        }
    });

    it("最后一段带扩展名而没有这个文件的回 404，同样带两个网页头", async () => {
        for (const path of ["/x.js", "/assets/missing-1234.css", "/login.html"]) {
            const got = await get(web.url, path);
            expect({path, status: got.status, nosniff: got.headers.get("X-Content-Type-Options"), referrer: got.headers.get("Referrer-Policy")}).toEqual({
                path,
                status: 404,
                nosniff: "nosniff",
                referrer: "same-origin",
            });
        }
    });

    it("四个前缀下没人接的地址与没有网页时一样回 404：身份库下的未知地址、/.well-known、/health、没设口令的测试控制入口", async () => {
        const paths = [
            "/api",
            "/api/",
            "/api/nope",
            "/api/identity/nope",
            "/api/identity/v1/nope",
            "/api/identity/auth/nope",
            "/api/telemetry/v1/nope",
            "/.well-known",
            "/.well-known/nope",
            "/health",
            "/health/nope",
            "/test-control/clock",
            "/test-control/nope",
        ];
        for (const path of paths) {
            const [withWeb, without] = await Promise.all([get(web.url, path), get(plain.url, path)]);
            expect({path, status: withWeb.status, body: withWeb.body, type: withWeb.headers.get("Content-Type")}).toEqual({
                path,
                status: 404,
                body: without.body,
                type: without.headers.get("Content-Type"),
            });
        }
    });

    it("设了测试控制口令时，测试控制前缀下没人接的 GET 也不回退", async () => {
        for (const path of ["/test-control/clock", "/test-control/nope"]) expect({path, status: (await get(withControl.url, path)).status}).toEqual({path, status: 404});
        // 口令真的生效着：同一个进程上带对口令的拨时间成功。
        const advanced = await fetch(`${withControl.url}test-control/clock`, {method: "POST", headers: {Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json"}, body: JSON.stringify({advanceMs: 1})});
        expect(advanced.status).toBe(200);
    });
});

describe("路由顺序与入口（输出 12）", () => {
    it("健康检查与模块的接口先匹配：照常回它们自己的 JSON", async () => {
        const live = await get(web.url, "/health/live");
        expect({status: live.status, body: JSON.parse(live.body) as unknown}).toEqual({status: 200, body: {status: "live"}});
        const discovery = await get(web.url, "/.well-known/openid-configuration");
        expect({status: discovery.status, type: discovery.headers.get("Content-Type")?.split(";")[0], issuer: typeof (JSON.parse(discovery.body) as {issuer?: unknown}).issuer}).toEqual({
            status: 200,
            type: "application/json",
            issuer: "string",
        });
    });

    it("只收 GET 与 HEAD：别的方法与没有网页时一样回 404", async () => {
        for (const method of ["POST", "PUT", "DELETE"]) {
            const [withWeb, without] = await Promise.all([get(web.url, "/login", {method}), get(plain.url, "/login", {method})]);
            expect({method, status: withWeb.status, body: withWeb.body}).toEqual({method, status: 404, body: without.body});
        }
    });

    it("遥测写入口的主机名上不发网页", async () => {
        for (const path of ["/", "/index.html", "/assets/app-abc123.js"]) {
            const got = await get(web.url, path, {headers: {Host: "ingest.example"}});
            expect({path, status: got.status, body: got.body.includes("<!doctype")}).toEqual({path, status: 404, body: false});
        }
    });

    it("不设前端产物目录时 / 与别的页面地址回 404", async () => {
        for (const path of ["/", "/account", "/index.html"]) expect({path, status: (await get(plain.url, path)).status}).toEqual({path, status: 404});
    });
});

describe("缓存与安全头（输出 12）", () => {
    it("/assets/ 下的文件带一年的 immutable；index.html、回退与别的文件带 no-cache", async () => {
        const cache = async (path: string): Promise<string | null> => (await get(web.url, path)).headers.get("Cache-Control");
        expect(await cache("/assets/app-abc123.js")).toBe("public, max-age=31536000, immutable");
        for (const path of ["/", "/index.html", "/account", "/favicon.svg"]) expect({path, cache: await cache(path)}).toEqual({path, cache: "no-cache"});
    });

    it("回 HTML 时带内容安全策略；所有网页响应带 nosniff 与 same-origin，非 HTML 不带内容安全策略", async () => {
        for (const path of ["/", "/index.html", "/account"]) {
            const got = await get(web.url, path);
            expect({path, csp: got.headers.get("Content-Security-Policy"), nosniff: got.headers.get("X-Content-Type-Options"), referrer: got.headers.get("Referrer-Policy")}).toEqual({
                path,
                csp: CSP,
                nosniff: "nosniff",
                referrer: "same-origin",
            });
        }
        for (const path of ["/assets/app-abc123.js", "/favicon.svg"]) {
            const got = await get(web.url, path);
            expect({path, csp: got.headers.get("Content-Security-Policy"), nosniff: got.headers.get("X-Content-Type-Options"), referrer: got.headers.get("Referrer-Policy")}).toEqual({
                path,
                csp: null,
                nosniff: "nosniff",
                referrer: "same-origin",
            });
        }
    });
});

describe("日志（输出 8、12）", () => {
    it("网页的请求（含回退与网页回的 404）记 module: web；前缀下没人接的照旧记 site 或那个模块", async () => {
        const cases: [string, string][] = [
            ["/", "web"],
            ["/account", "web"],
            ["/x.js", "web"],
            ["/api/nope", "site"],
            ["/api/identity/v1/nope", "identity"],
        ];
        for (const [path, module] of cases) {
            const got = await get(web.url, path);
            const line = await requestLine(web.site, got);
            expect({path, module: line.module, logged: line.path, status: line.status}).toEqual({path, module, logged: path, status: got.status});
        }
        // HEAD 同样一行，方法照实记。
        const head = await get(web.url, "/", {method: "HEAD"});
        expect(await requestLine(web.site, head)).toMatchObject({module: "web", method: "HEAD", status: 200});
        expect(web.site.logs().filter((line) => line.level === "error")).toEqual([]);
    });
});
