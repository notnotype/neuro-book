/**
 * `nbook.settings` 的后端定义：服务端入口拥有用户层（`<状态根>/settings.json`），项目入口拥有本项目代次的项目层
 * （`<项目目录>/.nbook/settings.json`）并订阅服务端的用户层。两个入口都按调用方提供配置服务，并以远程服务把自己的
 * 层交给别的实例（docs/specs/settings/configuration.md）。
 *
 * 服务端只合成默认值与用户层：服务端不绑定项目，服务端插件写项目层为 `no-project`。
 */

import {join} from "node:path";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {ActivationContext, PluginDefinition, PluginEntryDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import {clockKey, stateRootKey} from "nbook/shared/host";
import {currentProjectKey} from "nbook/shared/projects";

import {descriptor} from "../plugin";
import {projectSettingsContract, settingsKey, userSettingsContract} from "../shared/contracts";
import {createSettingsInstance, FIRST_SNAPSHOT_MS, provideSettings, recordTo} from "../shared/instance";
import {acceptedSettings, settingsPoint} from "../shared/point";
import {remoteLayerLink} from "../shared/remote-link";
import {createLayerOwner} from "./layer-owner";
import {ownerLink, remoteLayer} from "./owner-link";

/** `placement` 是给出文件位置的宿主能力，`locate` 在激活时从它算出配置文件路径。 */
function layerEntry(location: "server" | "project", placement: ServiceKey<unknown>, locate: (context: ActivationContext) => string): PluginEntryDefinition {
    const layer = location === "server" ? "user" : "project";
    const owned = layer === "user" ? userSettingsContract : projectSettingsContract;
    return defineEntry({
        id: location,
        location,
        // 启动即激活：外部改坏的文件在启动时就有诊断，监视也从启动开始。
        activationEvents: ["onStartup"],
        dependencies: [{key: diagnosticsKey}, {key: clockKey}, {key: placement}],
        provides: [settingsKey],
        remoteProvides: [owned],
        remoteDelegates: layer === "project" ? [userSettingsContract] : [],
        activate: async (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const clock = context.services.require(clockKey);
            const declarations = acceptedSettings(context.declarations);
            const owner = createLayerOwner({path: locate(context), layer, declarations: () => declarations, clock, diagnostics, source: descriptor.id});
            const ownerResource = context.scope.register({kind: "settings-layer", label: `${descriptor.id} ${layer}`, value: owner, release: (value) => value.close()});
            await owner.ready;
            const instance = createSettingsInstance({
                layers: layer === "user" ? {user: ownerLink(owner)} : {user: remoteLayerLink(context.remote, userSettingsContract), project: ownerLink(owner)},
                declarations,
                clock,
                firstSnapshotMs: FIRST_SNAPSHOT_MS,
                record: recordTo(diagnostics, descriptor.id),
            });
            // 先停实例的订阅，再关拥有者。
            context.scope.register({
                kind: "settings-instance",
                label: `${descriptor.id} ${location}`,
                value: instance,
                release: (value) => value.close(),
                dependsOn: ownerResource.status === "registered" ? [ownerResource.handle] : [],
            });
            await instance.ready;
            return {services: [provideSettings(instance)], remote: [provideRemote(owned, (consumer) => remoteLayer(owner, consumer))]};
        },
    });
}

export const settingsBackendPlugin: PluginDefinition = {
    id: descriptor.id,
    contributionPoints: [settingsPoint],
    entries: [
        layerEntry("server", stateRootKey, (context) => join(context.services.require(stateRootKey).path, "settings.json")),
        layerEntry("project", currentProjectKey, (context) => join(context.services.require(currentProjectKey).root, ".nbook", "settings.json")),
    ],
};
