import {readFile} from "node:fs/promises";
import {createError} from "h3";
import type {TSchema} from "typebox";
import type {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import type {AgentCatalogItem, AgentCatalogSnapshot, AgentProfile, AgentProfileIssue, ProfilePrepareContext} from "nbook/server/agent/profiles/types";
import {createProfileVariableAccessor} from "nbook/server/agent/variables/accessor";
import {createVariableRegistryForProfile, createVariableRegistryForSession} from "nbook/server/agent/variables/profile-registry";
import {resolveCompactionOptions} from "nbook/server/agent/harness/compaction";
import {createAssistantTextMessage, createStoredUserMessage} from "nbook/server/agent/messages/message-utils";
import type {StoredAgentMessage} from "nbook/server/agent/messages/stored-types";
import {storedMessageText} from "nbook/server/agent/messages/stored-message-presentation";
import type {JsonValue, Model} from "nbook/server/agent/messages/types";
import type {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import type {NeuroSessionContext, SessionSnapshot} from "nbook/server/agent/session/types";
import {buildAgentDialogueContent, type AgentDialogueContent} from "nbook/server/agent/session/dialogue-content";
import type {VariableRegistry} from "nbook/server/agent/variables/registry";
import type {
    AgentProfileCatalogItemDto,
    AgentProfileDetailDto,
    AgentProfileDetailRequestDto,
    AgentProfileIssueDto,
    AgentProfilePreparePreviewDto,
    AgentProfilePreparePreviewRequestDto,
    AgentProfileSchemaDetailDto,
    AgentProfileVariableGroupDto,
} from "nbook/shared/dto/agent-profile.dto";
import {reportResultSchemaForProfile} from "nbook/server/agent/profiles/report-result-schema";
import {resolveRuntimeProfileSettings} from "nbook/server/agent/profiles/profile-settings";
import {createLayeredProfileHomeFacade, ensureGlobalProfileHome, ensureProfileHome} from "nbook/server/agent/profiles/profile-home";
import type {ProfileTemplateNodeDto} from "nbook/shared/dto/profile-template.dto";
import {buildProfilePromptRoot} from "nbook/server/agent/profiles/profile-dsl-source-parser";
import {requireActiveReadyProject, runReadyProjectOperation} from "nbook/server/workspace-files/project-session";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {projectSqlSchemaSummary} from "nbook/server/agent/tools/project-sql-schema-summary";
import {assembleProfilePromptMessages} from "nbook/server/agent/profiles/prompt-order";
import {mergeProfileTurnContextMessages, previewProfileTurnContexts} from "nbook/server/agent/profiles/profile-turn-context";
import {resolveProfileRuntimeSettings} from "nbook/server/agent/profiles/profile-runtime-settings";
import type {ProfileRuntimeSettings} from "nbook/shared/agent/profile-runtime-settings";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {RuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import {resolvePiModelFromConfig} from "nbook/server/agent/harness/model-resolver";
import {resolveAgentVisibleModels} from "nbook/server/agent/harness/agent-visible-models";
import {isAgentSessionNotFoundError} from "nbook/server/agent/session/session-not-found-error";

/**
 * 列出 v3 Agent Profile catalog，并适配旧 profile 工作台 DTO。
 */
export async function listAgentProfileCatalog(profiles: AgentProfileCatalog): Promise<AgentProfileCatalogItemDto[]> {
    const snapshot = await profiles.snapshot({includeFileIssues: false});
    const loadedItems = snapshot.profiles.map((profile) => toCatalogItem(profiles, snapshot, profile));
    return loadedItems.sort((left, right) => {
        const sourceCompare = left.source.localeCompare(right.source);
        return sourceCompare || left.profileKey.localeCompare(right.profileKey);
    });
}

/**
 * 读取单个 v3 Agent Profile 的源码和 schema 摘要。
 */
export async function readAgentProfileDetail(
    profiles: AgentProfileCatalog,
    request: AgentProfileDetailRequestDto,
): Promise<AgentProfileDetailDto> {
    const snapshot = await profiles.snapshot();
    const catalog = await listAgentProfileCatalog(profiles);
    const catalogItem = resolveCatalogItem(catalog, request);
    const profile = snapshot.profiles.find((item) => item.key === catalogItem.profileKey);
    const source = profile?.sourcePath ? await readFile(profile.sourcePath, "utf-8") : "";
    const runtimeProfile = catalogItem.loadStatus === "loaded" ? await profiles.get(catalogItem.profileKey) : null;

    return {
        catalogItem,
        manifest: profile
            ? {
                key: profile.key,
                kind: "agent",
                name: profile.name,
                description: profile.description ?? null,
            }
            : null,
        fileName: catalogItem.fileName,
        source,
        issues: catalogItem.issues,
        variables: buildProfileVariableGroups(profile),
        toolKeys: runtimeProfile ? [...runtimeProfile.rootToolKeys] : [],
        initialSchema: buildSchemaDetail({
            schema: profile?.initialSchema ?? null,
            locked: catalogItem.schemaLocked,
            sourceAvailable: Boolean(source),
            label: "InitialSchema",
        }),
        payloadSchema: buildSchemaDetail({
            schema: profile?.payloadSchema ?? null,
            locked: catalogItem.schemaLocked,
            sourceAvailable: Boolean(source),
            label: "PayloadSchema",
        }),
        outputSchema: buildSchemaDetail({
            schema: profile?.outputSchema ?? null,
            locked: catalogItem.schemaLocked,
            sourceAvailable: Boolean(source),
            label: "OutputSchema",
        }),
        reportResultSchema: runtimeProfile && runtimeProfile.rootToolKeys.includes("report_result")
            ? cloneJsonObject(reportResultSchemaForProfile(runtimeProfile))
            : null,
        root: buildSystemPromptRoot(source),
    };
}

/**
 * 调用真实 profile.prepare，给 TSX Profile 工作台生成消息预览。
 */
export async function previewAgentProfilePrepare(
    harness: NeuroAgentHarness,
    request: AgentProfilePreparePreviewRequestDto,
): Promise<AgentProfilePreparePreviewDto> {
    const previewSnapshot = request.sessionId ? await harness.repo.readSession(Number(request.sessionId)) : null;
    const sessionContext = previewSnapshot ? harness.repo.reduce(previewSnapshot) : buildPreviewSession(request);
    const workspaceRoot = absoluteFsPath(harness.repo.rootWorkspace);
    const readyProject = sessionContext.currentProjectRoot
        ? requireActiveReadyProject(projectWorkspaceRef(sessionContext.currentProjectRoot))
        : null;
    const profiles = readyProject ? harness.profiles.forProjectWorkspace(readyProject.workspace) : harness.profiles;
    const profile = await profiles.get(request.profileKey);
    const initial = profiles.parseInitial(profile, buildPreviewInitial(request));
    const session = createProfilePreviewSessionFacade(harness, request.profileKey, initial, previewSnapshot, sessionContext, workspaceRoot, readyProject);
    const catalog = await profiles.snapshot();
    const skills = await harness.skills.list(readyProject?.workspace.root);
    const needsHome = profileNeedsHome(profile);
    const prepare = async (): Promise<AgentProfilePreparePreviewDto> => {
        const projectWorkspace = readyProject?.workspace;
        const effectiveConfig = await loadPreviewEffectiveConfig(workspaceRoot, readyProject);
        const globalHome = needsHome
            ? await ensureGlobalProfileHome({
                workspaceRoot,
                profileKey: profile.manifest.key,
                profileVersion: profile.manifest.version ?? 1,
                definition: profile.home,
            })
            : undefined;
        const projectHome = projectWorkspace && needsHome
            ? await ensureProfileHome({
                workspace: projectWorkspace,
                profileKey: profile.manifest.key,
                profileVersion: profile.manifest.version ?? 1,
                definition: profile.home,
            })
            : undefined;
        const home = projectHome ? createLayeredProfileHomeFacade(projectHome, globalHome) : globalHome;
        const customSettings = await resolveRuntimeProfileSettings(
            profile,
            effectiveConfig.agent.profiles[request.profileKey]?.settings,
            projectWorkspace
                ? {
                    profileKey: request.profileKey,
                    scope: "project",
                    projectWorkspace,
                    ...(home ? {home, allowGlobalResourceKeys: true} : {}),
                }
                : {
                    profileKey: request.profileKey,
                    scope: "global",
                    ...(home ? {home, allowGlobalResourceKeys: true} : {}),
                },
        );
        const runtimeSettings = resolveProfileRuntimeSettings(
            profile.runtimeDefaults,
            effectiveConfig.agent.profiles[request.profileKey]?.runtime ?? effectiveConfig.agent.profileRuntimeDefaults,
        );

        try {
            const prepared = await profile.prepare!({
                session,
                initial,
                settings: customSettings as never,
                ...(home ? {home} : {}),
                vars: createProfileVariableAccessor({
                    repo: harness.repo,
                    snapshot: previewSnapshot ?? previewSessionSnapshot(request.profileKey, sessionContext),
                    registry: await createPreviewVariableRegistry(profile, absoluteFsPath(harness.repo.rootWorkspace), harness.runtimePaths ?? (() => { throw new Error("Profile preview 需要显式 RuntimePaths 才能加载 variable definitions。"); })(), readyProject),
                    dryRun: true,
                }),
                catalog,
                skills,
                workflows: await harness.workflows.list(projectWorkspace),
                agentVisibleModels: resolveAgentVisibleModels(effectiveConfig),
                runtime: {
                    now: new Date().toISOString(),
                    promptUserTurnCount: sessionContext.messages.filter((message) => message.role === "user").length,
                    currentProject: readyProject,
                    sqlSchemaSummary: () => projectSqlSchemaSummary(readyProject),
                },
            });
            const historyMessages = prepared.historyInitMessages ?? [];
            const modelContextAppendingMessages = prepared.modelContextAppendingMessages ?? [];
            const explicitAppendingMessages = mergeProfileTurnContextMessages(
                prepared.appendingMessages ?? [],
                previewProfileTurnContexts(prepared.turnContexts ?? [], runtimeSettings.fileChangeNotice.diffMaxChars),
            );
            const appendingMessages = [
                ...modelContextAppendingMessages,
                ...explicitAppendingMessages,
            ];
            const modelContextMessages = prepared.modelContextMessages ?? [];
            const historyMessagesForReact = sessionContext.messages.length === 0 ? historyMessages : [];
            const finalMessages = assembleProfilePromptMessages({
                history: [...sessionContext.messages, ...historyMessagesForReact],
                modelContext: modelContextMessages,
                appending: appendingMessages,
                currentUserInput: [],
            });
            const messages = [
                ...prepared.systemPrompt ? [systemPromptPreviewMessage(prepared.systemPrompt)] : [],
                ...historyMessages.map((message) => toPreviewMessage(message, "history")),
                ...modelContextMessages.map((message) => toPreviewMessage(message, "modelContext")),
                ...modelContextAppendingMessages.map((message) => toPreviewMessage(message, "modelContextAppending")),
                ...explicitAppendingMessages.map((message) => toPreviewMessage(message, "appending")),
                compactionPreviewMessage(runtimeSettings.compaction, resolvePreviewModel(effectiveConfig, sessionContext)),
                ...finalMessages.map((message) => toPreviewMessage(message, "reactMessages")),
                ...(prepared.stateWrites ?? []).map((write) => ({
                    role: "custom",
                    text: JSON.stringify(write, null, 2),
                    source: "stateWrites",
                })),
            ];

            return {
                profileKey: request.profileKey,
                ok: true,
                issues: [],
                messages,
                persistedMessageCount: historyMessages.length + appendingMessages.length,
                variables: buildProfileVariableGroups(catalog.profiles.find((item) => item.key === request.profileKey), profile),
                reportResultSchema: profile.rootToolKeys.includes("report_result")
                    ? cloneJsonObject(reportResultSchemaForProfile(profile))
                    : null,
            };
        } catch (error) {
            if (isAgentSessionNotFoundError(error)) {
                throw error;
            }
            return {
                profileKey: request.profileKey,
                ok: false,
                issues: [{
                    severity: "error",
                    message: error instanceof Error ? error.message : String(error),
                    code: "prepare_failed",
                    profileKey: request.profileKey,
                }],
                messages: [],
                persistedMessageCount: 0,
                variables: buildProfileVariableGroups(catalog.profiles.find((item) => item.key === request.profileKey), profile),
                reportResultSchema: profile.rootToolKeys.includes("report_result")
                    ? cloneJsonObject(reportResultSchemaForProfile(profile))
                    : null,
            };
        }
    };
    return readyProject
        ? runReadyProjectOperation(readyProject, async () => prepare())
        : prepare();
}

function profileNeedsHome(profile: AgentProfile): boolean {
    return Boolean(profile.home) || Boolean(profile.settingsForm?.fields.some((field) => field.component === "resource-preset"));
}

/**
 * 将 v3 catalog item 映射为前端工作台 catalog DTO。
 */
function toCatalogItem(profiles: AgentProfileCatalog, snapshot: AgentCatalogSnapshot, profile: AgentCatalogItem): AgentProfileCatalogItemDto {
    const fileName = profile.sourcePath ? profiles.sourceFileName(profile.sourcePath, profile.source) : null;
    const issues = snapshot.issues
        .filter((issue) => issue.profileKey === profile.key || issue.sourcePath === profile.sourcePath)
        .map((issue) => toProfileIssueDto(issue, profile.key, fileName));

    return {
        profileKey: profile.key,
        kind: "agent",
        name: profile.name,
        description: profile.description ?? null,
        fileName,
        source: profile.source,
        overrideState: resolveOverrideState(profile),
        loadStatus: profile.loadStatus,
        schemaLocked: profile.builtin,
        canEdit: profile.source === "project" && Boolean(fileName),
        canRestore: false,
        creationMode: profile.creationMode,
        issues,
    };
}

/**
 * 根据 profileKey 或 fileName 定位 catalog 项。
 */
function resolveCatalogItem(catalog: AgentProfileCatalogItemDto[], request: AgentProfileDetailRequestDto): AgentProfileCatalogItemDto {
    const item = request.profileKey
        ? catalog.find((profile) => profile.profileKey === request.profileKey)
        : catalog.find((profile) => profile.fileName === request.fileName);
    if (!item) {
        throw createError({
            statusCode: 404,
            message: `未找到 agent profile: ${request.profileKey ?? request.fileName}`,
        });
    }
    return item;
}

/**
 * 生成 profile schema 详情。v3 第一版只读展示，不重接低代码 schema 改写。
 */
function buildSchemaDetail(input: {
    schema: TSchema | null;
    locked: boolean;
    sourceAvailable: boolean;
    label: "InitialSchema" | "PayloadSchema" | "OutputSchema";
}): AgentProfileSchemaDetailDto {
    if (input.locked) {
        return {
            jsonSchema: cloneJsonObject(input.schema),
            editMode: "locked",
            reason: "builtin profile 的 Initial/Payload/Output schema 由静态 contract 锁定。",
            sourceRange: null,
        };
    }
    return {
        jsonSchema: cloneJsonObject(input.schema),
        editMode: input.sourceAvailable ? "source" : "unavailable",
        reason: input.sourceAvailable
            ? `${input.label} 需要在 TSX 源码中编辑；Schema Builder 会在新 profile 工作台中重接。`
            : `当前 profile 没有可读取源码，无法编辑 ${input.label}。`,
        sourceRange: null,
    };
}

/**
 * 构造预览用 session context。传 sessionId 时复用真实 session，否则用请求中的临时历史。
 */
function buildPreviewSession(request: AgentProfilePreparePreviewRequestDto): NeuroSessionContext {
    return {
        systemPrompt: "",
        messages: (request.historyMessages ?? []).map(toPreviewHistoryMessage),
        model: null,
        thinkingLevel: "off",
        profileKey: request.profileKey,
        customState: {},
        linkedAgents: [],
        archived: false,
        agentMode: "normal",
    };
}

function createProfilePreviewSessionFacade(
    harness: NeuroAgentHarness,
    profileKey: string,
    initial: JsonValue,
    snapshot: SessionSnapshot | null,
    context: NeuroSessionContext,
    workspaceRoot: AbsoluteFsPath,
    currentProject: ReadyProjectSessionRef | null,
): ProfilePrepareContext["session"] {
    const facade: ProfilePrepareContext["session"] = {
        ...context,
        workspaceRoot,
        currentProject,
        read: async (sessionId) => {
            if (typeof sessionId === "number" && sessionId > 0) {
                const realSnapshot = await harness.repo.readSession(sessionId);
                return {
                    snapshot: realSnapshot,
                    context: harness.repo.reduce(realSnapshot),
                };
            }
            return {
                snapshot: snapshot ?? previewSessionSnapshot(profileKey, context),
                context,
            };
        },
        agentDialogueContent: async (contentInput = {}): Promise<AgentDialogueContent> => {
            const sourceSnapshot = typeof contentInput.sessionId === "number" && contentInput.sessionId > 0
                ? await harness.repo.readSession(contentInput.sessionId)
                : snapshot ?? previewSessionSnapshot(profileKey, context);
            return buildAgentDialogueContent({
                repo: harness.repo,
                snapshot: sourceSnapshot,
                summarizerProfileKey: contentInput.profileKey ?? profileKey,
                summarizerInput: contentInput.initial ?? initial,
            });
        },
    };
    return facade;
}

/**
 * 请求 initial 优先，其次用 initialOverrides 的自由文本字段构造 JSON 对象。
 */
function buildPreviewInitial(request: AgentProfilePreparePreviewRequestDto): JsonValue {
    if (request.initial !== undefined) {
        return request.initial as JsonValue;
    }
    return JSON.parse(JSON.stringify(request.initialOverrides ?? {})) as JsonValue;
}

/**
 * 将工作台临时历史转换为 v3 message。v3 不允许 SystemMessage，因此 system 作为 user 文本预览。
 */
function toPreviewHistoryMessage(input: {role: "system" | "human" | "assistant"; text: string}): StoredAgentMessage {
    if (input.role === "assistant") {
        return createAssistantTextMessage({text: input.text});
    }
    return createStoredUserMessage(input.role === "system" ? `[system preview]\n${input.text}` : input.text);
}

/**
 * 将 v3 Message 映射到 profile 工作台预览消息。
 */
function toPreviewMessage(message: StoredAgentMessage, source: string): AgentProfilePreparePreviewDto["messages"][number] {
    if (message.role === "assistant") {
        return {
            role: message.role,
            text: storedMessageText(message),
            source,
            toolCalls: message.content
                .filter((block) => block.type === "toolCall")
                .map((block) => ({
                    id: block.id,
                    name: block.name,
                    argsText: JSON.stringify(block.arguments ?? {}, null, 2),
                })),
        };
    }
    return {
        role: message.role,
        text: storedMessageText(message),
        source,
    };
}

/**
 * systemPrompt 在 v3 中是独立字段，预览时作为只读 system-prompt 卡片展示。
 */
function systemPromptPreviewMessage(systemPrompt: string): AgentProfilePreparePreviewDto["messages"][number] {
    return {
        role: "systemPrompt",
        text: systemPrompt,
        source: "systemPrompt",
    };
}

/**
 * Compaction policy 在工作台预览中作为独立配置卡片展示。
 */
function compactionPreviewMessage(compaction: ProfileRuntimeSettings["compaction"], model: Model<any> | null): AgentProfilePreparePreviewDto["messages"][number] {
    const options = resolveCompactionOptions(compaction, model ?? PREVIEW_COMPACTION_MODEL);
    return {
        role: "compaction",
        text: JSON.stringify({
            enabled: options.enabled,
            triggerPercent: options.triggerPercent ?? null,
            triggerTokens: options.triggerTokens ?? null,
            reserveTokens: options.reserveTokens,
            keepRecentTokens: options.keepRecentTokens,
            promptSource: options.promptSource,
            summaryPrefixSource: options.summaryPrefixSource,
        }, null, 2),
        source: "compaction",
    };
}

const PREVIEW_COMPACTION_MODEL = {
    id: "preview",
    name: "Preview",
    api: "openai-completions",
    provider: "custom",
    baseUrl: "",
    reasoning: false,
    input: ["text"],
    cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
    },
    contextWindow: 128_000,
    maxTokens: 8_000,
} satisfies Model<any>;

/**
 * 工作台变量面板先展示 profile schema 摘要。
 */
function buildProfileVariableGroups(profile: AgentCatalogItem | undefined, runtimeProfile?: AgentProfile): AgentProfileVariableGroupDto[] {
    if (!profile) {
        return [];
    }
    const groups: AgentProfileVariableGroupDto[] = [{
        group: "Profile Schema",
        items: [
            {
                label: "InitialSchema",
                value: "initialSchema",
                path: "initialSchema",
                editable: false,
                valueType: "jsonSchema",
                source: "profile",
                schema: cloneJsonObject(profile.initialSchema),
            },
            {
                label: "PayloadSchema",
                value: "payloadSchema",
                path: "payloadSchema",
                editable: false,
                valueType: "jsonSchema",
                source: "profile",
                schema: cloneJsonObject(profile.payloadSchema),
            },
            {
                label: "OutputSchema",
                value: "outputSchema",
                path: "outputSchema",
                editable: false,
                valueType: "jsonSchema",
                source: "profile",
                schema: cloneJsonObject(profile.outputSchema),
            },
        ],
    }];
    if (runtimeProfile) {
        const catalog = createVariableRegistryForProfile(runtimeProfile).catalog();
        const variableGroups = [
            {namespace: "client", variables: catalog.clientVariables},
            {namespace: "global", variables: catalog.globalVariables},
            {namespace: "project", variables: catalog.projectVariables},
            {namespace: "session", variables: catalog.sessionVariables},
        ] as const;
        groups.push({
            group: "Variable Registry",
            items: variableGroups.flatMap(({namespace, variables}) => Object.entries(variables).map(([key, item]) => {
                const fullPath = `${namespace}.${key}`;
                return {
                    label: fullPath,
                    value: key,
                    path: fullPath,
                    editable: false,
                    valueType: "jsonSchema",
                    source: "runtime",
                    schema: cloneJsonObject(item),
                };
            })),
        });
    }
    return groups;
}

async function createPreviewVariableRegistry(
    profile: AgentProfile,
    globalWorkspaceRoot: AbsoluteFsPath,
    runtimePaths: RuntimePaths,
    currentProject: ReadyProjectSessionRef | null,
): Promise<VariableRegistry> {
    return createVariableRegistryForSession({
        profile,
        globalWorkspaceRoot,
        currentProject,
        runtimePaths,
        globalDefinitionRootLabel: "workspace/.nbook/agent/variables",
        projectDefinitionRootLabel: currentProject
            ? `workspace/${currentProject.workspace.ref.projectRoot}/.nbook/agent/variables`
            : undefined,
    });
}

/** Profile Preview也从当前Config按durable selection重新解析完整模型。 */
function resolvePreviewModel(
    config: Awaited<ReturnType<typeof loadPreviewEffectiveConfig>>,
    context: NeuroSessionContext,
): Model<any> | null {
    try {
        return resolvePiModelFromConfig(config, context.profileKey, context.model
            ? {modelKey: `${context.model.providerConfigId}/${context.model.modelId}`}
            : undefined);
    } catch {
        return null;
    }
}

function previewSessionSnapshot(profileKey: string, session: NeuroSessionContext): SessionSnapshot {
    return {
        metadata: {
            schemaVersion: 2,
            sessionId: -1,
            profileKey,
            initial: {},
            currentProjectRoot: session.currentProjectRoot,
            createdAt: Date.now(),
        },
        entries: [],
        leafId: null,
    };
}

/**
 * 工作台 prepare 预览应尽量复用真实运行的 profile settings。
 */
async function loadPreviewEffectiveConfig(
    workspaceRoot: AbsoluteFsPath,
    project: ReadyProjectSessionRef | null,
) {
    const {loadEffectiveConfigFromTarget} = await import("nbook/server/config/config-service");
    return project
        ? loadEffectiveConfigFromTarget({scope: "project", workspaceRoot, project})
        : loadEffectiveConfigFromTarget({scope: "global", workspaceRoot, project: null});
}

function cloneJsonObject(value: unknown): Record<string, JsonValue> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

/**
 * 解析 profile 覆盖状态。
 */
function resolveOverrideState(profile: AgentCatalogItem): AgentProfileCatalogItemDto["overrideState"] {
    switch (profile.source) {
        case "memory": return "contract_only";
        case "project": return "project_only";
        case "install": return "install_only";
    }
}

/**
 * 统一 issue DTO。
 */
function toProfileIssueDto(issue: AgentProfileIssue, profileKey: string, fileName: string | null): AgentProfileIssueDto {
    return {
        severity: issue.code === "filename_mismatch" || issue.code === "builtin_schema_locked" || issue.code === "system_profile_shadowed" || issue.code === "source_stale" || issue.code === "dependency_stale" || issue.code === "not_compiled" || issue.code === "compile_stale" ? "warning" : "error",
        message: issue.message,
        code: issue.code,
        profileKey: issue.profileKey ?? profileKey,
        fileName: fileName ?? undefined,
    };
}

/**
 * 为旧三栏 UI 提供一个源码优先的 ProfilePrompt 可视化树。
 */
function parseProfilePromptTree(source: string, fileName: string | null): ProfileTemplateNodeDto | null {
    if (!fileName || !/\.(tsx|ts|jsx|js)$/.test(fileName)) {
        return null;
    }
    try {
        return buildProfilePromptRoot(source);
    } catch {
        return null;
    }
}
export function buildSystemPromptRoot(source: string): ProfileTemplateNodeDto | null {
    return buildProfilePromptRoot(source);
}
