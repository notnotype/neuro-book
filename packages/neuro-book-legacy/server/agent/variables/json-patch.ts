import type {JsonValue} from "nbook/server/agent/messages/types";
import type {VariableJsonPatchOperation} from "nbook/server/agent/variables/types";
import {cloneJsonValue} from "nbook/server/agent/variables/registry";

/**
 * 应用变量系统支持的 RFC 6902 JSON Patch 子集。
 */
export function applyVariableJsonPatch(value: JsonValue | undefined, operations: VariableJsonPatchOperation[]): JsonValue {
    let current: JsonValue = value === undefined ? null : cloneJsonValue(value);
    for (const operation of operations) {
        if (operation.path === "") {
            if (operation.op === "remove") {
                current = null;
                continue;
            }
            if (operation.op === "test") {
                assertJsonEqual(current, operation.value, operation.path);
                continue;
            }
            current = cloneJsonValue(operation.value);
            continue;
        }
        const path = parseJsonPointer(operation.path);
        const target = resolveParent(current, path);
        const key = path.at(-1);
        if (key === undefined) {
            throw new Error("JSON Patch path 不能为空。");
        }
        if (operation.op === "remove") {
            removeValue(target.parent, key);
            continue;
        }
        if (operation.op === "test") {
            assertJsonEqual(readValue(target.parent, key), operation.value, operation.path);
            continue;
        }
        writeValue(target.parent, key, cloneJsonValue(operation.value), operation.op);
    }
    return current;
}

function parseJsonPointer(path: string): string[] {
    if (!path.startsWith("/")) {
        throw new Error(`JSON Patch path 必须是 JSON Pointer 或空字符串：${path}`);
    }
    return path.slice(1).split("/").map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function resolveParent(value: JsonValue, path: string[]): {parent: JsonValue} {
    let current: JsonValue = value;
    for (const segment of path.slice(0, -1)) {
        if (Array.isArray(current)) {
            const index = readArrayIndex(segment, current.length);
            current = mustJsonValue(current[index], segment);
            continue;
        }
        if (!current || typeof current !== "object") {
            throw new Error(`JSON Patch 无法下钻到 ${segment}。`);
        }
        current = mustJsonValue(current[segment], segment);
    }
    return {parent: current};
}

function readValue(parent: JsonValue, key: string): JsonValue {
    if (Array.isArray(parent)) {
        return mustJsonValue(parent[readArrayIndex(key, parent.length)], key);
    }
    if (!parent || typeof parent !== "object") {
        throw new Error(`JSON Patch target 不是 object/array：${key}`);
    }
    return mustJsonValue(parent[key], key);
}

function writeValue(parent: JsonValue, key: string, value: JsonValue, op: "add" | "replace"): void {
    if (Array.isArray(parent)) {
        const index = key === "-" ? parent.length : readArrayIndex(key, op === "add" ? parent.length + 1 : parent.length);
        if (op === "add") {
            parent.splice(index, 0, value);
        } else {
            parent[index] = value;
        }
        return;
    }
    if (!parent || typeof parent !== "object") {
        throw new Error(`JSON Patch target 不是 object/array：${key}`);
    }
    if (op === "replace" && !(key in parent)) {
        throw new Error(`JSON Patch replace 的字段不存在：${key}`);
    }
    parent[key] = value;
}

function removeValue(parent: JsonValue, key: string): void {
    if (Array.isArray(parent)) {
        parent.splice(readArrayIndex(key, parent.length), 1);
        return;
    }
    if (!parent || typeof parent !== "object") {
        throw new Error(`JSON Patch target 不是 object/array：${key}`);
    }
    delete parent[key];
}

function readArrayIndex(segment: string, length: number): number {
    if (!/^\d+$/.test(segment)) {
        throw new Error(`JSON Patch 数组下标非法：${segment}`);
    }
    const index = Number(segment);
    if (index < 0 || index >= length) {
        throw new Error(`JSON Patch 数组下标越界：${segment}`);
    }
    return index;
}

function assertJsonEqual(left: JsonValue, right: JsonValue, path: string): void {
    if (JSON.stringify(left) !== JSON.stringify(right)) {
        throw new Error(`JSON Patch test 失败：${path}`);
    }
}

function mustJsonValue(value: JsonValue | undefined, path: string): JsonValue {
    if (value === undefined) {
        throw new Error(`JSON Patch path 不存在：${path}`);
    }
    return value;
}
