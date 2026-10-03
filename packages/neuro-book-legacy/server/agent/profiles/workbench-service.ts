import {existsSync} from "node:fs";
import {mkdir, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import {basename, dirname, join, relative, resolve, sep} from "node:path";
import {createError} from "h3";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import type {ProfileArtifactPathContextResolver} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {buildSystemPromptRoot, readAgentProfileDetail} from "nbook/server/agent/profiles/profile-http-service";
import type {
    AgentProfileCreateRequestDto,
    AgentProfileDetailDto,
    AgentProfileFileItemDto,
    AgentProfileIssueDto,
    AgentProfileSaveRequestDto,
    AgentProfileSourceDraftRequestDto,
    AgentProfileSourceRequestDto,
    AgentProfileTemplateItemDto,
} from "nbook/shared/dto/agent-profile.dto";
import type {ProfileTemplateDetailDto} from "nbook/shared/dto/profile-template.dto";

export type WorkbenchRoots = {
    /** Install Root 下可编辑的 profile 目录；Workbench 不编辑 Project profile。 */
    profileRoot: string;
    /** 模板属于 Seed 的非 runtime authoring 资产，不进入 Agent Catalog。 */
    templateRoot: string;
    /** Runtime Catalog 的显式 artifact path context resolver。 */
    artifactPathContextResolver: ProfileArtifactPathContextResolver;
};

/**
 * 列出可用于新建用户 profile 的 TSX 模板。
 */
export async function listProfileTemplates(roots: Pick<WorkbenchRoots, "templateRoot">): Promise<AgentProfileTemplateItemDto[]> {
    const templateRoot = roots.templateRoot;
    const entries = await readdir(templateRoot, {withFileTypes: true}).catch(() => []);
    return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".profile-template.tsx"))
        .map((entry) => ({
            name: entry.name.replace(/\.profile-template\.tsx$/, ""),
            fileName: entry.name,
            label: templateLabel(entry.name),
            description: templateDescription(entry.name),
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * 列出用户 profile root 下的源码文件，包含坏文件。这里只读取 compiled-only catalog 状态，
 * 不触发 TSX profile 编译。
 */
export async function listProfileFiles(roots: Pick<WorkbenchRoots, "profileRoot" | "artifactPathContextResolver">): Promise<AgentProfileFileItemDto[]> {
    const profileRoot = resolve(roots.profileRoot);
    const files = await findProfileFiles(profileRoot);
    const catalog = await new AgentProfileCatalog(profileRoot, undefined, undefined, undefined, roots.artifactPathContextResolver).snapshot().catch(() => null);
    const items: AgentProfileFileItemDto[] = [];
    for (const fileName of files) {
        const filePath = join(profileRoot, ...fileName.split("/"));
        const source = await readFile(join(profileRoot, fileName), "utf8").catch(() => "");
        const manifest = readManifestSummary(source);
        const catalogItem = catalog?.profiles.find((profile) => profile.sourcePath === filePath);
        const catalogIssues = catalog?.issues.filter((issue) => issue.sourcePath === filePath) ?? [];
        items.push({
            fileName,
            profileKey: catalogItem?.key ?? manifest?.key ?? null,
            name: catalogItem?.name ?? manifest?.name ?? fileName,
            loadStatus: catalogItem?.loadStatus ?? (manifest ? "not_compiled" : "missing"),
            issues: catalogIssues.map((issue) => ({
                severity: issue.code === "filename_mismatch" || issue.code === "builtin_schema_locked" || issue.code === "system_profile_shadowed" || issue.code === "source_stale" || issue.code === "dependency_stale" || issue.code === "not_compiled" || issue.code === "compile_stale" ? "warning" as const : "error" as const,
                message: issue.message,
                code: issue.code,
                profileKey: issue.profileKey,
                fileName,
            })),
        });
    }
    return items.sort((left, right) => left.fileName.localeCompare(right.fileName));
}

/**
 * 轻量读取 profile 源码草稿。只解析 TSX DSL tree，不加载 runtime catalog。
 */
export async function readProfileSourceDraft(request: AgentProfileSourceDraftRequestDto, roots: Pick<WorkbenchRoots, "profileRoot">): Promise<ProfileTemplateDetailDto> {
    const profileRoot = roots.profileRoot;
    const filePath = resolveProfilePath(request.fileName, profileRoot);
    if (!existsSync(filePath)) {
        throw createError({
            statusCode: 404,
            statusMessage: "profile_file_missing",
            message: `未找到 profile 文件：${request.fileName}`,
        });
    }
    const source = request.source ?? await readFile(filePath, "utf8");
    return buildProfileSourceDraft(request.fileName, source);
}

/**
 * 按 fileName 读取用户 profile 源码详情。
 */
export async function readProfileSource(profiles: AgentProfileCatalog, request: AgentProfileSourceRequestDto, roots: Pick<WorkbenchRoots, "profileRoot">): Promise<AgentProfileDetailDto> {
    const profileRoot = roots.profileRoot;
    const filePath = resolveProfilePath(request.fileName, profileRoot);
    if (!existsSync(filePath)) {
        throw createError({
            statusCode: 404,
            statusMessage: "profile_file_missing",
            message: `未找到 profile 文件：${request.fileName}`,
        });
    }
    try {
        const snapshot = await profiles.snapshot();
        const loaded = snapshot.profiles.find((profile) => profile.sourcePath === filePath);
        return await readAgentProfileDetail(profiles, loaded ? {profileKey: loaded.key} : {fileName: request.fileName});
    } catch (error) {
        const snapshot = await profiles.snapshot().catch(() => null);
        const issueDtos: AgentProfileIssueDto[] = snapshot?.issues
            .filter((issue) => issue.sourcePath === filePath)
            .map((issue) => ({
                severity: issue.code === "filename_mismatch" || issue.code === "builtin_schema_locked" || issue.code === "system_profile_shadowed" || issue.code === "source_stale" || issue.code === "dependency_stale" || issue.code === "not_compiled" || issue.code === "compile_stale" ? "warning" as const : "error" as const,
                message: issue.message,
                code: issue.code,
                profileKey: issue.profileKey,
                fileName: request.fileName,
            })) ?? [];
        const fallbackIssues: AgentProfileIssueDto[] = issueDtos.length > 0
            ? issueDtos
            : [{
                severity: "error" as const,
                message: error instanceof Error ? error.message : String(error),
                code: "load_failed",
                fileName: request.fileName,
            }];
        const source = await readFile(filePath, "utf8");
        return {
            catalogItem: {
                profileKey: `invalid:${request.fileName}`,
                kind: "agent",
                name: request.fileName,
                description: null,
                fileName: request.fileName,
                source: "project",
                overrideState: "project_only",
                creationMode: "public",
                loadStatus: "source_error",
                schemaLocked: false,
                canEdit: true,
                canRestore: true,
                issues: fallbackIssues,
            },
            manifest: null,
            fileName: request.fileName,
            source,
            issues: fallbackIssues,
            variables: [],
            toolKeys: [],
            initialSchema: {
                jsonSchema: null,
                editMode: "source",
                reason: "坏 profile 需要在源码中修复 InitialSchema。",
                sourceRange: null,
            },
            payloadSchema: {
                jsonSchema: null,
                editMode: "source",
                reason: "坏 profile 需要在源码中修复 PayloadSchema。",
                sourceRange: null,
            },
            outputSchema: {
                jsonSchema: null,
                editMode: "source",
                reason: "坏 profile 需要在源码中修复 OutputSchema。",
                sourceRange: null,
            },
            reportResultSchema: null,
            root: buildSystemPromptRoot(source),
        };
    }
}

/**
 * 保存用户 profile 源码并返回最新源码详情。
 */
export async function saveProfileSource(profiles: AgentProfileCatalog, request: AgentProfileSaveRequestDto, roots: Pick<WorkbenchRoots, "profileRoot">): Promise<AgentProfileDetailDto> {
    const profileRoot = roots.profileRoot;
    const filePath = resolveProfilePath(request.fileName, profileRoot);
    await mkdir(dirname(filePath), {recursive: true});
    await writeFile(filePath, request.source, "utf8");
    await profiles.enqueueBuild({fileName: request.fileName, reason: "profile_source_saved"});
    return readProfileSource(profiles, {fileName: request.fileName}, roots);
}

/**
 * 保存用户 profile 源码并返回轻量草稿解析结果。
 */
export async function saveProfileSourceDraft(request: AgentProfileSaveRequestDto, roots: Pick<WorkbenchRoots, "profileRoot">): Promise<ProfileTemplateDetailDto> {
    const profileRoot = roots.profileRoot;
    const filePath = resolveProfilePath(request.fileName, profileRoot);
    await mkdir(dirname(filePath), {recursive: true});
    await writeFile(filePath, request.source, "utf8");
    return buildProfileSourceDraft(request.fileName, request.source);
}

/**
 * 从模板创建用户 profile。
 */
export async function createProfileSource(profiles: AgentProfileCatalog, request: AgentProfileCreateRequestDto, roots: Pick<WorkbenchRoots, "profileRoot" | "templateRoot">): Promise<AgentProfileDetailDto> {
    const profileRoot = roots.profileRoot;
    const templateRoot = roots.templateRoot;
    const fileName = request.fileName ?? `${request.profileKey}.profile.tsx`;
    const filePath = resolveProfilePath(fileName, profileRoot);
    if (existsSync(filePath)) {
        throw createError({statusCode: 409, statusMessage: "fileName_conflict", message: `profile 文件已存在：${fileName}`});
    }
    const snapshot = await profiles.snapshot();
    if (snapshot.profiles.some((profile) => profile.key === request.profileKey)) {
        throw createError({statusCode: 409, statusMessage: "profileKey_conflict", message: `profileKey 已存在：${request.profileKey}`});
    }
    const template = await readFile(resolveTemplatePath(`${request.templateName}.profile-template.tsx`, templateRoot), "utf8");
    const source = renderTemplate(template, request);
    await mkdir(dirname(filePath), {recursive: true});
    await writeFile(filePath, source, "utf8");
    await profiles.enqueueBuild({fileName, reason: "profile_source_created"});
    return readProfileSource(profiles, {fileName}, roots);
}

/**
 * 从模板创建用户 profile，并返回轻量草稿解析结果。
 */
export async function createProfileSourceDraft(request: AgentProfileCreateRequestDto, roots: Pick<WorkbenchRoots, "profileRoot" | "templateRoot">): Promise<ProfileTemplateDetailDto> {
    const profileRoot = roots.profileRoot;
    const templateRoot = roots.templateRoot;
    const fileName = request.fileName ?? `${request.profileKey}.profile.tsx`;
    const filePath = resolveProfilePath(fileName, profileRoot);
    if (existsSync(filePath)) {
        throw createError({statusCode: 409, statusMessage: "fileName_conflict", message: `profile 文件已存在：${fileName}`});
    }
    const template = await readFile(resolveTemplatePath(`${request.templateName}.profile-template.tsx`, templateRoot), "utf8");
    const source = renderTemplate(template, request);
    await mkdir(dirname(filePath), {recursive: true});
    await writeFile(filePath, source, "utf8");
    return buildProfileSourceDraft(fileName, source);
}

/**
 * 删除用户 profile 文件，用于恢复系统同 key/profile，并触发全量发布移除旧 manifest entry。
 */
export async function deleteProfileSource(profiles: AgentProfileCatalog, request: AgentProfileSourceRequestDto, roots: Pick<WorkbenchRoots, "profileRoot">): Promise<{fileName: string; deleted: boolean}> {
    const filePath = resolveProfilePath(request.fileName, roots.profileRoot);
    if (!existsSync(filePath)) {
        return {fileName: request.fileName, deleted: false};
    }
    await rm(filePath, {force: true});
    await profiles.enqueueBuild({reason: "profile_source_deleted"});
    return {fileName: request.fileName, deleted: true};
}

/**
 * 将用户输入的相对 fileName 解析到用户 profile root 内。
 */
function resolveProfilePath(fileName: string, profileRoot: string): string {
    const normalized = fileName.split(/[\\/]+/).filter(Boolean).join(sep);
    if (!normalized || normalized.startsWith("..") || normalized.includes(`..${sep}`) || /^[A-Za-z]:/.test(fileName) || fileName.startsWith("/") || fileName.startsWith("\\")) {
        throw createError({
            statusCode: 400,
            statusMessage: "invalid_fileName",
            message: "profile fileName 必须是用户 profile root 下的相对路径。",
        });
    }
    if (!/\.profile\.(tsx|ts|mjs|js)$/.test(basename(normalized))) {
        throw createError({
            statusCode: 400,
            statusMessage: "invalid_fileName",
            message: "profile 文件名必须使用 .profile.tsx/.profile.ts/.profile.mjs/.profile.js。",
        });
    }
    const resolved = resolve(profileRoot, normalized);
    const relativePath = relative(profileRoot, resolved);
    if (relativePath.startsWith("..") || relativePath === "" || /^[A-Za-z]:/.test(relativePath)) {
        throw createError({
            statusCode: 400,
            statusMessage: "invalid_fileName",
            message: "profile fileName 超出用户 profile root。",
        });
    }
    return resolved;
}

/**
 * 将源码构造成旧三栏 UI 可消费的轻量 detail。
 */
function buildProfileSourceDraft(fileName: string, source: string): ProfileTemplateDetailDto {
    const manifest = readManifestSummary(source);
    return {
        name: manifest?.key ?? fileName,
        fileName,
        source,
        root: buildSystemPromptRoot(source),
        issues: [],
        variables: [],
    };
}

/**
 * 从常见 profileManifest 字面量中读取展示信息。失败时返回 null，不做 TSX 编译。
 */
function readManifestSummary(source: string): {key: string; name: string} | null {
    const key = source.match(/\bkey\s*:\s*["']([^"']+)["']/)?.[1]?.trim();
    const name = source.match(/\bname\s*:\s*["']([^"']+)["']/)?.[1]?.trim();
    if (!key || !name) {
        return null;
    }
    return {key, name};
}

/**
 * 解析模板路径，只允许系统模板目录下的模板文件。
 */
function resolveTemplatePath(fileName: string, templateRoot: string): string {
    const resolved = resolve(templateRoot, basename(fileName));
    if (!resolved.startsWith(templateRoot)) {
        throw createError({
            statusCode: 400,
            statusMessage: "invalid_template",
            message: "profile 模板路径无效。",
        });
    }
    return resolved;
}

/**
 * 扫描用户 profile 文件。
 */
async function findProfileFiles(root: string, prefix = ""): Promise<string[]> {
    if (!existsSync(root)) {
        return [];
    }
    const result: string[] = [];
    const entries = await readdir(root, {withFileTypes: true});
    for (const entry of entries) {
        const fullPath = join(root, entry.name);
        if (entry.isDirectory()) {
            result.push(...await findProfileFiles(fullPath, prefix ? `${prefix}/${entry.name}` : entry.name));
            continue;
        }
        if (entry.isFile() && /\.profile\.(tsx|ts|mjs|js)$/.test(entry.name)) {
            await stat(fullPath);
            result.push(prefix ? `${prefix}/${entry.name}` : entry.name);
        }
    }
    return result;
}

/**
 * 替换模板中的少量占位符。
 */
function renderTemplate(template: string, request: AgentProfileCreateRequestDto): string {
    return template
        .replaceAll("__PROFILE_KEY__", request.profileKey)
        .replaceAll("__PROFILE_NAME__", request.name)
        .replaceAll("__PROFILE_DESCRIPTION__", request.description ?? "")
        .replaceAll("__SYSTEM_PROMPT__", request.systemPrompt.replace(/`/g, "\\`").replace(/\$\{/g, "\\${"));
}

function templateLabel(fileName: string): string {
    return fileName.startsWith("report-agent") ? "Report Agent" : "Basic Agent";
}

function templateDescription(fileName: string): string {
    return fileName.startsWith("report-agent")
        ? "通用报告模式：允许 report_result，只提交 result。"
        : "普通自定义 Agent：默认只提供读取能力。";
}
