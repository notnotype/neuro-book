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

import {clockKey, windowConnectionKey} from "nbook/shared/host";
import {windowProjectKey} from "nbook/shared/projects";

import {descriptor} from "../plugin";
import {projectSettingsContract, settingsKey, userSettingsContract} from "../shared/contracts";
import {createSettingsInstance, FIRST_SNAPSHOT_MS, provideSettings, recordTo} from "../shared/instance";
import {acceptedSettings, settingsPoint} from "../shared/point";
import {remoteLayerLink} from "../shared/remote-link";

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
    })],
};
