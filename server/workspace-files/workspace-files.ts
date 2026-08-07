import {existsSync, type Stats} from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
    absoluteFsPath,
    assertRealParentContained,
    assertRealPathContained,
    resolveContainedFilePath,
    type AbsoluteFsPath,
} from "nbook/server/runtime/paths/file-path";
import YAML from "yaml";
import {
    applyWorkspaceContentFrontmatterDefaults,
    schemaForWorkspaceContentType,
    WorkspaceContentStateFrontmatterSchema,
    WORKSPACE_CONTENT_STATUSES,
} from "nbook/server/workspace-files/content-node-schema";
import {isRuntimeGeneratedWorkspacePath} from "nbook/server/workspace-files/runtime-generated-path";
import type {WorkspaceIssueSummaryDto} from "nbook/shared/dto/workspace-tree.dto";

export {WORKSPACE_CONTENT_STATUSES, WORKSPACE_STATUS_DESCRIPTIONS} from "nbook/server/workspace-files/content-node-schema";

export type WorkspaceFrontmatter = Record<string, unknown>;

export type WorkspaceContentState = {
    path: string;
    absolutePath: string;
    exists: boolean;
    frontmatter: WorkspaceFrontmatter;
    frontmatterError: string | null;
    body: string;
    words: number;
};

export type WorkspaceFileNode = {
    mode: string;
    entryType: string | null;
    icon: string | null;
    status: string | null;
    words: number;
    refs: string[];
    path: string;
    absolutePath: string;
    isDirectory: boolean;
    hasIndex: boolean;
    contentNode: boolean;
    summary: string;
    title: string;
    frontmatter: WorkspaceFrontmatter;
    frontmatterError: string | null;
    state: WorkspaceContentState | null;
    size: number;
    mtimeMs: number;
    editable: boolean;
    issueSummary?: WorkspaceIssueSummaryDto;
};

export type WorkspaceFileIssue = {
    level: "P1" | "P2" | "P3" | "WARN";
    code: string;
    path: string;
    message: string;
    line?: number;
};

/** Scanner在访问节点内容前交给调用方的稳定路径信息。 */
export type WorkspaceScanPath = Readonly<{
    absolutePath: AbsoluteFsPath;
    /** 相对root的正斜杠地址；root本身表示为`.`。 */
    relativePath: string;
    isDirectory: boolean;
}>;

/** 调用方按自身消费语义决定某个节点及其子树是否进入扫描。 */
export type WorkspaceScanPathPredicate = (entry: WorkspaceScanPath) => boolean;

export type WorkspaceScanOptions = {
    root: AbsoluteFsPath;
    /** 传入时，扫描会在文件系统步骤边界响应取消并抛出 signal.reason。 */
    signal?: AbortSignal;
    /** 可选consumer策略；返回false时目录会在递归I/O前整棵剪枝。 */
    pathPredicate?: WorkspaceScanPathPredicate;
    targets?: string[];
    depth?: number | null;
    type?: string | null;
    lorebookRoot?: string;
    chapterRoot?: string;
    recursive?: boolean;
};

export type WorkspaceContentValidateResult = {
    issues: WorkspaceFileIssue[];
    fixedPaths: string[];
};

export type WorkspaceContentValidateOptions = WorkspaceScanOptions & {
    fixMissing?: boolean;
};

export type WorkspaceContentIssueOptions = {
    root: AbsoluteFsPath;
    nodes: WorkspaceFileNode[];
    lorebookRoot?: string;
    chapterRoot?: string;
    existingPathSet?: Set<string>;
    // 当前 Story 已注册的 StoryChapter name 集合;传入后启用 Prose frontmatter `chapter:` 反指校验(孤儿指针 → WARN)。
    // 未传时跳过该规则,tree snapshot 等不查库的调用方保持零成本。
    knownChapterNames?: Set<string>;
};

export type WorkspaceNewFileInput = {
    root: AbsoluteFsPath;
    filePath: string;
    content?: string;
};

export type WorkspaceNewDirectoryInput = {
    root: AbsoluteFsPath;
    dirPath: string;
    indexContent?: string | null;
    stateContent?: string | null;
};

export type WorkspaceContentStateCreateInput = {
    root: AbsoluteFsPath;
    dirPath: string;
    stateContent: string;
};

export type WorkspaceFileToDirectoryInput = {
    root: AbsoluteFsPath;
    filePath: string;
};

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const WORKSPACE_INVALID_SCHEME_PATTERN = /^(?:chapter|volume|lorebook|thread|scene|plot|db|vfs):\/\//i;
const MARKDOWN_LINK_PATTERN = /(^|[^!])\[[^\]]+\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/g;
const EXTERNAL_REFERENCE_PATTERN = /^(?:https?:|mailto:|tel:|#)/i;
const SCHEME_REFERENCE_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
const NUMBER_PREFIX_PATTERN = /^(\d+)(?:[-_.\s].*)?$/;
const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;
const BINARY_SAMPLE_BYTES = 8000;
const BINARY_EXTENSIONS = new Set([
    ".7z",
    ".avi",
    ".avif",
    ".bin",
    ".bmp",
    ".bz2",
    ".class",
    ".db",
    ".dll",
    ".doc",
    ".docx",
    ".dylib",
    ".eot",
    ".exe",
    ".flac",
    ".gif",
    ".gz",
    ".ico",
    ".jar",
    ".jpeg",
    ".jpg",
    ".m4a",
    ".mkv",
    ".mov",
    ".mp3",
    ".mp4",
    ".ogg",
    ".otf",
    ".pdf",
    ".png",
    ".ppt",
    ".pptx",
    ".psd",
    ".pyc",
    ".rar",
    ".sqlite",
    ".sqlite3",
    ".so",
    ".tar",
    ".tgz",
    ".ttf",
    ".wasm",
    ".wav",
    ".webm",
    ".webp",
    ".woff",
    ".woff2",
    ".xls",
    ".xlsx",
    ".xz",
    ".zip",
    ".zst",
]);
const DEFAULT_LOREBOOK_ROOT = "lorebook";
const DEFAULT_CHAPTER_ROOT = "manuscript";
const CONTENT_NODE_ROOTS = new Set([DEFAULT_CHAPTER_ROOT, DEFAULT_LOREBOOK_ROOT]);
const HARD_EXCLUDED_DIRS = new Set([".git"]);
const LOREBOOK_ENTRY_TYPES = new Set(["world", "character", "location", "faction", "item", "event", "system", "instruction", "note", "species", "creature", "organization", "rule"]);
const MANUSCRIPT_ENTRY_TYPES = new Set(["volume", "chapter"]);

export type WorkspaceIgnoreRule = {
    pattern: string;
    directoryOnly: boolean;
    anchored: boolean;
    negated: boolean;
};

type WorkspaceIconConfig = {
    defaults: Record<string, string>;
    directories: Record<string, string>;
    extensions: Record<string, string>;
    entryTypes: Record<string, string>;
};

/**
 * 判断 frontmatter 是否仍使用旧的 ext.character 角色字段。
 */
function hasLegacyCharacterExt(frontmatter: WorkspaceFrontmatter): boolean {
    const ext = frontmatter.ext;
    if (typeof ext !== "object" || ext === null || Array.isArray(ext)) {
        return false;
    }
    const character = (ext as Record<string, unknown>).character;
    return typeof character === "object" && character !== null && !Array.isArray(character);
}

/**
 * 将用户路径解析为指定根目录内的绝对路径。
 */
export function resolveWorkspacePath(root: AbsoluteFsPath, inputPath: string): AbsoluteFsPath {
    try {
        return resolveContainedFilePath(absoluteFsPath(path.resolve(root)), inputPath);
    } catch {
        throw new Error(`Path is outside the workspace root: ${inputPath}`);
    }
}

/**
 * 建立Workspace文件操作使用的真实root。
 *
 * root本身先受State Root约束；写操作可按旧合同安全创建缺失root，但不会穿过
 * symlink/junction在State Root外创建目录。
 */
async function resolveWorkspaceOperationRoot(root: AbsoluteFsPath, create: boolean): Promise<AbsoluteFsPath> {
    if (create) {
        await fs.mkdir(root, {recursive: true});
    }
    return root;
}

/** 解析并验证会跟随目标内容的Workspace文件操作路径。 */
async function resolveWorkspaceContentPath(root: AbsoluteFsPath, inputPath: string): Promise<AbsoluteFsPath> {
    const target = absoluteFsPath(resolveWorkspacePath(root, inputPath));
    await assertRealPathContained(root, target);
    return target;
}

/** 解析并验证只操作目录项本身的Workspace文件操作路径。 */
async function resolveWorkspaceEntryPath(root: AbsoluteFsPath, inputPath: string): Promise<AbsoluteFsPath> {
    const target = absoluteFsPath(resolveWorkspacePath(root, inputPath));
    await assertRealParentContained(root, target);
    return target;
}

/**
 * 将绝对路径转换为前端展示用的 `/` 相对路径。
 */
export function toWorkspaceDisplayPath(root: string, absolutePath: string, isDirectory = false): string {
    const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
    if (!relativePath) {
        return isDirectory ? "./" : ".";
    }
    return isDirectory ? `${relativePath}/` : relativePath;
}

/**
 * 判断路径是否允许作为文本文件编辑。
 */
export function isEditableTextPath(filePath: string): boolean {
    return !BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * 判断相对路径是否落在启用目录节点语义的内容根目录内。
 */
export function isWorkspaceContentScopePath(relativePath: string): boolean {
    const segments = trimSlashes(relativePath).split("/").filter(Boolean);
    return Boolean(segments[0] && CONTENT_NODE_ROOTS.has(segments[0]));
}

/**
 * 判断相对路径是否是内容根目录内的 index.md。
 */
export function isWorkspaceContentIndexPath(relativePath: string): boolean {
    const normalizedPath = trimSlashes(relativePath).toLowerCase();
    return normalizedPath.endsWith("/index.md") && isWorkspaceContentScopePath(relativePath);
}

/**
 * 读取工作区内文本文件。
 */
export async function readWorkspaceTextFile(rootInput: AbsoluteFsPath, filePath: string): Promise<string> {
    const root = await resolveWorkspaceOperationRoot(rootInput, false);
    const absolutePath = await resolveWorkspaceContentPath(root, filePath);
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
        throw new Error("Only files can be read");
    }
    if (!isEditableTextPath(absolutePath)) {
        throw new Error("This file type cannot be read as text");
    }
    assertTextFileSize(stat.size);
    return readUtf8TextFile(absolutePath);
}

/**
 * 覆盖写入工作区内文本文件。
 */
export async function writeWorkspaceTextFile(rootInput: AbsoluteFsPath, filePath: string, content: string): Promise<void> {
    const root = await resolveWorkspaceOperationRoot(rootInput, true);
    const absolutePath = await resolveWorkspaceContentPath(root, filePath);
    if (!isEditableTextPath(absolutePath)) {
        throw new Error("This file type cannot be written as text");
    }
    assertTextFileSize(Buffer.byteLength(content, "utf-8"));
    await fs.mkdir(path.dirname(absolutePath), {recursive: true});
    await fs.writeFile(absolutePath, content, "utf-8");
}

/**
 * 判断工作区路径是否存在。
 */
export async function workspacePathExists(rootInput: AbsoluteFsPath, filePath: string): Promise<boolean> {
    const root = await resolveWorkspaceOperationRoot(rootInput, false);
    if (!await pathExists(root)) {
        return false;
    }
    return pathExists(await resolveWorkspaceContentPath(root, filePath));
}

/**
 * 创建新文本文件，已存在时拒绝覆盖。
 */
export async function createWorkspaceFile(input: WorkspaceNewFileInput): Promise<WorkspaceFileNode> {
    const root = await resolveWorkspaceOperationRoot(input.root, true);
    const absolutePath = await resolveWorkspaceContentPath(root, input.filePath);
    if (!isEditableTextPath(absolutePath)) {
        throw new Error("该文件类型不支持创建为文本文件");
    }
    if (await pathExists(absolutePath)) {
        throw new Error(`目标文件已存在: ${input.filePath}`);
    }

    await fs.mkdir(path.dirname(absolutePath), {recursive: true});
    await fs.writeFile(absolutePath, input.content ?? "", "utf-8");
    return buildWorkspaceNode(root, absolutePath, {
        lorebookRoot: DEFAULT_LOREBOOK_ROOT,
        chapterRoot: DEFAULT_CHAPTER_ROOT,
        iconConfig: await readWorkspaceIconConfig(root),
    });
}

/**
 * 创建目录，可选同时创建 index.md 与 state.md。
 */
export async function createWorkspaceDirectory(input: WorkspaceNewDirectoryInput): Promise<WorkspaceFileNode> {
    const root = await resolveWorkspaceOperationRoot(input.root, true);
    const absolutePath = await resolveWorkspaceContentPath(root, input.dirPath);
    if (await pathExists(absolutePath)) {
        throw new Error(`目标目录已存在: ${input.dirPath}`);
    }

    await fs.mkdir(absolutePath, {recursive: true});
    if (input.indexContent !== undefined && input.indexContent !== null) {
        await fs.writeFile(path.join(absolutePath, "index.md"), input.indexContent, "utf-8");
    }
    if (input.stateContent !== undefined && input.stateContent !== null) {
        await fs.writeFile(path.join(absolutePath, "state.md"), input.stateContent, "utf-8");
    }

    return buildWorkspaceNode(root, absolutePath, {
        lorebookRoot: DEFAULT_LOREBOOK_ROOT,
        chapterRoot: DEFAULT_CHAPTER_ROOT,
        iconConfig: await readWorkspaceIconConfig(root),
    });
}

/**
 * 给已有内容节点目录创建 state.md，已存在时拒绝覆盖。
 */
export async function createWorkspaceContentState(input: WorkspaceContentStateCreateInput): Promise<WorkspaceFileNode> {
    const root = await resolveWorkspaceOperationRoot(input.root, false);
    const absolutePath = await resolveWorkspaceContentPath(root, input.dirPath);
    const stat = await fs.stat(absolutePath);
    if (!stat.isDirectory()) {
        throw new Error("state.md 只能创建在标准内容节点目录下");
    }

    const iconConfig = await readWorkspaceIconConfig(root);
    const node = await buildWorkspaceNode(root, absolutePath, {
        lorebookRoot: DEFAULT_LOREBOOK_ROOT,
        chapterRoot: DEFAULT_CHAPTER_ROOT,
        iconConfig,
    });
    if (!node.contentNode) {
        throw new Error(`目标不是标准内容节点目录: ${node.path}`);
    }

    const statePath = path.join(absolutePath, "state.md");
    await assertRealPathContained(root, absoluteFsPath(statePath));
    if (await pathExists(statePath)) {
        throw new Error(`目标 state.md 已存在: ${toWorkspaceDisplayPath(root, statePath)}`);
    }

    await fs.writeFile(statePath, input.stateContent, "utf-8");
    return buildWorkspaceNode(root, absolutePath, {
        lorebookRoot: DEFAULT_LOREBOOK_ROOT,
        chapterRoot: DEFAULT_CHAPTER_ROOT,
        iconConfig,
    });
}

/**
 * 将文本文件转换成同名目录节点，并把原内容移动到 index.md。
 */
export async function convertWorkspaceFileToDirectory(input: WorkspaceFileToDirectoryInput): Promise<WorkspaceFileNode> {
    const root = await resolveWorkspaceOperationRoot(input.root, false);
    const sourcePath = await resolveWorkspaceContentPath(root, input.filePath);
    const sourceRelativePath = toWorkspaceDisplayPath(root, sourcePath);
    if (!isWorkspaceContentScopePath(sourceRelativePath)) {
        throw new Error("只有 manuscript/ 与 lorebook/ 下的文件支持转换为目录节点");
    }
    const sourceStat = await fs.stat(sourcePath);
    if (!sourceStat.isFile()) {
        throw new Error("只能将文件转换为目录节点");
    }
    if (!isEditableTextPath(sourcePath)) {
        throw new Error("该文件类型不支持转换为目录节点");
    }
    if (path.basename(sourcePath).toLowerCase() === "index.md") {
        throw new Error("index.md 已经是目录节点内容，不能继续转换");
    }

    const parsedPath = path.parse(sourcePath);
    const targetDir = path.join(parsedPath.dir, parsedPath.name);
    const targetIndexPath = path.join(targetDir, "index.md");
    await assertRealPathContained(root, absoluteFsPath(targetDir));
    if (await pathExists(targetDir)) {
        throw new Error(`目标目录已存在: ${toWorkspaceDisplayPath(root, targetDir, true)}`);
    }
    if (await pathExists(targetIndexPath)) {
        throw new Error(`目标 index.md 已存在: ${toWorkspaceDisplayPath(root, targetIndexPath)}`);
    }

    const tempPath = path.join(parsedPath.dir, `.${parsedPath.base}.${Date.now()}.tmp`);
    await fs.rename(sourcePath, tempPath);
    try {
        await fs.mkdir(targetDir, {recursive: false});
        await fs.rename(tempPath, targetIndexPath);
    } catch (error) {
        await fs.rm(targetDir, {recursive: true, force: true});
        if (await pathExists(tempPath)) {
            await fs.rename(tempPath, sourcePath);
        }
        throw error;
    }

    return buildWorkspaceNode(root, targetDir, {
        lorebookRoot: DEFAULT_LOREBOOK_ROOT,
        chapterRoot: DEFAULT_CHAPTER_ROOT,
        iconConfig: await readWorkspaceIconConfig(root),
    });
}

/**
 * 移动或重命名文件/目录，目标存在时拒绝覆盖。
 */
export async function renameWorkspacePath(rootInput: AbsoluteFsPath, fromPath: string, toPath: string): Promise<WorkspaceFileNode> {
    const root = await resolveWorkspaceOperationRoot(rootInput, false);
    const fromAbsolutePath = await resolveWorkspaceContentPath(root, fromPath);
    const toAbsolutePath = await resolveWorkspaceEntryPath(root, toPath);
    if (!await pathExists(fromAbsolutePath)) {
        throw new Error(`源路径不存在: ${fromPath}`);
    }
    if (await pathExists(toAbsolutePath)) {
        throw new Error(`目标路径已存在: ${toPath}`);
    }

    await fs.mkdir(path.dirname(toAbsolutePath), {recursive: true});
    await fs.rename(fromAbsolutePath, toAbsolutePath);
    return buildWorkspaceNode(root, toAbsolutePath, {
        lorebookRoot: DEFAULT_LOREBOOK_ROOT,
        chapterRoot: DEFAULT_CHAPTER_ROOT,
        iconConfig: await readWorkspaceIconConfig(root),
    });
}

/**
 * 删除工作区路径。
 */
export async function deleteWorkspacePath(rootInput: AbsoluteFsPath, filePath: string, recursive: boolean): Promise<void> {
    const root = await resolveWorkspaceOperationRoot(rootInput, false);
    const absolutePath = await resolveWorkspaceEntryPath(root, filePath);
    if (!await pathExists(absolutePath)) {
        throw new Error(`路径不存在: ${filePath}`);
    }
    const stat = await fs.lstat(absolutePath);
    if (stat.isDirectory()) {
        await fs.rm(absolutePath, {recursive});
        return;
    }
    await fs.unlink(absolutePath);
}

/**
 * 读取单个文件或目录的元信息。
 */
export async function statWorkspacePath(rootInput: AbsoluteFsPath, filePath: string): Promise<WorkspaceFileNode> {
    const root = await resolveWorkspaceOperationRoot(rootInput, false);
    const absolutePath = await resolveWorkspaceContentPath(root, filePath);
    return buildWorkspaceNode(root, absolutePath, {
        lorebookRoot: DEFAULT_LOREBOOK_ROOT,
        chapterRoot: DEFAULT_CHAPTER_ROOT,
        iconConfig: await readWorkspaceIconConfig(root),
    });
}

/**
 * 扫描工作区文件树。
 */
export async function scanWorkspaceTree(options: WorkspaceScanOptions): Promise<WorkspaceFileNode[]> {
    throwIfWorkspaceScanAborted(options.signal);
    const root = await resolveWorkspaceOperationRoot(options.root, false);
    throwIfWorkspaceScanAborted(options.signal);
    if (!await pathExists(root)) {
        throwIfWorkspaceScanAborted(options.signal);
        return [];
    }
    const ignoreRules = await readWorkspaceIgnoreRules(root, options.signal);
    throwIfWorkspaceScanAborted(options.signal);
    const iconConfig = await readWorkspaceIconConfig(root, options.signal);
    throwIfWorkspaceScanAborted(options.signal);
    const targetInputs = options.targets?.length
        ? options.targets
        : await resolveDefaultTargets(root, ignoreRules, options.signal);
    throwIfWorkspaceScanAborted(options.signal);
    const nodes: WorkspaceFileNode[] = [];

    for (const targetInput of targetInputs) {
        throwIfWorkspaceScanAborted(options.signal);
        const targetPath = await resolveWorkspaceContentPath(root, targetInput);
        throwIfWorkspaceScanAborted(options.signal);
        let targetStat: Awaited<ReturnType<typeof fs.stat>>;
        try {
            throwIfWorkspaceScanAborted(options.signal);
            targetStat = await fs.stat(targetPath);
            throwIfWorkspaceScanAborted(options.signal);
        } catch (error) {
            throwIfWorkspaceScanAborted(options.signal);
            if (isMissingPathError(error)) {
                continue;
            }
            throw error;
        }
        if (shouldSkipWorkspaceScanPath(
            root,
            targetPath,
            targetStat.isDirectory(),
            ignoreRules,
            options.pathPredicate,
        )) {
            continue;
        }
        await visitPath(root, targetPath, {
            depth: options.depth ?? null,
            lorebookRoot: options.lorebookRoot ?? DEFAULT_LOREBOOK_ROOT,
            chapterRoot: options.chapterRoot ?? DEFAULT_CHAPTER_ROOT,
            ignoreRules,
            iconConfig,
            signal: options.signal,
            pathPredicate: options.pathPredicate,
        }, nodes);
        throwIfWorkspaceScanAborted(options.signal);
    }

    throwIfWorkspaceScanAborted(options.signal);
    return nodes
        .filter((node) => !options.type || node.entryType === options.type)
        .sort((left, right) => left.path.localeCompare(right.path, "zh-Hans-CN"));
}

/** 在扫描边界保留 AbortSignal 的原始取消原因。 */
function throwIfWorkspaceScanAborted(signal?: AbortSignal): void {
    signal?.throwIfAborted();
}

/**
 * 校验工作区文件树。
 */
export async function validateWorkspaceTree(options: WorkspaceScanOptions): Promise<WorkspaceFileIssue[]> {
    const result = await validateWorkspaceContentNodes({
        ...options,
        recursive: options.recursive ?? true,
    });
    return result.issues;
}

/**
 * 校验标准内容节点。标准内容节点必须是包含 index.md 的目录；内容根外节点会报告 WARN。
 */
export async function validateWorkspaceContentNodes(options: WorkspaceContentValidateOptions): Promise<WorkspaceContentValidateResult> {
    const root = await resolveWorkspaceOperationRoot(options.root, false);
    const collected = await collectWorkspaceContentValidationNodes(root, options);
    const fixedPaths: string[] = [];
    const scannedNodes = options.fixMissing
        ? await applyMissingFrontmatterFixes(root, collected.scannedNodes, collected.contentNodes, fixedPaths)
        : collected.scannedNodes;
    const issues = createWorkspaceContentIssues({
        root,
        nodes: scannedNodes,
        lorebookRoot: options.lorebookRoot,
        chapterRoot: options.chapterRoot,
    });
    return {issues: [...collected.issues, ...issues], fixedPaths};
}

/**
 * 从已扫描的工作区节点生成内容节点问题。用于 tree snapshot 和 CLI 复用校验规则。
 */
export function createWorkspaceContentIssues(options: WorkspaceContentIssueOptions): WorkspaceFileIssue[] {
    const root = options.root;
    const issues: WorkspaceFileIssue[] = [];
    const contentNodes = uniqueWorkspaceNodes(options.nodes.filter((node) => node.isDirectory && node.contentNode));

    for (const node of contentNodes) {
        if (node.frontmatterError) {
            issues.push({
                level: "P1",
                code: "invalid-frontmatter",
                path: node.path,
                message: node.frontmatterError,
            });
            continue;
        }

        issues.push(...validateWorkspaceContentFrontmatterSchema(node));
        issues.push(...validateWorkspaceContentStateSchema(node));
        const typeIssue = validateContentNodeType(node, {
            lorebookRoot: options.lorebookRoot ?? DEFAULT_LOREBOOK_ROOT,
            chapterRoot: options.chapterRoot ?? DEFAULT_CHAPTER_ROOT,
        });
        if (typeIssue) {
            issues.push(typeIssue);
        }
        const externalScopeIssue = validateExternalContentNodeScope(node);
        if (externalScopeIssue) {
            issues.push(externalScopeIssue);
        }

        if (hasLegacyCharacterExt(node.frontmatter)) {
            issues.push({
                level: "P2",
                code: "legacy-ext-character",
                path: node.path,
                message: "角色字段不再写入 ext.character，请迁移到 Markdown 正文并保留 ext 作为自由扩展对象",
            });
        }
    }

    issues.push(...validateContentSiblingNameConflicts(root, options.nodes));
    issues.push(...validateSingleContentNodeSiblingConflicts(root, contentNodes, issues, options.existingPathSet));
    issues.push(...validateDuplicateOrder(options.nodes));
    issues.push(...validateReferences(root, contentNodes, options.existingPathSet));
    issues.push(...validateStateReferences(root, contentNodes, options.existingPathSet));
    issues.push(...validateChapterPointers(contentNodes, {
        chapterRoot: options.chapterRoot ?? DEFAULT_CHAPTER_ROOT,
        knownChapterNames: options.knownChapterNames,
    }));
    return issues;
}

/**
 * 校验 Prose frontmatter 的 `chapter:` 反指。
 * 指针格式非法一律报 WARN;指向不存在的 Chapter name 仅在调用方提供 knownChapterNames 时报 WARN。
 */
function validateChapterPointers(
    contentNodes: WorkspaceFileNode[],
    options: {chapterRoot: string; knownChapterNames?: Set<string>},
): WorkspaceFileIssue[] {
    const issues: WorkspaceFileIssue[] = [];
    const chapterRootPrefix = `${options.chapterRoot}/`;
    for (const node of contentNodes) {
        const pointer = node.frontmatter.chapter;
        if (pointer === undefined || pointer === null) {
            continue;
        }
        if (typeof pointer !== "string" || !pointer.trim()) {
            issues.push({
                level: "WARN",
                code: "chapter-pointer-invalid",
                path: node.path,
                message: "frontmatter.chapter 必须是非空字符串,取值为 Plot 系统里 StoryChapter 的 name",
            });
            continue;
        }
        if (!node.path.startsWith(chapterRootPrefix)) {
            issues.push({
                level: "WARN",
                code: "chapter-pointer-outside-manuscript",
                path: node.path,
                message: `frontmatter.chapter 只应出现在 ${options.chapterRoot}/ 下的 Prose 节点上`,
            });
            continue;
        }
        if (options.knownChapterNames && !options.knownChapterNames.has(pointer.trim())) {
            issues.push({
                level: "WARN",
                code: "chapter-pointer-orphan",
                path: node.path,
                message: `frontmatter.chapter 指向的章节 name 不存在：${pointer.trim()};请先在 Plot 系统创建该 StoryChapter,或修正指针`,
            });
        }
    }
    return issues;
}

/**
 * CLI fix-missing 模式会写回缺失 frontmatter，并把扫描结果中的对应节点替换成修复后的版本。
 */
async function applyMissingFrontmatterFixes(
    root: string,
    scannedNodes: WorkspaceFileNode[],
    contentNodes: WorkspaceFileNode[],
    fixedPaths: string[],
): Promise<WorkspaceFileNode[]> {
    const fixedByPath = new Map<string, WorkspaceFileNode>();
    for (const node of contentNodes) {
        if (node.frontmatterError) {
            continue;
        }
        const fixed = await fixMissingWorkspaceContentFrontmatter(root, node, fixedPaths);
        fixedByPath.set(node.path, fixed);
    }
    return scannedNodes.map((node) => fixedByPath.get(node.path) ?? node);
}

/**
 * 收集本次校验需要处理的标准内容节点。
 */
async function collectWorkspaceContentValidationNodes(
    root: string,
    options: WorkspaceContentValidateOptions,
): Promise<{
    contentNodes: WorkspaceFileNode[];
    scannedNodes: WorkspaceFileNode[];
    issues: WorkspaceFileIssue[];
}> {
    const targetInputs = options.targets?.length ? options.targets : ["."];
    const contentNodes: WorkspaceFileNode[] = [];
    const scannedNodes: WorkspaceFileNode[] = [];
    const issues: WorkspaceFileIssue[] = [];

    for (const targetInput of targetInputs) {
        const absoluteTarget = await resolveWorkspaceContentPath(absoluteFsPath(root), targetInput);
        const relativeTarget = path.relative(root, absoluteTarget).split(path.sep).join("/");
        if (isRuntimeGeneratedWorkspacePath(relativeTarget)) {
            continue;
        }
        let targetStat: Awaited<ReturnType<typeof fs.stat>>;
        try {
            targetStat = await fs.stat(absoluteTarget);
        } catch (error) {
            if (!isMissingPathError(error)) {
                throw error;
            }
            issues.push({
                level: "P1",
                code: "missing-target",
                path: normalizeIssuePath(targetInput),
                message: "校验目标不存在",
            });
            continue;
        }
        if (!targetStat.isDirectory()) {
            issues.push({
                level: "P2",
                code: "invalid-content-node-target",
                path: toWorkspaceDisplayPath(root, absoluteTarget),
                message: "内容节点校验只接受标准内容节点目录；如果目标是 index.md，请传入它所在的目录",
            });
            continue;
        }

        if (options.recursive) {
            const nodes = await scanWorkspaceTree({
                ...options,
                targets: [targetInput],
            });
            scannedNodes.push(...nodes);
            const nestedContentNodes = nodes.filter((node) => node.isDirectory && node.contentNode);
            if (nestedContentNodes.length === 0) {
                issues.push({
                    level: "P3",
                    code: "no-content-node",
                    path: toWorkspaceDisplayPath(root, absoluteTarget, true),
                    message: "递归校验目标下没有发现标准内容节点",
                });
            }
            contentNodes.push(...nestedContentNodes);
            continue;
        }

        const node = await statWorkspacePath(options.root, targetInput);
        scannedNodes.push(node);
        if (!node.contentNode || !node.isDirectory) {
            issues.push({
                level: "P2",
                code: "invalid-content-node-target",
                path: node.path,
                message: explainInvalidContentNodeTarget(node),
            });
            continue;
        }
        contentNodes.push(node);
    }

    return {
        contentNodes: uniqueWorkspaceNodes(contentNodes),
        scannedNodes: uniqueWorkspaceNodes(scannedNodes),
        issues,
    };
}

/**
 * 用 Zod 校验内容节点 frontmatter。
 */
function validateWorkspaceContentFrontmatterSchema(node: WorkspaceFileNode): WorkspaceFileIssue[] {
    const type = typeof node.frontmatter.type === "string" ? node.frontmatter.type : node.entryType;
    const result = schemaForWorkspaceContentType(type).safeParse(node.frontmatter);
    if (result.success) {
        return [];
    }

    return result.error.issues.map((issue) => {
        const fieldPath = issue.path.map(String).join(".");
        const isMissingKey = fieldPath.length > 0 && !hasNestedFrontmatterKey(node.frontmatter, issue.path);
        const isLegacyStatus = fieldPath === "status" && node.frontmatter.status === "deprecated";
        return {
            level: "P2",
            code: isLegacyStatus ? "legacy-status" : isMissingKey ? "missing-frontmatter-field" : "invalid-frontmatter-field",
            path: node.path,
            message: isLegacyStatus
                ? "status=deprecated 已废弃，请改为 archived 或 pending"
                : `frontmatter.${fieldPath || "root"} 不符合内容节点 schema：${issue.message}`,
        };
    });
}

/**
 * 用 Zod 校验内容节点 state.md frontmatter。
 */
function validateWorkspaceContentStateSchema(node: WorkspaceFileNode): WorkspaceFileIssue[] {
    if (!node.state) {
        return [];
    }
    if (node.state.frontmatterError) {
        return [{
            level: "P1",
            code: "invalid-state-frontmatter",
            path: node.state.path,
            message: node.state.frontmatterError,
        }];
    }

    const result = WorkspaceContentStateFrontmatterSchema.safeParse(node.state.frontmatter);
    if (result.success) {
        return [];
    }

    return result.error.issues.map((issue) => {
        const fieldPath = issue.path.map(String).join(".");
        return {
            level: "P2",
            code: "invalid-state-field",
            path: node.state?.path ?? node.path,
            message: `state.${fieldPath || "root"} 不符合内容节点状态 schema：${issue.message}`,
        };
    });
}

/**
 * 补齐内容节点 frontmatter 缺失字段，并写回 index.md。
 */
async function fixMissingWorkspaceContentFrontmatter(root: string, node: WorkspaceFileNode, fixedPaths: string[]): Promise<WorkspaceFileNode> {
    const indexPath = path.join(node.absolutePath, "index.md");
    await assertRealPathContained(absoluteFsPath(root), absoluteFsPath(indexPath));
    const content = await fs.readFile(indexPath, "utf-8");
    const parsed = parseMarkdownDocument(content);
    if (parsed.error) {
        return node;
    }

    const fixed = applyWorkspaceContentFrontmatterDefaults({
        frontmatter: parsed.frontmatter,
        title: node.title || path.basename(node.absolutePath),
        type: typeof parsed.frontmatter.type === "string" ? parsed.frontmatter.type : node.entryType ?? "note",
    });
    if (!fixed.changed) {
        return node;
    }

    await fs.writeFile(indexPath, renderMarkdownDocument(fixed.frontmatter, parsed.body), "utf-8");
    fixedPaths.push(toWorkspaceDisplayPath(root, indexPath));
    return {
        ...node,
        frontmatter: fixed.frontmatter,
        status: typeof fixed.frontmatter.status === "string" ? fixed.frontmatter.status : null,
        summary: typeof fixed.frontmatter.summary === "string" ? fixed.frontmatter.summary : "",
        title: typeof fixed.frontmatter.title === "string" ? fixed.frontmatter.title : "",
        refs: extractWorkspaceRefs(renderMarkdownDocument(fixed.frontmatter, parsed.body), fixed.frontmatter),
    };
}

/**
 * 解释目标目录为什么不是标准内容节点。
 */
function explainInvalidContentNodeTarget(node: WorkspaceFileNode): string {
    if (!node.hasIndex) {
        return "目标目录缺少 index.md，标准内容节点必须由目录与 index.md 组成";
    }
    return "目标不是标准内容节点目录";
}

/**
 * 去重节点列表，避免多个 target 重叠时重复报错。
 */
function uniqueWorkspaceNodes(nodes: WorkspaceFileNode[]): WorkspaceFileNode[] {
    const seen = new Set<string>();
    const result: WorkspaceFileNode[] = [];
    for (const node of nodes) {
        if (seen.has(node.absolutePath)) {
            continue;
        }
        seen.add(node.absolutePath);
        result.push(node);
    }
    return result;
}

/**
 * 判断 frontmatter 中是否存在某个嵌套 key，用于区分缺失和类型错误。
 */
function hasNestedFrontmatterKey(frontmatter: WorkspaceFrontmatter, pathSegments: readonly PropertyKey[]): boolean {
    let currentValue: unknown = frontmatter;
    for (const segment of pathSegments) {
        if (!isPlainObject(currentValue) && !Array.isArray(currentValue)) {
            return false;
        }
        const record = currentValue as Record<PropertyKey, unknown>;
        if (!(segment in record)) {
            return false;
        }
        currentValue = record[segment];
    }
    return true;
}

/**
 * 解析 Markdown frontmatter。
 */
export function parseMarkdownDocument(content: string): {
    frontmatter: WorkspaceFrontmatter;
    body: string;
    error: string | null;
} {
    const match = content.match(FRONTMATTER_PATTERN);
    if (!match) {
        return {
            frontmatter: {},
            body: content,
            error: null,
        };
    }

    const rawFrontmatter = match[1] ?? "";
    try {
        const parsed = YAML.parse(rawFrontmatter, {logLevel: "silent"});
        return {
            frontmatter: isPlainObject(parsed) ? parsed : {},
            body: content.slice(match[0].length),
            error: isPlainObject(parsed) || parsed === null ? null : "frontmatter 必须是对象",
        };
    } catch (error) {
        return {
            frontmatter: {},
            body: content.slice(match[0].length),
            error: error instanceof Error ? error.message : "frontmatter 解析失败",
        };
    }
}

/**
 * 生成 Markdown 文档。
 */
export function renderMarkdownDocument(frontmatter: WorkspaceFrontmatter, body = ""): string {
    const yamlText = YAML.stringify(frontmatter).trimEnd();
    return `---\n${yamlText}\n---\n\n${body}`;
}

/**
 * 提取文本中的引用。
 */
export function extractWorkspaceRefs(content: string, frontmatter: WorkspaceFrontmatter = {}): string[] {
    const refs = new Set<string>();

    for (const match of content.matchAll(MARKDOWN_LINK_PATTERN)) {
        const target = match[2]?.trim();
        if (target && isWorkspaceReferenceTarget(target)) {
            refs.add(target);
        }
    }
    for (const ref of readStructuredRefTargets(frontmatter.refs)) {
        refs.add(ref);
    }

    return [...refs];
}

/**
 * 判断 Markdown 链接 target 是否属于工作区引用。
 */
function isWorkspaceReferenceTarget(target: string): boolean {
    const normalizedTarget = stripReferenceFragment(target.trim());
    if (!normalizedTarget) {
        return false;
    }
    if (path.isAbsolute(normalizedTarget) || path.win32.isAbsolute(normalizedTarget)) {
        return true;
    }
    if (normalizedTarget.startsWith("/")) {
        return false;
    }
    if (EXTERNAL_REFERENCE_PATTERN.test(normalizedTarget)) {
        return false;
    }
    if (SCHEME_REFERENCE_PATTERN.test(normalizedTarget)) {
        return true;
    }
    return true;
}

/**
 * 读取结构化 refs 中的 target 字段。
 */
function readStructuredRefTargets(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const targets: string[] = [];
    for (const item of value) {
        if (!isPlainObject(item) || typeof item.target !== "string") {
            continue;
        }
        const target = item.target.trim();
        if (target) {
            targets.push(target);
        }
    }
    return targets;
}

async function visitPath(
    root: string,
    absolutePath: string,
    options: {
        depth: number | null;
        lorebookRoot: string;
        chapterRoot: string;
        ignoreRules: WorkspaceIgnoreRule[];
        iconConfig: WorkspaceIconConfig;
        signal?: AbortSignal;
        pathPredicate?: WorkspaceScanPathPredicate;
    },
    nodes: WorkspaceFileNode[],
): Promise<void> {
    try {
        throwIfWorkspaceScanAborted(options.signal);
        await assertRealPathContained(absoluteFsPath(root), absoluteFsPath(absolutePath));
        throwIfWorkspaceScanAborted(options.signal);
        const stat = await fs.stat(absolutePath);
        throwIfWorkspaceScanAborted(options.signal);
        const isDirectory = stat.isDirectory();
        const displayPath = toWorkspaceDisplayPath(root, absolutePath, isDirectory);
        const depth = displayPath === "./" ? 0 : displayPath.split("/").filter(Boolean).length;
        if (options.depth !== null && depth > options.depth) {
            return;
        }

        const node = await buildWorkspaceNode(root, absolutePath, options);
        throwIfWorkspaceScanAborted(options.signal);
        if (!isDirectory) {
            nodes.push(node);
            return;
        }

        throwIfWorkspaceScanAborted(options.signal);
        const children = await fs.readdir(absolutePath, {withFileTypes: true});
        throwIfWorkspaceScanAborted(options.signal);
        nodes.push(node);
        for (const child of children.sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"))) {
            throwIfWorkspaceScanAborted(options.signal);
            const childPath = path.join(absolutePath, child.name);
            if (shouldSkipWorkspaceScanPath(
                root,
                childPath,
                child.isDirectory(),
                options.ignoreRules,
                options.pathPredicate,
            )) {
                continue;
            }
            await visitPath(root, childPath, options, nodes);
            throwIfWorkspaceScanAborted(options.signal);
        }
    } catch (error) {
        throwIfWorkspaceScanAborted(options.signal);
        if (isMissingPathError(error)) {
            return;
        }
        throw error;
    }
}

/** 判断节点访问失败是否仅表示扫描期间路径已经消失。 */
function isMissingPathError(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "ENOENT";
}

async function buildWorkspaceNode(
    root: string,
    absolutePath: string,
    options: {
        lorebookRoot: string;
        chapterRoot: string;
        iconConfig: WorkspaceIconConfig;
        signal?: AbortSignal;
    },
): Promise<WorkspaceFileNode> {
    throwIfWorkspaceScanAborted(options.signal);
    await assertRealPathContained(absoluteFsPath(root), absoluteFsPath(absolutePath));
    throwIfWorkspaceScanAborted(options.signal);
    const stat = await fs.stat(absolutePath);
    throwIfWorkspaceScanAborted(options.signal);
    const isDirectory = stat.isDirectory();
    const relativePath = toWorkspaceDisplayPath(root, absolutePath, isDirectory);
    const indexPath = isDirectory ? path.join(absolutePath, "index.md") : null;
    const hasIndex = indexPath ? await pathExists(indexPath) : false;
    throwIfWorkspaceScanAborted(options.signal);
    const contentDirectoryNode = isDirectory && hasIndex;
    const contentIndexNode = !isDirectory && path.basename(relativePath).toLowerCase() === "index.md";
    const contentNode = contentDirectoryNode || contentIndexNode;
    const metadataPath = contentDirectoryNode && indexPath ? indexPath : absolutePath;
    const editable = !isDirectory && isEditableTextPath(absolutePath);

    let frontmatter: WorkspaceFrontmatter = {};
    let frontmatterError: string | null = null;
    let body = "";
    let refs: string[] = [];
    let state: WorkspaceContentState | null = null;
    let metadataExists = false;
    if (contentDirectoryNode || editable) {
        throwIfWorkspaceScanAborted(options.signal);
        metadataExists = await pathExists(metadataPath);
        throwIfWorkspaceScanAborted(options.signal);
    }
    if (metadataExists) {
        try {
            throwIfWorkspaceScanAborted(options.signal);
            await assertRealPathContained(absoluteFsPath(root), absoluteFsPath(metadataPath));
            throwIfWorkspaceScanAborted(options.signal);
            if (isEditableTextPath(metadataPath)) {
                const content = await fs.readFile(metadataPath, {encoding: "utf-8", signal: options.signal});
                throwIfWorkspaceScanAborted(options.signal);
                const parsed = parseMarkdownDocument(content);
                frontmatter = parsed.frontmatter;
                frontmatterError = parsed.error;
                body = parsed.body;
                refs = extractWorkspaceRefs(content, frontmatter);
            }
        } catch (error) {
            throwIfWorkspaceScanAborted(options.signal);
            frontmatterError = error instanceof Error ? error.message : "文件读取失败";
        }
    }
    if (contentDirectoryNode) {
        state = await readWorkspaceContentState(root, absolutePath, options.signal);
        throwIfWorkspaceScanAborted(options.signal);
    }

    const entryType = inferEntryType({
        relativePath,
        frontmatter,
        lorebookRoot: options.lorebookRoot,
        chapterRoot: options.chapterRoot,
        contentNode,
    });

    return {
        mode: formatMode(stat, isDirectory),
        entryType,
        icon: resolveWorkspaceIcon({
            relativePath,
            absolutePath,
            isDirectory,
            editable,
            contentNode,
            entryType,
            frontmatter,
            config: options.iconConfig,
        }),
        status: typeof frontmatter.status === "string" ? frontmatter.status : null,
        words: body.trim().length,
        refs,
        path: relativePath,
        absolutePath,
        isDirectory,
        hasIndex,
        contentNode,
        summary: typeof frontmatter.summary === "string" ? frontmatter.summary : "",
        title: typeof frontmatter.title === "string" ? frontmatter.title : "",
        frontmatter,
        frontmatterError,
        state,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        editable,
    };
}

/**
 * 读取内容节点同级 state.md。缺失时返回 null，表示该节点暂无当前状态。
 */
async function readWorkspaceContentState(
    root: string,
    contentDirectoryPath: string,
    signal?: AbortSignal,
): Promise<WorkspaceContentState | null> {
    const statePath = path.join(contentDirectoryPath, "state.md");
    throwIfWorkspaceScanAborted(signal);
    if (!await pathExists(statePath)) {
        throwIfWorkspaceScanAborted(signal);
        return null;
    }

    try {
        throwIfWorkspaceScanAborted(signal);
        await assertRealPathContained(absoluteFsPath(root), absoluteFsPath(statePath));
        throwIfWorkspaceScanAborted(signal);
        const content = await fs.readFile(statePath, {encoding: "utf-8", signal});
        throwIfWorkspaceScanAborted(signal);
        const parsed = parseMarkdownDocument(content);
        return {
            path: toWorkspaceDisplayPath(root, statePath),
            absolutePath: statePath,
            exists: true,
            frontmatter: parsed.frontmatter,
            frontmatterError: parsed.error,
            body: parsed.body,
            words: parsed.body.trim().length,
        };
    } catch (error) {
        throwIfWorkspaceScanAborted(signal);
        return {
            path: toWorkspaceDisplayPath(root, statePath),
            absolutePath: statePath,
            exists: true,
            frontmatter: {},
            frontmatterError: error instanceof Error ? error.message : "状态文件读取失败",
            body: "",
            words: 0,
        };
    }
}

function inferEntryType(input: {
    relativePath: string;
    frontmatter: WorkspaceFrontmatter;
    lorebookRoot: string;
    chapterRoot: string;
    contentNode: boolean;
}): string | null {
    if (!input.contentNode) {
        return null;
    }

    if (typeof input.frontmatter.type === "string" && input.frontmatter.type.trim()) {
        return input.frontmatter.type.trim();
    }

    const segments = input.relativePath.split("/").filter(Boolean);
    const lorebookRoot = trimSlashes(input.lorebookRoot);
    const chapterRoot = trimSlashes(input.chapterRoot);
    if (segments.length === 2 && segments[1]?.toLowerCase() === "index.md") {
        return null;
    }
    if (segments[0] === lorebookRoot && segments[1]) {
        return segments[1];
    }
    if (segments[0] === chapterRoot && input.relativePath.endsWith("/")) {
        return segments.length === 2 ? "volume" : "chapter";
    }
    if (segments[0] === chapterRoot && input.relativePath.endsWith(".md")) {
        if (path.basename(input.relativePath).toLowerCase() === "index.md" && segments.length === 3) {
            return "volume";
        }
        return "chapter";
    }
    return null;
}

/**
 * 校验内容节点的业务类型是否落在当前内容根允许集合内。
 */
function validateContentNodeType(
    node: WorkspaceFileNode,
    options: {
        lorebookRoot: string;
        chapterRoot: string;
    },
): WorkspaceFileIssue | null {
    const type = node.entryType;
    if (!type) {
        return null;
    }

    const segments = node.path.split("/").filter(Boolean);
    const root = segments[0];
    if (root === trimSlashes(options.lorebookRoot) && !LOREBOOK_ENTRY_TYPES.has(type)) {
        return {
            level: "P2",
            code: "invalid-type",
            path: node.path,
            message: `lorebook 内容节点 type 必须是 ${[...LOREBOOK_ENTRY_TYPES].join("、")}`,
        };
    }
    if (root === trimSlashes(options.chapterRoot) && !MANUSCRIPT_ENTRY_TYPES.has(type)) {
        return {
            level: "P2",
            code: "invalid-type",
            path: node.path,
            message: `manuscript 内容节点 type 必须是 ${[...MANUSCRIPT_ENTRY_TYPES].join("、")}`,
        };
    }
    return null;
}

/**
 * 标记位于内容根外的内容节点；这类节点可解析，但不享受 manuscript/lorebook 语义约束。
 */
function validateExternalContentNodeScope(node: WorkspaceFileNode): WorkspaceFileIssue | null {
    if (isWorkspaceContentScopePath(node.path)) {
        return null;
    }
    return {
        level: "WARN",
        code: "external-content-node",
        path: node.path,
        message: "内容节点位于 lorebook/ 和 manuscript/ 外，将按普通内容节点解析，不使用正文/设定根语义",
    };
}

/**
 * 按 frontmatter 与 .nbook/icons.json 解析当前节点图标。
 */
function resolveWorkspaceIcon(input: {
    relativePath: string;
    absolutePath: string;
    isDirectory: boolean;
    editable: boolean;
    contentNode: boolean;
    entryType: string | null;
    frontmatter: WorkspaceFrontmatter;
    config: WorkspaceIconConfig;
}): string | null {
    const explicitIcon = readIconName(input.frontmatter.icon);
    if (explicitIcon) {
        return explicitIcon;
    }

    if (input.entryType && input.config.entryTypes[input.entryType]) {
        return input.config.entryTypes[input.entryType] ?? null;
    }

    const baseName = path.basename(input.relativePath.replace(/\/$/, ""));
    if (input.isDirectory && input.config.directories[baseName]) {
        return input.config.directories[baseName] ?? null;
    }

    const extension = path.extname(input.absolutePath).toLowerCase();
    if (!input.isDirectory && input.config.extensions[extension]) {
        return input.config.extensions[extension] ?? null;
    }

    if (input.contentNode && input.config.defaults.contentNode) {
        return input.config.defaults.contentNode;
    }
    if (input.isDirectory) {
        return input.config.defaults.directory ?? null;
    }
    if (extension === ".md") {
        return input.config.defaults.markdown ?? null;
    }
    if (input.editable) {
        return input.config.defaults.text ?? null;
    }
    return input.config.defaults.file ?? null;
}

/**
 * 读取工作区图标配置。
 */
async function readWorkspaceIconConfig(root: string, signal?: AbortSignal): Promise<WorkspaceIconConfig> {
    const configPath = path.join(root, ".nbook", "icons.json");
    const defaultConfig = createDefaultWorkspaceIconConfig();
    throwIfWorkspaceScanAborted(signal);
    if (!await pathExists(configPath)) {
        throwIfWorkspaceScanAborted(signal);
        return defaultConfig;
    }

    try {
        throwIfWorkspaceScanAborted(signal);
        await assertRealPathContained(absoluteFsPath(root), absoluteFsPath(configPath));
        throwIfWorkspaceScanAborted(signal);
        const content = await fs.readFile(configPath, {encoding: "utf-8", signal});
        throwIfWorkspaceScanAborted(signal);
        const parsed = JSON.parse(content) as unknown;
        if (!isPlainObject(parsed)) {
            return defaultConfig;
        }

        return {
            defaults: {...defaultConfig.defaults, ...readStringMap(parsed.defaults)},
            directories: {...defaultConfig.directories, ...readStringMap(parsed.directories)},
            extensions: {...defaultConfig.extensions, ...normalizeExtensionIconMap(readStringMap(parsed.extensions))},
            entryTypes: {...defaultConfig.entryTypes, ...readStringMap(parsed.entryTypes)},
        };
    } catch {
        throwIfWorkspaceScanAborted(signal);
        return defaultConfig;
    }
}

/**
 * 内置一组稳定默认图标，配置文件不存在时使用。
 */
function createDefaultWorkspaceIconConfig(): WorkspaceIconConfig {
    return {
        defaults: {
            contentNode: "notebook-tabs",
            directory: "folder",
            file: "file-question",
            markdown: "file-text",
            text: "file",
        },
        directories: {
            lorebook: "library",
            manuscript: "book-open-text",
        },
        extensions: {
            ".md": "file-text",
            ".txt": "file",
        },
        entryTypes: {
            chapter: "book-open-text",
            character: "user-round",
            faction: "landmark",
            item: "package",
            location: "map-pinned",
            note: "scroll-text",
            rule: "book-key",
            volume: "library-big",
        },
    };
}

/**
 * 读取字符串映射配置，非法字段忽略。
 */
function readStringMap(value: unknown): Record<string, string> {
    if (!isPlainObject(value)) {
        return {};
    }

    const result: Record<string, string> = {};
    for (const [key, item] of Object.entries(value)) {
        const iconName = readIconName(item);
        if (key.trim() && iconName) {
            result[key.trim()] = iconName;
        }
    }
    return result;
}

/**
 * 规范化扩展名映射，允许用户写 md 或 .md。
 */
function normalizeExtensionIconMap(value: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(value).map(([extension, icon]) => {
        const normalizedExtension = extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
        return [normalizedExtension, icon];
    }));
}

/**
 * 读取 lucide 图标名；支持裸名称、i-lucide-* 与 lucide:* 写法。
 */
function readIconName(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const iconName = value
        .trim()
        .replace(/^i-lucide-/i, "")
        .replace(/^lucide:/i, "");
    return iconName ? iconName : null;
}

async function resolveDefaultTargets(
    root: string,
    ignoreRules: WorkspaceIgnoreRule[],
    signal?: AbortSignal,
): Promise<string[]> {
    throwIfWorkspaceScanAborted(signal);
    const entries = await fs.readdir(root, {withFileTypes: true});
    throwIfWorkspaceScanAborted(signal);
    return entries
        .filter((entry) => !shouldSkipWorkspacePath(root, path.join(root, entry.name), entry.isDirectory(), ignoreRules))
        .map((entry) => entry.name);
}

/**
 * 校验内容根内同级文件 stem 与目录名冲突。
 */
function validateContentSiblingNameConflicts(root: string, nodes: WorkspaceFileNode[]): WorkspaceFileIssue[] {
    const directoryPathSet = new Set(nodes.filter((node) => node.isDirectory).map((node) => node.absolutePath));
    const issues: WorkspaceFileIssue[] = [];
    for (const node of nodes) {
        if (node.isDirectory) {
            continue;
        }
        if (!isWorkspaceContentScopePath(node.path)) {
            continue;
        }
        const parsedPath = path.parse(node.absolutePath);
        const siblingDirPath = path.join(parsedPath.dir, parsedPath.name);
        // TODO: 如果以后内容根内的资料目录需要允许同名文件/目录，再细化为仅校验 foo.md 与 foo/index.md。
        if (directoryPathSet.has(siblingDirPath)) {
            issues.push({
                level: "P1",
                code: "content-sibling-name-conflict",
                path: toWorkspaceDisplayPath(root, node.absolutePath),
                message: "内容根内同级文件名不能与目录名相同；当前等价于禁止 foo.md 与 foo/index.md 并存",
            });
        }
    }
    return issues;
}

/**
 * 非递归校验单个标准内容节点时，也检查它旁边是否有同名 Markdown 文件。
 */
function validateSingleContentNodeSiblingConflicts(
    root: string,
    nodes: WorkspaceFileNode[],
    existingIssues: WorkspaceFileIssue[],
    existingPathSet?: Set<string>,
): WorkspaceFileIssue[] {
    const existingKeys = new Set(existingIssues.map((issue) => `${issue.code}:${issue.path}`));
    const issues: WorkspaceFileIssue[] = [];
    for (const node of nodes) {
        if (!isWorkspaceContentScopePath(node.path)) {
            continue;
        }
        const siblingFilePath = `${node.absolutePath}.md`;
        if (!workspaceAbsolutePathExists(root, siblingFilePath, existingPathSet)) {
            continue;
        }

        const issuePath = toWorkspaceDisplayPath(root, siblingFilePath);
        const issueKey = `content-sibling-name-conflict:${issuePath}`;
        if (existingKeys.has(issueKey)) {
            continue;
        }
        issues.push({
            level: "P1",
            code: "content-sibling-name-conflict",
            path: issuePath,
            message: "内容根内同级文件名不能与目录名相同；当前等价于禁止 foo.md 与 foo/index.md 并存",
        });
    }
    return issues;
}

/**
 * 读取工作区根目录下的 .gitignore，用于文件树显示过滤。
 */
export async function readWorkspaceIgnoreRules(root: string, signal?: AbortSignal): Promise<WorkspaceIgnoreRule[]> {
    const ignorePath = path.join(root, ".gitignore");
    throwIfWorkspaceScanAborted(signal);
    if (!await pathExists(ignorePath)) {
        throwIfWorkspaceScanAborted(signal);
        return [];
    }

    throwIfWorkspaceScanAborted(signal);
    await assertRealPathContained(absoluteFsPath(path.resolve(root)), absoluteFsPath(path.resolve(ignorePath)));
    throwIfWorkspaceScanAborted(signal);
    const content = await fs.readFile(ignorePath, {encoding: "utf-8", signal});
    throwIfWorkspaceScanAborted(signal);
    return content
        .split(/\r?\n/)
        .map((line) => parseWorkspaceIgnoreRule(line))
        .filter((rule): rule is WorkspaceIgnoreRule => rule !== null);
}

/**
 * 解析一行 .gitignore 规则；第一版只覆盖资源管理器常用过滤能力。
 */
function parseWorkspaceIgnoreRule(line: string): WorkspaceIgnoreRule | null {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) {
        return null;
    }

    const negated = trimmedLine.startsWith("!");
    const rawPattern = negated ? trimmedLine.slice(1).trim() : trimmedLine;
    if (!rawPattern) {
        return null;
    }

    const normalizedPattern = rawPattern.split("\\").join("/");
    const directoryOnly = normalizedPattern.endsWith("/");
    const anchored = normalizedPattern.startsWith("/");
    const pattern = normalizedPattern.replace(/^\/+|\/+$/g, "");
    if (!pattern) {
        return null;
    }

    return {
        pattern,
        directoryOnly,
        anchored,
        negated,
    };
}

/**
 * 判断某个工作区路径是否应该按 .gitignore 从文件树中隐藏。
 */
export function shouldSkipWorkspacePath(root: string, absolutePath: string, isDirectory: boolean, ignoreRules: WorkspaceIgnoreRule[]): boolean {
    if (isDirectory && HARD_EXCLUDED_DIRS.has(path.basename(absolutePath))) {
        return true;
    }

    const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
    if (isRuntimeGeneratedWorkspacePath(relativePath)) {
        return true;
    }
    let ignored = false;
    for (const rule of ignoreRules) {
        if (matchesWorkspaceIgnoreRule(relativePath, isDirectory, rule)) {
            ignored = !rule.negated;
        }
    }
    return ignored;
}

/** 组合scanner通用排除与调用方typed predicate，供全部visit入口统一剪枝。 */
function shouldSkipWorkspaceScanPath(
    root: string,
    absolutePath: string,
    isDirectory: boolean,
    ignoreRules: WorkspaceIgnoreRule[],
    pathPredicate?: WorkspaceScanPathPredicate,
): boolean {
    if (shouldSkipWorkspacePath(root, absolutePath, isDirectory, ignoreRules)) {
        return true;
    }
    if (!pathPredicate) {
        return false;
    }
    const relativePath = path.relative(root, absolutePath).split(path.sep).join("/") || ".";
    return !pathPredicate(Object.freeze({
        absolutePath: absoluteFsPath(absolutePath),
        relativePath,
        isDirectory,
    }));
}

/**
 * 按资源管理器需求匹配 .gitignore 规则，支持目录、锚定、否定与基础通配符。
 */
function matchesWorkspaceIgnoreRule(relativePath: string, isDirectory: boolean, rule: WorkspaceIgnoreRule): boolean {
    if (rule.directoryOnly && !isDirectory) {
        return false;
    }

    const normalizedPath = trimSlashes(relativePath);
    const pathSegments = normalizedPath.split("/").filter(Boolean);
    const patternSegments = rule.pattern.split("/").filter(Boolean);
    if (patternSegments.length === 0) {
        return false;
    }

    if (rule.anchored || patternSegments.length > 1) {
        return matchPathSegments(pathSegments, patternSegments);
    }

    return pathSegments.some((segment) => matchPathSegment(segment, patternSegments[0] ?? ""));
}

/**
 * 匹配完整相对路径片段。
 */
function matchPathSegments(pathSegments: string[], patternSegments: string[]): boolean {
    if (pathSegments.length !== patternSegments.length) {
        return false;
    }
    return patternSegments.every((patternSegment, index) => matchPathSegment(pathSegments[index] ?? "", patternSegment));
}

/**
 * 匹配单个路径片段，支持 * 与 ? 通配符。
 */
function matchPathSegment(segment: string, pattern: string): boolean {
    if (pattern === segment) {
        return true;
    }

    const regex = new RegExp(`^${escapeRegex(pattern).replace(/\\\*/g, ".*").replace(/\\\?/g, ".")}$`);
    return regex.test(segment);
}

/**
 * 转义正则特殊字符。
 */
function escapeRegex(value: string): string {
    return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}

function validateDuplicateOrder(nodes: WorkspaceFileNode[]): WorkspaceFileIssue[] {
    const grouped = new Map<string, Map<string, string[]>>();
    for (const node of nodes) {
        const normalizedPath = node.path.endsWith("/") ? node.path.slice(0, -1) : node.path;
        const parentPath = normalizedPath.includes("/") ? normalizedPath.slice(0, normalizedPath.lastIndexOf("/")) : ".";
        const baseName = normalizedPath.includes("/") ? normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1) : normalizedPath;
        const match = baseName.match(NUMBER_PREFIX_PATTERN);
        if (!match?.[1]) {
            continue;
        }

        const currentGroup = grouped.get(parentPath) ?? new Map<string, string[]>();
        const currentItems = currentGroup.get(match[1]) ?? [];
        currentItems.push(node.path);
        currentGroup.set(match[1], currentItems);
        grouped.set(parentPath, currentGroup);
    }

    const issues: WorkspaceFileIssue[] = [];
    for (const [parentPath, orderMap] of grouped.entries()) {
        for (const [order, paths] of orderMap.entries()) {
            if (paths.length <= 1) {
                continue;
            }
            issues.push({
                level: "P2",
                code: "duplicate-order",
                path: parentPath,
                message: `排序前缀 ${order} 重复：${paths.join("、")}`,
            });
        }
    }
    return issues;
}

function validateReferences(root: AbsoluteFsPath, nodes: WorkspaceFileNode[], existingPathSet?: Set<string>): WorkspaceFileIssue[] {
    const issues: WorkspaceFileIssue[] = [];
    for (const node of nodes) {
        for (const ref of node.refs) {
            issues.push(...validateReferenceTarget(root, node, ref, node.path, "引用", existingPathSet));
        }
    }
    return issues;
}

/**
 * 校验 state.md 中的当前状态引用。
 */
function validateStateReferences(root: AbsoluteFsPath, nodes: WorkspaceFileNode[], existingPathSet?: Set<string>): WorkspaceFileIssue[] {
    const issues: WorkspaceFileIssue[] = [];
    for (const node of nodes) {
        if (!node.state || node.state.frontmatterError) {
            continue;
        }
        for (const ref of readStateReferenceTargets(node.state.frontmatter)) {
            issues.push(...validateReferenceTarget(root, node, ref, node.state.path, "状态引用", existingPathSet));
        }
    }
    return issues;
}

/**
 * 校验单个工作区引用 target。
 */
function validateReferenceTarget(
    root: AbsoluteFsPath,
    node: WorkspaceFileNode,
    ref: string,
    issuePath: string,
    label: string,
    existingPathSet?: Set<string>,
): WorkspaceFileIssue[] {
    if (!isWorkspaceReferenceTarget(ref)) {
        return [{
            level: "P2",
            code: "invalid-ref",
            path: issuePath,
            message: `${label} target 必须使用工作区路径或相对路径：${ref}`,
        }];
    }
    if (WORKSPACE_INVALID_SCHEME_PATTERN.test(ref) || SCHEME_REFERENCE_PATTERN.test(ref)) {
        return [{
            level: "P1",
            code: "invalid-ref",
            path: issuePath,
            message: `${label} target 解析失败：${ref}`,
        }];
    }

    const targetPath = resolveReferenceTarget(root, node, ref);
    if (!targetPath) {
        return [{
            level: "P1",
            code: "invalid-ref",
            path: issuePath,
            message: `${label}路径解析失败或超出工作区：${ref}`,
        }];
    }
    if (!workspaceAbsolutePathExists(root, targetPath.filePath, existingPathSet) && !workspaceAbsolutePathExists(root, targetPath.indexPath, existingPathSet)) {
        return [{
            level: "P1",
            code: "missing-ref",
            path: issuePath,
            message: `${label}目标不存在：${ref}`,
        }];
    }
    return [];
}

/**
 * 优先使用 File Index 中的路径集合判断存在性，CLI 旧路径仍回退到磁盘。
 */
function workspaceAbsolutePathExists(root: string, absolutePath: string, existingPathSet?: Set<string>): boolean {
    if (!existingPathSet) {
        return existsSync(absolutePath);
    }
    return existingPathSet.has(toWorkspaceDisplayPath(root, absolutePath, false))
        || existingPathSet.has(toWorkspaceDisplayPath(root, absolutePath, true));
}

/**
 * 读取 state.md frontmatter 中需要断链校验的引用 target。
 */
function readStateReferenceTargets(frontmatter: WorkspaceFrontmatter): string[] {
    const targets = new Set<string>();
    if (Array.isArray(frontmatter.knowledge)) {
        for (const item of frontmatter.knowledge) {
            if (typeof item !== "string") {
                continue;
            }
            for (const target of extractWorkspaceRefs(item)) {
                targets.add(target);
            }
        }
    }
    return [...targets];
}

function resolveReferenceTarget(root: AbsoluteFsPath, sourceNode: WorkspaceFileNode, ref: string): {filePath: string; indexPath: string} | null {
    const cleanedRef = stripReferenceFragment(ref);
    if (!cleanedRef) {
        return null;
    }

    try {
        const decodedRef = decodeURI(cleanedRef);
        const sourceBase = sourceNode.isDirectory ? sourceNode.absolutePath : path.dirname(sourceNode.absolutePath);
        const basePath = decodedRef.startsWith("./") || decodedRef.startsWith("../") ? sourceBase : root;
        const targetPath = resolveWorkspacePath(root, path.resolve(basePath, decodedRef));
        return {
            filePath: targetPath,
            indexPath: path.join(targetPath, "index.md"),
        };
    } catch {
        return null;
    }
}

/**
 * 去掉 Markdown link target 的锚点与查询参数。
 */
function stripReferenceFragment(target: string): string {
    const queryIndex = target.search(/[?#]/);
    return queryIndex >= 0 ? target.slice(0, queryIndex) : target;
}

/**
 * 将用户输入路径规范化为 issue 中展示的相对路径。
 */
function normalizeIssuePath(inputPath: string): string {
    const normalizedPath = inputPath.replace(/\\/g, "/").replace(/^\/+/, "");
    return normalizedPath || ".";
}

/**
 * 限制文本工具处理的文件大小。
 */
function assertTextFileSize(byteLength: number): void {
    if (byteLength > MAX_TEXT_FILE_BYTES) {
        throw new Error(`File exceeds the text tool size limit: ${String(MAX_TEXT_FILE_BYTES)} bytes`);
    }
}

/**
 * 读取并校验 UTF-8 文本文件。
 */
async function readUtf8TextFile(filePath: string): Promise<string> {
    const buffer = await fs.readFile(filePath);
    assertNotBinaryBuffer(buffer.subarray(0, BINARY_SAMPLE_BYTES));
    try {
        return new TextDecoder("utf-8", {fatal: true}).decode(buffer);
    } catch {
        throw new Error("The file is not valid UTF-8 text and cannot be read as text");
    }
}

/**
 * 检查明显二进制内容。
 */
function assertNotBinaryBuffer(buffer: Buffer): void {
    if (buffer.includes(0)) {
        throw new Error("The file appears to be binary and cannot be read as text");
    }
}

export async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

function formatMode(stat: Stats, isDirectory: boolean): string {
    const prefix = isDirectory ? "d" : "-";
    const mode = Number(stat.mode);
    const bits = [
        mode & 0o400 ? "r" : "-",
        mode & 0o200 ? "w" : "-",
        mode & 0o100 ? "x" : "-",
        mode & 0o040 ? "r" : "-",
        mode & 0o020 ? "w" : "-",
        mode & 0o010 ? "x" : "-",
        mode & 0o004 ? "r" : "-",
        mode & 0o002 ? "w" : "-",
        mode & 0o001 ? "x" : "-",
    ];
    return `${prefix}${bits.join("")}`;
}

function trimSlashes(value: string): string {
    return value.replace(/^\/+|\/+$/g, "");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
