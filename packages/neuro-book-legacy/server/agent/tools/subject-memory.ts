import {createHash} from "node:crypto";

export type SubjectEvent = {
    /** 系统 tick；为空表示事件没有绑定稳定 tick。 */
    tick?: string;
    /** 角色可理解的故事时间；为空表示未记录故事时间。 */
    time?: string;
    text: string;
};

export type SubjectMemory = {
    topic: string;
    /** 旧称、模糊称呼或被合并后的别名；为空表示没有别名。 */
    aliases?: string[];
    view: string;
};

export type JsonPatchOperation = JsonPatchAddOperation | JsonPatchRemoveOperation | JsonPatchReplaceOperation | JsonPatchMoveOperation | JsonPatchCopyOperation | JsonPatchTestOperation;

export type JsonPatchAddOperation = {
    op: "add";
    path: string;
    value: SubjectMemory | string | string[];
};

export type JsonPatchRemoveOperation = {
    op: "remove";
    path: string;
};

export type JsonPatchReplaceOperation = {
    op: "replace";
    path: string;
    value: SubjectMemory | string | string[];
};

export type JsonPatchMoveOperation = {
    op: "move";
    from: string;
    path: string;
};

export type JsonPatchCopyOperation = {
    op: "copy";
    from: string;
    path: string;
};

export type JsonPatchTestOperation = {
    op: "test";
    path: string;
    value: SubjectMemory | string | string[];
};

/**
 * 解析 subject events JSONL，并按第一版合同校验每条记录。
 */
export function parseSubjectEventsJsonl(content: string, filePath = "events.jsonl"): SubjectEvent[] {
    return parseJsonl(content, filePath).map((value, index) => parseSubjectEvent(value, `${filePath}:${index + 1}`));
}

/**
 * 解析 subject memory JSONL，并拒绝空 topic/view 与重复 topic。
 */
export function parseSubjectMemoriesJsonl(content: string, filePath = "memory.jsonl"): SubjectMemory[] {
    return validateSubjectMemories(parseJsonl(content, filePath).map((value, index) => parseSubjectMemory(value, `${filePath}:${index + 1}`)), filePath);
}

/**
 * 把 events 序列化为 JSONL，每条记录保持一行，便于 append-only 维护。
 */
export function serializeSubjectEventsJsonl(events: SubjectEvent[]): string {
    return events.map((event, index) => JSON.stringify(parseSubjectEvent(event, `events[${index}]`))).join("\n");
}

/**
 * 把当前 memory 集合序列化为 JSONL，并在写出前做完整校验。
 */
export function serializeSubjectMemoriesJsonl(memories: SubjectMemory[]): string {
    return validateSubjectMemories(memories, "memory.jsonl").map((memory) => JSON.stringify(memory)).join("\n");
}

/**
 * 校验单条 subject event；工具入口可直接复用，避免模型手写坏 JSONL。
 */
export function parseSubjectEvent(value: unknown, label = "event"): SubjectEvent {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} 必须是 object。`);
    }
    const record = value as Record<string, unknown>;
    const text = parseNonEmptyString(record.text, `${label}.text`);
    const event: SubjectEvent = {text};
    if (record.tick !== undefined) {
        event.tick = parseString(record.tick, `${label}.tick`);
    }
    if (record.time !== undefined) {
        event.time = parseString(record.time, `${label}.time`);
    }
    return event;
}

/**
 * 校验单条 subject memory；topic 是当前认知集合的稳定主键。
 */
export function parseSubjectMemory(value: unknown, label = "memory"): SubjectMemory {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} 必须是 object。`);
    }
    const record = value as Record<string, unknown>;
    const memory: SubjectMemory = {
        topic: parseNonEmptyString(record.topic, `${label}.topic`),
        view: parseNonEmptyString(record.view, `${label}.view`),
    };
    if (record.aliases !== undefined) {
        if (!Array.isArray(record.aliases)) {
            throw new Error(`${label}.aliases 必须是 string[]。`);
        }
        memory.aliases = record.aliases.map((alias, index) => parseNonEmptyString(alias, `${label}.aliases[${index}]`));
    }
    return memory;
}

/**
 * 校验 memory 集合，保证 topic 不重复。
 */
export function validateSubjectMemories(memories: SubjectMemory[], label = "memory.jsonl"): SubjectMemory[] {
    const topics = new Set<string>();
    const parsed = memories.map((memory, index) => parseSubjectMemory(memory, `${label}[${index}]`));
    for (const memory of parsed) {
        if (topics.has(memory.topic)) {
            throw new Error(`${label} 存在重复 topic：${memory.topic}`);
        }
        topics.add(memory.topic);
    }
    return parsed;
}

/**
 * 对 memory 集合应用 RFC 6902 JSON Patch 子集，然后重新校验 subject memory 合同。
 */
export function applySubjectMemoryPatch(memories: SubjectMemory[], patch: JsonPatchOperation[]): SubjectMemory[] {
    let document: unknown = structuredClone(validateSubjectMemories(memories));
    for (const operation of patch) {
        document = applyJsonPatchOperation(document, operation);
    }
    if (!Array.isArray(document)) {
        throw new Error("memory.curator patch 结果必须仍是 SubjectMemory[]。");
    }
    return validateSubjectMemories(document as SubjectMemory[]);
}

/**
 * 为 JSONL source 生成稳定 hash，用于后续 RAG dirty 检测。
 */
export function subjectMemorySourceHash(content: string): string {
    return createHash("sha256").update(content).digest("hex");
}

function parseJsonl(content: string, filePath: string): unknown[] {
    const values: unknown[] = [];
    const lines = content.split(/\r?\n/u);
    lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) {
            return;
        }
        try {
            values.push(JSON.parse(trimmed));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`${filePath}:${index + 1} 不是合法 JSON：${message}`);
        }
    });
    return values;
}

function parseString(value: unknown, label: string): string {
    if (typeof value !== "string") {
        throw new Error(`${label} 必须是 string。`);
    }
    return value;
}

function parseNonEmptyString(value: unknown, label: string): string {
    const text = parseString(value, label).trim();
    if (!text) {
        throw new Error(`${label} 不能为空。`);
    }
    return text;
}

function applyJsonPatchOperation(document: unknown, operation: JsonPatchOperation): unknown {
    switch (operation.op) {
        case "add":
            return addValue(document, operation.path, structuredClone(operation.value));
        case "remove":
            return removeValue(document, operation.path);
        case "replace":
            return replaceValue(document, operation.path, structuredClone(operation.value));
        case "move": {
            const value = getValue(document, operation.from);
            const without = removeValue(document, operation.from);
            return addValue(without, operation.path, structuredClone(value));
        }
        case "copy":
            return addValue(document, operation.path, structuredClone(getValue(document, operation.from)));
        case "test": {
            const current = getValue(document, operation.path);
            if (JSON.stringify(current) !== JSON.stringify(operation.value)) {
                throw new Error(`JSON Patch test 失败：${operation.path}`);
            }
            return document;
        }
        default:
            throw new Error(`不支持的 JSON Patch op：${(operation as {op?: string}).op}`);
    }
}

function getValue(document: unknown, pointer: string): unknown {
    const {parent, key} = resolvePointer(document, pointer);
    if (key === undefined) {
        return document;
    }
    if (Array.isArray(parent)) {
        const index = parseArrayIndex(key, parent.length, false);
        return parent[index];
    }
    if (isRecord(parent)) {
        return parent[key];
    }
    throw new Error(`JSON Pointer 不可读取：${pointer}`);
}

function addValue(document: unknown, pointer: string, value: unknown): unknown {
    const clone = structuredClone(document);
    const {parent, key} = resolvePointer(clone, pointer);
    if (key === undefined) {
        return value;
    }
    if (Array.isArray(parent)) {
        if (key === "-") {
            parent.push(value);
            return clone;
        }
        parent.splice(parseArrayIndex(key, parent.length, true), 0, value);
        return clone;
    }
    if (isRecord(parent)) {
        parent[key] = value;
        return clone;
    }
    throw new Error(`JSON Pointer 不可新增：${pointer}`);
}

function removeValue(document: unknown, pointer: string): unknown {
    const clone = structuredClone(document);
    const {parent, key} = resolvePointer(clone, pointer);
    if (key === undefined) {
        return undefined;
    }
    if (Array.isArray(parent)) {
        parent.splice(parseArrayIndex(key, parent.length, false), 1);
        return clone;
    }
    if (isRecord(parent) && key in parent) {
        delete parent[key];
        return clone;
    }
    throw new Error(`JSON Pointer 不可删除：${pointer}`);
}

function replaceValue(document: unknown, pointer: string, value: unknown): unknown {
    const clone = structuredClone(document);
    const {parent, key} = resolvePointer(clone, pointer);
    if (key === undefined) {
        return value;
    }
    if (Array.isArray(parent)) {
        parent[parseArrayIndex(key, parent.length, false)] = value;
        return clone;
    }
    if (isRecord(parent) && key in parent) {
        parent[key] = value;
        return clone;
    }
    throw new Error(`JSON Pointer 不可替换：${pointer}`);
}

function resolvePointer(document: unknown, pointer: string): {parent: unknown; key?: string} {
    if (pointer === "") {
        return {parent: document};
    }
    if (!pointer.startsWith("/")) {
        throw new Error(`JSON Pointer 必须以 / 开头：${pointer}`);
    }
    const parts = pointer.slice(1).split("/").map(unescapePointer);
    let parent = document;
    for (const part of parts.slice(0, -1)) {
        if (Array.isArray(parent)) {
            parent = parent[parseArrayIndex(part, parent.length, false)];
        } else if (isRecord(parent) && part in parent) {
            parent = parent[part];
        } else {
            throw new Error(`JSON Pointer 路径不存在：${pointer}`);
        }
    }
    return {parent, key: parts.at(-1)};
}

function unescapePointer(value: string): string {
    return value.replace(/~1/gu, "/").replace(/~0/gu, "~");
}

function parseArrayIndex(value: string, length: number, allowEnd: boolean): number {
    if (!/^(0|[1-9]\d*)$/u.test(value)) {
        throw new Error(`JSON Pointer 数组下标非法：${value}`);
    }
    const index = Number(value);
    const max = allowEnd ? length : length - 1;
    if (index < 0 || index > max) {
        throw new Error(`JSON Pointer 数组下标越界：${value}`);
    }
    return index;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
