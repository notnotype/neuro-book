import type {PluginDescriptor} from "nbook/manifest";

/**
 * 资源管理器：主页面侧栏的文件视图（docs/specs/workbench/files-explorer.md）。只有浏览器入口，是 `nbook.files` 的消费者：
 * 依赖方向是“界面 → 文件客户端”，Files 不知道界面。
 */
export const descriptor: PluginDescriptor = {id: "nbook.explorer", version: "0.1.0", locations: ["browser"]};
