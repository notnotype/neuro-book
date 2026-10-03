/**
 * 宿主合同测试用的插件：只经 `startServer({plugins})` 注入，产品清单与产品代码不引用它们。
 *
 * - `test.slow`：路由 `GET /wait?ms=` 等待给定毫秒后返回 `done`，`GET /hold` 直到测试放手才返回；
 * - `test.fail-activate`：激活即抛错（启动必需插件失败）；
 * - `test.fail-close`：激活登记一个释放时抛错的资源（关闭步骤失败）；
 * - `test.throw-later`：路由 `GET /throw` 在下一轮事件循环里抛出未捕获异常。
 */

import {Hono} from "hono";
import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {HTTP_ROUTES_CONTRIBUTION, HTTP_ROUTES_POINT} from "nbook/plugins/http/server/contracts";
import type {HttpRouteEnv} from "nbook/plugins/http/server/contracts";

export const TEST_PLUGIN_IDS = ["test.slow", "test.fail-activate", "test.fail-close", "test.throw-later"] as const;
export type TestPluginId = typeof TEST_PLUGIN_IDS[number];

/** `/hold` 请求的放手开关；只在同一进程内的测试里使用。 */
export interface HoldControl {
    release(): void;
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
                .get("/wait", async (c) => {
                    await Bun.sleep(Number(c.req.query("ms") ?? "0"));
                    return c.text("done");
                })
                .get("/hold", async (c) => {
                    await hold;
                    return c.text("released");
                }));
        case "test.throw-later":
            return routePlugin(id, new Hono<{Bindings: HttpRouteEnv}>().get("/throw", (c) => {
                setTimeout(() => {
                    throw new Error("测试注入的未捕获异常");
                }, 0);
                return c.text("scheduled");
            }));
        case "test.fail-activate":
            return {
                id,
                entries: [{
                    id: "server",
                    location: "server",
                    dependencies: [{key: diagnosticsKey}],
                    activate: () => {
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
