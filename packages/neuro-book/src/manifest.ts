/**
 * 产品清单：本应用加载哪些插件，唯一入口。
 *
 * 这里只引用各插件的描述（`plugins/<插件>/plugin.ts`），不引用任何一侧的实现；后端与前端宿主
 * 各自按清单装配本侧入口，清单里写了某个运行位置、宿主却没有对应实现时装配直接失败。
 */

import type {RuntimeLocation} from "@notnotype/nb-runtime/lifecycle";

import {descriptor as diagnostics} from "./plugins/diagnostics/plugin";
import {descriptor as http} from "./plugins/http/plugin";
import {descriptor as workbench} from "./plugins/workbench/plugin";

export interface PluginDescriptor {
    readonly id: string;
    /** 浏览器入口随前端构建：窗口按 id 与版本核对后端引导返回的集合，不一致即提示刷新。 */
    readonly version: string;
    /** 插件在哪些运行位置有入口。 */
    readonly locations: ReadonlyArray<RuntimeLocation>;
}

export const productPlugins: ReadonlyArray<PluginDescriptor> = [diagnostics, http, workbench];
