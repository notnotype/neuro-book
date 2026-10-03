import type {
    LowCodeFieldOptionDto,
    LowCodeFieldOptionValueDto,
    LowCodeFormDto,
    LowCodeJsonObject,
    LowCodeJsonValue,
} from "nbook/shared/dto/low-code-form.dto";

/**
 * 为 option value 构造稳定 key，避免 string/number/boolean 的展示值冲突。
 */
export function optionKey(value: LowCodeFieldOptionValueDto): string {
    return `${typeof value}:${String(value)}`;
}

/**
 * 根据稳定 key 读取 option。
 */
export function optionByKey(options: readonly LowCodeFieldOptionDto[], key: string): LowCodeFieldOptionDto | undefined {
    return options.find((option) => optionKey(option.value) === key);
}

/**
 * 把低代码 JSON 值转换成适合紧凑 UI 展示的文本。
 */
export function formatLowCodeValue(value: LowCodeJsonValue | undefined): string {
    if (value === undefined) {
        return "";
    }
    if (value === null) {
        return "null";
    }
    if (Array.isArray(value)) {
        return value.map((item) => formatLowCodeValue(item)).join(", ");
    }
    if (typeof value === "object") {
        return JSON.stringify(value);
    }
    return String(value);
}

/**
 * 深拷贝 JSON 对象，隔离表单编辑状态。
 */
export function cloneLowCodeObject(value: LowCodeJsonObject | undefined): LowCodeJsonObject {
    return JSON.parse(JSON.stringify(value ?? {})) as LowCodeJsonObject;
}

/**
 * 深拷贝 JSON 值。
 */
export function cloneLowCodeValue(value: LowCodeJsonValue): LowCodeJsonValue {
    return JSON.parse(JSON.stringify(value)) as LowCodeJsonValue;
}

/**
 * 判断两个 JSON 值是否结构相同。
 */
export function lowCodeJsonEqual(left: LowCodeJsonValue | undefined, right: LowCodeJsonValue | undefined): boolean {
    if (left === undefined || right === undefined) {
        return left === right;
    }
    return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * 用点路径读取对象字段。第一版 settings 约定使用顶层字段，dot path 仅作轻量兼容。
 */
export function readLowCodePath(value: LowCodeJsonObject, path: string): LowCodeJsonValue | undefined {
    const segments = path.split(".").filter(Boolean);
    let current: LowCodeJsonValue | undefined = value;
    for (const segment of segments) {
        if (!current || typeof current !== "object" || Array.isArray(current)) {
            return undefined;
        }
        current = current[segment];
    }
    return current;
}

/**
 * 写入点路径字段，并返回新对象。
 */
export function setLowCodePath(source: LowCodeJsonObject, path: string, fieldValue: LowCodeJsonValue): LowCodeJsonObject {
    const segments = path.split(".").filter(Boolean);
    if (segments.length === 0) {
        return cloneLowCodeObject(source);
    }
    const next = cloneLowCodeObject(source);
    let current: LowCodeJsonObject = next;
    for (const segment of segments.slice(0, -1)) {
        const child = current[segment];
        if (!child || typeof child !== "object" || Array.isArray(child)) {
            current[segment] = {};
        }
        current = current[segment] as LowCodeJsonObject;
    }
    current[segments[segments.length - 1]!] = cloneLowCodeValue(fieldValue);
    return next;
}

/**
 * 删除点路径字段，并返回新对象。
 */
export function deleteLowCodePath(source: LowCodeJsonObject, path: string): LowCodeJsonObject {
    const segments = path.split(".").filter(Boolean);
    if (segments.length === 0) {
        return cloneLowCodeObject(source);
    }
    const next = cloneLowCodeObject(source);
    let current: LowCodeJsonValue | undefined = next;
    for (const segment of segments.slice(0, -1)) {
        if (!current || typeof current !== "object" || Array.isArray(current)) {
            return next;
        }
        current = current[segment];
    }
    if (current && typeof current === "object" && !Array.isArray(current)) {
        delete current[segments[segments.length - 1]!];
    }
    return next;
}

/**
 * 判断点路径字段是否存在。
 */
export function hasLowCodePath(source: LowCodeJsonObject, path: string): boolean {
    return readLowCodePath(source, path) !== undefined;
}

/**
 * 提交表单时把展示层默认值合并进 payload。
 */
export function withLowCodeFormDefaults(form: LowCodeFormDto, value: LowCodeJsonObject): LowCodeJsonObject {
    let next = cloneLowCodeObject(value);
    for (const field of form.fields) {
        if (hasLowCodePath(next, field.path)) {
            continue;
        }
        const defaultValue = hasLowCodePath(form.defaults, field.path)
            ? readLowCodePath(form.defaults, field.path)
            : field.defaultValue;
        if (defaultValue !== undefined) {
            next = setLowCodePath(next, field.path, defaultValue);
        }
    }
    return next;
}
