#!/usr/bin/env bun
import {existsSync, readFileSync} from "node:fs";
import {resolve} from "node:path";
import {
    CANONICAL_ROLES,
    defaultRepoRoot,
    expectedGovernanceFiles,
    git,
    hasFile,
    verifyAgentSkillsAdaptation,
    verifyGovernanceDocumentLimits,
    verifyApplicationScriptBoundary,
    verifyMonorepoCutover,
    verifySiblingResyncResolution,
    verifyTaskAgentWorkflowProfiles,
    verifyTaskOwnership,
    verifyWorkspacePackageGovernance,
} from "#scripts/ci/agent-governance-contract";

const args = process.argv.slice(2);
const repoArgument = args.indexOf("--repo-root");
const repoRoot = resolve(repoArgument >= 0 ? args[repoArgument + 1] ?? "" : defaultRepoRoot(import.meta.url));
const failures: string[] = [];
const warnings: string[] = [];

failures.push(...verifyAgentSkillsAdaptation(repoRoot));
failures.push(...verifyTaskAgentWorkflowProfiles(repoRoot));

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
failures.push(...verifyTaskOwnership(repoRoot));
failures.push(...verifyWorkspacePackageGovernance(repoRoot));
failures.push(...verifyMonorepoCutover(repoRoot));
failures.push(...verifyApplicationScriptBoundary(repoRoot));
failures.push(...verifySiblingResyncResolution(repoRoot));
failures.push(...verifyGovernanceDocumentLimits(repoRoot));
for (const relativePath of [".env.local", ".worktree", ".agent/"]) {
    if (!isIgnored(relativePath)) failures.push(`运行态未被忽略：${relativePath}`);
}
for (const relativePath of ["AGENTS.md", ".omp/RULES.md", "WATCHDOG.md", ".agents/AGENTS.md", ".agents/README.md", ".agents/tasks/README.md"]) {
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
    ["governance:migrate-tasks", "scripts/maintenance/migrate-agent-tasks.ts"],
    ["governance:migrate-task-ownership", "scripts/maintenance/migrate-task-ownership.ts"],
] as const) {
    if (!scripts[name]?.includes(expected)) failures.push(`package.json 缺少命令入口：${name} -> ${expected}`);
}
if (scripts["test:agent-state-root"]?.includes("workspace-root-ref.test.ts")) {
    failures.push("test:agent-state-root 仍引用不存在的 workspace-root-ref.test.ts");
}
for (const expectedTest of ["workspace-runtime-root.test.ts", "agent-workspace-state-root.test.ts"]) {
    if (!scripts["test:agent-state-root"]?.includes(expectedTest)) failures.push(`test:agent-state-root 缺少：${expectedTest}`);
}

const trackedAgent = git(repoRoot, ["ls-files", ".agent"]).split(/\r?\n/u).filter(Boolean);
if (trackedAgent.length > 0) failures.push(`仓库仍跟踪开发运行态 .agent 文件：${trackedAgent.join(", ")}`);

const inspectPaths = [...new Set([
    ...git(repoRoot, ["ls-files"]).split(/\r?\n/u).filter(Boolean),
    ...expectedGovernanceFiles(),
])];
const runtimeExtensions = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".ps1", ".sh", ".json", ".toml"];
for (const relativePath of inspectPaths) {
    if (!runtimeExtensions.some((extension) => relativePath.endsWith(extension))) continue;
    if (relativePath.startsWith("docs/tasks/") || relativePath.startsWith(".agents/tasks/") || relativePath.startsWith("vitepress/locales/zh-Hans/changelog/") || relativePath.startsWith("vitepress/locales/en-US/changelog/") || relativePath.startsWith("docs/archived/")) continue;
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

const staleGovernanceRefs = [".agent/roles/", ".agent/tasks/", ".agent/skills/"];
for (const relativePath of [".agents/skills/README.md", ".agents/tasks/README.md", ".agents/tasks/AGENTS.md"]) {
    const text = readFileSync(resolve(repoRoot, relativePath), "utf8");
    for (const stale of staleGovernanceRefs) {
        if (text.includes(stale)) failures.push(`治理文件仍引用旧入口 ${stale}：${relativePath}`);
    }
}
for (const role of CANONICAL_ROLES) {
    const text = readFileSync(resolve(repoRoot, `.agents/roles/${role}/AGENTS.md`), "utf8");
    if (!text.trim()) failures.push(`角色合同为空：${role}`);
}

console.log(JSON.stringify({schema: "nbook.governance-report/v1", repoRoot, failures, warnings}, null, 2));
if (failures.length > 0) process.exitCode = 1;
