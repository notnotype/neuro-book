/**
 * `nbook.settings` 的浏览器入口：不存配置，订阅服务端的用户层与（绑定项目时）项目实例的项目层，在本窗口合成有效值，
 * 按调用方提供配置服务；写入以调用方的身份经远程服务转给层的拥有者（docs/specs/settings/configuration.md）。
 *
 * 配置核心入口 `browser` 只依赖宿主能力与诊断，工作台、命令系统都依赖它；用到命令面板选择服务的“切换界面语言”在另一
 * 个入口里，免得配置核心经工作台、命令系统绕回自己（服务装配的静态环把可选依赖也算在内）。
 */

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {Type} from "typebox";

import {COMMANDS_POINT} from "nbook/plugins/commands/shared/contracts";
import type {CommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import {quickPickKey} from "nbook/plugins/workbench/shared/contracts";

import {clockKey, windowConnectionKey} from "nbook/shared/host";
import {windowProjectKey} from "nbook/shared/projects";

import {descriptor} from "../plugin";
import {localeSetting, projectSettingsContract, settingsKey, switchSetting, userSettingsContract} from "../shared/contracts";
import {createSettingsInstance, FIRST_SNAPSHOT_MS, provideSettings, recordTo} from "../shared/instance";
import {acceptedSettings, settingsPoint} from "../shared/point";
import {remoteLayerLink} from "../shared/remote-link";

export const SWITCH_LOCALE_COMMAND = "nbook.settings.switch-locale";

/** 写用户层（界面语言只允许用户层）；Agent 带参数即可切换，plan、discuss 模式下按命令系统的规则只读。 */
export const SWITCH_LOCALE_DECLARATION: CommandDeclaration = {
    title: {"zh-CN": "切换界面语言", "en-US": "Change Display Language"},
    category: {"zh-CN": "设置", "en-US": "Settings"},
    description: "Change the display language of all windows. Without arguments, the user picks one; with { locale }, it is set directly.",
    args: Type.Object({locale: Type.Optional(Type.Union([Type.Literal("zh-CN"), Type.Literal("en-US")]))}, {additionalProperties: false}),
    effect: "write",
    expose: {agent: "auto"},
};

export const settingsBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    contributionPoints: [settingsPoint],
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        dependencies: [{key: diagnosticsKey}, {key: clockKey}, {key: windowConnectionKey}, {key: windowProjectKey}],
        provides: [settingsKey],
        remoteDelegates: [userSettingsContract, projectSettingsContract],
        activate: async (context) => {
            const bound = context.services.require(windowProjectKey).project !== null;
            const instance = createSettingsInstance({
                layers: {
                    user: remoteLayerLink(context.remote, userSettingsContract),
                    ...(bound ? {project: remoteLayerLink(context.remote, projectSettingsContract)} : {}),
                },
                declarations: acceptedSettings(context.declarations),
                clock: context.services.require(clockKey),
                firstSnapshotMs: FIRST_SNAPSHOT_MS,
                connection: context.services.require(windowConnectionKey),
                record: recordTo(context.services.require(diagnosticsKey), descriptor.id),
            });
            context.scope.register({kind: "settings-instance", label: `${descriptor.id} browser`, value: instance, release: (value) => value.close()});
            await instance.ready;
            return {services: [provideSettings(instance)]};
        },
    }), defineEntry({
        id: "commands",
        location: "browser",
        // 命令随贡献方入口激活才进命令表（还没有按命令触发的激活事件），启动即激活。
        activationEvents: ["onStartup"],
        dependencies: [{key: settingsKey}, {key: quickPickKey}],
        contributions: [{capability: COMMANDS_POINT, id: SWITCH_LOCALE_COMMAND, declaration: SWITCH_LOCALE_DECLARATION}],
        activate: (context) => {
            const settings = context.services.require(settingsKey);
            const quickPick = context.services.require(quickPickKey);
            const run = (args: unknown) => switchSetting({
                settings,
                quickPick,
                setting: localeSetting,
                value: (args as {readonly locale?: "zh-CN" | "en-US"}).locale,
                // 语言名用它自己的语言写，换到看不懂的语言后也找得回来。
                choices: [{id: "zh-CN", label: "简体中文"}, {id: "en-US", label: "English"}],
                title: SWITCH_LOCALE_DECLARATION.title,
            });
            return {contributions: {[COMMANDS_POINT]: {[SWITCH_LOCALE_COMMAND]: {run}}}};
        },
    })],
};

/**
 * 只有配置核心入口的浏览器定义：给不装工作台的测试实例与示例场地用。切换界面语言的入口要命令面板的选择服务，
 * 没有工作台时它受阻，会被当作启动失败；产品窗口总有工作台，装完整的 `settingsBrowserPlugin`。
 */
export const settingsBrowserCore: PluginDefinition = {...settingsBrowserPlugin, entries: settingsBrowserPlugin.entries.filter((entry) => entry.id === "browser")};
