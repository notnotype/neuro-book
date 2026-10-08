/**
 * `example.menu` 对其它插件公开的合同：贡献点、菜单项的声明与实现、菜单服务。
 * 贡献方只以 `import type` 引用这里，贡献点 id 写成同一个字面量（类型检查保证一致）。
 */

import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

/** 贡献点 id。贡献 id 以贡献方的插件 id 加 `.` 开头，例如 `example.file-menu.open`。 */
export const MENU_POINT = "menu.items";

/** 声明：写在贡献方的插件定义里，插件还没激活就能读到。 */
export interface MenuItemDeclaration {
    readonly title: string;
}

/** 实现：贡献方入口激活时交出。 */
export interface MenuItemImplementation {
    run(): string;
}

export interface MenuService {
    /** 当前可用的菜单项，按交付顺序。 */
    items(): ReadonlyArray<{readonly id: string; readonly title: string}>;
    /** 执行一项；没有这一项（未登记、被拒或已撤回）为 null。 */
    run(id: string): string | null;
}

export const menuKey: ServiceKey<MenuService> = defineServiceKey<MenuService>("example.menu/menu");
