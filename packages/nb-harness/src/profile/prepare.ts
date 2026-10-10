/**
 * 准备：调提示词函数得到节点树，按 Spec 输出 2–4、15 校验，取数据源。结果是冻结的 `Prepared`，渲染只读它。
 *
 * 校验不在第一条错误就停：诊断逐条收集，预览界面要一次看到全部问题。路径写法 `Prompt>Appending>Reminder[0]`：
 * 内置节点用组件名，注册节点用类型 id，序号是同类型兄弟里的位置。
 */

import {Value} from "typebox/value";
import type {TSchema} from "typebox";
import {BUILTIN, LAYOUT_IDS} from "./nodes";
import type {
    Diagnostic, JsonValue, NodeTypeDefinition, PreparedProfile, Profile, ProfileChild, ProfileIssue, ProfileNode, ProfileResult, PromptContext, SourceDefinition,
} from "./types";
import {preparedMarker} from "./types";

export type PromptChild =
    | {kind: "system"; node: ProfileNode}
    | {kind: "history"; node: ProfileNode}
    | {kind: "appending"; node: ProfileNode}
    | {kind: "message"; node: ProfileNode};

export interface Prepared extends PreparedProfile {
    readonly profile: Profile;
    readonly context: PromptContext;
    readonly tree: ProfileNode;
    readonly nodeTypes: ReadonlyMap<string, NodeTypeDefinition>;
    readonly sourceTypes: ReadonlyMap<string, SourceDefinition>;
    readonly sourceIds: readonly string[];
    readonly sources: ReadonlyMap<string, unknown>;
    /** `Prompt` 的直接子节点按文档顺序分类（Fragment 已拍平）。 */
    readonly order: readonly PromptChild[];
    readonly seeded: ProfileNode | null;
    readonly appending: ProfileNode | null;
    readonly diagnostics: readonly Diagnostic[];
}

export function isPrepared(value: unknown): value is Prepared {
    return typeof value === "object" && value !== null && (value as {[preparedMarker]?: unknown})[preparedMarker] === true;
}

const DISPLAY: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(BUILTIN).map(([name, id]) => [id, name[0]!.toUpperCase() + name.slice(1)]));
const displayName = (type: string): string => DISPLAY[type] ?? type;

export function schemaProblems(schema: TSchema, value: unknown): string | null {
    if (Value.Check(schema, value)) return null;
    return [...Value.Errors(schema, value)]
        .slice(0, 5)
        .map((error) => `${error.instancePath === "" ? "/" : error.instancePath}：${error.message}`)
        .join("；");
}

/** Fragment 是透明的：拍平后子节点按它所在的父节点校验。 */
export function flatten(children: readonly ProfileChild[]): ProfileChild[] {
    return children.flatMap((child) => (typeof child === "object" && child !== null && child.type === BUILTIN.fragment ? flatten(child.children) : [child]));
}

type Registries = {nodeTypes: ReadonlyMap<string, NodeTypeDefinition>; sourceTypes: ReadonlyMap<string, SourceDefinition>; fieldTypes: ReadonlyMap<string, TSchema>};

class Validation {
    readonly errors: Diagnostic[] = [];
    readonly warnings: Diagnostic[] = [];
    readonly sourceIds = new Set<string>();
    readonly stateIds = new Set<string>();
    seeded: ProfileNode | null = null;
    appendingCount = 0;

    constructor(private readonly nodeTypes: ReadonlyMap<string, NodeTypeDefinition>) {}

    error(code: ProfileIssue, path: string, detail: string): void {
        this.errors.push({severity: "error", code, path, detail});
    }

    warn(code: ProfileIssue, path: string, detail: string): void {
        this.warnings.push({severity: "warning", code, path, detail});
    }

    /** 父节点是否接受这个子节点：按内置布局表，或注册声明的 parents（含 `*类别` 通配）。 */
    private accepts(parentType: string, parentDefinition: NodeTypeDefinition | null, childType: string, childDefinition: NodeTypeDefinition | null): boolean {
        if (childDefinition !== null) {
            if (childDefinition.parents.includes(parentType)) return true;
            if (parentDefinition !== null && childDefinition.parents.includes(`*${parentDefinition.category}`)) return true;
            return false;
        }
        switch (childType) {
            case BUILTIN.system:
            case BUILTIN.appending:
                return parentType === BUILTIN.prompt;
            case BUILTIN.history:
                return parentType === BUILTIN.prompt;
            case BUILTIN.input:
                return parentType === BUILTIN.appending;
            default:
                return false;
        }
    }

    private childAllowed(parentDefinition: NodeTypeDefinition | null, parentType: string, child: ProfileChild): boolean {
        // 没注册的节点类型先放行，让 visit 报 unknown-node（比“父节点不能放它”更说明问题）。
        if (typeof child === "object" && child !== null && !LAYOUT_IDS.has(child.type) && !this.nodeTypes.has(child.type)) return true;
        if (parentDefinition === null) {
            // 布局节点的子节点规则（Spec 的节点表）。
            if (parentType === BUILTIN.prompt) return typeof child === "object" && child !== null;
            if (parentType === BUILTIN.system) return typeof child === "string" || (child !== null && this.isContent(child.type));
            if (parentType === BUILTIN.history) return typeof child === "object" && child !== null && this.nodeTypes.get(child.type)?.category === "message";
            if (parentType === BUILTIN.appending) return typeof child === "object" && child !== null && (child.type === BUILTIN.input || ["message", "stateful"].includes(this.nodeTypes.get(child.type)?.category ?? ""));
            return false;
        }
        if (parentDefinition.children === "none") return false;
        if (parentDefinition.children === "content") return typeof child === "string" || (child !== null && this.isContent(child.type));
        return typeof child === "object" && child !== null && parentDefinition.children.includes(child.type);
    }

    private isContent(type: string): boolean {
        if (type === BUILTIN.history) return true;   // 文本形式，as="text" 另在 visit 里检查
        return this.nodeTypes.get(type)?.category === "content";
    }

    visit(node: ProfileNode, path: string, parent: {type: string; definition: NodeTypeDefinition | null; path: string} | null, ancestors: readonly ProfileNode[]): void {
        const definition = this.nodeTypes.get(node.type) ?? null;
        const isLayout = LAYOUT_IDS.has(node.type);
        if (definition === null && !isLayout) {
            this.error("unknown-node", path, `没有注册节点类型 ${node.type}`);
            return;
        }
        if (parent === null) {
            if (node.type !== BUILTIN.prompt) this.error("prompt-threw", "Prompt", `提示词函数返回的根是 ${displayName(node.type)}，必须是 Prompt`);
        } else if (node.type === BUILTIN.history && node.props.as === "text") {
            // 文本形式的 History 只能放在请求消息里：直接在 Prompt 下的消息节点。
            const message = ancestors.find((ancestor) => this.nodeTypes.get(ancestor.type)?.category === "message");
            const messageIndex = message === undefined ? -1 : ancestors.indexOf(message);
            const underPrompt = messageIndex >= 0 && ancestors[messageIndex + 1]?.type === BUILTIN.prompt;
            if (!underPrompt) this.error("invalid-parent", path, "History as=\"text\" 只能放在直接位于 Prompt 下的消息节点里");
        } else if (node.type === BUILTIN.prompt) {
            this.error("invalid-parent", path, "Prompt 只能是根");
        } else if (!this.accepts(parent.type, parent.definition, node.type, definition)) {
            this.error("invalid-parent", path, `${displayName(node.type)} 不能放在 ${displayName(parent.type)} 里`);
        }
        if (definition !== null) {
            const problem = schemaProblems(definition.props, node.props);
            if (problem !== null) this.error("invalid-props", path, problem);
            for (const id of definition.sources ?? []) this.sourceIds.add(id);
            if (definition.category === "stateful") {
                const id = typeof node.props.id === "string" ? node.props.id : "";
                if (!ancestors.some((ancestor) => ancestor.type === BUILTIN.appending)) this.error("invalid-parent", path, "有状态节点只能放在 Appending 的子树里");
                if (this.stateIds.has(id)) this.error("duplicate-state-id", path, `有状态节点的 id 重复：${id}`);
                this.stateIds.add(id);
            }
            if (node.type === BUILTIN.image) {
                const message = ancestors.find((ancestor) => this.nodeTypes.get(ancestor.type)?.category === "message");
                const role = message === undefined ? undefined : (this.nodeTypes.get(message.type) as {role?: string} | undefined)?.role;
                if (role !== "user") this.error("image-not-allowed", path, "Image 只能放在 User 里");
            }
        }
        if (node.type === BUILTIN.history && node.props.as !== "text" && node.children.length > 0) {
            if (this.seeded !== null) this.error("multiple-seeded-history", path, "最多一个 History 可以有子节点（种子）");
            this.seeded = node;
            for (const child of flatten(node.children)) {
                if (typeof child === "object" && child !== null && this.nodeTypes.get(child.type)?.category === "message" && (this.nodeTypes.get(child.type) as {role?: string}).role === "assistant") {
                    this.error("invalid-parent", path, "种子只能是 User 或 Developer");
                }
            }
        }
        if (node.type === BUILTIN.appending) {
            this.appendingCount += 1;
            if (this.appendingCount > 1) this.error("multiple-appending", path, "最多一个 Appending");
            const inputs = flatten(node.children).filter((child) => typeof child === "object" && child !== null && child.type === BUILTIN.input).length;
            if (inputs > 1) this.error("multiple-input", path, "Appending 里至多一个 Input");
        }

        const counters = new Map<string, number>();
        for (const child of flatten(node.children)) {
            if (!this.childAllowed(definition, node.type, child)) {
                const label = typeof child === "string" ? "文字" : displayName(child!.type);
                this.error("invalid-child", path, `${displayName(node.type)} 里不能放 ${label}`);
                continue;
            }
            if (typeof child !== "object" || child === null) continue;
            const index = counters.get(child.type) ?? 0;
            counters.set(child.type, index + 1);
            this.visit(child, `${path}>${displayName(child.type)}[${index}]`, {type: node.type, definition, path}, [node, ...ancestors]);
        }
    }
}

function classify(root: ProfileNode, nodeTypes: ReadonlyMap<string, NodeTypeDefinition>): PromptChild[] {
    const order: PromptChild[] = [];
    for (const child of flatten(root.children)) {
        if (typeof child !== "object" || child === null) continue;
        if (child.type === BUILTIN.system) order.push({kind: "system", node: child});
        else if (child.type === BUILTIN.history) order.push({kind: "history", node: child});
        else if (child.type === BUILTIN.appending) order.push({kind: "appending", node: child});
        else if (nodeTypes.get(child.type)?.category === "message") order.push({kind: "message", node: child});
    }
    return order;
}

async function resolveSources(
    ids: readonly string[], sourceTypes: ReadonlyMap<string, SourceDefinition>, context: PromptContext, signal: AbortSignal,
    previous: ReadonlyMap<string, unknown> | null, onlyPhase: "model-call" | null,
): Promise<{values: Map<string, unknown>; errors: Diagnostic[]} | "cancelled"> {
    const values = new Map<string, unknown>();
    const errors: Diagnostic[] = [];
    const pending: Promise<void>[] = [];
    for (const id of ids) {
        const definition = sourceTypes.get(id);
        if (definition === undefined) {
            errors.push({severity: "error", code: "unknown-source", path: id, detail: `没有注册数据源 ${id}`});
            continue;
        }
        if (onlyPhase !== null && definition.phase !== onlyPhase && previous !== null) {
            values.set(id, previous.get(id));
            continue;
        }
        pending.push(
            definition.resolve({prompt: context}, signal).then(
                (value) => {
                    const problem = schemaProblems(definition.schema, value);
                    if (problem === null) values.set(id, value);
                    else errors.push({severity: "error", code: "source-failed", path: id, detail: `取数结果不合 schema：${problem}`});
                },
                (error: unknown) => {
                    errors.push({severity: "error", code: "source-failed", path: id, detail: `取数失败：${error instanceof Error ? error.message : String(error)}`});
                },
            ),
        );
    }
    await Promise.all(pending);
    if (signal.aborted) return "cancelled";
    return {values, errors};
}

function invalidPrompt(errors: Diagnostic[], warnings: Diagnostic[]): ProfileResult<never> {
    return {ok: false, code: "invalid-prompt", detail: errors.map((d) => `${d.path}：${d.detail}`).join("；"), diagnostics: [...errors, ...warnings]};
}

export async function prepare(registries: Registries, profile: Profile, input: {context: PromptContext; signal?: AbortSignal}): Promise<ProfileResult<Prepared>> {
    const signal = input.signal ?? new AbortController().signal;
    if (signal.aborted) return {ok: false, code: "cancelled", detail: "signal 已中止", diagnostics: []};
    const warnings: Diagnostic[] = [];
    const errors: Diagnostic[] = [];

    // 字段：未注册的只警告并忽略，已注册的按 schema 校验。
    const fields: Record<string, JsonValue> = {};
    for (const [id, value] of Object.entries(profile.fields)) {
        const schema = registries.fieldTypes.get(id);
        if (schema === undefined) {
            warnings.push({severity: "warning", code: "unknown-field", path: `fields.${id}`, detail: `没有注册字段 ${id}，已忽略`});
            continue;
        }
        const problem = schemaProblems(schema, value);
        if (problem === null) fields[id] = value;
        else errors.push({severity: "error", code: "invalid-field", path: `fields.${id}`, detail: problem});
    }
    const context: PromptContext = {...input.context, fields: Object.freeze(fields)};

    let tree: ProfileNode;
    try {
        tree = profile.prompt(context);
    } catch (error) {
        errors.push({severity: "error", code: "prompt-threw", path: "Prompt", detail: `提示词函数抛出：${error instanceof Error ? error.message : String(error)}`});
        return invalidPrompt(errors, warnings);
    }
    if (typeof tree !== "object" || tree === null || typeof tree.type !== "string") {
        errors.push({severity: "error", code: "prompt-threw", path: "Prompt", detail: "提示词函数没有返回节点"});
        return invalidPrompt(errors, warnings);
    }

    const validation = new Validation(registries.nodeTypes);
    validation.visit(tree, "Prompt", null, []);
    errors.push(...validation.errors);
    warnings.push(...validation.warnings);

    const order = classify(tree, registries.nodeTypes);
    const firstHistory = order.findIndex((child) => child.kind === "history");
    const earlyMessage = order.findIndex((child) => child.kind === "message");
    if (firstHistory !== -1 && earlyMessage !== -1 && earlyMessage < firstHistory) {
        warnings.push({severity: "warning", code: "cache-unfriendly", path: `Prompt>${displayName(order[earlyMessage]!.node.type)}`, detail: "请求消息出现在 History 之前，它每次变化都会使后面整段历史的提示词缓存失效"});
    }
    if (errors.length > 0) return invalidPrompt(errors, warnings);

    const sourceIds = [...validation.sourceIds];
    const resolved = await resolveSources(sourceIds, registries.sourceTypes, context, signal, null, null);
    if (resolved === "cancelled") return {ok: false, code: "cancelled", detail: "signal 已中止", diagnostics: warnings};
    if (resolved.errors.length > 0) return invalidPrompt(resolved.errors, warnings);

    const prepared: Prepared = Object.freeze({
        [preparedMarker]: true as const,
        profile,
        context,
        tree,
        nodeTypes: new Map(registries.nodeTypes),
        sourceTypes: new Map(registries.sourceTypes),
        sourceIds,
        sources: resolved.values,
        order,
        seeded: validation.seeded,
        appending: order.find((child) => child.kind === "appending")?.node ?? null,
        diagnostics: Object.freeze(warnings),
    });
    return {ok: true, value: prepared};
}

export async function refresh(prepared: Prepared, input: {signal?: AbortSignal}): Promise<ProfileResult<Prepared>> {
    const signal = input.signal ?? new AbortController().signal;
    if (signal.aborted) return {ok: false, code: "cancelled", detail: "signal 已中止", diagnostics: []};
    if (!prepared.sourceIds.some((id) => prepared.sourceTypes.get(id)?.phase === "model-call")) return {ok: true, value: prepared};
    const resolved = await resolveSources(prepared.sourceIds, prepared.sourceTypes, prepared.context, signal, prepared.sources, "model-call");
    if (resolved === "cancelled") return {ok: false, code: "cancelled", detail: "signal 已中止", diagnostics: []};
    if (resolved.errors.length > 0) return invalidPrompt(resolved.errors, [...prepared.diagnostics]);
    return {ok: true, value: Object.freeze({...prepared, sources: resolved.values})};
}
