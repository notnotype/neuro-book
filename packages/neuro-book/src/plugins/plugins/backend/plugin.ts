/**
 * `nbook.plugins` 的服务端入口：把宿主的插件管理（`nbook/plugin-platform/backend/inventory`）交给窗口，作为远程服务。
 *
 * 安装目录、登记表与本次启动的插件集合都归服务端宿主：宿主在装配插件之前就要确定集合，所以由它创建插件管理并作为宿主
 * 能力提供，本入口只做合同的输入输出与失败码映射。
 */

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";

import {HTTP_ROUTES_POINT} from "@notnotype/nb-host/http/contracts";

import {pluginInventoryKey} from "nbook/plugin-platform/backend/inventory";
import type {InventoryFailure} from "nbook/plugin-platform/backend/inventory";
import {pluginUploadsKey} from "nbook/plugin-platform/backend/uploads";
import type {InstallFailureCode, ManageFailureCode} from "nbook/plugin-platform/shared/types";

import {descriptor} from "../plugin";
import {pluginsRegistryContract} from "../shared/contracts";
import {createPluginUploadRoutes} from "./upload-route";

/** 安装与预览的失败：清单或目录无效时带上逐条问题，其余码只带说明。 */
function refusedInstall(failure: InventoryFailure<InstallFailureCode>) {
    return failure.code === "manifest-invalid" || failure.code === "catalog-invalid"
        ? {ok: false as const, code: failure.code, detail: {detail: failure.detail, problems: [...(failure.problems ?? [])]}}
        : {ok: false as const, code: failure.code, detail: {detail: failure.detail}};
}

/** 启停与卸载的失败：都只带说明。 */
function refusedManage(failure: InventoryFailure<ManageFailureCode>) {
    return {ok: false as const, code: failure.code, detail: {detail: failure.detail}};
}

export const pluginsBackendPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "server",
        location: "server",
        // 依赖诊断：诊断先于其余插件激活（docs/specs/runtime/server-host.md）。
        dependencies: [{key: diagnosticsKey}, {key: pluginInventoryKey}, {key: pluginUploadsKey}],
        contributions: [{capability: HTTP_ROUTES_POINT, id: descriptor.id, declaration: {}}],
        remoteProvides: [pluginsRegistryContract],
        activate: (context) => {
            const inventory = context.services.require(pluginInventoryKey);
            const uploads = context.services.require(pluginUploadsKey);
            /** 上传的文件夹失效了（不存在、已删、已过期）：和路径不存在一样是 `path-rejected`。 */
            const expired = {ok: false as const, code: "path-rejected" as const, detail: {detail: "上传已失效，重新拖入文件夹"}};
            const ambiguous = {ok: false as const, code: "path-rejected" as const, detail: {detail: "要给 path 或 upload 其中一个"}};
            return {
                contributions: {[HTTP_ROUTES_POINT]: {[descriptor.id]: createPluginUploadRoutes(uploads)}},
                remote: [provideRemote(pluginsRegistryContract, () => ({
                    methods: {
                        list: async () => {
                            const listed = await inventory.list();
                            return listed.ok ? {ok: true as const, value: listed.value} : {ok: false as const, code: "registry-failed" as const, detail: {detail: listed.detail}};
                        },
                        inspect: async (input) => {
                            if ((input.path === undefined) === (input.upload === undefined)) return ambiguous;
                            const preview = input.upload === undefined ? {ok: true as const, value: await inventory.inspect(input.path!)} : await uploads.use(input.upload, (directory) => inventory.inspect(directory));
                            if (!preview.ok) return expired;
                            return preview.value.ok ? {ok: true as const, value: preview.value.value} : refusedInstall(preview.value);
                        },
                        install: async (input) => {
                            if ((input.path === undefined) === (input.upload === undefined)) return ambiguous;
                            let installed;
                            if (input.upload !== undefined) {
                                // 安装结束（成功或失败）服务端自己删上传：页面发出安装请求之后不再删，免得请求还在复制时目录被删。
                                try {
                                    installed = await uploads.use(input.upload, (directory) => inventory.install(directory));
                                } finally {
                                    await uploads.discard(input.upload);
                                }
                            } else {
                                installed = {ok: true as const, value: await inventory.install(input.path!)};
                            }
                            if (!installed.ok) return expired;
                            return installed.value.ok ? {ok: true as const, value: {plugin: installed.value.value}} : refusedInstall(installed.value);
                        },
                        enable: async ({id}) => {
                            const enabled = await inventory.setEnabled(id, true);
                            return enabled.ok ? {ok: true as const, value: {plugin: enabled.value}} : refusedManage(enabled);
                        },
                        disable: async ({id}) => {
                            const disabled = await inventory.setEnabled(id, false);
                            return disabled.ok ? {ok: true as const, value: {plugin: disabled.value}} : refusedManage(disabled);
                        },
                        uninstall: async ({id}) => {
                            const removed = await inventory.uninstall(id);
                            return removed.ok ? {ok: true as const, value: {plugin: removed.value}} : refusedManage(removed);
                        },
                    },
                }))],
            };
        },
    })],
};
