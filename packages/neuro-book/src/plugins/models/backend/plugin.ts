/**
 * `nbook.models` 的服务端入口（docs/specs/models/service.md“状态与转换”）：打开凭据库并读完一次，再用设置服务的适配建
 * nb-models 的核心、读完来源缓存（`core.start()`），交出 `modelsKey` 与远程合同；停止时先停来源、等已接纳的写入走完、关凭据库。
 */

import {join} from "node:path";

import {HTTP_ROUTES_POINT} from "@notnotype/nb-host/http/contracts";
import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry, provideService} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";

import {openCredentials} from "@notnotype/nb-harness/models";
import {createModelsCore} from "@notnotype/nb-models/core";

import {settingsKey} from "nbook/plugins/settings/shared/contracts";
import {startupEnvKey, stateRootKey} from "nbook/shared/host";

import {descriptor} from "../plugin";
import {modelsKey, modelsSettingsContract} from "../shared/contracts";
import {createIconRoutes, fileIconStore} from "./icons";
import {loadInstallSecret} from "./secret";
import {settingsModelsConfig} from "./settings-store";
import {fileSourceStore} from "./source-store";

export const modelsBackendPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "server",
        location: "server",
        dependencies: [{key: diagnosticsKey}, {key: settingsKey}, {key: stateRootKey}, {key: startupEnvKey}],
        provides: [modelsKey],
        remoteProvides: [modelsSettingsContract],
        contributions: [{capability: HTTP_ROUTES_POINT, id: descriptor.id, declaration: {}}],
        activate: async (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const record = (level: "info" | "warn", event: string, message: string, data?: Readonly<Record<string, unknown>>): void => {
                diagnostics.record({level, event, message, ...(data === undefined ? {} : {data}), source: {plugin: descriptor.id}});
            };
            const agentRoot = join(context.services.require(stateRootKey).path, "agent");
            const credentials = await openCredentials(join(agentRoot, "credentials.db"));
            context.scope.register({kind: "credential-store", label: `${descriptor.id} credentials`, value: credentials, release: (value) => value.close()});
            const env = context.services.require(startupEnvKey).env;
            // 在线目录的地址可由启动环境改（镜像）；设成空串不取在线目录（离线环境；e2e 也这样，免得用例出本机）。
            const catalogUrl = env.NBOOK_MODELS_CATALOG_URL === undefined ? {} : {catalogUrl: env.NBOOK_MODELS_CATALOG_URL.trim() === "" ? null : env.NBOOK_MODELS_CATALOG_URL.trim()};
            const core = createModelsCore({config: settingsModelsConfig(context.services.require(settingsKey)), credentials, env, ...catalogUrl, secret: await loadInstallSecret(join(agentRoot, "identity.key")), icons: fileIconStore(context.services.require(stateRootKey).path), sources: fileSourceStore(context.services.require(stateRootKey).path), record});
            // 后登记的先释放：核心先停（取消在途的列表请求、等写入走完），凭据库后关。
            context.scope.register({kind: "models-core", label: `${descriptor.id} core`, value: core, release: (value) => value.close()});
            // 读完来源缓存与在线目录再交出服务：会话一开始解析的引用就能看到列表里的模型。后台拉取不等。
            await core.start();
            return {
                services: [provideService(modelsKey, core.service)],
                remote: [provideRemote(modelsSettingsContract, (consumer) => core.remote(consumer))],
                contributions: {[HTTP_ROUTES_POINT]: {[descriptor.id]: createIconRoutes(context.services.require(stateRootKey).path)}},
            };
        },
    })],
};
