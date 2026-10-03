/**
 * World Engine 运行时 patch apply 模块。
 *
 * 实现 JSON Pointer 风格的 4 种操作：
 * - replace: 替换指定路径的值
 * - increment: 数值累加
 * - remove: 删除指定路径
 * - append: 数组追加（自动去重 unique 数组）
 *
 * 路径格式：JSON Pointer（`/equipment/head`）
 * 跨引用操作禁止：路径不能穿过 `subject://id` 引用
 */

import type {
    JsonValue,
    PatchInput,
    WorldAttrSchema,
    WorldIssueCode,
    ZodSchemaUniqueArrays,
} from "nbook/server/world-engine/types";

const MISSING = Symbol("missing");

/** Patch 操作错误。新写入时通常走 error；旧数据 reduce 显形时会被转换成 WorldIssue。 */
export type PatchIssue = {
    code: Extract<WorldIssueCode, "broken-relative" | "cross-ref" | "invalid-path" | "embedding-whole-replace">;
    path: string;
    message: string;
};

/**
 * 应用一个 patch 到 reduce 状态。
 *
 * @param state - 当前状态对象
 * @param patch - patch 操作
 * @param attrSchema - 属性 schema（用于类型校验）
 * @param uniqueArrays - unique 数组路径集合
 * @returns 如果操作失败，返回 issue；否则返回 null
 */
export function applyPatch(
    state: Record<string, JsonValue>,
    patch: PatchInput,
    attrSchema: WorldAttrSchema | null,
    uniqueArrays: ZodSchemaUniqueArrays,
): PatchIssue | null {
    const path = patch.path;

    // 1. 验证路径格式（必须以 / 开头）
    if (!path.startsWith("/")) {
        return {
            code: "invalid-path",
            path,
            message: `路径必须以 / 开头（JSON Pointer 格式）：${path}`,
        };
    }

    // 2. 检查跨引用操作
    const crossRefIssue = detectCrossRefOperation(state, path);
    if (crossRefIssue) {
        return crossRefIssue;
    }

    // 2.5 禁止对 embedding 字段整块 replace（Decision #16）。
    // embedding 字段（memory / events）必须按 key/元素写入，一条 EmbeddingText = 一行 patch，
    // 这样向量才能落到 WorldPatch 的 vector 列。整块 replace 会让一行承载多个向量，无法表达。
    // attrSchema 由调用方按 path 解析；当它带 embedding 标记时，说明 path 命中的是容器本身。
    if (patch.op === "replace" && attrSchema?.embedding && !isEmptyEmbeddingContainer(patch.value, attrSchema.embedding)) {
        const hint = attrSchema.embedding === "record" ? `replace ${path}/<key>` : `append ${path}`;
        return {
            code: "embedding-whole-replace",
            path,
            message: `embedding 字段 ${path} 禁止整块 replace 写入非空内容；空容器 replace（[] / {}）仅可用于初始化。真实文本请按 key/元素单条写入（如 ${hint}，value: {text:"..."}），vector 由系统维护。`,
        };
    }

    // 3. 执行操作
    switch (patch.op) {
        case "remove":
            return applyRemove(state, path, patch.value, uniqueArrays);
        case "replace":
            return applyReplace(state, path, toJsonValue(patch.value ?? null));
        case "increment":
            return applyIncrement(state, path, patch.value, attrSchema);
        case "append":
            return applyAppend(state, path, toJsonValue(patch.value ?? null), uniqueArrays);
        default:
            return {
                code: "invalid-path",
                path,
                message: `不支持的操作：${(patch as {op?: string}).op ?? ""}`,
            };
    }
}

/**
 * 检测跨引用操作。
 *
 * 规则：路径不能穿过 `subject://id` 引用。
 * 例如：`/equipment/armor/chest` → `subject://mythril-plate` 是允许的，
 * 但 `/equipment/armor/chest/durability` 是禁止的（穿过了引用）。
 */
function detectCrossRefOperation(
    state: Record<string, JsonValue>,
    path: string,
): PatchIssue | null {
    const parts = parseJsonPointer(path);
    let current: JsonValue = state;

    // 遍历路径的每一段（除了最后一段）
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (part === undefined) {
            break;
        }

        if (isObject(current) && part in current) {
            current = current[part] ?? null;

            // 如果当前值是引用，且路径还要继续深入，则报错
            if (typeof current === "string" && current.startsWith("subject://")) {
                return {
                    code: "cross-ref",
                    path,
                    message: `禁止跨引用操作：路径 ${path} 尝试穿过引用 ${current}。请分别操作引用和引用目标。`,
                };
            }
        } else if (Array.isArray(current)) {
            const index = Number.parseInt(part, 10);
            if (!Number.isNaN(index) && index >= 0 && index < current.length) {
                current = current[index] ?? null;

                // 数组元素是引用时同样禁止
                if (typeof current === "string" && current.startsWith("subject://")) {
                    return {
                        code: "cross-ref",
                        path,
                        message: `禁止跨引用操作：路径 ${path} 尝试穿过数组元素引用 ${current}。`,
                    };
                }
            } else {
                break;
            }
        } else {
            break;
        }
    }

    return null;
}

/**
 * remove 操作：删除指定路径。
 */
function applyRemove(
    state: Record<string, JsonValue>,
    path: string,
    value: JsonValue | undefined,
    uniqueArrays: ZodSchemaUniqueArrays,
): PatchIssue | null {
    const parts = parseJsonPointer(path);
    if (parts.length === 0) {
        return {
            code: "invalid-path",
            path,
            message: "不能删除根路径",
        };
    }

    if (value !== undefined) {
        const current = navigateToValue(state, parts);
        if (current === MISSING) {
            return null;
        }
        if (!Array.isArray(current)) {
            return {
                code: "invalid-path",
                path,
                message: `按值 remove 只能作用于 collection 数组：${path}`,
            };
        }

        const attrPath = path.slice(1).replace(/\//g, ".");
        if (!uniqueArrays.has(attrPath)) {
            return {
                code: "invalid-path",
                path,
                message: `list 不支持按值删：${path}`,
            };
        }

        const targetJson = stableJson(value);
        const index = current.findIndex((item) => stableJson(item) === targetJson);
        if (index >= 0) {
            current.splice(index, 1);
        }
        return null;
    }

    const parent = navigateToParent(state, parts);
    if (parent === MISSING) {
        // 路径不存在，remove 是幂等的，不报错
        return null;
    }

    const lastKey = parts[parts.length - 1];
    if (lastKey === undefined) {
        return {
            code: "invalid-path",
            path,
            message: "不能删除根路径",
        };
    }

    if (isObject(parent)) {
        delete parent[lastKey];
        return null;
    }

    if (Array.isArray(parent)) {
        const index = Number.parseInt(lastKey, 10);
        if (Number.isNaN(index) || index < 0 || index >= parent.length) {
            return null; // 索引越界，幂等
        }
        parent.splice(index, 1);
        return null;
    }

    return {
        code: "invalid-path",
        path,
        message: `无法对非对象/数组执行 remove：${path}`,
    };
}

/**
 * replace 操作：替换指定路径的值。
 */
function applyReplace(
    state: Record<string, JsonValue>,
    path: string,
    value: JsonValue,
): PatchIssue | null {
    const parts = parseJsonPointer(path);
    if (parts.length === 0) {
        // 替换根对象：清空 state，合并新值
        if (!isObject(value)) {
            return {
                code: "invalid-path",
                path,
                message: "替换根路径时值必须是对象",
            };
        }
        for (const key of Object.keys(state)) {
            delete state[key];
        }
        Object.assign(state, value);
        return null;
    }

    const parent = navigateToParent(state, parts, true);
    if (parent === MISSING) {
        return {
            code: "invalid-path",
            path,
            message: `replace 失败：父路径不存在：${path}`,
        };
    }

    const lastKey = parts[parts.length - 1];
    if (lastKey === undefined) {
        return {
            code: "invalid-path",
            path,
            message: "不能 replace 根路径",
        };
    }

    if (isObject(parent)) {
        parent[lastKey] = value;
        return null;
    }

    if (Array.isArray(parent)) {
        const index = Number.parseInt(lastKey, 10);
        if (Number.isNaN(index) || index < 0) {
            return {
                code: "invalid-path",
                path,
                message: `无效的数组索引：${lastKey}`,
            };
        }
        // 允许扩展数组（index === length 时追加）
        if (index > parent.length) {
            return {
                code: "invalid-path",
                path,
                message: `数组索引越界：${index}（长度 ${parent.length}）`,
            };
        }
        parent[index] = value;
        return null;
    }

    return {
        code: "invalid-path",
        path,
        message: `无法对非对象/数组执行 replace：${path}`,
    };
}

/**
 * increment 操作：数值累加。
 */
function applyIncrement(
    state: Record<string, JsonValue>,
    path: string,
    value: unknown,
    attrSchema: WorldAttrSchema | null,
): PatchIssue | null {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return {
            code: "broken-relative",
            path,
            message: `increment 的值必须是有限数值，实际：${typeof value}`,
        };
    }

    const parts = parseJsonPointer(path);
    const current = navigateToValue(state, parts);

    if (current === MISSING) {
        return {
            code: "broken-relative",
            path,
            message: `increment ${path} 缺少已存在的数值基准`,
        };
    }

    if (typeof current !== "number" || !Number.isFinite(current)) {
        return {
            code: "broken-relative",
            path,
            message: `increment ${path} 基准不是有限数值，实际：${typeof current}`,
        };
    }

    const result = current + value;

    if (!Number.isFinite(result)) {
        return {
            code: "broken-relative",
            path,
            message: `increment ${path} 结果不是有限数值`,
        };
    }

    // 如果是 int 类型，检查安全整数范围
    if (attrSchema?.type === "int") {
        if (!Number.isSafeInteger(current) || !Number.isSafeInteger(value)) {
            return {
                code: "broken-relative",
                path,
                message: `increment ${path} 基准或增量不是安全整数`,
            };
        }
        if (!Number.isSafeInteger(result)) {
            return {
                code: "broken-relative",
                path,
                message: `increment ${path} 结果超出安全整数范围`,
            };
        }
    }

    // 写回结果
    const parent = navigateToParent(state, parts);
    if (parent === MISSING) {
        return {
            code: "invalid-path",
            path,
            message: `increment 失败：父路径不存在：${path}`,
        };
    }

    const lastKey = parts[parts.length - 1];
    if (lastKey === undefined) {
        return {
            code: "invalid-path",
            path,
            message: "不能 increment 根路径",
        };
    }

    if (isObject(parent)) {
        parent[lastKey] = result;
    } else if (Array.isArray(parent)) {
        const index = Number.parseInt(lastKey, 10);
        parent[index] = result;
    }

    return null;
}

/**
 * append 操作：数组追加（自动去重 unique 数组）。
 */
function applyAppend(
    state: Record<string, JsonValue>,
    path: string,
    value: JsonValue,
    uniqueArrays: ZodSchemaUniqueArrays,
): PatchIssue | null {
    const parts = parseJsonPointer(path);
    const current = navigateToValue(state, parts);

    if (current === MISSING) {
        return {
            code: "broken-relative",
            path,
            message: `append ${path} 缺少已存在的数组基准`,
        };
    }

    if (!Array.isArray(current)) {
        return {
            code: "broken-relative",
            path,
            message: `append ${path} 基准不是数组，实际：${typeof current}`,
        };
    }

    // 检查是否是 unique 数组（需要去重）
    const attrPath = path.slice(1).replace(/\//g, "."); // 转换为点号路径
    const isUnique = uniqueArrays.has(attrPath);

    if (isUnique) {
        // 去重：如果值已存在，不追加
        const valueJson = stableJson(value);
        const exists = current.some((item) => stableJson(item) === valueJson);
        if (exists) {
            // 幂等：值已存在，不追加
            return null;
        }
    }

    // 追加值
    current.push(value);

    return null;
}

/**
 * 解析 JSON Pointer 路径。
 *
 * 例如：`/equipment/head` → `["equipment", "head"]`
 *      `/` → `[]`
 */
function parseJsonPointer(path: string): string[] {
    if (path === "/") {
        return [];
    }

    return path
        .slice(1) // 去掉开头的 /
        .split("/")
        .map((part) =>
            part
                .replace(/~1/g, "/") // JSON Pointer 转义：~1 → /
                .replace(/~0/g, "~") // ~0 → ~
        );
}

/**
 * 导航到路径的父对象。
 *
 * @param createIntermediate - 如果为 true，自动创建中间对象
 * @returns 父对象，或 MISSING（路径不存在）
 */
function navigateToParent(
    state: Record<string, JsonValue>,
    parts: string[],
    createIntermediate = false,
): Record<string, JsonValue> | JsonValue[] | typeof MISSING {
    if (parts.length === 0) {
        return MISSING;
    }

    let current: JsonValue = state;

    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (part === undefined) {
            return MISSING;
        }

        if (isObject(current)) {
            if (!(part in current)) {
                if (createIntermediate) {
                    current[part] = {};
                } else {
                    return MISSING;
                }
            }
            current = current[part] ?? null;
        } else if (Array.isArray(current)) {
            const index = Number.parseInt(part, 10);
            if (Number.isNaN(index) || index < 0 || index >= current.length) {
                return MISSING;
            }
            current = current[index] ?? null;
        } else {
            return MISSING;
        }
    }

    if (isObject(current) || Array.isArray(current)) {
        return current as Record<string, JsonValue> | JsonValue[];
    }

    return MISSING;
}

/**
 * 导航到路径的值。
 */
function navigateToValue(
    state: Record<string, JsonValue>,
    parts: string[],
): JsonValue | typeof MISSING {
    if (parts.length === 0) {
        return state;
    }

    let current: JsonValue = state;

    for (const part of parts) {
        if (isObject(current) && part in current) {
            current = current[part] ?? null;
        } else if (Array.isArray(current)) {
            const index = Number.parseInt(part, 10);
            if (Number.isNaN(index) || index < 0 || index >= current.length) {
                return MISSING;
            }
            current = current[index] ?? null;
        } else {
            return MISSING;
        }
    }

    return current;
}

/**
 * 判断是否为对象（非 null，非数组）。
 */
function isObject(value: JsonValue): value is Record<string, JsonValue> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * EmbeddingText 容器允许空 replace 作为初始化基准。
 *
 * 非空内容仍必须按单条写入，保证一条 EmbeddingText 对应一行 WorldPatch/vector。
 */
function isEmptyEmbeddingContainer(value: unknown, embedding: "record" | "array"): boolean {
    if (embedding === "array") {
        return Array.isArray(value) && value.length === 0;
    }
    return isObjectLike(value) && Object.keys(value).length === 0;
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/**
 * 转换为 JsonValue（处理 undefined → null）。
 */
function toJsonValue(value: unknown): JsonValue {
    if (value === undefined) {
        return null;
    }
    return value as JsonValue;
}

/**
 * 稳定的 JSON 序列化（用于对象/数组比较）。
 */
function stableJson(value: JsonValue): string {
    if (value === null) {
        return "null";
    }
    if (typeof value === "object") {
        if (Array.isArray(value)) {
            return `[${value.map(stableJson).join(",")}]`;
        }
        const keys = Object.keys(value).sort();
        return `{${keys.map((key) => `"${key}":${stableJson(value[key] ?? null)}`).join(",")}}`;
    }
    return JSON.stringify(value);
}
