/**
 * 诊断的登记（docs/specs/canon/model.md 输入的“诊断的登记”表）：贡献点 `canon.diagnostics` 的声明，插件不激活也能读。
 *
 * 这里只管声明：id、版本、级别、稳定键由哪几部分组成。诊断的计算由插件的项目入口启动后另行登记（model.md 的
 * “诊断的计算”），与声明分开，因为声明在插件停用时也要能读到（作者对诊断的处理按版本比较，model.md 输出 35）。
 */

import {admitDeclarations, sortedVersions, type PluginContribution} from "./declarations";

export type DiagnosticKeyPart = "objects" | "line" | "telling" | "range" | "detail";

/** 贡献点 `canon.diagnostics` 的一条声明。 */
export interface DiagnosticDeclaration {
    readonly id: string;
    readonly version: number;
    readonly level: "pending" | "hint";
    readonly label: string;
    readonly key: readonly DiagnosticKeyPart[];
    readonly inputs?: string;
}

export interface DiagnosticRegistryDiagnostic {
    readonly code: "diagnostic-declaration-invalid";
    readonly diagnostic: string;
    readonly plugin: string;
    readonly path: string;
    readonly message: string;
}

export interface DiagnosticRegistry {
    readonly byId: (id: string) => (DiagnosticDeclaration & {readonly plugin: string}) | undefined;
    readonly diagnostics: readonly DiagnosticRegistryDiagnostic[];
    /** 登记的诊断的 `[id, 版本]`，按 id 排；读取输入的摘要用（model.md 输出 36）。 */
    readonly versions: readonly (readonly [string, number])[];
}

const KEY_PARTS: readonly DiagnosticKeyPart[] = ["objects", "line", "telling", "range", "detail"];

export function buildDiagnosticRegistry(contributions: readonly PluginContribution<DiagnosticDeclaration>[]): DiagnosticRegistry {
    const diagnostics: DiagnosticRegistryDiagnostic[] = [];
    const {admitted, rejected} = admitDeclarations(contributions);
    for (const item of rejected) diagnostics.push({code: "diagnostic-declaration-invalid", diagnostic: item.id, plugin: item.plugin, path: "id", message: item.message});
    const registered = new Map<string, DiagnosticDeclaration & {readonly plugin: string}>();
    for (const {id, plugin, declaration} of admitted) {
        const problem = declarationProblem(declaration);
        if (problem !== null) {
            diagnostics.push({code: "diagnostic-declaration-invalid", diagnostic: id, plugin, ...problem});
            continue;
        }
        registered.set(id, {
            id,
            version: declaration.version,
            level: declaration.level,
            label: declaration.label,
            key: [...declaration.key],
            ...(declaration.inputs === undefined ? {} : {inputs: declaration.inputs}),
            plugin,
        });
    }
    return {byId: (id) => registered.get(id), diagnostics, versions: sortedVersions(registered.values())};
}

export const EMPTY_DIAGNOSTIC_REGISTRY: DiagnosticRegistry = buildDiagnosticRegistry([]);

function declarationProblem(declaration: DiagnosticDeclaration): {path: string; message: string} | null {
    const value = declaration as unknown as Record<string, unknown>;
    if (!Number.isInteger(value.version) || (value.version as number) < 1) return {path: "version", message: "version must be a positive integer"};
    if (value.level !== "pending" && value.level !== "hint") return {path: "level", message: 'level must be "pending" or "hint"'};
    if (typeof value.label !== "string" || value.label === "") return {path: "label", message: "label must be a non-empty string"};
    const key = value.key;
    if (!Array.isArray(key) || key.length === 0) return {path: "key", message: "key needs at least one part"};
    for (const [index, part] of key.entries()) {
        if (!KEY_PARTS.includes(part as DiagnosticKeyPart)) return {path: `key[${String(index)}]`, message: `"${String(part)}" is not one of ${KEY_PARTS.join(", ")}`};
        if (key.indexOf(part) !== index) return {path: `key[${String(index)}]`, message: `"${String(part)}" appears twice`};
    }
    if (value.inputs !== undefined && typeof value.inputs !== "string") return {path: "inputs", message: "inputs must be text"};
    return null;
}
