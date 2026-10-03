import type {ToolBinding} from "nbook/server/agent/tools/types";

/**
 * 测试专用：从 key 数组构造 profile tools 对象。
 *
 * 生产 profile 应显式使用 `toolset(builtin...)`，不要恢复数组式工具声明。
 */
export function profileToolsFromKeys<const TKeys extends readonly string[]>(keys: TKeys): {[K in TKeys[number]]: ToolBinding<K>} {
    const result: Record<string, ToolBinding> = {};
    for (const key of keys) {
        result[key] = {
            key,
        };
    }
    return result as {[K in TKeys[number]]: ToolBinding<K>};
}
