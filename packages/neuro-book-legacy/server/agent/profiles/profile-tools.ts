/**
 * Profile tools 的历史宿主入口。
 *
 * 作者与内置 Profile 必须消费同一套 SDK binding；工具执行实现仍由 SDK Adapter
 * 挂载为宿主私有 runtime carrier，不从这个入口重新声明第二套类型。
 */
export {
    builtin,
    defineProfileTool,
    plotReadBindings,
    plotWriteBindings,
    pluginTool,
    toolset,
} from "nbook/profile-sdk";

export type {
    AgentToolDefinition,
    ProfileTools,
    ReportResultToolBinding,
    ToolBinding,
} from "nbook/profile-sdk";
