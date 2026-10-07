/**
 * 宿主合同测试用的插件：只经 `startServer({plugins})` 注入，产品清单与产品代码不引用它们。
 *
 * - `test.slow`：路由 `GET /hold` 先发出响应头与 `started\n`，测试放手后再发 `released` 结束正文。客户端
 *   拿到响应头即说明请求已在途。同进程测试传入 `hold` 放手；子进程里另开一个回环监听作为放手通道，地址以
 *   `Test control on <地址>` 打印到标准输出，请求它即放手；
 * - `test.fail-activate`：激活时抛错（启动必需插件失败）；给了 `hold` 时等它完成后再抛；
 * - `test.fail-close`：激活登记一个释放时抛错的资源（关闭步骤失败）；
 * - `test.throw-later`：路由 `GET /throw` 在下一轮事件循环里抛出未捕获异常，`GET /reject` 留下一个未处理的 Promise 拒绝；
 * - `test.remote-probe`：提供远程服务 `test.remote-probe/probe`（`src/shared/testing/remote-probe-contract.ts`），
 *   并挂控制路由：`POST /tick` 向全部订阅推一次事件，`POST /release/<name>` 放行同名的 `hold`，`GET /holds`
 *   列出各 `hold` 是否收到终止信号、是否已放行。同进程测试可传入自己的状态对象直接读写。
 */

import {Hono} from "hono";
import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";

import {HTTP_ROUTES_POINT} from "nbook/plugins/http/server/contracts";
import type {HttpRouteEnv} from "nbook/plugins/http/server/contracts";
import {remoteProbeContract} from "nbook/shared/testing/remote-probe-contract";

export const TEST_PLUGIN_IDS = ["test.slow", "test.fail-activate", "test.fail-close", "test.throw-later", "test.remote-probe"] as const;
export type TestPluginId = typeof TEST_PLUGIN_IDS[number];

/** 先发 `started\n`，`until` 完成后发 `last` 并结束正文。 */
function startedThen(until: Promise<unknown>, last: string): Response {
    const encoder = new TextEncoder();
    return new Response(new ReadableStream<Uint8Array>({
        async start(controller) {
            controller.enqueue(encoder.encode("started\n"));
            await until;
            controller.enqueue(encoder.encode(last));
            controller.close();
        },
    }));
}

type RouteApp = Hono<{Bindings: HttpRouteEnv}>;

/** 启动时在 `/api/<id>/` 挂载 `routes` 的插件。 */
export function routePlugin(id: string, routes: (context: ActivationContext) => RouteApp): PluginDefinition {
    return {
        id,
        entries: [{
            id: "server",
            location: "server",
            activationEvents: ["onStartup"],
            dependencies: [{key: diagnosticsKey}],
            contributions: [{capability: HTTP_ROUTES_POINT, id, declaration: {}}],
            activate: (context) => ({contributions: {[HTTP_ROUTES_POINT]: {[id]: routes(context)}}}),
        }],
    };
}

/** `/hold` 的放手信号；没有传入 `hold` 时开放手通道（见文件头）。 */
function releaseSignal(context: ActivationContext, hold: Promise<void> | undefined): Promise<void> {
    if (hold !== undefined) return hold;
    const released = Promise.withResolvers<void>();
    // 放手通道不经 HTTP 准入：排空期间新请求得到 503，测试仍要能放手在途请求。
    const control = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: () => {
            released.resolve();
            return new Response("released");
        },
    });
    // 放手后在途请求结束、插件随即关闭；平缓停止，让放手请求自己的响应先发完。
    context.scope.register({kind: "test-control", label: "release", value: control, release: (server) => server.stop()});
    console.log(`Test control on ${control.url.href}`);
    return released.promise;
}

/** `test.remote-probe` 的可观察状态。 */
export interface RemoteProbeState {
    /** 每个 `hold` 调用：放行它的开关、是否收到终止信号。 */
    readonly holds: Map<string, {readonly release: (value: string) => void; aborted: boolean; released: boolean}>;
    /** 当前活动的订阅。 */
    readonly sinks: Set<(payload: {readonly n: number}) => void>;
    ticks: number;
    /** 插件入口已关闭（它的激活作用域已释放）。 */
    closed: boolean;
}

export function newRemoteProbeState(): RemoteProbeState {
    return {holds: new Map(), sinks: new Set(), ticks: 0, closed: false};
}

/** 推一次事件给全部订阅；返回推给了几个。 */
function tick(state: RemoteProbeState): number {
    state.ticks += 1;
    for (const sink of state.sinks) sink({n: state.ticks});
    return state.sinks.size;
}

export function createRemoteProbePlugin(state: RemoteProbeState = newRemoteProbeState()): PluginDefinition {
    const id = "test.remote-probe";
    return {
        id,
        entries: [{
            id: "server",
            location: "server",
            activationEvents: ["onStartup"],
            dependencies: [{key: diagnosticsKey}],
            remoteProvides: [remoteProbeContract.id],
            contributions: [{capability: HTTP_ROUTES_POINT, id, declaration: {}}],
            activate: (context) => {
                context.scope.register({kind: "test-resource", label: "remote-probe", value: state, release: (probe) => {
                    probe.closed = true;
                }});
                const routes = new Hono<{Bindings: HttpRouteEnv}>()
                    .post("/tick", (c) => c.json({sent: tick(state)}))
                    .post("/release/:name", (c) => {
                        const hold = state.holds.get(c.req.param("name"));
                        hold?.release("released");
                        return c.json({released: hold !== undefined});
                    })
                    .get("/holds", (c) => c.json([...state.holds].map(([name, hold]) => ({name, aborted: hold.aborted, released: hold.released}))));
                const probe = provideRemote(remoteProbeContract, (consumer) => ({
                    methods: {
                        echo: () => ({ok: true, value: {instanceId: consumer.instanceId, location: consumer.location, plugin: consumer.plugin, entry: consumer.entry, generation: consumer.generation}}),
                        hold: async ({name}, {signal}) => {
                            const gate = Promise.withResolvers<string>();
                            const record = {release: gate.resolve, aborted: false, released: false};
                            state.holds.set(name, record);
                            signal.addEventListener("abort", () => {
                                record.aborted = true;
                            }, {once: true});
                            const value = await gate.promise;
                            record.released = true;
                            return {ok: true, value};
                        },
                    },
                    events: {
                        ticks: {
                            subscribe: (_filter, sink, {signal}) => {
                                const next = (payload: {readonly n: number}): void => sink.next(payload);
                                state.sinks.add(next);
                                signal.addEventListener("abort", () => state.sinks.delete(next), {once: true});
                            },
                        },
                    },
                }));
                return {remote: [probe], contributions: {[HTTP_ROUTES_POINT]: {[id]: routes}}};
            },
        }],
    };
}

export function createTestPlugin(id: TestPluginId, hold?: Promise<void>): PluginDefinition {
    switch (id) {
        case "test.remote-probe":
            return createRemoteProbePlugin();
        case "test.slow":
            return routePlugin(id, (context) => {
                const released = releaseSignal(context, hold);
                return new Hono<{Bindings: HttpRouteEnv}>().get("/hold", () => startedThen(released, "released"));
            });
        case "test.throw-later":
            return routePlugin(id, () => new Hono<{Bindings: HttpRouteEnv}>()
                .get("/throw", (c) => {
                    setTimeout(() => {
                        throw new Error("测试注入的未捕获异常");
                    }, 0);
                    return c.text("scheduled");
                })
                .get("/reject", (c) => {
                    void Promise.reject(new Error("测试注入的未处理拒绝"));
                    return c.text("scheduled");
                }));
        case "test.fail-activate":
            return {
                id,
                entries: [{
                    id: "server",
                    location: "server",
                    dependencies: [{key: diagnosticsKey}],
                    activate: async () => {
                        await hold;
                        throw new Error("测试注入的激活失败");
                    },
                }],
            };
        case "test.fail-close":
            return {
                id,
                entries: [{
                    id: "server",
                    location: "server",
                    dependencies: [{key: diagnosticsKey}],
                    activate: (context) => {
                        context.scope.register({
                            kind: "test-resource",
                            label: "fail-close",
                            value: null,
                            release: () => {
                                throw new Error("测试注入的关闭失败");
                            },
                        });
                        return {};
                    },
                }],
            };
    }
}
