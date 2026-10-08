/**
 * 示例 3：贡献点。拥有者插件定义扩展点，别的插件往里提交贡献。
 *
 * - `example.menu` 定义贡献点 `menu.items`：每条贡献是“声明 + 实现”。声明（标题）写在贡献方的插件定义里，
 *   插件激活前内核目录里就有它，并按拥有者的 `validate` 逐条校验；实现（点击时做什么）随贡献方入口激活交出。
 * - 拥有者入口激活时交出接收者（`receivers`）：内核把已可用的贡献交给它（`commit`）；贡献方或拥有者停止时
 *   撤回（`revoke`），每条交付恰好撤回一次。拥有者只维护自己的表，不用关心贡献方的激活顺序。
 * - 不合格的声明只拒绝那一条，同一插件的其它贡献照常；被拒的那条不要求给实现。
 * - 贡献方与拥有者之间没有服务依赖：拥有者缺席时贡献只是等着，不使贡献方失败。
 *
 * `nbook.commands` 的命令、`nbook.workbench` 的页面都是这样接入的。
 * 行为合同：docs/specs/runtime/plugins.md 输出第 15–18 条。
 * 运行：`bun packages/nb-runtime/examples/03-contribution-point.ts`。
 */

import {createApplication} from "@notnotype/nb-runtime/application";
import {provide} from "@notnotype/nb-runtime/plugins";
import type {ContributionHandle, ContributionReceiver, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {defineServiceKey} from "@notnotype/nb-runtime/services";

export const MENU_POINT = "menu.items";

/** 声明：插件不激活也能读到。 */
export interface MenuItemDeclaration {
    readonly title: string;
}

/** 实现：贡献方入口激活后才有。 */
export interface MenuItemImplementation {
    run(): string;
}

/** 拥有者对外的服务：列出当前可用的菜单项、执行其中一项。 */
export interface MenuService {
    titles(): ReadonlyArray<string>;
    run(id: string): string | null;
}

export const menuKey = defineServiceKey<MenuService>("example.menu/menu");

type MenuHandle = ContributionHandle<MenuItemDeclaration, MenuItemImplementation>;

export function menuPlugin(log: string[]): PluginDefinition {
    return {
        id: "example.menu",
        contributionPoints: [{
            id: MENU_POINT,
            // required：贡献写在入口下并给出实现；none：只有声明。
            implementation: "required",
            // 纯函数：只看这一条声明，返回拒绝原因或 null。
            validate: (descriptor) => ((descriptor.declaration as Partial<MenuItemDeclaration>).title?.trim() ? null : "菜单项要有标题"),
        }],
        entries: [{
            id: "main",
            location: "server",
            activationEvents: ["onStartup"],
            provides: [menuKey],
            receives: [MENU_POINT],
            activate: () => {
                const items = new Map<string, MenuHandle>();
                const receiver: ContributionReceiver<MenuItemDeclaration, MenuItemImplementation> = {
                    commit: (handle) => void items.set(handle.id, handle),
                    // 原因是 scope-closed（贡献方先停）或 receiver-closed（拥有者先停）；两者没有依赖时先后不定。
                    revoke: (handle) => {
                        items.delete(handle.id);
                        log.push(`撤回 ${handle.id}`);
                    },
                };
                const menu: MenuService = {
                    titles: () => [...items.values()].map((handle) => handle.declaration.title),
                    // 每次执行都经 implementation() 取实现：撤回之后不会再调到旧实现。
                    run: (id) => items.get(id)?.implementation().run() ?? null,
                };
                return {services: [provide(menuKey, menu)], receivers: {[MENU_POINT]: receiver}};
            },
        }],
    };
}

export function fileMenuPlugin(): PluginDefinition {
    return {
        id: "example.file-menu",
        entries: [{
            id: "main",
            location: "server",
            activationEvents: ["onStartup"],
            contributions: [
                {capability: MENU_POINT, id: "file.open", declaration: {title: "打开文件"}},
                {capability: MENU_POINT, id: "file.untitled", declaration: {title: ""}},
            ],
            // 只给通过校验的那一条实现；被拒的 file.untitled 不要求实现。
            activate: () => ({contributions: {[MENU_POINT]: {"file.open": {run: () => "已打开"} satisfies MenuItemImplementation}}}),
        }],
    };
}

/** 一个使用菜单服务的插件：示例从它这里拿到服务。 */
function shellPlugin(captured: {menu: MenuService | null}): PluginDefinition {
    return {
        id: "example.shell",
        entries: [{
            id: "main",
            location: "server",
            activationEvents: ["onStartup"],
            dependencies: [{key: menuKey}],
            activate: (context) => {
                captured.menu = context.services.require(menuKey);
                return {};
            },
        }],
    };
}

export async function runContributionPointExample(): Promise<{
    readonly titles: ReadonlyArray<string>;
    readonly ran: string | null;
    readonly rejected: unknown;
    readonly log: ReadonlyArray<string>;
}> {
    const log: string[] = [];
    const captured: {menu: MenuService | null} = {menu: null};
    const app = createApplication(
        {identity: {location: "server", instanceId: "example"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {keys: [menuKey], plugins: [menuPlugin(log), fileMenuPlugin(), shellPlugin(captured)], gates: []},
    );
    await app.startup;
    const titles = captured.menu?.titles() ?? [];
    const ran = captured.menu?.run("file.open") ?? null;
    // 目录查询：每条贡献的校验结果与原因，不需要激活任何插件。
    const rejected = app.plugins.contribution(MENU_POINT, "file.untitled")[0]?.validation;
    await app.stop();
    return {titles, ran, rejected, log};
}

if (import.meta.main) {
    console.log(await runContributionPointExample());
}
