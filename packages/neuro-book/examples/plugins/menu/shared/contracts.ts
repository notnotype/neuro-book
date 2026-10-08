/**
 * `example.menu` 对其它插件公开的合同：贡献点 id、菜单项的声明与实现的形状、菜单服务。贡献菜单项的插件在运行时
 * 只引用这个文件，与 menu 之间没有服务依赖。
 *
 * 贡献分两半（docs/specs/runtime/plugins.md 的“术语与参与者”）：声明是写在插件定义里的数据，插件还没激活就能读到、
 * 能校验；实现是入口激活时交出的对象，激活之后才有。菜单的标题属于声明，点击之后做什么属于实现。
 */

import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

/**
 * 贡献点 id。贡献 id 写“贡献方的插件 id + `.` + 名字”，例如 `example.file-menu.open`：内核要求贡献 id 在同一个贡献点
 * 里唯一，两个插件写了同一个 id 时两条都被拒（docs/specs/runtime/plugins.md 输出第 15 条），所以拥有者要规定一种
 * 不会撞的取法，并在校验里检查。
 */
export const MENU_POINT = "menu.items";

/** 声明：写在贡献方入口的 `contributions` 里。 */
export interface MenuItemDeclaration {
    readonly title: string;
}

/** 实现：贡献方入口激活时交出。执行结果是给用户看的一句话。 */
export interface MenuItemImplementation {
    run(): Promise<string>;
}

export type MenuRunResult = {readonly ok: true; readonly value: string} | {readonly ok: false; readonly code: "unknown-item"};

/** 菜单服务（本地服务，按数据面约束写：方法返回 Promise，失败以结构化结果返回）。 */
export interface MenuService {
    /** 此刻能执行的菜单项：贡献方已经激活、交出了实现。按交付顺序。 */
    items(): Promise<ReadonlyArray<{readonly id: string; readonly title: string}>>;
    /** 已接受的全部声明：贡献方还没激活也在（例如先画出整份菜单，点到时再激活）。按贡献 id 排序。 */
    titles(): Promise<ReadonlyArray<{readonly id: string; readonly title: string; readonly plugin: string}>>;
    /** 执行一项；没有这一项（没登记、被拒、贡献方还没激活或已经停止）为 `unknown-item`。 */
    run(id: string): Promise<MenuRunResult>;
}

export const menuKey: ServiceKey<MenuService> = defineServiceKey<MenuService>("example.menu/menu");
