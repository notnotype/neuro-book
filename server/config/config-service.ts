import {readFileSync} from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {createError} from "h3";
import {useAgentHarness} from "nbook/server/agent/http";
import type {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import type {AgentCatalogItem, AgentProfileIssue} from "nbook/server/agent/profiles/types";
import {resolveProfileSettings} from "nbook/server/agent/profiles/profile-settings";
import {mergeProfileRuntimePatches, resolveProfileRuntimeSettings} from "nbook/server/agent/profiles/profile-runtime-settings";
import {
    USER_ASSETS_WORKSPACE_KIND,
    USER_ASSETS_WORKSPACE_ROOT,
    WORKSPACE_CONTAINER_ROOT,
    type WorkspaceRootKind,
} from "nbook/server/workspace-files/novel-workspace";
import {assertProjectWorkspaceDirectory, listProjectWorkspaces} from "nbook/server/workspace-files/project-workspace";
import {normalizeProjectPath, resolveProjectWorkspaceRoot} from "nbook/server/workspace-files/project-path";
import {GlobalConfigDtoSchema} from "nbook/shared/dto/config.dto";
import type {
    ConfigAgentProfileSettingsDto,
    ConfigAgentProfileBuildStatusDto,
    ConfigBootstrapDto,
    ConfigDefaultProfileSettingsDto,
    ConfigEditorSnapshotDto,
    ConfigEmbeddingSettingsDto,
    ConfigModelSettingsDto,
    ConfigSnapshotDto,
    ConfigWorkspaceQueryDto,
    GlobalConfigDto,
    GlobalConfigUpdateDto,
    ProjectConfigDto,
} from "nbook/shared/dto/config.dto";
import {resolveStateWorkspaceRoot} from "nbook/server/runtime/installation-paths";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {CONFIG_REGISTRY, CONFIG_VERSION} from "nbook/server/config/registry";
import {
    normalizeAgentProfileModelConfig,
    normalizeAgentProfileSettings,
    normalizeEmbeddingModelConfig,
    normalizeEmbeddingService,
    normalizeGlobalConfig,
    normalizeProjectConfig,
    resolveEffectiveConfig,
} from "nbook/server/config/normalizer";
import type {
    ConfigTarget,
    ConfiguredModelConfig,
    EmbeddingServiceConfig,
    EffectiveConfig,
    ModelProviderOptionsConfig,
    StoredGlobalConfig,
    StoredProjectConfig,
    StoredProviderConfig,
} from "nbook/server/config/types";
import {
    applyLowCodeResourceMutations,
    resolveLowCodeForm,
    validateLowCodeResourceMutations,
    validateLowCodeFormValue,
    type LowCodeFormDefinition,
    type LowCodeFormResolveContext,
    type LowCodeResourceMutationKeyView,
} from "nbook/server/low-code-form";
import type {LowCodeJsonObject, LowCodeJsonValue, LowCodeResourceMutationDto} from "nbook/shared/dto/low-code-form.dto";
import {ensureGlobalProfileHome, ensureProfileHome, resetProfileHome, resolveProjectRootForProfileHome, type ProfileHomeDefinition} from "nbook/server/agent/profiles/profile-home";
import {
    buildModelLabel,
} from "nbook/server/utils/model-settings";
import {
    inspectModelReferences,
    inspectModelSettings,
    inspectProviderConfigDocument,
    type ModelReferenceInput,
    type ModelSettingsContractInput,
} from "nbook/shared/models/provider-config-contract";
import {assertProjectOpen, markProjectActivity} from "nbook/server/workspace-files/project-session";
import {resolveUserNbookRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {sameProviderConnection} from "nbook/shared/models/provider-connection-identity";

/** Global Config 路径跟随当前 State Root。 */
function globalConfigPath(): string {
    return path.join(resolveUserNbookRoot(), "config.json");
}

type ConfigAgentProfileSettingsOptions = {
    agentProfileSettingsScope?: "global" | "project";
};

/**
 * 读取业务运行使用的最新配置快照。
 */
export async function readConfigSnapshot(query: ConfigWorkspaceQueryDto): Promise<ConfigSnapshotDto> {
    const {global, project} = await readConfigFiles(query);
    const effective = resolveEffectiveConfig(global, project);
    return {
        version: CONFIG_VERSION,
        effective: effective as unknown as Record<string, never>,
        meta: CONFIG_REGISTRY,
    };
}

/**
 * 读取设置页使用的编辑快照，包含 raw global/project 与衍生面板数据。
 */
export async function readConfigEditorSnapshot(query: ConfigWorkspaceQueryDto): Promise<ConfigEditorSnapshotDto> {
    const target = await resolveConfigTarget(query);
    const {global, project} = await readConfigFiles(query, target);
    const effective = resolveEffectiveConfig(global, project);

    return {
        version: CONFIG_VERSION,
        workspaceKind: target.workspaceKind,
        global: redactGlobalConfig(global),
        project: project as ProjectConfigDto | null,
        effective: effective as unknown as Record<string, never>,
        meta: CONFIG_REGISTRY,
        modelSettings: buildConfigModelSettingsDto(global, project, target.workspaceKind),
        embeddingSettings: buildConfigEmbeddingSettingsDto(global, project, effective),
        defaultProfileSettings: buildDefaultProfileSettingsDto({
            workspaceKind: target.workspaceKind,
            projectConfigAvailable: Boolean(target.projectConfigPath),
            global,
            project,
        }),
    };
}

/**
 * 读取 Agent Profile settings 专用快照。只有此入口会解析 lowcode form 结构和值。
 */
export async function readConfigAgentProfileSettings(
    query: ConfigWorkspaceQueryDto,
    profiles: AgentProfileCatalog = useAgentHarness().profiles,
    options: ConfigAgentProfileSettingsOptions = {},
): Promise<ConfigAgentProfileSettingsDto> {
    const target = await resolveConfigTarget(query);
    const settingsScope = options.agentProfileSettingsScope ?? (target.workspaceKind === "novel" ? "project" : "global");
    if (settingsScope === "project") {
        assertProjectConfigDataPlaneOpen(target, query);
    }
    const {global, project} = await readConfigFiles(query, target);
    const effective = resolveEffectiveConfig(global, project);
    const catalog = await profiles.snapshot();
    return buildConfigAgentProfileSettingsDto({
        effective,
        global,
        project,
        profiles,
        catalogProfiles: catalog.profiles,
        query,
        includeSettings: true,
        settingsScope,
    });
}

/**
 * 读取 Agent Profile 构建状态。Phase 2 前暂由 catalog 静态状态投影，Coordinator 接入后填充 running/queued。
 */
export async function readConfigAgentProfileBuildStatus(
    profiles: AgentProfileCatalog = useAgentHarness().profiles,
): Promise<ConfigAgentProfileBuildStatusDto> {
    const catalog = await profiles.snapshot({includeFileIssues: false});
    return {
        profiles: catalog.profiles.map((profile) => ({
            profileKey: profile.key,
            name: profile.name,
            loadStatus: profile.loadStatus,
            issue: toConfigProfileIssue(profile.issue),
            buildState: profiles.buildStateFor(profile.key),
        })),
    };
}

/**
 * 读取首页启动所需的轻量配置。
 */
export async function readConfigBootstrap(
    query: ConfigWorkspaceQueryDto,
): Promise<ConfigBootstrapDto> {
    const target = await resolveConfigTarget(query);
    const {global, project} = await readConfigFiles(query, target);
    const effective = resolveEffectiveConfig(global, project);

    return {
        modelSettings: {
            defaultModelLabel: buildConfigModelSettingsDto(global, project, target.workspaceKind).defaultModelLabel,
            enabledModels: listRawEnabledModels(global),
        },
        defaultProfileSettings: {
            effectiveProfileKey: resolveDefaultProfileKeyFromConfig(target.workspaceKind, global, project),
        },
        ui: {
            theme: effective.ui.theme,
            customThemes: effective.ui.customThemes,
            costCurrency: effective.ui.costCurrency,
        },
    };
}

/**
 * 保存 Global Config。secret value 缺失时保留原值。
 */
export async function saveGlobalConfig(
    input: GlobalConfigUpdateDto,
    query: ConfigWorkspaceQueryDto,
    profiles: AgentProfileCatalog = useAgentHarness().profiles,
): Promise<ConfigEditorSnapshotDto> {
    const current = await readGlobalConfigFile();
    if (input.models !== undefined) {
        assertProviderConnectionsStable(input.models.providers, current);
    }
    const next = normalizeGlobalConfig({
        ...current,
        ...(input.agent !== undefined ? {agent: input.agent} : {}),
        ...(input.ui !== undefined ? {ui: input.ui} : {}),
        ...(input.editor !== undefined ? {editor: input.editor} : {}),
        ...(input.observability !== undefined ? {observability: input.observability} : {}),
        ...(input.history !== undefined ? {history: input.history} : {}),
        ...(input.comfyui !== undefined ? {comfyui: input.comfyui} : {}),
        ...(input.web !== undefined ? {web: normalizeGlobalWebForWrite(input.web, current)} : {}),
        ...(input.models !== undefined ? {models: normalizeGlobalModelsForWrite(input.models, current)} : {}),
        ...(input.embedding !== undefined ? {embedding: normalizeGlobalEmbeddingForWrite(input.embedding, current)} : {}),
    });
    if (input.models !== undefined) {
        assertGlobalProviderConfig(input.models, next);
    } else if (input.agent !== undefined) {
        assertReferencesRunnable(current.models, globalModelReferences(next));
    }
    await assertProfileSettingsInput(input.agent?.profiles, query, profiles, undefined, {
        includeResourceMutationFinalKeys: true,
    }, "global");
    await applyProfileResourceMutations(input.agent?.profiles, query, profiles, undefined, "global");
    await writeJsonFile(globalConfigPath(), next);
    return readConfigEditorSnapshot(query);
}

/**
 * 保存 Project Config。包含 global-only 字段时直接拒绝。
 */
export async function saveProjectConfig(
    input: ProjectConfigDto,
    query: ConfigWorkspaceQueryDto,
    profiles: AgentProfileCatalog = useAgentHarness().profiles,
): Promise<ConfigEditorSnapshotDto> {
    const target = await resolveConfigTarget(query);
    if (!target.projectConfigPath) {
        throw createError({
            statusCode: 400,
            message: "user-assets 入口没有独立 Project Config",
        });
    }
    assertProjectConfigDataPlaneOpen(target, query);
    assertProjectConfigDoesNotContainGlobalOnly(input);
    const [global, current] = await Promise.all([
        readGlobalConfigFile(),
        readProjectConfigFile(target.projectConfigPath),
    ]);
    const next = mergeProjectConfig(current, stripProfileResourceMutations(input) as StoredProjectConfig);
    if (projectModelReferencesChanged(input)) {
        assertProjectModelReferences(global, next);
    }
    await assertProfileSettingsInput(input.agent?.profiles, query, profiles, global.agent?.profiles, {
        includeResourceMutationFinalKeys: true,
    }, "project");
    await applyProfileResourceMutations(input.agent?.profiles, query, profiles, global.agent?.profiles);
    await writeJsonFile(target.projectConfigPath, next);
    return readConfigEditorSnapshot(query);
}

/**
 * 重置指定 Project Workspace 下的 profile home，并返回刷新后的完整 Agent Profile settings snapshot。
 */
export async function resetProjectProfileHome(
    input: {profileKey: string},
    query: ConfigWorkspaceQueryDto,
    profiles: AgentProfileCatalog = useAgentHarness().profiles,
): Promise<ConfigEditorSnapshotDto> {
    const target = await resolveConfigTarget(query);
    if (!target.projectConfigPath || target.workspaceKind !== "novel") {
        throw createError({statusCode: 400, message: "只有 Project Config 支持重置 profile home。"});
    }
    assertProjectConfigDataPlaneOpen(target, query);
    const projectRoot = resolveProjectRootForProfileHome(
        absoluteFsPath(resolveStateWorkspaceRoot()),
        query.projectPath,
    );
    if (!projectRoot) {
        throw createError({statusCode: 400, message: "重置 profile home 需要 Project Workspace。"});
    }
    const profile = await profiles.get(input.profileKey).catch(() => null);
    if (!profile) {
        throw createError({statusCode: 404, message: `profile ${input.profileKey} 不存在。`});
    }
    if (!profile.home?.reset) {
        throw createError({statusCode: 400, message: `profile ${input.profileKey} 未声明 home reset。`});
    }
    await resetProfileHome({
        projectRoot,
        profileKey: profile.manifest.key,
        profileVersion: profile.manifest.version ?? 1,
        definition: profile.home,
    });
    return readConfigEditorSnapshot(query);
}

/**
 * 读取 effective config，供后端运行路径直接使用。
 */
export async function loadEffectiveConfig(query: ConfigWorkspaceQueryDto = {workspaceKind: "user-assets"}): Promise<EffectiveConfig> {
    const {global, project} = await readConfigFiles(query);
    return resolveEffectiveConfig(global, project);
}

/**
 * 按Agent runtime的Project Path读取effective config。
 *
 * Global Config始终属于当前Runtime Paths的Workspace Root `.nbook`；外部绝对
 * Project Workspace只改变Project Config来源，不能冒充Global Config根。
 */
export async function loadEffectiveConfigForAgentRuntime(input: {projectPath?: string}): Promise<EffectiveConfig> {
    return loadEffectiveConfigAtWorkspaceRoot({
        workspaceRoot: absoluteFsPath(resolveStateWorkspaceRoot()),
        projectPath: input.projectPath,
    });
}

/**
 * 在调用方已经确定的 Workspace Root 下读取 Agent runtime Config。
 * 核心运行时使用此 Interface，避免再次从 cwd 或环境猜测 State Root。
 */
export async function loadEffectiveConfigAtWorkspaceRoot(input: {
    workspaceRoot: AbsoluteFsPath;
    projectPath?: string;
}): Promise<EffectiveConfig> {
    if (!input.projectPath) {
        return resolveEffectiveConfig(await readGlobalConfigFileAtWorkspaceRoot(input.workspaceRoot), null);
    }

    if (path.isAbsolute(input.projectPath)) {
        const [global, project] = await Promise.all([
            readGlobalConfigFileAtWorkspaceRoot(input.workspaceRoot),
            readProjectConfigFile(path.join(path.resolve(input.projectPath), ".nbook", "config.json")),
        ]);
        return resolveEffectiveConfig(global, project);
    }

    const projectRoot = resolveProjectWorkspaceRoot(input.workspaceRoot, normalizeProjectPath(input.projectPath));
    return resolveEffectiveConfig(
        await readGlobalConfigFileAtWorkspaceRoot(input.workspaceRoot),
        await readProjectConfigFile(path.join(projectRoot, ".nbook", "config.json")),
    );
}

/**
 * 同步读取 Global Config。仅用于 provider key 这类同步入口。
 */
export function loadGlobalEffectiveConfigSync(): EffectiveConfig {
    const global = readJsonFileSync<StoredGlobalConfig>(globalConfigPath());
    return resolveEffectiveConfig(normalizeGlobalConfig(global), null);
}

/**
 * 当前 Project Workspace / user-assets 的默认 profile。
 */
export async function resolveDefaultProfileKey(query: ConfigWorkspaceQueryDto): Promise<string> {
    const target = await resolveConfigTarget(query);
    const {global, project} = await readConfigFiles(query, target);
    return resolveDefaultProfileKeyFromConfig(target.workspaceKind, global, project);
}

/**
 * 解析配置目标路径。user-assets 只对应 Workspace Root `.nbook`。
 */
export async function resolveConfigTarget(query: ConfigWorkspaceQueryDto): Promise<ConfigTarget> {
    const workspaceKind: WorkspaceRootKind = query.workspaceKind === USER_ASSETS_WORKSPACE_KIND ? USER_ASSETS_WORKSPACE_KIND : "novel";
    if (workspaceKind === USER_ASSETS_WORKSPACE_KIND) {
        return {
            workspaceKind,
            projectConfigPath: null,
        };
    }

    if (!query.projectPath) {
        throw createError({
            statusCode: 400,
            message: "Project Workspace 配置必须提供有效 projectPath",
        });
    }
    const workspaceRoot = absoluteFsPath(resolveStateWorkspaceRoot());
    const projectPath = await assertProjectWorkspaceDirectory(workspaceRoot, query.projectPath);
    const projectRoot = resolveProjectWorkspaceRoot(workspaceRoot, projectPath);
    return {
        workspaceKind,
        projectConfigPath: path.join(projectRoot, ".nbook", "config.json"),
    };
}

/**
 * Project Config / Project Profile Home 都是 Project Workspace 数据面，必须在显式 open 后访问。
 */
function assertProjectConfigDataPlaneOpen(target: ConfigTarget, query: ConfigWorkspaceQueryDto): void {
    if (target.workspaceKind !== "novel" || !target.projectConfigPath) {
        return;
    }
    assertProjectPathOpen(query.projectPath);
}

/**
 * 校验 Project 数据面生命周期并刷新 activity。无 projectPath 是调用方契约错误，按 400 暴露。
 */
function assertProjectPathOpen(projectPath: string | undefined): void {
    if (!projectPath) {
        throw createError({statusCode: 400, message: "Project 数据面访问必须提供 projectPath。"});
    }
    assertProjectOpen(projectPath);
    markProjectActivity(projectPath);
}

async function readConfigFiles(query: ConfigWorkspaceQueryDto, knownTarget?: ConfigTarget): Promise<{
    global: StoredGlobalConfig;
    project: StoredProjectConfig | null;
}> {
    const target = knownTarget ?? await resolveConfigTarget(query);
    const [global, project] = await Promise.all([
        readGlobalConfigFile(),
        target.projectConfigPath ? readProjectConfigFile(target.projectConfigPath) : Promise.resolve(null),
    ]);
    return {global, project};
}

async function readGlobalConfigFile(): Promise<StoredGlobalConfig> {
    return normalizeGlobalConfig(await readJsonFile<StoredGlobalConfig>(globalConfigPath()));
}

export async function readGlobalConfigFileAtWorkspaceRoot(workspaceRoot: AbsoluteFsPath): Promise<StoredGlobalConfig> {
    return normalizeGlobalConfig(await readJsonFile<StoredGlobalConfig>(path.join(workspaceRoot, ".nbook", "config.json")));
}

async function readProjectConfigFile(configPath: string): Promise<StoredProjectConfig> {
    return normalizeProjectConfig(await readJsonFile<StoredProjectConfig>(configPath));
}

function redactGlobalConfig(config: StoredGlobalConfig): GlobalConfigDto {
    return GlobalConfigDtoSchema.parse({
        agent: config.agent,
        ui: config.ui,
        editor: config.editor,
        observability: config.observability,
        comfyui: config.comfyui,
        web: {
            search: {
                order: config.web?.search?.order ?? [],
                providers: {
                    tavily: {
                        ...config.web?.search?.providers?.tavily,
                        apiKey: maskSecret(config.web?.search?.providers?.tavily?.apiKey),
                    },
                    brave: {
                        ...config.web?.search?.providers?.brave,
                        apiKey: maskSecret(config.web?.search?.providers?.brave?.apiKey),
                    },
                },
            },
            fetch: config.web?.fetch,
        },
        embedding: {
            ...config.embedding,
            apiKey: maskSecret(config.embedding?.apiKey),
        },
        models: {
            default: config.models?.default ?? null,
            providers: (config.models?.providers ?? []).map((provider, sourceIndex) => ({
                ...provider,
                sourceIndex,
                modelApi: provider.modelApi ?? null,
                options: {
                    ...provider.options,
                    apiKey: maskSecret(provider.options.apiKey),
                },
            })),
        },
    });
}

function buildConfigModelSettingsDto(
    global: StoredGlobalConfig,
    project: StoredProjectConfig | null,
    workspaceKind: WorkspaceRootKind,
): ConfigModelSettingsDto {
    const providers = (global.models?.providers ?? []).map((provider, sourceIndex) => ({
        sourceIndex,
        id: provider.id,
        name: provider.name,
        enabled: provider.enabled,
        modelApi: provider.modelApi,
        options: {
            apiKey: maskSecret(provider.options.apiKey),
            baseURL: provider.options.baseURL,
            proxy: provider.options.proxy,
            timeoutMs: provider.options.timeoutMs,
            requestOptions: provider.options.requestOptions,
        },
        models: provider.models.map((model) => ({...model})),
    }));
    const defaultModelKey = workspaceKind === USER_ASSETS_WORKSPACE_KIND
        ? global.models?.default ?? null
        : project?.models?.default ?? global.models?.default ?? null;
    const enabledModels = listRawEnabledModels(global);
    const defaultModel = enabledModels.find((model) => model.key === defaultModelKey) ?? null;
    const references = workspaceKind === USER_ASSETS_WORKSPACE_KIND
        ? globalModelReferences(global)
        : projectModelReferences(project);
    const validationIssues = inspectModelSettings(rawModelSettingsInput(global.models, defaultModelKey), references).issues;

    return {
        defaultModelKey,
        defaultModelLabel: defaultModel?.label ?? null,
        enabledModels,
        providers,
        validationIssues,
    };
}
/**
 * 在任何资源 mutation 或文件写入前校验完整 Provider Config。
 * DTO 数组直接进入 shared contract，确保重复 Provider/model ID 不会在 normalize 后被覆盖。
 */
function assertGlobalProviderConfig(
    models: NonNullable<GlobalConfigUpdateDto["models"]>,
    candidate: StoredGlobalConfig,
): void {
    const references = globalModelReferences(candidate);
    const issues = inspectModelSettings(rawModelSettingsInput(models, models.default ?? null), references).issues;
    if (issues.length === 0) {
        return;
    }
    throw createError({
        statusCode: 400,
        message: issues[0]?.message ?? "Provider Config 校验失败。",
        data: {issues},
    });
}

/** 将存储数组转换为 shared contract 输入；调用方必须在 runtime Record 化之前执行。 */
function rawModelSettingsInput(
    models: StoredGlobalConfig["models"] | NonNullable<GlobalConfigUpdateDto["models"]> | undefined,
    defaultModelKey: string | null = models?.default ?? null,
): ModelSettingsContractInput {
    return {
        defaultModelKey,
        providers: (models?.providers ?? []).map((provider) => ({
            id: provider.id,
            enabled: provider.enabled ?? true,
            modelApi: provider.modelApi ?? null,
            options: {baseURL: provider.options.baseURL},
            models: provider.models,
        })),
    };
}

/** 从未经 Record 折叠的 Provider Config 数组生成唯一、可运行模型选项。 */
function listRawEnabledModels(global: StoredGlobalConfig): ConfigModelSettingsDto["enabledModels"] {
    const inspection = inspectProviderConfigDocument(rawModelSettingsInput(global.models, null));
    const options: ConfigModelSettingsDto["enabledModels"] = [];
    for (const provider of global.models?.providers ?? []) {
        for (const model of provider.models) {
            const key = `${provider.id}/${model.id}`;
            if (!inspection.runnableModelKeys.has(key)) {
                continue;
            }
            options.push({
                key,
                label: buildModelLabel(provider.name, model.name),
                providerId: provider.id,
                modelId: model.id,
                contextWindowTokens: model.contextWindowTokens,
            });
        }
    }
    return options.sort((left, right) => left.label.localeCompare(right.label));
}

/** 使用当前原始 Provider Config 的 runnable key 校验一组显式模型引用。 */
function assertReferencesRunnable(
    models: StoredGlobalConfig["models"] | undefined,
    references: readonly ModelReferenceInput[],
): void {
    const runnableModelKeys = inspectProviderConfigDocument(rawModelSettingsInput(models, null)).runnableModelKeys;
    const issues = inspectModelReferences(runnableModelKeys, references);
    if (issues.length === 0) {
        return;
    }
    throw createError({
        statusCode: 400,
        message: issues[0]?.message ?? "模型引用校验失败。",
        data: {issues},
    });
}

/**
 * Global Provider mutation 前扫描所有 managed Project 引用。
 * 这是控制面完整性检查，不隐式 open Project，也不修改 Project Config。
 */
async function assertManagedProjectModelReferences(global: StoredGlobalConfig): Promise<void> {
    const workspaceRoot = absoluteFsPath(resolveStateWorkspaceRoot());
    const runnableModelKeys = inspectProviderConfigDocument(rawModelSettingsInput(global.models, null)).runnableModelKeys;
    const issues = [] as ReturnType<typeof inspectModelReferences>;
    for (const project of await listProjectWorkspaces(workspaceRoot)) {
        const projectRoot = resolveProjectWorkspaceRoot(workspaceRoot, normalizeProjectPath(project.projectPath));
        const config = await readProjectConfigFile(path.join(projectRoot, ".nbook", "config.json"));
        const references: ModelReferenceInput[] = [{
            modelKey: config.models?.default ?? global.models?.default ?? null,
            path: [project.projectPath, "models", "default"],
            label: `${project.projectPath} 默认模型`,
        }, ...projectModelReferences(config).map((reference) => ({
            ...reference,
            path: [project.projectPath, ...reference.path],
            label: `${project.projectPath} ${reference.label}`,
        }))];
        issues.push(...inspectModelReferences(runnableModelKeys, references));
    }
    if (issues.length > 0) {
        throw createError({
            statusCode: 400,
            message: issues[0]?.message ?? "Project 模型引用校验失败。",
            data: {issues},
        });
    }
}

/** 删除 Provider 前列出 Global 与全部 managed Project 中仍指向它的模型引用。 */
export async function inspectProviderReferences(providerId: string): Promise<Array<{label: string; modelKey: string}>> {
    const global = await readGlobalConfigFile();
    const prefix = `${providerId}/`;
    const references: Array<{label: string; modelKey: string}> = [];
    for (const reference of [{modelKey: global.models?.default ?? null, label: "Global 默认模型"}, ...globalModelReferences(global)]) {
        if (reference.modelKey?.startsWith(prefix)) {
            references.push({label: reference.label, modelKey: reference.modelKey});
        }
    }
    const workspaceRoot = absoluteFsPath(resolveStateWorkspaceRoot());
    for (const project of await listProjectWorkspaces(workspaceRoot)) {
        const projectRoot = resolveProjectWorkspaceRoot(workspaceRoot, normalizeProjectPath(project.projectPath));
        const config = await readProjectConfigFile(path.join(projectRoot, ".nbook", "config.json"));
        for (const reference of [
            {modelKey: config.models?.default ?? global.models?.default ?? null, label: `${project.projectPath} 默认模型`},
            ...projectModelReferences(config).map((item) => ({...item, label: `${project.projectPath} ${item.label}`})),
        ]) {
            if (reference.modelKey?.startsWith(prefix)) {
                references.push({label: reference.label, modelKey: reference.modelKey});
            }
        }
    }
    return references;
}

/** 返回 Global Agent 配置中所有显式模型引用。 */
function globalModelReferences(config: StoredGlobalConfig): ModelReferenceInput[] {
    const references: ModelReferenceInput[] = [];
    if (config.agent?.profileModelDefaults && Object.hasOwn(config.agent.profileModelDefaults, "modelKey")) {
        references.push({
            modelKey: config.agent.profileModelDefaults.modelKey ?? null,
            path: ["agent", "profileModelDefaults", "modelKey"],
            label: "Agent Profile 默认模型",
        });
    }
    for (const [profileKey, profile] of Object.entries(config.agent?.profiles ?? {})) {
        if (!profile.model || !Object.hasOwn(profile.model, "modelKey")) {
            continue;
        }
        references.push({
            modelKey: profile.model.modelKey ?? null,
            path: ["agent", "profiles", profileKey, "model", "modelKey"],
            label: `Agent Profile ${profileKey} 模型`,
        });
    }
    return references;
}

/** 返回当前 Project Config 中所有显式 Profile 模型引用。 */
function projectModelReferences(config: StoredProjectConfig | null): ModelReferenceInput[] {
    const references: ModelReferenceInput[] = [];
    if (config?.agent?.profileModelDefaults && Object.hasOwn(config.agent.profileModelDefaults, "modelKey")) {
        references.push({
            modelKey: config.agent.profileModelDefaults.modelKey ?? null,
            path: ["agent", "profileModelDefaults", "modelKey"],
            label: "Project Agent Profile 默认模型",
        });
    }
    for (const [profileKey, profile] of Object.entries(config?.agent?.profiles ?? {})) {
        if (!profile.model || !Object.hasOwn(profile.model, "modelKey")) {
            continue;
        }
        references.push({
            modelKey: profile.model.modelKey ?? null,
            path: ["agent", "profiles", profileKey, "model", "modelKey"],
            label: `Project Agent Profile ${profileKey} 模型`,
        });
    }
    return references;
}

/** 判断 Project section patch 是否实际修改模型选择引用。 */
function projectModelReferencesChanged(input: ProjectConfigDto): boolean {
    if (input.models && Object.hasOwn(input.models, "default")) {
        return true;
    }
    if (input.agent?.profileModelDefaults && Object.hasOwn(input.agent.profileModelDefaults, "modelKey")) {
        return true;
    }
    return Object.values(input.agent?.profiles ?? {}).some((profile) => Boolean(
        profile.model && Object.hasOwn(profile.model, "modelKey"),
    ));
}

/** 校验当前 Project 显式模型引用；不扫描或修改其他 Project Workspace。 */
function assertProjectModelReferences(global: StoredGlobalConfig, project: StoredProjectConfig): void {
    const runnableModelKeys = inspectProviderConfigDocument(rawModelSettingsInput(global.models, null)).runnableModelKeys;
    const defaultModelKey = project.models?.default ?? global.models?.default ?? null;
    const references: ModelReferenceInput[] = [{
        modelKey: defaultModelKey,
        path: ["models", "default"],
        label: "Project 默认模型",
    }, ...projectModelReferences(project)];
    const issues = inspectModelReferences(runnableModelKeys, references);
    if (!defaultModelKey?.trim() && runnableModelKeys.size > 0) {
        issues.unshift({
            code: "missing_default_model",
            path: ["models", "default"],
            modelKey: null,
            message: "存在可运行模型时，Project 必须能解析到默认模型。",
        });
    }
    if (issues.length === 0) {
        return;
    }
    throw createError({
        statusCode: 400,
        message: issues[0]?.message ?? "Project 模型引用校验失败。",
        data: {issues},
    });
}

/**
 * 将 Project Config 请求解释为顶层 section patch。
 * 未提交 section 保持原值；profiles 明确提交时替换当前 Project 的完整 override map。
 */
function mergeProjectConfig(current: StoredProjectConfig, patch: StoredProjectConfig): StoredProjectConfig {
    const next: StoredProjectConfig = {...current};
    if (patch.models) {
        next.models = {...current.models, ...patch.models};
    }
    if (patch.embedding) {
        next.embedding = {...current.embedding, ...patch.embedding};
    }
    if (patch.editor) {
        next.editor = {
            ...current.editor,
            ...patch.editor,
            ...(patch.editor.markdown ? {markdown: {...current.editor?.markdown, ...patch.editor.markdown}} : {}),
            ...(patch.editor.monaco ? {monaco: {...current.editor?.monaco, ...patch.editor.monaco}} : {}),
        };
    }
    if (patch.history) {
        next.history = {...current.history, ...patch.history};
    }
    if (patch.agent) {
        next.agent = {
            ...current.agent,
            ...patch.agent,
            ...(patch.agent.profileModelDefaults ? {
                profileModelDefaults: {...current.agent?.profileModelDefaults, ...patch.agent.profileModelDefaults},
            } : {}),
            ...(patch.agent.profileRuntimeDefaults ? {
                profileRuntimeDefaults: mergeProfileRuntimePatches(current.agent?.profileRuntimeDefaults, patch.agent.profileRuntimeDefaults),
            } : {}),
            ...(patch.agent.profiles !== undefined ? {profiles: patch.agent.profiles} : {}),
        };
    }
    return normalizeProjectConfig(next);
}

function buildConfigEmbeddingSettingsDto(
    global: StoredGlobalConfig,
    project: StoredProjectConfig | null,
    effective: EffectiveConfig,
): ConfigEmbeddingSettingsDto {
    const globalEmbedding = normalizeEmbeddingService(global.embedding);
    const projectEmbedding = project?.embedding ? normalizeEmbeddingModelConfig(project.embedding) : null;
    return {
        global: {
            ...globalEmbedding,
            apiKey: maskSecret(globalEmbedding.apiKey),
        },
        project: projectEmbedding,
        effective: {
            ...effective.embedding,
            apiKey: maskSecret(effective.embedding.apiKey),
        },
    };
}

async function buildConfigAgentProfileSettingsDto(input: {
    effective: EffectiveConfig;
    global: StoredGlobalConfig;
    project: StoredProjectConfig | null;
    profiles: AgentProfileCatalog;
    catalogProfiles: AgentCatalogItem[];
    query: ConfigWorkspaceQueryDto;
    includeSettings: boolean;
    settingsScope: "global" | "project";
}): Promise<ConfigAgentProfileSettingsDto> {
    const defaultModelKey = input.settingsScope === "project"
        ? input.project?.models?.default ?? input.global.models?.default ?? null
        : input.global.models?.default ?? null;
    const modelReferences = input.settingsScope === "project"
        ? projectModelReferences(input.project)
        : globalModelReferences(input.global);
    return {
        enabledModels: listRawEnabledModels(input.global),
        validationIssues: inspectModelSettings(rawModelSettingsInput(input.global.models, defaultModelKey), modelReferences).issues,
        profileModelDefaults: normalizeAgentProfileModelConfig(input.effective.agent.profileModelDefaults),
        harnessRuntimeDefaults: resolveProfileRuntimeSettings(undefined, undefined),
        profileRuntimeDefaults: resolveProfileRuntimeSettings(undefined, input.effective.agent.profileRuntimeDefaults),
        globalRuntimeDefaultsPatch: input.global.agent?.profileRuntimeDefaults ?? {},
        projectRuntimeDefaultsPatch: input.project?.agent?.profileRuntimeDefaults ?? {},
        agentProfiles: await Promise.all(input.catalogProfiles.map(async (definition) => {
            const profile = definition.loadStatus === "loaded" ? await input.profiles.get(definition.key) : null;
            return {
                profileKey: definition.key,
                name: definition.name,
                canResetHome: definition.canResetHome,
                model: normalizeAgentProfileModelConfig({
                    ...input.effective.agent.profileModelDefaults,
                    ...(input.effective.agent.profiles[definition.key]?.model ?? {}),
                }),
                loadStatus: definition.loadStatus,
                hasSettingsForm: definition.hasSettingsForm,
                runtime: {
                    profileDefaults: profile?.runtimeDefaults ?? {},
                    effective: resolveProfileRuntimeSettings(
                        profile?.runtimeDefaults,
                        input.effective.agent.profiles[definition.key]?.runtime ?? input.effective.agent.profileRuntimeDefaults,
                    ),
                    globalDefaultsPatch: input.global.agent?.profileRuntimeDefaults ?? {},
                    globalProfilePatch: input.global.agent?.profiles?.[definition.key]?.runtime ?? {},
                    projectDefaultsPatch: input.project?.agent?.profileRuntimeDefaults ?? {},
                    projectProfilePatch: input.project?.agent?.profiles?.[definition.key]?.runtime ?? {},
                },
                issue: toConfigProfileIssue(definition.issue),
                sourcePath: definition.sourcePath ?? null,
                buildState: input.profiles.buildStateFor(definition.key),
                settings: input.includeSettings ? await buildProfileSettingsDto(input, definition, profile) : null,
            };
        })),
    };
}

/**
 * 构造单个 profile 的 settings 编辑 DTO。
 */
async function buildProfileSettingsDto(input: {
    effective: EffectiveConfig;
    global: StoredGlobalConfig;
    project: StoredProjectConfig | null;
    profiles: AgentProfileCatalog;
    query: ConfigWorkspaceQueryDto;
    settingsScope: "global" | "project";
}, definition: AgentCatalogItem, profile: Awaited<ReturnType<AgentProfileCatalog["get"]>> | null): Promise<ConfigAgentProfileSettingsDto["agentProfiles"][number]["settings"]> {
    if (definition.loadStatus !== "loaded") {
        return null;
    }
    if (!definition.hasSettingsForm) {
        return null;
    }
    if (!profile?.settingsForm) {
        return null;
    }
    const effectivePatch = normalizeAgentProfileSettings(input.effective.agent.profiles[definition.key]?.settings);
    const globalPatch = normalizeAgentProfileSettings(input.global.agent?.profiles?.[definition.key]?.settings);
    const projectPatch = normalizeAgentProfileSettings(input.project?.agent?.profiles?.[definition.key]?.settings);
    const ctx = {
        ...await lowCodeFormContext(definition.key, input.query, input.settingsScope, profile, effectivePatch),
        allowGlobalResourceKeys: input.settingsScope === "project",
    };
    const resolution = await resolveProfileSettings(profile, effectivePatch, ctx);
    const inheritedResolution = await resolveProfileSettings(profile, input.project ? globalPatch : {}, ctx);
    return {
        form: await resolveLowCodeForm(profile.settingsForm, ctx),
        value: resolution.value,
        inheritedValue: inheritedResolution.value,
        effectivePatch,
        globalPatch,
        projectPatch,
        issues: resolution.issues,
    };
}

/**
 * 校验写入请求里的 profile settings patch。
 */
async function assertProfileSettingsInput(
    profilesInput: Record<string, {settings?: LowCodeJsonObject; resourceMutations?: LowCodeResourceMutationDto[]}> | undefined,
    query: ConfigWorkspaceQueryDto,
    profiles: AgentProfileCatalog,
    inheritedProfilesInput?: Record<string, {settings?: LowCodeJsonObject}>,
    options: {includeResourceMutationFinalKeys?: boolean} = {},
    scope: "global" | "project" = "global",
): Promise<void> {
    if (!profilesInput) {
        return;
    }
    for (const [profileKey, profileConfig] of Object.entries(profilesInput)) {
        if (profileConfig.settings === undefined) {
            continue;
        }
        const profile = await profiles.get(profileKey).catch(() => null);
        if (!profile?.settingsForm) {
            if (Object.keys(profileConfig.settings).length === 0) {
                continue;
            }
            throw createError({
                statusCode: 400,
                message: `profile ${profileKey} 未声明 settingsForm，不能保存 settings。`,
            });
        }
        const settingsForValidation = inheritedProfilesInput
            ? {
                ...normalizeAgentProfileSettings(inheritedProfilesInput[profileKey]?.settings),
                ...normalizeAgentProfileSettings(profileConfig.settings),
            }
            : profileConfig.settings;
        const ctx = await lowCodeFormContext(profileKey, query, scope, profile, settingsForValidation);
        const resourceKeyView = options.includeResourceMutationFinalKeys
            ? await buildResourceMutationKeyView(profile.settingsForm, profileConfig.resourceMutations, ctx, settingsForValidation)
            : null;
        const validationCtx = {
            ...(resourceKeyView ? withResourceMutationKeyView(ctx, resourceKeyView) : ctx),
            allowGlobalResourceKeys: scope === "project",
        };
        const result = await validateLowCodeFormValue(
            profile.settingsForm,
            settingsForValidation,
            validationCtx,
        );
        const error = result.issues.find((issue) => issue.severity === "error");
        if (error) {
            throw createError({
                statusCode: 400,
                message: `profile ${profileKey} settings 校验失败：${error.message}`,
            });
        }
        if (scope === "project") {
            await assertProjectProfileResourceKeys(profile.settingsForm, profileConfig.settings, resourceKeyView ? withResourceMutationKeyView(ctx, resourceKeyView) : ctx);
        }
    }
}

async function applyProfileResourceMutations(
    profilesInput: Record<string, {settings?: LowCodeJsonObject; resourceMutations?: LowCodeResourceMutationDto[]}> | undefined,
    query: ConfigWorkspaceQueryDto,
    profiles: AgentProfileCatalog,
    inheritedProfilesInput?: Record<string, {settings?: LowCodeJsonObject}>,
    scope: "global" | "project" = "project",
): Promise<void> {
    if (!profilesInput) {
        return;
    }
    for (const [profileKey, profileConfig] of Object.entries(profilesInput)) {
        if (!profileConfig.resourceMutations?.length) {
            continue;
        }
        const profile = await profiles.get(profileKey).catch(() => null);
        if (!profile?.settingsForm) {
            throw createError({statusCode: 400, message: `profile ${profileKey} 未声明 settingsForm，不能保存资源。`});
        }
        const currentValues = {
            ...normalizeAgentProfileSettings(inheritedProfilesInput?.[profileKey]?.settings),
            ...normalizeAgentProfileSettings(profileConfig.settings),
        };
        const results = await applyLowCodeResourceMutations(
            profile.settingsForm,
            profileConfig.resourceMutations,
            await lowCodeFormContext(profileKey, query, scope, profile, currentValues),
            currentValues,
        );
        const issue = results.flatMap((result) => result.issues).find((item) => item.severity === "error");
        if (issue) {
            throw createError({statusCode: 400, message: `profile ${profileKey} 资源操作失败：${issue.message}`});
        }
    }
}

async function assertProjectProfileResourceKeys(
    form: LowCodeFormDefinition,
    settings: LowCodeJsonObject | undefined,
    ctx: LowCodeFormResolveContext,
): Promise<void> {
    if (!settings) {
        return;
    }
    for (const field of form.fields) {
        if (field.component !== "resource-preset" || !field.resource) {
            continue;
        }
        const current = readLowCodePath(settings, field.path);
        if (current === undefined || current === null || current === "") {
            continue;
        }
        if (typeof current !== "string") {
            continue;
        }
        const valid = await projectResourceKeyExists(field.resource, ctx, resourceKeyCandidates(field.resource, current));
        if (!valid) {
            throw createError({
                statusCode: 400,
                message: `profile ${ctx.profileKey} settings 校验失败：字段 ${field.label} 选择的资源只存在于全局库，请先复制到项目并选中。`,
            });
        }
    }
}

async function projectResourceKeyExists(
    resource: NonNullable<LowCodeFormDefinition["fields"][number]["resource"]>,
    ctx: LowCodeFormResolveContext,
    candidateKeys: readonly string[],
): Promise<boolean> {
    const mutationKeyResult = resourceMutationKeyResult(ctx, candidateKeys);
    if (mutationKeyResult !== null) {
        return mutationKeyResult;
    }
    if (!ctx.home) {
        return false;
    }
    try {
        if (resource.validateKey) {
            for (const key of candidateKeys) {
                if (await resource.validateKey(ctx, key)) {
                    return true;
                }
            }
            return false;
        }
        return (await resource.list(ctx)).some((option) => candidateKeys.includes(option.key));
    } catch {
        return false;
    }
}

function resourceMutationKeyResult(ctx: LowCodeFormResolveContext, candidateKeys: readonly string[]): boolean | null {
    if (!ctx.resourceMutationKeyView) {
        return null;
    }
    const normalizedKeys = candidateKeys.map(normalizeResourceKeyForView);
    if (!normalizedKeys.some((key) => ctx.resourceMutationKeyView!.knownKeys.has(key))) {
        return null;
    }
    return normalizedKeys.some((key) => ctx.resourceMutationKeyView!.finalKeys.has(key));
}

function resourceKeyCandidates(
    resource: NonNullable<LowCodeFormDefinition["fields"][number]["resource"]>,
    current: string,
): string[] {
    const candidateKeys = [current];
    if (!current.includes("/") && resource.createKeyPrefix && resource.createKeySuffix) {
        const suffix = resource.createKeySuffix;
        const slug = current.endsWith(suffix) ? current.slice(0, -suffix.length) : current;
        candidateKeys.push(`${resource.createKeyPrefix}${slug}${suffix}`);
    }
    return [...new Set(candidateKeys)];
}

/**
 * 按低代码表单点路径读取对象字段，用于 Project 显式覆盖校验。
 */
function readLowCodePath(value: LowCodeJsonObject, fieldPath: string): LowCodeJsonValue | undefined {
    const segments = fieldPath.split(".").filter(Boolean);
    let current: LowCodeJsonValue | undefined = value;
    for (const segment of segments) {
        if (!current || typeof current !== "object" || Array.isArray(current)) {
            return undefined;
        }
        current = current[segment];
    }
    return current;
}

/**
 * 根据 Config query 构造低代码 form 解析上下文。
 */
async function lowCodeFormContext(
    profileKey: string,
    query: ConfigWorkspaceQueryDto,
    scope: "global" | "project",
    profile?: {manifest: {version?: number}; home?: ProfileHomeDefinition; settingsForm?: LowCodeFormDefinition},
    values?: LowCodeJsonObject,
): Promise<LowCodeFormResolveContext> {
    const workspaceRoot = query.workspaceKind === "novel" ? WORKSPACE_CONTAINER_ROOT : USER_ASSETS_WORKSPACE_ROOT;
    const needsHome = profileNeedsHome(profile);
    const runtimeWorkspaceRoot = absoluteFsPath(resolveStateWorkspaceRoot());
    const projectRoot = scope === "project" && query.workspaceKind === "novel"
        ? resolveProjectRootForProfileHome(runtimeWorkspaceRoot, query.projectPath)
        : null;
    if (projectRoot && profile && needsHome) {
        assertProjectPathOpen(query.projectPath);
    }
    const projectHome = projectRoot && profile && needsHome
        ? await ensureProfileHome({
            projectRoot,
            profileKey,
            profileVersion: profile.manifest.version ?? 1,
            definition: profile.home,
        })
        : undefined;
    const globalHome = profile && needsHome
        ? await ensureGlobalProfileHome({
            workspaceRoot: runtimeWorkspaceRoot,
            profileKey,
            profileVersion: profile.manifest.version ?? 1,
            definition: profile.home,
        })
        : undefined;
    const home = scope === "global" ? globalHome : projectHome;
    return {
        profileKey,
        scope,
        workspaceRoot,
        ...(query.projectPath ? {projectPath: query.projectPath} : {}),
        ...(values ? {values} : {}),
        ...(home ? {home} : {}),
        ...(scope === "project" && globalHome ? {globalHome} : {}),
    };
}

function profileNeedsHome(profile: {home?: ProfileHomeDefinition; settingsForm?: LowCodeFormDefinition} | undefined): boolean {
    return Boolean(profile?.home) || Boolean(profile?.settingsForm?.fields.some((field) => field.component === "resource-preset"));
}

async function buildResourceMutationKeyView(
    form: LowCodeFormDefinition,
    mutations: readonly LowCodeResourceMutationDto[] | undefined,
    ctx: LowCodeFormResolveContext,
    currentValues: LowCodeJsonObject,
): Promise<{knownKeys: Set<string>; finalKeys: Set<string>} | null> {
    if (!mutations?.length) {
        return null;
    }
    const results = await validateLowCodeResourceMutations(form, mutations, ctx, currentValues);
    const issue = results.flatMap((result) => result.issues).find((item) => item.severity === "error");
    if (issue) {
        throw createError({statusCode: 400, message: `profile ${ctx.profileKey} 资源操作失败：${issue.message}`});
    }
    const knownKeys = new Set<string>();
    const finalKeys = new Set<string>();
    const fieldPaths = new Set(mutations.map((mutation) => mutation.fieldPath));
    for (const fieldPath of fieldPaths) {
        const field = form.fields.find((item) => item.path === fieldPath);
        if (!field?.resource) {
            continue;
        }
        for (const option of await field.resource.list(ctx)) {
            knownKeys.add(normalizeResourceKeyForView(option.key));
        }
        const result = results.findLast((item) => item.fieldPath === fieldPath);
        for (const key of result?.finalKeys ?? []) {
            const normalizedKey = normalizeResourceKeyForView(key);
            knownKeys.add(normalizedKey);
            finalKeys.add(normalizedKey);
        }
    }
    return {knownKeys, finalKeys};
}

function withResourceMutationKeyView(
    ctx: LowCodeFormResolveContext,
    keyView: LowCodeResourceMutationKeyView,
): LowCodeFormResolveContext {
    if (!ctx.home || keyView.knownKeys.size === 0) {
        return ctx;
    }
    return {
        ...ctx,
        resourceMutationKeyView: keyView,
        home: {
            ...ctx.home,
            async exists(filePath) {
                const key = normalizeResourceKeyForView(filePath);
                if (keyView.knownKeys.has(key)) {
                    return keyView.finalKeys.has(key);
                }
                return ctx.home!.exists(filePath);
            },
        },
    };
}

function normalizeResourceKeyForView(filePath: string): string {
    return filePath.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
}

function stripProfileResourceMutations(input: ProjectConfigDto): ProjectConfigDto {
    if (!input.agent?.profiles) {
        return input;
    }
    return {
        ...input,
        agent: {
            ...input.agent,
            profiles: Object.fromEntries(Object.entries(input.agent.profiles).map(([profileKey, profileConfig]) => ([
                profileKey,
                {
                    model: profileConfig.model,
                    ...(profileConfig.settings !== undefined ? {settings: profileConfig.settings} : {}),
                    ...(profileConfig.runtime !== undefined ? {runtime: profileConfig.runtime} : {}),
                },
            ]))),
        },
    };
}

function buildDefaultProfileSettingsDto(input: {
    workspaceKind: WorkspaceRootKind;
    projectConfigAvailable: boolean;
    global: StoredGlobalConfig;
    project: StoredProjectConfig | null;
    profiles?: ConfigDefaultProfileSettingsDto["profiles"];
}): ConfigDefaultProfileSettingsDto {
    const systemDefaultProfileKey = systemDefaultProfileKeyFor(input.workspaceKind);
    return {
        workspaceKind: input.workspaceKind,
        projectConfigAvailable: input.projectConfigAvailable,
        systemDefaultProfileKey,
        globalDefaultProfileKey: input.workspaceKind === USER_ASSETS_WORKSPACE_KIND
            ? input.global.agent?.defaultProfileKey?.userAssets ?? null
            : input.global.agent?.defaultProfileKey?.novel ?? null,
        projectDefaultProfileKey: input.project?.agent?.defaultProfileKey ?? null,
        effectiveProfileKey: resolveDefaultProfileKeyFromConfig(input.workspaceKind, input.global, input.project),
        profiles: input.profiles ?? [],
    };
}

function toConfigProfileIssue(issue: AgentProfileIssue | undefined): ConfigAgentProfileSettingsDto["agentProfiles"][number]["issue"] {
    if (!issue) {
        return null;
    }
    return {
        code: issue.code,
        message: issue.message,
        profileKey: issue.profileKey ?? null,
        sourcePath: issue.sourcePath ?? null,
    };
}

function resolveDefaultProfileKeyFromConfig(workspaceKind: WorkspaceRootKind, global: StoredGlobalConfig, project: StoredProjectConfig | null): string {
    const systemDefaultProfileKey = systemDefaultProfileKeyFor(workspaceKind);
    if (workspaceKind === USER_ASSETS_WORKSPACE_KIND) {
        return global.agent?.defaultProfileKey?.userAssets ?? systemDefaultProfileKey;
    }
    return project?.agent?.defaultProfileKey
        ?? global.agent?.defaultProfileKey?.novel
        ?? systemDefaultProfileKey;
}

function systemDefaultProfileKeyFor(workspaceKind: WorkspaceRootKind): string {
    return workspaceKind === USER_ASSETS_WORKSPACE_KIND ? "leader.assets" : "leader.default";
}

function maskSecret(value: string | null | undefined): {configured: boolean; maskedValue: string | null} {
    const normalized = value?.trim() ?? "";
    if (!normalized) {
        return {
            configured: false,
            maskedValue: null,
        };
    }
    return {
        configured: true,
        maskedValue: normalized.length <= 8 ? "********" : `${normalized.slice(0, 4)}...${normalized.slice(-4)}`,
    };
}

function resolveSecretWrite(input: {previousValue: string; configured: boolean; value?: string}): string {
    if (input.value === undefined) {
        return input.previousValue;
    }
    return input.value.trim();
}

function normalizeGlobalModelsForWrite(
    models: NonNullable<GlobalConfigUpdateDto["models"]>,
    current: StoredGlobalConfig,
): NonNullable<StoredGlobalConfig["models"]> {
    const usedSourceIndexes = new Set<number>();
    return {
        default: models.default ?? null,
        providers: models.providers.map((provider): StoredProviderConfig => ({
            id: provider.id,
            name: provider.name,
            enabled: provider.enabled,
            modelApi: provider.modelApi,
            options: {
                ...provider.options,
                apiKey: resolveSecretWrite({
                    previousValue: resolveProviderApiKey(current, provider, usedSourceIndexes),
                    configured: provider.options.apiKey.configured,
                    value: provider.options.apiKey.value,
                }),
                requestOptions: normalizeJsonRecord(provider.options.requestOptions),
            } satisfies ModelProviderOptionsConfig,
            models: provider.models.map((model): ConfiguredModelConfig => ({
                name: model.name,
                id: model.id,
                group: model.group,
                enabled: model.enabled,
                api: model.api,
                reasoning: model.reasoning,
                input: model.input,
                maxTokens: model.maxTokens,
                cost: model.cost,
                compat: model.compat,
                headers: model.headers,
                thinkingLevelMap: model.thinkingLevelMap,
                contextWindowTokens: model.contextWindowTokens,
            })),
        })),
    };
}

/**
 * Provider Config ID 是连接身份，不允许通过普通保存偷偷改名或换端点。
 * Provider Model API 只影响发现和候选补全，可以在同一连接上显式修改。
 * 显式 clone/migrate 尚未进入此保存接口；调用方必须新建 Provider 并重新提供凭据。
 */
function assertProviderConnectionsStable(
    providers: NonNullable<GlobalConfigUpdateDto["models"]>["providers"],
    current: StoredGlobalConfig,
): void {
    const storedProviders = current.models?.providers ?? [];
    const seenSourceIndexes = new Set<number>();
    for (const provider of providers) {
        if (provider.sourceIndex === undefined) {
            if (storedProviders.some((stored) => stored.id === provider.id)) {
                throw createError({
                    statusCode: 400,
                    message: `Provider ${provider.id} 必须携带来源索引；修改连接身份请先复制为新的 Provider。`,
                });
            }
            continue;
        }
        if (seenSourceIndexes.has(provider.sourceIndex)) {
            throw createError({statusCode: 400, message: `Provider 来源索引重复：${String(provider.sourceIndex)}`});
        }
        seenSourceIndexes.add(provider.sourceIndex);
        const stored = storedProviders[provider.sourceIndex];
        if (!stored) {
            throw createError({statusCode: 400, message: `Provider ${provider.id} 的来源索引无效。`});
        }
        if (stored.id !== provider.id) {
            throw createError({
                statusCode: 400,
                message: `Provider ID 不可修改：${stored.id}。请复制为新的 Provider，再迁移模型和引用。`,
            });
        }
        if (!sameProviderConnection({
            id: stored.id,
            baseURL: stored.options.baseURL,
            proxy: stored.options.proxy,
        }, {
            id: provider.id,
            baseURL: provider.options.baseURL,
            proxy: provider.options.proxy,
        })) {
            throw createError({
                statusCode: 400,
                message: `Provider ${provider.id} 的连接身份不可修改（Base URL 或代理已变化）。请复制为新的 Provider。`,
            });
        }
    }
}

/** 按编辑快照来源索引保留对应 Provider secret，避免重复 ID 修复时串 key。 */
function resolveProviderApiKey(
    config: StoredGlobalConfig,
    provider: NonNullable<GlobalConfigUpdateDto["models"]>["providers"][number],
    usedSourceIndexes: Set<number>,
): string {
    const storedProviders = config.models?.providers ?? [];
    if (provider.sourceIndex !== undefined) {
        const source = storedProviders[provider.sourceIndex];
        if (!source) {
            throw createError({statusCode: 400, message: `Provider ${provider.id} 的来源索引无效。`});
        }
        if (usedSourceIndexes.has(provider.sourceIndex)) {
            throw createError({statusCode: 400, message: `Provider 来源索引重复：${String(provider.sourceIndex)}`});
        }
        usedSourceIndexes.add(provider.sourceIndex);
        return source.options.apiKey;
    }

    if (storedProviders.some((item) => item.id === provider.id) && provider.options.apiKey.value === undefined) {
        throw createError({
            statusCode: 400,
            message: `Provider ${provider.id} 缺少来源索引或显式 API key；不能按 Provider ID 猜测旧 Secret。`,
        });
    }
    return provider.options.apiKey.value?.trim() ?? "";
}

const DEFAULT_GLOBAL_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_GLOBAL_EMBEDDING_DIMENSIONS = 1536;

function normalizeGlobalEmbeddingForWrite(
    embedding: NonNullable<GlobalConfigDto["embedding"]>,
    current: StoredGlobalConfig,
): EmbeddingServiceConfig {
    return normalizeEmbeddingService({
        enabled: embedding.enabled,
        provider: embedding.provider,
        model: embedding.model ?? (embedding.enabled ? DEFAULT_GLOBAL_EMBEDDING_MODEL : null),
        dimensions: embedding.dimensions ?? (embedding.enabled ? DEFAULT_GLOBAL_EMBEDDING_DIMENSIONS : null),
        apiKey: resolveSecretWrite({
            previousValue: current.embedding?.apiKey ?? "",
            configured: embedding.apiKey?.configured ?? false,
            value: embedding.apiKey?.value,
        }),
        baseURL: embedding.baseURL,
        timeoutMs: embedding.timeoutMs,
        requestOptions: normalizeJsonRecord(embedding.requestOptions),
    });
}

function normalizeGlobalWebForWrite(web: NonNullable<GlobalConfigDto["web"]>, current: StoredGlobalConfig): NonNullable<StoredGlobalConfig["web"]> {
    return {
        search: {
            order: web.search?.order,
            providers: {
                tavily: {
                    enabled: web.search?.providers?.tavily?.enabled,
                    apiKey: resolveSecretWrite({
                        previousValue: current.web?.search?.providers?.tavily?.apiKey ?? "",
                        configured: web.search?.providers?.tavily?.apiKey?.configured ?? false,
                        value: web.search?.providers?.tavily?.apiKey?.value,
                    }),
                    timeoutMs: web.search?.providers?.tavily?.timeoutMs,
                },
                brave: {
                    enabled: web.search?.providers?.brave?.enabled,
                    apiKey: resolveSecretWrite({
                        previousValue: current.web?.search?.providers?.brave?.apiKey ?? "",
                        configured: web.search?.providers?.brave?.apiKey?.configured ?? false,
                        value: web.search?.providers?.brave?.apiKey?.value,
                    }),
                    country: web.search?.providers?.brave?.country,
                    searchLang: web.search?.providers?.brave?.searchLang,
                    timeoutMs: web.search?.providers?.brave?.timeoutMs,
                },
            },
        },
        fetch: web.fetch,
    };
}

function normalizeJsonRecord(input: Record<string, unknown> | undefined): ModelProviderOptionsConfig["requestOptions"] {
    if (!input) {
        return {};
    }
    return Object.fromEntries(
        Object.entries(input).filter((entry): entry is [string, ModelProviderOptionsConfig["requestOptions"][string]] => isJsonValue(entry[1])),
    );
}

function isJsonValue(value: unknown): value is ModelProviderOptionsConfig["requestOptions"][string] {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return true;
    }
    if (Array.isArray(value)) {
        return value.every(isJsonValue);
    }
    if (typeof value === "object") {
        return Object.values(value).every(isJsonValue);
    }
    return false;
}

function assertProjectConfigDoesNotContainGlobalOnly(input: ProjectConfigDto): void {
    const record = input as Record<string, unknown>;
    if ("auth" in record) {
        throw createError({
            statusCode: 400,
            message: "Project Config 不能覆盖 auth 配置",
        });
    }
    const models = record.models as Record<string, unknown> | undefined;
    if (models && "providers" in models) {
        throw createError({
            statusCode: 400,
            message: "Project Config 不能覆盖 models.providers",
        });
    }
    const embedding = record.embedding as Record<string, unknown> | undefined;
    if (embedding && ("apiKey" in embedding || "baseURL" in embedding || "provider" in embedding || "enabled" in embedding || "timeoutMs" in embedding || "requestOptions" in embedding)) {
        throw createError({
            statusCode: 400,
            message: "Project Config 只能覆盖 embedding.model 和 embedding.dimensions",
        });
    }
    const history = record.history as Record<string, unknown> | undefined;
    if (history && "enabled" in history) {
        throw createError({
            statusCode: 400,
            message: "Project Config 不能覆盖 history.enabled（文件历史总开关仅 Global）",
        });
    }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
    try {
        return JSON.parse(await fs.readFile(filePath, "utf-8")) as T;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

function readJsonFileSync<T>(filePath: string): T | null {
    try {
        return JSON.parse(readFileSync(filePath, "utf-8")) as T;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), {recursive: true});
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 4)}\n`, "utf-8");
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}
