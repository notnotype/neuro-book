/**
 * `nbook.models` 的服务端入口（docs/specs/models/service.md“状态与转换”）：打开凭据库并读完一次，再建核心、交出
 * `modelsKey` 与远程合同；停止时等已接纳的写入走完、关凭据库。
 */

import {join} from "node:path";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry, provideService} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";

import {openCredentials} from "@notnotype/nb-harness/models";

import {settingsKey} from "nbook/plugins/settings/shared/contracts";
import {startupEnvKey, stateRootKey} from "nbook/shared/host";

import {descriptor} from "../plugin";
import {modelsKey, modelsSettingsContract} from "../shared/contracts";
import {createModelsCore} from "./core";

export const modelsBackendPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "server",
        location: "server",
        dependencies: [{key: diagnosticsKey}, {key: settingsKey}, {key: stateRootKey}, {key: startupEnvKey}],
        provides: [modelsKey],
        remoteProvides: [modelsSettingsContract],
        activate: async (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const record = (level: "info" | "warn", event: string, message: string, data?: Readonly<Record<string, unknown>>): void => {
                diagnostics.record({level, event, message, ...(data === undefined ? {} : {data}), source: {plugin: descriptor.id}});
            };
            const credentials = await openCredentials(join(context.services.require(stateRootKey).path, "agent", "credentials.db"));
            context.scope.register({kind: "credential-store", label: `${descriptor.id} credentials`, value: credentials, release: (value) => value.close()});
            const core = createModelsCore({settings: context.services.require(settingsKey), credentials, env: context.services.require(startupEnvKey).env, record});
            // 后登记的先释放：核心先停（等写入走完），凭据库后关。
            context.scope.register({kind: "models-core", label: `${descriptor.id} core`, value: core, release: (value) => value.close()});
            return {services: [provideService(modelsKey, core.service)], remote: [provideRemote(modelsSettingsContract, (consumer) => core.remote(consumer))]};
        },
    })],
};
