import type {PluginDescriptor} from "nbook/manifest";

import {librarySetting} from "./shared/contracts";

/**
 * 项目管理的界面与给客户端的远程入口：服务端入口把宿主能力 `projectsKey` 的列出、登记与书架的操作包成远程服务，浏览器
 * 入口提供“打开项目”命令与书架页，项目入口在项目实例里统计本项目给书架用。项目的生命周期、登记表与租约归服务端宿主
 * （docs/specs/runtime/projects.md）。作品目录的设置在这里声明。
 */
export const descriptor: PluginDescriptor = {id: "nbook.projects", version: "0.1.0", locations: ["server", "browser", "project"], contributions: [librarySetting.contribution]};
