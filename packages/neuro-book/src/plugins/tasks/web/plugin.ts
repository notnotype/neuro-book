/**
 * `nbook.tasks` 的浏览器入口（docs/specs/workbench/background-tasks.md 输出 10 到 16）：每个窗口一份任务仓库，贡献底部面板的
 * “后台任务”视图、状态栏条目、两条命令与公开状态，任务结束时经工作台的通知服务发通知。
 *
 * 启动即激活：结束通知要在窗口一开就订阅，书架页上也要发（输出 15）。书架页没有视图与条目的接收者，贡献照常登记、不显示。
 */

import {computed, defineComponent, h} from "vue";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {Type} from "typebox";

import {COMMANDS_POINT, commandServiceKey} from "nbook/plugins/commands/shared/contracts";
import type {CommandImplementation, WrittenCommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import {PUBLIC_STATE_POINT} from "nbook/plugins/state/shared/contracts";
import {notificationsKey, WORKBENCH_STATUSBAR_ITEMS_POINT, WORKBENCH_VIEWS_POINT} from "nbook/plugins/workbench/shared/contracts";
import type {ItemDeclaration} from "nbook/plugins/workbench/shared/items";
import type {WrittenViewDeclaration} from "nbook/plugins/workbench/shared/views";
import type {ItemImplementation, ViewImplementation} from "nbook/plugins/workbench/web/contracts";
import {bindingsOf, definePublicState} from "nbook/shared/store/public";
import {boundComponent} from "nbook/ui/bound-component";

import {descriptor} from "../plugin";
import {tasksContract} from "../shared/contracts";
import {tasksText} from "../shared/text";
import {createTasksStore} from "./store";

export const TASKS_VIEW = "nbook.tasks.list";
export const TASKS_STATUS_ITEM = "nbook.tasks.status";
export const SHOW_TASKS_COMMAND = "nbook.tasks.show";
export const CLEAR_FINISHED_COMMAND = "nbook.tasks.clear-finished";
/** 工作台的命令，公开合同（docs/specs/workbench/views.md 输出 14）。 */
const OPEN_VIEW_COMMAND = "nbook.view.open";

export const tasksState = definePublicState("nbook.tasks", {
    /** 清单不空：状态栏条目的 `when`（输出 12 的“清单为空：条目不出现”）。 */
    nonEmpty: {type: "boolean", unready: false, reason: tasksText("state.nonEmpty.reason")},
    /** 有结束的：“清除已结束”的 `when`（输出 10）。 */
    hasFinished: {type: "boolean", unready: false, reason: tasksText("state.hasFinished.reason")},
});

const NO_ARGS = Type.Object({}, {additionalProperties: false});

const COMMAND_DECLARATIONS = {
    [SHOW_TASKS_COMMAND]: {
        category: tasksText("views.list.title"),
        description: "Show the Background Tasks view in the bottom panel.",
        args: NO_ARGS,
        effect: "write",
        // 视图是给人看的；Agent 要了解任务时用不着打开它。
        expose: {agent: "never"},
    },
    [CLEAR_FINISHED_COMMAND]: {
        category: tasksText("views.list.title"),
        description: "Remove every finished background task from the list, in every window. Running tasks stay.",
        args: NO_ARGS,
        effect: "write",
        expose: {agent: "never"},
        when: {requires: [tasksState.key("hasFinished")]},
    },
} as const satisfies Readonly<Record<string, WrittenCommandDeclaration>>;

/** 视图第一次放在底部面板，排在“通知”（order 20）之前；标题与动作的标题取约定键。不因它让底部面板默认显示：经状态栏条目打开。 */
const TASKS_VIEW_DECLARATION: WrittenViewDeclaration = {icon: "i-lucide-list-checks", location: "panel", order: 10, layout: "fill", revealRegion: false, actions: [{command: CLEAR_FINISHED_COMMAND, icon: "i-lucide-list-x"}]};

/** 右侧、order 大于别的条目，所以紧挨铃铛；priority 60 让它在窄时比 Agent 活动（50）与编辑器条目后收进“更多”。 */
const STATUS_ITEM_DECLARATION: ItemDeclaration = {title: tasksText("statusItems.status.title"), alignment: "right", order: 1000, priority: 60, command: {id: SHOW_TASKS_COMMAND}, when: {requires: [tasksState.key("nonEmpty")]}};

export const tasksBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        activationEvents: ["onStartup"],
        dependencies: [{key: diagnosticsKey}, {key: notificationsKey}, {key: commandServiceKey}],
        contributions: [
            {capability: WORKBENCH_VIEWS_POINT, id: TASKS_VIEW, declaration: TASKS_VIEW_DECLARATION},
            {capability: WORKBENCH_STATUSBAR_ITEMS_POINT, id: TASKS_STATUS_ITEM, declaration: STATUS_ITEM_DECLARATION},
            ...Object.entries(COMMAND_DECLARATIONS).map(([id, declaration]) => ({capability: COMMANDS_POINT, id, declaration})),
            ...tasksState.contributions,
        ],
        activate: (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const commands = context.services.require(commandServiceKey);
            const report = (message: string): void => {
                diagnostics.record({level: "warn", event: "tasks.window", message, source: {plugin: descriptor.id}});
            };
            const store = createTasksStore(context.remote.use(tasksContract), context.services.require(notificationsKey), report);
            void store.start(context.signal);

            const state = bindingsOf(tasksState, {
                nonEmpty: computed(() => store.items.value.length > 0),
                hasFinished: computed(() => store.finished.value.length > 0),
            });
            const item: ItemImplementation = {
                // 一件写它的标题、几件写件数、没有在跑的只剩图标（输出 12）。
                text: () => {
                    const running = store.running.value;
                    if (running.length === 1) return running[0]!.title;
                    return running.length > 1 ? tasksText("status.count", {count: running.length}) : "";
                },
                icon: () => {
                    if (store.running.value.length > 0) return {name: "i-lucide-loader-circle", spin: true};
                    if (store.unseenFailure.value) return {name: "i-lucide-circle-x"};
                    return {name: "i-lucide-list-checks", muted: true};
                },
                // 有在跑的时候条目只表示进行中，失败由结束通知与视图承担。
                state: () => (store.running.value.length === 0 && store.unseenFailure.value ? "error" : "normal"),
                tooltip: () => tasksText(store.unseenFailure.value ? "status.failed" : "status.idle"),
                hover: {load: async () => {
                    const TasksHover = (await import("./components/TasksHover.vue")).default;
                    return defineComponent({name: "TasksHoverBound", setup: () => () => h(TasksHover, {store})});
                }},
            };
            const view: ViewImplementation = boundComponent("TasksView", () => import("./components/TasksView.vue"), () => ({store}));
            const show: CommandImplementation = {
                run: async () => {
                    const opened = await commands.execute(OPEN_VIEW_COMMAND, {viewId: TASKS_VIEW}, {source: "user"});
                    return opened.ok ? {ok: true, value: null} : opened;
                },
            };
            const clearFinished: CommandImplementation = {
                run: async () => {
                    await store.clearFinished();
                    return {ok: true, value: null};
                },
            };
            return {contributions: {
                [WORKBENCH_STATUSBAR_ITEMS_POINT]: {[TASKS_STATUS_ITEM]: item},
                [WORKBENCH_VIEWS_POINT]: {[TASKS_VIEW]: view},
                [COMMANDS_POINT]: {[SHOW_TASKS_COMMAND]: show, [CLEAR_FINISHED_COMMAND]: clearFinished},
                [PUBLIC_STATE_POINT]: Object.fromEntries(state.bindings),
            }};
        },
    })],
};
