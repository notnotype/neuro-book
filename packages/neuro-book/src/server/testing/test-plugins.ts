/**
 * 宿主合同测试用的插件：只经 `startServer({plugins})` 注入，产品清单与产品代码不引用它们。
 *
 * - `test.slow`：路由 `GET /wait?ms=` 先发出响应头与 `started\n`，等待给定毫秒后再发 `done` 结束正文；
 *   `GET /hold` 同样先发出响应头，直到测试放手才结束正文。客户端拿到响应头即说明请求已在途，测试据此同步；
 * - `test.fail-activate`：激活时抛错（启动必需插件失败）；给了 `hold` 时等它兑现后再抛；
 * - `test.fail-close`：激活登记一个释放时抛错的资源（关闭步骤失败）；
 * - `test.throw-later`：路由 `GET /throw` 在下一轮事件循环里抛出未捕获异常，`GET /reject` 留下一个未处理的 Promise 拒绝。
 */

import {Hono} from "hono";
import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {HTTP_ROUTES_CONTRIBUTION, HTTP_ROUTES_POINT} from "nbook/plugins/http/server/contracts";
import type {HttpRouteEnv} from "nbook/plugins/http/server/contracts";

export const TEST_PLUGIN_IDS = ["test.slow", "test.fail-activate", "test.fail-close", "test.throw-later"] as const;
export type TestPluginId = typeof TEST_PLUGIN_IDS[number];

/** 先发 `started\n`，`until` 兑现后发 `last` 并结束正文。 */
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

function routePlugin(id: string, app: Hono<{Bindings: HttpRouteEnv}>): PluginDefinition {
    return {
        id,
        entries: [{
            id: "server",
            location: "server",
            activationEvents: ["onStartup"],
            dependencies: [{key: diagnosticsKey}],
            contributions: [{capability: HTTP_ROUTES_POINT, id: HTTP_ROUTES_CONTRIBUTION, declaration: {}}],
            activate: () => ({contributions: {[HTTP_ROUTES_POINT]: {[HTTP_ROUTES_CONTRIBUTION]: app}}}),
        }],
    };
}

export function createTestPlugin(id: TestPluginId, hold?: Promise<void>): PluginDefinition {
    switch (id) {
        case "test.slow":
            return routePlugin(id, new Hono<{Bindings: HttpRouteEnv}>()
                .get("/wait", (c) => startedThen(Bun.sleep(Number(c.req.query("ms") ?? "0")), "done"))
                .get("/hold", () => startedThen(hold ?? Promise.resolve(), "released")));
        case "test.throw-later":
            return routePlugin(id, new Hono<{Bindings: HttpRouteEnv}>()
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
