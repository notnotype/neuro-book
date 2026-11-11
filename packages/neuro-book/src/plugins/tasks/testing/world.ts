/**
 * `nbook.tasks` 的测试场地：在配置的场地（`settings/testing/world.ts`：真实服务端、经 JSON 编解码的链路、手动时钟）上装
 * 服务端入口与一个依赖 `tasksKey` 的发起方探针；窗口经真实的远程合同调用。`owner(id)` 另装一个发起方，登记在自己的
 * 子作用域里，关掉这个作用域就只停它的入口（验收 3）。只由测试使用。
 */

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {definitionAt} from "nbook/manifest";
import {settingsWorld} from "nbook/plugins/settings/testing/world";
import type {SettingsWorld} from "nbook/plugins/settings/testing/world";

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
    /** 另装一个发起方，id 取 `test.tasks-owner-<id>`。 */
    owner(id: string): Promise<Owner>;
    /** 起一个窗口，交回它的远程客户端。 */
    window(id: string): Promise<TasksClient>;
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
    const probe = ownerPlugin("test.tasks-probe", (value) => {
        tasks = value;
    }, true);
    const settings = await settingsWorld(root, [definitionAt("server", descriptor, tasksBackendPlugin), probe]);
    if (tasks === null) throw new Error("the tasks probe did not activate");
    return {
        settings,
        tasks,
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
            await settings.window(id, [page], {bound: false});
            if (captured === null) throw new Error("the test page did not activate");
            return useTasks(captured);
        },
        close: async () => {
            for (const result of await settings.close()) if (result.status !== "closed") throw new Error(`an instance did not close: ${JSON.stringify(result)}`);
        },
    };
}
