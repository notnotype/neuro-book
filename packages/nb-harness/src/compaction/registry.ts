/** 压缩方法的注册表（docs/specs/harness/compaction.md 输出 1）。 */

import {createSoftCompaction} from "./soft";
import type {CompactionMethod, CompactionRegistry, CompactionResult} from "./types";

const BUILTIN_ID = /^[a-z][a-z0-9-]*$/u;
const PLUGIN_ID = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u;

function methodProblem(method: unknown): string | null {
    if (typeof method !== "object" || method === null) return "方法必须是对象";
    const {id, applicable, run} = method as Partial<CompactionMethod>;
    if (typeof id !== "string" || !(BUILTIN_ID.test(id) || PLUGIN_ID.test(id))) return "id 必须是 [a-z][a-z0-9-]* 或 <插件 id>/<名称>";
    if (typeof applicable !== "function") return "applicable 必须是函数";
    if (typeof run !== "function") return "run 必须是函数";
    return null;
}

export function createCompactionRegistry(): CompactionRegistry {
    const methods = new Map<string, CompactionMethod>();
    const registry: CompactionRegistry = {
        register(method) {
            const problem = methodProblem(method);
            if (problem !== null) return {ok: false, code: "invalid-method", detail: problem};
            if (methods.has(method.id)) return {ok: false, code: "duplicate-method", detail: `方法 ${method.id} 已注册`};
            // 存冻结副本，调用方之后改自己的对象不影响注册表；dispose 按这份副本的身份删除
            const stored: CompactionMethod = Object.freeze({id: method.id, applicable: method.applicable, run: method.run});
            methods.set(stored.id, stored);
            return {ok: true, value: {dispose: () => void (methods.get(stored.id) === stored && methods.delete(stored.id))}};
        },
        get: (id) => methods.get(id),
        list: () => [...methods.keys()],
    };
    const builtin: CompactionResult<unknown> = registry.register(createSoftCompaction());
    if (!builtin.ok) throw new Error(`内置方法注册失败：${builtin.detail}`);
    return registry;
}
