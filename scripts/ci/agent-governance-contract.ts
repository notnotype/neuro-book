import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {existsSync, lstatSync, readFileSync, readdirSync} from "node:fs";
import {dirname, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {resolveAgentAcceptanceRoot, resolveAgentCacheRoot, resolveAgentTempRoot, resolveAgentTestRoot, resolveAgentWorktreeRoot} from "@notnotype/neuro-book-test-support/paths";
import ts from "typescript";
import {parse as parseYaml} from "yaml";


export const CANONICAL_ROLES = ["pm", "leader", "tasker", "reviewer"] as const;
export type CanonicalRole = typeof CANONICAL_ROLES[number];

const AGENT_SKILLS_ADAPTATION_PROPOSAL = "packages/neuro-book/docs/proposals/agent-skills-adaptation.md";
const REPORT_SKILL = ".agents/skills/report/SKILL.md";
const LOAD_ROLE_SKILL = ".agents/skills/load_role/SKILL.md";
const LEGACY_AGENT_WORKFLOW_ROUTER = ".agents/skills/agent-workflow-router/SKILL.md";
const AGENT_WORKFLOW_PROFILE = "nbook.agent-skills/v1";
const AGENT_WORKFLOW_KINDS = new Set([
    "feedback",
    "bug",
    "feature",
    "refactor",
    "docs",
    "release",
    "migration",
]);
const AGENT_WORKFLOW_CHECKS = new Set([
    "focused-test",
    "regression-test",
    "typecheck",
    "build",
    "diff-check",
    "smoke",
    "browser",
    "security-review",
    "performance-baseline",
    "release-check",
    "docs-check",
    "governance-check",
]);

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

export function expectedGovernanceFiles(): readonly string[] {
    return [
        "AGENTS.md",
        ".omp/RULES.md",
        "WATCHDOG.md",
        ".agents/AGENTS.md",
        ".agents/README.md",
        ".agents/tasks/AGENTS.md",
        ".agents/tasks/README.md",
        ".agents/tasks/.migration-complete",
        ".agents/tasks/legacy-index.json",
        ".agents/tasks/ownership.json",
        ...CANONICAL_ROLES.map((role) => `.agents/roles/${role}/AGENTS.md`),
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
    return typeof value === "string"
        && value.length > 0
        && !value.startsWith("/")
        && !/^[A-Za-z]:/u.test(value)
        && !value.split("/").includes("..")
        && !value.split("/").includes("");
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
        if (typeof taskId !== "string" || !/^\d{2,5}-[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(taskId)) failures.push(`ownership Task 标识无效：${String(taskId)}`);
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

export function resolveTaskReadmePath(repoRoot: string, taskId: string): {path: string | null; checkedRoots: string[]; failures: string[]} {
    const loaded = readTaskOwnershipManifest(repoRoot);
    if (!loaded.manifest) return {path: null, checkedRoots: [], failures: loaded.failures};
    const entry = loaded.manifest.tasks.find((candidate) => candidate.taskId === taskId);
    const ownerRoot = entry?.ownerRoot ?? ROOT_TASK_OWNER_ROOT;
    const checkedRoots = [ownerRoot];
    const relativePath = `${ownerRoot}/${taskId}/README.md`;
    const candidate = resolve(repoRoot, relativePath);
    return {path: hasFile(repoRoot, relativePath) ? candidate : null, checkedRoots, failures: []};
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


function hasTextMarkers(repoRoot: string, relativePath: string, markers: readonly string[]): boolean {
    if (!hasFile(repoRoot, relativePath)) return false;
    const text = readRepoText(repoRoot, relativePath);
    return markers.every((marker) => text.includes(marker));
}

function readSkillFrontmatter(repoRoot: string, relativePath: string): Record<string, unknown> | null {
    if (!hasFile(repoRoot, relativePath)) return null;
    const text = readRepoText(repoRoot, relativePath);
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text);
    if (!match) return null;
    try {
        const metadata = parseYaml(match[1]) as unknown;
        return isRecord(metadata) ? metadata : null;
    } catch {
        return null;
    }
}

function hasReportSkillFrontmatter(repoRoot: string): boolean {
    const metadata = readSkillFrontmatter(repoRoot, REPORT_SKILL);
    if (metadata?.name !== "report"
        || typeof metadata.description !== "string"
        || metadata.description.trim().length === 0
        || typeof metadata["argument-hint"] !== "string"
        || metadata["disable-model-invocation"] === true) return false;
    const text = readRepoText(repoRoot, REPORT_SKILL);
    return text.includes("$ARGUMENTS") && text.includes("当前状态") && text.includes("下一步");
}

function hasLoadRoleSkillFrontmatter(repoRoot: string): boolean {
    const metadata = readSkillFrontmatter(repoRoot, LOAD_ROLE_SKILL);
    if (metadata?.name !== "load_role"
        || typeof metadata.description !== "string"
        || metadata.description.trim().length === 0
        || typeof metadata["argument-hint"] !== "string"
        || metadata["disable-model-invocation"] !== true) return false;
    const text = readRepoText(repoRoot, LOAD_ROLE_SKILL);
    return text.includes("$ARGUMENTS")
        && CANONICAL_ROLES.every((role) => text.includes(role))
        && text.includes(".agents/roles/<role>/AGENTS.md");
}

function agentSkillsImplementationPresent(repoRoot: string): boolean {
    return [
        hasFile(repoRoot, REPORT_SKILL),
        hasFile(repoRoot, LOAD_ROLE_SKILL),
        hasFile(repoRoot, LEGACY_AGENT_WORKFLOW_ROUTER),
        hasTaskAgentWorkflowProfile(repoRoot),
        hasTextMarkers(repoRoot, ".agents/skills/README.md", ["report/SKILL.md"]),
        hasTextMarkers(repoRoot, ".agents/tasks/README.md", ["agentWorkflow"]),
        hasTextMarkers(repoRoot, ".agents/tasks/AGENTS.md", ["agentWorkflow"]),
        ...CANONICAL_ROLES.map((role) => hasTextMarkers(repoRoot, `.agents/roles/${role}/AGENTS.md`, ["agentWorkflow"])),
        hasTextMarkers(repoRoot, "scripts/ci/agent-governance-contract.ts", ["verifyAgentSkillsAdaptation"]),
        hasTextMarkers(repoRoot, "scripts/ci/agent-governance.ts", ["verifyAgentSkillsAdaptation"]),
    ].some(Boolean);
}


function hasTaskAgentWorkflowContract(repoRoot: string): boolean {
    if (!hasFile(repoRoot, ".agents/tasks/README.md")) return false;
    const text = readRepoText(repoRoot, ".agents/tasks/README.md");
    const yamlBlocks = [...text.matchAll(/^```yaml\r?\n([\s\S]*?)\r?\n```/gmu)].map((match) => match[1]);
    for (const rawBlock of yamlBlocks) {
        const block = rawBlock.trim().replace(/^---\r?\n/u, "").replace(/\r?\n---$/u, "");
        try {
            const metadata = parseYaml(block) as unknown;
            if (!isRecord(metadata) || !isRecord(metadata.agentWorkflow)) continue;
            const workflow = metadata.agentWorkflow;
            const verification = workflow.verification;
            if (workflow.profile !== "nbook.agent-skills/v1" || typeof workflow.kind !== "string" || !Array.isArray(workflow.routes) || !isRecord(verification)) continue;
            if (!Array.isArray(verification.required) || !Array.isArray(verification.notRun)) continue;
            return true;
        } catch {
            continue;
        }
    }
    return false;
}

function hasGovernanceContractExports(repoRoot: string): boolean {
    if (!hasFile(repoRoot, "scripts/ci/agent-governance-contract.ts")) return false;
    const source = readRepoText(repoRoot, "scripts/ci/agent-governance-contract.ts");
    const sourceFile = ts.createSourceFile("agent-governance-contract.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const exports = new Set<string>();
    for (const statement of sourceFile.statements) {
        if (!ts.isFunctionDeclaration(statement)
            || !statement.name
            || !(ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Export)) continue;
        exports.add(statement.name.text);
    }
    return exports.has("verifyAgentSkillsAdaptation") && exports.has("verifyTaskAgentWorkflowProfiles");
}

function hasGovernanceCliCalls(repoRoot: string): boolean {
    if (!hasFile(repoRoot, "scripts/ci/agent-governance.ts")) return false;
    const source = readRepoText(repoRoot, "scripts/ci/agent-governance.ts");
    const fileName = "agent-governance.ts";
    const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const compilerOptions: ts.CompilerOptions = {
        target: ts.ScriptTarget.Latest,
        module: ts.ModuleKind.ESNext,
        noLib: true,
        noResolve: true,
    };
    const compilerHost = ts.createCompilerHost(compilerOptions);
    const originalGetSourceFile = compilerHost.getSourceFile;
    compilerHost.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => name === fileName
        ? sourceFile
        : originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
    const checker = ts.createProgram([fileName], compilerOptions, compilerHost).getTypeChecker();
    const importedBindings = new Map<string, {importedName: string; specifier: ts.ImportSpecifier}>();
    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement)
            || !ts.isStringLiteral(statement.moduleSpecifier)
            || statement.moduleSpecifier.text !== "#scripts/ci/agent-governance-contract") continue;
        const importClause = statement.importClause;
        if (!importClause || importClause.isTypeOnly || !importClause.namedBindings || !ts.isNamedImports(importClause.namedBindings)) continue;
        for (const element of importClause.namedBindings.elements) {
            if (element.isTypeOnly) continue;
            const importedName = element.propertyName?.text ?? element.name.text;
            if (importedName === "verifyAgentSkillsAdaptation" || importedName === "verifyTaskAgentWorkflowProfiles") {
                importedBindings.set(element.name.text, {importedName, specifier: element});
            }
        }
    }
    const calls = new Set<string>();
    function visit(node: ts.Node): void {
        if (ts.isFunctionLike(node)) return;
        if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
            const push = node.expression;
            if (ts.isPropertyAccessExpression(push.expression)
                && ts.isIdentifier(push.expression.expression)
                && push.expression.expression.text === "failures"
                && push.expression.name.text === "push"
                && push.arguments.length === 1) {
                const spread = push.arguments[0];
                if (ts.isSpreadElement(spread)
                    && ts.isCallExpression(spread.expression)
                    && ts.isIdentifier(spread.expression.expression)
                    && spread.expression.arguments.length === 1
                    && ts.isIdentifier(spread.expression.arguments[0])
                    && spread.expression.arguments[0].text === "repoRoot") {
                    const binding = importedBindings.get(spread.expression.expression.text);
                    const symbol = checker.getSymbolAtLocation(spread.expression.expression);
                    if (binding && symbol?.declarations?.some((declaration) => declaration === binding.specifier)) {
                        calls.add(binding.importedName);
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    }
    ts.forEachChild(sourceFile, visit);
    return calls.has("verifyAgentSkillsAdaptation") && calls.has("verifyTaskAgentWorkflowProfiles");
}

type AgentSkillsMarker = {
    failure: string;
    present: boolean;
};

function agentSkillsImplementationMarkers(repoRoot: string): AgentSkillsMarker[] {
    return [
        {failure: "report Skill 缺少有效 frontmatter", present: hasReportSkillFrontmatter(repoRoot)},
        {failure: "load_role Skill 缺少有效 frontmatter", present: hasLoadRoleSkillFrontmatter(repoRoot)},
        {failure: "旧 agent-workflow-router 未完成删除", present: !hasFile(repoRoot, LEGACY_AGENT_WORKFLOW_ROUTER)},
        {failure: "Skill 索引缺少 report/load_role", present: hasTextMarkers(repoRoot, ".agents/skills/README.md", ["report/SKILL.md", "load_role/SKILL.md"])},
        {failure: "编码路由缺少 .agents/skills/**/*.md 或 Agent 文档规范", present: hasTextMarkers(repoRoot, "docs/standards/code/README.md", [".agents/skills/**/*.md", "writing-for-agents/SKILL.md", "SKILL-MECHANICS.md"])},
        {failure: "Task 合同缺少完整 agentWorkflow 字段", present: hasTaskAgentWorkflowContract(repoRoot)},
        {failure: "Task 执行规则缺少完整 agentWorkflow 验证要求", present: hasTextMarkers(repoRoot, ".agents/tasks/AGENTS.md", ["agentWorkflow", ".agents/skills/load_role/SKILL.md", "verification.required", "verification.notRun"])},
        ...CANONICAL_ROLES.map((role): AgentSkillsMarker => ({
            failure: `角色合同缺少完整 agentWorkflow：${role}`,
            present: hasTextMarkers(repoRoot, `.agents/roles/${role}/AGENTS.md`, ["agentWorkflow", "required", "notRun"]),
        })),
        {failure: "治理合同缺少完整 Agent Skills 校验", present: hasGovernanceContractExports(repoRoot)},
        {failure: "治理入口缺少 Agent Skills 校验调用", present: hasGovernanceCliCalls(repoRoot)},
    ];
}

function validateAgentWorkflow(relativePath: string, raw: unknown, failures: string[]): void {
    if (!isRecord(raw)) {
        failures.push(`Task agentWorkflow 必须是对象：${relativePath}`);
        return;
    }
    if (raw.profile !== AGENT_WORKFLOW_PROFILE) failures.push(`Task agentWorkflow.profile 无效：${relativePath}`);

    const kind = raw.kind;
    if (typeof kind !== "string" || !AGENT_WORKFLOW_KINDS.has(kind)) failures.push(`Task agentWorkflow.kind 无效：${relativePath}`);

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
            if (typeof check !== "string" || !AGENT_WORKFLOW_CHECKS.has(check)) {
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
        if (typeof check !== "string" || !AGENT_WORKFLOW_CHECKS.has(check)) failures.push(`Task verification.notRun[${String(index)}] check 无效：${relativePath}`);
        if (typeof reason !== "string" || reason.trim().length === 0) failures.push(`Task verification.notRun[${String(index)}] 缺少非空 reason：${relativePath}`);
        if (typeof check === "string") {
            if (notRunValues.has(check)) failures.push(`Task verification.notRun 含重复项：${relativePath}`);
            notRunValues.add(check);
            if (requiredValues.has(check)) failures.push(`Task verification.required 与 verification.notRun 重叠：${relativePath}`);
        }
    });
}

/** 校验 Agent Skills Proposal 的生效状态和适配入口是否一致。 */
export function verifyAgentSkillsAdaptation(repoRoot: string): string[] {
    const failures: string[] = [];
    if (!hasFile(repoRoot, AGENT_SKILLS_ADAPTATION_PROPOSAL)) {
        failures.push(`缺少 Agent Skills 适配 Proposal：${AGENT_SKILLS_ADAPTATION_PROPOSAL}`);
        return failures;
    }
    const proposal = readRepoText(repoRoot, AGENT_SKILLS_ADAPTATION_PROPOSAL);
    const status = /^状态：\s*(\S.*?)\s*$/mu.exec(proposal)?.[1]?.trim();
    if (!status) {
        failures.push(`Agent Skills 适配 Proposal 缺少状态：${AGENT_SKILLS_ADAPTATION_PROPOSAL}`);
        return failures;
    }
    const markers = agentSkillsImplementationMarkers(repoRoot);
    const implementationPresent = agentSkillsImplementationPresent(repoRoot);
    if (status === "draft") {
        if (implementationPresent) failures.push("Agent Skills Proposal 仍为 draft，但适配实现已出现");
        return failures;
    }
    if (status !== "accepted") {
        if (implementationPresent) failures.push(`Agent Skills Proposal 状态为 ${status}，但适配实现已出现`);
        return failures;
    }

    for (const marker of markers) if (!marker.present) failures.push(marker.failure);

    const adaptedPaths = [
        REPORT_SKILL,
        LOAD_ROLE_SKILL,
        ".agents/skills/README.md",
        ".agents/tasks/README.md",
        ".agents/tasks/AGENTS.md",
        ...CANONICAL_ROLES.map((role) => `.agents/roles/${role}/AGENTS.md`),
        "scripts/ci/agent-governance-contract.ts",
        "scripts/ci/agent-governance.ts",
    ];
    const missingDefinitionOfDonePath = ["..", "..", "references", "definition-of-done.md"].join("/");
    for (const path of adaptedPaths) {
        if (hasFile(repoRoot, path) && readRepoText(repoRoot, path).includes(missingDefinitionOfDonePath)) {
            failures.push(`适配文件不得引用缺失的通用 DoD：${path}`);
        }
    }
    return failures;
}

/** 校验当前 Task 中可选的 agentWorkflow 验证画像。 */
export function verifyTaskAgentWorkflowProfiles(repoRoot: string): string[] {
    const failures: string[] = [];
    const ownershipLoaded = readTaskOwnershipManifest(repoRoot);
    failures.push(...ownershipLoaded.failures);
    if (!ownershipLoaded.manifest) return failures;

    const rootTaskRoot = resolve(repoRoot, ROOT_TASK_OWNER_ROOT);
    const appTaskRoot = resolve(repoRoot, APPLICATION_TASK_OWNER_ROOT);
    const rootTaskIds = existsSync(rootTaskRoot)
        ? readdirSync(rootTaskRoot, {withFileTypes: true}).filter((entry) => entry.isDirectory() && entry.name !== "archived").map((entry) => entry.name)
        : [];
    const appTaskIds = ownershipLoaded.manifest.tasks.map((entry) => entry.taskId);
    for (const [ownerRoot, taskIds] of [[ROOT_TASK_OWNER_ROOT, rootTaskIds], [APPLICATION_TASK_OWNER_ROOT, appTaskIds]] as const) {
        for (const taskId of taskIds) {
            const relativePath = `${ownerRoot}/${taskId}/README.md`;
            if (!hasFile(repoRoot, relativePath)) continue;
            const metadata = readTaskFrontmatter(readRepoText(repoRoot, relativePath), relativePath, failures);
            if (!metadata || metadata.schema !== "nbook.task/v1" || !("agentWorkflow" in metadata)) continue;
            validateAgentWorkflow(relativePath, metadata.agentWorkflow, failures);
        }
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
        if (localOnlySources[mapping.source]) continue;
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

    const manifest = {
        schema: "nbook.task-migration-manifest/v1",
        sourceRevision: index.sourceRevision,
        mappings,
        repositoryLinkRewrites: index.repositoryLinkRewrites,
        preservedSourceFiles: index.preservedSourceFiles,
    };
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

function isGitIgnored(repoRoot: string, relativePath: string): boolean {
    try {
        git(repoRoot, ["check-ignore", "--no-index", "-q", relativePath]);
        return true;
    } catch {
        return false;
    }
}

