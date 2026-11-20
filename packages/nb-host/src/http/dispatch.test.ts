import {afterAll, describe, expect, it} from "bun:test";
import {rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {Hono} from "hono";
import {HTTPException} from "hono/http-exception";

import {PluginStateError} from "@notnotype/nb-runtime/plugins";
import type {ContributionDescriptor, ContributionHandle} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {HttpAdmission} from "./admission";
import {HTTP_ROUTES_POINT, rethrowRouteError} from "../shared/http-contracts";
import type {HttpRouteEnv, HttpRouteHandler} from "../shared/http-contracts";
import {createDispatcher, RouteTable, validateRouteContribution} from "./dispatch";
import {openStaticFiles} from "./static";
import type {StaticFiles} from "./static";

const tmpRoots: string[] = [];

afterAll(async () => {
    for (const root of tmpRoots) await rm(root, {recursive: true, force: true});
});

/** 模拟内核交给接收者的句柄：撤回后 implementation() 抛 PluginStateError。 */
function routeHandle(plugin: string, handler: HttpRouteHandler): ContributionHandle<unknown, HttpRouteHandler> & {revoke(): void} {
    let published = true;
    return {
        capability: HTTP_ROUTES_POINT,
        id: plugin,
        plugin,
        entry: "server",
        generation: 1,
        kind: "entry",
        declaration: undefined,
        get published() {
            return published;
        },
        implementation() {
            if (!published) throw new PluginStateError({plugin, entry: "server", generation: 1, reason: "revoked"});
            return handler;
        },
        revoke() {
            published = false;
        },
    };
}

function mount(routes: RouteTable, handle: ContributionHandle<unknown, HttpRouteHandler>): void {
    routes.receiver().published!(handle, undefined);
}

/** 允许的来源：与产品里一样，回环来源之一。 */
const PAGE_ORIGIN = "http://127.0.0.1:3100";

function setup(staticFiles: StaticFiles | null = null) {
    const admission = new HttpAdmission({productName: "Acme"});
    admission.ready();
    const routes = new RouteTable();
    const errors: Array<{error: unknown; plugin: string | null; clientGone: boolean}> = [];
    const hostRoutes = new Hono<{Bindings: HttpRouteEnv}>().get("/health", (c) => c.json({status: "ok"}));
    const dispatch = createDispatcher({admission, routes, hostRoutes, staticFiles, reportError: (error, {plugin, clientGone}) => errors.push({error, plugin, clientGone}), allowOrigin: (origin) => origin === PAGE_ORIGIN});
    const request = (path: string, init?: RequestInit, host = "127.0.0.1") => dispatch(new Request(`http://${host}${path}`, init));
    return {admission, routes, errors, request, dispatch};
}

describe("http.routes 贡献校验", () => {
    const descriptor = (overrides: Partial<ContributionDescriptor>): ContributionDescriptor => ({
        capability: HTTP_ROUTES_POINT,
        id: "acme.files",
        declaration: undefined,
        plugin: "acme.files",
        entry: "server",
        location: "server",
        ...overrides,
    });

    it("只接受后端入口、id 为插件 id、且不占用宿主前缀的贡献", () => {
        expect(validateRouteContribution(descriptor({}))).toBeNull();
        expect(validateRouteContribution(descriptor({id: "api"}))).not.toBeNull();
        expect(validateRouteContribution(descriptor({id: "runtime", plugin: "runtime"}))).not.toBeNull();
        expect(validateRouteContribution(descriptor({location: "browser"}))).not.toBeNull();
    });
});

describe("请求分发", () => {
    it("宿主接口与插件路由按前缀分发，插件收到去掉前缀的路径并保留查询串与方法", async () => {
        const {routes, request} = setup();
        mount(routes, routeHandle("acme.files", new Hono().all("*", (c) => c.json({method: c.req.method, path: c.req.path, q: c.req.query("q")}))));

        expect(await (await request("/api/runtime/health")).json()).toEqual({status: "ok"});
        const response = await request("/api/acme.files/tree/a?q=1", {method: "POST", body: "x"});
        expect(await response.json()).toEqual({method: "POST", path: "/tree/a", q: "1"});
        expect(await (await request("/api/acme.files")).json()).toMatchObject({path: "/"});
    });

    it("未挂载的插件、非 /api 路径与非法编码都是 404", async () => {
        const {request, admission} = setup();
        for (const path of ["/api/acme.missing/x", "/index.html", "/api/%E0%A4%A/x"]) {
            const response = await request(path);
            expect(response.status).toBe(404);
            expect(await response.json()).toMatchObject({error: {code: "not-found"}});
        }
        expect(admission.active).toBe(0);
    });

    it("撤回后请求得到 503，摘下后是 404", async () => {
        const {routes, request} = setup();
        const handle = routeHandle("acme.files", new Hono().get("/", (c) => c.text("ok")));
        mount(routes, handle);

        handle.revoke();
        const unavailable = await request("/api/acme.files/");
        expect(unavailable.status).toBe(503);
        expect(await unavailable.json()).toMatchObject({error: {code: "plugin-unavailable"}});

        await routes.receiver().revoke!(handle, undefined, "scope-closed");
        expect((await request("/api/acme.files/")).status).toBe(404);
    });

    it("处理器抛错返回 500 并报告错误，在途计数归还", async () => {
        const {routes, request, errors, admission} = setup();
        const failure = new Error("boom");
        mount(routes, routeHandle("acme.broken", {fetch: () => { throw failure; }}));
        const response = await request("/api/acme.broken/x");
        expect(response.status).toBe(500);
        expect(errors).toEqual([{error: failure, plugin: "acme.broken", clientGone: false}]);
        expect(admission.active).toBe(0);
    });

    describe("Hono 写的路由", () => {
        const failure = new Error("boom");
        const app = new Hono<{Bindings: HttpRouteEnv}>().onError(rethrowRouteError)
            .get("/sync", () => { throw failure; })
            .get("/async", async () => { await Promise.resolve(); throw failure; })
            .use("/chained", async (_c, next) => { await next(); })
            .get("/chained", () => { throw failure; })
            .get("/refused", () => { throw new HTTPException(418, {message: "refused"}); });

        for (const path of ["/sync", "/async", "/chained"]) {
            it(`${path} 抛错：回 JSON 的 internal-error 并进诊断，在途计数归还`, async () => {
                const {routes, request, errors, admission} = setup();
                mount(routes, routeHandle("acme.broken", app));
                const response = await request(`/api/acme.broken${path}`);
                expect(response.status).toBe(500);
                expect(await response.json()).toEqual({error: {code: "internal-error", message: "处理请求时出错。"}});
                expect(errors).toEqual([{error: failure, plugin: "acme.broken", clientGone: false}]);
                expect(admission.active).toBe(0);
            });
        }

        it("HTTPException 是给客户端的响应：状态码照旧，不进诊断", async () => {
            const {routes, request, errors} = setup();
            mount(routes, routeHandle("acme.broken", app));
            const response = await request("/api/acme.broken/refused");
            expect(response.status).toBe(418);
            expect(await response.text()).toBe("refused");
            expect(errors).toEqual([]);
        });

        it("客户端上传到一半断开：读请求体失败算断开，不算出错", async () => {
            const {routes, dispatch, errors, admission} = setup();
            const reading = Promise.withResolvers<void>();
            const finished = Promise.withResolvers<void>();
            mount(routes, routeHandle("acme.broken", new Hono<{Bindings: HttpRouteEnv}>().onError(rethrowRouteError).put("/upload", async (c) => {
                reading.resolve();
                try {
                    return c.json({size: (await c.req.arrayBuffer()).byteLength});
                } finally {
                    finished.resolve();
                }
            })));
            const server = Bun.serve({port: 0, hostname: "127.0.0.1", idleTimeout: 0, fetch: dispatch});
            try {
                const socket = await Bun.connect({hostname: "127.0.0.1", port: server.port as number, socket: {data() {}}});
                socket.write(`PUT /api/acme.broken/upload HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 1000000\r\n\r\npartial`);
                await reading.promise;
                socket.end();
                await finished.promise;
                await waitUntil("上传失败已报告", () => errors.length > 0);
                expect(errors).toEqual([{error: expect.anything(), plugin: "acme.broken", clientGone: true}]);
                await waitUntil("在途计数归还", () => admission.active === 0);
            } finally {
                await server.stop(true);
            }
        });
    });

    it("流式响应在正文读完前计入在途，读完后归还；排空在那之前不结算", async () => {
        const {routes, request, admission} = setup();
        const chunks = Promise.withResolvers<void>();
        mount(routes, routeHandle("acme.slow", {
            fetch: () => new Response(new ReadableStream({
                async start(controller) {
                    controller.enqueue(new TextEncoder().encode("a"));
                    await chunks.promise;
                    controller.enqueue(new TextEncoder().encode("b"));
                    controller.close();
                },
            })),
        }));
        const response = await request("/api/acme.slow/");
        expect(admission.active).toBe(1);
        let drained = false;
        const draining = admission.drain().then(() => {
            drained = true;
        });
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        // 第一段已读出、第二段还没给：正文停在中途，排空不能结算。
        expect(decoder.decode((await reader.read()).value)).toBe("a");
        expect(drained).toBe(false);
        chunks.resolve();
        expect(decoder.decode((await reader.read()).value)).toBe("b");
        expect((await reader.read()).done).toBe(true);
        await draining;
        expect(admission.active).toBe(0);
    });

    it("客户端在处理器返回前取消：处理器返回前仍计入在途，返回后即使正文没人读也归还", async () => {
        const {routes, request, admission} = setup();
        const entered = Promise.withResolvers<void>();
        const finish = Promise.withResolvers<void>();
        mount(routes, routeHandle("acme.slow", {
            fetch: async () => {
                entered.resolve();
                await finish.promise;
                // 不会结束的正文：只靠取消信号归还。
                return new Response(new ReadableStream({start: (controller) => controller.enqueue(new TextEncoder().encode("a"))}));
            },
        }));
        const client = new AbortController();
        const response = request("/api/acme.slow/", {signal: client.signal});
        await entered.promise;
        client.abort();
        expect(admission.active).toBe(1);
        finish.resolve();
        await response;
        expect(admission.active).toBe(0);
    });

    it("登记为事件流的请求不计入排空等待，排空时执行它的关闭动作", async () => {
        const {routes, request, admission} = setup();
        let closed = false;
        mount(routes, routeHandle("acme.events", {
            fetch: (_request, env) => {
                const stream = new TransformStream<Uint8Array, Uint8Array>();
                env.registerEventStream(() => {
                    closed = true;
                    return stream.writable.close();
                });
                return new Response(stream.readable, {headers: {"content-type": "text/event-stream"}});
            },
        }));
        const response = await request("/api/acme.events/");
        expect(admission.active).toBe(0);
        await admission.drain();
        expect(closed).toBe(true);
        expect(await response.text()).toBe("");
    });

    it("页面路径交给前端构建产物并同样经过准入；/api 命名空间里没匹配上的路径（含编码写法）不回退到页面", async () => {
        const root = await createTestTmpRoot("nb-host-dispatch", "static-dispatch");
        tmpRoots.push(root);
        await writeFile(join(root, "index.html"), "shell");
        const {request, admission} = setup(await openStaticFiles(root));
        expect(await (await request("/workbench")).text()).toBe("shell");
        for (const path of ["/api", "/api/", "/%61pi", "/%61pi/runtime/health"]) expect((await request(path)).status).toBe(404);
        expect(admission.active).toBe(0);

        await admission.drain();
        const stopping = await request("/");
        expect(stopping.status).toBe(503);
        expect(await stopping.json()).toMatchObject({error: {code: "stopping"}});
    });

    it("排空期间的新请求得到 503 stopping", async () => {
        const {request, admission} = setup();
        await admission.drain();
        const response = await request("/api/runtime/health");
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({error: {code: "stopping"}});
    });

    it("主机名不是回环名、或没有主机名的请求一律 421，三个回环名照常", async () => {
        const {request, routes, admission, dispatch} = setup();
        mount(routes, routeHandle("acme.files", new Hono().all("*", (c) => c.text("ok"))));
        for (const host of ["evil.example:3100", "192.168.1.5:3100", "localhost.evil.example"]) {
            const response = await request("/api/acme.files/raw", undefined, host);
            expect(response.status).toBe(421);
            expect(await response.json()).toMatchObject({error: {code: "misdirected-host"}});
        }
        for (const host of ["127.0.0.1:3100", "localhost:3100", "[::1]:3100"]) expect(await (await request("/api/runtime/health", undefined, host)).json()).toEqual({status: "ok"});
        // 不带 Host 的 HTTP/1.0 请求：Bun 1.4 交来的 `request.url` 是相对地址（`new Request` 造不出这种请求，按 Bun 交来的形状写）。
        const hostless = {url: "/api/runtime/health", method: "GET", headers: new Headers()} as unknown as Request;
        expect((await dispatch(hostless)).status).toBe(421);
        expect(admission.active).toBe(0);
    });

    it("写请求带了不允许的来源（含 null）是 403；允许的来源、不带来源的写请求与任何来源的读请求照常", async () => {
        const {request, routes} = setup();
        mount(routes, routeHandle("acme.files", new Hono().all("*", (c) => c.text(c.req.method))));
        for (const origin of ["null", "http://evil.example", "http://127.0.0.1:9999"]) {
            const response = await request("/api/acme.files/x", {method: "POST", body: "x", headers: {origin}});
            expect(response.status).toBe(403);
            expect(await response.json()).toMatchObject({error: {code: "origin-not-allowed"}});
        }
        expect(await (await request("/api/acme.files/x", {method: "POST", body: "x", headers: {origin: PAGE_ORIGIN}})).text()).toBe("POST");
        expect(await (await request("/api/acme.files/x", {method: "PUT", body: "x"})).text()).toBe("PUT");
        expect(await (await request("/api/acme.files/x", {headers: {origin: "null"}})).text()).toBe("GET");
    });
});

describe("请求体的转交", () => {
    /** 真实的 `Bun.serve`，处理函数是分发器：和宿主 HTTP 端口同一条路径。 */
    function serve(setupRoutes: (routes: RouteTable) => void) {
        const {routes, dispatch, errors} = setup();
        setupRoutes(routes);
        const server = Bun.serve({port: 0, hostname: "127.0.0.1", idleTimeout: 0, fetch: dispatch});
        return {url: `http://127.0.0.1:${String(server.port)}`, errors, stop: () => server.stop(true)};
    }

    it("上传边发边收：处理函数在客户端还没发完时已经读到前面的块（不先把整个请求体收进内存）", async () => {
        let firstSeen!: () => void;
        const seen = new Promise<void>((resolve) => (firstSeen = resolve));
        const received: number[] = [];
        const {url, stop} = serve((routes) => mount(routes, routeHandle("acme.files", {
            fetch: async (request) => {
                const reader = request.body!.getReader();
                for (;;) {
                    const {done, value} = await reader.read();
                    if (done) break;
                    received.push(value.length);
                    firstSeen();
                }
                return Response.json({received: received.reduce((sum, size) => sum + size, 0)});
            },
        })));
        try {
            let release!: () => void;
            const gate = new Promise<void>((resolve) => (release = resolve));
            const chunk = new Uint8Array(64 * 1024);
            const body = new ReadableStream<Uint8Array>({
                async start(controller) {
                    controller.enqueue(chunk);
                    // 第二块要等处理函数确认读到了第一块；整体缓冲的转交永远等不到它。
                    // test-lint-allow fixed-wait: 5 秒是判定上限，到点还没读到第一块就判失败；正常时 seen 先完成
                    await Promise.race([seen, new Promise((_, reject) => setTimeout(() => reject(new Error("处理函数没有在请求体发完之前读到数据")), 5_000))]);
                    release();
                    controller.enqueue(chunk);
                    controller.close();
                },
            });
            const response = await fetch(`${url}/api/acme.files/upload`, {method: "POST", body, duplex: "half"} as RequestInit);
            await gate;
            expect(await response.json()).toEqual({received: 2 * chunk.length});
        } finally {
            await stop();
        }
    });

    it("慢慢读一个大请求体：进程内存的增长远小于请求体（转交不把整个请求体收进内存）", async () => {
        const totalMiB = 112;
        const {url, stop} = serve((routes) => mount(routes, routeHandle("acme.files", {
            fetch: async (request) => {
                const reader = request.body!.getReader();
                let size = 0;
                for (;;) {
                    const {done, value} = await reader.read();
                    if (done) break;
                    size += value.length;
                    // 读得比客户端发得慢：整个请求体若被另一条分支缓存下来，内存会随已读的量一路涨。
                    await Bun.sleep(2); // test-lint-allow fixed-wait: 读得慢是被测条件（制造背压），不是在等某个状态
                }
                return Response.json({size});
            },
        })));
        try {
            Bun.gc(true);
            const base = process.memoryUsage().rss;
            let peak = 0;
            const sampler = setInterval(() => void (peak = Math.max(peak, process.memoryUsage().rss - base)), 20);
            const chunk = new Uint8Array(1024 * 1024);
            let produced = 0;
            const body = new ReadableStream<Uint8Array>({
                pull(controller) {
                    produced += 1;
                    controller.enqueue(chunk);
                    if (produced === totalMiB) controller.close();
                },
            }, {highWaterMark: 0});
            const response = await fetch(`${url}/api/acme.files/upload`, {method: "POST", body, duplex: "half"} as RequestInit);
            clearInterval(sampler);
            expect(await response.json()).toEqual({size: totalMiB * chunk.length});
            // 流式转交时本机实测增长约 35 MiB，整个请求体被缓存时约 100 MiB。
            expect(peak / 1024 / 1024).toBeLessThan(70);
        } finally {
            await stop();
        }
    });

    it("客户端中途断开：处理函数读请求体的流以中止结束，不一直挂着", async () => {
        let outcome: Promise<string> | null = null;
        const {url, stop} = serve((routes) => mount(routes, routeHandle("acme.files", {
            fetch: (request) => {
                outcome = (async () => {
                    const reader = request.body!.getReader();
                    try {
                        for (;;) if ((await reader.read()).done) return "done";
                    } catch {
                        return "aborted";
                    }
                })();
                return new Promise<Response>(() => undefined);
            },
        })));
        try {
            const controller = new AbortController();
            const body = new ReadableStream<Uint8Array>({
                start(stream) {
                    stream.enqueue(new Uint8Array(1024));
                },
            });
            const pending = fetch(`${url}/api/acme.files/upload`, {method: "POST", body, duplex: "half", signal: controller.signal} as RequestInit).catch(() => undefined);
            await waitUntil("处理函数开始读请求体", () => outcome !== null);
            controller.abort();
            await pending;
            // test-lint-allow fixed-wait: 5 秒是“读请求体的循环没有结束”的判定上限；正常时 outcome 先完成
            expect(await Promise.race([outcome!,new Promise<string>((resolve) => setTimeout(() => resolve("still reading"), 5_000))])).toBe("aborted");
        } finally {
            await stop();
        }
    });
});
