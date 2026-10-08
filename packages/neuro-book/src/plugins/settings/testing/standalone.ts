/**
 * 给不连远程的单个测试实例装上 `nbook.settings`：依赖配置服务的内置插件（命令系统、工作台、项目界面）在这样的实例里
 * 照常激活。服务端读 `stateRoot` 下的 `settings.json`（可以不存在，读配置不创建文件）；窗口没有远程节点，订阅不到
 * 任何层，按默认值（界面语言 zh-CN）。要验证配置本身用 `world.ts` 的多实例场地。只由测试使用。
 */

import {join} from "node:path";

import type {CapabilityProvider} from "@notnotype/nb-runtime/application";
import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {definitionAt} from "nbook/manifest";
import {clockKey, stateRootKey, windowConnectionKey} from "nbook/shared/host";
import {windowProjectKey} from "nbook/shared/projects";

import {settingsBackendPlugin} from "../backend/plugin";
import {descriptor} from "../plugin";
import {settingsBrowserCore} from "../web/plugin";

export interface StandaloneSettings {
    readonly plugins: ReadonlyArray<PluginDefinition>;
    readonly capabilities: ReadonlyArray<CapabilityProvider>;
}

/** `windowProject: false`：测试自己给窗口的项目绑定。 */
export function standaloneSettings(location: "server" | "browser", root: string, options: {readonly windowProject?: boolean} = {}): StandaloneSettings {
    if (location === "server") {
        return {
            plugins: [definitionAt("server", descriptor, settingsBackendPlugin)],
            capabilities: [
                {id: "host.state-root", key: stateRootKey, create: () => ({path: join(root, "state")})},
                {id: "host.clock", key: clockKey, create: () => systemClock},
            ],
        };
    }
    return {
        plugins: [definitionAt("browser", descriptor, settingsBrowserCore)],
        capabilities: [
            {id: "clock", key: clockKey, create: () => systemClock},
            {id: "window.connection", key: windowConnectionKey, create: () => ({state: () => "offline" as const, onChange: () => () => undefined})},
            ...(options.windowProject === false ? [] : [{id: "window.project", key: windowProjectKey, create: () => ({project: null})}]),
        ],
    };
}
