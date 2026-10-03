/**
 * 宿主合同测试用的插件：只经 `startServer({plugins})` 注入，产品清单与产品代码不引用它们。
 *
 * - `test.slow`：路由 `GET /hold` 先发出响应头与 `started\n`，测试放手后再发 `released` 结束正文。客户端
 *   拿到响应头即说明请求已在途。同进程测试传入 `hold` 放手；子进程里另开一个回环监听作为放手通道，地址以
 *   `Test control on <地址>` 打印到标准输出，请求它即放手；
 * - `test.fail-activate`：激活时抛错（启动必需插件失败）；给了 `hold` 时等它完成后再抛；
 * - `test.fail-close`：激活登记一个释放时抛错的资源（关闭步骤失败）；
 * - `test.throw-later`：路由 `GET /throw` 在下一轮事件循环里抛出未捕获异常，`GET /reject` 留下一个未处理的 Promise 拒绝。
 */

import {Hono} from "hono";
import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {HTTP_ROUTES_CONTRIBUTION, HTTP_ROUTES_POINT} from "nbook/plugins/http/server/contracts";
import type {HttpRouteEnv} from "nbook/plugins/http/server/contracts";

export const TEST_PLUGIN_IDS = ["test.slow", "test.fail-activate", "test.fail-close", "test.throw-later"] as const;
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

function routePlugin(id: string, routes: (context: ActivationContext) => RouteApp): PluginDefinition {
    return {
        id,
        entries: [{
            id: "server",
            location: "server",
            activationEvents: ["onStartup"],
            dependencies: [{key: diagnosticsKey}],
            contributions: [{capability: HTTP_ROUTES_POINT, id: HTTP_ROUTES_CONTRIBUTION, declaration: {}}],
            activate: (context) => ({contributions: {[HTTP_ROUTES_POINT]: {[HTTP_ROUTES_CONTRIBUTION]: routes(context)}}}),
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

export function createTestPlugin(id: TestPluginId, hold?: Promise<void>): PluginDefinition {
    switch (id) {
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
