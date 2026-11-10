/**
 * `nbook.canon` 的浏览器入口：不存世界，按调用方提供世界客户端，以调用方的身份经远程服务转给本窗口绑定的项目实例
 * （docs/specs/canon/project.md 输出 1）。没有绑定项目的窗口调用得到 `no-project`。
 *
 * 作者界面（docs/specs/canon/author-ui.md）也在这里：侧栏视图“设定”与打开条目的命令。界面用本入口自己的身份建一份读取层
 * （`world.ts`），视图第一次挂上时才建（才订阅世界），窗口停止时释放。视图与命令的实现要在启动时交出，所以入口在启动时激活。
 */

import {defineEntry, provideServicePerConsumer} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {COMMANDS_POINT, commandServiceKey} from "nbook/plugins/commands/shared/contracts";
import {WORKBENCH_VIEWS_POINT} from "nbook/plugins/workbench/shared/contracts";
import type {WrittenViewDeclaration} from "nbook/plugins/workbench/shared/views";
import type {ViewImplementation} from "nbook/plugins/workbench/web/contracts";
import {windowProjectKey} from "nbook/shared/projects";

import {descriptor} from "../plugin";
import {componentsPoint} from "../shared/components";
import {canonClientKey, canonWorldContract} from "../shared/contracts";
import {createCanonClient} from "./client";
import {CANON_COMMAND_DECLARATIONS, canonCommands, OPEN_ENTRY_COMMAND} from "./commands";
import {createEntriesViewHost, entriesViewState} from "./entries-view";
import {createCanonWorld} from "./world";
import type {CanonWorld} from "./world";

export const ENTRIES_VIEW_ID = "nbook.canon.entries";

/** author-ui.md 的“输入与前置条件”：侧栏，排在文件资源管理器（`order: 0`）之后。标题由约定键补（`views.<id>.title`）。 */
const ENTRIES_VIEW: WrittenViewDeclaration = {icon: "i-lucide-book", location: "sidebar", order: 10, layout: "fill"};

export const canonBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    // 贡献点在每个有本插件的实例里都定义：内置类型是顶层声明，各实例都登记它们（plugin-manifest.md 输出 11）。
    contributionPoints: [componentsPoint],
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        activationEvents: ["onStartup"],
        // 命令服务可选：只装世界客户端的窗口（测试场地、别的插件的测试）没有工作台，也没有命令。
        dependencies: [{key: windowProjectKey}, {key: commandServiceKey, required: false}],
        provides: [canonClientKey],
        remoteDelegates: [canonWorldContract],
        contributions: [
            {capability: WORKBENCH_VIEWS_POINT, id: ENTRIES_VIEW_ID, declaration: ENTRIES_VIEW},
            ...Object.entries(CANON_COMMAND_DECLARATIONS).map(([id, declaration]) => ({capability: COMMANDS_POINT, id, declaration})),
        ],
        activate: async (context) => {
            const bound = context.services.require(windowProjectKey).project !== null;
            const resolved = await context.services.resolve(commandServiceKey);
            const commands = resolved.status === "resolved" ? resolved.instance : null;
            let world: CanonWorld | null = null;
            const worldOf = (): CanonWorld | null => {
                if (!bound || context.signal.aborted) return null;
                world ??= createCanonWorld(createCanonClient(() => context.remote));
                return world;
            };
            context.signal.addEventListener("abort", () => world?.dispose(), {once: true});
            const state = entriesViewState();
            const view: ViewImplementation = {
                load: async () => createEntriesViewHost((await import("./components/EntryTree.vue")).default, {
                    world: worldOf(),
                    state,
                    open: (id) => void commands?.execute(OPEN_ENTRY_COMMAND, {id}),
                }),
            };
            return {
                services: [provideServicePerConsumer(canonClientKey, (consumer) => createCanonClient(bound ? () => context.remote.on(consumer) : null))],
                contributions: {
                    [WORKBENCH_VIEWS_POINT]: {[ENTRIES_VIEW_ID]: view},
                    [COMMANDS_POINT]: canonCommands(commands),
                },
            };
        },
    })],
};
