/**
 * `example.file-menu` 的服务端入口：向贡献点 `menu.items` 提交两个菜单项。读这个文件学贡献方的写法：
 *
 * - 声明写在入口的 `contributions` 里，实现在激活时交出，两边按贡献 id 对上。已接受的声明漏交实现，激活在输出阶段
 *   失败（`missing-implementation`）；贡献 id 写成字面量时，`defineEntry` 在编译期就能报出来，这里用模板字符串拼 id，
 *   类型是 `string`，只能靠激活时的核对。
 * - 与 `example.menu` 之间没有服务依赖，只引用它的合同模块（贡献点 id 与声明、实现的类型）。menu 没装、受阻或还没
 *   激活，本入口照常激活，贡献等着接收者（docs/specs/runtime/plugins.md 输出第 18 条）。
 *
 * 对应的场景：`scenarios/03-contribution-point.test.ts`。
 */

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {MENU_POINT} from "../../menu/shared/contracts";
import type {MenuItemDeclaration, MenuItemImplementation} from "../../menu/shared/contracts";
import {descriptor} from "../plugin";

const OPEN = `${descriptor.id}.open`;
const CLOSE = `${descriptor.id}.close`;

export const fileMenuBackendPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [
        defineEntry({
            id: "server",
            location: "server",
            // 启动即激活：实现要等本入口激活才交出，菜单项要能执行，本入口就得先激活。
            //
            // 更好的写法是“菜单打开时才激活”：menu 拥有一个激活事件前缀（`activationEventPrefixes`，例如 `onMenu`），
            // 本入口写 `activationEvents: ["onMenu:file"]`，菜单打开时 menu 触发这个事件（docs/specs/runtime/plugins.md
            // 输出第 21 条）。但现在只有宿主能调用 `triggerActivationEvent`，激活上下文里没有触发事件的入口，menu 写
            // 不出“打开时触发”这一步。这个缺口记在 t62 的计划里，等开发者决定是否给插件补触发接口。
            activationEvents: ["onStartup"],
            contributions: [
                {capability: MENU_POINT, id: OPEN, declaration: {title: "打开文件"} satisfies MenuItemDeclaration},
                {capability: MENU_POINT, id: CLOSE, declaration: {title: "关闭文件"} satisfies MenuItemDeclaration},
            ],
            activate: () => {
                const items: Record<string, MenuItemImplementation> = {
                    [OPEN]: {run: async () => "已打开"},
                    [CLOSE]: {run: async () => "已关闭"},
                };
                return {contributions: {[MENU_POINT]: items}};
            },
        }),
    ],
};
