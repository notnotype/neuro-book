/**
 * 标注种类的登记（docs/specs/canon/components.md 输入的“标注种类的登记”表、输出 17）与标注的校验（model.md 输出 28）。
 *
 * 声明来自插件清单的 `canon.marks` 贡献，宿主每次贡献集合变化时整份交进来，并带上声明它的插件 id（前缀判定要用）；
 * 这里重新建一份登记，不做增量。
 *
 * 载荷的 schema 只收一组白名单关键字，理由有两条：内核要能沿 `properties`、`items` 静态地找到 `refs` 指的位置；
 * 载荷过不过校验不能取决于校验器怎样解释冷门关键字。校验用 TypeBox 的 JSON Schema 校验器（`typebox/schema`），
 * 每个种类在登记时编译一次。
 */

import {Compile} from "typebox/schema";

import {admitDeclarations, sortedVersions, type PluginContribution} from "./declarations";

export type MarkTarget = "telling" | "change" | "decision";
export type MarkRefKind = "entry" | "change" | "line" | "decision";

/** 贡献点 `canon.marks` 的一条声明。 */
export interface MarkDeclaration {
    readonly id: string;
    readonly version: number;
    readonly label: string;
    readonly attachTo: readonly MarkTarget[];
    /** 载荷的 JSON Schema，不含 `kind`、`version` 两个键。 */
    readonly schema: Readonly<Record<string, unknown>>;
    readonly refs?: readonly {readonly path: string; readonly kind?: MarkRefKind; readonly targets?: readonly string[]}[];
}

export interface MarkRef {
    readonly path: string;
    readonly kind: MarkRefKind;
    readonly targets?: readonly string[];
}

/** 登记成功、可用的标注种类。 */
export interface MarkType {
    readonly id: string;
    readonly version: number;
    readonly label: string;
    readonly attachTo: readonly MarkTarget[];
    readonly refs: readonly MarkRef[];
    /** 载荷（去掉 `kind`、`version`）不合 schema 时给出第一处问题，合格时为 null。 */
    readonly payloadProblem: (payload: unknown) => string | null;
}

export interface MarkRegistryDiagnostic {
    readonly code: "mark-declaration-invalid";
    readonly kind: string;
    readonly plugin: string;
    readonly path: string;
    readonly message: string;
}

export interface MarkRegistry {
    readonly byKind: (kind: string) => MarkType | undefined;
    readonly diagnostics: readonly MarkRegistryDiagnostic[];
    /** 可用种类的 `[id, 版本]`，按 id 排；读取输入的摘要用（model.md 输出 36）。 */
    readonly versions: readonly (readonly [string, number])[];
}

const TARGETS: readonly MarkTarget[] = ["telling", "change", "decision"];
const REF_KINDS: readonly MarkRefKind[] = ["entry", "change", "line", "decision"];
const JSON_TYPES = new Set(["string", "number", "integer", "boolean", "object", "array", "null"]);
/** 注释类的关键字照收、不起作用（components.md 输出 17）。 */
const ANNOTATIONS = new Set(["description", "title", "$id", "default", "examples"]);

export function buildMarkRegistry(contributions: readonly PluginContribution<MarkDeclaration>[]): MarkRegistry {
    const diagnostics: MarkRegistryDiagnostic[] = [];
    const {admitted, rejected} = admitDeclarations(contributions);
    for (const item of rejected) diagnostics.push({code: "mark-declaration-invalid", kind: item.id, plugin: item.plugin, path: "id", message: item.message});
    const available = new Map<string, MarkType>();
    for (const {id, plugin, declaration} of admitted) {
        const problem = declarationProblem(declaration);
        if (problem !== null) {
            diagnostics.push({code: "mark-declaration-invalid", kind: id, plugin, ...problem});
            continue;
        }
        const validator = Compile(declaration.schema as never);
        available.set(id, {
            id,
            version: declaration.version,
            label: declaration.label,
            attachTo: [...declaration.attachTo],
            refs: (declaration.refs ?? []).map((ref) => ({path: ref.path, kind: ref.kind ?? "entry", ...(ref.targets === undefined ? {} : {targets: [...ref.targets]})})),
            payloadProblem: (payload) => {
                if (validator.Check(payload)) return null;
                const [, errors] = validator.Errors(payload);
                const first = errors[0];
                return first === undefined ? "payload does not match the schema" : `${first.instancePath === "" ? "payload" : first.instancePath} ${first.message}`;
            },
        });
    }
    return {byKind: (kind) => available.get(kind), diagnostics, versions: sortedVersions(available.values())};
}

export const EMPTY_MARK_REGISTRY: MarkRegistry = buildMarkRegistry([]);

function declarationProblem(declaration: MarkDeclaration): {path: string; message: string} | null {
    const value = declaration as unknown as Record<string, unknown>;
    if (!Number.isInteger(value.version) || (value.version as number) < 1) return {path: "version", message: "version must be a positive integer"};
    if (typeof value.label !== "string" || value.label === "") return {path: "label", message: "label must be a non-empty string"};
    const attachTo = value.attachTo;
    if (!Array.isArray(attachTo) || attachTo.length === 0) return {path: "attachTo", message: "attachTo must be a non-empty list"};
    for (const [index, target] of attachTo.entries()) {
        if (!TARGETS.includes(target as MarkTarget)) return {path: `attachTo[${String(index)}]`, message: `"${String(target)}" is not one of ${TARGETS.join(", ")}`};
        if (attachTo.indexOf(target) !== index) return {path: `attachTo[${String(index)}]`, message: `"${String(target)}" appears twice`};
    }
    const schema = value.schema;
    if (!isRecord(schema)) return {path: "schema", message: "schema must be an object"};
    const keyword = keywordProblem(schema, "schema");
    if (keyword !== null) return keyword;
    const properties = isRecord(schema.properties) ? schema.properties : {};
    for (const reserved of ["kind", "version"]) if (reserved in properties) return {path: `schema.properties.${reserved}`, message: `the payload schema must not declare "${reserved}"`};
    const refs = value.refs;
    if (refs === undefined) return null;
    if (!Array.isArray(refs)) return {path: "refs", message: "refs must be a list"};
    const seen = new Set<string>();
    for (const [index, ref] of refs.entries()) {
        const path = `refs[${String(index)}]`;
        if (!isRecord(ref) || typeof ref.path !== "string") return {path, message: "a ref needs a path"};
        if (seen.has(ref.path)) return {path: `${path}.path`, message: `path "${ref.path}" appears twice`};
        seen.add(ref.path);
        const kind = ref.kind ?? "entry";
        if (!REF_KINDS.includes(kind as MarkRefKind)) return {path: `${path}.kind`, message: `"${String(kind)}" is not one of ${REF_KINDS.join(", ")}`};
        if (ref.targets !== undefined && (kind !== "entry" || !Array.isArray(ref.targets) || ref.targets.some((target) => typeof target !== "string"))) return {path: `${path}.targets`, message: "targets is a list of entry types and only applies to kind entry"};
        const reached = schemaAt(schema, ref.path);
        if (reached === null) return {path: `${path}.path`, message: `path "${ref.path}" does not reach a property through properties and items`};
        if (reached.type !== "string") return {path: `${path}.path`, message: `path "${ref.path}" must point at a string`};
    }
    return null;
}

/** schema 里只许白名单关键字，沿 `properties`、`items`、`anyOf` 逐层查。 */
function keywordProblem(schema: Readonly<Record<string, unknown>>, path: string): {path: string; message: string} | null {
    for (const [keyword, value] of Object.entries(schema)) {
        const at = `${path}.${keyword}`;
        if (ANNOTATIONS.has(keyword)) continue;
        switch (keyword) {
            case "type": {
                const types = Array.isArray(value) ? value : [value];
                if (types.length === 0 || types.some((type) => typeof type !== "string" || !JSON_TYPES.has(type))) return {path: at, message: "type must be a JSON type or a list of them"};
                break;
            }
            case "properties": {
                if (!isRecord(value)) return {path: at, message: "properties must be an object"};
                for (const [name, child] of Object.entries(value)) {
                    if (!isRecord(child)) return {path: `${at}.${name}`, message: "a property schema must be an object"};
                    const problem = keywordProblem(child, `${at}.${name}`);
                    if (problem !== null) return problem;
                }
                break;
            }
            case "required":
                if (!Array.isArray(value) || value.some((name) => typeof name !== "string")) return {path: at, message: "required must be a list of property names"};
                break;
            case "additionalProperties":
                if (value !== false) return {path: at, message: "additionalProperties can only be false"};
                break;
            case "items": {
                if (!isRecord(value)) return {path: at, message: "items must be one schema"};
                const problem = keywordProblem(value, at);
                if (problem !== null) return problem;
                break;
            }
            case "anyOf": {
                if (!Array.isArray(value) || value.length === 0) return {path: at, message: "anyOf must be a non-empty list"};
                for (const [index, child] of value.entries()) {
                    if (!isRecord(child)) return {path: `${at}[${String(index)}]`, message: "an anyOf branch must be an object"};
                    const problem = keywordProblem(child, `${at}[${String(index)}]`);
                    if (problem !== null) return problem;
                }
                break;
            }
            case "enum":
                if (!Array.isArray(value) || value.length === 0) return {path: at, message: "enum must be a non-empty list"};
                break;
            case "const":
                break;
            case "minimum":
            case "maximum":
                if (typeof value !== "number" || !Number.isFinite(value)) return {path: at, message: `${keyword} must be a number`};
                break;
            case "minLength":
            case "maxLength":
                if (!Number.isInteger(value) || (value as number) < 0) return {path: at, message: `${keyword} must be a non-negative integer`};
                break;
            default:
                return {path: at, message: `keyword "${keyword}" is not allowed`};
        }
    }
    return null;
}

/** 路径的段：`.键` 逐级写，`[]` 是数组的每个元素（`nodes[].foreshadow`、`lines[]`）。不合写法时为 null。 */
function pathSteps(path: string): ({readonly key: string} | "each")[] | null {
    if (!/^[^.[\]]+(?:\[\])*(?:\.[^.[\]]+(?:\[\])*)*$/u.test(path)) return null;
    const steps: ({readonly key: string} | "each")[] = [];
    for (const part of path.split(".")) {
        const match = /^([^[\]]+)((?:\[\])*)$/u.exec(part)!;
        steps.push({key: match[1]!});
        for (let index = 0; index < match[2]!.length / 2; index += 1) steps.push("each");
    }
    return steps;
}

/** 沿 `properties` 与 `items` 走到路径指的 schema（不经过 `anyOf`）；走不到时为 null。 */
function schemaAt(schema: Readonly<Record<string, unknown>>, path: string): Readonly<Record<string, unknown>> | null {
    const steps = pathSteps(path);
    if (steps === null) return null;
    let current: Readonly<Record<string, unknown>> = schema;
    for (const step of steps) {
        const next = step === "each" ? current.items : isRecord(current.properties) ? current.properties[step.key] : undefined;
        if (!isRecord(next)) return null;
        current = next;
    }
    return current;
}

/**
 * 一条标注载荷里的引用（components.md 输出 18 的“标注种类 `refs`”）：按声明的路径在载荷里展开，`[]` 换成元素的下标。
 * 载荷里没有这个属性就没有引用。`base` 是这条标注在对象里的位置；值在 `holder[key]`（替换临时 id 时就地改它）。
 */
export function markReferences(type: MarkType, mark: Readonly<Record<string, unknown>>, base: string): {readonly path: string; readonly kind: MarkRefKind; readonly holder: unknown; readonly key: string | number; readonly targets?: readonly string[]}[] {
    const found: {path: string; kind: MarkRefKind; holder: unknown; key: string | number; targets?: readonly string[]}[] = [];
    for (const ref of type.refs) {
        const steps = pathSteps(ref.path);
        if (steps === null) continue;
        /** 走到第 `index` 步时，当前值在 `holder[key]`。 */
        const walk = (holder: unknown, key: string | number, at: string, index: number) => {
            const value = (holder as Record<string | number, unknown>)[key];
            if (index === steps.length) {
                found.push({path: at, kind: ref.kind, holder, key, ...(ref.targets === undefined ? {} : {targets: ref.targets})});
                return;
            }
            const step = steps[index]!;
            if (step === "each") {
                if (Array.isArray(value)) for (const position of value.keys()) walk(value, position, `${at}[${String(position)}]`, index + 1);
                return;
            }
            if (isRecord(value) && step.key in value) walk(value, step.key, `${at}.${step.key}`, index + 1);
        };
        walk({mark}, "mark", base, 0);
    }
    return found;
}

/** 一条已存的标注现在是否只读（model.md 输出 28）：种类不在为 `mark-kind-unknown`，版本对不上为 `mark-version-unsupported`。 */
export function markStatus(registry: MarkRegistry, mark: {readonly kind: string; readonly version: number}): "mark-kind-unknown" | "mark-version-unsupported" | null {
    const type = registry.byKind(mark.kind);
    if (type === undefined) return "mark-kind-unknown";
    return type.version === mark.version ? null : "mark-version-unsupported";
}

/** 新加或改过的标注写入时的问题（model.md 输出 28）；引用的目标由引用的统一校验查（`ref-invalid`）。合格返回 null。 */
export function markProblem(registry: MarkRegistry, owner: MarkTarget, mark: Readonly<Record<string, unknown>>): {readonly code: "mark-kind-unknown" | "mark-version-unsupported" | "mark-invalid"; readonly message: string} | null {
    const {kind, version, ...payload} = mark;
    const type = registry.byKind(String(kind));
    if (type === undefined) return {code: "mark-kind-unknown", message: `mark kind "${String(kind)}" is not registered`};
    if (type.version !== version) return {code: "mark-version-unsupported", message: `mark kind "${type.id}" is registered at version ${String(type.version)}, not ${String(version)}`};
    if (!type.attachTo.includes(owner)) return {code: "mark-invalid", message: `mark kind "${type.id}" cannot be attached to a ${owner}`};
    const problem = type.payloadProblem(payload);
    return problem === null ? null : {code: "mark-invalid", message: problem};
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
