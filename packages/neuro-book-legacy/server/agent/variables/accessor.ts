import {createHash} from "node:crypto";
import type {JsonValue} from "nbook/server/agent/messages/types";
import type {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import type {SessionEntry, SessionEntryDraft, SessionSnapshot} from "nbook/server/agent/session/types";
import type {TSchema} from "typebox";
import {Value} from "typebox/value";
import {cloneJsonValue, normalizeVariablePath, VariableRegistry} from "nbook/server/agent/variables/registry";
import {applyVariableJsonPatch} from "nbook/server/agent/variables/json-patch";
import {readDotPath, VariableFileStorage} from "nbook/server/agent/variables/storage";
import type {
    ClientVariablePatchHandler,
    ClientStateSnapshot,
    ProfileVariableAccessor,
    VariableJsonPatchOperation,
    VariableNamespace,
    VariablePatchAudit,
    VariableReadOptions,
    VariableReadResult,
    VariableSchemaQuery,
    VariableSchemaResult,
    VariableInvocationState,
} from "nbook/server/agent/variables/types";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

export type CreateVariableAccessorInput = {
    repo: JsonlSessionRepository;
    snapshot: SessionSnapshot;
    registry?: VariableRegistry;
    clientState?: ClientStateSnapshot;
    dryRun?: boolean;
    invocationId?: string;
    variableState?: VariableInvocationState;
    currentProject?: ReadyProjectSessionRef | null;
    writeSessionEntry?: (cause: string, entry: SessionEntryDraft) => Promise<SessionEntry>;
    onSessionEntry?: (entry: SessionEntry) => void | Promise<void>;
    onClientPatch?: ClientVariablePatchHandler;
};

/**
 * 创建绑定当前 active leaf 的变量访问器。
 */
export function createProfileVariableAccessor(input: CreateVariableAccessorInput): ProfileVariableAccessor {
    return new RuntimeVariableAccessor(input);
}

class RuntimeVariableAccessor implements ProfileVariableAccessor {
    readonly dryRun: boolean;
    private readonly registry: VariableRegistry;
    private readonly storage: VariableFileStorage;
    private readonly sessionOverlay: Record<string, JsonValue>;
    private readonly clientOverlay: Record<string, JsonValue>;
    private readonly currentProject: ReadyProjectSessionRef | null;

    constructor(private readonly input: CreateVariableAccessorInput) {
        this.dryRun = input.dryRun ?? false;
        this.registry = input.registry ?? new VariableRegistry();
        this.currentProject = input.variableState
            ? input.variableState.currentProject
            : input.currentProject ?? null;
        this.storage = new VariableFileStorage(
            absoluteFsPath(input.repo.rootWorkspace),
            this.currentProject?.workspace ?? null,
        );
        this.sessionOverlay = reduceSessionVariables(input.repo, input.snapshot);
        this.clientOverlay = input.variableState?.clientOverlay ?? normalizeClientState(input.clientState);
    }

    catalog(query: VariableSchemaQuery = {}): VariableSchemaResult {
        try {
            const result = this.registry.query(query);
            return {
                ...result,
                issues: this.registry.issues.filter((issue) => isIssueRelevant(query, issue.path)),
            };
        } catch (error) {
            return {
                catalog: this.registry.catalog(),
                schemas: [],
                issues: [{
                    code: "not_registered",
                    path: query.paths?.[0] ?? query.prefix ?? query.namespace ?? "",
                    message: error instanceof Error ? error.message : String(error),
                }],
            };
        }
    }

    async get(path: string): Promise<JsonValue | undefined> {
        const parsed = parseFullVariablePath(path);
        return (await this.readInNamespace(parsed.namespace, parsed.path, {recordRead: false})).value;
    }

    async read(path: string, options: VariableReadOptions = {}): Promise<VariableReadResult> {
        const parsed = parseFullVariablePath(path);
        const result = await this.readInNamespace(parsed.namespace, parsed.path, {recordRead: true});
        if (result.issue || options.maxBytes === undefined || result.value === undefined) {
            return result;
        }
        const text = JSON.stringify(result.value);
        if (text.length <= options.maxBytes) {
            return result;
        }
        return {
            ...result,
            value: text.slice(0, options.maxBytes) as JsonValue,
            truncated: true,
        };
    }

    async patch(namespace: VariableNamespace, path: string, operations: VariableJsonPatchOperation[], source: VariablePatchAudit["source"] = "agent", toolCallId?: string): Promise<VariableReadResult> {
        const normalizedPath = normalizeVariablePath(path);
        const resolved = this.registry.resolve(namespace, normalizedPath);
        if (!resolved.definition.writableBy?.includes("agent") && source === "agent") {
            return issueResult(namespace, normalizedPath, "not_writable", `变量 ${namespace}.${normalizedPath} 不允许 Agent 写入。`);
        }
        const current = await this.readInNamespace(namespace, normalizedPath, {recordRead: false});
        if (current.issue) {
            return current;
        }
        const staleIssue = this.readBeforePatchIssue(namespace, normalizedPath, current, source);
        if (staleIssue) {
            return staleIssue;
        }
        if (this.dryRun) {
            const next = applyVariableJsonPatch(current.value, operations);
            const schemaIssue = this.schemaIssue(namespace, normalizedPath, next, resolved.schema);
            if (schemaIssue) {
                return schemaIssue;
            }
            this.writeOverlay(namespace, normalizedPath, next);
            const result = this.result(namespace, normalizedPath, next);
            this.rememberRead(result);
            return result;
        }
        let variableFileWritten = false;
        if (namespace === "client") {
            const next = applyVariableJsonPatch(current.value, operations);
            const schemaIssue = this.schemaIssue(namespace, normalizedPath, next, resolved.schema);
            if (schemaIssue) {
                return schemaIssue;
            }
            if (!this.input.onClientPatch || !this.input.invocationId) {
                return issueResult(namespace, normalizedPath, "not_writable", "client.* patch 需要活跃前端 invocation ack 管线。");
            }
            const ack = await this.input.onClientPatch({
                namespace,
                path: normalizedPath,
                operations,
                invocationId: this.input.invocationId,
                toolCallId,
            });
            if (ack.error) {
                return issueResult(namespace, normalizedPath, "not_writable", ack.error);
            }
            this.writeOverlay(namespace, normalizedPath, ack.appliedValue ?? next);
            const result = await this.readInNamespace(namespace, normalizedPath, {recordRead: false});
            this.rememberRead(result);
            return result;
        }
        if (namespace === "session") {
            const next = applyVariableJsonPatch(current.value, operations);
            const schemaIssue = this.schemaIssue(namespace, normalizedPath, next, resolved.schema);
            if (schemaIssue) {
                return schemaIssue;
            }
            this.writeOverlay(namespace, normalizedPath, next);
        } else {
            if (namespace === "project" && !this.currentProject) {
                return issueResult(namespace, normalizedPath, "unavailable", "project.* 变量需要本轮 Current Project。");
            }
            const next = applyVariableJsonPatch(current.value, operations);
            const schemaIssue = this.schemaIssue(namespace, normalizedPath, next, resolved.schema);
            if (schemaIssue) {
                return schemaIssue;
            }
            try {
                await this.storage.patch(namespace, normalizedPath, operations, source === "agent" && current.fingerprint ? {
                    expectedFingerprint: current.fingerprint,
                    fingerprintValue,
                    expectedValue: current.value,
                } : undefined);
                variableFileWritten = true;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return issueResult(namespace, normalizedPath, message.includes("上次读取后") ? "stale_fingerprint" : "storage_error", message);
            }
        }
        try {
            const entry = await this.writeSessionEntry("variable.patch", {
                type: "variable_patch",
                namespace,
                path: normalizedPath,
                operations,
                source,
                invocationId: this.input.invocationId,
                toolCallId,
            });
            await this.input.onSessionEntry?.(entry);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const prefix = variableFileWritten
                ? "变量文件已经写入，但 session audit entry 写入失败；请先 variable_read 确认当前值，避免重复 patch。"
                : "session 变量 patch 写入失败。";
            return issueResult(namespace, normalizedPath, "storage_error", `${prefix}${message ? ` 原因：${message}` : ""}`);
        }
        const result = await this.readInNamespace(namespace, normalizedPath, {recordRead: false});
        this.rememberRead(result);
        return result;
    }

    private async writeSessionEntry(cause: string, entry: SessionEntryDraft): Promise<SessionEntry> {
        if (this.input.writeSessionEntry) {
            return this.input.writeSessionEntry(cause, entry);
        }
        // Standalone/test fallback: active harness 必须注入 writeSessionEntry，让 audit entry 走 SessionWriteExecutor。
        return this.input.repo.appendEntry(this.input.snapshot.metadata.sessionId, entry);
    }

    private async readInNamespace(namespace: VariableNamespace, path: string, options: {recordRead: boolean}): Promise<VariableReadResult> {
        const normalizedPath = normalizeVariablePath(path);
        let resolved: ReturnType<VariableRegistry["resolve"]>;
        try {
            resolved = this.registry.resolve(namespace, normalizedPath);
        } catch (error) {
            return issueResult(namespace, normalizedPath, "not_registered", error instanceof Error ? error.message : String(error));
        }
        try {
            if (resolved.definition.readable === false) {
                return issueResult(namespace, normalizedPath, "not_readable", `变量 ${namespace}.${normalizedPath} 不可读。`);
            }
            if (namespace === "project" && !this.currentProject) {
                return issueResult(namespace, normalizedPath, "unavailable", "project.* 变量需要本轮 Current Project。");
            }
            const value = await this.readValue(namespace, normalizedPath, resolved.rootKey, resolved.definition.default);
            const schemaIssue = value === undefined ? null : this.schemaIssue(namespace, normalizedPath, value, resolved.schema);
            if (schemaIssue) {
                return schemaIssue;
            }
            const result = this.result(namespace, normalizedPath, value);
            if (options.recordRead) {
                this.rememberRead(result);
            }
            return result;
        } catch (error) {
            return issueResult(namespace, normalizedPath, "storage_error", error instanceof Error ? error.message : String(error));
        }
    }

    private async readValue(namespace: VariableNamespace, path: string, rootKey: string, defaultValue?: JsonValue): Promise<JsonValue | undefined> {
        const defaultAtPath = this.defaultAtPath(path, rootKey, defaultValue);
        if (namespace === "client") {
            return readDotPath(this.clientOverlay, path) ?? defaultAtPath;
        }
        if (namespace === "session") {
            return readDotPath(this.sessionOverlay, path) ?? defaultAtPath;
        }
        const variables = await this.storage.read(namespace);
        return readDotPath(variables, path) ?? defaultAtPath;
    }

    private defaultAtPath(path: string, rootKey: string, defaultValue?: JsonValue): JsonValue | undefined {
        if (defaultValue === undefined || path === rootKey) {
            return defaultValue;
        }
        const relativePath = path.startsWith(`${rootKey}.`) ? path.slice(rootKey.length + 1) : "";
        if (!relativePath || !defaultValue || typeof defaultValue !== "object" || Array.isArray(defaultValue)) {
            return undefined;
        }
        return readDotPath(defaultValue as Record<string, JsonValue>, relativePath);
    }

    private writeOverlay(namespace: VariableNamespace, path: string, value: JsonValue): void {
        const target = namespace === "client" ? this.clientOverlay : this.sessionOverlay;
        const segments = path.split(".").filter(Boolean);
        let current = target;
        for (const segment of segments.slice(0, -1)) {
            const child = current[segment];
            if (!child || typeof child !== "object" || Array.isArray(child)) {
                current[segment] = {};
            }
            current = current[segment] as Record<string, JsonValue>;
        }
        const leaf = segments.at(-1);
        if (leaf) {
            current[leaf] = value;
        }
    }

    private schemaIssue(namespace: VariableNamespace, path: string, value: JsonValue, schema: TSchema): VariableReadResult | null {
        if (Value.Check(schema, value)) {
            return null;
        }
        return issueResult(namespace, path, "schema_mismatch", `变量 ${namespace}.${path} 的值不符合注册 schema。`);
    }

    private readBeforePatchIssue(namespace: VariableNamespace, path: string, current: VariableReadResult, source: VariablePatchAudit["source"]): VariableReadResult | null {
        if (source !== "agent" || !this.input.variableState || !this.input.invocationId) {
            return null;
        }
        const fullPath = `${namespace}.${path}`;
        const expected = this.input.variableState.readFingerprints.get(fullPath);
        if (!expected) {
            return issueResult(namespace, path, "stale_read_required", `变量 ${fullPath} 必须先在同一 invocation 中调用 variable_read 读取，再调用 variable_patch。`);
        }
        if (expected !== current.fingerprint) {
            return issueResult(namespace, path, "stale_fingerprint", `变量 ${fullPath} 在上次读取后已经变化，请重新调用 variable_read 后再 patch。`);
        }
        return null;
    }

    private result(namespace: VariableNamespace, path: string, value: JsonValue | undefined): VariableReadResult {
        return {
            path: `${namespace}.${path}`,
            value,
            fingerprint: fingerprintValue(value),
        };
    }

    private rememberRead(result: VariableReadResult): void {
        if (!this.input.variableState || result.issue || !result.fingerprint) {
            return;
        }
        this.input.variableState.readFingerprints.set(result.path, result.fingerprint);
    }
}

export function parseFullVariablePath(path: string): {namespace: VariableNamespace; path: string} {
    const [namespace, ...rest] = normalizeVariablePath(path).split(".");
    if (namespace !== "client" && namespace !== "global" && namespace !== "project" && namespace !== "session") {
        throw new Error(`变量路径必须以 client/global/project/session 开头：${path}`);
    }
    return {
        namespace,
        path: rest.join("."),
    };
}

export function normalizeClientState(clientState: ClientStateSnapshot | undefined): Record<string, JsonValue> {
    const ide = cloneRecord(clientState?.ide);
    const studio = cloneRecord(clientState?.studio);
    // 仅保留前端可观察快照；Project 身份与物理路径来自 invocation 捕获的 ReadyProjectSessionRef。
    const currentProjectWorkspace = typeof studio.workspace === "string" ? studio.workspace : null;
    return {
        ...cloneTopLevelClientState(clientState),
        ide,
        studio,
        currentProjectWorkspace,
    };
}

function cloneTopLevelClientState(clientState: ClientStateSnapshot | undefined): Record<string, JsonValue> {
    if (!clientState) {
        return {};
    }
    const result: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(clientState)) {
        if (value !== undefined && key !== "ide" && key !== "studio") {
            result[key] = cloneJsonValue(value as JsonValue);
        }
    }
    return result;
}

function reduceSessionVariables(repo: JsonlSessionRepository, snapshot: SessionSnapshot): Record<string, JsonValue> {
    const variables: Record<string, JsonValue> = {};
    for (const entry of repo.activePath(snapshot)) {
        if (entry.type !== "variable_patch" || entry.namespace !== "session") {
            continue;
        }
        const resolved = entry.path.split(".");
        const rootPath = resolved[0] ?? entry.path;
        const relativePath = resolved.length > 1 ? `/${resolved.slice(1).map(escapeJsonPointer).join("/")}` : "";
        const operations = entry.operations.map((operation) => ({
            ...operation,
            path: `${relativePath}${operation.path}`,
        }));
        const previous = readDotPath(variables, rootPath);
        const next = applyVariableJsonPatch(previous, operations);
        writeOverlay(variables, rootPath, next);
    }
    return variables;
}

function escapeJsonPointer(segment: string): string {
    return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

function writeOverlay(target: Record<string, JsonValue>, path: string, value: JsonValue): void {
    const segments = path.split(".").filter(Boolean);
    let current = target;
    for (const segment of segments.slice(0, -1)) {
        const child = current[segment];
        if (!child || typeof child !== "object" || Array.isArray(child)) {
            current[segment] = {};
        }
        current = current[segment] as Record<string, JsonValue>;
    }
    const leaf = segments.at(-1);
    if (leaf) {
        current[leaf] = value;
    }
}

function cloneRecord(value: unknown): Record<string, JsonValue> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    return cloneJsonValue(value as JsonValue) as Record<string, JsonValue>;
}

function issueResult(namespace: VariableNamespace, path: string, code: VariableReadResult["issue"] extends infer TIssue ? TIssue extends {code: infer TCode} ? TCode : never : never, message: string): VariableReadResult {
    return {
        path: `${namespace}.${path}`,
        issue: {
            code,
            path: `${namespace}.${path}`,
            message,
        },
    };
}

function isIssueRelevant(query: VariableSchemaQuery, issuePath: string): boolean {
    if (query.paths?.length) {
        const namespaces = new Set(query.paths.map((path) => normalizeVariablePath(path).split(".")[0]));
        return namespaces.has(issuePath.split(".")[0]);
    }
    if (query.namespace && issuePath.split(".")[0] !== query.namespace) {
        return false;
    }
    if (!query.prefix) {
        return true;
    }
    if (!query.namespace) {
        return true;
    }
    const prefix = `${query.namespace}.${normalizeVariablePath(query.prefix)}`;
    return issuePath === prefix || issuePath.startsWith(`${prefix}.`) || issuePath === `${query.namespace}.definitions.ts`;
}

function fingerprintValue(value: JsonValue | undefined): string {
    return createHash("sha256")
        .update(stableStringify(value === undefined ? {__nbookVariableMissing: true} : value))
        .digest("hex");
}

function stableStringify(value: JsonValue | {__nbookVariableMissing: true}): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    }
    return `{${Object.keys(value).sort().map((key) => {
        const child = (value as Record<string, JsonValue | undefined>)[key];
        return `${JSON.stringify(key)}:${stableStringify(child === undefined ? null : child)}`;
    }).join(",")}}`;
}
