/**
 * 变量页签的覆盖集（docs/specs/ui/component-lab.md 的输出“变量 tab”）：校验单个值、整份快照的导入导出。导入是原子的：
 * 整份通过校验才替换，任何一项不合法都拒绝，旧的覆盖不变。快照格式与 nb-ui playground 的 Lab 相同，旧文件可以导入。
 */

export const LAB_OVERRIDE_SCHEMA = "nb-ui-component-lab-overrides" as const;
export const LAB_OVERRIDE_VERSION = 1 as const;

export type LabOverrideSnapshot = {
    schema: typeof LAB_OVERRIDE_SCHEMA;
    version: typeof LAB_OVERRIDE_VERSION;
    overrides: Record<string, string>;
};

export function validateOverrideValue(value: unknown): string {
    if (typeof value !== "string") {
        throw new Error("变量值必须是字符串");
    }
    const normalized = value.trim();
    if (normalized.length === 0) {
        throw new Error("变量值不能为空");
    }
    if (normalized.length > 512) {
        throw new Error("单个变量值不能超过 512 个字符");
    }
    if (/[;{}]/u.test(normalized)) {
        throw new Error("变量值不能包含分号或规则边界");
    }
    return normalized;
}

export function parseLabOverrideSnapshot(raw: string, allowedNames: ReadonlySet<string>): Record<string, string> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error("文件不是有效 JSON");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("快照必须是对象");
    }
    const snapshot = parsed as Partial<LabOverrideSnapshot>;
    if (snapshot.schema !== LAB_OVERRIDE_SCHEMA || snapshot.version !== LAB_OVERRIDE_VERSION) {
        throw new Error("快照 schema 或版本不受支持");
    }
    if (typeof snapshot.overrides !== "object" || snapshot.overrides === null || Array.isArray(snapshot.overrides)) {
        throw new Error("快照缺少 overrides 对象");
    }

    const next: Record<string, string> = {};
    for (const [name, value] of Object.entries(snapshot.overrides)) {
        if (!allowedNames.has(name)) {
            throw new Error(`未登记的变量：${name}`);
        }
        next[name] = validateOverrideValue(value);
    }
    return next;
}

export function serializeLabOverrideSnapshot(overrides: Readonly<Record<string, string>>): string {
    const snapshot: LabOverrideSnapshot = {
        schema: LAB_OVERRIDE_SCHEMA,
        version: LAB_OVERRIDE_VERSION,
        overrides: {...overrides},
    };
    return `${JSON.stringify(snapshot, null, 2)}\n`;
}
