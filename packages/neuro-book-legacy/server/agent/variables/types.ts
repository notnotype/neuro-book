import type {TSchema} from "typebox";
import type {JsonValue} from "nbook/server/agent/messages/types";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";
import type {
    VariableDefinition,
    VariableNamespace,
    VariableWriter,
    VariableWriteMode,
} from "nbook/variable-sdk/contracts";

export type {VariableDefinition, VariableNamespace, VariableWriter, VariableWriteMode} from "nbook/variable-sdk/contracts";

export type ClientStateSnapshot = {
    ide?: Record<string, JsonValue>;
    studio?: Record<string, JsonValue>;
    [key: string]: JsonValue | Record<string, JsonValue> | undefined;
};

export type VariableRootCatalogItem = {
    $ref: string;
    title?: string;
    summary?: string;
    readable: boolean;
    writableByAgent: boolean;
};

export type VariableCatalog = {
    summary: string;
    clientVariables: Record<string, VariableRootCatalogItem>;
    globalVariables: Record<string, VariableRootCatalogItem>;
    projectVariables: Record<string, VariableRootCatalogItem>;
    sessionVariables: Record<string, VariableRootCatalogItem>;
};

export type VariableSchemaDetail = {
    path: string;
    namespace: VariableNamespace;
    key: string;
    schema: TSchema;
    readable: boolean;
    writableByAgent: boolean;
    summary?: string;
};

export type VariableSnapshot = {
    client: Record<string, JsonValue>;
    global: Record<string, JsonValue>;
    project: Record<string, JsonValue>;
    session: Record<string, JsonValue>;
};

export type VariableJsonPatchOperation =
    | {op: "add" | "replace" | "test"; path: string; value: JsonValue}
    | {op: "remove"; path: string};

export type VariablePatchAudit = {
    namespace: VariableNamespace;
    path: string;
    operations: VariableJsonPatchOperation[];
    source: "agent" | "profile" | "frontend" | "user";
    invocationId?: string;
    toolCallId?: string;
};

export type VariableAccessorIssue = {
    code: "unavailable" | "not_registered" | "not_readable" | "not_writable" | "schema_mismatch" | "storage_error" | "not_compiled" | "compile_stale" | "compiled_load_failed" | "stale_read_required" | "stale_fingerprint";
    path: string;
    message: string;
};

export type VariableReadOptions = {
    maxBytes?: number;
};

export type VariableReadResult = {
    path: string;
    value?: JsonValue;
    truncated?: boolean;
    /** 最近一次成功读取的值指纹。Agent 不需要手写，只由 read-before-patch 防 stale 使用。 */
    fingerprint?: string;
    issue?: VariableAccessorIssue;
};

/**
 * 变量类型生成器会通过 module augmentation 扩展这个 map。
 * 运行时不依赖该类型；它只服务 TSX profile authoring 补全与返回值推导。
 */
export interface ProfileVariableValueMap {
}

export type ProfileVariablePath = keyof ProfileVariableValueMap & string;

export type ProfileVariablePathInput = ProfileVariablePath | (string & {});

export type TypedVariableReadResult<TValue> = Omit<VariableReadResult, "value"> & {
    value?: TValue;
};

export type VariableSchemaQuery = {
    namespace?: VariableNamespace;
    prefix?: string;
    paths?: ProfileVariablePathInput[];
    writableOnly?: boolean;
    detail?: boolean;
};

export type VariableSchemaResult = {
    catalog: VariableCatalog;
    schemas: VariableSchemaDetail[];
    issues: VariableAccessorIssue[];
};

export type VariablePatchRequest = {
    namespace: VariableNamespace;
    path: string;
    operations: VariableJsonPatchOperation[];
    invocationId?: string;
    toolCallId?: string;
};

export type VariablePatchAck = {
    namespace: "client";
    path: string;
    operations: VariableJsonPatchOperation[];
    appliedValue?: JsonValue;
    error?: string;
    invocationId?: string;
    toolCallId?: string;
};

export type ClientVariablePatchHandler = (request: VariablePatchRequest) => Promise<VariablePatchAck>;

export type ProfileVariableAccessor = {
    readonly dryRun: boolean;
    catalog(query?: VariableSchemaQuery): VariableSchemaResult;
    get<P extends ProfileVariablePath>(path: P): Promise<ProfileVariableValueMap[P] | undefined>;
    get(path: string): Promise<JsonValue | undefined>;
    read<P extends ProfileVariablePath>(path: P, options?: VariableReadOptions): Promise<TypedVariableReadResult<ProfileVariableValueMap[P]>>;
    read(path: string, options?: VariableReadOptions): Promise<VariableReadResult>;
    patch(namespace: VariableNamespace, path: string, operations: VariableJsonPatchOperation[], source?: VariablePatchAudit["source"], toolCallId?: string): Promise<VariableReadResult>;
};

export type VariableInvocationState = {
    readFingerprints: Map<string, string>;
    clientOverlay: Record<string, JsonValue>;
    /** invocation进入Project数据面时捕获；null表示本轮没有Current Project。 */
    currentProject: ReadyProjectSessionRef | null;
};
