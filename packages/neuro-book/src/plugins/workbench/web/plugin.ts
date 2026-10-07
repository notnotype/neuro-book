/**
 * `nbook.workbench` 浏览器入口：提供窗口挂载的页面表，定义页面贡献点 `workbench.pages`；
 * 向命令系统贡献面板入口命令，向其它插件提供选择服务（命令面板的选择模式），`/` 页挂着命令宿主
 * （命令面板与浏览器键位分发）。
 */

import {defineAsyncComponent, h} from "vue";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {provide} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import type {COMMANDS_POINT, CommandService} from "nbook/plugins/commands/shared/contracts";

import {descriptor} from "../plugin";
import {OPEN_COMMANDS_DECLARATION, OPEN_COMMANDS_ID, PaletteSlot} from "./commands/open-commands";
import type {PaletteHost} from "./commands/palette-host";
import {quickPickKey, WORKBENCH_PAGES_POINT, workbenchRootKey} from "./contracts";
import {createEmptyWorkbench} from "./empty-workbench";
import {PageTable, validatePageContribution} from "./pages";

const COMMANDS: typeof COMMANDS_POINT = "commands.definitions";

const CommandHost = defineAsyncComponent(() => import("./commands/WorkbenchCommandHost.vue"));

/**
 * 工作台依赖的其它插件的服务键。服务键按对象身份比较，而插件之间只以 `import type` 互相引用，
 * 所以由装配者（`src/web/plugins.ts`）交进来。
 */
export interface WorkbenchServiceKeys {
    readonly commands: ServiceKey<CommandService>;
}

export function createWorkbenchBrowserPlugin(keys: WorkbenchServiceKeys): PluginDefinition {
    return {
        id: descriptor.id,
        contributionPoints: [{id: WORKBENCH_PAGES_POINT, implementation: "required", validate: validatePageContribution}],
        entries: [{
            id: "browser",
            location: "browser",
            dependencies: [{key: diagnosticsKey}, {key: keys.commands}],
            provides: [workbenchRootKey, quickPickKey],
            receives: [WORKBENCH_PAGES_POINT],
            contributions: [{capability: COMMANDS, id: OPEN_COMMANDS_ID, declaration: OPEN_COMMANDS_DECLARATION}],
            activate: (context) => {
                const diagnostics = context.services.require(diagnosticsKey);
                const commands = context.services.require(keys.commands);
                const palettes = new PaletteSlot();
                const report = (error: Error): void => {
                    diagnostics.record({level: "warn", event: "workbench.commands", message: error.message, source: {plugin: descriptor.id}});
                };
                const home = createEmptyWorkbench(() => h(CommandHost, {commands, report, attach: (host: PaletteHost) => palettes.attach(host)}));
                const pages = new PageTable([{path: "/", title: "NeuroBook", load: async () => home}]);
                return {
                    services: [provide(workbenchRootKey, {pages: () => pages.list()}), provide(quickPickKey, palettes.quickPick)],
                    receivers: {[WORKBENCH_PAGES_POINT]: pages.receiver()},
                    contributions: {[COMMANDS]: {[OPEN_COMMANDS_ID]: palettes.command}},
                };
            },
        }],
    };
}
