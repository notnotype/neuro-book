import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {existsSync, lstatSync, readFileSync, readdirSync} from "node:fs";
import {dirname, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {resolveAgentAcceptanceRoot, resolveAgentCacheRoot, resolveAgentTempRoot, resolveAgentTestRoot, resolveAgentWorktreeRoot} from "@notnotype/neuro-book-test-support/paths";
import {parse as parseYaml} from "yaml";


const AGENT_WORKFLOW_PROFILE = "nbook.agent-skills/v1";
const AGENT_WORKFLOW_KINDS: Record<string, true> = {
    feedback: true,
    design: true,
    research: true,
    bug: true,
    feature: true,
    refactor: true,
    docs: true,
    release: true,
    migration: true,
};
const AGENT_WORKFLOW_CHECKS: Record<string, true> = {
    "focused-test": true,
    "regression-test": true,
    typecheck: true,
    build: true,
    "diff-check": true,
    smoke: true,
    browser: true,
    "security-review": true,
    "performance-baseline": true,
    "release-check": true,
    "docs-check": true,
    "governance-check": true,
};

const TASK_STATUSES: Record<string, true> = {
    planned: true,
    "in-progress": true,
    blocked: true,
    verifying: true,
    completed: true,
    abandoned: true,
};
const ACTIVE_TASK_STATUSES: Record<string, true> = {planned: true, "in-progress": true, blocked: true, verifying: true};
const TASK_COLLABORATION_SECTIONS = ["目标", "Agent 工作", "开发者参与", "任务产物", "修改计划", "完成门禁", "Leader 继续条件", "允许文件"] as const;
const LEGACY_TASKS_WITHOUT_AGENT_WORKFLOW: Record<string, true> = {
    "00149-monorepo-workspace-consolidation": true,
    "00150-monorepo-boundary-convergence": true,
    "00150-ui-spec-verification": true,
};
const LEGACY_TASKS_WITHOUT_CONTEXT: Record<string, true> = {
    "00158-notification-contrast-fix": true,
};

export const GOVERNANCE_NON_EMPTY_LINE_LIMITS = {
    "AGENTS.md": 220,
    ".omp/RULES.md": 80,
    "WATCHDOG.md": 40,
} as const;

type TaskMigrationMapping = {
    source: string;
    destination: string;
    sourceSha256: string;
    destinationSha256: string;
    kind: "file";
    linkRewrite: boolean;
};

type TaskMigrationIndex = {
    schema: string;
    sourceRevision: string;
    fileCount: number;
    manifestSha256: string;
    migratedAt: string;
    mappings: TaskMigrationMapping[];
    repositoryLinkRewrites: string[];
    preservedSourceFiles: string[];
    trackedFileCount: number;
    localOnlyFiles: string[];
};

type TaskMigrationMarker = {
    schema: string;
    sourceRevision: string;
    fileCount: number;
    manifestSha256: string;
    completedAt: string;
    repositoryLinkRewrites: string[];
    preservedSourceFiles: string[];
    trackedFileCount: number;
    localOnlyFiles: string[];
};

export const APPLICATION_TASK_OWNER_ROOT = "packages/neuro-book/.agents/tasks";
export const ROOT_TASK_OWNER_ROOT = ".agents/tasks";
export const TASK_OWNERSHIP_SCHEMA = "nbook.task-ownership/v1";

export type TaskOwnershipFile = {
    path: string;
    legacyDestination: string;
    sha256: string;
};

export type TaskOwnershipEntry = {
    taskId: string;
    ownerRoot: string;
    files: TaskOwnershipFile[];
};

export type TaskOwnershipManifest = {
    schema: string;
    ownerRoot: string;
    taskCount: number;
    fileCount: number;
    tasks: TaskOwnershipEntry[];
};

type SiblingResyncResolution = {
    schema: string;
    status: string;
    policy: {copyActions: number};
    inputs: Record<string, string>;
    projects: Record<string, {
        allowlist: number;
        exact: number;
        missing: unknown[];
        deletionCandidates: unknown[];
        decisions: Array<{kind: string; paths: string[]; action: string}>;
        unclassifiedAllowlistDifferences: number;
    }>;
    totals: {
        allowlist: number;
        exact: number;
        classifiedAllowlistDifferences: number;
        unclassifiedAllowlistDifferences: number;
        missing: number;
        deletionCandidates: number;
        copyActions: number;
    };
};

const SIBLING_RESYNC_INPUT_HASHES: Record<string, string> = {
    "sibling-import-manifest.json": "sha256:56a995fc67795985d887bfaf4086eb9c22c08adf8dd0b0a9c899d2219e3f0023",
    "manifest-allowlist-audit-v1.json": "sha256:158d5143fb4311671335793d17a1452ae4ff2c437774eb600bf5ad29d57af201",
    "source-immutability-comparison-v3.json": "sha256:a49151152a9c09fc4816468ea5cb5c94d3445af6ca04e167bc9899b833b3c3b4",
    "invalidated-reports.json": "sha256:699c488b3a4b2fcbed23a52d6860b33ddc6d1190646dca10184e934535a30e61",
};

const SIBLING_RESYNC_PROJECT_COUNTS: Record<string, {allowlist: number; exact: number; classified: number}> = {
    "nb-history": {allowlist: 28, exact: 25, classified: 3},
    "nb-workflow": {allowlist: 78, exact: 17, classified: 61},
    "nb-ui": {allowlist: 156, exact: 153, classified: 3},
    llmlint: {allowlist: 739, exact: 720, classified: 19},
    "neuro-agent-harness": {allowlist: 296, exact: 292, classified: 4},
    "nb-memory": {allowlist: 35, exact: 32, classified: 3},
};

const SIBLING_RESYNC_TOTALS = {
    allowlist: 1332,
    exact: 1239,
    classifiedAllowlistDifferences: 93,
    unclassifiedAllowlistDifferences: 0,
    missing: 0,
    deletionCandidates: 0,
    copyActions: 0,
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

/** 读取 Git attributes 解析出的 text 值，供整批迁移目标复用，避免每个文件启动 Git 进程。 */
export function readGitTextAttributes(repoRoot: string, relativePaths: readonly string[]): Map<string, string> {
    if (relativePaths.length === 0) return new Map();
    const input = Buffer.from(`${relativePaths.join("\0")}\0`, "utf8");
    const output = execFileSync("git", ["check-attr", "--stdin", "-z", "text"], {
        cwd: repoRoot,
        input,
        encoding: null,
        stdio: ["pipe", "pipe", "pipe"],
    });
    const fields = output.toString("utf8").split("\0");
    const attributes = new Map<string, string>();
    for (let index = 0; index + 2 < fields.length; index += 3) {
        const path = fields[index];
        if (path) attributes.set(path, fields[index + 2] ?? "unspecified");
    }
    return attributes;
}

/** 按 Git `text` 属性计算迁移 metadata SHA-256；仅 CRLF 归一化为 LF，lone CR 按 Git 语义保留或判 binary。 */
export function canonicalSha256(bytes: Uint8Array, textAttribute: string): string {
    if (textAttribute === "unset" || textAttribute === "unspecified") return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (textAttribute !== "set" && textAttribute !== "auto") throw new Error(`无法计算 canonical SHA-256：Git text 属性为 ${textAttribute}`);
    if (textAttribute === "auto" && isGitAutoBinary(bytes)) return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const canonicalBytes = new Uint8Array(bytes.length);
    let outputLength = 0;
    for (let index = 0; index < bytes.length; index += 1) {
        if (bytes[index] === 0x0d && bytes[index + 1] === 0x0a) {
            canonicalBytes[outputLength] = 0x0a;
            outputLength += 1;
            index += 1;
        } else {
            canonicalBytes[outputLength] = bytes[index];
            outputLength += 1;
        }
    }
    return `sha256:${createHash("sha256").update(canonicalBytes.subarray(0, outputLength)).digest("hex")}`;
}

function isGitAutoBinary(bytes: Uint8Array): boolean {
    let nul = 0;
    let loneCr = 0;
    let printable = 0;
    let nonPrintable = 0;
    for (let index = 0; index < bytes.length; index += 1) {
        const byte = bytes[index];
        if (byte === 0x0d) {
            if (bytes[index + 1] === 0x0a) index += 1;
            else loneCr += 1;
            continue;
        }
        if (byte === 0x0a) continue;
        if (byte === 0x7f) {
            nonPrintable += 1;
        } else if (byte < 0x20) {
            if (byte === 0x08 || byte === 0x09 || byte === 0x1b || byte === 0x0c) printable += 1;
            else {
                if (byte === 0) nul += 1;
                nonPrintable += 1;
            }
        } else {
            printable += 1;
        }
    }
    if (bytes.length > 0 && bytes[bytes.length - 1] === 0x1a) nonPrintable -= 1;
    return loneCr > 0 || nul > 0 || (printable >> 7) < nonPrintable;
}

export function hashCanonicalFile(repoRoot: string, relativePath: string, textAttributes: ReadonlyMap<string, string>): string {
    return canonicalSha256(readFileSync(resolve(repoRoot, relativePath)), textAttributes.get(relativePath) ?? "unspecified");
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

function packageTaskOwnerRoots(repoRoot: string): string[] {
    const roots = [ROOT_TASK_OWNER_ROOT, APPLICATION_TASK_OWNER_ROOT];
    const packagesRoot = resolve(repoRoot, "packages");
    if (!existsSync(packagesRoot) || !lstatSync(packagesRoot).isDirectory()) return roots;
    for (const entry of readdirSync(packagesRoot, {withFileTypes: true})) {
        if (!entry.isDirectory() || entry.name === "neuro-book") continue;
        const ownerRoot = `packages/${entry.name}/.agents/tasks`;
        if (hasDirectory(repoRoot, ownerRoot)) roots.push(ownerRoot);
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
        ".agents/tasks/.migration-complete",
        ".agents/tasks/legacy-index.json",
        ".agents/tasks/ownership.json",
        ".agents/skills/README.md",
        "packages/neuro-book/AGENTS.md",
        "scripts/AGENTS.md",
        "scripts/release/AGENTS.md",
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

/** 校验 sibling 导入差异均已归类，且迁移收口没有隐式复制或删除。 */
export function verifySiblingResyncResolution(repoRoot: string): string[] {
    const failures: string[] = [];
    const relativePath = ".agents/tasks/00149-monorepo-workspace-consolidation/evidences/s8-sibling-resync-resolution.json";
    const report = readJson<SiblingResyncResolution>(resolve(repoRoot, relativePath), failures, relativePath);
    if (!report) return failures;
    if (report.schema !== "nbook.sibling-resync-resolution/v1") failures.push("sibling resync resolution schema 不匹配");
    if (report.status !== "resolved-no-copy") failures.push(`sibling resync 尚未闭合：${report.status}`);
    for (const [name, expected] of Object.entries(SIBLING_RESYNC_INPUT_HASHES)) {
        if (report.inputs[name] !== expected) failures.push(`sibling resync 输入 hash 不匹配：${name}`);
    }
    const projectNames = Object.keys(report.projects).sort();
    const expectedProjectNames = Object.keys(SIBLING_RESYNC_PROJECT_COUNTS).sort();
    if (projectNames.join("\0") !== expectedProjectNames.join("\0")) {
        failures.push(`sibling resync 项目集合不匹配：${projectNames.join(",")}`);
    }
    let allowlist = 0;
    let exact = 0;
    let classified = 0;
    let unclassified = 0;
    let missing = 0;
    let deletionCandidates = 0;
    for (const [project, entry] of Object.entries(report.projects)) {
        const expected = SIBLING_RESYNC_PROJECT_COUNTS[project];
        allowlist += entry.allowlist;
        exact += entry.exact;
        missing += entry.missing.length;
        deletionCandidates += entry.deletionCandidates.length;
        unclassified += entry.unclassifiedAllowlistDifferences;
        let projectClassified = 0;
        for (const decision of entry.decisions) {
            if (decision.action !== "keep-target") failures.push(`sibling resync 存在非保留动作：${project}/${decision.kind}`);
            if (decision.kind !== "workspace-island-lockfile") projectClassified += decision.paths.length;
        }
        classified += projectClassified;
        if (expected && (entry.allowlist !== expected.allowlist || entry.exact !== expected.exact || projectClassified !== expected.classified)) {
            failures.push(`sibling resync 项目计数不匹配：${project}`);
        }
    }
    const actual = {allowlist, exact, classifiedAllowlistDifferences: classified, unclassifiedAllowlistDifferences: unclassified, missing, deletionCandidates};
    for (const [key, value] of Object.entries(actual)) {
        if (report.totals[key as keyof typeof actual] !== value) failures.push(`sibling resync 汇总不一致：${key}`);
    }
    for (const [key, expected] of Object.entries(SIBLING_RESYNC_TOTALS)) {
        if (report.totals[key as keyof typeof SIBLING_RESYNC_TOTALS] !== expected) failures.push(`sibling resync 固定总数不匹配：${key}`);
    }
    if (allowlist !== exact + classified + unclassified) failures.push("sibling resync allowlist 分类算术不闭合");
    if (unclassified !== 0 || missing !== 0 || deletionCandidates !== 0) failures.push("sibling resync 仍含未分类、缺失或删除候选");
    if (report.policy.copyActions !== 0 || report.totals.copyActions !== 0) failures.push("sibling resync 仍声明复制动作");
    return failures;
}

/** 拒绝重新引入迁移前根应用、同步脚本或第二份边界规范。 */
export function verifyMonorepoCutover(repoRoot: string): string[] {
    const failures: string[] = [];
    const tracked = new Set(git(repoRoot, ["ls-files"]).split(/\r?\n/u).filter(Boolean));
    for (const path of tracked) {
        if (/^(?:app|server|shared|profile-sdk|variable-sdk|world-engine|prisma)(?:\/|$)/u.test(path)) failures.push(`旧根应用路径重新出现：${path}`);
    }
    for (const path of [
        "nuxt.config.ts",
        "prisma.config.ts",
        "vitest.config.ts",
        "uno.config.ts",
        "docs/specs/architecture/monorepo-boundaries.md",
        "scripts/cli/sync-nb-history.ts",
        "scripts/cli/sync-nb-workflow.ts",
        "scripts/cli/sync-llmlint-skill.ts",
    ]) {
        if (tracked.has(path)) failures.push(`迁移前入口重新出现：${path}`);
    }
    const rootManifest = readJson<{version?: unknown; scripts?: Record<string, string>}>(resolve(repoRoot, "package.json"), failures, "package.json");
    if (!rootManifest) return failures;
    if (rootManifest.version !== undefined) failures.push("根 workspace orchestrator 不得声明产品 version");
    const forbiddenScripts = ["dev", "dev:runtime", "build", "typecheck", "test", "generate", "migration:check", "sync:nb-history", "sync:nb-workflow"];
    for (const name of forbiddenScripts) if (rootManifest.scripts?.[name]) failures.push(`根 workspace 保留应用或同步命令：${name}`);
    return failures;
}

/** 应用只允许 Source Dev 通过 #scripts 读取根 workspace locator。 */
export function verifyApplicationScriptBoundary(repoRoot: string): string[] {
    const failures: string[] = [];
    const applicationRoot = resolve(repoRoot, "packages", "neuro-book");
    const allowedPath = "scripts/cli/source-dev.ts";
    const allowedImport = "#scripts/utils/workspace-roots";
    for (const relativePath of walkSourceFiles(applicationRoot)) {
        const text = readFileSync(resolve(applicationRoot, relativePath), "utf8");
        const imports = [...text.matchAll(/["'](#scripts\/[^"']+)["']/gu)].map((match) => match[1]);
        if (imports.length === 0) continue;
        if (relativePath !== allowedPath || imports.some((specifier) => specifier !== allowedImport)) {
            failures.push(`应用跨根 #scripts 导入违规：packages/neuro-book/${relativePath} -> ${imports.join(", ")}`);
        }
    }
    return failures;
}

function walkSourceFiles(root: string, relativeRoot = ""): string[] {
    const absoluteRoot = resolve(root, relativeRoot);
    if (!existsSync(absoluteRoot)) return [];
    const files: string[] = [];
    for (const entry of readdirSync(absoluteRoot, {withFileTypes: true})) {
        const relativePath = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            if ([".nuxt", ".output", "node_modules", ".compiled", ".staging"].includes(entry.name)) continue;
            files.push(...walkSourceFiles(root, relativePath));
        } else if (/\.(?:ts|tsx|js|mjs|cjs)$/u.test(entry.name)) {
            files.push(relativePath);
        }
    }
    return files;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeTaskRelativePath(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.includes("\0") || value.startsWith("/") || /^[A-Za-z]:/u.test(value)) return false;
    const segments = value.split("/");
    return !segments.some((segment) => segment === "" || segment === "." || segment === "..");
}

function taskIdSequence(taskId: string): {value: number; width: number} | null {
    const sequence = /^(\d{2,5})-[A-Za-z0-9][A-Za-z0-9._-]*$/u.exec(taskId)?.[1];
    if (!sequence) return null;
    const value = Number(sequence);
    return Number.isInteger(value) && value >= 1 ? {value, width: sequence.length} : null;
}

function validateTaskOwnershipManifest(manifest: TaskOwnershipManifest, failures: string[]): void {
    if (manifest.schema !== TASK_OWNERSHIP_SCHEMA) failures.push("ownership.json schema 不匹配");
    if (manifest.ownerRoot !== APPLICATION_TASK_OWNER_ROOT) failures.push("ownership.json ownerRoot 不匹配");
    if (!Number.isInteger(manifest.taskCount)) failures.push("ownership.json 缺少整数 taskCount");
    if (!Number.isInteger(manifest.fileCount)) failures.push("ownership.json 缺少整数 fileCount");
    if (!Array.isArray(manifest.tasks)) {
        failures.push("ownership.json tasks 不是数组");
        return;
    }
    const taskIds = new Set<string>();
    const paths = new Set<string>();
    let fileCount = 0;
    for (const rawEntry of manifest.tasks) {
        if (!isRecord(rawEntry)) {
            failures.push("ownership.json 包含无效 Task entry");
            continue;
        }
        const taskId = rawEntry.taskId;
        const ownerRoot = rawEntry.ownerRoot;
        const files = rawEntry.files;
        if (typeof taskId !== "string" || !taskIdSequence(taskId)) failures.push(`ownership Task 标识无效：${String(taskId)}`);
        else if (taskIds.has(taskId)) failures.push(`ownership Task 编号重复：${taskId}`);
        else taskIds.add(taskId);
        if (ownerRoot !== APPLICATION_TASK_OWNER_ROOT) failures.push(`ownership Task ownerRoot 无效：${String(taskId)}`);
        if (!Array.isArray(files)) {
            failures.push(`ownership Task files 不是数组：${String(taskId)}`);
            continue;
        }
        for (const rawFile of files) {
            fileCount += 1;
            if (!isRecord(rawFile)) {
                failures.push(`ownership Task 文件 entry 无效：${String(taskId)}`);
                continue;
            }
            const path = rawFile.path;
            const legacyDestination = rawFile.legacyDestination;
            const sha256 = rawFile.sha256;
            if (!isSafeTaskRelativePath(path) || !path.startsWith(`${String(taskId)}/`)) failures.push(`ownership Task path 无效：${String(path)}`);
            if (typeof path === "string" && legacyDestination !== `.agents/tasks/${path}`) failures.push(`ownership legacyDestination 不匹配：${String(path)}`);
            if (typeof path === "string" && paths.has(path)) failures.push(`ownership 文件路径重复：${path}`);
            else if (typeof path === "string") paths.add(path);
            if (typeof sha256 !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(sha256)) failures.push(`ownership SHA-256 无效：${String(path)}`);
        }
    }
    if (manifest.taskCount !== taskIds.size) failures.push(`ownership taskCount 与 tasks 不一致：${String(manifest.taskCount)} != ${String(taskIds.size)}`);
    if (manifest.fileCount !== fileCount) failures.push(`ownership fileCount 与 files 不一致：${String(manifest.fileCount)} != ${String(fileCount)}`);
}
export function readTaskOwnershipManifest(repoRoot: string): {manifest: TaskOwnershipManifest | null; failures: string[]} {
    const failures: string[] = [];
    const manifest = readJson<TaskOwnershipManifest>(resolve(repoRoot, ".agents", "tasks", "ownership.json"), failures, "ownership.json");
    if (!manifest) return {manifest: null, failures};
    validateTaskOwnershipManifest(manifest, failures);
    return {manifest: failures.length === 0 ? manifest : null, failures};
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

export function resolveLegacyTaskReadmePath(repoRoot: string, taskId: string): {path: string | null; checkedRoots: string[]; failures: string[]} {
    const loaded = readTaskOwnershipManifest(repoRoot);
    if (!loaded.manifest) return {path: null, checkedRoots: [], failures: loaded.failures};
    const entry = loaded.manifest.tasks.find((candidate) => candidate.taskId === taskId);
    const ownerRoot = entry?.ownerRoot ?? ROOT_TASK_OWNER_ROOT;
    const checkedRoots = [ownerRoot];
    const relativePath = `${ownerRoot}/${taskId}/README.md`;
    const archived = ownerRoot === ROOT_TASK_OWNER_ROOT && /^archived\/[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(taskId);
    const failures: string[] = [];
    const legacyIdentity = !archived && isHistoricalTaskShape(ownerRoot, taskId) ? readLegacyTaskIdentitySet(repoRoot, failures) : null;
    if (!archived && !taskIdentity(ownerRoot, taskId, loaded.manifest, legacyIdentity).valid) failures.push(`Task 标识无效：${taskId}`);
    const candidate = resolve(repoRoot, relativePath);
    return {path: failures.length === 0 && hasFile(repoRoot, relativePath) ? candidate : null, checkedRoots, failures};
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
function taskAgentWorkflowReadmePaths(repoRoot: string, ownership: TaskOwnershipManifest): string[] {
    const rootTaskRoot = resolve(repoRoot, ROOT_TASK_OWNER_ROOT);
    const rootTaskIds = existsSync(rootTaskRoot)
        ? readdirSync(rootTaskRoot, {withFileTypes: true}).filter((entry) => entry.isDirectory() && entry.name !== "archived").map((entry) => entry.name)
        : [];
    return [
        ...rootTaskIds.map((taskId) => `${ROOT_TASK_OWNER_ROOT}/${taskId}/README.md`),
        ...ownership.tasks.map((entry) => `${APPLICATION_TASK_OWNER_ROOT}/${entry.taskId}/README.md`),
    ];
}

function hasTaskAgentWorkflowProfile(repoRoot: string): boolean {
    const ownershipLoaded = readTaskOwnershipManifest(repoRoot);
    if (!ownershipLoaded.manifest) return false;
    for (const relativePath of taskAgentWorkflowReadmePaths(repoRoot, ownershipLoaded.manifest)) {
        if (!hasFile(repoRoot, relativePath)) continue;
        const metadata = readTaskFrontmatter(readRepoText(repoRoot, relativePath), relativePath, []);
        if (metadata?.schema === "nbook.task/v1" && Object.hasOwn(metadata, "agentWorkflow")) return true;
    }
    return false;
}

function rootTaskSequence(taskId: string): {value: number; width: number} | null {
    const sequence = taskIdSequence(taskId);
    return sequence && (sequence.width <= 3 || sequence.width === 5) ? sequence : null;
}

function isTransitionTaskId(taskId: string): boolean {
    return Object.hasOwn(LEGACY_TASKS_WITHOUT_AGENT_WORKFLOW, taskId);
}

function isCurrentTaskContract(ownerRoot: string, taskId: string): boolean {
    const sequence = taskIdSequence(taskId);
    if (!sequence) return false;
    if (ownerRoot === APPLICATION_TASK_OWNER_ROOT) return sequence.value >= 149;
    return ownerRoot === ROOT_TASK_OWNER_ROOT && sequence.width === 5 && sequence.value >= 152;
}

function isHistoricalTaskShape(ownerRoot: string, taskId: string): boolean {
    const sequence = ownerRoot === ROOT_TASK_OWNER_ROOT ? rootTaskSequence(taskId) : taskIdSequence(taskId);
    return Boolean(sequence && sequence.value <= 148);
}

type MarkdownFence = {character: "`" | "~"; length: number};

function markdownFenceMarker(line: string): (MarkdownFence & {trailing: string}) | null {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    const marker = match?.[1] ?? "";
    if (!marker) return null;
    return {character: marker[0] as "`" | "~", length: marker.length, trailing: match?.[2] ?? ""};
}

function closesMarkdownFence(fence: MarkdownFence, marker: MarkdownFence & {trailing: string}): boolean {
    return marker.character === fence.character && marker.length >= fence.length && marker.trailing.trim().length === 0;
}

function stripMarkdownHtmlComments(text: string): string {
    const output: string[] = [];
    let fence: MarkdownFence | null = null;
    let inComment = false;
    for (const rawLine of text.split(/\r?\n/u)) {
        const fenceMarker = markdownFenceMarker(rawLine);
        if (fence) {
            output.push(rawLine);
            if (fenceMarker && closesMarkdownFence(fence, fenceMarker)) fence = null;
            continue;
        }
        if (!inComment && fenceMarker) {
            fence = fenceMarker;
            output.push(rawLine);
            continue;
        }
        let visible = "";
        let offset = 0;
        while (offset < rawLine.length) {
            if (inComment) {
                const end = rawLine.indexOf("-->", offset);
                if (end < 0) {
                    offset = rawLine.length;
                    break;
                }
                inComment = false;
                offset = end + 3;
                continue;
            }
            const start = rawLine.indexOf("<!--", offset);
            if (start < 0) {
                visible += rawLine.slice(offset);
                break;
            }
            visible += rawLine.slice(offset, start);
            inComment = true;
            offset = start + 4;
        }
        output.push(visible);
    }
    return output.join("\n");
}

function markdownListItems(section: string | null): string[] {
    if (!section) return [];
    const items: string[] = [];
    let fence: MarkdownFence | null = null;
    for (const line of stripMarkdownHtmlComments(section).split(/\r?\n/u)) {
        const fenceMarker = markdownFenceMarker(line);
        if (fence) {
            if (fenceMarker && closesMarkdownFence(fence, fenceMarker)) fence = null;
            continue;
        }
        if (fenceMarker) {
            fence = fenceMarker;
            continue;
        }
        if (/^(?: {4}|\t)/u.test(line)) continue;
        const match = /^ {0,3}[-*+]\s+(.+?)\s*$/u.exec(line);
        if (!match) continue;
        const raw = (match[1] ?? "").trim();
        const wrapped = /^`([^`]+)`$/u.exec(raw);
        const item = (wrapped?.[1] ?? raw).trim();
        if (item.length > 0) items.push(item);
    }
    return items;
}

function normalizedDesignType(section: string | null): string | null {
    if (!section) return null;
    const lines = section.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    if (lines.length !== 1) return null;
    const value = (lines[0] ?? "").replace(/^[-*+]\s+/u, "").trim();
    return value.length >= 1 && value.length <= 64 && !/[\p{Cc}\p{Cf}]/u.test(value) ? value.toLowerCase() : null;
}


function isDesignOutputPath(repoRoot: string, path: string): boolean {
    if (!isSafeTaskRelativePath(path) || !path.endsWith(".md")) return false;
    const rootMatch = /^(docs\/(?:proposals|specs))\//u.exec(path);
    const packageMatch = /^(packages\/[^/]+\/docs\/(?:proposals|specs))\//u.exec(path);
    const allowedRoot = rootMatch?.[1] ?? packageMatch?.[1];
    return Boolean(allowedRoot && isAbsoluteInside(resolve(repoRoot, path), resolve(repoRoot, allowedRoot)));
}
function isTaskReportPath(readmePath: string, path: string): boolean {
    const taskRoot = readmePath.replace(/\/README\.md$/u, "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`^${taskRoot}/(?:walkthroughs|evidences)/[^/]+$`, "u").test(path);
}


function markdownSection(text: string, title: string): string | null {
    const lines = stripMarkdownHtmlComments(text).split(/\r?\n/u);
    const heading = `## ${title}`;
    let start = -1;
    let fence: MarkdownFence | null = null;
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        const fenceMarker = markdownFenceMarker(line);
        if (fence) {
            if (fenceMarker && closesMarkdownFence(fence, fenceMarker)) fence = null;
            continue;
        }
        if (fenceMarker) {
            fence = fenceMarker;
            continue;
        }
        if (!/^ {0,3}##\s+/u.test(line)) continue;
        if (line.trim() === heading) {
            start = index;
            break;
        }
    }
    if (start < 0) return null;
    const content: string[] = [];
    fence = null;
    for (let index = start + 1; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        const fenceMarker = markdownFenceMarker(line);
        if (fence) {
            if (fenceMarker && closesMarkdownFence(fence, fenceMarker)) fence = null;
            content.push(line);
            continue;
        }
        if (fenceMarker) {
            fence = fenceMarker;
            content.push(line);
            continue;
        }
        if (!fence && /^ {0,3}#{1,2}\s+/u.test(line)) break;
        content.push(line);
    }
    while (content.length > 0 && (content[0] ?? "").trim().length === 0) content.shift();
    while (content.length > 0 && (content.at(-1) ?? "").trim().length === 0) content.pop();
    const value = content.join("\n");
    return value.length > 0 ? value : null;
}

function validateAgentWorkflow(repoRoot: string, relativePath: string, readme: string, raw: unknown, failures: string[]): void {
    if (!isRecord(raw)) {
        failures.push(`Task agentWorkflow 必须是对象：${relativePath}`);
        return;
    }
    if (raw.profile !== AGENT_WORKFLOW_PROFILE) failures.push(`Task agentWorkflow.profile 无效：${relativePath}`);

    const kind = raw.kind;
    if (typeof kind !== "string" || !Object.hasOwn(AGENT_WORKFLOW_KINDS, kind)) failures.push(`Task agentWorkflow.kind 无效：${relativePath}`);

    const routes = raw.routes;
    if (!Array.isArray(routes) || routes.length === 0) {
        failures.push(`Task agentWorkflow.routes 必须是非空数组：${relativePath}`);
    } else {
        const seenRoutes = new Set<string>();
        routes.forEach((route, index) => {
            if (typeof route !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(route)) {
                failures.push(`Task agentWorkflow.routes[${String(index)}] 无效：${relativePath}`);
                return;
            }
            if (seenRoutes.has(route)) failures.push(`Task agentWorkflow.routes 含重复项：${relativePath}`);
            seenRoutes.add(route);
        });
    }

    if (kind === "design") {
        const rawDesignType = markdownSection(readme, "设计类型");
        const designType = normalizedDesignType(rawDesignType);
        const outputs = markdownListItems(markdownSection(readme, "设计产物"));
        const allowedFiles = markdownListItems(markdownSection(readme, "允许文件"));
        if (!designType) failures.push(`design Task 设计类型无效：${relativePath}`);
        if (outputs.length !== 1 || !isDesignOutputPath(repoRoot, outputs[0] ?? "")) failures.push(`design Task 必须有唯一 Proposal/Spec 设计产物：${relativePath}`);
        if (!markdownSection(readme, "决策范围")) failures.push(`design Task 缺少决策范围：${relativePath}`);
        if (allowedFiles.length === 0) failures.push(`design Task 缺少允许文件：${relativePath}`);
        const output = outputs[0];
        for (const path of allowedFiles) {
            if (!isSafeTaskRelativePath(path) || (path !== output && !isTaskReportPath(relativePath, path))) failures.push(`design Task 允许文件越界：${relativePath} -> ${path}`);
        }
        if (output && !allowedFiles.includes(output)) failures.push(`design Task 允许文件缺少设计产物：${relativePath}`);
        if (designType === "api" && (!Array.isArray(routes) || !routes.includes("api-and-interface-design"))) {
            failures.push(`API design Task 缺少 api-and-interface-design：${relativePath}`);
        }
    }
    if (kind === "research") {
        const outputs = markdownListItems(markdownSection(readme, "研究产物"));
        const allowedFiles = markdownListItems(markdownSection(readme, "允许文件"));
        if (!markdownSection(readme, "研究问题")) failures.push(`research Task 缺少研究问题：${relativePath}`);
        if (outputs.length === 0) failures.push(`research Task 缺少研究产物：${relativePath}`);
        if (!markdownSection(readme, "决策范围")) failures.push(`research Task 缺少决策范围：${relativePath}`);
        for (const path of outputs) {
            if (!isSafeTaskRelativePath(path) || !isTaskReportPath(relativePath, path)) failures.push(`research Task 研究产物越界：${relativePath} -> ${path}`);
            if (!allowedFiles.includes(path)) failures.push(`research Task 允许文件缺少研究产物：${relativePath} -> ${path}`);
        }
        if (allowedFiles.length === 0) failures.push(`research Task 缺少允许文件：${relativePath}`);
        for (const path of allowedFiles) {
            if (!isSafeTaskRelativePath(path) || !outputs.includes(path)) failures.push(`research Task 允许文件越界：${relativePath} -> ${path}`);
        }
    }

    const verification = raw.verification;
    if (!isRecord(verification)) {
        failures.push(`Task agentWorkflow.verification 必须是对象：${relativePath}`);
        return;
    }
    const required = verification.required;
    const requiredValues = new Set<string>();
    if (!Array.isArray(required) || required.length === 0) {
        failures.push(`Task verification.required 必须是非空数组：${relativePath}`);
    } else {
        required.forEach((check, index) => {
            if (typeof check !== "string" || !Object.hasOwn(AGENT_WORKFLOW_CHECKS, check)) {
                failures.push(`Task verification.required[${String(index)}] 无效：${relativePath}`);
                return;
            }
            if (requiredValues.has(check)) failures.push(`Task verification.required 含重复项：${relativePath}`);
            requiredValues.add(check);
        });
    }

    if (!("notRun" in verification)) {
        failures.push(`Task verification.notRun 必须显式提供：${relativePath}`);
        return;
    }
    const notRun = verification.notRun;
    if (!Array.isArray(notRun)) {
        failures.push(`Task verification.notRun 必须是数组：${relativePath}`);
        return;
    }
    const notRunValues = new Set<string>();
    notRun.forEach((entry, index) => {
        if (!isRecord(entry)) {
            failures.push(`Task verification.notRun[${String(index)}] 必须是对象：${relativePath}`);
            return;
        }
        const check = entry.check;
        const reason = entry.reason;
        if (typeof check !== "string" || !Object.hasOwn(AGENT_WORKFLOW_CHECKS, check)) failures.push(`Task verification.notRun[${String(index)}] check 无效：${relativePath}`);
        if (typeof reason !== "string" || reason.trim().length === 0) failures.push(`Task verification.notRun[${String(index)}] 缺少非空 reason：${relativePath}`);
        if (typeof check === "string") {
            if (notRunValues.has(check)) failures.push(`Task verification.notRun 含重复项：${relativePath}`);
            notRunValues.add(check);
            if (requiredValues.has(check)) failures.push(`Task verification.required 与 verification.notRun 重叠：${relativePath}`);
        }
    });
}

function isTaskMigrationMapping(value: unknown): value is TaskMigrationMapping {
    return isRecord(value)
        && typeof value.source === "string"
        && typeof value.destination === "string"
        && typeof value.sourceSha256 === "string"
        && /^sha256:[0-9a-f]{64}$/u.test(value.sourceSha256)
        && typeof value.destinationSha256 === "string"
        && /^sha256:[0-9a-f]{64}$/u.test(value.destinationSha256)
        && value.kind === "file"
        && typeof value.linkRewrite === "boolean";
}

type LegacyTaskIdentity = {taskIds: Set<string>; destinations: Set<string>};

function readLegacyTaskIdentitySet(repoRoot: string, failures: string[]): LegacyTaskIdentity | null {
    const localFailures: string[] = [];
    const fail = (): null => {
        failures.push(...localFailures);
        return null;
    };
    const indexPath = ".agents/tasks/legacy-index.json";
    const markerPath = ".agents/tasks/.migration-complete";
    let indexCommit: string;
    let markerCommit: string;
    let index: TaskMigrationIndex;
    let marker: TaskMigrationMarker;
    try {
        indexCommit = git(repoRoot, ["log", "--diff-filter=A", "--format=%H", "--reverse", "--", indexPath]).split(/\r?\n/u)[0] ?? "";
        markerCommit = git(repoRoot, ["log", "--diff-filter=A", "--format=%H", "--reverse", "--", markerPath]).split(/\r?\n/u)[0] ?? "";
        if (!indexCommit || indexCommit !== markerCommit) {
            localFailures.push("历史 Task 迁移缺少唯一共同密封提交");
            return fail();
        }
        const parsedIndex = JSON.parse(git(repoRoot, ["show", `${indexCommit}:${indexPath}`])) as unknown;
        const parsedMarker = JSON.parse(git(repoRoot, ["show", `${markerCommit}:${markerPath}`])) as unknown;
        if (!isRecord(parsedIndex) || !isRecord(parsedMarker)) {
            localFailures.push("历史 Task 迁移密封快照结构无效");
            return fail();
        }
        index = parsedIndex as TaskMigrationIndex;
        marker = parsedMarker as TaskMigrationMarker;
    } catch (error) {
        localFailures.push(`历史 Task 迁移密封快照不可读：${String(error)}`);
        return fail();
    }
    if (index.schema !== "nbook.task-migration-index/v1" || marker.schema !== "nbook.task-migration/v1") localFailures.push("历史 Task 迁移 schema 不匹配");
    if (index.sourceRevision !== marker.sourceRevision || index.manifestSha256 !== marker.manifestSha256) localFailures.push("历史 Task 迁移 index/marker 不一致");
    if (!Array.isArray(index.mappings) || !Array.isArray(index.repositoryLinkRewrites) || !Array.isArray(index.preservedSourceFiles)) localFailures.push("历史 Task 迁移密封 index 结构无效");
    if (localFailures.length > 0) return fail();
    if (!index.mappings.every(isTaskMigrationMapping)) {
        localFailures.push("历史 Task 迁移密封 mapping 结构无效");
        return fail();
    }
    const currentIndex = readJson<TaskMigrationIndex>(resolve(repoRoot, indexPath), localFailures, "当前 legacy-index.json");
    const currentMarker = readJson<TaskMigrationMarker>(resolve(repoRoot, markerPath), localFailures, "当前 .migration-complete");
    if (!currentIndex || !currentMarker) return fail();
    if (currentIndex.schema !== index.schema
        || currentMarker.schema !== marker.schema
        || currentIndex.sourceRevision !== index.sourceRevision
        || currentMarker.sourceRevision !== index.sourceRevision
        || currentIndex.manifestSha256 !== currentMarker.manifestSha256
        || !Array.isArray(currentIndex.mappings)) {
        localFailures.push("当前历史 Task 迁移元数据与密封身份不一致");
        return fail();
    }
    if (!currentIndex.mappings.every(isTaskMigrationMapping)) {
        localFailures.push("当前历史 Task 迁移 mapping 结构无效");
        return fail();
    }
    const identityProjection = (mapping: TaskMigrationMapping): string => `${mapping.source}\0${mapping.destination}\0${mapping.kind}\0${String(mapping.linkRewrite)}`;
    const sealedProjection = index.mappings.map(identityProjection).sort();
    const currentProjection = currentIndex.mappings.map(identityProjection).sort();
    if (JSON.stringify(currentProjection) !== JSON.stringify(sealedProjection)) {
        localFailures.push("当前历史 Task 迁移 mapping 身份投影漂移");
        return fail();
    }
    const manifest = {schema: "nbook.task-migration-manifest/v1", sourceRevision: index.sourceRevision, mappings: index.mappings, repositoryLinkRewrites: index.repositoryLinkRewrites, preservedSourceFiles: index.preservedSourceFiles};
    const manifestSha256 = `sha256:${createHash("sha256").update(JSON.stringify(manifest)).digest("hex")}`;
    if (manifestSha256 !== index.manifestSha256) {
        localFailures.push("历史 Task 迁移密封 manifest SHA-256 不一致");
        return fail();
    }
    let baselineReadmes: Set<string>;
    try {
        baselineReadmes = new Set(git(repoRoot, ["ls-tree", "-r", "--name-only", index.sourceRevision, "--", "docs/tasks"])
            .split(/\r?\n/u)
            .filter((path) => /^docs\/tasks\/[^/]+\/README\.md$/u.test(path)));
    } catch (error) {
        localFailures.push(`历史 Task sourceRevision 无法读取：${String(error)}`);
        return fail();
    }
    const taskIds = new Set<string>();
    const destinations = new Set<string>();
    const sources = new Set<string>();
    for (const mapping of index.mappings) {
        const match = /^\.agents\/tasks\/([^/]+)\/README\.md$/u.exec(mapping.destination);
        if (!match || mapping.source !== `docs/tasks/${match[1]}/README.md` || !baselineReadmes.has(mapping.source)) continue;
        if (sources.has(mapping.source) || destinations.has(mapping.destination)) {
            localFailures.push(`历史 Task 迁移密封 mapping 重复：${mapping.source}`);
            continue;
        }
        sources.add(mapping.source);
        taskIds.add(match[1]);
        destinations.add(mapping.destination);
    }
    return localFailures.length > 0 ? fail() : {taskIds, destinations};
}
function taskIdentity(
    ownerRoot: string,
    taskId: string,
    ownership: TaskOwnershipManifest,
    legacyIdentity: LegacyTaskIdentity | null,
): {currentContract: boolean; valid: boolean} {
    const currentContract = isCurrentTaskContract(ownerRoot, taskId);
    const transitionTask = ownerRoot === ROOT_TASK_OWNER_ROOT && isTransitionTaskId(taskId);
    let historicalTask = false;
    if (isHistoricalTaskShape(ownerRoot, taskId)) {
        historicalTask = Boolean(legacyIdentity?.taskIds.has(taskId));
        if (historicalTask && ownerRoot === APPLICATION_TASK_OWNER_ROOT) {
            const entry = ownership.tasks.find((candidate) => candidate.taskId === taskId);
            historicalTask = Boolean(entry?.files.some((file) => file.path === `${taskId}/README.md` && legacyIdentity?.destinations.has(file.legacyDestination)));
        }
    }
    return {currentContract, valid: historicalTask || transitionTask || currentContract};
}

function isPositiveIssueId(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function validateIssueContract(relativePath: string, metadata: Record<string, unknown>, failures: string[]): void {
    if (!Object.hasOwn(metadata, "actionIssueId") || (metadata.actionIssueId !== null && !isPositiveIssueId(metadata.actionIssueId))) {
        failures.push(`Task actionIssueId 必须是正整数或 null：${relativePath}`);
    }
    if (Object.hasOwn(metadata, "issueRequired")) failures.push(`Task 禁止字段 issueRequired：${relativePath}`);
}

function validateTaskCollaborationContract(relativePath: string, readme: string, status: unknown, failures: string[]): void {
    if (typeof status !== "string" || !Object.hasOwn(ACTIVE_TASK_STATUSES, status)) return;
    for (const section of TASK_COLLABORATION_SECTIONS) {
        if (!markdownSection(readme, section)) failures.push(`Task 缺少${section}：${relativePath}`);
    }
}

const ACTIVE_DESIGN_STATUSES: Record<string, true> = {planned: true, "in-progress": true, blocked: true, verifying: true};
const DESIGN_BASELINE_PATTERN = /^\s*-?\s*(?:基线|baseline)\s+revision[：:]\s*`?([0-9a-f]{40})`?\s*$/iu;

type DesignDiffContract = {
    baseline: string;
    end: string | null;
    output: string;
    readmePath: string;
    worktreeId: string | null;
    branchId: string | null;
};

function taskWorkflowKind(metadata: Record<string, unknown>): unknown {
    return isRecord(metadata.agentWorkflow) ? metadata.agentWorkflow.kind : undefined;
}

function readDesignBaseline(context: string): {revision: string | null; count: number} {
    const revisions = context.split(/\r?\n/u)
        .map((line) => DESIGN_BASELINE_PATTERN.exec(line)?.[1])
        .filter((revision): revision is string => revision !== undefined);
    return {revision: revisions.length === 1 ? revisions[0] ?? null : null, count: revisions.length};
}

function designDiffContract(repoRoot: string, relativePath: string, metadata: Record<string, unknown>, failures: string[]): DesignDiffContract | null {
    const currentKind = taskWorkflowKind(metadata);
    const currentActiveDesign = currentKind === "design" && typeof metadata.status === "string" && Object.hasOwn(ACTIVE_DESIGN_STATUSES, metadata.status);
    let commits: string[];
    try {
        commits = git(repoRoot, ["log", "--format=%H", "--reverse", "--", relativePath]).split(/\r?\n/u).filter(Boolean);
    } catch (error) {
        if (currentActiveDesign) failures.push(`design Task 基线历史无法读取：${relativePath}：${String(error)}`);
        return null;
    }
    let sealedCommit: string | null = null;
    let sealedReadme: string | null = null;
    let sealedMetadata: Record<string, unknown> | null = null;
    let end: string | null = null;
    let reopened = false;
    for (const commit of commits) {
        let historicalReadme: string;
        try {
            historicalReadme = git(repoRoot, ["show", `${commit}:${relativePath}`]);
        } catch {
            if (sealedCommit && !end) end = commit;
            continue;
        }
        const historicalFailures: string[] = [];
        const historicalMetadata = readTaskFrontmatter(historicalReadme, relativePath, historicalFailures);
        const activeDesign = historicalMetadata
            && taskWorkflowKind(historicalMetadata) === "design"
            && typeof historicalMetadata.status === "string"
            && Object.hasOwn(ACTIVE_DESIGN_STATUSES, historicalMetadata.status);
        if (!sealedCommit && activeDesign) {
            sealedCommit = commit;
            sealedReadme = historicalReadme;
            sealedMetadata = historicalMetadata;
        } else if (sealedCommit && !end && !activeDesign) {
            end = commit;
        } else if (end && activeDesign) {
            reopened = true;
        }
    }
    if (reopened || (end && currentActiveDesign)) {
        failures.push(`design Task 已结束后重新激活：${relativePath}`);
        return null;
    }
    if (!sealedCommit || !sealedReadme || !sealedMetadata) {
        if (currentActiveDesign) failures.push(`design Task 缺少已密封基线合同：${relativePath}`);
        return null;
    }
    if (!end && currentKind !== "design") failures.push(`design Task 基线身份漂移：${relativePath}`);
    const contextPath = relativePath.replace(/README\.md$/u, "context.md");
    let sealedContext: string;
    try {
        sealedContext = git(repoRoot, ["show", `${sealedCommit}:${contextPath}`]);
    } catch (error) {
        failures.push(`design Task 密封 context 不可达：${relativePath} -> ${sealedCommit}：${String(error)}`);
        return null;
    }
    const parsed = readDesignBaseline(sealedContext);
    if (!parsed.revision || parsed.count !== 1) {
        failures.push(`design Task 密封合同缺少唯一基线 revision：${relativePath} -> ${sealedCommit}`);
        return null;
    }
    try {
        git(repoRoot, ["cat-file", "-e", `${parsed.revision}^{commit}`]);
    } catch (error) {
        failures.push(`design Task 基线不可达：${relativePath} -> ${parsed.revision}：${String(error)}`);
        return null;
    }
    try {
        git(repoRoot, ["merge-base", "--is-ancestor", parsed.revision, sealedCommit]);
        if (parsed.revision === sealedCommit) throw new Error("baseline equals sealed commit");
    } catch {
        failures.push(`design Task 基线不是密封合同的严格祖先：${relativePath} -> ${parsed.revision}`);
        return null;
    }
    const outputs = markdownListItems(markdownSection(sealedReadme, "设计产物"));
    const output = outputs.length === 1 && isDesignOutputPath(repoRoot, outputs[0] ?? "") ? outputs[0] ?? null : null;
    if (!output) {
        failures.push(`design Task 基线设计产物无效：${relativePath} -> ${sealedCommit}`);
        return null;
    }
    const worktreeId = sealedMetadata.worktreeId;
    const branchId = sealedMetadata.branchId;
    if ((worktreeId !== null && (typeof worktreeId !== "string" || worktreeId.trim().length === 0))
        || (branchId !== null && (typeof branchId !== "string" || branchId.trim().length === 0))
        || (worktreeId === null && branchId === null)) {
        failures.push(`design Task 基线缺少执行身份：${relativePath} -> ${sealedCommit}`);
        return null;
    }
    return {baseline: parsed.revision, end, output, readmePath: relativePath, worktreeId: typeof worktreeId === "string" ? worktreeId : null, branchId: typeof branchId === "string" ? branchId : null};
}

function designContractMatchesCheckout(repoRoot: string, contract: DesignDiffContract): boolean {
    const checkout = git(repoRoot, ["rev-parse", "--show-toplevel"]);
    const worktreeMatches = contract.worktreeId !== null && samePath(resolve(primaryCheckoutRoot(repoRoot), contract.worktreeId), checkout);
    const branch = gitBranch(repoRoot);
    return worktreeMatches || (contract.branchId !== null && (contract.branchId === branch || contract.branchId === process.env.GITHUB_HEAD_REF));
}

function validateDesignDiff(repoRoot: string, contract: DesignDiffContract, failures: string[]): void {
    const diffArgs = ["diff", "--name-only", "--no-renames", "-z", contract.baseline];
    if (contract.end) diffArgs.push(contract.end);
    diffArgs.push("--");
    const paths = new Set(git(repoRoot, diffArgs).split("\0").filter(Boolean));
    if (!contract.end) {
        for (const path of git(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean)) paths.add(path);
    }
    const contextPath = contract.readmePath.replace(/README\.md$/u, "context.md");
    for (const path of paths) {
        const allowed = path === contract.output || path === contract.readmePath || path === contextPath || isTaskReportPath(contract.readmePath, path);
        if (!allowed) failures.push(`design Task diff 越界：${contract.readmePath} -> ${path}`);
    }
}
type ResearchDiffContract = {
    allowedPaths: string[];
    readmePath: string;
    scopeRoot: string;
};
type HeadResearchDiffContracts = {
    allowCurrentFallback: boolean;
    blockedPaths: Set<string>;
    contracts: Map<string, ResearchDiffContract>;
};

function isHeadResearchTaskIdentity(relativePath: string, metadata: Record<string, unknown>, ownership: TaskOwnershipManifest): boolean {
    const rootMatch = /^\.agents\/tasks\/([^/]+)\/README\.md$/u.exec(relativePath);
    const packageMatch = /^packages\/([^/]+)\/\.agents\/tasks\/([^/]+)\/README\.md$/u.exec(relativePath);
    const packageName = packageMatch?.[1];
    const directoryTaskId = rootMatch?.[1] ?? packageMatch?.[2] ?? "";
    if (metadata.taskId !== directoryTaskId) return false;
    if (rootMatch) return isCurrentTaskContract(ROOT_TASK_OWNER_ROOT, directoryTaskId);
    if (packageName === "neuro-book") {
        return isCurrentTaskContract(APPLICATION_TASK_OWNER_ROOT, directoryTaskId)
            && ownership.tasks.some((entry) => entry.taskId === directoryTaskId);
    }
    return packageName !== undefined && taskIdSequence(directoryTaskId) !== null;
}


function researchDiffContract(relativePath: string, readme: string, metadata: Record<string, unknown>): ResearchDiffContract | null {
    const active = taskWorkflowKind(metadata) === "research"
        && typeof metadata.status === "string"
        && Object.hasOwn(ACTIVE_TASK_STATUSES, metadata.status);
    if (!active) return null;
    const packageScope = /^(packages\/[^/]+)\//u.exec(relativePath)?.[1] ?? "";
    return {
        allowedPaths: [relativePath, relativePath.replace(/\/README\.md$/u, "/context.md"), ...markdownListItems(markdownSection(readme, "研究产物"))],
        readmePath: relativePath,
        scopeRoot: packageScope,
    };
}
function headResearchDiffContracts(repoRoot: string, ownership: TaskOwnershipManifest, failures: string[]): HeadResearchDiffContracts {
    const contracts = new Map<string, ResearchDiffContract>();
    const blockedPaths = new Set<string>();
    const gitMetadata = resolve(repoRoot, ".git");
    if (!existsSync(gitMetadata)) return {allowCurrentFallback: true, blockedPaths, contracts};
    const initializedRepository = lstatSync(gitMetadata).isFile() || existsSync(resolve(gitMetadata, "config"));
    if (!initializedRepository) return {allowCurrentFallback: true, blockedPaths, contracts};
    let paths: string[];
    try {
        paths = git(repoRoot, ["ls-tree", "-r", "--name-only", "HEAD", "--", ".agents/tasks", "packages"])
            .split(/\r?\n/u)
            .filter((path) => /^(?:\.agents\/tasks\/[^/]+|packages\/[^/]+\/\.agents\/tasks\/[^/]+)\/README\.md$/u.test(path));
    } catch (error) {
        failures.push(`research Task HEAD 密封合同无法读取：${String(error)}`);
        return {allowCurrentFallback: false, blockedPaths, contracts};
    }
    for (const relativePath of paths) {
        let readme: string;
        try {
            readme = git(repoRoot, ["show", `HEAD:${relativePath}`]);
        } catch (error) {
            failures.push(`research Task HEAD 密封合同文件无法读取：${relativePath}：${String(error)}`);
            blockedPaths.add(relativePath);
            continue;
        }
        const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(readme)?.[1];
        if (!frontmatter || !/^schema:\s*["']?nbook\.task\/v1["']?\s*$/mu.test(frontmatter)) continue;
        const metadata = readTaskFrontmatter(readme, relativePath, failures);
        if (!metadata || !isHeadResearchTaskIdentity(relativePath, metadata, ownership)) continue;
        const contract = researchDiffContract(relativePath, readme, metadata);
        if (contract) contracts.set(relativePath, contract);
    }
    return {allowCurrentFallback: true, blockedPaths, contracts};
}

function readWorktreeChangedPaths(repoRoot: string, failures: string[]): Set<string> | null {
    try {
        const paths = new Set(git(repoRoot, ["diff", "HEAD", "--name-only", "--no-renames", "-z", "--"]).split("\0").filter(Boolean));
        for (const path of git(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean)) paths.add(path);
        return paths;
    } catch (error) {
        failures.push(`research Task 工作树差异无法读取：${String(error)}`);
        return null;
    }
}

function validateResearchDiff(contract: ResearchDiffContract, paths: ReadonlySet<string>, failures: string[]): void {
    for (const path of paths) {
        if (contract.scopeRoot && !path.startsWith(`${contract.scopeRoot}/`)) continue;
        if (!contract.allowedPaths.includes(path)) failures.push(`research Task diff 越界：${contract.readmePath} -> ${path}`);
    }
}

/** 保留旧 Task provenance，同时拒绝把新 v2 Task 放回已封存的旧根。 */
export function verifyLegacyTaskProvenance(repoRoot: string): string[] {
    const failures: string[] = [];
    for (const ownerRoot of packageTaskOwnerRoots(repoRoot)) {
        for (const relativePath of legacyTaskReadmePaths(repoRoot, ownerRoot)) {
            const metadata = readTaskFrontmatter(readRepoText(repoRoot, relativePath), relativePath, []);
            if (metadata?.schema === "nbook.task/v2") failures.push(`旧归档根拒收 v2，请移入 .agents/works/<work>/tasks/<task>/：${relativePath}`);
        }
    }
    const ownershipLoaded = readTaskOwnershipManifest(repoRoot);
    failures.push(...ownershipLoaded.failures);
    if (!ownershipLoaded.manifest) return failures;

    const rootTaskRoot = resolve(repoRoot, ROOT_TASK_OWNER_ROOT);
    const rootTaskIds = existsSync(rootTaskRoot)
        ? readdirSync(rootTaskRoot, {withFileTypes: true}).filter((entry) => entry.isDirectory() && entry.name !== "archived").map((entry) => entry.name).sort()
        : [];
    const appTaskIds = ownershipLoaded.manifest.tasks.map((entry) => entry.taskId);
    const designContracts: DesignDiffContract[] = [];
    const headResearch = headResearchDiffContracts(repoRoot, ownershipLoaded.manifest, failures);
    const researchContracts = new Map(headResearch.contracts);

    let legacyIdentity: LegacyTaskIdentity | null | undefined;
    const requireLegacyIdentity = (): LegacyTaskIdentity | null => {
        legacyIdentity ??= readLegacyTaskIdentitySet(repoRoot, failures);
        return legacyIdentity;
    };

    for (const [ownerRoot, taskIds] of [[ROOT_TASK_OWNER_ROOT, rootTaskIds], [APPLICATION_TASK_OWNER_ROOT, appTaskIds]] as const) {
        for (const taskId of taskIds) {
            const relativePath = `${ownerRoot}/${taskId}/README.md`;
            const historicalShape = isHistoricalTaskShape(ownerRoot, taskId);
            const identity = taskIdentity(ownerRoot, taskId, ownershipLoaded.manifest, historicalShape ? requireLegacyIdentity() : null);
            const currentContract = identity.currentContract;
            if (!identity.valid) failures.push(`${ownerRoot === ROOT_TASK_OWNER_ROOT ? "根" : "应用"} Task 标识无效：${taskId}`);
            if (!hasFile(repoRoot, relativePath)) {
                if (currentContract) failures.push(`新 Task 缺少 README.md：${relativePath}`);
                continue;
            }
            const readme = readRepoText(repoRoot, relativePath);
            const metadata = readTaskFrontmatter(readme, relativePath, failures);
            if (!metadata || metadata.schema !== "nbook.task/v1") {
                if (currentContract) failures.push(`新 Task 缺少有效 nbook.task/v1 frontmatter：${relativePath}`);
                continue;
            }
            if (metadata.taskId !== taskId) failures.push(`Task taskId 与目录不一致：${relativePath}`);
            if (currentContract) {
                validateIssueContract(relativePath, metadata, failures);
                for (const field of ["worktreeId", "branchId"] as const) {
                    const value = metadata[field];
                    if (value !== null && (typeof value !== "string" || value.trim().length === 0)) failures.push(`Task ${field} 必须是非空字符串或 null：${relativePath}`);
                }
            }
            for (const forbiddenField of ["parentTaskId", "actionIssueIds", "issueIds"] as const) {
                if (Object.hasOwn(metadata, forbiddenField)) failures.push(`Task 禁止聚合字段 ${forbiddenField}：${relativePath}`);
            }
            if (typeof metadata.status !== "string" || !Object.hasOwn(TASK_STATUSES, metadata.status)) failures.push(`Task status 无效：${relativePath}`);
            if (typeof metadata.createdAt !== "string" || typeof metadata.updatedAt !== "string") failures.push(`Task 缺少 createdAt/updatedAt：${relativePath}`);
            if (!hasFile(repoRoot, `${ownerRoot}/${taskId}/context.md`) && !Object.hasOwn(LEGACY_TASKS_WITHOUT_CONTEXT, taskId)) failures.push(`Task 缺少 context.md：${relativePath}`);
            if (currentContract) validateTaskCollaborationContract(relativePath, readme, metadata.status, failures);
            if (!("agentWorkflow" in metadata)) {
                if (!Object.hasOwn(LEGACY_TASKS_WITHOUT_AGENT_WORKFLOW, taskId)) failures.push(`新 Task 缺少 agentWorkflow：${relativePath}`);
                continue;
            }
            validateAgentWorkflow(repoRoot, relativePath, readme, metadata.agentWorkflow, failures);
            if (currentContract) {
                const designContract = designDiffContract(repoRoot, relativePath, metadata, failures);
                if (designContract && designContractMatchesCheckout(repoRoot, designContract)) designContracts.push(designContract);
            }
            if (currentContract && metadata.taskId === taskId && headResearch.allowCurrentFallback && !headResearch.blockedPaths.has(relativePath)) {
                const researchContract = researchDiffContract(relativePath, readme, metadata);
                if (researchContract && !researchContracts.has(relativePath)) researchContracts.set(relativePath, researchContract);
            }

        }
    }
    const packagesRoot = resolve(repoRoot, "packages");
    const packageNames = existsSync(packagesRoot)
        ? readdirSync(packagesRoot, {withFileTypes: true}).filter((entry) => entry.isDirectory() && entry.name !== "neuro-book").map((entry) => entry.name).sort()
        : [];
    for (const packageName of packageNames) {
        const packageTaskRoot = resolve(packagesRoot, packageName, ".agents", "tasks");
        if (!existsSync(packageTaskRoot)) continue;
        const taskIds = readdirSync(packageTaskRoot, {withFileTypes: true}).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
        for (const taskId of taskIds) {
            const relativePath = `packages/${packageName}/.agents/tasks/${taskId}/README.md`;
            if (!hasFile(repoRoot, relativePath)) continue;
            const readme = readRepoText(repoRoot, relativePath);
            const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(readme)?.[1];
            if (!frontmatter || !/^schema:\s*["']?nbook\.task\/v1["']?\s*$/mu.test(frontmatter)) continue;
            const metadata = readTaskFrontmatter(readme, relativePath, failures);
            if (!metadata) continue;
            if (metadata.taskId !== taskId) failures.push(`Task taskId 与目录不一致：${relativePath}`);
            validateIssueContract(relativePath, metadata, failures);
            for (const field of ["worktreeId", "branchId"] as const) {
                const value = metadata[field];
                if (value !== null && (typeof value !== "string" || value.trim().length === 0)) failures.push(`Task ${field} 必须是非空字符串或 null：${relativePath}`);
            }
            for (const forbiddenField of ["parentTaskId", "actionIssueIds", "issueIds"] as const) {
                if (Object.hasOwn(metadata, forbiddenField)) failures.push(`Task 禁止聚合字段 ${forbiddenField}：${relativePath}`);
            }
            if (typeof metadata.status !== "string" || !Object.hasOwn(TASK_STATUSES, metadata.status)) failures.push(`Task status 无效：${relativePath}`);
            if (typeof metadata.createdAt !== "string" || typeof metadata.updatedAt !== "string") failures.push(`Task 缺少 createdAt/updatedAt：${relativePath}`);
            if (!hasFile(repoRoot, `packages/${packageName}/.agents/tasks/${taskId}/context.md`)) failures.push(`Task 缺少 context.md：${relativePath}`);
            if (!("agentWorkflow" in metadata)) failures.push(`新 Task 缺少 agentWorkflow：${relativePath}`);
            else validateAgentWorkflow(repoRoot, relativePath, readme, metadata.agentWorkflow, failures);
            validateTaskCollaborationContract(relativePath, readme, metadata.status, failures);
            const designContract = designDiffContract(repoRoot, relativePath, metadata, failures);
            if (designContract && designContractMatchesCheckout(repoRoot, designContract)) designContracts.push(designContract);
            const allowResearchFallback = headResearch.allowCurrentFallback && !headResearch.blockedPaths.has(relativePath);
            const researchContract = allowResearchFallback && metadata.taskId === taskId ? researchDiffContract(relativePath, readme, metadata) : null;
            if (researchContract && !researchContracts.has(relativePath)) researchContracts.set(relativePath, researchContract);
        }
    }
    const researchScopes = new Map<string, ResearchDiffContract[]>();
    for (const contract of researchContracts.values()) {
        const contracts = researchScopes.get(contract.scopeRoot) ?? [];
        contracts.push(contract);
        researchScopes.set(contract.scopeRoot, contracts);
    }
    for (const contracts of researchScopes.values()) {
        if (contracts.length > 1) failures.push(`当前 owner scope 命中多个活跃 research Task：${contracts.map((contract) => contract.readmePath).join(", ")}`);
    }
    if (researchContracts.size > 0) {
        const changedPaths = readWorktreeChangedPaths(repoRoot, failures);
        if (changedPaths) {
            for (const contracts of researchScopes.values()) {
                if (contracts.length === 1) validateResearchDiff(contracts[0] as ResearchDiffContract, changedPaths, failures);
            }
        }
    }
    const activeDesignContracts = designContracts.filter((contract) => contract.end === null);
    if (activeDesignContracts.length > 1) {
        failures.push(`当前 checkout 命中多个活跃 Design Task：${activeDesignContracts.map((contract) => contract.readmePath).join(", ")}`);
    }
    for (const contract of designContracts) {
        if (contract.end !== null || activeDesignContracts.length === 1) validateDesignDiff(repoRoot, contract, failures);
    }
    return failures;
}

export function verifyTaskMigration(repoRoot: string): string[] {
    const failures: string[] = [];
    const indexPath = resolve(repoRoot, ".agents", "tasks", "legacy-index.json");
    const markerPath = resolve(repoRoot, ".agents", "tasks", ".migration-complete");
    const index = readJson<TaskMigrationIndex>(indexPath, failures, "legacy-index.json");
    const marker = readJson<TaskMigrationMarker>(markerPath, failures, ".migration-complete");
    const ownershipLoaded = readTaskOwnershipManifest(repoRoot);
    failures.push(...ownershipLoaded.failures);
    if (!index || !marker || !ownershipLoaded.manifest) return failures;
    const ownership = ownershipLoaded.manifest;

    if (index.schema !== "nbook.task-migration-index/v1") failures.push("legacy-index.json schema 不匹配");
    if (marker.schema !== "nbook.task-migration/v1") failures.push(".migration-complete schema 不匹配");
    if (!Number.isInteger(index.fileCount)) failures.push("legacy-index.json 缺少整数 fileCount");
    if (!Array.isArray(index.mappings)) failures.push("legacy-index.json mappings 不是数组");
    if (!Array.isArray(index.repositoryLinkRewrites) || !Array.isArray(index.preservedSourceFiles)) failures.push("legacy-index.json 链接字段不是数组");
    if (!Array.isArray(index.localOnlyFiles) || !Number.isInteger(index.trackedFileCount)) failures.push("legacy-index.json 缺少 trackedFileCount/localOnlyFiles");
    if (!Number.isInteger(marker.fileCount)) failures.push(".migration-complete 缺少整数 fileCount");
    if (!Array.isArray(marker.repositoryLinkRewrites) || !Array.isArray(marker.preservedSourceFiles)) failures.push(".migration-complete 链接字段不是数组");
    if (!Array.isArray(marker.localOnlyFiles) || !Number.isInteger(marker.trackedFileCount)) failures.push(".migration-complete 缺少 trackedFileCount/localOnlyFiles");
    if (failures.length > 0) return failures;

    let baselineTracked: Record<string, true>;
    try {
        const paths = git(repoRoot, ["ls-tree", "-r", "--name-only", index.sourceRevision, "--", "docs/tasks"]).split(/\r?\n/u).filter(Boolean);
        baselineTracked = Object.fromEntries(paths.map((path) => [path, true])) as Record<string, true>;
    } catch (error) {
        failures.push(`迁移 sourceRevision 无法读取：${String(error)}`);
        return failures;
    }
    const mappings = index.mappings;
    const mappingSources = Object.fromEntries(mappings.map((mapping) => [mapping.source, true])) as Record<string, true>;
    const mappingDestinations = new Map(mappings.map((mapping) => [mapping.destination, mapping]));
    const localOnlySources = Object.fromEntries(index.localOnlyFiles.map((source) => [source, true])) as Record<string, true>;
    const canonicalPaths = new Set<string>();
    for (const entry of ownership.tasks) {
        for (const file of entry.files) canonicalPaths.add(`${entry.ownerRoot}/${file.path}`);
    }
    for (const mapping of mappings) {
        const legacyRelative = mapping.destination.replace(/^\.agents\/tasks\//u, "");
        const taskId = legacyRelative.split("/")[0] ?? "";
        const ownerEntry = ownership.tasks.find((entry) => entry.taskId === taskId);
        const ownerRoot = ownerEntry?.ownerRoot ?? ROOT_TASK_OWNER_ROOT;
        canonicalPaths.add(`${ownerRoot}/${legacyRelative}`);
    }
    const textAttributes = readGitTextAttributes(repoRoot, [...canonicalPaths]);
    const stagedOrTracked = Object.fromEntries(git(repoRoot, ["ls-files", "--cached"]).split(/\r?\n/u).filter(Boolean).map((path) => [path, true])) as Record<string, true>;
    const stagedLegacyDeletes = Object.fromEntries(git(repoRoot, ["diff", "--cached", "--name-only", "--diff-filter=D", "--", "docs/tasks"]).split(/\r?\n/u).filter(Boolean).map((path) => [path, true]));

    if (index.fileCount !== mappings.length) failures.push(`迁移 index fileCount 与 mappings 不一致：${String(index.fileCount)} != ${String(mappings.length)}`);
    if (marker.fileCount !== mappings.length) failures.push(`迁移 marker fileCount 与 mappings 不一致：${String(marker.fileCount)} != ${String(mappings.length)}`);
    if (marker.sourceRevision !== index.sourceRevision) failures.push("迁移 marker sourceRevision 与 index 不一致");
    if (marker.manifestSha256 !== index.manifestSha256) failures.push("迁移 marker manifestSha256 与 index 不一致");
    if (marker.trackedFileCount !== index.trackedFileCount) failures.push("迁移 marker trackedFileCount 与 index 不一致");
    if (JSON.stringify(marker.localOnlyFiles) !== JSON.stringify(index.localOnlyFiles)) failures.push("迁移 marker localOnlyFiles 与 index 不一致");
    if (JSON.stringify(marker.repositoryLinkRewrites) !== JSON.stringify(index.repositoryLinkRewrites)) failures.push("迁移 marker repositoryLinkRewrites 与 index 不一致");
    if (JSON.stringify(marker.preservedSourceFiles) !== JSON.stringify(index.preservedSourceFiles)) failures.push("迁移 marker preservedSourceFiles 与 index 不一致");
    if (Object.keys(mappingSources).length !== mappings.length) failures.push("迁移 mappings 含重复 source");
    if (mappingDestinations.size !== mappings.length) failures.push("迁移 mappings 含重复 destination");
    if (Object.keys(baselineTracked).length !== index.trackedFileCount) failures.push(`迁移 trackedFileCount 与 baseline 不一致：${String(index.trackedFileCount)} != ${String(Object.keys(baselineTracked).length)}`);

    const manifest = {schema: "nbook.task-migration-manifest/v1", sourceRevision: index.sourceRevision, mappings, repositoryLinkRewrites: index.repositoryLinkRewrites, preservedSourceFiles: index.preservedSourceFiles};
    const manifestSha256 = `sha256:${createHash("sha256").update(JSON.stringify(manifest)).digest("hex")}`;
    if (manifestSha256 !== index.manifestSha256) failures.push(`迁移 manifest SHA-256 不一致：${manifestSha256} != ${index.manifestSha256}`);

    const ownershipByDestination = new Map<string, {entry: TaskOwnershipEntry; file: TaskOwnershipFile}>();
    for (const entry of ownership.tasks) {
        const taskRoot = `${entry.ownerRoot}/${entry.taskId}`;
        if (!hasDirectory(repoRoot, taskRoot)) failures.push(`ownership Task 目录缺失：${taskRoot}`);
        for (const file of entry.files) {
            if (ownershipByDestination.has(file.legacyDestination)) failures.push(`ownership legacyDestination 重复：${file.legacyDestination}`);
            ownershipByDestination.set(file.legacyDestination, {entry, file});
            const mapping = mappingDestinations.get(file.legacyDestination);
            if (!mapping) {
                failures.push(`ownership 文件没有 legacy mapping：${file.legacyDestination}`);
                continue;
            }
            if (file.sha256 !== mapping.destinationSha256) failures.push(`ownership 与 legacy destination hash 不一致：${file.legacyDestination}`);
            const physicalRel = `${entry.ownerRoot}/${file.path}`;
            if (!hasFile(repoRoot, physicalRel)) {
                failures.push(`ownership 文件缺失：${physicalRel}`);
                continue;
            }
            const actual = hashCanonicalFile(repoRoot, physicalRel, textAttributes);
            if (actual !== file.sha256) failures.push(`ownership 文件 hash 不一致：${physicalRel}`);
            if (!stagedOrTracked[physicalRel]) failures.push(`ownership 文件尚未进入 Git index：${physicalRel}`);
            if (isGitIgnored(repoRoot, physicalRel)) failures.push(`ownership tracked Task 被 .gitignore：${physicalRel}`);
        }
    }
    if (ownershipByDestination.size !== ownership.fileCount) failures.push("ownership fileCount 与唯一 legacyDestination 不一致");

    const appTaskIds = new Set(ownership.tasks.map((entry) => entry.taskId));
    const appTaskRoot = resolve(repoRoot, APPLICATION_TASK_OWNER_ROOT);
    const rootTaskRoot = resolve(repoRoot, ROOT_TASK_OWNER_ROOT);
    const appTaskDirectories = new Set(existsSync(appTaskRoot) ? readdirSync(appTaskRoot, {withFileTypes: true}).filter((entry) => entry.isDirectory()).map((entry) => entry.name) : []);
    const rootTaskIds = new Set(existsSync(rootTaskRoot) ? readdirSync(rootTaskRoot, {withFileTypes: true}).filter((entry) => entry.isDirectory() && entry.name !== "archived").map((entry) => entry.name) : []);
    for (const taskId of appTaskIds) {
        if (!appTaskDirectories.has(taskId)) failures.push(`ownership Task 目录缺失：${APPLICATION_TASK_OWNER_ROOT}/${taskId}`);
        if (rootTaskIds.has(taskId)) failures.push(`Task 同时存在根与应用 root：${taskId}`);
    }
    for (const taskId of appTaskDirectories) if (!appTaskIds.has(taskId)) failures.push(`应用 Task 目录未登记 ownership：${APPLICATION_TASK_OWNER_ROOT}/${taskId}`);

    const taskContracts = new Map<string, string>();
    const registerTaskContract = (ownerRoot: string, taskId: string, readmePath: string): void => {
        const previous = taskContracts.get(taskId);
        if (previous && previous !== readmePath) failures.push(`全仓 Task ID 重复：${taskId}（${previous}、${readmePath}）`);
        else taskContracts.set(taskId, readmePath);
        if (ownerRoot === APPLICATION_TASK_OWNER_ROOT && !appTaskIds.has(taskId)) failures.push(`应用 Task README 未登记 ownership：${readmePath}`);
        if (ownerRoot === ROOT_TASK_OWNER_ROOT && appTaskIds.has(taskId)) failures.push(`根 Task README 错置应用 owner：${readmePath}`);
    };
    for (const [ownerRoot, taskDirectories] of [[ROOT_TASK_OWNER_ROOT, rootTaskIds], [APPLICATION_TASK_OWNER_ROOT, appTaskDirectories]] as const) {
        for (const directory of taskDirectories) {
            const readmeRelative = `${ownerRoot}/${directory}/README.md`;
            if (!hasFile(repoRoot, readmeRelative)) continue;
            const text = readRepoText(repoRoot, readmeRelative);
            const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text)?.[1];
            if (!frontmatter || !/^schema:\s*["']?nbook\.task\/v1["']?\s*$/mu.test(frontmatter)) continue;
            const taskId = /^taskId:\s*["']?([A-Za-z0-9._-]+)["']?\s*$/mu.exec(frontmatter)?.[1];
            if (!taskId) {
                failures.push(`Task README frontmatter 缺少 taskId：${readmeRelative}`);
                continue;
            }
            registerTaskContract(ownerRoot, taskId, readmeRelative);
        }
    }

    for (const source of Object.keys(baselineTracked)) {
        if (!mappingSources[source]) failures.push(`baseline tracked Task 缺少 mapping：${source}`);
        if (existsSync(resolve(repoRoot, source))) failures.push(`旧 Task 文件仍存在：${source}`);
        if (stagedOrTracked[source] && !stagedLegacyDeletes[source]) failures.push(`旧 Task 删除尚未暂存：${source}`);
    }
    for (const source of index.localOnlyFiles) {
        if (!source.startsWith("docs/tasks/")) failures.push(`迁移 localOnlyFiles 路径不在 docs/tasks：${source}`);
        if (!mappingSources[source]) failures.push(`迁移 localOnlyFiles 缺少 mapping：${source}`);
    }
    for (const mapping of mappings) {
        const legacyRelative = mapping.destination.replace(/^\.agents\/tasks\//u, "");
        const taskId = legacyRelative.split("/")[0] ?? "";
        const ownerEntry = ownership.tasks.find((entry) => entry.taskId === taskId);
        const ownerRoot = ownerEntry?.ownerRoot ?? ROOT_TASK_OWNER_ROOT;
        const actualRelPath = `${ownerRoot}/${legacyRelative}`;
        const otherRoot = ownerRoot === APPLICATION_TASK_OWNER_ROOT ? ROOT_TASK_OWNER_ROOT : APPLICATION_TASK_OWNER_ROOT;
        const otherRelPath = `${otherRoot}/${legacyRelative}`;
        const sourceTracked = Boolean(baselineTracked[mapping.source]);
        const sourceLocalOnly = Boolean(localOnlySources[mapping.source]);
        if (ownerEntry && !ownershipByDestination.has(mapping.destination)) failures.push(`ownership Task 缺少 mapping 文件：${mapping.destination}`);
        if (!hasFile(repoRoot, actualRelPath)) {
            if (sourceLocalOnly && isGitIgnored(repoRoot, actualRelPath)) continue;
            failures.push(`迁移目标缺失或不是普通文件：${actualRelPath}`);
            continue;
        }
        if (hasFile(repoRoot, otherRelPath)) failures.push(`Task 同时存在双 root：${actualRelPath} 与 ${otherRelPath}`);
        const actual = hashCanonicalFile(repoRoot, actualRelPath, textAttributes);
        if (sourceTracked && sourceLocalOnly) failures.push(`tracked Task 被错误标记 localOnly：${mapping.source}`);
        if (sourceLocalOnly && sourceTracked) failures.push(`localOnly Task 与 baseline tracked 冲突：${mapping.source}`);
        if (actual !== mapping.destinationSha256) failures.push(`迁移目标 hash 不一致：${actualRelPath}`);
        if (!sourceLocalOnly && !stagedOrTracked[actualRelPath]) failures.push(`canonical Task 尚未进入 Git index：${actualRelPath}`);
        if (!sourceLocalOnly && isGitIgnored(repoRoot, actualRelPath)) failures.push(`canonical tracked Task 被 .gitignore：${actualRelPath}`);
        if (sourceLocalOnly && !isGitIgnored(repoRoot, actualRelPath)) failures.push(`localOnly Task 未被 .gitignore：${actualRelPath}`);
    }
    if (index.localOnlyFiles.some((source) => baselineTracked[source])) failures.push("迁移 localOnlyFiles 包含 baseline tracked 路径");
    return failures;
}

export function verifyTaskOwnership(repoRoot: string): string[] {
    const failures: string[] = [];
    const ownershipLoaded = readTaskOwnershipManifest(repoRoot);
    failures.push(...ownershipLoaded.failures);
    if (!ownershipLoaded.manifest) return failures;

    const ownership = ownershipLoaded.manifest;
    const trackedPaths = new Set(git(repoRoot, ["ls-files", "--cached"]).split(/\r?\n/u).filter(Boolean));
    const ownershipPaths = ownership.tasks.flatMap((entry) => entry.files.map((file) => `${entry.ownerRoot}/${file.path}`));
    const ignoredPaths = gitIgnoredPaths(repoRoot, ownershipPaths);
    const textAttributes = readGitTextAttributes(repoRoot, ownershipPaths);
    const declaredPhysicalPaths = new Set<string>();
    const legacyDestinations = new Set<string>();

    for (const entry of ownership.tasks) {
        const taskRoot = `${entry.ownerRoot}/${entry.taskId}`;
        if (!hasDirectory(repoRoot, taskRoot)) failures.push(`ownership Task 目录缺失：${taskRoot}`);
        for (const file of entry.files) {
            const physicalPath = `${entry.ownerRoot}/${file.path}`;
            declaredPhysicalPaths.add(physicalPath);
            if (legacyDestinations.has(file.legacyDestination)) failures.push(`ownership legacyDestination 重复：${file.legacyDestination}`);
            legacyDestinations.add(file.legacyDestination);
            if (!hasFile(repoRoot, physicalPath)) {
                failures.push(`ownership 文件缺失：${physicalPath}`);
                continue;
            }
            const actualHash = canonicalSha256(readFileSync(resolve(repoRoot, physicalPath)), textAttributes.get(physicalPath) ?? "unspecified");
            if (actualHash !== file.sha256) failures.push(`ownership 文件 hash 不一致：${physicalPath}`);
            if (!trackedPaths.has(physicalPath)) failures.push(`ownership 文件尚未进入 Git index：${physicalPath}`);
            if (ignoredPaths.has(physicalPath)) failures.push(`ownership tracked Task 被 .gitignore：${physicalPath}`);
        }
    }
    if (legacyDestinations.size !== ownership.fileCount) failures.push("ownership fileCount 与唯一 legacyDestination 不一致");

    const appTaskIds = new Set(ownership.tasks.map((entry) => entry.taskId));
    const appTaskRoot = resolve(repoRoot, APPLICATION_TASK_OWNER_ROOT);
    const rootTaskRoot = resolve(repoRoot, ROOT_TASK_OWNER_ROOT);
    const appTaskDirectories = new Set(existsSync(appTaskRoot)
        ? readdirSync(appTaskRoot, {withFileTypes: true}).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
        : []);
    const rootTaskIds = new Set(existsSync(rootTaskRoot)
        ? readdirSync(rootTaskRoot, {withFileTypes: true}).filter((entry) => entry.isDirectory() && entry.name !== "archived").map((entry) => entry.name)
        : []);
    for (const taskId of appTaskIds) {
        if (!appTaskDirectories.has(taskId)) failures.push(`ownership Task 目录缺失：${APPLICATION_TASK_OWNER_ROOT}/${taskId}`);
        if (rootTaskIds.has(taskId)) failures.push(`Task 同时存在根与应用 root：${taskId}`);
    }
    for (const taskId of appTaskDirectories) {
        if (!appTaskIds.has(taskId)) failures.push(`应用 Task 目录未登记 ownership：${APPLICATION_TASK_OWNER_ROOT}/${taskId}`);
    }
    for (const trackedPath of trackedPaths) {
        if (!trackedPath.startsWith(`${APPLICATION_TASK_OWNER_ROOT}/`)) continue;
        const relativePath = trackedPath.slice(APPLICATION_TASK_OWNER_ROOT.length + 1);
        const taskId = relativePath.split("/")[0] ?? "";
        if (appTaskIds.has(taskId) && !declaredPhysicalPaths.has(trackedPath)) {
            failures.push(`ownership 缺少 tracked 文件：${trackedPath}`);
        }
    }

    const taskContracts = new Map<string, string>();
    const registerTaskContract = (ownerRoot: string, taskId: string, readmePath: string): void => {
        const previous = taskContracts.get(taskId);
        if (previous && previous !== readmePath) failures.push(`全仓 Task ID 重复：${taskId}（${previous}、${readmePath}）`);
        else taskContracts.set(taskId, readmePath);
        if (ownerRoot === APPLICATION_TASK_OWNER_ROOT && !appTaskIds.has(taskId)) failures.push(`应用 Task README 未登记 ownership：${readmePath}`);
        if (ownerRoot === ROOT_TASK_OWNER_ROOT && appTaskIds.has(taskId)) failures.push(`根 Task README 错置应用 owner：${readmePath}`);
    };
    for (const [ownerRoot, taskDirectories] of [[ROOT_TASK_OWNER_ROOT, rootTaskIds], [APPLICATION_TASK_OWNER_ROOT, appTaskDirectories]] as const) {
        for (const directory of taskDirectories) {
            const readmeRelative = `${ownerRoot}/${directory}/README.md`;
            if (!hasFile(repoRoot, readmeRelative)) continue;
            const text = readRepoText(repoRoot, readmeRelative);
            const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text)?.[1];
            if (!frontmatter || !/^schema:\s*["']?nbook\.task\/v1["']?\s*$/mu.test(frontmatter)) continue;
            const taskId = /^taskId:\s*["']?([A-Za-z0-9._-]+)["']?\s*$/mu.exec(frontmatter)?.[1];
            if (!taskId) {
                failures.push(`Task README frontmatter 缺少 taskId：${readmeRelative}`);
                continue;
            }
            registerTaskContract(ownerRoot, taskId, readmeRelative);
        }
    }

    if (pathEntryExists(resolve(repoRoot, "docs", "tasks"))) failures.push("旧 Task 目录仍存在：docs/tasks");
    return failures;
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

        for (const dependencyName of workspaceDependencies(manifest)) {
            if (!manifestNames.has(dependencyName)) failures.push(`workspace依赖未对应本地包：packages/${packageName} -> ${dependencyName}`);
        }
        if (packageName !== "neuro-book" && workspaceDependencies(manifest).includes("@notnotype/neuro-book")) {
            failures.push(`自治或内部包不得依赖主应用：packages/${packageName} -> @notnotype/neuro-book`);
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

function gitIgnoredPaths(repoRoot: string, relativePaths: readonly string[]): Set<string> {
    if (relativePaths.length === 0) return new Set();
    const input = Buffer.from(`${relativePaths.join("\0")}\0`, "utf8");
    try {
        const output = execFileSync("git", ["check-ignore", "--no-index", "--stdin", "-z"], {
            cwd: repoRoot,
            input,
            encoding: null,
            stdio: ["pipe", "pipe", "pipe"],
        });
        return new Set(output.toString("utf8").split("\0").filter(Boolean));
    } catch (error) {
        const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
        if (status === 1) return new Set();
        throw error;
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

