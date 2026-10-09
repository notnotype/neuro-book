import type {PluginDescriptor} from "nbook/manifest";

/**
 * 文件资源层：`project://`（项目实例）与 `user://`（服务端）两个真实目录型提供者，按需列出一层（三类文件夹的投影）、
 * 读取与条件保存、变更事件，以及浏览器里的文件客户端（docs/specs/workspace/resources.md）。
 */
export const descriptor: PluginDescriptor = {id: "nbook.files", version: "0.1.0", locations: ["server", "project", "browser"]};
