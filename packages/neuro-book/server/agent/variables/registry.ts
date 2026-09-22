import {Type} from "typebox";
import type {TSchema} from "typebox";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {VariableSchemaResolver} from "nbook/server/agent/variables/schema-resolver";
import type {
    VariableCatalog,
    VariableDefinition,
    VariableNamespace,
    VariableRootCatalogItem,
    VariableAccessorIssue,
    VariableSchemaDetail,
    VariableSchemaQuery,
} from "nbook/server/agent/variables/types";
import type {DefineVariableInput} from "nbook/variable-sdk/contracts";

const catalogKey: Record<VariableNamespace, keyof Omit<VariableCatalog, "summary">> = {
    client: "clientVariables",
    global: "globalVariables",
    project: "projectVariables",
    session: "sessionVariables",
};

/**
 * 内部通用 define 入口。公开 profile/helper 只暴露固定 namespace wrapper。
 */
export function defineVariableNamespace<TSchemaValue extends TSchema>(
    namespace: VariableNamespace,
    input: DefineVariableInput<TSchemaValue>,
): VariableDefinition<TSchemaValue> {
    return {...input, namespace};
}

/**
 * 定义 client.* 前端状态变量。
 */
export function defineClientVariable<TSchemaValue extends TSchema>(input: DefineVariableInput<TSchemaValue>): VariableDefinition<TSchemaValue> {
    return defineVariableNamespace("client", input);
}

/**
 * 定义 Workspace Root 级全局变量。
 */
export function defineWorkspaceRootVariable<TSchemaValue extends TSchema>(input: DefineVariableInput<TSchemaValue>): VariableDefinition<TSchemaValue> {
    return defineVariableNamespace("global", input);
}

/**
 * 定义 Project Workspace 级变量。
 */
export function defineProjectVariable<TSchemaValue extends TSchema>(input: DefineVariableInput<TSchemaValue>): VariableDefinition<TSchemaValue> {
    return defineVariableNamespace("project", input);
}

/**
 * 定义 session 级变量。profile artifact 加载后可把这些定义注入 registry。
 */
export function defineSessionVariable<TSchemaValue extends TSchema>(input: DefineVariableInput<TSchemaValue>): VariableDefinition<TSchemaValue> {
    return defineVariableNamespace("session", input);
}

/**
 * 变量 registry 是 schema、权限和 catalog 的唯一运行时入口。
 */
export class VariableRegistry {
    private readonly definitions = new Map<string, VariableDefinition>();
    private readonly resolver = new VariableSchemaResolver();

    constructor(definitions: VariableDefinition[] = builtinVariableDefinitions(), private readonly registryIssues: VariableAccessorIssue[] = []) {
        for (const definition of definitions) {
            this.register(definition);
        }
    }

    /**
     * 注册变量根。重复 full path 直接报错，避免 profile 与 user definition 互相遮蔽。
     */
    register(definition: VariableDefinition): void {
        const fullPath = this.fullPath(definition.namespace, definition.key);
        if (definition.namespace !== "client" && definition.namespace !== "global" && definition.namespace !== "project" && definition.namespace !== "session") {
            throw new Error(`变量 namespace 不受支持：${String(definition.namespace)}`);
        }
        if (this.definitions.has(fullPath)) {
            throw new Error(`变量定义冲突：${fullPath}`);
        }
        this.definitions.set(fullPath, normalizeVariableDefinition(definition));
    }

    /**
     * 返回按 query 裁剪后的 catalog 和 schema。
     */
    query(query: VariableSchemaQuery = {}): {catalog: VariableCatalog; schemas: VariableSchemaDetail[]} {
        const catalog = this.catalog(query);
        const schemas = this.schemaDetails(query);
        return {catalog, schemas};
    }

    /**
     * 返回 definition artifact 加载问题。
     */
    get issues(): VariableAccessorIssue[] {
        return this.registryIssues;
    }

    /**
     * 生成变量根 overview。顶层不包 namespaces，保持文档中的心智模型。
     */
    catalog(query: VariableSchemaQuery = {}): VariableCatalog {
        const catalog: VariableCatalog = {
            summary: "Registered variables are grouped by client/global/project/session. Use variable_schema for focused schema, variable_read for values, and variable_patch for writable paths.",
            clientVariables: {},
            globalVariables: {},
            projectVariables: {},
            sessionVariables: {},
        };
        for (const definition of this.filteredDefinitions(query)) {
            const item: VariableRootCatalogItem = {
                $ref: `#/${catalogKey[definition.namespace]}/${definition.key}`,
                title: definition.title,
                summary: definition.summary,
                readable: definition.readable ?? true,
                writableByAgent: definition.writableBy?.includes("agent") ?? false,
            };
            catalog[catalogKey[definition.namespace]][definition.key] = item;
        }
        return catalog;
    }

    /**
     * 解析 namespace 内的相对 path，返回注册根和目标 schema。
     */
    resolve(namespace: VariableNamespace, path: string): {definition: VariableDefinition; rootKey: string; schema: TSchema} {
        const normalizedPath = normalizeVariablePath(path);
        const definition = this.matchDefinition(namespace, normalizedPath);
        if (!definition) {
            throw new Error(`变量未注册：${this.fullPath(namespace, normalizedPath)}`);
        }
        const resolved = this.resolver.resolve(definition.key, definition.schema, normalizedPath);
        return {
            definition,
            rootKey: resolved.rootKey,
            schema: resolved.schema,
        };
    }

    private schemaDetails(query: VariableSchemaQuery): VariableSchemaDetail[] {
        if (query.paths?.length) {
            return query.paths.map((path) => {
                const [namespace, ...rest] = normalizeVariablePath(path).split(".");
                if (namespace !== "client" && namespace !== "global" && namespace !== "project" && namespace !== "session") {
                    throw new Error(`变量路径必须以 client/global/project/session 开头：${path}`);
                }
                const namespacePath = rest.join(".");
                const resolved = this.resolve(namespace, namespacePath);
                return {
                    path: this.fullPath(namespace, namespacePath),
                    namespace,
                    key: namespacePath,
                    schema: resolved.schema,
                    readable: resolved.definition.readable ?? true,
                    writableByAgent: resolved.definition.writableBy?.includes("agent") ?? false,
                    summary: resolved.definition.summary,
                };
            });
        }
        return this.filteredDefinitions(query).map((definition) => ({
            path: this.fullPath(definition.namespace, definition.key),
            namespace: definition.namespace,
            key: definition.key,
            schema: definition.schema,
            readable: definition.readable ?? true,
            writableByAgent: definition.writableBy?.includes("agent") ?? false,
            summary: definition.summary,
        }));
    }

    private filteredDefinitions(query: VariableSchemaQuery): VariableDefinition[] {
        const pathSet = new Set(query.paths ?? []);
        return [...this.definitions.values()]
            .filter((definition) => !query.namespace || definition.namespace === query.namespace)
            .filter((definition) => !query.writableOnly || definition.writableBy?.includes("agent"))
            .filter((definition) => {
                if (pathSet.size > 0) {
                    return pathSet.has(this.fullPath(definition.namespace, definition.key));
                }
                if (!query.prefix) {
                    return true;
                }
                const prefix = normalizeVariablePath(query.prefix);
                return definition.key === prefix || definition.key.startsWith(`${prefix}.`);
            })
            .sort((left, right) => this.fullPath(left.namespace, left.key).localeCompare(this.fullPath(right.namespace, right.key)));
    }

    private matchDefinition(namespace: VariableNamespace, path: string): VariableDefinition | undefined {
        return [...this.definitions.values()]
            .filter((definition) => definition.namespace === namespace)
            .filter((definition) => path === definition.key || path.startsWith(`${definition.key}.`))
            .sort((left, right) => right.key.length - left.key.length)[0];
    }

    private fullPath(namespace: VariableNamespace, key: string): string {
        return `${namespace}.${normalizeVariablePath(key)}`;
    }
}

/** 宿主唯一的 VariableDefinition 默认值 normalizer。 */
function normalizeVariableDefinition(definition: VariableDefinition): VariableDefinition {
    return {
        ...definition,
        readable: definition.readable ?? true,
        writableBy: definition.writableBy ?? ["user"],
        writeMode: definition.writeMode ?? "patch",
    };
}

/**
 * 第一批内建 client 变量。后续前端 state 扩展只需要继续注册变量根。
 */
export function builtinVariableDefinitions(): VariableDefinition[] {
    return [
        defineClientVariable({
            key: "currentProjectWorkspace",
            title: "Current Project Workspace",
            summary: "Project Workspace selected in the current frontend invocation.",
            schema: Type.Union([Type.String(), Type.Null()]),
            default: null,
            writableBy: ["frontend"],
        }),
        defineClientVariable({
            key: "ide",
            title: "Novel IDE state",
            summary: "Focused browser IDE state snapshot.",
            schema: Type.Record(Type.String(), Type.Unknown()),
            default: {},
            writableBy: ["frontend", "agent"],
        }),
        defineClientVariable({
            key: "ide.panel",
            title: "IDE panel",
            schema: Type.Union([Type.String(), Type.Null()]),
            default: null,
            writableBy: ["frontend"],
        }),
        defineClientVariable({
            key: "ide.activePanel",
            title: "Active IDE panel",
            summary: "Focused workbench tool view (published by the page from what is actually visible; null means no tool context). Writable only for tools the workbench really hosts: the frontend rejects an unhosted panel name instead of applying it, and a not-yet-loaded or stale tool record is rejected too.",
            schema: Type.Union([Type.String(), Type.Null()]),
            default: null,
            writableBy: ["frontend", "agent"],
        }),
        defineClientVariable({
            key: "ide.theme",
            title: "IDE theme",
            schema: Type.String(),
            default: "sepia",
            writableBy: ["frontend", "agent"],
        }),
        defineClientVariable({
            key: "ide.extra",
            title: "IDE extra state",
            schema: Type.String(),
            default: "{}",
            writableBy: ["frontend"],
        }),
        defineClientVariable({
            key: "studio",
            title: "Studio state",
            summary: "Focused Novel Studio state snapshot.",
            schema: Type.Record(Type.String(), Type.Unknown()),
            default: {},
            writableBy: ["frontend", "agent"],
        }),
        defineClientVariable({
            key: "studio.novelId",
            title: "Current project path",
            schema: Type.String(),
            default: "",
            writableBy: ["frontend"],
        }),
        defineClientVariable({
            key: "studio.selectedFilePath",
            title: "Selected file path",
            schema: Type.Union([Type.String(), Type.Null()]),
            default: null,
            writableBy: ["frontend"],
        }),
        defineClientVariable({
            key: "studio.selectedStoryThreadId",
            title: "Selected story thread ID",
            schema: Type.Union([Type.String(), Type.Null()]),
            default: null,
            writableBy: ["frontend"],
        }),
        defineClientVariable({
            key: "studio.selectedStorySceneId",
            title: "Selected story scene ID",
            schema: Type.Union([Type.String(), Type.Null()]),
            default: null,
            writableBy: ["frontend"],
        }),
        defineClientVariable({
            key: "studio.previousSelectedFilePath",
            title: "Previous selected file path",
            schema: Type.Union([Type.String(), Type.Null()]),
            default: null,
            writableBy: ["frontend"],
        }),
        defineClientVariable({
            key: "studio.previousChapterTitle",
            title: "Previous chapter title",
            schema: Type.Union([Type.String(), Type.Null()]),
            default: null,
            writableBy: ["frontend"],
        }),
        defineClientVariable({
            key: "studio.currentChapterLabel",
            title: "Current chapter label",
            schema: Type.Union([Type.String(), Type.Null()]),
            default: null,
            writableBy: ["frontend"],
        }),
        defineClientVariable({
            key: "studio.previousChapterLabel",
            title: "Previous chapter label",
            schema: Type.Union([Type.String(), Type.Null()]),
            default: null,
            writableBy: ["frontend"],
        }),
        defineClientVariable({
            key: "studio.workspace",
            title: "Studio workspace",
            schema: Type.Union([Type.String(), Type.Null()]),
            default: null,
            writableBy: ["frontend"],
        }),
        defineClientVariable({
            key: "studio.workspaceKind",
            title: "Studio workspace kind",
            schema: Type.Union([Type.Literal("novel"), Type.Literal("user-assets")]),
            default: "novel",
            writableBy: ["frontend"],
        }),
        defineClientVariable({
            key: "studio.didSwitchFile",
            title: "File switch flag",
            schema: Type.Boolean(),
            default: false,
            writableBy: ["frontend"],
        }),
        defineClientVariable({
            key: "studio.selectionVersion",
            title: "Selection version",
            schema: Type.Number(),
            default: 0,
            writableBy: ["frontend"],
        }),
        defineClientVariable({
            key: "studio.extra",
            title: "Studio extra state",
            schema: Type.String(),
            default: "{}",
            writableBy: ["frontend"],
        }),
    ];
}

export function normalizeVariablePath(path: string): string {
    const normalized = path.trim().replace(/^\.+|\.+$/g, "");
    if (!normalized) {
        throw new Error("变量 path 不能为空。");
    }
    if (normalized.includes("..")) {
        throw new Error(`变量 path 不能包含空 segment：${path}`);
    }
    return normalized;
}

export function cloneJsonValue(value: JsonValue): JsonValue {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
}
