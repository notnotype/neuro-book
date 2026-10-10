/**
 * `nbook.projects` 浏览器入口：向命令系统贡献“打开项目”。选择候选用工作台的选择服务（命令面板的选择模式），
 * 整页导航用宿主能力 `windowNavigationKey`。
 */

import {Type} from "typebox";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {COMMANDS_POINT} from "nbook/plugins/commands/shared/contracts";
import type {CommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import {displayLocale, settingsKey} from "nbook/plugins/settings/shared/contracts";
import {quickPickKey} from "nbook/plugins/workbench/shared/contracts";
import {windowNavigationKey} from "nbook/shared/host";

import {descriptor} from "../plugin";
import {projectsRemoteContractV1} from "../shared/contracts";
import {OPEN_PROJECT_COMMAND, OPEN_PROJECT_DECLARATION, openProject} from "./open-project";
import type {OpenProjectHost} from "./open-project";

const DECLARATION: CommandDeclaration = {...OPEN_PROJECT_DECLARATION, args: Type.Object({}, {additionalProperties: false})};

export const projectsBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        // 命令随贡献方入口激活才进命令表（还没有按命令触发的激活事件）：启动即激活，面板里才列得出“打开项目”。
        activationEvents: ["onStartup"],
        dependencies: [{key: diagnosticsKey}, {key: quickPickKey}, {key: windowNavigationKey}, {key: settingsKey}],
        contributions: [{capability: COMMANDS_POINT, id: OPEN_PROJECT_COMMAND, declaration: DECLARATION}],
        activate: (context) => {
            const quickPick = context.services.require(quickPickKey);
            const navigation = context.services.require(windowNavigationKey);
            const remote = context.remote.use(projectsRemoteContractV1);
            const settings = context.services.require(settingsKey);
            const diagnostics = context.services.require(diagnosticsKey);
            const host: OpenProjectHost = {
                remote,
                quickPick,
                navigateDocument: (href) => navigation.navigateDocument(href),
                locale: () => displayLocale(settings),
                recordFailure: (reason, detail) => diagnostics.record({level: "info", event: "projects.register-failed", message: "登记项目失败", data: {reason, detail}, source: {plugin: descriptor.id}}),
            };
            return {contributions: {[COMMANDS_POINT]: {[OPEN_PROJECT_COMMAND]: {run: () => openProject(host)}}}};
        },
    })],
};
