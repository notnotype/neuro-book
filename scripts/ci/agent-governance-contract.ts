import {execFileSync} from "node:child_process";
import {existsSync, lstatSync, readFileSync, readdirSync} from "node:fs";
import {dirname, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {resolveAgentAcceptanceRoot, resolveAgentCacheRoot, resolveAgentTempRoot, resolveAgentTestRoot, resolveAgentWorktreeRoot} from "@notnotype/neuro-book-test-support/paths";
import {parse as parseYaml} from "yaml";

import type {FileWarning} from "#scripts/ci/change-scope";

export const GOVERNANCE_NON_EMPTY_LINE_LIMITS = {
    "AGENTS.md": 220,
    ".omp/RULES.md": 80,
    "WATCHDOG.md": 40,
} as const;

export function defaultRepoRoot(moduleUrl: string): string {
    return resolve(dirname(fileURLToPath(moduleUrl)), "..", "..");
}

export function git(repoRoot: string, args: readonly string[]): string {
    return execFileSync("git", [...args], {cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trimEnd();
}

export function gitRevision(repoRoot: string): string {
    return git(repoRoot, ["rev-parse", "HEAD"]);
}

export function gitBranch(repoRoot: string): string {
    return git(repoRoot, ["branch", "--show-current"]) || "detached";
}

export function readRepoText(repoRoot: string, relativePath: string): string {
    return readFileSync(resolve(repoRoot, relativePath), "utf8");
}


export function hasDirectory(repoRoot: string, relativePath: string): boolean {
    const path = resolve(repoRoot, relativePath);
    return existsSync(path) && lstatSync(path).isDirectory();
}

export function hasFile(repoRoot: string, relativePath: string): boolean {
    const path = resolve(repoRoot, relativePath);
    return existsSync(path) && lstatSync(path).isFile();
}

export function governanceRoots(repoRoot: string, env: NodeJS.ProcessEnv = process.env) {
    const agentRoot = resolveAgentTempRoot(env);
    return {
        agentRoot,
        testRoot: resolveAgentTestRoot(env.NBOOK_TEST_RUN_ID && /^[a-f0-9]{8}$/u.test(env.NBOOK_TEST_RUN_ID) ? env.NBOOK_TEST_RUN_ID : "00000000", env),
        acceptanceRoot: resolveAgentAcceptanceRoot(env),
        cacheRoot: resolveAgentCacheRoot("source-dev", env),
        worktreeRoot: resolveAgentWorktreeRoot(primaryCheckoutRoot(repoRoot), env),
    };
}

/** 返回共享 Git common dir 对应的主 checkout，避免 linked worktree 内嵌套 `.worktree/.worktree`。 */
export function primaryCheckoutRoot(repoRoot: string): string {
    const commonDir = resolve(repoRoot, git(repoRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
    return dirname(commonDir);
}

/** 校验 monorepo registered worktree 只位于主 checkout 的 canonical `.worktree/` 下。 */
export function verifyMonorepoWorktreeLayout(repoRoot: string): string[] {
    const failures: string[] = [];
    const primaryRoot = primaryCheckoutRoot(repoRoot);
    const canonicalRoot = resolve(primaryRoot, ".worktree");
    for (const entry of parseWorktreeEntries(git(repoRoot, ["worktree", "list", "--porcelain"]))) {
        const worktree = typeof entry.worktree === "string" ? entry.worktree : null;
        if (!worktree || samePath(worktree, primaryRoot)) continue;
        if (!isAbsoluteInside(worktree, canonicalRoot)) failures.push(`monorepo worktree 位置违规：${worktree}（应位于 ${canonicalRoot}）`);
    }
    if (!samePath(repoRoot, primaryRoot) && !isAbsoluteInside(repoRoot, canonicalRoot)) {
        failures.push(`当前 worktree 不在主 checkout 的 canonical 根下：${repoRoot}`);
    }
    return failures;
}

function parseWorktreeEntries(text: string): Array<Record<string, string | true>> {
    return text.split(/\n\n/u).filter(Boolean).map((block) => Object.fromEntries(block.split(/\r?\n/u).map((line) => {
        const separator = line.indexOf(" ");
        return separator < 0 ? [line, true] : [line.slice(0, separator), line.slice(separator + 1)];
    })));
}

function samePath(left: string, right: string): boolean {
    return normalizePath(left) === normalizePath(right);
}

function isAbsoluteInside(path: string, parent: string): boolean {
    const remainder = relative(normalizePath(parent), normalizePath(path));
    return remainder !== "" && !remainder.startsWith("..") && !remainder.startsWith("/") && !/^[A-Za-z]:/u.test(remainder);
}

function normalizePath(path: string): string {
    const normalized = resolve(path).replaceAll("\\", "/");
    return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

const WORKS_ROOT = ".agents/works";
const WORK_ID_PATTERN = /^w(?!00000)[0-9]{5}-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const WORK_TASK_ID_PATTERN = /^t(?!00)[0-9]{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const WORK_ISSUE_ID_PATTERN = /^i[1-9][0-9]*$/u;
function physicalDirectoryFailure(relativePath: string): string {
    return `Work/Task 目录项必须是物理目录：${relativePath}`;
}

function firstNonPhysicalDirectory(repoRoot: string, relativePaths: readonly string[]): string | null {
    for (const relativePath of relativePaths) {
        const stats = lstatSync(resolve(repoRoot, relativePath), {throwIfNoEntry: false});
        if (stats && (!stats.isDirectory() || stats.isSymbolicLink())) return relativePath;
    }
    return null;
}


/** 只保存 legacy provenance 的旧 Task 目录：根 `.agents/tasks` 与各包的 `.agents/tasks`。 */
function legacyTaskRoots(repoRoot: string): string[] {
    const roots = [".agents/tasks"];
    const packagesRoot = resolve(repoRoot, "packages");
    if (!existsSync(packagesRoot) || !lstatSync(packagesRoot).isDirectory()) return roots;
    for (const entry of readdirSync(packagesRoot, {withFileTypes: true})) {
        const ownerRoot = `packages/${entry.name}/.agents/tasks`;
        if (entry.isDirectory() && hasDirectory(repoRoot, ownerRoot)) roots.push(ownerRoot);
    }
    return roots;
}

function legacyTaskReadmePaths(repoRoot: string, ownerRoot: string): string[] {
    const paths: string[] = [];
    const visit = (relativeRoot: string): void => {
        const absoluteRoot = resolve(repoRoot, relativeRoot);
        if (!existsSync(absoluteRoot) || !lstatSync(absoluteRoot).isDirectory()) return;
        for (const entry of readdirSync(absoluteRoot, {withFileTypes: true})) {
            if (!entry.isDirectory()) continue;
            const childRoot = `${relativeRoot}/${entry.name}`;
            const readmePath = `${childRoot}/README.md`;
            if (hasFile(repoRoot, readmePath)) paths.push(readmePath);
            visit(childRoot);
        }
    };
    visit(ownerRoot);
    return paths.sort();
}


/** 旧 Task 目录只保存 v1 历史记录，内容不再校验；current Task 必须位于 Work 容器内。 */
export function verifyLegacyTaskRoots(repoRoot: string): string[] {
    const failures: string[] = [];
    for (const ownerRoot of legacyTaskRoots(repoRoot)) {
        for (const relativePath of legacyTaskReadmePaths(repoRoot, ownerRoot)) {
            const metadata = readTaskFrontmatter(readRepoText(repoRoot, relativePath), relativePath, []);
            if (metadata?.schema === "nbook.task/v2") failures.push(`旧归档根拒收 v2，请移入 .agents/works/<work>/tasks/<task>/：${relativePath}`);
        }
    }
    return failures;
}

function validateWorkReadme(repoRoot: string, workId: string, relativePath: string, failures: string[]): boolean {
    const failureCount = failures.length;
    const metadata = readTaskFrontmatter(readRepoText(repoRoot, relativePath), relativePath, failures);
    if (!metadata) {
        failures.push(`Work 缺少有效 frontmatter：${relativePath}`);
        return false;
    }
    if (metadata.schema !== "nbook.work/v1") failures.push(`Work schema 无效：${relativePath}`);
    if (metadata.workId !== workId) failures.push(`Work workId 与目录不一致：${relativePath}`);
    if (metadata.issueId !== null && (typeof metadata.issueId !== "string" || !WORK_ISSUE_ID_PATTERN.test(metadata.issueId))) {
        failures.push(`Work issueId 必须是 i 加正整数或 null：${relativePath}`);
    }
    return failures.length === failureCount;
}

function readWorkTaskIds(repoRoot: string, workRoot: string, failures: string[]): string[] | null {
    const tasksRelativeRoot = `${workRoot}/tasks`;
    const nonPhysicalPath = firstNonPhysicalDirectory(repoRoot, [tasksRelativeRoot]);
    if (nonPhysicalPath) {
        failures.push(physicalDirectoryFailure(nonPhysicalPath));
        return null;
    }
    if (!hasDirectory(repoRoot, tasksRelativeRoot)) {
        failures.push(`Work 缺少 tasks 目录：${workRoot}`);
        return null;
    }
    const taskIds: string[] = [];
    let hasDeclaredTask = false;
    for (const entry of readdirSync(resolve(repoRoot, tasksRelativeRoot), {withFileTypes: true})) {
        const taskRoot = `${tasksRelativeRoot}/${entry.name}`;
        if (WORK_TASK_ID_PATTERN.test(entry.name)) {
            hasDeclaredTask = true;
            const nonPhysicalTask = firstNonPhysicalDirectory(repoRoot, [taskRoot]);
            if (nonPhysicalTask) failures.push(physicalDirectoryFailure(nonPhysicalTask));
            else taskIds.push(entry.name);
        } else if (entry.isDirectory() && !entry.isSymbolicLink()) {
            taskIds.push(entry.name);
            hasDeclaredTask = true;
        }
    }
    if (!hasDeclaredTask) {
        failures.push(`Work 必须至少包含一个 Task：${workRoot}`);
        return null;
    }
    return taskIds;
}

function validateWorkTask(repoRoot: string, taskId: string, relativePath: string, failures: string[]): void {
    const metadata = readTaskFrontmatter(readRepoText(repoRoot, relativePath), relativePath, failures);
    if (!metadata) {
        failures.push(`Work Task 缺少有效 frontmatter：${relativePath}`);
        return;
    }
    if (metadata.schema !== "nbook.task/v2") failures.push(`Work Task schema 无效：${relativePath}`);
    if (metadata.taskId !== taskId) failures.push(`Work Task taskId 与目录不一致：${relativePath}`);
    for (const legacyField of ["actionIssueId", "agentWorkflow", "kind", "worktreeId", "branchId", "role"] as const) {
        if (Object.hasOwn(metadata, legacyField)) failures.push(`Work Task 禁止旧字段 ${legacyField}：${relativePath}`);
    }
}

/** 校验当前 Work 容器；Task 正文只作执行参考，不作为机器门禁。 */
export function verifyWorkContracts(repoRoot: string): string[] {
    const failures: string[] = [];
    const nonPhysicalRoot = firstNonPhysicalDirectory(repoRoot, [".agents", WORKS_ROOT]);
    if (nonPhysicalRoot) return [physicalDirectoryFailure(nonPhysicalRoot)];
    const worksRoot = resolve(repoRoot, WORKS_ROOT);
    if (!existsSync(worksRoot)) return failures;

    for (const workEntry of readdirSync(worksRoot, {withFileTypes: true})) {
        const workId = workEntry.name;
        const workRoot = `${WORKS_ROOT}/${workId}`;
        if (WORK_ID_PATTERN.test(workId)) {
            const nonPhysicalWork = firstNonPhysicalDirectory(repoRoot, [workRoot]);
            if (nonPhysicalWork) {
                failures.push(physicalDirectoryFailure(nonPhysicalWork));
                continue;
            }
        } else {
            if (workEntry.isDirectory() && !workEntry.isSymbolicLink()) failures.push(`Work 标识格式无效：${workId}`);
            continue;
        }
        const readmePath = `${workRoot}/README.md`;
        if (!hasFile(repoRoot, readmePath)) {
            failures.push(`Work 缺少 README.md：${readmePath}`);
            continue;
        }
        validateWorkReadme(repoRoot, workId, readmePath, failures);
        const taskIds = readWorkTaskIds(repoRoot, workRoot, failures);
        if (!taskIds) continue;
        for (const taskId of taskIds) {
            if (!WORK_TASK_ID_PATTERN.test(taskId)) {
                failures.push(`Work Task 标识格式无效：${workRoot}/tasks/${taskId}`);
                continue;
            }
            const taskPath = `${workRoot}/tasks/${taskId}/README.md`;
            if (!hasFile(repoRoot, taskPath)) {
                failures.push(`Work Task 缺少 README.md：${taskPath}`);
                continue;
            }
            validateWorkTask(repoRoot, taskId, taskPath, failures);
        }
    }
    return failures;
}

export function expectedGovernanceFiles(): readonly string[] {
    return [
        "AGENTS.md",
        ".omp/RULES.md",
        "WATCHDOG.md",
        ".agents/AGENTS.md",
        ".agents/README.md",
        ".agents/works/README.md",
        ".agents/works/AGENTS.md",
        ".agents/tasks/AGENTS.md",
        ".agents/tasks/README.md",
        ".agents/skills/README.md",
        "packages/neuro-book/AGENTS.md",
        "scripts/AGENTS.md",
        "packages/AGENTS.md",
    ];
}

export function verifyGovernanceDocumentLimits(repoRoot: string): string[] {
    const failures: string[] = [];
    for (const [relativePath, limit] of Object.entries(GOVERNANCE_NON_EMPTY_LINE_LIMITS)) {
        if (!hasFile(repoRoot, relativePath)) continue;
        const actual = readRepoText(repoRoot, relativePath)
            .split(/\r?\n/u)
            .filter((line) => line.trim().length > 0)
            .length;
        if (actual > limit) failures.push(`治理入口超过非空行上限：${relativePath} ${String(actual)} > ${String(limit)}`);
    }
    return failures;
}

/** 文档里代替中文词的罕见符号；行内代码与代码块中的不算，它们是在引用符号本身。 */
const RARE_DOCUMENT_SYMBOL_PATTERN = /[§¶]/gu;

/** 历史 provenance 与旧应用只作参照、保持原样，不参与罕见符号检查。 */
function isFrozenDocument(relativePath: string): boolean {
    return relativePath.startsWith("docs/archived/")
        || relativePath.startsWith(".agents/tasks/")
        || relativePath.includes("/.agents/tasks/")
        || relativePath.startsWith("packages/neuro-book-legacy/");
}

function countRareDocumentSymbols(markdown: string): number {
    const prose = markdown
        .replace(/^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?^[ \t]*\1[^\n]*$/gmu, "")
        .replace(/`[^`\n]*`/gu, "");
    return prose.match(RARE_DOCUMENT_SYMBOL_PATTERN)?.length ?? 0;
}

/** 活跃 Markdown 里用 `§`、`¶` 代替中文词时每个文件一条警告（开发者要求写小节名或锚点链接）。 */
export function rareDocumentSymbolWarnings(repoRoot: string): FileWarning[] {
    const files = git(repoRoot, ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.md"])
        .split(/\r?\n/u)
        .filter((relativePath) => relativePath !== "" && !isFrozenDocument(relativePath) && hasFile(repoRoot, relativePath));
    const warnings: FileWarning[] = [];
    for (const relativePath of [...new Set(files)].sort()) {
        const count = countRareDocumentSymbols(readRepoText(repoRoot, relativePath));
        if (count > 0) warnings.push({path: relativePath, label: "文档用 § 或 ¶ 代替中文词", detail: `${relativePath}（${String(count)} 处），改写成小节名或锚点链接`});
    }
    return warnings;
}

/** 包之间只经包名与公开入口依赖，不读根 `scripts/`；旧应用只读，不在检查范围。 */
export function verifyPackageScriptBoundary(repoRoot: string): string[] {
    const failures: string[] = [];
    for (const relativePath of git(repoRoot, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "packages"]).split("\0")) {
        if (!/\.(?:ts|tsx|js|mjs|cjs|vue)$/u.test(relativePath) || relativePath.startsWith("packages/neuro-book-legacy/")) continue;
        if (!hasFile(repoRoot, relativePath)) continue;
        const imports = [...readRepoText(repoRoot, relativePath).matchAll(/["'](#scripts\/[^"']+)["']/gu)].map((match) => match[1]);
        if (imports.length > 0) failures.push(`包导入了根 scripts：${relativePath} -> ${imports.join(", ")}`);
    }
    return failures;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveWorkReadmePath(repoRoot: string, workId: string): {path: string | null; failures: string[]} {
    const failures: string[] = [];
    if (!WORK_ID_PATTERN.test(workId)) {
        failures.push(`Work 标识格式无效：${workId}`);
        return {path: null, failures};
    }
    const workRoot = `${WORKS_ROOT}/${workId}`;
    const nonPhysicalPath = firstNonPhysicalDirectory(repoRoot, [".agents", WORKS_ROOT, workRoot]);
    if (nonPhysicalPath) return {path: null, failures: [physicalDirectoryFailure(nonPhysicalPath)]};
    const relativePath = `${workRoot}/README.md`;
    const path = hasFile(repoRoot, relativePath) ? resolve(repoRoot, relativePath) : null;
    if (!path) {
        failures.push(`Work README 不存在：${workId}`);
        return {path: null, failures};
    }
    if (!validateWorkReadme(repoRoot, workId, relativePath, failures)) return {path, failures};
    readWorkTaskIds(repoRoot, workRoot, failures);
    return {path, failures};
}

export function resolveWorkTaskReadmePath(repoRoot: string, workId: string, taskId: string): {workPath: string | null; taskPath: string | null; failures: string[]} {
    const work = resolveWorkReadmePath(repoRoot, workId);
    const failures = [...work.failures];
    if (!work.path || failures.length > 0) return {workPath: work.path, taskPath: null, failures};
    if (!WORK_TASK_ID_PATTERN.test(taskId)) {
        failures.push(`Task 标识格式无效：${taskId}`);
        return {workPath: work.path, taskPath: null, failures};
    }
    const taskRoot = `${WORKS_ROOT}/${workId}/tasks/${taskId}`;
    const nonPhysicalPath = firstNonPhysicalDirectory(repoRoot, [taskRoot]);
    if (nonPhysicalPath) {
        failures.push(physicalDirectoryFailure(nonPhysicalPath));
        return {workPath: work.path, taskPath: null, failures};
    }
    const relativePath = `${taskRoot}/README.md`;
    const taskPath = hasFile(repoRoot, relativePath) ? resolve(repoRoot, relativePath) : null;
    if (!taskPath) {
        failures.push(`Task README 不存在：${workId}/${taskId}`);
        return {workPath: work.path, taskPath: null, failures};
    }
    validateWorkTask(repoRoot, taskId, relativePath, failures);
    return {workPath: work.path, taskPath, failures};
}

function readTaskFrontmatter(text: string, relativePath: string, failures: string[]): Record<string, unknown> | null {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text);
    if (!match) return null;
    try {
        const value = parseYaml(match[1]) as unknown;
        if (!isRecord(value)) failures.push(`Task frontmatter 必须是对象：${relativePath}`);
        return isRecord(value) ? value : null;
    } catch (error) {
        failures.push(`Task frontmatter 无法解析：${relativePath}：${String(error)}`);
        return null;
    }
}

/**
 * 校验所有 workspace 包的继承/覆盖规则、运行态边界和自治包归属资产。
 * 自治包保留项目 docs/Task/status；其他包可选建立同类专属资产，但不得复制根治理正文。
 */
export function verifyWorkspacePackageGovernance(repoRoot: string): string[] {
    const failures: string[] = [];
    const packagesRoot = resolve(repoRoot, "packages");
    const packageNames = existsSync(packagesRoot)
        ? readdirSync(packagesRoot, {withFileTypes: true}).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
        : [];
    const autonomous = new Set(["nb-history", "nb-workflow", "nb-memory", "nb-ui", "neuro-agent-harness", "llmlint"]);
    const manifestNames = new Map<string, string>();
    const manifests = new Map<string, Record<string, unknown>>();

    for (const packageName of packageNames) {
        const packageRoot = resolve(packagesRoot, packageName);
        const manifest = readJson<Record<string, unknown>>(resolve(packageRoot, "package.json"), failures, `packages/${packageName}/package.json`);
        if (!manifest) continue;
        manifests.set(packageName, manifest);
        if (typeof manifest.name !== "string" || !manifest.name) failures.push(`workspace包 package.json 缺少 name：packages/${packageName}/package.json`);
        else if (manifestNames.has(manifest.name)) failures.push(`workspace包 package name 重复：${manifest.name}`);
        else manifestNames.set(manifest.name, packageName);
    }

    for (const packageName of packageNames) {
        const packageRoot = resolve(packagesRoot, packageName);
        const manifest = manifests.get(packageName);
        if (!manifest) continue;
        for (const runtimeName of [".agent", ".local", ".worktree"] as const) {
            const runtimePath = resolve(packageRoot, runtimeName);
            if (!pathEntryExists(runtimePath)) continue;
            const relativePath = `packages/${packageName}/${runtimeName}`;
            if (!isGitIgnored(repoRoot, `${relativePath}/placeholder`)) failures.push(`包级运行态未被忽略：${relativePath}`);
            if (trackedPathExists(repoRoot, relativePath)) failures.push(`包级运行态被 Git 跟踪：${relativePath}`);
            if (runtimeName === ".worktree") failures.push(`临时 package worktree 尚未清理：${relativePath}`);
        }

        const agentsPath = resolve(packageRoot, "AGENTS.md");
        const taskRoot = resolve(packageRoot, ".agents", "tasks");
        const docsRoot = resolve(packageRoot, "docs");
        const statusPath = resolve(packageRoot, "PROJECT-STATUS.md");
        const hasLocalGovernance = pathEntryExists(agentsPath) || pathEntryExists(taskRoot) || pathEntryExists(docsRoot) || pathEntryExists(statusPath);
        if (hasLocalGovernance || autonomous.has(packageName)) {
            if (!pathEntryExists(agentsPath)) failures.push(`包级治理资产缺少 AGENTS.md：packages/${packageName}/AGENTS.md`);
            else if (!readFileSync(agentsPath, "utf8").includes("../../AGENTS.md")) failures.push(`包级 AGENTS.md 未引用根共享规则：packages/${packageName}/AGENTS.md`);
            failures.push(...verifyPackageTaskIds(packageRoot, packageName));
        }
        if (autonomous.has(packageName)) {
            for (const [entryPath, label] of [[taskRoot, ".agents/tasks"], [docsRoot, "docs"], [statusPath, "PROJECT-STATUS.md"]] as const) {
                if (!pathEntryExists(entryPath)) failures.push(`自治workspace包缺少归属资产：packages/${packageName}/${label}`);
            }
        }

        const dependencies = workspaceDependencies(manifest);
        for (const dependencyName of dependencies) {
            if (!manifestNames.has(dependencyName)) failures.push(`workspace依赖未对应本地包：packages/${packageName} -> ${dependencyName}`);
        }
        if (packageName !== "neuro-book" && dependencies.includes("@notnotype/neuro-book")) {
            failures.push(`自治或内部包不得依赖主应用：packages/${packageName} -> @notnotype/neuro-book`);
        }
        if (dependencies.includes("@notnotype/neuro-book-legacy")) {
            failures.push(`包不得依赖旧应用：packages/${packageName} -> @notnotype/neuro-book-legacy`);
        }
    }
    return failures;
}

function workspaceDependencies(manifest: Record<string, unknown>): string[] {
    const names = new Set<string>();
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        const value = manifest[field];
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        for (const [name, version] of Object.entries(value)) {
            if (typeof version === "string" && (version.startsWith("workspace:") || version.startsWith("file:../"))) names.add(name);
        }
    }
    return [...names];
}

function pathEntryExists(path: string): boolean {
    try {
        lstatSync(path);
        return true;
    } catch {
        return false;
    }
}

function verifyPackageTaskIds(packageRoot: string, packageName: string): string[] {
    const failures: string[] = [];
    const taskRoot = resolve(packageRoot, ".agents", "tasks");
    if (!pathEntryExists(taskRoot)) return failures;
    const ids = new Set<string>();
    const files = collectMarkdownFiles(taskRoot);
    for (const file of files) {
        const text = readFileSync(file, "utf8");
        for (const match of text.matchAll(/\btaskId:\s*["']?([A-Za-z0-9._-]+)["']?/gu)) {
            const taskId = match[1];
            if (ids.has(taskId)) failures.push(`自治workspace包Task编号重复：packages/${packageName}/${taskId}`);
            ids.add(taskId);
        }
    }
    return failures;
}
function trackedPathExists(repoRoot: string, relativePath: string): boolean {
    try {
        return Boolean(git(repoRoot, ["ls-files", "--", relativePath, `${relativePath}/`]).trim());
    } catch {
        return false;
    }
}

function collectMarkdownFiles(root: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(root, {withFileTypes: true})) {
        const path = resolve(root, entry.name);
        if (entry.isDirectory()) files.push(...collectMarkdownFiles(path));
        else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
    }
    return files;
}


function readJson<T>(path: string, failures: string[], label: string): T | null {
    try {
        return JSON.parse(readFileSync(path, "utf8")) as T;
    } catch (error) {
        failures.push(`${label} 不可读或 JSON 无效：${String(error)}`);
        return null;
    }
}

function isGitIgnored(repoRoot: string, relativePath: string): boolean {
    try {
        git(repoRoot, ["check-ignore", "--no-index", "-q", relativePath]);
        return true;
    } catch {
        return false;
    }
}

