import {lstatSync, realpathSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, isAbsolute, relative, resolve, sep} from "node:path";

/** Agent 路径解析所读取的公开环境变量集合。 */
export type AgentPathEnvironment = NodeJS.ProcessEnv & {
    NBOOK_AGENT_TEMP_ROOT?: string;
    NBOOK_HOST_SYSTEM_TEMP_ROOT?: string;
    NBOOK_AGENT_WORKTREE_ROOT?: string;
    NBOOK_TEST_TMPDIR?: string;
};

/** Windows 下为测试和构建保留的保守路径长度预算。 */
export const AGENT_PATH_LENGTH_LIMIT = 240;

const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const HOST_SYSTEM_TEMP_ROOT = resolve(tmpdir());

/** 返回当前宿主操作系统选择的系统临时目录。 */
export function resolveSystemTempRoot(env: AgentPathEnvironment = process.env): string {
    const configured = env.NBOOK_HOST_SYSTEM_TEMP_ROOT?.trim();
    return configured ? resolveConfiguredAbsolutePath(configured, "NBOOK_HOST_SYSTEM_TEMP_ROOT") : HOST_SYSTEM_TEMP_ROOT;
}

/**
 * 解析 Agent 专用临时根。
 *
 * 显式根必须位于系统临时目录内；默认值只在系统临时目录下追加一层，
 * 因而不会把仓库 checkout 变成运行数据宿主。
 */
export function resolveAgentTempRoot(env: AgentPathEnvironment = process.env): string {
    const systemRoot = resolveSystemTempRoot(env);
    const configured = env.NBOOK_AGENT_TEMP_ROOT?.trim();
    const root = configured
        ? resolveConfiguredAbsolutePath(configured, "NBOOK_AGENT_TEMP_ROOT")
        : resolve(systemRoot, "neuro-book");
    assertContained(systemRoot, root, "NBOOK_AGENT_TEMP_ROOT");
    assertShortPath(root, "NBOOK_AGENT_TEMP_ROOT");
    return root;
}

/** 解析独立 Git worktree 根；缺省保持仓库 `.worktree`。 */
export function resolveAgentWorktreeRoot(repoRoot: string, env: AgentPathEnvironment = process.env): string {
    const configured = env.NBOOK_AGENT_WORKTREE_ROOT?.trim();
    const root = configured
        ? resolve(repoRoot, configured)
        : resolve(repoRoot, ".worktree");
    assertShortPath(root, "NBOOK_AGENT_WORKTREE_ROOT");
    return root;
}

/** 解析一次 Vitest run 的受控根。 */
export function resolveAgentTestRoot(runId: string, env: AgentPathEnvironment = process.env): string {
    assertSafeSegment(runId, "runId");
    const agentRoot = resolveAgentTempRoot(env);
    const configured = env.NBOOK_TEST_TMPDIR?.trim();
    const root = configured
        ? resolveConfiguredAbsolutePath(configured, "NBOOK_TEST_TMPDIR")
        : resolve(agentRoot, "vitest", runId);
    assertContained(agentRoot, root, "NBOOK_TEST_TMPDIR");
    assertShortPath(root, "Vitest 测试根");
    return root;
}

/** 解析 Task/运行批次专用根。 */
export function resolveAgentRunRoot(taskId: string, runId: string, env: AgentPathEnvironment = process.env): string {
    assertSafeSegment(taskId, "taskId");
    assertSafeSegment(runId, "runId");
    const root = resolve(resolveAgentTempRoot(env), "runs", taskId, runId);
    assertShortPath(root, "Agent run 根");
    return root;
}

/** 解析 Task fixture 根。 */
export function resolveAgentFixtureRoot(taskId: string, runId: string, env: AgentPathEnvironment = process.env): string {
    assertSafeSegment(taskId, "taskId");
    assertSafeSegment(runId, "runId");
    const root = resolve(resolveAgentTempRoot(env), "fixtures", taskId, runId);
    assertShortPath(root, "Agent fixture 根");
    return root;
}

/** 解析 Product Runtime 验收根。 */
export function resolveAgentAcceptanceRoot(env: AgentPathEnvironment = process.env): string {
    const root = resolve(resolveAgentTempRoot(env), "acceptance", "product-runtime");
    assertShortPath(root, "Product acceptance 根");
    return root;
}

/** 解析 Source Dev 等可重建缓存根。 */
export function resolveAgentCacheRoot(name: string, env: AgentPathEnvironment = process.env): string {
    assertSafeSegment(name, "cache name");
    const root = resolve(resolveAgentTempRoot(env), "cache", name);
    assertShortPath(root, "Agent cache 根");
    return root;
}

/**
 * 解析临时 scratch/测试数据路径。
 *
 * 调用方传入的每一段都必须是单一路径段；这使旧的仓库相对临时目录
 * 可以迁移到系统 Temp，而不会把 `..` 或绝对路径带入拼接结果。
 */
export function resolveAgentScratchPath(...segments: string[]): string {
    for (const segment of segments) {
        assertSafePathSegment(segment, "scratch path");
    }
    const root = resolve(resolveAgentTempRoot(), ...segments);
    assertShortPath(root, "Agent scratch 路径");
    return root;
}

/** 返回正式 Task evidence 根；正式产物不进入临时目录。 */
export function resolveAgentEvidenceRoot(repoRoot: string, taskId: string): string {
    assertSafePathSegment(taskId, "taskId");
    return resolve(repoRoot, ".agents", "tasks", taskId, "evidences");
}

/** 断言 child 位于 parent 内，允许 child 等于 parent；比较真实路径而非 lexical path。 */
export function assertContained(parent: string, child: string, label: string): void {
    const canonicalParent = canonicalPath(parent, label);
    const canonicalChild = canonicalPath(child, label);
    const comparableParent = comparablePath(canonicalParent);
    const comparableChild = comparablePath(canonicalChild);
    const remainder = relative(comparableParent, comparableChild);
    if (remainder === "" || (!remainder.startsWith(`..${sep}`) && remainder !== ".." && !isAbsolute(remainder))) {
        return;
    }
    throw new Error(`${label} 必须位于受控根内：${child}`);
}

/** 供 resolver 测试和治理检查复用的短路径断言。 */
export function assertShortPath(pathValue: string, label: string): void {
    if (process.platform === "win32" && pathValue.length > AGENT_PATH_LENGTH_LIMIT) {
        throw new Error(`${label} 路径过长（${pathValue.length} > ${AGENT_PATH_LENGTH_LIMIT}）：${pathValue}`);
    }
}

function resolveConfiguredAbsolutePath(value: string, label: string): string {
    if (!isAbsolute(value)) {
        throw new Error(`${label} 必须使用绝对路径：${value}`);
    }
    return resolve(value);
}

function canonicalPath(pathValue: string, label: string): string {
    const absolute = resolve(pathValue);
    let existing = absolute;
    while (true) {
        try {
            lstatSync(existing);
            break;
        } catch (error) {
            const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
            if (code !== "ENOENT" && code !== "ENOTDIR") {
                throw new Error(`${label} 无法证明路径安全：${absolute}`);
            }
            const parent = dirname(existing);
            if (parent === existing) throw new Error(`${label} 无法证明路径安全：${absolute}`);
            existing = parent;
        }
    }
    let stats;
    try {
        stats = lstatSync(existing);
    } catch {
        throw new Error(`${label} 无法证明路径安全：${absolute}`);
    }
    // 仅拒绝「已存在锚点自身」是 symlink/junction：祖先链允许系统级链接
    //（macOS 的 /var -> /private/var、Windows 用户目录 junction），逃逸防护
    // 由下方 realpath(existing)+lexical suffix 与 assertContained 的双 realpath 比较承担。
    if (stats.isSymbolicLink()) throw new Error(`${label} 不能经过 symlink/reparse point：${absolute}`);
    let canonicalExisting: string;
    try {
        canonicalExisting = realpathSync.native(existing);
    } catch {
        throw new Error(`${label} 无法解析真实路径：${absolute}`);
    }
    const missingSuffix = relative(existing, absolute);
    return missingSuffix ? resolve(canonicalExisting, missingSuffix) : canonicalExisting;
}

function comparablePath(pathValue: string): string {
    const normalized = pathValue.replaceAll("\\", "/");
    return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function assertSafeSegment(value: string, label: string): void {
    if (!SAFE_SEGMENT_PATTERN.test(value) || value === "." || value === "..") {
        throw new Error(`${label} 含有非法路径段：${value}`);
    }
}

function assertSafePathSegment(value: string, label: string): void {
    if (!value || value === "." || value === ".." || value.includes("/") || value.includes("\\") || isAbsolute(value)) {
        throw new Error(`${label} 含有非法路径段：${value}`);
    }
}
