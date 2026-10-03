import {describe, expect, it} from "bun:test";
import {Hono} from "hono";

import {PluginStateError} from "@notnotype/nb-runtime/plugins";
import type {ContributionDescriptor, ContributionHandle} from "@notnotype/nb-runtime/plugins";

import {HttpAdmission} from "./admission";
import {HTTP_ROUTES_CONTRIBUTION, HTTP_ROUTES_POINT} from "./contracts";
import type {HttpRouteEnv, HttpRouteHandler} from "./contracts";
import {createDispatcher, RouteTable, validateRouteContribution} from "./dispatch";

/** 模拟内核交给接收者的句柄：撤回后 implementation() 抛 PluginStateError。 */
function routeHandle(plugin: string, handler: HttpRouteHandler): ContributionHandle<unknown, HttpRouteHandler> & {revoke(): void} {
    let published = true;
    return {
        capability: HTTP_ROUTES_POINT,
        id: HTTP_ROUTES_CONTRIBUTION,
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

async function mount(routes: RouteTable, handle: ContributionHandle<unknown, HttpRouteHandler>): Promise<void> {
    const receiver = routes.receiver();
    const prepared = await receiver.prepare!(handle);
    await receiver.commit!(handle, prepared);
}

function setup() {
    const admission = new HttpAdmission();
    admission.ready();
    const routes = new RouteTable();
    const errors: Array<{error: unknown; plugin: string | null}> = [];
    const hostRoutes = new Hono<{Bindings: HttpRouteEnv}>().get("/health", (c) => c.json({status: "ok"}));
    const dispatch = createDispatcher({admission, routes, hostRoutes, reportError: (error, {plugin}) => errors.push({error, plugin})});
    const request = (path: string, init?: RequestInit) => dispatch(new Request(`http://127.0.0.1${path}`, init));
    return {admission, routes, errors, request};
}

describe("http.routes 贡献校验", () => {
    const descriptor = (overrides: Partial<ContributionDescriptor>): ContributionDescriptor => ({
        capability: HTTP_ROUTES_POINT,
        id: HTTP_ROUTES_CONTRIBUTION,
        declaration: undefined,
        plugin: "nbook.files",
        entry: "server",
        location: "server",
        ...overrides,
    });

    it("只接受后端入口、id 为 api、且不占用宿主前缀的贡献", () => {
        expect(validateRouteContribution(descriptor({}))).toBeNull();
        expect(validateRouteContribution(descriptor({id: "other"}))).not.toBeNull();
        expect(validateRouteContribution(descriptor({plugin: "runtime"}))).not.toBeNull();
        expect(validateRouteContribution(descriptor({location: "browser"}))).not.toBeNull();
    });
});

describe("请求分发", () => {
    it("宿主接口与插件路由按前缀分发，插件收到去掉前缀的路径并保留查询串与方法", async () => {
        const {routes, request} = setup();
        await mount(routes, routeHandle("nbook.files", new Hono().all("*", (c) => c.json({method: c.req.method, path: c.req.path, q: c.req.query("q")}))));

        expect(await (await request("/api/runtime/health")).json()).toEqual({status: "ok"});
        const response = await request("/api/nbook.files/tree/a?q=1", {method: "POST", body: "x"});
        expect(await response.json()).toEqual({method: "POST", path: "/tree/a", q: "1"});
        expect(await (await request("/api/nbook.files")).json()).toMatchObject({path: "/"});
    });

    it("未挂载的插件、非 /api 路径与非法编码都是 404", async () => {
        const {request, admission} = setup();
        for (const path of ["/api/nbook.missing/x", "/index.html", "/api/%E0%A4%A/x"]) {
            const response = await request(path);
            expect(response.status).toBe(404);
            expect(await response.json()).toMatchObject({error: {code: "not-found"}});
        }
        expect(admission.active).toBe(0);
    });

    it("同一插件第二次挂载被拒绝；撤回后请求得到 503，摘下后是 404", async () => {
        const {routes, request} = setup();
        const handle = routeHandle("nbook.files", new Hono().get("/", (c) => c.text("ok")));
        await mount(routes, handle);
        await expect(mount(routes, routeHandle("nbook.files", new Hono()))).rejects.toThrow();

        handle.revoke();
        const unavailable = await request("/api/nbook.files/");
        expect(unavailable.status).toBe(503);
        expect(await unavailable.json()).toMatchObject({error: {code: "plugin-unavailable"}});

        await routes.receiver().revoke!(handle, "nbook.files", "scope-closed");
        expect((await request("/api/nbook.files/")).status).toBe(404);
    });

    it("处理器抛错返回 500 并报告错误，在途计数归还", async () => {
        const {routes, request, errors, admission} = setup();
        const failure = new Error("boom");
        await mount(routes, routeHandle("nbook.broken", {fetch: () => { throw failure; }}));
        const response = await request("/api/nbook.broken/x");
        expect(response.status).toBe(500);
        expect(errors).toEqual([{error: failure, plugin: "nbook.broken"}]);
        expect(admission.active).toBe(0);
    });

    it("流式响应在正文读完前计入在途，读完后归还；排空在那之前不结算", async () => {
        const {routes, request, admission} = setup();
        const chunks = Promise.withResolvers<void>();
        await mount(routes, routeHandle("nbook.slow", {
            fetch: () => new Response(new ReadableStream({
                async start(controller) {
                    controller.enqueue(new TextEncoder().encode("a"));
                    await chunks.promise;
                    controller.enqueue(new TextEncoder().encode("b"));
                    controller.close();
                },
            })),
        }));
        const response = await request("/api/nbook.slow/");
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
        await mount(routes, routeHandle("nbook.slow", {
            fetch: async () => {
                entered.resolve();
                await finish.promise;
                // 不会结束的正文：只靠取消信号归还。
                return new Response(new ReadableStream({start: (controller) => controller.enqueue(new TextEncoder().encode("a"))}));
            },
        }));
        const client = new AbortController();
        const response = request("/api/nbook.slow/", {signal: client.signal});
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
        await mount(routes, routeHandle("nbook.events", {
            fetch: (_request, env) => {
                const stream = new TransformStream<Uint8Array, Uint8Array>();
                env.registerEventStream(() => {
                    closed = true;
                    return stream.writable.close();
                });
                return new Response(stream.readable, {headers: {"content-type": "text/event-stream"}});
            },
        }));
        const response = await request("/api/nbook.events/");
        expect(admission.active).toBe(0);
        await admission.drain();
        expect(closed).toBe(true);
        expect(await response.text()).toBe("");
    });

    it("排空期间的新请求得到 503 stopping", async () => {
        const {request, admission} = setup();
        await admission.drain();
        const response = await request("/api/runtime/health");
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({error: {code: "stopping"}});
    });
});
