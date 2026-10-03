#!/usr/bin/env bun
import {existsSync, readFileSync} from "node:fs";
import {resolve} from "node:path";
import {
    expectedGovernanceFiles,
    git,
    hasFile,
    rareDocumentSymbolWarnings,
    verifyGovernanceDocumentLimits,
    verifyLegacyTaskRoots,
    verifyPackageScriptBoundary,
    verifyWorkContracts,
    verifyWorkspacePackageGovernance,
} from "#scripts/ci/agent-governance-contract";
import {changedFiles, readChangeScopeArguments, scopeWarnings} from "#scripts/ci/change-scope";

const {repoRoot, since, all} = readChangeScopeArguments(import.meta.url);
const failures: string[] = [];

failures.push(...verifyWorkContracts(repoRoot));
failures.push(...verifyLegacyTaskRoots(repoRoot));

function requireFile(relativePath: string): void {
    if (!hasFile(repoRoot, relativePath)) failures.push(`缺少治理文件：${relativePath}`);
}

function isIgnored(relativePath: string): boolean {
    try {
        const candidate = relativePath === ".worktree" ? ".worktree/placeholder" : relativePath;
        git(repoRoot, ["check-ignore", "--no-index", "-q", candidate]);
        return true;
    } catch {
        return false;
    }
}

for (const relativePath of expectedGovernanceFiles()) requireFile(relativePath);
failures.push(...verifyWorkspacePackageGovernance(repoRoot));
failures.push(...verifyPackageScriptBoundary(repoRoot));
failures.push(...verifyGovernanceDocumentLimits(repoRoot));
for (const relativePath of [".env.local", ".worktree", ".agent/"]) {
    if (!isIgnored(relativePath)) failures.push(`运行态未被忽略：${relativePath}`);
}
for (const relativePath of ["AGENTS.md", ".omp/RULES.md", "WATCHDOG.md", ".agents/AGENTS.md", ".agents/README.md", ".agents/works/README.md", ".agents/tasks/README.md"]) {
    if (isIgnored(relativePath)) failures.push(`治理入口被错误忽略：${relativePath}`);
}

const bunfig = readFileSync(resolve(repoRoot, "bunfig.toml"), "utf8");
for (const pattern of [".agent/**", ".agents/**"]) {
    if (!bunfig.includes(`"${pattern}"`)) failures.push(`bunfig.toml 缺少测试忽略：${pattern}`);
}

const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
};
const scripts = packageJson.scripts ?? {};
for (const [name, expected] of [
    ["governance:check", "scripts/ci/agent-governance.ts"],
    ["governance:context", "scripts/cli/agent-context.ts"],
    ["governance:worktree", "scripts/cli/create-agent-worktree.ts"],
    ["docs:check", "scripts/ci/check-documentation.ts"],
    ["test:affected", "scripts/cli/test-affected.ts"],
] as const) {
    if (!scripts[name]?.includes(expected)) failures.push(`package.json 缺少命令入口：${name} -> ${expected}`);
}

const trackedAgent = git(repoRoot, ["ls-files", ".agent"]).split(/\r?\n/u).filter(Boolean);
if (trackedAgent.length > 0) failures.push(`仓库仍跟踪开发运行态 .agent 文件：${trackedAgent.join(", ")}`);

const inspectPaths = [...new Set([
    ...git(repoRoot, ["ls-files"]).split(/\r?\n/u).filter(Boolean),
    ...expectedGovernanceFiles(),
])];
const runtimeExtensions = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".ps1", ".sh", ".json", ".toml"];
// 历史记录、归档与只读的旧应用保持原样，不扫描。
const frozenPrefixes = [".agents/tasks/", "docs/archived/", "packages/neuro-book-legacy/"];
for (const relativePath of inspectPaths) {
    if (!runtimeExtensions.some((extension) => relativePath.endsWith(extension))) continue;
    if (frozenPrefixes.some((prefix) => relativePath.startsWith(prefix))) continue;
    const absolutePath = resolve(repoRoot, relativePath);
    if (!existsSync(absolutePath)) continue;
    let text: string;
    try {
        text = readFileSync(absolutePath, "utf8");
    } catch {
        continue;
    }
    if (/\.agent[\\/]tmp(?:[\\/]|$)/u.test(text) && !relativePath.startsWith("packages/neuro-book-test-support/")) failures.push(`活文件仍引用仓库临时根：${relativePath}`);
}

const warnings = scopeWarnings(rareDocumentSymbolWarnings(repoRoot), all ? null : changedFiles(repoRoot, since));
console.log(JSON.stringify({schema: "nbook.governance-report/v1", repoRoot, failures, ...warnings}, null, 2));
if (failures.length > 0) process.exitCode = 1;
