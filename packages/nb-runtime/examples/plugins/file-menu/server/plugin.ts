/**
 * `example.file-menu` 的服务端入口：向贡献点 `menu.items` 提交两个菜单项。声明写在 `contributions` 里，实现随
 * 激活交出。与 `example.menu` 之间没有服务依赖，只经贡献点协作。
 */

import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import type {MENU_POINT, MenuItemDeclaration, MenuItemImplementation} from "../../menu/shared/contracts";
import {descriptor} from "../plugin";

const MENU: typeof MENU_POINT = "menu.items";

const OPEN = `${descriptor.id}.open`;
const CLOSE = `${descriptor.id}.close`;

export function createFileMenuServerPlugin(): PluginDefinition {
    return {
        id: descriptor.id,
        entries: [{
            id: "server",
            location: "server",
            // 贡献要等本入口激活才交出实现，没有别的激活时机，所以启动即激活。
            activationEvents: ["onStartup"],
            contributions: [
                {capability: MENU, id: OPEN, declaration: {title: "打开文件"} satisfies MenuItemDeclaration},
                {capability: MENU, id: CLOSE, declaration: {title: "关闭文件"} satisfies MenuItemDeclaration},
            ],
            activate: () => {
                const items: Record<string, MenuItemImplementation> = {
                    [OPEN]: {run: () => "已打开"},
                    [CLOSE]: {run: () => "已关闭"},
                };
                return {contributions: {[MENU]: items}};
            },
        }],
    };
}
