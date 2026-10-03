import {STORAGE_MAX_VALUE_BYTES} from "nbook/shared/storage/contract";

/** JSON snapshots isolate queued writes from later caller mutations and never invoke accessors. */
export type StorageJsonValue = null | boolean | number | string
    | readonly StorageJsonValue[] | {readonly [key: string]: StorageJsonValue};

export const STORAGE_MAX_JSON_DEPTH = 64;

type JsonFailure =
    | {readonly ok: false; readonly kind: "invalid"; readonly reason: string}
    | {readonly ok: false; readonly kind: "oversize"; readonly bytes: number; readonly maxBytes: number};

export type StorageJsonInspection = {readonly ok: true; readonly bytes: number} | JsonFailure;
export type StorageJsonCapture = JsonFailure | {
    readonly ok: true;
    readonly bytes: number;
    readonly serialized: string;
    readonly value: StorageJsonValue;
};

const encoder = new TextEncoder();

/** Validate and capture the exact immutable value that may cross an asynchronous boundary. */
export function captureStorageJsonValue(value: unknown, maxBytes: number): StorageJsonCapture {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
        return {ok: false, kind: "invalid", reason: "JSON 容量必须是正整数"};
    }
    const ancestors = new Set<object>();
    const traversalBudget = Math.max(maxBytes, STORAGE_MAX_VALUE_BYTES);
    let minimumBytes = 0;
    const charge = (bytes: number): void => {
        minimumBytes += bytes;
        if (minimumBytes > traversalBudget) {
            throw new CaptureFailure({ok: false, kind: "oversize", bytes: minimumBytes, maxBytes});
        }
    };
    const invalid = (reason: string): never => {
        throw new CaptureFailure({ok: false, kind: "invalid", reason});
    };
    const visit = (node: unknown, depth: number): StorageJsonValue => {
        if (depth > STORAGE_MAX_JSON_DEPTH) return invalid("JSON 嵌套过深");
        if (node === null || typeof node === "boolean") {
            charge(node === false ? 5 : 4);
            return node;
        }
        if (typeof node === "string") {
            charge(node.length + 2);
            return node;
        }
        if (typeof node === "number") {
            if (!Number.isFinite(node)) return invalid("JSON 数值必须有限");
            charge(String(node).length);
            return node;
        }
        if (typeof node !== "object") return invalid("只允许 JSON 标量、数组和普通对象");
        if (ancestors.has(node)) return invalid("JSON 值不能包含循环引用");
        if (!Array.isArray(node) && Object.getPrototypeOf(node) !== Object.prototype && Object.getPrototypeOf(node) !== null) {
            return invalid("JSON 值不能是类实例");
        }
        if (Object.getOwnPropertySymbols(node).length > 0) return invalid("JSON 对象不能包含 Symbol 键");
        ancestors.add(node);
        charge(2);
        try {
            const descriptors = Object.getOwnPropertyDescriptors(node);
            if (Array.isArray(node)) {
                const result: StorageJsonValue[] = [];
                const keys = Object.keys(node);
                if (keys.length !== node.length) return invalid("JSON 数组不能包含空洞或附加属性");
                for (let index = 0; index < node.length; index += 1) {
                    const descriptor = descriptors[String(index)];
                    if (!descriptor || !("value" in descriptor)) return invalid("JSON 值不能包含访问器");
                    if (index > 0) charge(1);
                    result.push(visit(descriptor.value, depth + 1));
                }
                return Object.freeze(result);
            }
            const result: Record<string, StorageJsonValue> = Object.create(null);
            let count = 0;
            for (const [key, descriptor] of Object.entries(descriptors)) {
                if (!descriptor.enumerable) continue;
                if (!("value" in descriptor)) return invalid("JSON 值不能包含访问器");
                charge(key.length + 3 + (count++ > 0 ? 1 : 0));
                result[key] = visit(descriptor.value, depth + 1);
            }
            return Object.freeze(result);
        } finally {
            ancestors.delete(node);
        }
    };
    try {
        const captured = visit(value, 0);
        const serialized = JSON.stringify(captured);
        const bytes = encoder.encode(serialized).byteLength;
        return bytes > maxBytes
            ? {ok: false, kind: "oversize", bytes, maxBytes}
            : {ok: true, value: captured, serialized, bytes};
    } catch (error) {
        return error instanceof CaptureFailure
            ? error.failure
            : {ok: false, kind: "invalid", reason: "JSON 值无法安全读取"};
    }
}

/** Inspect without exposing the detached snapshot to callers that only need validation. */
export function inspectStorageJsonValue(value: unknown, maxBytes: number): StorageJsonInspection {
    const captured = captureStorageJsonValue(value, maxBytes);
    return captured.ok ? {ok: true, bytes: captured.bytes} : captured;
}

class CaptureFailure extends Error {
    constructor(readonly failure: JsonFailure) {
        super(failure.kind);
    }
}
