/**
 * `nbook.plugins` 的远程服务合同（docs/specs/runtime/plugin-install.md）：列出插件，安装、启用、禁用与卸载第三方插件。
 *
 * 服务端拥有安装目录与登记表，窗口只经这份合同操作。所有操作都在下一次启动生效：插件集合在进程生命期内不变
 * （运行中即时生效归 docs/specs/runtime/plugin-hot-plug.md，尚未实现）。业务失败码照 Spec 的失败码表，窗口按码显示
 * 文字；`detail` 是补充说明，文件系统错误只带错误码（例如 `EACCES`），完整错误记在服务端诊断里。
 */

import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import type {RemoteClient} from "@notnotype/nb-runtime/remote";
import {textRef} from "@notnotype/nb-ui/text";
import type {TextRef} from "@notnotype/nb-ui/text";
import {Type} from "typebox";

import {FailureDetail, installFailureDetails, InstallPreviewSchema, manageFailureDetails, PluginListItemSchema, PluginListSchema} from "nbook/plugin-platform/shared/types";

import {builtinPluginTextKey} from "./builtin-names";

export type {BlockedPlugin, InstallPreview, NotLoaded, PendingChange, PluginFailureCode, PluginList, PluginListEntry, PluginListItem, PluginProblem} from "nbook/plugin-platform/shared/types";

const IdInput = Type.Object({id: Type.String({minLength: 1})}, {additionalProperties: false});
/**
 * 安装的源（plugin-install 输出 11）：服务端可读的文件夹路径 `path`，或页面上传的文件夹 `upload`（`POST /api/nbook.plugins/uploads`
 * 交回的上传 id），二者给一个；两个都给或都不给，服务端以 `path-rejected` 拒绝。远程合同的输入必须是对象 schema，所以不写联合。
 */
const SourceInput = Type.Object({path: Type.Optional(Type.String({minLength: 1})), upload: Type.Optional(Type.String({minLength: 1}))}, {additionalProperties: false});
const One = Type.Object({plugin: PluginListItemSchema}, {additionalProperties: false});

export const pluginsRegistryContract = defineRemoteService({
    id: "nbook.plugins/registry",
    version: 6,
    provider: "server",
    callers: ["browser"],
    methods: {
        list: {input: Type.Object({}, {additionalProperties: false}), output: PluginListSchema, effect: "read", errors: {"registry-failed": FailureDetail}},
        inspect: {input: SourceInput, output: InstallPreviewSchema, effect: "read", errors: installFailureDetails},
        install: {input: SourceInput, output: One, effect: "write", errors: installFailureDetails},
        enable: {input: IdInput, output: One, effect: "write", errors: manageFailureDetails},
        disable: {input: IdInput, output: One, effect: "write", errors: manageFailureDetails},
        uninstall: {input: IdInput, output: One, effect: "write", errors: manageFailureDetails},
    },
});

/** 插件页用到的合同方法（浏览器入口经 `context.remote.use` 取得的客户端满足它）。 */
export type PluginsRegistry = Pick<RemoteClient<typeof pluginsRegistryContract>, "list" | "inspect" | "install" | "enable" | "disable" | "uninstall">;

/**
 * 内置插件的显示名的文字引用（别的插件按提供者分组时用）；不是内置插件时交回 null，第三方的显示名在 `list` 的结果里。目录在窗口挂载界面前
 * 已经登记，不用激活本插件。
 */
export function builtinPluginNameRef(id: string): TextRef | null {
    const key = builtinPluginTextKey(id, "name");
    return key === null ? null : textRef(key, undefined, "nbook.plugins");
}
