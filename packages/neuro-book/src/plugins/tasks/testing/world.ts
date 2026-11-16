/**
 * `nbook.tasks` 的测试场地：在配置的场地（`settings/testing/world.ts`：真实服务端、经 JSON 编解码的链路、手动时钟）上装
 * 服务端入口与一个依赖 `tasksKey` 的发起方探针；窗口经真实的远程合同调用。`owner(id)` 另装一个发起方，登记在自己的
 * 子作用域里，关掉这个作用域就只停它的入口（验收 3）。只由测试使用。
 */

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {definitionAt} from "nbook/manifest";
import {settingsWorld} from "nbook/plugins/settings/testing/world";
import type {SettingsWorld, WorldWindow} from "nbook/plugins/settings/testing/world";
import {createRunningWork} from "nbook/server/running-work";
import type {RunningWorkRegistry} from "nbook/server/running-work";
import {runningWorkKey} from "nbook/shared/host";

import {tasksBackendPlugin} from "../backend/plugin";
import {descriptor} from "../plugin";
import {tasksContract, tasksKey} from "../shared/contracts";
import type {BackgroundTasks} from "../shared/contracts";

const useTasks = (context: ActivationContext) => context.remote.use(tasksContract);

export type TasksClient = ReturnType<typeof useTasks>;

export interface Owner {
    readonly tasks: BackgroundTasks;
    /** 停止这个发起方的入口（它的子作用域关闭），`nbook.tasks` 照常运行。 */
    stop(): Promise<void>;
}

export interface TasksWorld {
    readonly settings: SettingsWorld;
    /** 场地自带的发起方拿到的登记服务。 */
    readonly tasks: BackgroundTasks;
    /** 服务端的在跑的工作登记表（宿主能力 `runningWorkKey`，与产品同一个实现）。 */
    readonly work: RunningWorkRegistry;
    /** 另装一个发起方，id 取 `test.tasks-owner-<id>`。 */
    owner(id: string): Promise<Owner>;
    /** 起一个窗口，交回它的远程客户端。 */
    window(id: string): Promise<TasksClient>;
    /** 已起的窗口的链路：断线与重连（重连后订阅收到 `onResync`）。 */
    link(id: string): Pick<WorldWindow, "disconnect" | "reconnect">;
    close(): Promise<void>;
}

function ownerPlugin(id: string, take: (tasks: BackgroundTasks) => void, onStartup = false): PluginDefinition {
    return {id, entries: [defineEntry({id: "server", location: "server", ...(onStartup ? {activationEvents: ["onStartup"]} : {}), dependencies: [{key: tasksKey}], activate: (context) => {
        take(context.services.require(tasksKey));
        return {};
    }})]};
}

export async function tasksWorld(root: string): Promise<TasksWorld> {
    let tasks: BackgroundTasks | null = null;
    const windows = new Map<string, WorldWindow>();
    const probe = ownerPlugin("test.tasks-owner", (value) => {
        tasks = value;
    }, true);
    const work = createRunningWork((record) => settings.diagnostics("hub").record(record));
    const settings = await settingsWorld(root, [definitionAt("server", descriptor, tasksBackendPlugin), probe], {hubCapabilities: [{id: "host.running-work", key: runningWorkKey, create: () => work.provision}]});
    if (tasks === null) throw new Error("the tasks probe did not activate");
    return {
        settings,
        tasks,
        work,
        owner: async (id) => {
            let taken: BackgroundTasks | null = null;
            const pluginId = `test.tasks-owner-${id}`;
            const scope = settings.hub.root.createChild(pluginId);
            const registered = settings.hub.plugins.register(ownerPlugin(pluginId, (value) => {
                taken = value;
            }), {scope});
            if (registered.status !== "accepted") throw new Error(`the owner plugin was not accepted: ${JSON.stringify(registered)}`);
            const activated = await settings.hub.plugins.activate({plugin: pluginId, entry: "server"});
            if (activated.status !== "activated" || taken === null) throw new Error(`the owner plugin did not activate: ${JSON.stringify(activated)}`);
            return {tasks: taken, stop: async () => void await scope.close()};
        },
        window: async (id) => {
            let captured: ActivationContext | null = null;
            const page: PluginDefinition = {id: `test.tasks-page-${id}`, entries: [defineEntry({id: "browser", location: "browser", activationEvents: ["onStartup"], activate: (context) => {
                captured = context;
                return {};
            }})]};
            windows.set(id, await settings.window(id, [page], {bound: false}));
            if (captured === null) throw new Error("the test page did not activate");
            return useTasks(captured);
        },
        link: (id) => {
            const found = windows.get(id);
            if (found === undefined) throw new Error(`no window ${id}`);
            return found;
        },
        close: async () => {
            for (const result of await settings.close()) if (result.status !== "closed") throw new Error(`an instance did not close: ${JSON.stringify(result)}`);
        },
    };
}
