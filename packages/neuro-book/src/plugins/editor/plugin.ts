import type {PluginDescriptor} from "nbook/manifest";

/**
 * 编辑器区（docs/specs/workbench/editor.md）：编辑组与标签、文档模型与两种编辑器。只有浏览器入口，是 `nbook.files` 的
 * 消费者，贡献给工作台的编辑器槽；资源管理器经它的文档协调服务结算未保存的修改。
 */
export const descriptor: PluginDescriptor = {id: "nbook.editor", version: "0.1.0", locations: ["browser"]};
