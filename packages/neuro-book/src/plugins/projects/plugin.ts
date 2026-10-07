import type {PluginDescriptor} from "nbook/manifest";

/**
 * 项目管理的界面与给客户端的远程入口：服务端入口把宿主能力 `projectsKey` 的列出与登记包成远程服务，浏览器入口
 * 提供“打开项目”命令。项目的生命周期、登记表与租约归服务端宿主（docs/specs/runtime/projects.md）。
 */
export const descriptor: PluginDescriptor = {id: "nbook.projects", version: "0.1.0", locations: ["server", "browser"]};
