/**
 * `example.menu` 的服务端入口：定义贡献点 `menu.items`、接收贡献，对外提供菜单服务。读这个文件学贡献点的三个环节：
 *
 * 1. **校验**（`validate`）：只看这一条声明，插件还没激活就能判断；不合格的只拒绝这一条，同一插件的其它贡献照常
 *    （docs/specs/runtime/plugins.md 输出第 15、23 条）。
 * 2. **接收**（`receivers`）：拥有者入口激活时交出接收者。贡献方发布后内核逐条通知它（`published`），此时实现可用；
 *    贡献方或拥有者停止时撤回（`revoke`），每条交付恰好撤回一次（同文输出第 16、17、24 条）。接收者只维护自己的表，
 *    不用关心谁先激活：拥有者晚到时，内核把已经发布的贡献补交给它。
 * 3. **查询声明**（`context.declarations`）：此刻已接受的全部声明，贡献方还没激活也查得到（同文输出第 23 条）。
 *
 * 贡献方与拥有者之间没有服务依赖：menu 缺席时贡献只是等着接收者，不使贡献方受阻或失败（同文输出第 18 条）。
 * `nbook.commands` 的命令、`nbook.state` 的公开键都是这样接入的。
 *
 * 对应的场景：`scenarios/03-contribution-point.test.ts`。
 */

import {defineEntry, provide} from "@notnotype/nb-runtime/plugins";
import type {ContributionDescriptor, ContributionHandle, ContributionReceiver, PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {descriptor} from "../plugin";
import {MENU_POINT, menuKey} from "../shared/contracts";
import type {MenuItemDeclaration, MenuItemImplementation, MenuService} from "../shared/contracts";

type MenuHandle = ContributionHandle<MenuItemDeclaration, MenuItemImplementation>;

/**
 * 校验函数是纯函数：只看这一条贡献，返回拒绝原因或 null。它拿不到别的贡献，所以一条声明被不被接受，不会随别处的
 * 登记与撤销变化。声明可能来自以后的清单 JSON，所以按 `unknown` 逐项检查，不信任类型。
 */
function validateMenuItem(contribution: ContributionDescriptor): string | null {
    if (!contribution.id.startsWith(`${contribution.plugin}.`)) return `菜单项 id 要以插件 id ${contribution.plugin} 加“.”开头`;
    const title = (contribution.declaration as Partial<MenuItemDeclaration> | null)?.title;
    return typeof title === "string" && title.trim() !== "" ? null : "菜单项要有标题";
}

export const menuBackendPlugin: PluginDefinition = {
    id: descriptor.id,
    // 贡献点写在插件顶层：插件一登记，它就存在，别的插件的声明就按它的规则校验。`implementation: "required"` 表示
    // 贡献要写在入口下并在激活时给出实现；`none` 表示只有声明（例如纯配置）。
    contributionPoints: [{id: MENU_POINT, implementation: "required", validate: validateMenuItem}],
    entries: [
        defineEntry({
            id: "server",
            location: "server",
            provides: [menuKey],
            // 本入口接收自己插件定义的贡献点；激活产出的 `receivers` 必须恰好对应这里。
            receives: [MENU_POINT],
            activate: (context) => {
                const items = new Map<string, MenuHandle>();
                const receiver: ContributionReceiver<MenuItemDeclaration, MenuItemImplementation> = {
                    // 贡献方发布之后才放进表：在这之前它的激活还可能失败撤回，实现也还取不到。
                    published: (handle) => void items.set(handle.id, handle),
                    // 只删自己放进去的那一个：同一个 id 的新一代可能已经放进来了，不能把它误删。
                    revoke: (handle) => {
                        if (items.get(handle.id) === handle) items.delete(handle.id);
                    },
                };
                const menu: MenuService = {
                    items: async () => [...items.values()].map((handle) => ({id: handle.id, title: handle.declaration.title})),
                    titles: async () => context.declarations.list<MenuItemDeclaration>(MENU_POINT).map((item) => ({id: item.id, title: item.declaration.title, plugin: item.plugin})),
                    run: async (id) => {
                        const handle = items.get(id);
                        if (handle === undefined) return {ok: false, code: "unknown-item"};
                        // 每次执行都经 `implementation()` 取实现，不在 `published` 里存下来：撤回之后它会抛错，就不会调到
                        // 已经停止的贡献方的旧实现。
                        return {ok: true, value: await handle.implementation().run()};
                    },
                };
                return {services: [provide(menuKey, menu)], receivers: {[MENU_POINT]: receiver}};
            },
        }),
    ],
};
