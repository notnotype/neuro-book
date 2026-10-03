import {isAbsolute, posix, win32} from "node:path";
import {parseFollowUpQueue, parseStoredMessage} from "nbook/server/agent/messages/stored-message-codec";
import {parseCodexPatch} from "nbook/server/agent/tools/apply-patch";

const TARGET_SCHEMA_VERSION = 2;
const FOLLOW_UP_QUEUE_KEY = "agent.followUpQueue";
const PENDING_RESOLUTION_PREFIX = "agent.pendingUserResolution.";
const MIGRATION_CANCEL_CODE = "SESSION_PATH_CONTRACT_MIGRATION";
const REVIEW_REASON_ORDER = ["current_project_unresolved"] as const;
const HISTORICAL_REVIEW_REASON_ORDER = ["external_project", "ambiguous_path"] as const;
const PROFILE_REMINDERS_TO_RESET = ["runtime-location", "workspace-focus"] as const;

type JsonNode = null | boolean | number | string | JsonNode[] | JsonObject;
type JsonObject = {[key: string]: JsonNode};

export type SessionMigrationReviewReason = typeof REVIEW_REASON_ORDER[number];
export type SessionMigrationRecordedReviewReason = SessionMigrationReviewReason
    | typeof HISTORICAL_REVIEW_REASON_ORDER[number];

export type LegacySessionClassification =
    | "managed"
    | "stale_managed"
    | "user_assets"
    | "external"
    | "workspace_root";

export type SessionSchemaV2MigrationStats = {
    rewrittenPaths: number;
    resetProfileReminders: number;
    cancelledToolCalls: number;
    clearedPendingResolutions: number;
    clearedFollowUpQueue: boolean;
};

export type SessionSchemaV2MigrationPlan = {
    sourcePath: string;
    sessionId: number;
    classification: LegacySessionClassification;
    currentProjectRoot?: string;
    decoderFormat: 1 | 2;
    reviewReasons: SessionMigrationRecordedReviewReason[];
    ambiguousLocations: string[];
    targetText: string;
    stats: SessionSchemaV2MigrationStats;
};

export type DecodeSessionSchemaV1Input = {
    sourcePath: string;
    text: string;
    /** 同一次 dry-run/apply 必须复用同一时间戳，保证 target checksum 稳定。 */
    migrationTimestamp: number;
    /** 全库 inventory；undefined 表示未提供，空数组表示已确认当前没有 Project。 */
    knownProjectRoots?: readonly string[];
    /** invoke_agent 只有 sessionId，runner 通过全库 header inventory 注入目标 profile。 */
    profileBySessionId?: Readonly<Record<string, string>>;
    /** 1仅用于恢复旧catalog中断run；普通新迁移固定使用2。 */
    decoderFormat?: 1 | 2;
};

type ManagedScope = {
    kind: "managed";
    projectRoot: string;
    stale: boolean;
};

type ExternalScope = {
    kind: "external";
    root: string;
};

type SessionScope = ManagedScope | ExternalScope | {
    kind: "user_assets" | "workspace_root";
};

type MigrationContext = {
    sourcePath: string;
    sessionId: number;
    profileKey: string;
    scope: SessionScope;
    profileBySessionId: Readonly<Record<string, string>>;
    reviewReasons: Set<SessionMigrationRecordedReviewReason>;
    decoderFormat: 1 | 2;
    ambiguousLocations: Set<string>;
    stats: SessionSchemaV2MigrationStats;
};

type PathRewrite = {
    value: string;
    ambiguous: boolean;
};

type ProjectLocatorRewrite = {
    value?: string;
    ambiguous: boolean;
};

/**
 * 严格解码一个 schema v1 Session JSONL，并生成纯内存的 schema v2 target。
 * 本文件只允许被一次性 migration 导入，production runtime 不得依赖旧格式。
 */
export function decodeSessionSchemaV1(input: DecodeSessionSchemaV1Input): SessionSchemaV2MigrationPlan {
    assertMigrationTimestamp(input.migrationTimestamp);
    const trailingNewline = input.text.endsWith("\n");
    const records = parseRecords(input.sourcePath, input.text);
    const header = singleHeader(records, input.sourcePath);
    const metadata = objectValue(header.metadata);
    if (!metadata) {
        throw new Error(`${input.sourcePath}: header.metadata 必须是对象`);
    }
    if (metadata.schemaVersion !== undefined) {
        throw new Error(`${input.sourcePath}: 只接受未带 schemaVersion 的 schema v1 header`);
    }
    const sessionId = safePositiveInteger(metadata.sessionId, `${input.sourcePath}: header.metadata.sessionId`);
    const profileKey = requiredString(metadata.profileKey, `${input.sourcePath}: header.metadata.profileKey`);
    const scopeResult = classifyScope(metadata, input.knownProjectRoots);
    const decoderFormat = input.decoderFormat ?? 2;
    const context: MigrationContext = {
        sourcePath: input.sourcePath,
        sessionId,
        profileKey,
        scope: scopeResult.scope,
        profileBySessionId: input.profileBySessionId ?? {},
        reviewReasons: new Set(scopeResult.ambiguous
            ? [decoderFormat === 1 ? "ambiguous_path" : "current_project_unresolved"]
            : []),
        decoderFormat,
        ambiguousLocations: new Set(scopeResult.ambiguous ? ["header.metadata.projectPath"] : []),
        stats: {
            rewrittenPaths: 0,
            resetProfileReminders: 0,
            cancelledToolCalls: 0,
            clearedPendingResolutions: 0,
            clearedFollowUpQueue: false,
        },
    };
    if (context.scope.kind === "external") {
        context.reviewReasons.add(decoderFormat === 1 ? "external_project" : "current_project_unresolved");
    }

    migrateProfileValue(profileKey, metadata.initial, "initial", context, "header.metadata.initial");
    for (const record of records) {
        for (const entry of recordEntries(record)) {
            migrateEntry(entry, context);
        }
    }

    const entries = records.flatMap((record) => recordEntries(record));
    const migrationEntries = buildMigrationEntries(entries, input.migrationTimestamp, context);
    records.push({kind: "batch", entries: migrationEntries});
    writeV2Metadata(metadata, context);
    validateTarget(records, context);

    return {
        sourcePath: input.sourcePath,
        sessionId,
        classification: classification(context.scope),
        ...(context.scope.kind === "managed" ? {currentProjectRoot: context.scope.projectRoot} : {}),
        decoderFormat,
        reviewReasons: orderedReviewReasons(context.reviewReasons),
        ambiguousLocations: [...context.ambiguousLocations].sort(),
        targetText: `${records.map((record) => JSON.stringify(record)).join("\n")}${trailingNewline ? "\n" : ""}`,
        stats: context.stats,
    };
}

/** 解析 JSONL 并把 JSON.parse 的 unknown 边界收窄为可遍历 JsonObject。 */
function parseRecords(sourcePath: string, text: string): JsonObject[] {
    const lines = text.split(/\r?\n/u).filter((line, index, values) => line.length > 0 || index < values.length - 1);
    if (lines.length === 0) {
        throw new Error(`${sourcePath}: session JSONL 为空`);
    }
    return lines.map((line, index) => {
        let value: JsonNode;
        try {
            // JSON.parse 是离线 migration 的外部数据边界；后续访问全部经过 JsonNode 守卫。
            value = JSON.parse(line) as JsonNode;
        } catch (error) {
            throw new Error(`${sourcePath}:${String(index + 1)} JSON 无法解析：${errorMessage(error)}`);
        }
        const record = objectValue(value);
        if (!record) {
            throw new Error(`${sourcePath}:${String(index + 1)} record 必须是对象`);
        }
        return record;
    });
}

/** 取得唯一 header；重复或缺失都属于不可迁移的 store corruption。 */
function singleHeader(records: JsonObject[], sourcePath: string): JsonObject {
    const headers = records.filter((record) => record.kind === "header");
    if (headers.length !== 1) {
        throw new Error(`${sourcePath}: schema v1 必须且只能包含一个 header`);
    }
    return headers[0] as JsonObject;
}

/** 根据旧 header 四类映射决定新 Current Project 与路径解释基准。 */
function classifyScope(
    metadata: JsonObject,
    knownProjectRoots: readonly string[] | undefined,
): {scope: SessionScope; ambiguous: boolean} {
    const workspaceRoot = typeof metadata.workspaceRoot === "string" ? normalizeSlashes(metadata.workspaceRoot) : "";
    const workspaceKey = typeof metadata.workspaceKey === "string" ? normalizeSlashes(metadata.workspaceKey) : "";
    const projectPath = typeof metadata.projectPath === "string" ? normalizeSlashes(metadata.projectPath) : "";
    if (workspaceRoot === "workspace/.nbook" || workspaceKey === "user-assets" || projectPath === "workspace/.nbook") {
        return {scope: {kind: "user_assets"}, ambiguous: false};
    }
    const externalRoot = [projectPath, workspaceRoot].find((value) => isAnyAbsolute(value));
    if (externalRoot) {
        return {scope: {kind: "external", root: externalRoot}, ambiguous: false};
    }
    const managedRoot = managedProjectRoot(projectPath)
        ?? managedProjectRoot(workspaceRoot)
        ?? managedProjectRoot(workspaceKey);
    if (managedRoot) {
        return {
            scope: {
                kind: "managed",
                projectRoot: managedRoot,
                stale: knownProjectRoots !== undefined && !knownProjectRoots.includes(managedRoot),
            },
            ambiguous: false,
        };
    }
    return projectPath
        ? {scope: {kind: "workspace_root"}, ambiguous: true}
        : {scope: {kind: "workspace_root"}, ambiguous: false};
}

/** 把内部 scope 投影为 runner/report 使用的稳定分类。 */
function classification(scope: SessionScope): LegacySessionClassification {
    if (scope.kind === "managed") {
        return scope.stale ? "stale_managed" : "managed";
    }
    return scope.kind;
}

/** 写入唯一 v2 header 字段并删除全部 durable 旧路径身份。 */
function writeV2Metadata(metadata: JsonObject, context: MigrationContext): void {
    metadata.schemaVersion = TARGET_SCHEMA_VERSION;
    delete metadata.workspaceRoot;
    delete metadata.workspaceKey;
    delete metadata.projectPath;
    if (context.scope.kind === "managed") {
        metadata.currentProjectRoot = context.scope.projectRoot;
    } else {
        delete metadata.currentProjectRoot;
    }
    const reasons = orderedReviewReasons(context.reviewReasons);
    if (reasons.length > 0) {
        if (context.decoderFormat === 1) {
            metadata.migrationReview = {status: "required", reasons};
        } else {
            delete metadata.currentProjectRoot;
            metadata.migrationReview = {status: "required", reason: "current_project_unresolved"};
        }
    } else {
        delete metadata.migrationReview;
    }
}

/** 返回 entry/batch 中的 entry；其它 record 不参与 transcript 迁移。 */
function recordEntries(record: JsonObject): JsonObject[] {
    if (record.kind === "entry") {
        const entry = objectValue(record.entry);
        if (!entry) {
            throw new Error("entry record 缺少 entry 对象");
        }
        return [entry];
    }
    if (record.kind === "batch") {
        if (!Array.isArray(record.entries)) {
            throw new Error("batch record 缺少 entries 数组");
        }
        return record.entries.map((entry) => {
            const object = objectValue(entry);
            if (!object) {
                throw new Error("batch entries 只能包含对象");
            }
            return object;
        });
    }
    return [];
}

/** 按 entry discriminator 迁移有正式 owner 的 durable structured fields。 */
function migrateEntry(entry: JsonObject, context: MigrationContext): void {
    if (entry.type === "message" || entry.type === "custom_message") {
        migrateMessage(entry.message, context, `entry.${requiredString(entry.id, "entry.id")}.message`);
        return;
    }
    if (entry.type === "custom") {
        migrateCustomEntry(entry, context);
        return;
    }
    if (entry.type === "profile_change") {
        const profileKey = requiredString(entry.profileKey, "profile_change.profileKey");
        migrateProfileValue(profileKey, entry.input, "initial", context, `profile_change.${profileKey}.input`);
        return;
    }
    if (entry.type === "variable_patch" || entry.type === "client_variable_patch_ack") {
        migrateVariablePatch(entry, context);
    }
}

/** 迁移 assistant tool call 与 tool result；普通正文、thinking 和用户文本保持原样。 */
function migrateMessage(value: JsonNode | undefined, context: MigrationContext, location: string): void {
    const message = objectValue(value);
    if (!message) {
        throw new Error(`${location} 必须是对象`);
    }
    if (message.role === "assistant") {
        if (!Array.isArray(message.content)) {
            throw new Error(`${location}.content 必须是数组`);
        }
        for (const [index, blockValue] of message.content.entries()) {
            const block = objectValue(blockValue);
            if (block?.type !== "toolCall") {
                continue;
            }
            migrateToolCall(block, context, `${location}.content[${String(index)}]`);
        }
        return;
    }
    if (message.role === "toolResult") {
        migrateToolResult(message, context, location);
    }
}

/** 迁移 tool arguments 中由 tool schema 证明的 locator/path 字段。 */
function migrateToolCall(block: JsonObject, context: MigrationContext, location: string): void {
    const name = requiredString(block.name, `${location}.name`);
    const args = objectValue(block.arguments);
    if (!args) {
        markAmbiguous(context, `${location}.arguments`);
        return;
    }

    if (name === "read" || name === "write" || name === "edit") {
        rewriteStringField(args, "path", "workspace", context, `${location}.arguments.path`);
    } else if (name === "apply_patch") {
        migrateApplyPatch(args, context, `${location}.arguments.patch`);
    } else if (name === "create_agent") {
        migrateCreateAgent(args, context, location);
    } else if (name === "invoke_agent") {
        migrateInvokeAgent(args, context, location);
    } else if (name === "switch_mode" || name === "exit_plan_mode") {
        rewriteStringField(args, "planFilePath", "workspace", context, `${location}.arguments.planFilePath`, true);
    } else if (name === "run_workflow") {
        migrateWorkflow(args, context, location);
    } else if (isSubjectTool(name)) {
        rewriteStringField(args, "subjectPath", "project", context, `${location}.arguments.subjectPath`);
    }

    for (const field of projectRelativeToolFields(name)) {
        rewriteStringField(args, field, "project", context, `${location}.arguments.${field}`, true, true);
    }
    migrateProjectLocatorField(args, context, `${location}.arguments`);
    if (name === "report_result" || name === "report_sidecar_result") {
        migrateProfileValue(context.profileKey, args.data, "output", context, `${location}.arguments.data`);
    }
}

/** create_agent 删除旧 scope，并按目标 profile InitialSchema 迁移结构化 initial。 */
function migrateCreateAgent(args: JsonObject, context: MigrationContext, location: string): void {
    if (args.workspaceRoot !== undefined) {
        if (typeof args.workspaceRoot !== "string") {
            markAmbiguous(context, `${location}.arguments.workspaceRoot`);
        } else if (context.decoderFormat === 1 && isAnyAbsolute(args.workspaceRoot)) {
            context.reviewReasons.add("external_project");
        }
        delete args.workspaceRoot;
        context.stats.rewrittenPaths += 1;
    }
    if (args.initial === undefined && args.input !== undefined) {
        args.initial = args.input;
        delete args.input;
    } else if (args.initial !== undefined && args.input !== undefined) {
        markAmbiguous(context, `${location}.arguments.input`);
    }
    const profileKey = typeof args.profileKey === "string" ? args.profileKey : "";
    if (profileKey && args.initial !== undefined) {
        migrateProfileValue(profileKey, args.initial, "initial", context, `${location}.arguments.initial`);
    }
}

/** invoke_agent 使用 runner 的全库 session/profile inventory 解释目标 PayloadSchema。 */
function migrateInvokeAgent(args: JsonObject, context: MigrationContext, location: string): void {
    if (args.input === undefined) {
        return;
    }
    const sessionId = typeof args.sessionId === "number" && Number.isSafeInteger(args.sessionId)
        ? String(args.sessionId)
        : "";
    const profileKey = sessionId ? context.profileBySessionId[sessionId] : undefined;
    if (!profileKey) {
        if (hasTopLevelPathField(args.input)) {
            markAmbiguous(context, `${location}.arguments.input`);
        }
        return;
    }
    migrateProfileValue(profileKey, args.input, "invocation", context, `${location}.arguments.input`);
}

/** 仅内置 split-book 有可证明的 path 参数；inline script 和未知 workflow args 不猜测。 */
function migrateWorkflow(args: JsonObject, context: MigrationContext, location: string): void {
    const workflowArgs = objectValue(args.args);
    if (!workflowArgs) {
        return;
    }
    if (args.workflowKey === "split-book") {
        if (context.decoderFormat === 1) {
            rewriteStringField(workflowArgs, "path", "project", context, `${location}.arguments.args.path`, true);
            if (workflowArgs.filePath !== undefined) {
                markAmbiguous(context, `${location}.arguments.args.filePath`);
            }
            return;
        }
        if (workflowArgs.filePath !== undefined) {
            if (workflowArgs.path === undefined) {
                workflowArgs.path = workflowArgs.filePath;
            } else {
                markAmbiguous(context, `${location}.arguments.args.filePath`);
            }
            delete workflowArgs.filePath;
        }
        rewriteStringField(workflowArgs, "path", "project", context, `${location}.arguments.args.path`, true);
        return;
    }
    if (hasTopLevelPathField(workflowArgs)) {
        markAmbiguous(context, `${location}.arguments.args`);
    }
}

/** apply_patch 先由正式 parser 校验，再只重写 operation header，绝不替换 patch body。 */
function migrateApplyPatch(args: JsonObject, context: MigrationContext, location: string): void {
    if (typeof args.patch !== "string") {
        markAmbiguous(context, location);
        return;
    }
    try {
        parseCodexPatch(args.patch);
    } catch {
        markAmbiguous(context, location);
        return;
    }
    const separator = args.patch.includes("\r\n") ? "\r\n" : "\n";
    const prefixes = ["*** Add File: ", "*** Delete File: ", "*** Update File: ", "*** Move to: "];
    args.patch = args.patch.split(/\r?\n/u).map((line) => {
        const prefix = prefixes.find((candidate) => line.startsWith(candidate));
        if (!prefix) {
            return line;
        }
        const oldPath = line.slice(prefix.length).trim();
        const rewritten = rewriteWorkspaceAddress(oldPath, context.scope);
        if (rewritten.ambiguous) {
            markAmbiguous(context, location);
            return line;
        }
        if (rewritten.value !== oldPath) {
            context.stats.rewrittenPaths += 1;
        }
        return `${prefix}${rewritten.value}`;
    }).join(separator);
}

/** 迁移有 discriminator 的 tool result details；content 文本和 planContent 永远不改。 */
function migrateToolResult(message: JsonObject, context: MigrationContext, location: string): void {
    const toolName = typeof message.toolName === "string" ? message.toolName : "";
    if (toolName === "get_agent") {
        migrateGetAgentResult(message.details, context, `${location}.details`);
        return;
    }
    const details = objectValue(message.details);
    if (!details) {
        return;
    }
    if (toolName === "get_session") {
        migrateGetSessionResult(details, context, `${location}.details`);
        return;
    }
    if (toolName === "read") {
        rewriteStringField(details, "path", "workspace", context, `${location}.details.path`, true);
        return;
    }
    if (toolName === "apply_patch") {
        const files = details.files;
        if (files !== undefined && !Array.isArray(files)) {
            markAmbiguous(context, `${location}.details.files`);
            return;
        }
        for (const [index, fileValue] of (files ?? []).entries()) {
            const file = objectValue(fileValue);
            if (!file) {
                markAmbiguous(context, `${location}.details.files[${String(index)}]`);
                continue;
            }
            rewriteStringField(file, "path", "workspace", context, `${location}.details.files[${String(index)}].path`);
        }
        return;
    }
    if (isSubjectTool(toolName)) {
        rewriteStringField(details, "subjectPath", "project", context, `${location}.details.subjectPath`, true);
        if (toolName === "subject_event_append") {
            rewriteStringField(details, "sourcePath", "project", context, `${location}.details.sourcePath`, true);
        }
        return;
    }
    for (const field of projectRelativeToolFields(toolName)) {
        rewriteStringField(details, field, "project", context, `${location}.details.${field}`, true, true);
    }
    if (projectRelativeToolFields(toolName).length > 0) {
        return;
    }
    if (toolName === "switch_mode" || toolName === "exit_plan_mode") {
        const data = objectValue(details.data);
        if (data) {
            rewriteStringField(data, "planFilePath", "workspace", context, `${location}.details.data.planFilePath`, true);
        }
        return;
    }
    if (toolName === "report_result" || toolName === "report_sidecar_result") {
        migrateProfileValue(context.profileKey, details.data, "output", context, `${location}.details.data`);
        return;
    }
    if (toolName === "variable_read") {
        // variable_read.path 是变量 registry 地址，不是文件路径。
        return;
    }
    if (toolName === "bash") {
        migrateBashResult(details, context, `${location}.details`);
        return;
    }
    const hasUnknownPath = hasTopLevelPathField(details, new Set(["projectPath", "projectRoot"]));
    migrateProjectLocatorField(details, context, `${location}.details`);
    if (hasUnknownPath) {
        markAmbiguous(context, `${location}.details`);
    }
}

/** get_agent details 可能是单个 summary 或 owned-agent summary 数组。 */
function migrateGetAgentResult(value: JsonNode | undefined, context: MigrationContext, location: string): void {
    if (value === undefined || value === null) {
        return;
    }
    const summaries = Array.isArray(value) ? value : [value];
    for (const [index, summaryValue] of summaries.entries()) {
        const summary = objectValue(summaryValue);
        const itemLocation = Array.isArray(value) ? `${location}[${String(index)}]` : location;
        if (!summary) {
            markAmbiguous(context, itemLocation);
            continue;
        }
        migrateNestedProjectIdentity(summary, context, itemLocation);
    }
}

/** get_session details 内嵌完整 metadata 与 linked Agent summaries，均需移除 durable 旧 scope。 */
function migrateGetSessionResult(details: JsonObject, context: MigrationContext, location: string): void {
    const metadata = objectValue(details.metadata);
    if (details.metadata !== undefined && !metadata) {
        markAmbiguous(context, `${location}.metadata`);
    }
    if (metadata) {
        const targetScope = migrateNestedProjectIdentity(metadata, context, `${location}.metadata`);
        metadata.schemaVersion = TARGET_SCHEMA_VERSION;
        if (metadata.input !== undefined) {
            if (metadata.initial === undefined) {
                metadata.initial = metadata.input;
            } else {
                markAmbiguous(context, `${location}.metadata.input`);
            }
            delete metadata.input;
            context.stats.rewrittenPaths += 1;
        }
        const targetProfileKey = typeof metadata.profileKey === "string" ? metadata.profileKey : "";
        if (targetProfileKey && metadata.initial !== undefined) {
            migrateProfileValue(targetProfileKey, metadata.initial, "initial", {
                ...context,
                profileKey: targetProfileKey,
                scope: targetScope,
            }, `${location}.metadata.initial`);
        }
    }

    if (details.linkedAgents === undefined) {
        return;
    }
    if (!Array.isArray(details.linkedAgents)) {
        markAmbiguous(context, `${location}.linkedAgents`);
        return;
    }
    for (const [index, summaryValue] of details.linkedAgents.entries()) {
        const summary = objectValue(summaryValue);
        if (!summary) {
            markAmbiguous(context, `${location}.linkedAgents[${String(index)}]`);
            continue;
        }
        migrateNestedProjectIdentity(summary, context, `${location}.linkedAgents[${String(index)}]`);
    }
}

/** 删除 tool result 中复制的旧 Session scope，并返回该嵌套 session 的路径解释基准。 */
function migrateNestedProjectIdentity(
    value: JsonObject,
    context: MigrationContext,
    location: string,
): SessionScope {
    const scopeResult = classifyScope(value, undefined);
    if (scopeResult.ambiguous) {
        markAmbiguous(context, `${location}.projectPath`);
    }
    if (context.decoderFormat === 1 && scopeResult.scope.kind === "external") {
        context.reviewReasons.add("external_project");
    }
    for (const key of ["workspaceRoot", "workspaceKey", "projectPath"] as const) {
        if (value[key] !== undefined) {
            delete value[key];
            context.stats.rewrittenPaths += 1;
        }
    }
    if (scopeResult.scope.kind === "managed") {
        updateStringValue(value, "currentProjectRoot", scopeResult.scope.projectRoot, context);
    } else if (value.currentProjectRoot !== undefined) {
        delete value.currentProjectRoot;
        context.stats.rewrittenPaths += 1;
    }
    return scopeResult.scope;
}

/** 旧绝对临时文件不能跨生命周期迁移；删除路径并明确标记已回收。 */
function migrateBashResult(details: JsonObject, context: MigrationContext, location: string): void {
    if (details.fullOutputPath === undefined) {
        return;
    }
    if (typeof details.fullOutputPath !== "string" || !isAnyAbsolute(details.fullOutputPath)) {
        markAmbiguous(context, `${location}.fullOutputPath`);
    }
    delete details.fullOutputPath;
    details.fullOutput = {state: "reclaimed"};
    context.stats.rewrittenPaths += 1;
}

/** 迁移已知 custom projection；关系账本和 Attachment 不含路径，原样保留。 */
function migrateCustomEntry(entry: JsonObject, context: MigrationContext): void {
    const key = requiredString(entry.key, "custom.key");
    const value = objectValue(entry.value);
    if (key === "plot.selection") {
        if (!value) {
            markAmbiguous(context, "custom.plot.selection");
            return;
        }
        migrateProjectLocatorField(value, context, "custom.plot.selection");
        return;
    }
    if (key === "agent.mode" || key === "agent.planMode") {
        if (!value) {
            markAmbiguous(context, `custom.${key}`);
            return;
        }
        rewriteStringField(value, "workDirectory", "workspace", context, `custom.${key}.workDirectory`, true);
        return;
    }
    if (key.startsWith("profileState.")) {
        migrateProfileState(value, context, `custom.${key}`);
    }
}

/** 删除带旧物理 root/fingerprint 的可重建 reminder projection，让下一轮按新 runtime 重建。 */
function migrateProfileState(value: JsonObject | null, context: MigrationContext, location: string): void {
    if (!value) {
        markAmbiguous(context, location);
        return;
    }
    const reminders = objectValue(value.reminders);
    if (!reminders) {
        return;
    }
    for (const reminder of PROFILE_REMINDERS_TO_RESET) {
        if (reminders[reminder] !== undefined) {
            delete reminders[reminder];
            context.stats.resetProfileReminders += 1;
        }
    }
}

/** 只迁移 registry 已证明承载 locator/file path 的 client variable values；JSON Pointer 不改。 */
function migrateVariablePatch(entry: JsonObject, context: MigrationContext): void {
    if (entry.namespace !== "client" || typeof entry.path !== "string" || !Array.isArray(entry.operations)) {
        return;
    }
    for (const [index, operationValue] of entry.operations.entries()) {
        const operation = objectValue(operationValue);
        if (!operation || operation.value === undefined || typeof operation.path !== "string") {
            continue;
        }
        const target = clientVariableTarget(entry.path, operation.path);
        if (!target || operation.value === null) {
            continue;
        }
        if (typeof operation.value !== "string") {
            markAmbiguous(context, `variable_patch.operations[${String(index)}].value`);
            continue;
        }
        if (target === "workspace") {
            const rewritten = rewriteProjectLocator(operation.value);
            if (!rewritten.value || rewritten.ambiguous) {
                markAmbiguous(context, `variable_patch.operations[${String(index)}].value`);
                continue;
            }
            updateStringValue(operation, "value", rewritten.value, context);
            continue;
        }
        const rewritten = rewriteProjectRelativePath(operation.value, context.scope);
        if (rewritten.ambiguous) {
            markAmbiguous(context, `variable_patch.operations[${String(index)}].value`);
            continue;
        }
        updateStringValue(operation, "value", rewritten.value, context);
    }
}

/** 将 variable patch 的 root path + JSON Pointer 收窄为三个已注册字段。 */
function clientVariableTarget(rootPath: string, operationPath: string): "workspace" | "selected_file" | null {
    const direct: Record<string, "workspace" | "selected_file"> = {
        currentProjectWorkspace: "workspace",
        "studio.workspace": "workspace",
        "studio.selectedFilePath": "selected_file",
        "studio.previousSelectedFilePath": "selected_file",
    };
    if (direct[rootPath]) {
        return operationPath === "" || operationPath === "/" ? direct[rootPath] : null;
    }
    if (rootPath !== "studio") {
        return null;
    }
    const field = operationPath.split("/")[1]?.replaceAll("~1", "/").replaceAll("~0", "~") ?? "";
    return direct[`studio.${field}`] ?? null;
}

type ProfileValueKind = "initial" | "invocation" | "output";

/** 按内置 profile 的 schema 版本迁移路径字段；未知 profile 只报告顶层歧义，不递归猜测。 */
function migrateProfileValue(
    profileKey: string,
    value: JsonNode | undefined,
    kind: ProfileValueKind,
    context: MigrationContext,
    location: string,
): void {
    if (value === undefined) {
        return;
    }
    const payload = objectValue(value);
    if (!payload) {
        // null、primitive 与 array 没有可由当前 profile schema证明的顶层路径字段，原样保留。
        return;
    }
    const handled = kind === "initial"
        ? migrateProfileInitial(profileKey, payload, context, location)
        : kind === "invocation"
            ? migrateProfileInvocation(profileKey, payload, context, location)
            : migrateProfileOutput(profileKey, payload, context, location);
    if (!handled && hasTopLevelPathField(payload)) {
        markAmbiguous(context, location);
    }
}

/** 迁移历史 InitialSchema 中已证明的 Project locator 与 Project-relative 文件字段。 */
function migrateProfileInitial(profileKey: string, payload: JsonObject, context: MigrationContext, location: string): boolean {
    const fields: Record<string, readonly string[]> = {
        director: ["defaultChapterPath"],
        "leader.rp": ["simulationRoot"],
        "memory.curator": ["subjectPath"],
        "rp.actor": ["instructionPath", "eventsPath", "knowledgePath", "memoryPath", "mindPath", "statePath", "subjectPath"],
        "rp.writer": ["writerInstructionPath"],
        "simulator.actor": ["instructionPath", "eventsPath", "memoryPath", "mindPath", "statePath", "subjectPath"],
        "simulator.leader": ["simulationRoot"],
    };
    const projectOwnedProfiles = new Set(["director", "rp.leader", "simulator.leader"]);
    const handled = Boolean(fields[profileKey]) || projectOwnedProfiles.has(profileKey);
    if (projectOwnedProfiles.has(profileKey) && payload.projectPath !== undefined) {
        if (typeof payload.projectPath !== "string") {
            markAmbiguous(context, `${location}.projectPath`);
        }
        delete payload.projectPath;
        context.stats.rewrittenPaths += 1;
    }
    for (const field of fields[profileKey] ?? []) {
        rewriteStringField(payload, field, "project", context, `${location}.${field}`, true);
    }
    return handled;
}

/** 迁移 invoke_agent.input 中两个正式 PayloadSchema 的 Project-relative路径。 */
function migrateProfileInvocation(profileKey: string, payload: JsonObject, context: MigrationContext, location: string): boolean {
    if (profileKey === "writer") {
        rewriteStringField(payload, "path", "project", context, `${location}.path`);
        const profileContext = objectValue(payload.context);
        if (profileContext) {
            rewriteStringArrayField(profileContext, "lorebookEntries", context, `${location}.context.lorebookEntries`);
            rewriteStringArrayField(profileContext, "readablePaths", context, `${location}.context.readablePaths`);
        }
        return true;
    }
    if (profileKey === "inline.editor") {
        rewriteStringField(payload, "targetPath", "project", context, `${location}.targetPath`);
        if (Array.isArray(payload.references)) {
            for (const [index, referenceValue] of payload.references.entries()) {
                const reference = objectValue(referenceValue);
                if (!reference) {
                    markAmbiguous(context, `${location}.references[${String(index)}]`);
                    continue;
                }
                rewriteStringField(reference, "path", "project", context, `${location}.references[${String(index)}].path`);
            }
        }
        return true;
    }
    return false;
}

/** 迁移 report_result 中由内置 OutputSchema 声明的 Project-relative path。 */
function migrateProfileOutput(profileKey: string, payload: JsonObject, context: MigrationContext, location: string): boolean {
    if (profileKey === "writer") {
        rewriteStringField(payload, "outputPath", "project", context, `${location}.outputPath`, true);
        return true;
    }
    if (profileKey === "retrieval" && Array.isArray(payload.entries)) {
        for (const [index, entryValue] of payload.entries.entries()) {
            const entry = objectValue(entryValue);
            if (!entry) {
                markAmbiguous(context, `${location}.entries[${String(index)}]`);
                continue;
            }
            rewriteStringField(entry, "path", "project", context, `${location}.entries[${String(index)}].path`);
        }
        return true;
    }
    return false;
}

/** 迁移 schema 声明的 Project-relative string array。 */
function rewriteStringArrayField(object: JsonObject, key: string, context: MigrationContext, location: string): void {
    const value = object[key];
    if (value === undefined) {
        return;
    }
    if (!Array.isArray(value)) {
        markAmbiguous(context, location);
        return;
    }
    object[key] = value.map((item, index) => {
        if (typeof item !== "string") {
            markAmbiguous(context, `${location}[${String(index)}]`);
            return item;
        }
        const rewritten = rewriteProjectRelativePath(item, context.scope);
        if (rewritten.ambiguous) {
            markAmbiguous(context, `${location}[${String(index)}]`);
            return item;
        }
        if (rewritten.value !== item) {
            context.stats.rewrittenPaths += 1;
        }
        return rewritten.value;
    });
}

type PathMode = "workspace" | "project";

/** 按 schema owner 指定的 path mode 重写单个 string 字段。 */
function rewriteStringField(
    object: JsonObject,
    key: string,
    mode: PathMode,
    context: MigrationContext,
    location: string,
    optional = false,
    nullable = false,
): void {
    const value = object[key];
    if (value === undefined && optional) {
        return;
    }
    if (value === null && nullable && context.decoderFormat === 2) {
        return;
    }
    if (typeof value !== "string") {
        markAmbiguous(context, location);
        return;
    }
    const rewritten = mode === "workspace"
        ? rewriteWorkspaceAddress(value, context.scope)
        : rewriteProjectRelativePath(value, context.scope);
    if (rewritten.ambiguous) {
        markAmbiguous(context, location);
        return;
    }
    updateStringValue(object, key, rewritten.value, context);
}

/** 将旧 projectPath 字段原子替换为单段 projectRoot；不可表达的 external locator 删除并 review。 */
function migrateProjectLocatorField(object: JsonObject, context: MigrationContext, location: string): void {
    if (object.projectPath === undefined) {
        return;
    }
    if (typeof object.projectPath !== "string") {
        delete object.projectPath;
        markAmbiguous(context, `${location}.projectPath`);
        return;
    }
    const rewritten = rewriteProjectLocator(object.projectPath);
    delete object.projectPath;
    context.stats.rewrittenPaths += 1;
    if (rewritten.value) {
        object.projectRoot = rewritten.value;
    }
    if (rewritten.ambiguous) {
        markAmbiguous(context, `${location}.projectPath`);
    }
}

/** Workspace-address 字段切到 Workspace Root cwd；managed 相对地址补 current slug。 */
function rewriteWorkspaceAddress(value: string, scope: SessionScope): PathRewrite {
    const normalized = normalizeSlashes(value).trim();
    if (!normalized || hasUnsafeRelativeSegment(normalized)) {
        return {value, ambiguous: true};
    }
    if (isAnyAbsolute(normalized)) {
        return {value: normalized, ambiguous: false};
    }
    const rootRelative = stripWorkspacePrefix(normalized);
    if (rootRelative !== null) {
        return {value: rootRelative, ambiguous: !rootRelative};
    }
    if (scope.kind === "managed") {
        if (normalized === scope.projectRoot || normalized.startsWith(`${scope.projectRoot}/`)) {
            return {value: normalized, ambiguous: false};
        }
        return {value: `${scope.projectRoot}/${normalized}`, ambiguous: false};
    }
    if (scope.kind === "user_assets") {
        if (normalized === ".nbook" || normalized.startsWith(".nbook/")) {
            return {value: normalized, ambiguous: false};
        }
        return {value: `.nbook/${normalized}`, ambiguous: false};
    }
    if (scope.kind === "external") {
        return {value: resolveExternalPath(scope.root, normalized), ambiguous: false};
    }
    return {value: normalized, ambiguous: false};
}

/** Project-domain 路径保持 Project-relative；只剥离旧 workspace/current-slug 前缀。 */
function rewriteProjectRelativePath(value: string, scope: SessionScope): PathRewrite {
    const normalized = normalizeSlashes(value).trim();
    if (!normalized || hasUnsafeRelativeSegment(normalized)) {
        return {value, ambiguous: true};
    }
    if (isAnyAbsolute(normalized)) {
        return {value: normalized, ambiguous: false};
    }
    if (scope.kind === "external") {
        if (normalized.startsWith("workspace/")) {
            return {value, ambiguous: true};
        }
        return {value: resolveExternalPath(scope.root, normalized), ambiguous: false};
    }
    if (scope.kind !== "managed") {
        return {value: normalized, ambiguous: false};
    }
    const workspacePrefix = `workspace/${scope.projectRoot}`;
    if (normalized === workspacePrefix) {
        return {value: ".", ambiguous: false};
    }
    if (normalized.startsWith(`${workspacePrefix}/`)) {
        return {value: normalized.slice(workspacePrefix.length + 1), ambiguous: false};
    }
    if (normalized === scope.projectRoot) {
        return {value: ".", ambiguous: false};
    }
    if (normalized.startsWith(`${scope.projectRoot}/`)) {
        return {value: normalized.slice(scope.projectRoot.length + 1), ambiguous: false};
    }
    if (normalized.startsWith("workspace/")) {
        return {value, ambiguous: true};
    }
    return {value: normalized, ambiguous: false};
}

/** 旧 Project locator 只接受 workspace/<slug> 或已经是单段 root。 */
function rewriteProjectLocator(value: string): ProjectLocatorRewrite {
    const normalized = normalizeSlashes(value).trim();
    if (normalized === "workspace/.nbook") {
        return {ambiguous: false};
    }
    if (isAnyAbsolute(normalized)) {
        return {ambiguous: false};
    }
    const root = managedProjectRoot(normalized) ?? (isValidProjectRoot(normalized) ? normalized : undefined);
    return root ? {value: root, ambiguous: false} : {ambiguous: true};
}

/** 把 workspace/ 逻辑容器前缀改为最终 Workspace Root-relative 地址。 */
function stripWorkspacePrefix(value: string): string | null {
    if (value === "workspace") {
        return ".";
    }
    return value.startsWith("workspace/") ? value.slice("workspace/".length) : null;
}

/** external 相对路径按旧 external root 转为平台明确 absolute filesystem path。 */
function resolveExternalPath(root: string, relativePath: string): string {
    if (win32.isAbsolute(root)) {
        return win32.resolve(root, relativePath.replaceAll("/", "\\"));
    }
    return posix.resolve(root, relativePath);
}

/** 同时识别当前平台、Windows 与 POSIX absolute path。 */
function isAnyAbsolute(value: string): boolean {
    return isAbsolute(value) || win32.isAbsolute(value) || posix.isAbsolute(value);
}

/** 解析旧 workspace/<slug> Project Path，并复用最终单段语法约束。 */
function managedProjectRoot(value: string): string | undefined {
    const normalized = normalizeSlashes(value).replace(/\/+$/u, "");
    if (!normalized.startsWith("workspace/")) {
        return undefined;
    }
    const root = normalized.slice("workspace/".length);
    return isValidProjectRoot(root) ? root : undefined;
}

/** 与最终 Project root DTO 保持相同的跨平台保留名/字符约束。 */
function isValidProjectRoot(value: string): boolean {
    return Boolean(value)
        && !value.includes("/")
        && !value.includes("\\")
        && value !== "."
        && value !== ".."
        && value.toLocaleLowerCase("en-US") !== ".nbook"
        && !/[<>:"|?*\u0000-\u001F\u007F]/u.test(value)
        && !/[. ]$/u.test(value)
        && !/^(?:con|prn|aux|nul|com[1-9\u00B9\u00B2\u00B3]|lpt[1-9\u00B9\u00B2\u00B3])(?:\..*)?$/iu.test(value);
}

/** 拒绝会在新 cwd 下改变 containment 语义的 dot-dot 或 NUL segment。 */
function hasUnsafeRelativeSegment(value: string): boolean {
    return value.includes("\u0000") || normalizeSlashes(value).split("/").some((segment) => segment === "..");
}

/** 统一逻辑地址分隔符，并保留 POSIX root、UNC 与 Windows namespace 前缀。 */
function normalizeSlashes(value: string): string {
    const slashes = value.replaceAll("\\", "/");
    const prefix = slashes.startsWith("//") ? "//" : slashes.startsWith("/") ? "/" : "";
    const collapsed = `${prefix}${slashes.slice(prefix.length).replace(/\/{2,}/gu, "/")}`;
    const winRoot = win32.parse(collapsed).root.replaceAll("\\", "/");
    const posixRoot = posix.parse(collapsed).root;
    if (collapsed === winRoot || collapsed === posixRoot) {
        return collapsed;
    }
    return collapsed.replace(/\/+$/u, "");
}

/** 仅在值确实变化时累计字段级 rewrite。 */
function updateStringValue(object: JsonObject, key: string, value: string, context: MigrationContext): void {
    if (object[key] !== value) {
        object[key] = value;
        context.stats.rewrittenPaths += 1;
    }
}

/** 识别需要 Project-relative subjectPath 的内置 subject 工具。 */
function isSubjectTool(name: string): boolean {
    return name === "subject_rag_search"
        || name === "subject_event_append"
        || name === "subject_memory_update"
        || name === "memory_bio";
}

/** Plot/brief 工具里的 chapterPath 是 Project-domain locator，不跟随 cwd 加 slug。 */
function projectRelativeToolFields(name: string): readonly string[] {
    const fields: Record<string, readonly string[]> = {
        create_story_scene: ["chapterPath"],
        get_chapter_plot: ["chapterPath"],
        get_chapter_writer_brief: ["chapterPath"],
        update_story_scene: ["chapterPath"],
    };
    return fields[name] ?? [];
}

/** unknown schema 只看顶层明确 path/root 键，避免扫描自由文本或 JSON Schema properties。 */
function hasTopLevelPathField(value: JsonNode | undefined, ignoredKeys: ReadonlySet<string> = new Set()): boolean {
    const object = objectValue(value);
    return Boolean(object && Object.entries(object).some(([key, field]) => {
        return !ignoredKeys.has(key) && typeof field === "string" && /(?:path|root|workspace)$/iu.test(key);
    }));
}

/** 登记 schema 无法证明的 structured path；历史警告不阻断整个 Session。 */
function markAmbiguous(context: MigrationContext, location: string): void {
    if (context.decoderFormat === 1) {
        context.reviewReasons.add("ambiguous_path");
    }
    context.ambiguousLocations.add(location);
}

/**
 * 在 active branch 追加 migration repair transaction。
 *
 * pending tool call、用户 resolution 与 follow-up 都属于旧 cwd 下尚未执行的意图，
 * 只能显式取消；最后的模型可见 reminder 让下一轮重新检查路径后再行动。
 */
function buildMigrationEntries(entries: JsonObject[], migrationTimestamp: number, context: MigrationContext): JsonObject[] {
    const path = activePath(entries, context.sourcePath);
    const tailTimestamp = path.at(-1)?.timestamp;
    const logicalTimestamp = context.decoderFormat === 2
        && typeof tailTimestamp === "number" && Number.isSafeInteger(tailTimestamp) && tailTimestamp > 0
        ? tailTimestamp
        : migrationTimestamp;
    const pathIds = new Set(path.map((entry) => requiredString(entry.id, "active entry.id")));
    const existingIds = new Set(entries.map((entry) => requiredString(entry.id, "entry.id")));
    const customState = new Map<string, JsonNode>();
    for (const entry of entries) {
        if (entry.type !== "custom") {
            continue;
        }
        const onActivePath = pathIds.has(requiredString(entry.id, "custom.id"));
        const projection = entry.origin === "projection" && projectionApplies(entry.projectionScope, pathIds);
        if (onActivePath || projection) {
            customState.set(requiredString(entry.key, "custom.key"), entry.value ?? null);
        }
    }

    const output: JsonObject[] = [];
    let parentId = activeLeafId(entries, context.sourcePath);
    let sequence = 0;
    const append = (entry: JsonObject): void => {
        let id: string;
        do {
            id = `session-v2-migration-${String(context.sessionId)}-${String(sequence).padStart(4, "0")}`;
            sequence += 1;
        } while (existingIds.has(id));
        existingIds.add(id);
        const stored: JsonObject = {
            ...entry,
            id,
            parentId,
            timestamp: logicalTimestamp,
        };
        output.push(stored);
        parentId = id;
    };

    const calls = activeToolCalls(path, context.sourcePath);
    const completed = new Set(activeToolResults(path, context.sourcePath).map((result) => result.toolCallId));
    for (const call of calls) {
        if (completed.has(call.toolCallId)) {
            continue;
        }
        append({
            type: "message",
            origin: "harness",
            message: {
                role: "toolResult",
                toolCallId: call.toolCallId,
                toolName: call.toolName,
                content: [{
                    type: "text",
                    text: "Cancelled by the Session path-contract migration. The operation was not executed.",
                }],
                details: {
                    status: "cancelled",
                    code: MIGRATION_CANCEL_CODE,
                },
                isError: true,
                timestamp: logicalTimestamp,
            },
        });
        context.stats.cancelledToolCalls += 1;
    }

    for (const [key, value] of [...customState.entries()].sort(([left], [right]) => left.localeCompare(right))) {
        if (!key.startsWith(PENDING_RESOLUTION_PREFIX) || value === null) {
            continue;
        }
        append({
            type: "custom",
            origin: "projection",
            key,
            value: null,
        });
        context.stats.clearedPendingResolutions += 1;
    }

    const followUpQueue = customState.get(FOLLOW_UP_QUEUE_KEY);
    if (followUpQueue !== undefined && !isEmptyFollowUpQueue(followUpQueue)) {
        append({
            type: "custom",
            origin: "projection",
            key: FOLLOW_UP_QUEUE_KEY,
            value: {status: "ready", items: []},
        });
        context.stats.clearedFollowUpQueue = true;
    }

    const lifecycle = [...path].reverse().find((entry) => entry.type === "invocation_lifecycle");
    if (lifecycle && (lifecycle.status === "start" || lifecycle.status === "waiting" || lifecycle.status === "resumed")) {
        append({
            type: "invocation_lifecycle",
            invocationId: requiredString(lifecycle.invocationId, "invocation_lifecycle.invocationId"),
            status: "aborted",
            error: "Session path-contract migration cancelled the active invocation.",
            errorInfo: {
                message: "Session path-contract migration cancelled the active invocation.",
                phase: "unknown",
                retryable: false,
                code: MIGRATION_CANCEL_CODE,
            },
        });
    }

    append({
        type: "custom_message",
        visibleToModel: true,
        message: {
            role: "user",
            content: [{
                type: "text",
                text: [
                    "<system-reminder>",
                    "This session was migrated to the Workspace Root path contract.",
                    "File-tool paths are now resolved from the Workspace Root. Re-check stored paths before continuing.",
                    "</system-reminder>",
                ].join("\n"),
            }],
            timestamp: logicalTimestamp,
        },
    });
    const reminderId = parentId;
    append({
        type: "leaf",
        leafId: reminderId,
        origin: "auto",
    });
    return output;
}

/** 取得最后一个 durable leaf marker 指向的 active entry。 */
function activeLeafId(entries: JsonObject[], sourcePath: string): string | null {
    const leaf = [...entries].reverse().find((entry) => entry.type === "leaf");
    if (!leaf) {
        throw new Error(`${sourcePath}: session 缺少 leaf entry`);
    }
    if (leaf.leafId === null) {
        return null;
    }
    return requiredString(leaf.leafId, `${sourcePath}: leaf.leafId`);
}

/** 按 parentId 从 active leaf 回溯，拒绝缺失 parent 与循环。 */
function activePath(entries: JsonObject[], sourcePath: string): JsonObject[] {
    const byId = new Map<string, JsonObject>();
    for (const entry of entries) {
        const id = requiredString(entry.id, `${sourcePath}: entry.id`);
        if (byId.has(id)) {
            throw new Error(`${sourcePath}: entry id 重复：${id}`);
        }
        byId.set(id, entry);
    }
    const reversed: JsonObject[] = [];
    const visited = new Set<string>();
    let cursor = activeLeafId(entries, sourcePath);
    while (cursor) {
        if (visited.has(cursor)) {
            throw new Error(`${sourcePath}: active branch parentId 形成循环：${cursor}`);
        }
        visited.add(cursor);
        const entry = byId.get(cursor);
        if (!entry) {
            throw new Error(`${sourcePath}: active leaf 指向缺失 entry：${cursor}`);
        }
        if (entry.type === "leaf") {
            throw new Error(`${sourcePath}: leaf.leafId 不能指向另一个 leaf entry`);
        }
        reversed.push(entry);
        if (entry.parentId === null) {
            cursor = null;
        } else {
            cursor = requiredString(entry.parentId, `${sourcePath}: entry.${cursor}.parentId`);
        }
    }
    return reversed.reverse();
}

/** 复用 repository 的 activeLeaf projection 匹配语义。 */
function projectionApplies(value: JsonNode | undefined, activePathIds: ReadonlySet<string>): boolean {
    if (value === undefined) {
        return true;
    }
    const scope = objectValue(value);
    if (!scope || scope.scope !== "activeLeaf") {
        return false;
    }
    if (scope.leafId === null) {
        return activePathIds.size === 0;
    }
    return typeof scope.leafId === "string" && activePathIds.has(scope.leafId);
}

/** 枚举 active branch 的 tool calls，并拒绝重复 call id。 */
function activeToolCalls(path: JsonObject[], sourcePath: string): Array<{toolCallId: string; toolName: string}> {
    const calls: Array<{toolCallId: string; toolName: string}> = [];
    const ids = new Set<string>();
    for (const entry of path) {
        if (entry.type !== "message") {
            continue;
        }
        const message = objectValue(entry.message);
        if (message?.role !== "assistant" || !Array.isArray(message.content)) {
            continue;
        }
        for (const blockValue of message.content) {
            const block = objectValue(blockValue);
            if (block?.type !== "toolCall") {
                continue;
            }
            const toolCallId = requiredString(block.id, `${sourcePath}: assistant toolCall.id`);
            if (ids.has(toolCallId)) {
                throw new Error(`${sourcePath}: active branch tool call id 重复：${toolCallId}`);
            }
            ids.add(toolCallId);
            calls.push({
                toolCallId,
                toolName: requiredString(block.name, `${sourcePath}: assistant toolCall.name`),
            });
        }
    }
    return calls;
}

/** 枚举 active branch 的 tool results，并拒绝重复 result id。 */
function activeToolResults(path: JsonObject[], sourcePath: string): Array<{toolCallId: string; toolName: string}> {
    const results: Array<{toolCallId: string; toolName: string}> = [];
    const ids = new Set<string>();
    for (const entry of path) {
        if (entry.type !== "message") {
            continue;
        }
        const message = objectValue(entry.message);
        if (message?.role !== "toolResult") {
            continue;
        }
        const toolCallId = requiredString(message.toolCallId, `${sourcePath}: toolResult.toolCallId`);
        if (ids.has(toolCallId)) {
            throw new Error(`${sourcePath}: active branch tool result id 重复：${toolCallId}`);
        }
        ids.add(toolCallId);
        results.push({
            toolCallId,
            toolName: requiredString(message.toolName, `${sourcePath}: toolResult.toolName`),
        });
    }
    return results;
}

/** ready + 空 items 是唯一无需新增清空 projection 的 durable queue 形状。 */
function isEmptyFollowUpQueue(value: JsonNode): boolean {
    const queue = objectValue(value);
    return Boolean(queue && queue.status === "ready" && Array.isArray(queue.items) && queue.items.length === 0);
}

/** 写出前验证 v2 header、entry graph、stored message 与 active transcript 完整性。 */
function validateTarget(records: JsonObject[], context: MigrationContext): void {
    const header = singleHeader(records, context.sourcePath);
    const metadata = objectValue(header.metadata);
    if (!metadata || metadata.schemaVersion !== TARGET_SCHEMA_VERSION) {
        throw new Error(`${context.sourcePath}: migration target 缺少 schemaVersion 2`);
    }
    for (const removed of ["workspaceRoot", "workspaceKey", "projectPath"] as const) {
        if (metadata[removed] !== undefined) {
            throw new Error(`${context.sourcePath}: migration target 仍包含 header.metadata.${removed}`);
        }
    }
    if (context.scope.kind === "managed") {
        if (metadata.currentProjectRoot !== context.scope.projectRoot || !isValidProjectRoot(context.scope.projectRoot)) {
            throw new Error(`${context.sourcePath}: migration target currentProjectRoot 无效`);
        }
    } else if (metadata.currentProjectRoot !== undefined) {
        throw new Error(`${context.sourcePath}: Workspace Root session 不得包含 currentProjectRoot`);
    }
    const expectedReasons = orderedReviewReasons(context.reviewReasons);
    const migrationReview = objectValue(metadata.migrationReview);
    if (expectedReasons.length === 0) {
        if (metadata.migrationReview !== undefined) {
            throw new Error(`${context.sourcePath}: 无 review reason 时不得写 migrationReview`);
        }
    } else if (!migrationReview || migrationReview.status !== "required"
        || (context.decoderFormat === 1
            ? !Array.isArray(migrationReview.reasons)
                || JSON.stringify(migrationReview.reasons) !== JSON.stringify(expectedReasons)
            : migrationReview.reason !== "current_project_unresolved"
                || migrationReview.reasons !== undefined)) {
        throw new Error(`${context.sourcePath}: migrationReview 与收集到的 reason 不一致`);
    }

    const entries = records.flatMap((record) => recordEntries(record));
    const ids = new Set<string>();
    for (const entry of entries) {
        const id = requiredString(entry.id, `${context.sourcePath}: target entry.id`);
        if (ids.has(id)) {
            throw new Error(`${context.sourcePath}: migration target entry id 重复：${id}`);
        }
        ids.add(id);
        if (!Number.isSafeInteger(entry.timestamp) || (entry.timestamp as number) <= 0) {
            throw new Error(`${context.sourcePath}: target entry ${id} timestamp 无效`);
        }
        if (entry.parentId !== null && typeof entry.parentId !== "string") {
            throw new Error(`${context.sourcePath}: target entry ${id} parentId 无效`);
        }
        if (entry.type === "message" || entry.type === "custom_message") {
            try {
                parseStoredMessage(entry.message);
            } catch (error) {
                throw new Error(`${context.sourcePath}: target stored message 无效：${errorMessage(error)}`);
            }
        }
        if (entry.type === "custom" && entry.key === FOLLOW_UP_QUEUE_KEY && entry.value !== null) {
            try {
                parseFollowUpQueue(entry.value);
            } catch (error) {
                throw new Error(`${context.sourcePath}: target follow-up queue 无效：${errorMessage(error)}`);
            }
        }
    }
    for (const entry of entries) {
        if (typeof entry.parentId === "string" && !ids.has(entry.parentId)) {
            throw new Error(`${context.sourcePath}: entry ${String(entry.id)} parentId 指向缺失 entry`);
        }
        if (entry.type === "leaf" && entry.leafId !== null
            && (typeof entry.leafId !== "string" || !ids.has(entry.leafId))) {
            throw new Error(`${context.sourcePath}: leaf ${String(entry.id)} 指向缺失 entry`);
        }
    }

    const path = activePath(entries, context.sourcePath);
    const calls = activeToolCalls(path, context.sourcePath);
    const results = activeToolResults(path, context.sourcePath);
    const callsById = new Map(calls.map((call) => [call.toolCallId, call.toolName]));
    const resultsById = new Map(results.map((result) => [result.toolCallId, result.toolName]));
    for (const [toolCallId, toolName] of callsById) {
        const resultName = resultsById.get(toolCallId);
        if (!resultName) {
            throw new Error(`${context.sourcePath}: active branch tool call 未闭合：${toolCallId}`);
        }
        if (resultName !== toolName) {
            throw new Error(`${context.sourcePath}: active branch tool call/result name 不一致：${toolCallId}`);
        }
    }
    const finalRecord = records.at(-1);
    const finalEntries = finalRecord ? recordEntries(finalRecord) : [];
    const finalLeaf = finalEntries.at(-1);
    const reminder = finalEntries.at(-2);
    if (finalLeaf?.type !== "leaf" || reminder?.type !== "custom_message"
        || finalLeaf.leafId !== reminder.id || finalLeaf.parentId !== reminder.id) {
        throw new Error(`${context.sourcePath}: migration target 缺少最终 reminder leaf`);
    }
}

/** migration timestamp 同时进入 entry/message，必须能稳定序列化为合法 durable time。 */
function assertMigrationTimestamp(value: number): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error("migrationTimestamp 必须是正安全整数");
    }
}

/** review reason 去重后按公开合同固定排序。 */
function orderedReviewReasons(reasons: Iterable<SessionMigrationRecordedReviewReason>): SessionMigrationRecordedReviewReason[] {
    const values = new Set(reasons);
    return [...HISTORICAL_REVIEW_REASON_ORDER, ...REVIEW_REASON_ORDER].filter((reason) => values.has(reason));
}

/** 从不可信 JSON 中读取正安全整数。 */
function safePositiveInteger(value: JsonNode | undefined, location: string): number {
    if (!Number.isSafeInteger(value) || (value as number) <= 0) {
        throw new Error(`${location} 必须是正安全整数`);
    }
    return value as number;
}

/** 从不可信 JSON 中读取非空 string，但不改变原始 bytes。 */
function requiredString(value: JsonNode | undefined, location: string): string {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`${location} 必须是非空字符串`);
    }
    return value;
}

/** 把 JsonNode 收窄为普通 object。 */
function objectValue(value: JsonNode | undefined): JsonObject | null {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

/** unknown error 的稳定文本边界。 */
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
