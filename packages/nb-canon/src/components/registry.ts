/**
 * Component 类型的登记（docs/specs/canon/components.md 输出 1、2、12、13）。
 *
 * 声明来自插件清单的 `canon.components` 贡献，插件不激活也能读；宿主每次贡献集合变化时整份交进来，这里重新建一份
 * 登记，不做增量。撞名的两个类型都不可用，不按登记先后决定谁赢（输出 2）。`digest` 是登记集合的稳定序列化，
 * 引擎按它判断“登记的类型变了，要整本重算”。
 */

import {ENABLE_FIELD, isIdentifierName, isNamespaceName} from "../core/identifiers";
import {ComponentDeclarationSchema, schemaProblems, FieldDeclarationSchema, type FieldDeclaration, type InstanceFieldDeclaration} from "../core/schema";
import {stableStringify} from "../core/stable-json";

/** 贡献点 `canon.components` 的一条声明（components.md 输入与前置条件的表）。 */
export interface ComponentDeclaration {
    readonly id: string;
    readonly label: string;
    readonly namespace?: string;
    readonly version?: number;
    readonly fields?: readonly FieldDeclaration[];
    readonly instanceFields?: boolean;
    readonly kinds?: readonly string[];
    readonly presets?: readonly FieldDeclaration[];
    readonly agentView?: string;
    readonly bookkeepingNotes?: string;
    readonly usageNotes?: string;
}

/** 登记成功、可用的带数据类型。 */
export interface ComponentType {
    readonly id: string;
    readonly label: string;
    readonly namespace: string;
    readonly version: number;
    readonly fields: readonly FieldDeclaration[];
    readonly instanceFields: boolean;
    /** 适用的条目种类与预设字段：只是给界面与 Agent 的提示（components.md 输出 24），不参与任何计算。 */
    readonly kinds?: readonly string[];
    readonly presets?: readonly FieldDeclaration[];
    readonly agentView?: string;
    readonly bookkeepingNotes?: string;
    readonly usageNotes?: string;
}

export type RegistryDiagnostic =
    | {readonly code: "component-declaration-invalid"; readonly type: string; readonly path: string; readonly message: string}
    | {readonly code: "component-namespace-conflict"; readonly namespace: string; readonly types: readonly string[]};

export interface ComponentRegistry {
    /** 命名空间上可用的类型；撞名、没登记时为 undefined。 */
    readonly byNamespace: (namespace: string) => ComponentType | undefined;
    /** 可用的带数据类型，按 id 排（components.md 输出 21）。撞名的不在里面。 */
    readonly types: readonly ComponentType[];
    /** 只做查询的类型（没有命名空间），按 id。 */
    readonly queryOnly: ReadonlyMap<string, ComponentDeclaration>;
    /** 撞名的命名空间：数据保留、只读（输出 2、12）。 */
    readonly conflicted: ReadonlySet<string>;
    readonly diagnostics: readonly RegistryDiagnostic[];
    /** 可用类型的稳定摘要输入，类型集合不变时逐字相同。引擎据它判断要不要整本重建。 */
    readonly digest: string;
    /** 可用的类型（带数据的与只做查询的）的 `[id, 版本]`，按 id 排；读取输入的摘要用（model.md 输出 36）。 */
    readonly versions: readonly (readonly [string, number])[];
}

/** JSON 指针（`/fields/0/id`）写成诊断里用的路径（`fields[0].id`）。 */
function pointerPath(pointer: string): string {
    return pointer.split("/").filter((part) => part !== "").reduce((path, part) => (/^\d+$/u.test(part) ? `${path}[${part}]` : path === "" ? part : `${path}.${part}`), "");
}

export function buildRegistry(declarations: readonly ComponentDeclaration[]): ComponentRegistry {
    const diagnostics: RegistryDiagnostic[] = [];
    const candidates = new Map<string, ComponentType[]>();
    const queryOnly = new Map<string, ComponentDeclaration>();
    for (const declaration of declarations) {
        // 先核对形状：声明来自插件清单，不能假定字段的类型对（输出 1）；只做查询的类型同样要核对。
        const shape = schemaProblems(ComponentDeclarationSchema, declaration);
        if (shape !== null) {
            const first = shape[0]!;
            diagnostics.push({code: "component-declaration-invalid", type: typeof (declaration as {id?: unknown}).id === "string" ? declaration.id : "", path: pointerPath(first.path), message: first.message});
            continue;
        }
        if (declaration.namespace === undefined) {
            queryOnly.set(declaration.id, declaration);
            continue;
        }
        const problem = declarationProblem(declaration);
        if (problem !== null) {
            diagnostics.push({code: "component-declaration-invalid", type: declaration.id, ...problem});
            continue;
        }
        const type: ComponentType = {
            id: declaration.id,
            label: declaration.label,
            namespace: declaration.namespace,
            version: declaration.version!,
            fields: declaration.fields ?? [],
            instanceFields: declaration.instanceFields === true,
            ...(declaration.kinds === undefined ? {} : {kinds: declaration.kinds}),
            ...(declaration.presets === undefined ? {} : {presets: declaration.presets}),
            ...(declaration.agentView === undefined ? {} : {agentView: declaration.agentView}),
            ...(declaration.bookkeepingNotes === undefined ? {} : {bookkeepingNotes: declaration.bookkeepingNotes}),
            ...(declaration.usageNotes === undefined ? {} : {usageNotes: declaration.usageNotes}),
        };
        const list = candidates.get(type.namespace) ?? [];
        list.push(type);
        candidates.set(type.namespace, list);
    }
    const available = new Map<string, ComponentType>();
    const conflicted = new Set<string>();
    for (const [namespace, list] of candidates) {
        if (list.length === 1) available.set(namespace, list[0]!);
        else {
            conflicted.add(namespace);
            diagnostics.push({code: "component-namespace-conflict", namespace, types: list.map((type) => type.id).sort()});
        }
    }
    const digest = stableStringify({
        // 只含影响计算的部分：适用的种类、预设与字段的建议值都只是提示，改了它们不该引起整本重算（components.md 输出 24）。
        types: [...available.values()].sort((a, b) => (a.namespace < b.namespace ? -1 : 1)).map((type) => ({id: type.id, namespace: type.namespace, version: type.version, fields: type.fields.map(withoutSuggestions), instanceFields: type.instanceFields})),
        conflicted: [...conflicted].sort(),
    });
    const versions = [...[...available.values()].map((type) => [type.id, type.version] as const), ...[...queryOnly.values()].map((type) => [type.id, type.version ?? 0] as const)].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const types = [...available.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return {byNamespace: (namespace) => available.get(namespace), types, queryOnly, conflicted, diagnostics, digest, versions};
}

function declarationProblem(declaration: ComponentDeclaration): {path: string; message: string} | null {
    const namespace = declaration.namespace!;
    if (!isNamespaceName(namespace)) return {path: "namespace", message: `namespace "${namespace}" is not an identifier or is reserved`};
    if (!Number.isInteger(declaration.version) || declaration.version! < 1) return {path: "version", message: "version must be a positive integer"};
    const fields = declaration.fields ?? [];
    return fieldsProblem(fields, "fields") ?? presetsProblem(declaration.presets ?? [], fields, declaration.instanceFields === true);
}

/**
 * 预设字段（components.md 输出 24）：每个单独与固定字段放在一起看。作者可能只加其中一个，所以 id 与显示名都不与固定字段、别的
 * 预设相同（显示名撞了的预设在哪个条目上都加不上），上限只能指向固定字段，不能指向另一个预设。
 */
function presetsProblem(presets: readonly FieldDeclaration[], fields: readonly FieldDeclaration[], instanceFields: boolean): {path: string; message: string} | null {
    if (presets.length > 0 && !instanceFields) return {path: "presets", message: "presets need instanceFields"};
    const ids = new Set(fields.map((field) => field.id));
    const labels = new Set(fields.map((field) => field.label));
    for (const [index, preset] of presets.entries()) {
        const path = `presets[${String(index)}]`;
        const problem = fieldShapeProblem(preset, path);
        if (problem !== null) return problem;
        if (ids.has(preset.id)) return {path: `${path}.id`, message: `duplicate field id "${preset.id}"`};
        if (labels.has(preset.label)) return {path: `${path}.label`, message: `duplicate field label "${preset.label}"`};
        ids.add(preset.id);
        labels.add(preset.label);
        if (typeof preset.max === "string" && !fields.some((field) => field.id === preset.max && field.kind === "number" && field.precision !== "semantic")) {
            return {path: `${path}.max`, message: `max "${preset.max}" is not an exact number field of this type`};
        }
    }
    return null;
}

/** 算 `digest` 用：去掉字段声明里的建议值（子字段的也去掉）。 */
function withoutSuggestions(field: FieldDeclaration): FieldDeclaration {
    if (field.suggestions === undefined && field.item?.every((sub) => sub.suggestions === undefined) !== false) return field;
    const {suggestions: _suggestions, ...rest} = field;
    return {...rest, ...(field.item === undefined ? {} : {item: field.item.map(({suggestions: _dropped, ...sub}) => sub)})};
}

/**
 * 一条字段声明自己合不合规（不看它与别的声明的关系）：id 合法、不叫“启用”，种类与各项属性对得上，列表的子字段同样。
 * `removed` 只有实例声明能带（`instance` 为真时放行），子字段任何时候都不能带。
 */
export function fieldShapeProblem(field: FieldDeclaration, path: string, instance = false): {path: string; message: string} | null {
    const schema = schemaProblems(FieldDeclarationSchema, field);
    if (schema !== null) return {path, message: schema.map((problem) => `${problem.path} ${problem.message}`).join("; ")};
    if (!isIdentifierName(field.id)) return {path: `${path}.id`, message: `field id "${field.id}" is not an identifier`};
    if (field.id === ENABLE_FIELD) return {path: `${path}.id`, message: `field id "${ENABLE_FIELD}" is reserved`};
    if (!instance && "removed" in field) return {path: `${path}.removed`, message: "only a field declared on an instance can be marked removed"};
    if (field.kind === "enum" && (field.options === undefined || field.options.length === 0)) return {path: `${path}.options`, message: "enum needs options"};
    if (field.precision !== undefined && field.kind !== "number" && field.kind !== "text") return {path: `${path}.precision`, message: "precision applies to number and text"};
    if (field.suggestions !== undefined && field.kind !== "text") return {path: `${path}.suggestions`, message: "suggestions apply to text"};
    if (field.keyedBy !== undefined && field.kind !== "list") return {path: `${path}.keyedBy`, message: "keyedBy applies to lists"};
    if (field.targets !== undefined && field.kind !== "ref" && field.keyedBy === undefined) return {path: `${path}.targets`, message: "targets applies to ref fields and lists keyed by ref"};
    if ((field.min !== undefined || field.max !== undefined) && (field.kind !== "number" || field.precision === "semantic")) {
        return {path, message: "min and max apply to exact numbers"};
    }
    if (field.kind === "list") {
        const item = field.item ?? [];
        if (item.some((sub) => (sub.kind as string) === "list")) return {path: `${path}.item`, message: "lists do not nest"};
        return fieldsProblem(item, `${path}.item`);
    }
    return null;
}

/** 一组类型固定的字段声明（或列表的子字段）是否合规：各条自己合规，id 不重复，`max` 指向同一组里的精确档数值字段。 */
export function fieldsProblem(fields: readonly FieldDeclaration[], base: string): {path: string; message: string} | null {
    const ids = new Set<string>();
    for (const [index, field] of fields.entries()) {
        const path = `${base}[${String(index)}]`;
        const problem = fieldShapeProblem(field, path);
        if (problem !== null) return problem;
        if (ids.has(field.id)) return {path: `${path}.id`, message: `duplicate field id "${field.id}"`};
        ids.add(field.id);
    }
    for (const [index, field] of fields.entries()) {
        if (typeof field.max !== "string") continue;
        const target = fields.find((other) => other.id === field.max);
        if (target === undefined || target.kind !== "number" || target.precision === "semantic") {
            return {path: `${base}[${String(index)}].max`, message: `max "${field.max}" is not an exact number field in this namespace`};
        }
    }
    return null;
}

/**
 * 实例字段的 id：显示名本身合法、没被占用就用它；否则去掉不合法的字符、空了或开头是数字时用 `f`，再加序号直到不重复
 * （components.md 输入与前置条件）。生成结果随声明存下，之后改显示名不改 id。
 */
export function generateFieldId(label: string, taken: ReadonlySet<string>): string {
    if (isIdentifierName(label) && label !== ENABLE_FIELD && !taken.has(label)) return label;
    // 保留能出现在标识符中间的字符；开头不能作标识符开头（例如数字）时补一个 f，不丢字。
    let base = [...label].filter((char) => isIdentifierName(`a${char}`)).join("");
    if (!isIdentifierName(base) || base === ENABLE_FIELD) base = `f${base}`;
    for (let suffix = 2; ; suffix += 1) {
        const candidate = `${base}${String(suffix)}`;
        if (!taken.has(candidate)) return candidate;
    }
}

/**
 * 一个实例上生效的字段声明（components.md 输出 22）：类型固定的，加上类型允许时实例自己声明、没去掉的；同一个 id 两边都有时
 * 固定的生效（类型后来加了同 id 的固定字段，实例上的那一条不再起作用）。读取、补丁、约束都只认它。
 */
export function effectiveFields(type: ComponentType, declared: readonly InstanceFieldDeclaration[] | undefined): readonly FieldDeclaration[] {
    return instanceFields(type, declared, false);
}

/**
 * 实例上留着数据的字段声明：生效的，加上去掉过的。去掉的字段读不到，但它的值、值里的引用都留着（输出 4），遍历引用时用它，
 * 所以恢复一个字段不会把它里面的引用算成新写的。
 */
export function retainedFields(type: ComponentType, declared: readonly InstanceFieldDeclaration[] | undefined): readonly FieldDeclaration[] {
    return instanceFields(type, declared, true);
}

/** 每个类型的固定字段 id（补丁、约束每处都要查实例声明是不是被盖住，按类型缓存一次）。 */
const fixedIds = new WeakMap<ComponentType, ReadonlySet<string>>();

function instanceFields(type: ComponentType, declared: readonly InstanceFieldDeclaration[] | undefined, withRemoved: boolean): readonly FieldDeclaration[] {
    if (!type.instanceFields || declared === undefined || declared.length === 0) return type.fields;
    let fixed = fixedIds.get(type);
    if (fixed === undefined) {
        fixed = new Set(type.fields.map((field) => field.id));
        fixedIds.set(type, fixed);
    }
    let fields: FieldDeclaration[] | null = null;
    for (const field of declared) {
        if ((field.removed === true && !withRemoved) || fixed.has(field.id)) continue;
        fields ??= [...type.fields];
        fields.push(field);
    }
    return fields ?? type.fields;
}
