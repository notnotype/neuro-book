/**
 * `example.menu` 的服务端入口：定义贡献点 `menu.items` 并接收贡献，对外提供菜单服务。
 *
 * - 声明按贡献点的 `validate` 逐条校验：插件还没激活就能校验，不合格的只拒绝那一条，同一插件的其它贡献照常。
 * - 本入口激活时交出接收者，贡献方发布后内核逐条通知它（`published`），此时实现可用；贡献方或本入口停止时撤回
 *   （`revoke`），每条交付恰好撤回一次。接收者只维护自己的表，不用关心贡献方的激活顺序。
 * - 贡献方与拥有者之间没有服务依赖：本插件缺席时贡献只是等着，不使贡献方失败。
 *
 * `nbook.commands` 的命令、`nbook.workbench` 的页面都是这样接入的。
 */

import {defineEntry, provide} from "@notnotype/nb-runtime/plugins";
import type {ContributionDescriptor, ContributionHandle, ContributionReceiver, PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {descriptor} from "../plugin";
import {MENU_POINT, menuKey} from "../shared/contracts";
import type {MenuItemDeclaration, MenuItemImplementation, MenuService} from "../shared/contracts";

type MenuHandle = ContributionHandle<MenuItemDeclaration, MenuItemImplementation>;

/** 纯函数：只看这一条贡献，返回拒绝原因或 null。 */
function validateMenuItem(contribution: ContributionDescriptor): string | null {
    if (!contribution.id.startsWith(`${contribution.plugin}.`)) return `菜单项 id 要以插件 id ${contribution.plugin} 加“.”开头`;
    const title = (contribution.declaration as Partial<MenuItemDeclaration> | null)?.title;
    return typeof title === "string" && title.trim() !== "" ? null : "菜单项要有标题";
}

export const menuBackendPlugin: PluginDefinition = {
    id: descriptor.id,
    // required：贡献写在入口下并给出实现；none：只有声明。
    contributionPoints: [{id: MENU_POINT, implementation: "required", validate: validateMenuItem}],
    entries: [defineEntry({
        id: "server",
        location: "server",
        provides: [menuKey],
        receives: [MENU_POINT],
        activate: () => {
            const items = new Map<string, MenuHandle>();
            const receiver: ContributionReceiver<MenuItemDeclaration, MenuItemImplementation> = {
                published: (handle) => void items.set(handle.id, handle),
                revoke: (handle) => void items.delete(handle.id),
            };
            const menu: MenuService = {
                items: () => [...items.values()].map((handle) => ({id: handle.id, title: handle.declaration.title})),
                // 每次执行都经 implementation() 取实现：撤回之后不会再调到旧实现。
                run: (id) => items.get(id)?.implementation().run() ?? null,
            };
            return {services: [provide(menuKey, menu)], receivers: {[MENU_POINT]: receiver}};
        },
    })],
};
