import fs from "node:fs/promises";
import path from "node:path";
import {Command} from "commander";
import {
    workspaceContentJsonSchema,
    WORKSPACE_CONTENT_STATUSES,
    WORKSPACE_CONTENT_TYPES,
    WORKSPACE_STATUS_DESCRIPTIONS,
    type WorkspaceContentStatus,
    type WorkspaceContentType,
} from "nbook/server/workspace-files/content-node-schema";
import {renderWorkspaceContentTemplateBundle, renderWorkspaceStateTemplate} from "nbook/server/workspace-files/content-node-templates";
import {
    createWorkspaceContentState,
    createWorkspaceDirectory,
    parseMarkdownDocument,
    renderMarkdownDocument,
    resolveWorkspacePath,
    statWorkspacePath,
    toWorkspaceDisplayPath,
    type WorkspaceFileIssue,
    validateWorkspaceContentNodes,
} from "nbook/server/workspace-files/workspace-files";
import {
    decodeBookText,
    splitBookChapters,
    type ChapterPatternDescription,
    type ChapterSplitMode,
    type ChapterSplitPoints,
} from "nbook/server/workspace-files/book-chapter-splitting";
import {
    isProjectInUseError,
    isProjectLockReleaseFailedError,
} from "nbook/server/workspace-files/project-lock";
import {
    isProjectLifecycleError,
    isProjectLifecycleTransactionError,
    ProjectLifecycle,
    ProjectLifecycleTransactionError,
    projectWorkspaceRef,
    type ProjectListEntry,
    type ProjectLifecycleDiagnostics,
    type ProjectValidationResult,
} from "nbook/server/workspace-files/project-lifecycle";
import type {ProjectManifest, ProjectManifestIssue} from "nbook/server/workspace-files/project-lifecycle-manifest";
import {
    absoluteFsPath,
    assertRealPathContained,
    relativeFilePathInside,
    relativeRealPathInside,
    type AbsoluteFsPath,
} from "nbook/server/runtime/paths/file-path";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";

type WorkspaceNodeNewOptions = {
    title?: string;
    status: string;
    type: string;
    state: boolean;
};

type WorkspaceNodeParseOptions = {
    stdin: boolean;
    null: boolean;
    json: boolean;
    ndjson: boolean;
    body: boolean;
    absolute: boolean;
};

type WorkspaceNodeValidateOptions = {
    stdin: boolean;
    null: boolean;
    json: boolean;
    recursive: boolean;
    fixMissing: boolean;
};

type WorkspaceNodeImportBookOptions = {
    volume?: string;
    chaptersPerVolume: string;
    singleVolume: boolean;
    splitPattern?: string;
    patternJson?: string;
    splitPoints?: string;
    apply: boolean;
    force: boolean;
    json: boolean;
};

type WorkspaceNodeSetSummaryOptions = {
    stdin: boolean;
    null: boolean;
    summary: string;
    json: boolean;
};

type SetSummaryInput = {
    path: string;
    summary: string;
};

type WorkspaceSchemaOptions = {
    json: boolean;
};

type WorkspaceProjectOptions = {
    title?: string;
    summary?: string;
    template?: string;
    json: boolean;
};

type ResolvedWorkspaceTarget = {
    root: string;
    relativePath: string;
};

type ProjectCliSuccess = {
    readonly schemaVersion: typeof PROJECT_CLI_SCHEMA;
    readonly ok: true;
    readonly project: ProjectListEntry | ProjectValidationProject;
    readonly actions: readonly string[];
    readonly diagnostics: ProjectLifecycleDiagnostics;
};

type ProjectValidationProject = {
    readonly projectRoot: string;
    readonly status: ProjectValidationResult["status"];
    readonly manifest?: ProjectManifest;
    readonly proposedManifest?: ProjectManifest;
    readonly issues: readonly ProjectManifestIssue[];
};

type ProjectCliFailure = {
    readonly schemaVersion: typeof PROJECT_CLI_SCHEMA;
    readonly ok: false;
    readonly error: {
        readonly code: string;
        readonly message: string;
        readonly operation?: string;
        readonly phase?: string;
        readonly committed?: boolean | "unknown";
    };
};

type ParsedContentNode = {
    path: string;
    indexPath: string;
    statePath: string | null;
    type: string | null;
    status: string | null;
    title: string;
    summary: string;
    words: number;
    refs: string[];
    frontmatter: Record<string, unknown>;
    frontmatterError: string | null;
    state: {
        path: string;
        frontmatter: Record<string, unknown>;
        frontmatterError: string | null;
        words: number;
    } | null;
    body?: string;
    absolutePath?: string;
    absoluteIndexPath?: string;
    absoluteStatePath?: string | null;
};

const program = new Command();
const INVOCATION_CWD = process.cwd();
const PROJECT_CLI_SCHEMA = "nbook.workspace-cli/v1" as const;
const IMPORT_BOOK_SCHEMA = "nbook.import-book/v1" as const;
const DEFAULT_TEMPLATE_NAME = "default" as const;

program
    .name("workspace")
    .description("工作区内容节点脚手架、解析、校验与 schema 查看工具");

const nodeCommand = program
    .command("node")
    .description("处理 lorebook/manuscript 标准内容节点");

const projectCommand = program
    .command("project")
    .description("创建和维护 Project Workspace");

projectCommand
    .command("create")
    .description("只向不存在的一级 Project Workspace 物化模板")
    .argument("<projectRoot>", "Workspace Root 下的单段 Project root，例如 my-novel")
    .option("--title <title>", "project.yaml title，默认从目录名推断")
    .option("--summary <summary>", "project.yaml summary", "")
    .option("--template <template>", "模板名，默认 default", DEFAULT_TEMPLATE_NAME)
    .option("--json", "输出 JSON", false)
    .action(async (projectRoot: string, options: WorkspaceProjectOptions) => {
        try {
            const {result, diagnostics} = await withProjectLifecycle(async (lifecycle) => await lifecycle.create({
                ref: projectWorkspaceRef(projectRoot),
                title: options.title?.trim() || inferProjectTitle(projectRoot),
                summary: options.summary?.trim() ?? "",
                template: normalizeProjectTemplateName(options.template),
            }));
            emitProjectSuccess(result.project, ["created"], diagnostics, options.json);
        } catch (error) {
            emitProjectFailure(error, options.json);
        }
    });

projectCommand
    .command("ensure")
    .description("幂等创建或修复一级 Project Workspace 的最小 manifest")
    .argument("<projectRoot>", "Workspace Root 下的单段 Project root")
    .option("--title <title>", "仅在提供时更新 project.yaml title")
    .option("--summary <summary>", "仅在提供时更新 project.yaml summary")
    .option("--json", "输出 JSON", false)
    .action(async (projectRoot: string, options: WorkspaceProjectOptions) => {
        try {
            const {result, diagnostics} = await withProjectLifecycle(async (lifecycle) => {
                const ensured = await lifecycle.ensure(projectWorkspaceRef(projectRoot));
                if (options.title !== undefined || options.summary !== undefined) {
                    return await lifecycle.updateMetadata({
                        ref: projectWorkspaceRef(projectRoot),
                        title: options.title,
                        summary: options.summary,
                    });
                }
                return ensured;
            });
            const actions = "change" in result && result.change !== "none" ? [result.change] : [];
            emitProjectSuccess(result.project, actions, diagnostics, options.json);
        } catch (error) {
            emitProjectFailure(error, options.json);
        }
    });

projectCommand
    .command("validate")
    .description("只读校验指定一级 Project Workspace 的 project.yaml")
    .argument("<projectRoot>", "Workspace Root 下的单段 Project root")
    .option("--json", "输出 JSON", false)
    .action(async (projectRoot: string, options: WorkspaceProjectOptions) => {
        try {
            const {result, diagnostics} = await withProjectLifecycle(async (lifecycle) => await lifecycle.validate(projectWorkspaceRef(projectRoot)));
            const project: ProjectValidationProject = result.status === "valid"
                ? {projectRoot: result.projectRoot, status: result.status, manifest: result.manifest, issues: result.issues}
                : {projectRoot: result.projectRoot, status: result.status, proposedManifest: result.proposedManifest, issues: result.issues};
            emitProjectSuccess(project, [result.status], diagnostics, options.json);
        } catch (error) {
            emitProjectFailure(error, options.json);
        }
    });

nodeCommand
    .command("new")
    .description("创建标准内容节点目录并写入 index.md")
    .argument("<target>", "要创建的内容节点目录")
    .requiredOption("--type <type>", "frontmatter type")
    .option("--title <title>", "frontmatter title")
    .option("--status <status>", "frontmatter status", "draft")
    .option("--state", "同时创建 state.md", false)
    .action(async (target: string, options: WorkspaceNodeNewOptions) => {
        try {
            assertValidContentType(options.type);
            assertValidStatus(options.status);
            const resolvedTarget = await resolveSingleWorkspaceTarget(target);
            const content = renderWorkspaceContentTemplateBundle({
                title: options.title?.trim() || inferTitle(resolvedTarget.relativePath),
                type: options.type,
                status: options.status,
            }, options.state);
            const node = await createWorkspaceDirectory({
                root: resolvedTarget.root,
                dirPath: resolvedTarget.relativePath,
                indexContent: content.indexContent,
                stateContent: content.stateContent,
            });

            console.log(node.path);
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
        }
    });

nodeCommand
    .command("state")
    .description("给已有内容节点创建 state.md")
    .argument("<target>", "内容节点目录或 index.md")
    .action(async (target: string) => {
        try {
            const resolvedTarget = await resolveSingleWorkspaceTarget(target);
            const node = await statWorkspacePath(resolvedTarget.root, resolvedTarget.relativePath);
            if (!node.isDirectory || !node.contentNode) {
                throw new Error(`目标不是标准内容节点目录: ${node.path}`);
            }
            const nodeType = node.entryType ?? "";
            assertValidContentType(nodeType);
            const stateContent = renderWorkspaceStateTemplate({
                title: node.title || inferTitle(node.path),
                type: nodeType,
                status: readTemplateStatus(node.status),
            });
            const nextNode = await createWorkspaceContentState({
                root: resolvedTarget.root,
                dirPath: resolvedTarget.relativePath,
                stateContent,
            });

            console.log(nextNode.state?.path ?? path.posix.join(nextNode.path.replace(/\/$/, ""), "state.md"));
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
        }
    });

nodeCommand
    .command("parse")
    .description("解析指定内容节点")
    .argument("[targets...]", "内容节点目录或 index.md")
    .option("--stdin", "从 stdin 读取路径列表", false)
    .option("-0, --null", "stdin 使用 NUL 分隔", false)
    .option("--json", "输出 JSON 数组", false)
    .option("--ndjson", "每个节点输出一行 JSON", false)
    .option("--body", "JSON/NDJSON 中包含正文 body", false)
    .option("--absolute", "JSON/NDJSON 中额外输出绝对路径字段", false)
    .action(async (targets: string[], options: WorkspaceNodeParseOptions) => {
        try {
            assertCompatibleOutputOptions(options);
            const inputTargets = await collectInputTargets(targets, options);
            const resolvedTargets = await resolveWorkspaceTargets(inputTargets);
            const nodes = await Promise.all(resolvedTargets.map((target) => parseContentNode(target, options)));

            if (options.json) {
                console.log(JSON.stringify(nodes, null, 2));
                return;
            }
            if (options.ndjson) {
                for (const node of nodes) {
                    console.log(JSON.stringify(node));
                }
                return;
            }
            printParsedContentNodes(nodes);
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
        }
    });

nodeCommand
    .command("validate")
    .description("校验指定内容节点")
    .argument("[targets...]", "内容节点目录或 index.md")
    .option("--stdin", "从 stdin 读取路径列表", false)
    .option("-0, --null", "stdin 使用 NUL 分隔", false)
    .option("--json", "输出 JSON", false)
    .option("--recursive", "递归校验目标目录下的内容节点", false)
    .option("--fix-missing", "校验时写回缺失的标准 frontmatter 字段", false)
    .action(async (targets: string[], options: WorkspaceNodeValidateOptions) => {
        try {
            const inputTargets = await collectInputTargets(targets, options);
            const resolvedTargets = await resolveWorkspaceTargets(inputTargets);
            const root = assertSingleWorkspaceRoot(resolvedTargets);
            const result = await validateWorkspaceContentNodes({
                root,
                targets: resolvedTargets.map((target) => target.relativePath),
                recursive: options.recursive,
                fixMissing: options.fixMissing,
            });

            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                printIssues(result.issues);
                printFixedPaths(result.fixedPaths);
            }

            if (result.issues.some((issue) => issue.level === "P1" || issue.level === "P2")) {
                process.exitCode = 1;
            }
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
        }
    });

nodeCommand
    .command("import-book")
    .description("导入整本书到 manuscript：切章（模式库/AI 描述/逃生口）→ dry-run 统计 → 确认后落盘")
    .argument("<source>", "书稿来源：单个 .txt/.md 文件，或含 full.md 的番茄导入目录，或一堆按顺序命名的 .md/.txt 文件目录")
    .option("--volume <dir>", "目标卷目录名（相对 Project Workspace），默认按分卷规则自动生成", "")
    .option("--chapters-per-volume <n>", "每卷章数，默认 100", "100")
    .option("--single-volume", "全部章节放进一个卷", false)
    .option("--split-pattern <regex>", "手工指定章节标记正则（逃生口，行首匹配）", "")
    .option("--pattern-json <json>", "AI 章节标记描述（结构化），由切章 workflow 生成", "")
    .option("--split-points <json>", "AI 给出的每章起始行号", "")
    .option("--apply", "确认落盘（默认只输出 dry-run 统计，不写文件）", false)
    .option("--force", "覆盖已存在的章节文件", false)
    .option("--json", "输出 JSON", false)
    .action(async (source: string, options: WorkspaceNodeImportBookOptions) => {
        try {
            const root = await resolveWorkspaceContentRoot();
            const sourcePath = resolveImportBookSource(root, source);
            const buffer = await readImportBookSource(sourcePath);            const {text, encoding} = decodeBookText(buffer);

            const splitPattern = options.splitPattern?.trim() || "";
            const patternDescription = parseOptionalJson<ChapterPatternDescription>(options.patternJson, "pattern-json");
            const splitPoints = parseOptionalJson<ChapterSplitPoints>(options.splitPoints, "split-points");
            const regex = splitPattern ? new RegExp(splitPattern) : undefined;
            const split = splitBookChapters({text, regex, pattern: patternDescription, splitPoints});

            const volumePlan = planVolumes(split.parts.length, options);
            if (options.json) {
                console.log(JSON.stringify({
                    schemaVersion: IMPORT_BOOK_SCHEMA,
                    ok: true,
                    applied: false,
                    source: sourcePath.displayPath,
                    encoding,
                    mode: split.stats.mode,
                    patternKey: split.stats.patternKey,
                    confidence: split.stats.confidence,
                    total: split.stats.total,
                    distribution: split.stats.distribution,
                    anomalies: split.stats.anomalies,
                    volumePlan,
                    previews: split.parts.slice(0, 40).map((part) => ({index: part.index, heading: part.heading, words: part.words})),
                    hint: split.stats.confidence === "low"
                        ? "切章置信度低：建议检查 dry-run 统计，必要时用 --split-pattern / --pattern-json / --split-points 重新切分"
                        : "",
                }, null, 2));
                return;
            }
            printImportBookPreview(split.stats, volumePlan);

            if (!options.apply) {
                console.log("这是 dry-run 预览，未写入任何文件。确认无误后加 --apply 落盘。");
                return;
            }
            const written = await applyImportBook(root, split.parts, volumePlan, options.force);
            console.log(`已导入 ${written.length} 章${written.length > 0 ? `：${written.join("、")}` : ""}`);
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
        }
    });

nodeCommand
    .command("set-summary")
    .description("批量写回内容节点 frontmatter.summary；单章用 --summary，批量用 --stdin JSON Lines")
    .argument("[targets...]", "内容节点目录或 index.md；与 --stdin 二选一")
    .option("--stdin", "从 stdin 读取 JSON Lines：每行 {path, summary}", false)
    .option("-0, --null", "stdin 使用 NUL 分隔", false)
    .option("--summary <text>", "单章模式：要写回的摘要（与 targets 配合）", "")
    .option("--json", "输出 JSON", false)
    .action(async (targets: string[], options: WorkspaceNodeSetSummaryOptions) => {
        try {
            const inputs = await collectSetSummaryInputs(targets, options);
            const resolvedTargets = await resolveWorkspaceTargets(inputs.map((input) => input.path));
            const root = assertSingleWorkspaceRoot(resolvedTargets);
            const summaryByPath = new Map(resolvedTargets.map((target, index) => [target.relativePath, inputs[index]?.summary ?? ""]));

            const updated: {path: string; summary: string}[] = [];
            for (const target of resolvedTargets) {
                const summary = summaryByPath.get(target.relativePath);
                if (summary === undefined) {
                    continue;
                }
                const next = await setContentSummary(root, target.relativePath, summary);
                updated.push(next);
            }

            if (options.json) {
                console.log(JSON.stringify(updated, null, 2));
                return;
            }
            if (updated.length === 0) {
                console.log("没有需要更新的内容节点");
                return;
            }
            for (const item of updated) {
                console.log(`${item.path}\t${formatTextField(item.summary)}`);
            }
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
        }
    });

nodeCommand
    .command("schema")
    .description("查看内容节点 frontmatter schema")
    .argument("[type]", "内容节点类型，例如 character")
    .option("--json", "输出 JSON", false)
    .action((type: string | undefined, options: WorkspaceSchemaOptions) => {
        const schema = workspaceContentJsonSchema(type);
        if (options.json) {
            console.log(JSON.stringify(schema, null, 2));
            return;
        }

        console.log(renderSchemaMarkdown(type, schema));
    });

await program.parseAsync(process.argv);

/**
 * 校验 status 参数，避免脚手架生成旧状态。
 */
function assertValidStatus(status: string): asserts status is WorkspaceContentStatus {
    if (!WORKSPACE_CONTENT_STATUSES.includes(status as WorkspaceContentStatus)) {
        throw new Error(`status 必须是 ${WORKSPACE_CONTENT_STATUSES.join("、")}`);
    }
}

/**
 * 读取用于渲染模板的 status；旧节点缺失或非法时回退为 draft。
 */
function readTemplateStatus(status: string | null): WorkspaceContentStatus {
    if (WORKSPACE_CONTENT_STATUSES.includes(status as WorkspaceContentStatus)) {
        return status as WorkspaceContentStatus;
    }
    return "draft";
}

/**
 * 校验内容节点类型参数。
 */
function assertValidContentType(type: string): asserts type is WorkspaceContentType {
    if (!WORKSPACE_CONTENT_TYPES.includes(type as WorkspaceContentType)) {
        throw new Error(`type 必须是 ${WORKSPACE_CONTENT_TYPES.join("、")}`);
    }
}

/**
 * 校验输出参数组合，避免管道输出不可解析。
 */
function assertCompatibleOutputOptions(options: WorkspaceNodeParseOptions): void {
    if (options.json && options.ndjson) {
        throw new Error("--json 与 --ndjson 不能同时使用");
    }
    if (options.body && !options.json && !options.ndjson) {
        throw new Error("--body 只能与 --json 或 --ndjson 一起使用");
    }
    if (options.absolute && !options.json && !options.ndjson) {
        throw new Error("--absolute 只能与 --json 或 --ndjson 一起使用");
    }
}

/**
 * 合并命令行路径与 stdin 路径。
 */
async function collectInputTargets(
    targets: string[],
    options: {stdin: boolean; null: boolean},
): Promise<string[]> {
    const stdinTargets = options.stdin
        ? splitStdinTargets(await readStdinText(), options.null)
        : [];
    const inputTargets = [...targets, ...stdinTargets]
        .map((target) => target.trim())
        .filter(Boolean);

    if (inputTargets.length === 0) {
        throw new Error("至少需要提供一个内容节点路径");
    }
    return inputTargets;
}

/**
 * 读取标准输入文本。
 */
async function readStdinText(): Promise<string> {
    process.stdin.setEncoding("utf-8");
    let text = "";
    for await (const chunk of process.stdin) {
        text += String(chunk);
    }
    return text;
}

/**
 * 按普通换行或 NUL 分隔 stdin 路径。
 */
function splitStdinTargets(text: string, nullSeparated: boolean): string[] {
    return text
        .split(nullSeparated ? "\0" : /\r?\n/)
        .map((target) => target.trim())
        .filter(Boolean);
}

/**
 * 解析多个输入目标，并确认它们属于同一个 workspace。
 */
async function resolveWorkspaceTargets(targets: string[]): Promise<ResolvedWorkspaceTarget[]> {
    const resolvedTargets = await Promise.all(targets.map((target) => resolveSingleWorkspaceTarget(target)));
    assertSingleWorkspaceRoot(resolvedTargets);
    return uniqueResolvedTargets(resolvedTargets);
}

/**
 * 解析单个输入路径到 workspace root 与内容节点目录相对路径。
 */
async function resolveSingleWorkspaceTarget(target: string): Promise<ResolvedWorkspaceTarget> {
    const root = await resolveWorkspaceContentRoot();
    const absoluteTarget = resolveWorkspaceCliTarget(root, target);
    const contentDirectoryPath = normalizeContentNodeDirectoryPath(root, absoluteTarget);
    return {
        root,
        relativePath: toWorkspaceDisplayPath(root, contentDirectoryPath, true).replace(/\/$/, "") || ".",
    };
}

/**
 * 相对输入固定从本次内容File Scope解析；绝对输入不得越过该内容根。
 */
function resolveWorkspaceCliTarget(root: ReturnType<typeof resolveWorkspaceContainerRoot>, target: string): string {
    const value = target.trim();
    if (!value) {
        throw new Error("内容节点路径不能为空");
    }
    const absoluteTarget = absoluteFsPath(path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value));
    if (relativeFilePathInside(root, absoluteTarget) === null) {
        throw new Error(`绝对内容节点路径不属于当前 Workspace Root：${value}`);
    }
    return absoluteTarget;
}

/** 在一次CLI调用内独占一个Lifecycle，并在输出前捕获可序列化diagnostics。 */
async function withProjectLifecycle<T>(task: (lifecycle: ProjectLifecycle) => Promise<T>): Promise<{result: T; diagnostics: ProjectLifecycleDiagnostics}> {
    const lifecycle = new ProjectLifecycle(resolveWorkspaceContainerRoot());
    try {
        const result = await task(lifecycle);
        const diagnostics = lifecycle.diagnostics;
        return {result, diagnostics};
    } finally {
        await lifecycle.close();
    }
}

/** 把公开模板名收窄为Lifecycle稳定的模板合同。 */
function normalizeProjectTemplateName(template: string | undefined): "default" {
    const value = template?.trim() || DEFAULT_TEMPLATE_NAME;
    if (value === "default" || value === "project-directory-templates") {
        return "default";
    }
    throw new ProjectLifecycleTransactionError(
        "PROJECT_TEMPLATE_FAILED",
        "create",
        "validate",
        false,
        `未知 Project 模板：${value}`,
    );
}

/** 统一输出Project JSON协议；非JSON调用只输出面向人的一行结果。 */
function emitProjectSuccess(
    project: ProjectListEntry | ProjectValidationProject,
    actions: readonly string[],
    diagnostics: ProjectLifecycleDiagnostics,
    json: boolean,
): void {
    if (json) {
        const payload: ProjectCliSuccess = {
            schemaVersion: PROJECT_CLI_SCHEMA,
            ok: true,
            project,
            actions,
            diagnostics,
        };
        console.log(JSON.stringify(payload, null, 2));
        return;
    }
    const projectRoot = project.projectRoot;
    console.log(`${projectRoot}: ${actions.length > 0 ? actions.join(", ") : "ok"}`);
}

/** 将Lifecycle/lock失败投影为稳定JSON错误，并把诊断写入stderr。 */
function emitProjectFailure(error: unknown, json: boolean): void {
    const detail = projectCliError(error);
    if (json) {
        const payload: ProjectCliFailure = {
            schemaVersion: PROJECT_CLI_SCHEMA,
            ok: false,
            error: detail,
        };
        console.log(JSON.stringify(payload, null, 2));
    }
    console.error(detail.message);
    process.exitCode = 1;
}

/** 从领域错误读取typed code；未知错误不伪装成可重试的Lifecycle code。 */
function projectCliError(error: unknown): ProjectCliFailure["error"] {
    if (isProjectLifecycleTransactionError(error)) {
        return {
            code: error.code,
            message: error.message,
            operation: error.operation,
            phase: error.phase,
            committed: error.committed,
        };
    }
    if (isProjectLifecycleError(error) || isProjectInUseError(error) || isProjectLockReleaseFailedError(error)) {
        return {code: error.code, message: error.message};
    }
    return {
        code: "PROJECT_CLI_FAILED",
        message: error instanceof Error ? error.message : String(error),
    };
}

/** Project生命周期操作使用Runtime Workspace Root，而不是调用方cwd或Project祖先。 */
function resolveWorkspaceContainerRoot() {
    return resolveRuntimeWorkspaceRoot(INVOCATION_CWD);
}

/**
 * 内容节点命令跟随调用方File Scope。
 *
 * Workspace Root中的调用继续使用整个容器；从一级受管Project Workspace或其子目录
 * 调用时，内容路径改从该Project Workspace解析。Project生命周期命令不消费此函数。
 */
async function resolveWorkspaceContentRoot(): Promise<AbsoluteFsPath> {
    const workspaceRoot = resolveWorkspaceContainerRoot();
    const invocationRoot = absoluteFsPath(path.resolve(INVOCATION_CWD));
    const relativeInvocation = await relativeRealPathInside(workspaceRoot, invocationRoot);
    if (!relativeInvocation || relativeInvocation === ".") {
        return workspaceRoot;
    }

    const [projectRootName] = relativeInvocation.split("/");
    if (!projectRootName) {
        return workspaceRoot;
    }
    const projectRoot = absoluteFsPath(path.join(workspaceRoot, projectRootName));
    const manifestPath = path.join(projectRoot, "project.yaml");
    try {
        const [projectStat, manifestStat] = await Promise.all([
            fs.lstat(projectRoot),
            fs.lstat(manifestPath),
        ]);
        if (!projectStat.isDirectory() || projectStat.isSymbolicLink()
            || !manifestStat.isFile() || manifestStat.isSymbolicLink()) {
            return workspaceRoot;
        }
        await assertRealPathContained(workspaceRoot, projectRoot);
        return projectRoot;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return workspaceRoot;
        }
        throw error;
    }
}

/**
 * 将目录或 index.md 输入统一成内容节点目录绝对路径。
 */
function normalizeContentNodeDirectoryPath(root: string, absoluteTarget: string): string {
    const safeTarget = resolveWorkspacePath(root, absoluteTarget);
    if (path.basename(safeTarget).toLowerCase() === "index.md") {
        return path.dirname(safeTarget);
    }
    return safeTarget;
}

/**
 * 确认所有目标都属于同一个 workspace，并返回该 root。
 */
function assertSingleWorkspaceRoot(targets: ResolvedWorkspaceTarget[]): string {
    const root = targets[0]?.root;
    if (!root) {
        throw new Error("至少需要提供一个内容节点路径");
    }
    const mixedTarget = targets.find((target) => target.root !== root);
    if (mixedTarget) {
        throw new Error(`一次命令只能处理一个 workspace：${root} 与 ${mixedTarget.root}`);
    }
    return root;
}

/**
 * 去重输入路径，避免管道重复输出同一节点。
 */
function uniqueResolvedTargets(targets: ResolvedWorkspaceTarget[]): ResolvedWorkspaceTarget[] {
    const seen = new Set<string>();
    const result: ResolvedWorkspaceTarget[] = [];
    for (const target of targets) {
        const key = `${target.root}:${target.relativePath}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(target);
    }
    return result;
}

/**
 * 解析标准内容节点，默认不输出正文和绝对路径。
 */
async function parseContentNode(
    target: ResolvedWorkspaceTarget,
    options: Pick<WorkspaceNodeParseOptions, "body" | "absolute">,
): Promise<ParsedContentNode> {
    const node = await statWorkspacePath(target.root, target.relativePath);
    if (!node.isDirectory || !node.contentNode) {
        throw new Error(`目标不是标准内容节点目录: ${node.path}`);
    }

    const absoluteIndexPath = path.join(node.absolutePath, "index.md");
    const content = await fs.readFile(absoluteIndexPath, "utf-8");
    const parsed = parseMarkdownDocument(content);
    return {
        path: node.path,
        indexPath: toWorkspaceDisplayPath(target.root, absoluteIndexPath),
        statePath: node.state?.path ?? null,
        type: node.entryType,
        status: node.status,
        title: node.title,
        summary: node.summary,
        words: node.words,
        refs: node.refs,
        frontmatter: node.frontmatter,
        frontmatterError: node.frontmatterError,
        state: node.state ? {
            path: node.state.path,
            frontmatter: node.state.frontmatter,
            frontmatterError: node.state.frontmatterError,
            words: node.state.words,
        } : null,
        ...(options.body ? {body: parsed.body} : {}),
        ...(options.absolute ? {absolutePath: node.absolutePath, absoluteIndexPath, absoluteStatePath: node.state?.absolutePath ?? null} : {}),
    };
}

/**
 * 打印适合管道查看的内容节点摘要。
 */
function printParsedContentNodes(nodes: ParsedContentNode[]): void {
    for (const node of nodes) {
        console.log([
            node.path,
            node.type ?? "-",
            node.status ?? "-",
            String(node.words),
            String(node.refs.length),
            node.state ? "state" : "-",
            formatTextField(node.title),
        ].join("\t"));
    }
}

/**
 * 让文本表格字段保持单行。
 */
function formatTextField(value: string): string {
    return value.replace(/[\t\r\n]+/g, " ").trim();
}

/**
 * 从路径推断标题。
 */
function inferTitle(target: string): string {
    const normalizedTarget = target.endsWith("/index.md")
        ? target.slice(0, -"/index.md".length)
        : target.replace(/\.(?:md|txt)$/i, "");
    const parts = normalizedTarget.split(/[\\/]/).filter(Boolean);
    const baseName = parts.at(-1) ?? "未命名";
    return baseName.replace(/^\d+[-_.\s]+/, "");
}

/**
 * 从 Project 目录名推断展示标题。
 */
function inferProjectTitle(projectSlug: string): string {
    return projectSlug
        .replace(/[-_]+/g, " ")
        .replace(/\s+/g, " ")
        .trim() || "未命名小说";
}

/**
 * 打印校验结果。
 */
function printIssues(issues: WorkspaceFileIssue[]): void {
    if (issues.length === 0) {
        console.log("OK");
        return;
    }

    console.log(formatIssueSummary(issues));
    for (const [filePath, fileIssues] of groupIssuesByPath(issues)) {
        console.log(filePath);
        for (const line of formatIssueLines(fileIssues)) {
            console.log(`  ${line}`);
        }
    }
}

/**
 * 打印自动修复的文件路径。
 */
function printFixedPaths(paths: string[]): void {
    if (paths.length === 0) {
        return;
    }

    console.log("Fixed:");
    for (const fixedPath of paths) {
        console.log(`- ${fixedPath}`);
    }
}

/**
 * 按严重级别生成简短汇总。
 */
function formatIssueSummary(issues: WorkspaceFileIssue[]): string {
    const counts = new Map<string, number>();
    for (const issue of issues) {
        counts.set(issue.level, (counts.get(issue.level) ?? 0) + 1);
    }
    return ["P1", "P2", "P3", "WARN"]
        .map((level) => `${level}:${String(counts.get(level) ?? 0)}`)
        .join(" ");
}

/**
 * 按文件路径分组并排序校验结果。
 */
function groupIssuesByPath(issues: WorkspaceFileIssue[]): Map<string, WorkspaceFileIssue[]> {
    const grouped = new Map<string, WorkspaceFileIssue[]>();
    const sortedIssues = [...issues].sort((left, right) => {
        const pathOrder = left.path.localeCompare(right.path, "zh-Hans-CN");
        if (pathOrder !== 0) {
            return pathOrder;
        }
        return issuePriority(left.level) - issuePriority(right.level);
    });

    for (const issue of sortedIssues) {
        const fileIssues = grouped.get(issue.path) ?? [];
        fileIssues.push(issue);
        grouped.set(issue.path, fileIssues);
    }
    return grouped;
}

/**
 * 将同一文件下的 issue 格式化为紧凑行。
 */
function formatIssueLines(issues: WorkspaceFileIssue[]): string[] {
    const lines: string[] = [];
    const missingFields = issues
        .filter((issue) => issue.code === "missing-frontmatter-field")
        .map((issue) => readFrontmatterFieldFromMessage(issue.message))
        .filter((field): field is string => Boolean(field));

    if (missingFields.length > 0) {
        lines.push(`P2 missing-frontmatter-field x${String(missingFields.length)} - 缺失: ${missingFields.join(", ")}`);
    }

    for (const issue of issues) {
        if (issue.code === "missing-frontmatter-field") {
            continue;
        }
        const lineLabel = issue.line === undefined ? "" : `:${String(issue.line)}`;
        lines.push(`${issue.level} ${issue.code}${lineLabel} - ${issue.message}`);
    }
    return lines;
}

/**
 * 从缺失字段消息中提取 frontmatter 字段路径。
 */
function readFrontmatterFieldFromMessage(message: string): string | null {
    const match = message.match(/^frontmatter\.([^\s]+)\s/);
    return match?.[1] ?? null;
}

/**
 * 将 P1/P2/P3 映射成排序权重。
 */
function issuePriority(level: WorkspaceFileIssue["level"]): number {
    return level === "P1" ? 1 : level === "P2" ? 2 : level === "P3" ? 3 : 4;
}

/**
 * 将 Zod 自动生成的 JSON schema 输出为适合终端阅读的 Markdown。
 */
function renderSchemaMarkdown(type: string | undefined, schema: Record<string, unknown>): string {
    const statuses = WORKSPACE_CONTENT_STATUSES
        .map((status) => `- \`${status}\`：${WORKSPACE_STATUS_DESCRIPTIONS[status]}`)
        .join("\n");
    const fields = Object.entries(readSchemaProperties(schema))
        .map(([name, field]) => `- \`${name}\` (${readSchemaType(field)})：${readSchemaDescription(field)}`)
        .join("\n");

    return [
        `# Workspace Content Schema: ${type?.trim() || "common"}`,
        "",
        "## Status",
        statuses,
        "",
        "## Fields",
        fields,
        "",
        "## Refs",
        "- `refs[].target` 与 inline Markdown link 都使用相对路径。",
        "- 内容节点 target 指向目录并带 `/`，普通文件 target 指向具体文件名。",
    ].join("\n");
}

/**
 * 读取 JSON schema 顶层属性。
 */
function readSchemaProperties(schema: Record<string, unknown>): Record<string, Record<string, unknown>> {
    const properties = schema.properties;
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
        return {};
    }
    return properties as Record<string, Record<string, unknown>>;
}

/**
 * 从 JSON schema 字段里读取类型。
 */
function readSchemaType(field: Record<string, unknown>): string {
    if (Array.isArray(field.type)) {
        return field.type.join(" | ");
    }
    if (Array.isArray(field.anyOf)) {
        return field.anyOf
            .map((item) => typeof item === "object" && item !== null && "type" in item ? String(item.type) : "unknown")
            .join(" | ");
    }
    if (typeof field.type === "string") {
        return field.type;
    }
    if (Array.isArray(field.enum)) {
        return field.enum.map(String).join(" | ");
    }
    if (field.properties) {
        return "object";
    }
    return "unknown";
}

/**
 * 从 JSON schema 字段里读取描述。
 */
function readSchemaDescription(field: Record<string, unknown>): string {
    return typeof field.description === "string" ? field.description : "";
}

/**
 * import-book 的 source 解析：目录或文件；目录优先读 full.md，否则按文件名顺序拼接正文文件。
 * 返回绝对路径（供读取）与展示路径（供输出）。
 */
function resolveImportBookSource(root: string, source: string): {absolutePath: string; displayPath: string} {
    const value = source.trim();
    if (!value) {
        throw new Error("书稿来源不能为空");
    }
    const absolute = absoluteFsPath(path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value));
    const relative = relativeFilePathInside(root, absolute);
    return {
        absolutePath: absolute,
        displayPath: relative !== null ? toWorkspaceDisplayPath(root, absolute) : absolute,
    };
}

/**
 * 读取书稿内容：单文件直接读；目录先尝试 full.md，否则按名称排序拼接正文文件。
 */
async function readImportBookSource(source: {absolutePath: string}): Promise<Buffer> {
    const stat = await fs.stat(source.absolutePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
            throw new Error(`书稿来源不存在：${source.absolutePath}`);
        }
        throw error;
    });
    if (stat.isFile()) {
        return await fs.readFile(source.absolutePath);
    }
    if (!stat.isDirectory()) {
        throw new Error(`书稿来源既不是文件也不是目录：${source.absolutePath}`);
    }
    const fullPath = path.join(source.absolutePath, "full.md");
    try {
        return await fs.readFile(fullPath);
    } catch (error) {
        if (typeof error !== "object" || error === null || (error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
        }
    }
    const entries = await fs.readdir(source.absolutePath, {withFileTypes: true});
    const bookFiles = entries
        .filter((entry) => entry.isFile() && /\.(?:md|txt)$/iu.test(entry.name))
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
    if (bookFiles.length === 0) {
        throw new Error(`书稿目录中没有可读的 .md/.txt 文件（也没有 full.md）：${source.absolutePath}`);
    }
    const parts = await Promise.all(bookFiles.map((name) => fs.readFile(path.join(source.absolutePath, name))));
    return Buffer.concat(parts);
}

/**
 * 解析可选的 JSON 参数；空串返回 undefined，非法 JSON 直接报错。
 */
function parseOptionalJson<T>(value: string | undefined, optionName: string): T | undefined {
    const trimmed = value?.trim() || "";
    if (!trimmed) {
        return undefined;
    }
    try {
        return JSON.parse(trimmed) as T;
    } catch (error) {
        throw new Error(`--${optionName} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * 规划卷目录：--single-volume 一卷；否则每 --chapters-per-volume 章一卷。
 */
function planVolumes(
    chapterCount: number,
    options: Pick<WorkspaceNodeImportBookOptions, "volume" | "chaptersPerVolume" | "singleVolume">,
): {volume: string; chapters: number}[] {
    if (options.volume?.trim()) {
        return [{volume: options.volume.trim(), chapters: chapterCount}];
    }
    if (options.singleVolume || chapterCount === 0) {
        return [{volume: "001-volume", chapters: chapterCount}];
    }
    const perVolume = Math.max(1, Math.floor(Number(options.chaptersPerVolume) || 100));
    const plan: {volume: string; chapters: number}[] = [];
    let remaining = chapterCount;
    let volumeIndex = 1;
    while (remaining > 0) {
        const count = Math.min(perVolume, remaining);
        plan.push({volume: `${String(volumeIndex).padStart(3, "0")}-volume`, chapters: count});
        remaining -= count;
        volumeIndex += 1;
    }
    return plan;
}

/**
 * 打印 dry-run 统计（非 JSON 模式）。
 */
function printImportBookPreview(stats: {
    mode: ChapterSplitMode;
    patternKey: string | null;
    confidence: "high" | "low";
    total: number;
    distribution: [number, number, number, number, number];
    anomalies: {index: number; heading: string; words: number}[];
}, volumePlan: {volume: string; chapters: number}[]): void {
    const [min, p25, median, p75, max] = stats.distribution;
    console.log(`切章方式：${stats.mode}${stats.patternKey ? `（${stats.patternKey}）` : ""}，置信度：${stats.confidence}`);
    console.log(`共 ${stats.total} 章；字数分布 min/p25/中位/p75/max：${min}/${p25}/${median}/${p75}/${max}`);
    console.log(`分卷：${volumePlan.map((plan) => `${plan.volume}（${plan.chapters} 章）`).join("、")}`);
    if (stats.anomalies.length > 0) {
        console.log(`字数异常（<500 或 >12000）：${stats.anomalies.map((item) => `#${item.index} ${item.heading}（${item.words} 字）`).join("、")}`);
    }
}

/**
 * 把切好的章节写入 manuscript：卷目录/章节目录按 {3位序号}-{volume|chapter} 命名。
 * 已存在且未 --force 时跳过；--force 覆盖 index.md。返回实际写入的目录相对路径。
 */
async function applyImportBook(
    root: string,
    parts: {index: number; heading: string; text: string}[],
    volumePlan: {volume: string; chapters: number}[],
    force: boolean,
): Promise<string[]> {
    const written: string[] = [];
    let partOffset = 0;
    for (const volume of volumePlan) {
        const volumeRelative = path.posix.join("manuscript", volume.volume);
        for (let offset = 0; offset < volume.chapters; offset++) {
            const part = parts[partOffset + offset];
            if (!part) {
                break;
            }
            const chapterName = `${String(part.index).padStart(3, "0")}-chapter`;
            const chapterRelative = path.posix.join(volumeRelative, chapterName);
            const resolved = resolveWorkspacePath(root, chapterRelative);
            const indexPath = path.join(resolved, "index.md");
            const content = renderImportBookChapter(part.heading, part.text);
            try {
                await fs.stat(indexPath);
                if (!force) {
                    continue;
                }
                await fs.writeFile(indexPath, content, "utf-8");
            } catch (error) {
                if (typeof error !== "object" || error === null || (error as NodeJS.ErrnoException).code !== "ENOENT") {
                    throw error;
                }
                await fs.mkdir(resolved, {recursive: true});
                await fs.writeFile(indexPath, content, "utf-8");
            }
            written.push(chapterRelative);
        }
        partOffset += volume.chapters;
    }
    return written;
}

/**
 * 渲染导入章节的内容节点 index.md：正文原样保留（含标题行），frontmatter 标记导入来源。
 */
function renderImportBookChapter(heading: string, body: string): string {
    return renderMarkdownDocument({
        title: heading,
        type: "chapter",
        subtype: null,
        status: "draft",
        icon: null,
        aliases: [],
        tags: [],
        summary: "",
        refs: [],
        retrieval: {enabled: true, trigger: null},
        governance: {source: "imported", review: "proposed"},
        ext: {},
    }, body);
}

/**
 * 合并 set-summary 的目标：--stdin 时读 JSON Lines，否则用 targets + --summary。
 */
async function collectSetSummaryInputs(targets: string[], options: WorkspaceNodeSetSummaryOptions): Promise<SetSummaryInput[]> {
    if (options.stdin) {
        const lines = splitStdinTargets(await readStdinText(), options.null);
        return lines.map((line, index) => {
            try {
                const parsed = JSON.parse(line) as unknown;
                if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                    throw new Error("不是对象");
                }
                const input = parsed as Partial<SetSummaryInput>;
                if (typeof input.path !== "string" || !input.path.trim()) {
                    throw new Error("缺少 path 字段");
                }
                if (typeof input.summary !== "string") {
                    throw new Error("summary 必须是字符串");
                }
                return {path: input.path.trim(), summary: input.summary};
            } catch (error) {
                throw new Error(`stdin 第 ${index + 1} 行不是合法 {path, summary} JSON：${error instanceof Error ? error.message : String(error)}`);
            }
        });
    }
    if (targets.length === 0) {
        throw new Error("需要提供内容节点路径，或使用 --stdin");
    }
    const summary = options.summary;
    if (summary === "") {
        throw new Error("单章模式需要 --summary 参数");
    }
    return targets.map((target) => ({path: target, summary}));
}

/**
 * 写回单个内容节点的 frontmatter.summary，返回更新后的摘要。
 */
async function setContentSummary(root: string, relativePath: string, summary: string): Promise<{path: string; summary: string}> {
    const node = await statWorkspacePath(root, relativePath);
    if (!node.isDirectory || !node.contentNode) {
        throw new Error(`目标不是标准内容节点目录: ${node.path}`);
    }
    const indexPath = path.join(node.absolutePath, "index.md");
    const content = await fs.readFile(indexPath, "utf-8");
    const parsed = parseMarkdownDocument(content);
    if (parsed.error) {
        throw new Error(`frontmatter 解析失败: ${node.path}`);
    }
    if (parsed.frontmatter.summary === summary) {
        return {path: node.path, summary};
    }

    const nextFrontmatter = {...parsed.frontmatter, summary};
    await fs.writeFile(indexPath, renderMarkdownDocument(nextFrontmatter, parsed.body), "utf-8");
    return {path: node.path, summary};
}
