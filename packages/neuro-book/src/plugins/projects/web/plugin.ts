/**
 * `nbook.projects` 浏览器入口：向命令系统贡献“打开项目”。选择候选用工作台的选择服务（命令面板的选择模式），
 * 整页导航由装配者交进来。
 */

import {Type} from "typebox";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import type {COMMANDS_POINT, CommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import type {QuickPick} from "nbook/plugins/workbench/web/contracts";

import {descriptor} from "../plugin";
import {projectsRemoteContract} from "../shared/contracts";
import {OPEN_PROJECT_COMMAND, OPEN_PROJECT_DECLARATION, openProject} from "./open-project";

const COMMANDS: typeof COMMANDS_POINT = "commands.definitions";

const DECLARATION: CommandDeclaration = {...OPEN_PROJECT_DECLARATION, args: Type.Object({}, {additionalProperties: false})};

export interface ProjectsBrowserOptions {
    /** 工作台的选择服务键。 */
    readonly quickPick: ServiceKey<QuickPick>;
    /** 整页导航到给定地址。 */
    readonly navigateDocument: (url: string) => void;
}

export function createProjectsBrowserPlugin(options: ProjectsBrowserOptions): PluginDefinition {
    return {
        id: descriptor.id,
        entries: [{
            id: "browser",
            location: "browser",
            // 命令随贡献方入口激活才进命令表（还没有按命令触发的激活事件）：启动即激活，面板里才列得出“打开项目”。
            activationEvents: ["onStartup"],
            dependencies: [{key: diagnosticsKey}, {key: options.quickPick}],
            contributions: [{capability: COMMANDS, id: OPEN_PROJECT_COMMAND, declaration: DECLARATION}],
            activate: (context) => {
                const quickPick = context.services.require(options.quickPick);
                const remote = context.remote.use(projectsRemoteContract);
                return {contributions: {[COMMANDS]: {[OPEN_PROJECT_COMMAND]: {run: () => openProject(remote, quickPick, options.navigateDocument)}}}};
            },
        }],
    };
}
