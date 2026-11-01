/**
 * 服务端与项目实例的宿主模块表（docs/specs/runtime/plugin-code-loading.md 输出 2）：第三方插件代码导入的共享模块，就是宿主
 * 自己用的这一份。键与平台档案（`nbook/plugin-platform-profile`）的 `SERVER_SHARED_MODULES` 一一对应（类型 `ServerSharedModule` 核对）。
 *
 * 由装载器在第一次装载第三方入口时调用：动态导入，没有第三方入口的进程不必加载 SDK 的实现。
 */

import type {ServerSharedModule} from "nbook/plugin-platform-profile";

export async function serverHostModules(): Promise<Readonly<Record<ServerSharedModule, object>>> {
    const [reactivity, typebox, typeboxValue, typeboxCompile, sdk, text, state, storage, settings, commands, agent, agentJsx] = await Promise.all([
        import("@vue/reactivity"),
        import("typebox"),
        import("typebox/value"),
        import("typebox/compile"),
        import("nbook/sdk/index"),
        import("nbook/sdk/text"),
        import("nbook/sdk/state"),
        import("nbook/sdk/storage"),
        import("nbook/sdk/settings"),
        import("nbook/sdk/commands"),
        import("nbook/sdk/agent"),
        import("nbook/sdk/agent-jsx-runtime"),
    ]);
    return {
        "@vue/reactivity": reactivity,
        "typebox": typebox,
        "typebox/value": typeboxValue,
        "typebox/compile": typeboxCompile,
        "@notnotype/nb-plugin-sdk": sdk,
        "@notnotype/nb-plugin-sdk/text": text,
        "@notnotype/nb-plugin-sdk/state": state,
        "@notnotype/nb-plugin-sdk/storage": storage,
        "@notnotype/nb-plugin-sdk/settings": settings,
        "@notnotype/nb-plugin-sdk/commands": commands,
        "@notnotype/nb-plugin-sdk/agent": agent,
        "@notnotype/nb-plugin-sdk/agent/jsx-runtime": agentJsx,
    } satisfies Record<ServerSharedModule, object>;
}
