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
 *   列出各 `hold` 是否收到终止信号、是否已放行，`POST /project/<id>/echo` 不取租约调用该项目的探针（核对宽限期中
 *   不唤醒项目）。`GET /storage/<记录>` 与 `POST /storage/<记录>`（正文 `{text, expect}`）以本插件的身份直用
 *   Storage 读写探针示例记录（`src/shared/testing/probe-storage.ts`）；`/project/<id>/storage/<记录>` 同样两种方法，
 *   转给该项目的探针，由项目入口直用 Storage。`GET /commands/<窗口实例 id>` 与 `POST /commands/<窗口实例 id>/<命令 id>`
 *   经 `nbook.commands/remote` 列出与执行那个窗口里的命令。入口关闭时打印一行。同进程测试可传入自己的状态对象直接读写。项目入口见
 *   `src/project/testing/probe-plugin.ts`。
 * - `test.tasks-probe`：后台任务的发起方（docs/specs/workbench/background-tasks.md 的 e2e）。依赖 `nbook.tasks/tasks`，挂控制路由：
 *   `POST /start`（正文 `{title, message?, progress?, cancellable?, retry?}`，交回 `{id}`；`retry: true` 时重试另开一件同名任务）、
 *   `POST /<id>/report|succeed|fail|cancelled`（正文分别是句柄方法的参数）、`GET /<id>/signal`（`{aborted, reason}`）、
 *   `GET /last`（最近一次登记的任务 id，含重试登记的）。也作提供方（输出 18–26）：`POST /provide`（正文 `{rows}`，登记成提供方并交出这些行）、
 *   `POST /rows`（正文 `{rows}`，换掉交出的行并通知）、`POST /stop-answer`（正文是之后 `stop` 交回的结果）、`GET /stops`（收到过的
 *   `stop` 的行 id）。
 */

import {Hono} from "hono";
import {HTTP_ROUTES_POINT} from "@notnotype/nb-host/http/contracts";
import type {HttpRouteEnv} from "@notnotype/nb-host/http/contracts";
import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";

import {commandsRemoteContract} from "nbook/plugins/commands/shared/contracts";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {PROBE_RECORD_NAMES, probeStorage} from "nbook/shared/testing/probe-storage";
import type {ProbeRecordName} from "nbook/shared/testing/probe-storage";
import {projectProbeContract, remoteProbeContract, remoteProbeDescriptor} from "nbook/shared/testing/remote-probe-contract";
import {tasksKey} from "nbook/plugins/tasks/shared/contracts";
import type {ProvidedRow, StopOutcome, TaskHandle} from "nbook/plugins/tasks/shared/contracts";

export const TEST_PLUGIN_IDS = ["test.slow", "test.fail-activate", "test.fail-close", "test.throw-later", "test.remote-probe", "test.tasks-probe"] as const;
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
        entries: [defineEntry({
            id: "server",
            location: "server",
            activationEvents: ["onStartup"],
            dependencies: [{key: diagnosticsKey}],
            contributions: [{capability: HTTP_ROUTES_POINT, id, declaration: {}}],
            activate: (context) => ({contributions: {[HTTP_ROUTES_POINT]: {[id]: routes(context)}}}),
        })],
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

/** 服务端入口关闭时打印的一行。 */
export const SERVER_PROBE_CLOSED_LINE = "remote-probe server entry closed";

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

function recordName(value: string): ProbeRecordName | null {
    return (PROBE_RECORD_NAMES as ReadonlyArray<string>).includes(value) ? (value as ProbeRecordName) : null;
}

/** `POST …/storage/<记录>` 的正文。 */
interface SaveBody {
    readonly text: string;
    readonly expect: string | null;
}

export function createRemoteProbePlugin(state: RemoteProbeState = newRemoteProbeState()): PluginDefinition {
    const id = remoteProbeDescriptor.id;
    return {
        id,
        entries: [defineEntry({
            id: "server",
            location: "server",
            activationEvents: ["onStartup"],
            dependencies: [{key: diagnosticsKey}, {key: storageKey}],
            remoteProvides: [remoteProbeContract],
            contributions: [{capability: HTTP_ROUTES_POINT, id, declaration: {}}],
            activate: (context) => {
                context.scope.register({kind: "test-resource", label: "remote-probe", value: state, release: (probe) => {
                    probe.closed = true;
                    console.log(SERVER_PROBE_CLOSED_LINE);
                }});
                const storage = probeStorage(context.services.require(storageKey));
                const atProject = (projectId: string) => context.remote.use(projectProbeContract).at({project: projectId});
                const routes = new Hono<{Bindings: HttpRouteEnv}>()
                    .post("/tick", (c) => c.json({sent: tick(state)}))
                    .post("/release/:name", (c) => {
                        const hold = state.holds.get(c.req.param("name"));
                        hold?.release("released");
                        return c.json({released: hold !== undefined});
                    })
                    .get("/holds", (c) => c.json([...state.holds].map(([name, hold]) => ({name, aborted: hold.aborted, released: hold.released}))))
                    .post("/project/:id/echo", async (c) => c.json(await atProject(c.req.param("id")).echo({})))
                    .get("/commands/:client", async (c) => c.json(await context.remote.use(commandsRemoteContract).at({client: c.req.param("client")}).list({})))
                    .post("/commands/:client/:id", async (c) => c.json(await context.remote.use(commandsRemoteContract).at({client: c.req.param("client")}).execute({id: c.req.param("id")})))
                    .get("/storage/:name", async (c) => {
                        const name = recordName(c.req.param("name"));
                        return name === null ? c.notFound() : c.json(await storage.read(name));
                    })
                    .post("/storage/:name", async (c) => {
                        const name = recordName(c.req.param("name"));
                        if (name === null) return c.notFound();
                        const body = await c.req.json<SaveBody>();
                        return c.json(await storage.save(name, body.text, body.expect));
                    })
                    .get("/project/:id/storage/:name", async (c) => {
                        const name = recordName(c.req.param("name"));
                        return name === null ? c.notFound() : c.json(await atProject(c.req.param("id")).storageRead({name}));
                    })
                    .post("/project/:id/storage/:name", async (c) => {
                        const name = recordName(c.req.param("name"));
                        if (name === null) return c.notFound();
                        const body = await c.req.json<SaveBody>();
                        return c.json(await atProject(c.req.param("id")).storageSave({name, text: body.text, expect: body.expect}));
                    });
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
        })],
    };
}

/** `POST /start` 的正文。 */
interface StartBody {
    readonly title: string;
    readonly message?: string;
    readonly progress?: number | null;
    readonly cancellable?: boolean;
    readonly retry?: boolean;
}

/** 后台任务的发起方：经控制路由登记与推进任务（见文件头）。 */
function createTasksProbePlugin(): PluginDefinition {
    const id = "test.tasks-probe";
    return {
        id,
        entries: [defineEntry({
            id: "server",
            location: "server",
            activationEvents: ["onStartup"],
            dependencies: [{key: tasksKey}],
            contributions: [{capability: HTTP_ROUTES_POINT, id, declaration: {}}],
            activate: (context) => {
                const tasks = context.services.require(tasksKey);
                const handles = new Map<string, TaskHandle>();
                let last: string | null = null;
                let provided: readonly ProvidedRow[] = [];
                let notify: (() => void) | null = null;
                let answer: StopOutcome = {kind: "accepted"};
                const stops: string[] = [];
                const start = (body: StartBody): TaskHandle => {
                    const handle = tasks.start({
                        title: body.title,
                        ...(body.message === undefined ? {} : {message: body.message}),
                        ...(body.progress === undefined ? {} : {progress: body.progress}),
                        ...(body.cancellable === undefined ? {} : {cancellable: body.cancellable}),
                        ...(body.retry === true ? {retry: () => void start({title: body.title})} : {}),
                    });
                    handles.set(handle.id, handle);
                    last = handle.id;
                    return handle;
                };
                const routes = new Hono<{Bindings: HttpRouteEnv}>()
                    .post("/start", async (c) => c.json({id: start(await c.req.json<StartBody>()).id}))
                    .get("/last", (c) => c.json({id: last}))
                    .post("/provide", async (c) => {
                        provided = (await c.req.json<{rows: ProvidedRow[]}>()).rows;
                        tasks.provide({
                            rows: () => provided,
                            subscribe: (listener) => {
                                notify = listener;
                                return () => {
                                    notify = null;
                                };
                            },
                            stop: async (row) => {
                                stops.push(row);
                                return answer;
                            },
                        });
                        return c.json({ok: true});
                    })
                    .post("/rows", async (c) => {
                        provided = (await c.req.json<{rows: ProvidedRow[]}>()).rows;
                        notify?.();
                        return c.json({ok: true});
                    })
                    .post("/stop-answer", async (c) => {
                        answer = await c.req.json<StopOutcome>();
                        return c.json({ok: true});
                    })
                    .get("/stops", (c) => c.json({stops}))
                    .get("/:task/signal", (c) => {
                        const handle = handles.get(c.req.param("task"));
                        return handle === undefined ? c.json({error: "unknown task"}, 404) : c.json({aborted: handle.signal.aborted, reason: handle.signal.aborted ? String(handle.signal.reason) : null});
                    })
                    .post("/:task/:method", async (c) => {
                        const handle = handles.get(c.req.param("task"));
                        if (handle === undefined) return c.json({error: "unknown task"}, 404);
                        // 正文必须是 JSON（e2e 至少发 `{}`）：写坏的正文让请求失败，而不是静默当成空参数。
                        const body = await c.req.json<Record<string, never>>();
                        switch (c.req.param("method")) {
                            case "report": handle.report(body); break;
                            case "succeed": handle.succeed((body as {message?: string}).message); break;
                            case "fail": handle.fail(body as unknown as {message: string; detail?: string}); break;
                            case "cancelled": handle.cancelled((body as {message?: string}).message); break;
                            default: return c.json({error: "unknown method"}, 404);
                        }
                        return c.json({ok: true});
                    });
                return {contributions: {[HTTP_ROUTES_POINT]: {[id]: routes}}};
            },
        })],
    };
}

export function createTestPlugin(id: TestPluginId, hold?: Promise<void>): PluginDefinition {
    switch (id) {
        case "test.tasks-probe":
            return createTasksProbePlugin();
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
                entries: [defineEntry({
                    id: "server",
                    location: "server",
                    dependencies: [{key: diagnosticsKey}],
                    activate: async () => {
                        await hold;
                        throw new Error("测试注入的激活失败");
                    },
                })],
            };
        case "test.fail-close":
            return {
                id,
                entries: [defineEntry({
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
                })],
            };
    }
}
