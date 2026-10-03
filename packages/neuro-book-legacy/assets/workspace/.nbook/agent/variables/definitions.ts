import type {VariableDefinition} from "nbook/variable-sdk";

/**
 * Workspace Root 级变量定义入口。
 *
 * Bundled assets 第一版不预置 global.* 业务变量；用户可在 user-assets
 * 覆盖这个文件后手动编译，运行时只加载 hash 匹配的 .compiled artifact。
 */
export const definitions: VariableDefinition[] = [];

export default definitions;
