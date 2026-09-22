import {createHash} from "node:crypto";
import {execFile as execFileCallback} from "node:child_process";
import {mkdir, readFile, realpath, rm, symlink, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {promisify} from "node:util";
import {afterEach, describe, expect, it} from "vitest";

import {canonicalSha256, primaryCheckoutRoot, readGitTextAttributes, resolveLegacyTaskReadmePath, verifyApplicationScriptBoundary, verifyLegacyTaskProvenance, verifyMonorepoCutover, verifyMonorepoWorktreeLayout, verifySiblingResyncResolution, verifyTaskMigration, verifyTaskOwnership, verifyWorkContracts, verifyWorkspacePackageGovernance} from "#scripts/ci/agent-governance-contract";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

const execFile = promisify(execFileCallback);
const fixtureRoots: string[] = [];
const repositoryRoot = join(import.meta.dirname, "..", "..");

afterEach(async () => {
    await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("canonical Task hash", () => {
    it("按 Git auto 语义将 lone CR 视为 binary，并豁免末尾 SUB", () => {
        const loneCr = Buffer.from([0x41, 0x0d, 0x0a, 0x42, 0x0d, 0x43]);
        const loneCrRawHash = `sha256:${createHash("sha256").update(loneCr).digest("hex")}`;
        const loneCrTextHash = `sha256:${createHash("sha256").update(Buffer.from([0x41, 0x0a, 0x42, 0x0d, 0x43])).digest("hex")}`;
        expect(canonicalSha256(loneCr, "auto")).toBe(loneCrRawHash);
        expect(canonicalSha256(loneCr, "auto")).not.toBe(loneCrTextHash);

        const trailingSub = Buffer.from([0x41, 0x0d, 0x0a, 0x42, 0x1a]);
        const normalizedTrailingSub = Buffer.from([0x41, 0x0a, 0x42, 0x1a]);
        const normalizedHash = `sha256:${createHash("sha256").update(normalizedTrailingSub).digest("hex")}`;
        const rawHash = `sha256:${createHash("sha256").update(trailingSub).digest("hex")}`;
        expect(canonicalSha256(trailingSub, "auto")).toBe(normalizedHash);
        expect(normalizedHash).not.toBe(rawHash);
        const internalSub = Buffer.from([0x41, 0x1a, 0x0d, 0x0a, 0x42]);
        const internalSubRawHash = `sha256:${createHash("sha256").update(internalSub).digest("hex")}`;
        expect(canonicalSha256(internalSub, "auto")).toBe(internalSubRawHash);
    });
    it("localOnly destination 的 CRLF 仍按 Git text canonical hash 校验", async () => {
        const repoRoot = await createLocalOnlyMigrationFixture();
        const destination = ".agents/tasks/01-local/benchmark.json";
        const attributes = readGitTextAttributes(repoRoot, ["docs/tasks/01-local/benchmark.json", destination]);

        expect(attributes.get("docs/tasks/01-local/benchmark.json")).toBe("unspecified");
        expect(attributes.get(destination)).toBe("set");
        expect(verifyTaskMigration(repoRoot)).toEqual([]);
    });
});

describe("Task ownership 当前树门禁", () => {
    it("当前 ownership、双根和 tracked 文件闭合", () => {
        expect(verifyTaskOwnership(repositoryRoot)).toEqual([]);
    });

    it("ownership 声明文件未进入 Git index 时失败", async () => {
        const repoRoot = await createOwnershipFixture({trackTask: false});

        expect(verifyTaskOwnership(repoRoot)).toContain("ownership 文件尚未进入 Git index：packages/neuro-book/.agents/tasks/01-alpha/README.md");
        expect(verifyTaskOwnership(repoRoot)).not.toContain("ownership 文件 hash 不一致：packages/neuro-book/.agents/tasks/01-alpha/README.md");
    });

    it("ownership 文件 hash 漂移时失败", async () => {
        const repoRoot = await createOwnershipFixture({trackTask: true});
        await writeText(repoRoot, "packages/neuro-book/.agents/tasks/01-alpha/README.md", "changed\n");

        expect(verifyTaskOwnership(repoRoot)).toContain("ownership 文件 hash 不一致：packages/neuro-book/.agents/tasks/01-alpha/README.md");
    });

    it("应用 Task 目录缺少 ownership 登记时失败", async () => {
        const repoRoot = await createOwnershipFixture({trackTask: true});
        await mkdir(join(repoRoot, "packages/neuro-book/.agents/tasks/02-unregistered"), {recursive: true});

        expect(verifyTaskOwnership(repoRoot)).toContain("应用 Task 目录未登记 ownership：packages/neuro-book/.agents/tasks/02-unregistered");
    });

    it("旧 docs/tasks 目录重新出现时失败", async () => {
        const repoRoot = await createOwnershipFixture({trackTask: true});
        await writeText(repoRoot, "docs/tasks/01-legacy/README.md", "legacy\n");

        expect(verifyTaskOwnership(repoRoot)).toContain("旧 Task 目录仍存在：docs/tasks");
    });

    it("根与应用 schema Task ID 重复时失败", async () => {
        const repoRoot = await createOwnershipFixture({trackTask: true});
        await writeText(repoRoot, ".agents/tasks/02-root/README.md", "---\nschema: nbook.task/v1\ntaskId: 01-alpha\n---\n\n# Duplicate\n");

        expect(verifyTaskOwnership(repoRoot).some((failure) => failure.startsWith("全仓 Task ID 重复：01-alpha"))).toBe(true);
    });

    it("ownership 精确选择应用与根 Task root", () => {
        const app = resolveLegacyTaskReadmePath(repositoryRoot, "01-agent-roleplay-mode");
        expect(app.path).toBe(join(repositoryRoot, "packages/neuro-book/.agents/tasks/01-agent-roleplay-mode/README.md"));
        expect(app.checkedRoots).toEqual(["packages/neuro-book/.agents/tasks"]);

        const root = resolveLegacyTaskReadmePath(repositoryRoot, "00149-monorepo-workspace-consolidation");
        expect(root.path).toBe(join(repositoryRoot, ".agents/tasks/00149-monorepo-workspace-consolidation/README.md"));
        expect(root.checkedRoots).toEqual([".agents/tasks"]);

        const missing = resolveLegacyTaskReadmePath(repositoryRoot, "99999-does-not-exist");
        expect(missing.path).toBeNull();
        expect(missing.checkedRoots).toEqual([".agents/tasks"]);
    });
});
describe("Work 与 Task 当前容器门禁", () => {
    it("合法 Work 内 Task 通过，且不需要旧 agentWorkflow、actionIssueId 或 role", async () => {
        const repoRoot = await createTestTmpRoot("governance-work", "governance-work-test");
        fixtureRoots.push(repoRoot);
        await writeText(repoRoot, ".agents/works/w00001-development-workflow-governance/README.md", "---\nschema: nbook.work/v1\nworkId: w00001-development-workflow-governance\nissueId: null\n---\n\n# Work\n");
        await writeText(repoRoot, ".agents/works/w00001-development-workflow-governance/tasks/t01-work-task-model/README.md", "---\nschema: nbook.task/v2\ntaskId: t01-work-task-model\n---\n\n# Task\n\n目标、协作与产物。\n");

        expect(verifyWorkContracts(repoRoot)).toEqual([]);
    });
    it("Work 必须直接包含至少一个 Task", async () => {
        const repoRoot = await createTestTmpRoot("governance-work-empty", "governance-work-empty-test");
        fixtureRoots.push(repoRoot);
        await writeText(repoRoot, ".agents/works/w00001-empty/README.md", "---\nschema: nbook.work/v1\nworkId: w00001-empty\nissueId: null\n---\n\n# Empty\n");
        await mkdir(join(repoRoot, ".agents/works/w00001-empty/tasks"), {recursive: true});

        expect(verifyWorkContracts(repoRoot)).toContain("Work 必须至少包含一个 Task：.agents/works/w00001-empty");
    });

    it("Work 与 Task frontmatter 身份必须匹配目录", async () => {
        const repoRoot = await createTestTmpRoot("governance-work-identity", "governance-work-identity-test");
        fixtureRoots.push(repoRoot);
        await writeText(repoRoot, ".agents/works/w00001-identity/README.md", "---\nschema: nbook.work/v1\nworkId: w00002-other\nissueId: null\n---\n\n# Work\n");
        await writeText(repoRoot, ".agents/works/w00001-identity/tasks/t01-task/README.md", "---\nschema: nbook.task/v2\ntaskId: t02-other\n---\n\n# Task\n");

        expect(verifyWorkContracts(repoRoot)).toEqual(expect.arrayContaining([
            expect.stringContaining("Work workId 与目录不一致"),
            expect.stringContaining("Work Task taskId 与目录不一致"),
        ]));
    });

    it("Work Task 拒绝已退役 role 字段", async () => {
        const repoRoot = await createTestTmpRoot("governance-work-role", "governance-work-role-test");
        fixtureRoots.push(repoRoot);
        await writeText(repoRoot, ".agents/works/w00001-role/README.md", "---\nschema: nbook.work/v1\nworkId: w00001-role\nissueId: null\n---\n\n# Work\n");
        await writeText(repoRoot, ".agents/works/w00001-role/tasks/t01-task/README.md", "---\nschema: nbook.task/v2\ntaskId: t01-task\nrole: tasker\n---\n\n# Task\n");

        expect(verifyWorkContracts(repoRoot)).toContain("Work Task 禁止旧字段 role：.agents/works/w00001-role/tasks/t01-task/README.md");
    });

    it.each(["agent-root", "works-root", "work", "tasks-root", "task"] as const)("治理检查拒绝 current 路径 symlink 或 junction：%s", async (kind) => {
        const fixture = await createLinkedWorkFixture(kind);

        expect(verifyWorkContracts(fixture.root)).toEqual([fixture.failure]);
    });

    it.each(["agent-root", "works-root", "work", "tasks-root", "task"] as const)("agent-context 拒绝 current 路径 symlink 或 junction：%s", async (kind) => {
        const fixture = await createLinkedWorkFixture(kind);

        const result = await runAgentContextCli(["--task", fixture.taskId, "--work", fixture.workId], fixture.root);
        expect(result.status).not.toBe(0);
        expect(result.failures).toEqual([fixture.failure]);
        expect(result.report?.workReadme).toBe(fixture.workReadme);
        expect(result.report?.taskReadme).toBeNull();
        expect(result.report).not.toHaveProperty("role");
        expect(result.report).not.toHaveProperty("taskRole");
    });

    it("旧根中的 v2 Task 由 legacy 校验拒收", async () => {
        const repoRoot = await createTestTmpRoot("governance-work-orphan", "governance-work-orphan-test");
        fixtureRoots.push(repoRoot);
        await writeText(repoRoot, ".agents/tasks/t01-orphan/README.md", "---\nschema: nbook.task/v2\ntaskId: t01-orphan\n---\n\n# Orphan\n");

        expect(verifyLegacyTaskProvenance(repoRoot)).toEqual(expect.arrayContaining([
            expect.stringContaining("旧归档根拒收 v2"),
        ]));
    });
    it("根旧归档的 nested v2 Task 由 legacy 校验拒收", async () => {
        const repoRoot = await createTestTmpRoot("governance-root-archive-v2", "governance-root-archive-v2-test");
        fixtureRoots.push(repoRoot);
        const relativePath = ".agents/tasks/archived/nested-v2/README.md";
        await writeText(repoRoot, relativePath, "---\nschema: nbook.task/v2\ntaskId: t01-nested\n---\n\n# Nested\n");

        expect(verifyLegacyTaskProvenance(repoRoot)).toContain(`旧归档根拒收 v2，请移入 .agents/works/<work>/tasks/<task>/：${relativePath}`);
    });

    it("自治包旧归档的 nested v2 Task 由 legacy 校验拒收", async () => {
        const repoRoot = await createTestTmpRoot("governance-package-archive-v2", "governance-package-archive-v2-test");
        fixtureRoots.push(repoRoot);
        const relativePath = "packages/neuro-agent-harness/.agents/tasks/archived/nested-v2/README.md";
        await writeText(repoRoot, relativePath, "---\nschema: nbook.task/v2\ntaskId: t01-nested\n---\n\n# Nested\n");

        expect(verifyLegacyTaskProvenance(repoRoot)).toContain(`旧归档根拒收 v2，请移入 .agents/works/<work>/tasks/<task>/：${relativePath}`);
    });
    it("根旧归档的非 archived nested v2 Task 由 legacy 校验拒收", async () => {
        const repoRoot = await createTestTmpRoot("governance-root-nested-v2", "governance-root-nested-v2-test");
        fixtureRoots.push(repoRoot);
        const relativePath = ".agents/tasks/group/t01-hidden/README.md";
        await writeText(repoRoot, relativePath, "---\nschema: nbook.task/v2\ntaskId: t01-hidden\n---\n\n# Hidden\n");

        expect(verifyLegacyTaskProvenance(repoRoot)).toContain(`旧归档根拒收 v2，请移入 .agents/works/<work>/tasks/<task>/：${relativePath}`);
    });

    it("自治包旧归档的非 archived nested v2 Task 由 legacy 校验拒收", async () => {
        const repoRoot = await createTestTmpRoot("governance-package-nested-v2", "governance-package-nested-v2-test");
        fixtureRoots.push(repoRoot);
        const relativePath = "packages/neuro-agent-harness/.agents/tasks/group/t01-hidden/README.md";
        await writeText(repoRoot, relativePath, "---\nschema: nbook.task/v2\ntaskId: t01-hidden\n---\n\n# Hidden\n");

        expect(verifyLegacyTaskProvenance(repoRoot)).toContain(`旧归档根拒收 v2，请移入 .agents/works/<work>/tasks/<task>/：${relativePath}`);
    });
});
describe("Task 治理上下文与 legacy 门禁", () => {
    it("治理 CLI 聚合合法 Work 与非法 Task 结果", async () => {
        const repoRoot = await createGovernanceCliFixture();
        const taskPath = ".agents/works/w00001-governance/tasks/t01-model/README.md";
        const valid = await runGovernanceCli(repoRoot);

        expect(valid.report.failures).toEqual([]);
        expect(valid.status, JSON.stringify(valid.report)).toBe(0);

        await writeText(repoRoot, taskPath, "---\nschema: nbook.task/v2\ntaskId: t02-other\n---\n\n# Invalid taskId\n");
        const invalidTaskId = await runGovernanceCli(repoRoot);
        expect(invalidTaskId.status).not.toBe(0);
        expect(invalidTaskId.report.failures).toContain(`Work Task taskId 与目录不一致：${taskPath}`);

        await writeText(repoRoot, taskPath, "---\nschema: nbook.task/v2\ntaskId: t01-model\nrole: tasker\n---\n\n# Retired role field\n");
        const retiredRole = await runGovernanceCli(repoRoot);
        expect(retiredRole.status).not.toBe(0);
        expect(retiredRole.report.failures).toContain(`Work Task 禁止旧字段 role：${taskPath}`);
    }, 30_000);

    it("agent-context 解析 Work 内 Task 并返回 v2 context", async () => {
        const repoRoot = await createTestTmpRoot("governance-context-work", "governance-context-work-test");
        fixtureRoots.push(repoRoot);
        await writeText(repoRoot, ".agents/works/w00001-development-workflow-governance/README.md", "---\nschema: nbook.work/v1\nworkId: w00001-development-workflow-governance\nissueId: null\n---\n\n# Work\n");
        await writeText(repoRoot, ".agents/works/w00001-development-workflow-governance/tasks/t01-work-task-model/README.md", "---\nschema: nbook.task/v2\ntaskId: t01-work-task-model\n---\n\n# Task\n");
        await initializeGitFixture(repoRoot);
        const result = await runAgentContextCli(["--task", "t01-work-task-model", "--work", "w00001-development-workflow-governance"], repoRoot);

        expect(result.status).toBe(0);
        expect(result.failures).toEqual([]);
        expect(result.report?.schema).toBe("nbook.governance-context/v2");
        expect(result.report?.work).toBe("w00001-development-workflow-governance");
        expect(result.report?.workReadme).toBe(join(repoRoot, ".agents/works/w00001-development-workflow-governance/README.md"));
        expect(result.report?.taskReadme).toBe(join(repoRoot, ".agents/works/w00001-development-workflow-governance/tasks/t01-work-task-model/README.md"));
        expect(result.report).not.toHaveProperty("role");
        expect(result.report).not.toHaveProperty("requestedRole");
        expect(result.report).not.toHaveProperty("taskRole");
        expect(result.report).not.toHaveProperty("roleContract");
    });

    it("agent-context 裸调用和只指定 Work 时可用", async () => {
        const bare = await runAgentContextCli([], repositoryRoot);
        expect(bare.status).toBe(0);
        expect(bare.failures).toEqual([]);
        expect(bare.report?.schema).toBe("nbook.governance-context/v2");
        expect(bare.report?.work).toBeNull();
        expect(bare.report?.workReadme).toBeNull();
        expect(bare.report?.task).toBeNull();
        expect(bare.report?.taskReadme).toBeNull();

        const workOnly = await runAgentContextCli(["--work", "w00001-development-workflow-governance"], repositoryRoot);
        expect(workOnly.status).toBe(0);
        expect(workOnly.failures).toEqual([]);
        expect(workOnly.report?.workReadme).toBe(join(repositoryRoot, ".agents/works/w00001-development-workflow-governance/README.md"));
        expect(workOnly.report?.taskReadme).toBeNull();
    });

    it.each([
        {name: "retired-role", flags: ["--task", "t01-work-task-model", "--role", "tasker"], failure: "未知参数：--role"},
        {name: "unknown-flag", flags: ["--engine", "bun"], failure: "未知参数：--engine"},
        {name: "missing-value", flags: ["--work"], failure: "参数缺少值：--work"},
        {name: "duplicate-flag", flags: ["--work", "w00001-development-workflow-governance", "--work", "w00002-other"], failure: "参数重复：--work"},
        {name: "value-not-consumed", flags: ["--task", "--work"], failure: "参数缺少值：--task"},
    ])("agent-context 拒绝非法参数：$name", async ({flags, failure}) => {
        const result = await runAgentContextCli(flags, repositoryRoot);

        expect(result.status).not.toBe(0);
        expect(result.failures).toContain(failure);
        expect(result.report).toBeDefined();
        expect(result.report?.workReadme).toBeNull();
        expect(result.report?.taskReadme).toBeNull();
    });

    it("agent-context 接受 package runner 的单独 -- 分隔符", async () => {
        const result = await runAgentContextCli(["--", "--work", "w00001-development-workflow-governance"], repositoryRoot);

        expect(result.status).toBe(0);
        expect(result.failures).toEqual([]);
        expect(result.report?.workReadme).toBe(join(repositoryRoot, ".agents/works/w00001-development-workflow-governance/README.md"));
    });
    it("agent-context 拒绝非法 Work 合同", async () => {
        const workId = "w00001-invalid-work";
        const taskId = "t01-task";
        const workPath = `.agents/works/${workId}/README.md`;
        const taskPath = `.agents/works/${workId}/tasks/${taskId}/README.md`;
        const cases = [
            {name: "schema", frontmatter: `schema: nbook.work/v0\nworkId: ${workId}\nissueId: null`, failure: `Work schema 无效：${workPath}`},
            {name: "work-id", frontmatter: "schema: nbook.work/v1\nworkId: w00002-other\nissueId: null", failure: `Work workId 与目录不一致：${workPath}`},
            {name: "issue-id", frontmatter: `schema: nbook.work/v1\nworkId: ${workId}\nissueId: i0`, failure: `Work issueId 必须是 i 加正整数或 null：${workPath}`},
        ];

        for (const [index, testCase] of cases.entries()) {
            const repoRoot = await createTestTmpRoot(`governance-context-invalid-work-${String(index)}`, `governance-context-invalid-work-${testCase.name}-test`);
            fixtureRoots.push(repoRoot);
            await writeText(repoRoot, workPath, `---\n${testCase.frontmatter}\n---\n\n# Invalid Work\n`);
            await writeText(repoRoot, taskPath, `---\nschema: nbook.task/v2\ntaskId: ${taskId}\n---\n\n# Task\n`);
            await initializeGitFixture(repoRoot);

            const result = await runAgentContextCli(["--task", taskId, "--work", workId], repoRoot);
            expect(result.status).not.toBe(0);
            expect(result.failures).toContain(testCase.failure);
            expect(result.report?.workReadme).toBe(join(repoRoot, workPath));
            expect(result.report?.taskReadme).toBeNull();
        }
    });

    it("agent-context 拒绝非法 Task 合同", async () => {
        const workId = "w00001-invalid-task";
        const taskId = "t01-task";
        const workPath = `.agents/works/${workId}/README.md`;
        const taskPath = `.agents/works/${workId}/tasks/${taskId}/README.md`;
        const cases = [
            {name: "schema", frontmatter: `schema: nbook.task/v1\ntaskId: ${taskId}`, failure: `Work Task schema 无效：${taskPath}`},
            {name: "task-id", frontmatter: "schema: nbook.task/v2\ntaskId: t02-other", failure: `Work Task taskId 与目录不一致：${taskPath}`},
            ...["actionIssueId", "agentWorkflow", "kind", "worktreeId", "branchId", "role"].map((field) => ({
                name: field,
                frontmatter: `schema: nbook.task/v2\ntaskId: ${taskId}\n${field}: null`,
                failure: `Work Task 禁止旧字段 ${field}：${taskPath}`,
            })),
        ];

        for (const [index, testCase] of cases.entries()) {
            const repoRoot = await createTestTmpRoot(`governance-context-invalid-task-${String(index)}`, `governance-context-invalid-task-${testCase.name}-test`);
            fixtureRoots.push(repoRoot);
            await writeText(repoRoot, workPath, `---\nschema: nbook.work/v1\nworkId: ${workId}\nissueId: null\n---\n\n# Work\n`);
            await writeText(repoRoot, taskPath, `---\n${testCase.frontmatter}\n---\n\n# Invalid Task\n`);
            await initializeGitFixture(repoRoot);

            const result = await runAgentContextCli(["--task", taskId, "--work", workId], repoRoot);
            expect(result.status).not.toBe(0);
            expect(result.failures).toContain(testCase.failure);
            expect(result.report?.workReadme).toBe(join(repoRoot, workPath));
            expect(result.report?.taskReadme).toBe(join(repoRoot, taskPath));
        }
    }, 30_000);

    it("agent-context 对 malformed 或非对象 frontmatter 返回 JSON failure", async () => {
        const workId = "w00001-invalid-frontmatter";
        const taskId = "t01-task";
        const workPath = `.agents/works/${workId}/README.md`;
        const taskPath = `.agents/works/${workId}/tasks/${taskId}/README.md`;
        const cases = [
            {name: "malformed", frontmatter: "taskId: [", failure: `Task frontmatter 无法解析：${taskPath}`},
            {name: "non-object", frontmatter: "null", failure: `Task frontmatter 必须是对象：${taskPath}`},
        ];

        for (const [index, testCase] of cases.entries()) {
            const repoRoot = await createTestTmpRoot(`governance-context-invalid-frontmatter-${String(index)}`, `governance-context-${testCase.name}-frontmatter-test`);
            fixtureRoots.push(repoRoot);
            await writeText(repoRoot, workPath, `---\nschema: nbook.work/v1\nworkId: ${workId}\nissueId: null\n---\n\n# Work\n`);
            await writeText(repoRoot, taskPath, `---\n${testCase.frontmatter}\n---\n\n# Invalid Task\n`);
            await initializeGitFixture(repoRoot);

            const result = await runAgentContextCli(["--task", taskId, "--work", workId], repoRoot);
            expect(result.status).not.toBe(0);
            expect(result.failures.some((failure) => failure.startsWith(testCase.failure))).toBe(true);
            expect(result.failures).toContain(`Work Task 缺少有效 frontmatter：${taskPath}`);
            expect(result.report?.workReadme).toBe(join(repoRoot, workPath));
            expect(result.report?.taskReadme).toBe(join(repoRoot, taskPath));
        }
    });
    it("agent-context 没有 Work 时拒绝 Task", async () => {
        const result = await runAgentContextCli(["--task", "t01-work-task-model"], repositoryRoot);

        expect(result.status).not.toBe(0);
        expect(result.failures).toContain("Task 必须同时指定 Work：t01-work-task-model");
        expect(result.report?.workReadme).toBeNull();
        expect(result.report?.taskReadme).toBeNull();
    });
    it("agent-context 对不存在的 Work 只报告一次失败", async () => {
        const result = await runAgentContextCli(["--task", "t01-task", "--work", "w99999-missing"], repositoryRoot);

        expect(result.status).not.toBe(0);
        expect(result.failures).toEqual(["Work README 不存在：w99999-missing"]);
    });
    it("agent-context 拒绝旧根 Task fallback", async () => {
        const repoRoot = await createTestTmpRoot("governance-context-legacy", "governance-context-legacy-test");
        fixtureRoots.push(repoRoot);
        await writeText(repoRoot, ".agents/tasks/t01-legacy/README.md", "---\nschema: nbook.task/v2\ntaskId: t01-legacy\n---\n\n# Legacy\n");
        await initializeGitFixture(repoRoot);
        const result = await runAgentContextCli(["--task", "t01-legacy"], repoRoot);

        expect(result.status).not.toBe(0);
        expect(result.failures).toContain("Task 必须同时指定 Work：t01-legacy");
    });





    it("历史 Task 可缺少 agentWorkflow，但仍有完整基础字段", async () => {
        const taskId = "00149-monorepo-workspace-consolidation";
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: ${taskId}
status: completed
createdAt: 2026-08-16T14:59:07Z
updatedAt: 2026-08-19T10:35:00Z
---

# Historical Task
`, taskId);

        expect(verifyLegacyTaskProvenance(repoRoot)).toEqual([]);
    });

    it("新 Task 缺少成熟度或 agentWorkflow 时失败", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 00161-profile
issueRequired: false
actionIssueId: null
worktreeId: null
branchId: master
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
---

# Incomplete Task
`);

        expect(verifyLegacyTaskProvenance(repoRoot)).toEqual(expect.arrayContaining([
            expect.stringContaining("Task status 无效"),
            expect.stringContaining("新 Task 缺少 agentWorkflow"),
        ]));
    });

    it("新 Task 缺少 context 时失败", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 00161-profile
issueRequired: false
actionIssueId: null
worktreeId: null
branchId: master
status: planned
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: docs
  routes:
    - documentation-and-adrs
  verification:
    required:
      - docs-check
    notRun: []
---

# Missing context Task
`);
        await rm(join(repoRoot, ".agents/tasks/00161-profile/context.md"));

        expect(verifyLegacyTaskProvenance(repoRoot)).toContain("Task 缺少 context.md：.agents/tasks/00161-profile/README.md");
    });

    it("合法 design Task 必须声明设计边界与 API 路由", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 00161-profile
issueRequired: false
actionIssueId: null
worktreeId: null
branchId: master
status: completed
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: design
  routes:
    - api-and-interface-design
  verification:
    required:
      - docs-check
    notRun: []
---

# API Design Task

## 设计类型

API

## 设计产物

- docs/specs/example/api.md

## 决策范围

- API输入、输出、错误与兼容。

## 允许文件

- docs/specs/example/api.md
`);

        expect(verifyLegacyTaskProvenance(repoRoot)).toEqual([]);
    });

    it("design Task 缺少设计边界或 API 路由时失败", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 00161-profile
issueRequired: false
actionIssueId: null
worktreeId: null
branchId: master
status: completed
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: design
  routes:
    - documentation-and-adrs
  verification:
    required:
      - docs-check
    notRun: []
---

# API Design Task

## 设计类型

API
`);

        expect(verifyLegacyTaskProvenance(repoRoot)).toEqual(expect.arrayContaining([
            expect.stringContaining("design Task 必须有唯一 Proposal/Spec 设计产物"),
            expect.stringContaining("design Task 缺少决策范围"),
            expect.stringContaining("design Task 缺少允许文件"),
            expect.stringContaining("API design Task 缺少 api-and-interface-design"),
        ]));
    });

    it("新 Task 不能用缺失 README 或错误 schema 绕过合同", async () => {
        const taskId = "00161-profile";
        const repoRoot = await createTaskWorkflowFixture(`---
schema: wrong.task/v1
taskId: ${taskId}
---

# Wrong schema Task
`, taskId);

        expect(verifyLegacyTaskProvenance(repoRoot)).toContain(`新 Task 缺少有效 nbook.task/v1 frontmatter：.agents/tasks/${taskId}/README.md`);
        await rm(join(repoRoot, `.agents/tasks/${taskId}/README.md`));
        expect(verifyLegacyTaskProvenance(repoRoot)).toContain(`新 Task 缺少 README.md：.agents/tasks/${taskId}/README.md`);
    });

    it("根 Task 拒绝非法 ID 形状且高序号不能伪装历史", async () => {
        const invalidId = "100000-invalid";
        const invalidRoot = await createTaskWorkflowFixture("# Invalid root Task\n", invalidId);
        expect(verifyLegacyTaskProvenance(invalidRoot)).toContain(`根 Task 标识无效：${invalidId}`);

        const highShortId = "999-current";
        const highShortRoot = await createTaskWorkflowFixture("# High short root Task\n", highShortId);
        expect(verifyLegacyTaskProvenance(highShortRoot)).toContain(`根 Task 标识无效：${highShortId}`);
    });

    it("根 Task 拒绝零编号和未登记的低编号历史伪装", async () => {
        for (const taskId of ["00-invalid", "000-invalid", "00000-invalid", "99-new", "148-new", "00149-other", "00150-other", "00151-new"] as const) {
            const repoRoot = await createTaskWorkflowFixture("# Invalid historical identity\n", taskId);
            expect(verifyLegacyTaskProvenance(repoRoot), taskId).toContain(`根 Task 标识无效：${taskId}`);
        }
    });

    it("低编号历史身份必须同时命中 sourceRevision 基线和迁移 mapping", async () => {
        const validRoot = await createHistoricalTaskWorkflowFixture("99-legacy", "valid");
        expect(verifyLegacyTaskProvenance(validRoot)).not.toContain("根 Task 标识无效：99-legacy");

        for (const mode of ["missing-baseline", "missing-mapping"] as const) {
            const invalidRoot = await createHistoricalTaskWorkflowFixture("99-legacy", mode);
            expect(verifyLegacyTaskProvenance(invalidRoot), mode).toContain("根 Task 标识无效：99-legacy");
        }
    });
    it("按稳定根 Task 顺序先处理无关 Design 错误且不污染有效 legacy identity", async () => {
        const repoRoot = await createHistoricalTaskWorkflowFixture("99-legacy", "valid");
        await writeText(repoRoot, ".agents/tasks/00161-design/README.md", designTaskReadme({
            taskId: "00161-design",
            output: "docs/specs/../../AGENTS.md",
            status: "planned",
        }));
        await writeText(repoRoot, ".agents/tasks/00161-design/context.md", "# Unrelated Design Context\n");

        const failures = verifyLegacyTaskProvenance(repoRoot);
        expect(failures).toContain("design Task 必须有唯一 Proposal/Spec 设计产物：.agents/tasks/00161-design/README.md");
        expect(failures).not.toContain("根 Task 标识无效：99-legacy");
    });

    it("历史身份在 index 与 marker 密封值不一致时 fail closed", async () => {
        const repoRoot = await createHistoricalTaskWorkflowFixture("99-legacy", "mismatched-marker");

        expect(verifyLegacyTaskProvenance(repoRoot)).toEqual(expect.arrayContaining([
            "历史 Task 迁移 index/marker 不一致",
            "根 Task 标识无效：99-legacy",
        ]));
    });


    it("后续可达 commit 和工作树 mapping 不能伪造历史身份", async () => {
        const repoRoot = await createForgedHistoricalIdentityFixture("99-new");

        expect(verifyLegacyTaskProvenance(repoRoot)).toContain("根 Task 标识无效：99-new");
    });
    it("当前迁移 metadata 含畸形 mapping 时 fail closed", async () => {
        const repoRoot = await createHistoricalTaskWorkflowFixture("99-legacy", "valid");
        const indexPath = join(repoRoot, ".agents/tasks/legacy-index.json");
        const index = JSON.parse(await readFile(indexPath, "utf8")) as {mappings: unknown[]};
        index.mappings = [null];
        await writeFile(indexPath, JSON.stringify(index));

        expect(verifyLegacyTaskProvenance(repoRoot)).toContain("当前历史 Task 迁移 mapping 结构无效");
    });
    it("密封迁移快照含畸形 mapping 时 fail closed", async () => {
        const repoRoot = await createMalformedSealedMappingFixture();

        expect(verifyLegacyTaskProvenance(repoRoot)).toContain("历史 Task 迁移密封 mapping 结构无效");
    });
    it("密封迁移 JSON 顶层不是对象时 fail closed", async () => {
        const repoRoot = await createInvalidSealedJsonShapeFixture();

        expect(verifyLegacyTaskProvenance(repoRoot)).toContain("历史 Task 迁移密封快照结构无效");
    });




    it.each(["null", "193"])("根与应用当前 Task 接受 actionIssueId %s", async (actionIssueId) => {
        const rootReadme = currentTaskReadme({actionIssueId});
        const root = await createTaskWorkflowFixture(rootReadme);
        expect(verifyLegacyTaskProvenance(root)).toEqual([]);

        const taskId = "149-profile";
        const appReadme = currentTaskReadme({taskId, actionIssueId});
        const app = await createApplicationTaskWorkflowFixture(appReadme, taskId);
        expect(verifyLegacyTaskProvenance(app)).toEqual([]);
    });

    it.each(["missing", "0", "-1", "\"193\"", "[193]"] as const)("当前 Task 拒绝 actionIssueId %s", async (actionIssueId) => {
        const readme = currentTaskReadme({actionIssueId});
        const repoRoot = await createTaskWorkflowFixture(readme);

        expect(verifyLegacyTaskProvenance(repoRoot)).toContain("Task actionIssueId 必须是正整数或 null：.agents/tasks/00161-profile/README.md");
    });

    it("当前 Task 拒绝遗留 issueRequired 字段", async () => {
        const readme = currentTaskReadme({actionIssueId: "null"}).replace("actionIssueId: null", "issueRequired: false\nactionIssueId: null");
        const repoRoot = await createTaskWorkflowFixture(readme, "00161-profile", {preserveIssueRequired: true});

        expect(verifyLegacyTaskProvenance(repoRoot)).toContain("Task 禁止字段 issueRequired：.agents/tasks/00161-profile/README.md");
    });

    it("draft 不再是合法 Task 状态", async () => {
        const repoRoot = await createTaskWorkflowFixture(currentTaskReadme({status: "draft"}));

        expect(verifyLegacyTaskProvenance(repoRoot)).toContain("Task status 无效：.agents/tasks/00161-profile/README.md");
    });

    it.each(["目标", "Agent 工作", "开发者参与", "任务产物", "修改计划", "完成门禁", "Leader 继续条件", "允许文件"] as const)("活动 Task 缺少 %s 章节时失败", async (section) => {
        const readme = removeMarkdownSection(currentTaskReadme(), section);
        const repoRoot = await createTaskWorkflowFixture(readme, "00161-profile", {appendSections: false});

        expect(verifyLegacyTaskProvenance(repoRoot)).toContain(`Task 缺少${section}：.agents/tasks/00161-profile/README.md`);
    });

    it.each([
        "```markdown\n## 开发者参与\n\n伪造内容\n```",
        "    ## 开发者参与\n+\n+    伪造内容",
        "<!--\n## 开发者参与\n\n伪造内容\n-->",
    ])("代码块中的协作标题不能满足合同", async (fakeSection) => {
        const readme = `${removeMarkdownSection(currentTaskReadme(), "开发者参与")}\n${fakeSection}\n`;
        const repoRoot = await createTaskWorkflowFixture(readme, "00161-profile", {appendSections: false});

        expect(verifyLegacyTaskProvenance(repoRoot)).toContain("Task 缺少开发者参与：.agents/tasks/00161-profile/README.md");
    });

    it.each(["completed", "abandoned"] as const)("%s Task 不回填协作章节", async (status) => {
        const repoRoot = await createTaskWorkflowFixture(currentTaskReadme({status}), "00161-profile", {appendSections: false});

        expect(verifyLegacyTaskProvenance(repoRoot)).toEqual([]);
    });

    it("research Task 叠加研究专属章节并约束产物路径", async () => {
        const taskRoot = ".agents/tasks/00161-profile";
        const output = `${taskRoot}/evidences/result.md`;
        const allowedFiles = `## 允许文件

- ${output}`;
        const readme = currentTaskReadme({
            kind: "research",
            extraSections: `## 研究问题

- 宿主需要什么？

## 研究产物

- ${output}

## 决策范围

- 首版宿主。
`,
        }).replace(`## 允许文件

- ${taskRoot}/**`, allowedFiles);

        const repoRoot = await createTaskWorkflowFixture(readme);
        await runGit(repoRoot, ["init", "--initial-branch", "master"]);
        await runGit(repoRoot, ["config", "user.email", "governance-test@example.invalid"]);
        await runGit(repoRoot, ["config", "user.name", "Governance Test"]);
        await runGit(repoRoot, ["add", "."]);
        await runGit(repoRoot, ["commit", "-m", "research contract baseline"]);
        expect(verifyLegacyTaskProvenance(repoRoot)).toEqual([]);

        for (const contractPath of [`${taskRoot}/README.md`, `${taskRoot}/context.md`]) {
            await writeText(repoRoot, `${taskRoot}/README.md`, readme.replace(allowedFiles, `${allowedFiles}\n- ${contractPath}`));
            expect(verifyLegacyTaskProvenance(repoRoot)).toContain(`research Task 允许文件越界：${taskRoot}/README.md -> ${contractPath}`);
        }

        await writeText(repoRoot, `${taskRoot}/README.md`, removeMarkdownSection(readme, "研究产物"));
        expect(verifyLegacyTaskProvenance(repoRoot)).toContain(`research Task 缺少研究产物：${taskRoot}/README.md`);

        await writeText(repoRoot, `${taskRoot}/README.md`, readme.replace(output, "docs/result.md"));
        expect(verifyLegacyTaskProvenance(repoRoot)).toContain(`research Task 研究产物越界：${taskRoot}/README.md -> docs/result.md`);

        await writeText(repoRoot, `${taskRoot}/README.md`, readme.replace(allowedFiles, `${allowedFiles}\n- docs/extra.md`));
        expect(verifyLegacyTaskProvenance(repoRoot)).toContain(`research Task 允许文件越界：${taskRoot}/README.md -> docs/extra.md`);

        for (const marker of ["*", "+"] as const) {
            await writeText(repoRoot, `${taskRoot}/README.md`, readme.replace(allowedFiles, `${allowedFiles}\n${marker} ../../outside`));
            expect(verifyLegacyTaskProvenance(repoRoot)).toContain(`research Task 允许文件越界：${taskRoot}/README.md -> ../../outside`);
        }

        await writeText(repoRoot, `${taskRoot}/README.md`, readme.replace(allowedFiles, allowedFiles.replace(`\n- ${output}`, "")));
        expect(verifyLegacyTaskProvenance(repoRoot)).toContain(`research Task 允许文件缺少研究产物：${taskRoot}/README.md -> ${output}`);

        for (const disguisedEntry of [
            `\`\`\`markdown\n- ${taskRoot}/evidences/hidden.md\n\`\`\``,
            `    - ${taskRoot}/evidences/hidden.md`,
            `<!-- - ${output} -->`,
            `<!--\n- ${output}\n-->`,
            `\`\`\`markdown\n\`\`\`not-a-closing-fence\n- ${output}\n\`\`\``,
        ]) {
            await writeText(repoRoot, `${taskRoot}/README.md`, readme.replace(`- ${output}`, disguisedEntry));
            expect(verifyLegacyTaskProvenance(repoRoot)).toContain(`research Task 缺少研究产物：${taskRoot}/README.md`);
        }

        const annotatedExtra = `\`${taskRoot}/evidences/extra.md\`（Leader 维护）`;
        await writeText(repoRoot, `${taskRoot}/README.md`, readme.replace(allowedFiles, `${allowedFiles}\n- ${annotatedExtra}`));
        expect(verifyLegacyTaskProvenance(repoRoot)).toContain(`research Task 允许文件越界：${taskRoot}/README.md -> ${annotatedExtra}`);

        const commentedAllowedFiles = `## 允许文件\n\n<!--\n- ${output}\n-->`;
        await writeText(repoRoot, `${taskRoot}/README.md`, readme.replace(allowedFiles, commentedAllowedFiles));
        expect(verifyLegacyTaskProvenance(repoRoot)).toContain(`research Task 允许文件缺少研究产物：${taskRoot}/README.md -> ${output}`);
    }, 15_000);

    it.each(["staged", "unstaged", "untracked"] as const)("自治包 active research 拒绝 %s leak-only 实际越界", async (changeMode) => {
        const fixture = await createPackageResearchDiffFixture();
        const leakedPath = changeMode === "untracked" ? `${fixture.packageRoot}/src/untracked.ts` : fixture.trackedBoundaryPath;
        await writeText(fixture.root, leakedPath, `export const leaked = ${JSON.stringify(changeMode)};\n`);
        if (changeMode === "staged") await runGit(fixture.root, ["add", leakedPath]);

        expect(verifyLegacyTaskProvenance(fixture.root)).toContain(`research Task diff 越界：${fixture.readmePath} -> ${leakedPath}`);
    });

    it.each([
        ["kind", "kind: research", "kind: docs"],
        ["status", "status: planned", "status: completed"],
    ] as const)("HEAD active research 拒绝当前 %s 关闭实际差异门禁", async (_field, before, after) => {
        const fixture = await createPackageResearchDiffFixture();
        await writeText(fixture.root, fixture.readmePath, fixture.readme.replace(before, after));
        await writeText(fixture.root, fixture.trackedBoundaryPath, "export const escaped = true;\n");

        expect(verifyLegacyTaskProvenance(fixture.root)).toContain(`research Task diff 越界：${fixture.readmePath} -> ${fixture.trackedBoundaryPath}`);
    });

    it("HEAD active research 拒绝删除当前合同关闭实际差异门禁", async () => {
        const fixture = await createPackageResearchDiffFixture();
        await rm(join(fixture.root, fixture.readmePath));
        await rm(join(fixture.root, fixture.contextPath));
        await writeText(fixture.root, fixture.trackedBoundaryPath, "export const escaped = true;\n");

        expect(verifyLegacyTaskProvenance(fixture.root)).toContain(`research Task diff 越界：${fixture.readmePath} -> ${fixture.trackedBoundaryPath}`);
    });

    it("active research 的 HEAD 列表不可读时 fail closed 且不回退当前树", async () => {
        const fixture = await createPackageResearchDiffFixture();
        const secondRoot = `${fixture.packageRoot}/.agents/tasks/03-research`;
        await writeText(fixture.root, `${secondRoot}/README.md`, fixture.readme.replaceAll("02-research", "03-research"));
        await writeText(fixture.root, `${secondRoot}/context.md`, "# Second research context\n");
        await rm(join(fixture.root, ".git", "HEAD"));

        const failures = verifyLegacyTaskProvenance(fixture.root);
        expect(failures.some((failure) => failure.startsWith("research Task HEAD 密封合同无法读取："))).toBe(true);
        expect(failures).not.toEqual(expect.arrayContaining([
            expect.stringContaining("当前 owner scope 命中多个活跃 research Task"),
        ]));
    });

    it("active research 的 HEAD 文件不可读时 fail closed 且阻止该路径回退", async () => {
        const fixture = await createPackageResearchDiffFixture();
        const blob = (await runGit(fixture.root, ["rev-parse", `HEAD:${fixture.readmePath}`])).trim();
        await rm(join(fixture.root, ".git", "objects", blob.slice(0, 2), blob.slice(2)));
        const secondRoot = `${fixture.packageRoot}/.agents/tasks/03-research`;
        await writeText(fixture.root, `${secondRoot}/README.md`, fixture.readme.replaceAll("02-research", "03-research"));
        await writeText(fixture.root, `${secondRoot}/context.md`, "# Second research context\n");

        const failures = verifyLegacyTaskProvenance(fixture.root);
        expect(failures.some((failure) => failure.startsWith(`research Task HEAD 密封合同文件无法读取：${fixture.readmePath}：`))).toBe(true);
        expect(failures).not.toEqual(expect.arrayContaining([
            expect.stringContaining("当前 owner scope 命中多个活跃 research Task"),
        ]));
    });

    it("自治包 HEAD research 只接受 taskId 与目录一致的当前 v1 合同", async () => {
        const fixture = await createPackageResearchDiffFixture();
        const forgedRoot = `${fixture.packageRoot}/.agents/tasks/03-forged`;
        await writeText(fixture.root, `${forgedRoot}/README.md`, fixture.readme.replace("taskId: 02-research", "taskId: another-task"));
        await writeText(fixture.root, `${forgedRoot}/context.md`, "# Forged research context\n");
        await runGit(fixture.root, ["add", forgedRoot]);
        await runGit(fixture.root, ["commit", "-m", "add mismatched autonomous task"]);

        const failures = verifyLegacyTaskProvenance(fixture.root);
        expect(failures).toContain(`Task taskId 与目录不一致：${forgedRoot}/README.md`);
        expect(failures).not.toContain(`当前 owner scope 命中多个活跃 research Task：${fixture.readmePath}, ${forgedRoot}/README.md`);
    });

    it("自治包 active research 收集 staged、unstaged、untracked 允许路径", async () => {
        const fixture = await createPackageResearchDiffFixture();
        await writeText(fixture.root, fixture.readmePath, fixture.readme.replace("updatedAt: 2026-08-26T00:00:00Z", "updatedAt: 2026-08-27T00:00:00Z"));
        await runGit(fixture.root, ["add", fixture.readmePath]);
        await writeText(fixture.root, fixture.contextPath, "# Updated research context\n");
        await writeText(fixture.root, fixture.untrackedOutputPath, "# New research result\n");

        const failures = verifyLegacyTaskProvenance(fixture.root);
        for (const path of [fixture.readmePath, fixture.contextPath, fixture.untrackedOutputPath]) {
            expect(failures).not.toContain(`research Task diff 越界：${fixture.readmePath} -> ${path}`);
        }
    });

    it("自治包 active research 不接管 owner scope 外改动", async () => {
        const fixture = await createPackageResearchDiffFixture();
        await writeText(fixture.root, "packages/other-package/src/change.ts", "export const unrelated = true;\n");

        expect(verifyLegacyTaskProvenance(fixture.root)).not.toEqual(expect.arrayContaining([
            expect.stringContaining("research Task diff 越界"),
        ]));
    });

    it("同一 owner scope 多个 active research 时 fail closed", async () => {
        const fixture = await createPackageResearchDiffFixture();
        const secondRoot = `${fixture.packageRoot}/.agents/tasks/03-research`;
        const secondReadme = fixture.readme
            .replaceAll("02-research", "03-research")
            .replaceAll("evidences/result.md", "evidences/second-result.md")
            .replaceAll("evidences/additional.md", "evidences/second-additional.md");
        await writeText(fixture.root, `${secondRoot}/README.md`, secondReadme);
        await writeText(fixture.root, `${secondRoot}/context.md`, "# Second research context\n");

        expect(verifyLegacyTaskProvenance(fixture.root)).toContain(`当前 owner scope 命中多个活跃 research Task：${fixture.readmePath}, ${secondRoot}/README.md`);
    });

    it("自治包 v1 Task 使用同一合同且忽略无 frontmatter 历史记录", async () => {
        const repoRoot = await createTaskWorkflowFixture(currentTaskReadme({status: "completed"}));
        await writeText(repoRoot, "packages/neuro-agent-harness/.agents/tasks/02-research/README.md", currentTaskReadme({taskId: "02-research"}));
        await writeText(repoRoot, "packages/neuro-agent-harness/.agents/tasks/02-research/context.md", "# Context\n");
        await writeText(repoRoot, "packages/neuro-agent-harness/.agents/tasks/01-history/README.md", "# Imported history\n");

        expect(verifyLegacyTaskProvenance(repoRoot)).toEqual([]);
        const packageReadme = "packages/neuro-agent-harness/.agents/tasks/02-research/README.md";
        await writeText(repoRoot, packageReadme, removeMarkdownSection(currentTaskReadme({taskId: "02-research"}), "开发者参与"));
        expect(verifyLegacyTaskProvenance(repoRoot)).toContain(`Task 缺少开发者参与：${packageReadme}`);
    });

    it("自治包旧根中的 v2 Task 由 legacy 校验拒收", async () => {
        const repoRoot = await createTestTmpRoot("governance-package-v2", "governance-package-v2-test");
        fixtureRoots.push(repoRoot);
        const relativePath = "packages/neuro-agent-harness/.agents/tasks/02-v2/README.md";
        await writeText(repoRoot, relativePath, "---\nschema: nbook.task/v2\ntaskId: t01-package\n---\n\n# Package v2\n");

        expect(verifyLegacyTaskProvenance(repoRoot)).toEqual(expect.arrayContaining([
            expect.stringContaining(`旧归档根拒收 v2，请移入 .agents/works/<work>/tasks/<task>/：${relativePath}`),
        ]));
    });

    it("当前 Task 必须显式声明有效执行身份", async () => {
        const taskId = "00161-profile";
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: ${taskId}
issueRequired: false
actionIssueId: null
worktreeId: ""
branchId: 42
status: planned
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: docs
  routes:
    - documentation-and-adrs
  verification:
    required:
      - docs-check
    notRun: []
---

# Invalid execution identity Task
`, taskId);
        expect(verifyLegacyTaskProvenance(repoRoot)).toEqual(expect.arrayContaining([
            expect.stringContaining("Task worktreeId 必须是非空字符串或 null"),
            expect.stringContaining("Task branchId 必须是非空字符串或 null"),
        ]));

        const missingRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: ${taskId}
issueRequired: false
actionIssueId: null
status: planned
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: docs
  routes:
    - documentation-and-adrs
  verification:
    required:
      - docs-check
    notRun: []
---

# Missing execution identity Task
`, taskId);
        expect(verifyLegacyTaskProvenance(missingRoot)).toEqual(expect.arrayContaining([
            expect.stringContaining("Task worktreeId 必须是非空字符串或 null"),
            expect.stringContaining("Task branchId 必须是非空字符串或 null"),
        ]));
    });

    it("新 Task 拒绝非法 Issue 聚合字段和 parentTaskId", async () => {
        const taskId = "00161-profile";
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: ${taskId}
issueRequired: false
actionIssueId:
  - 191
parentTaskId: 00160-parent
worktreeId: null
branchId: master
status: planned
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: docs
  routes:
    - documentation-and-adrs
  verification:
    required:
      - docs-check
    notRun: []
---

# Invalid aggregation Task
`, taskId);

        expect(verifyLegacyTaskProvenance(repoRoot)).toEqual(expect.arrayContaining([
            expect.stringContaining("Task actionIssueId 必须是正整数或 null"),
            expect.stringContaining("Task 禁止聚合字段 parentTaskId"),
        ]));
    });

    it("design Task 拒绝多目标和业务源码允许路径", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 00161-profile
actionIssueId: null
worktreeId: null
branchId: master
status: completed
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: design
  routes:
    - documentation-and-adrs
  verification:
    required:
      - docs-check
    notRun: []
---

# Invalid API Design Task

## 设计类型

- API

## 设计产物

- docs/specs/example/api.md
- docs/proposals/example-api.md

## 决策范围

- API输入与输出。

## 允许文件

- docs/specs/example/api.md
- packages/neuro-book/app/api.ts
`);

        expect(verifyLegacyTaskProvenance(repoRoot)).toEqual(expect.arrayContaining([
            expect.stringContaining("design Task 必须有唯一 Proposal/Spec 设计产物"),
            expect.stringContaining("design Task 允许文件越界"),
            expect.stringContaining("API design Task 缺少 api-and-interface-design"),
        ]));
    });

    it("design Task 拒绝可穿越到允许根外的设计产物", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 00161-profile
actionIssueId: null
worktreeId: null
branchId: master
status: completed
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: design
  routes:
    - documentation-and-adrs
  verification:
    required:
      - docs-check
    notRun: []
---

# Traversal Design Task

## 设计类型

安全模型

## 设计产物

- docs/specs/../../AGENTS.md

## 决策范围

- 安全边界。

## 允许文件

- docs/specs/../../AGENTS.md
`);

        expect(verifyLegacyTaskProvenance(repoRoot)).toContain("design Task 必须有唯一 Proposal/Spec 设计产物：.agents/tasks/00161-profile/README.md");
    });

    it("基线 Design Task 不能通过改 kind 绕过真实 diff", async () => {
        const repoRoot = await createDesignDiffFixture("bug");
        const failures = verifyLegacyTaskProvenance(repoRoot);
        expect(failures).toContain("design Task 基线身份漂移：.agents/tasks/00161-design/README.md");
        expect(failures).toContain("design Task diff 越界：.agents/tasks/00161-design/README.md -> packages/neuro-book/app/api.ts");
    });

    it.each(["completed", "abandoned", "removed-baseline"] as const)("基线 Design Task 不能通过 %s 绕过真实 diff", async (mutation) => {
        const repoRoot = await createDesignDiffFixture(mutation);
        expect(verifyLegacyTaskProvenance(repoRoot)).toContain("design Task diff 越界：.agents/tasks/00161-design/README.md -> packages/neuro-book/app/api.ts");
    });
    it.each([
        "docs/specs/../../AGENTS.md",
        "packages/neuro-book/docs/specs/../../../app/api.md",
        "docs\\specs\\example.md",
        "C:/repo/docs/specs/example.md",
        "/docs/specs/example.md",
        "docs/specs/./example.md",
    ])("design Task 拒绝不安全产物路径 %s", async (output) => {
        const repoRoot = await createTaskWorkflowFixture(designTaskReadme({output, status: "completed"}));

        expect(verifyLegacyTaskProvenance(repoRoot)).toContain("design Task 必须有唯一 Proposal/Spec 设计产物：.agents/tasks/00161-profile/README.md");
    });

    it("design Task 接受开放单行类型和包级设计产物", async () => {
        const repoRoot = await createTaskWorkflowFixture(designTaskReadme({
            designType: "安全模型",
            output: "packages/neuro-book/docs/proposals/safety-model.md",
            status: "completed",
        }));

        expect(verifyLegacyTaskProvenance(repoRoot)).toEqual([]);
    });

    it.each(["", "安全模型\n流程编排", "- 安全模型\n- 流程编排"])("design Task 拒绝空或多行类型", async (designType) => {
        const repoRoot = await createTaskWorkflowFixture(designTaskReadme({designType, status: "completed"}));

        expect(verifyLegacyTaskProvenance(repoRoot)).toContain("design Task 设计类型无效：.agents/tasks/00161-profile/README.md");
    });

    it.each(["missing", "short", "multiple", "unreachable"] as const)("活跃 Design Task 拒绝 %s 基线", async (contextMode) => {
        const {root} = await createDesignGateFixture({contextMode});

        expect(verifyLegacyTaskProvenance(root)).toEqual(expect.arrayContaining([
            expect.stringMatching(/design Task (?:密封合同缺少唯一基线 revision|基线不可达)/u),
        ]));
    });

    it.each(["committed", "staged", "unstaged", "untracked", "delete", "rename"] as const)("Design 真实 diff 拒绝 %s 越界路径", async (changeMode) => {
        const fixture = await createDesignGateFixture();
        const expectedPaths = await applyDesignBoundaryChange(fixture, changeMode);
        const failures = verifyLegacyTaskProvenance(fixture.root);

        for (const path of expectedPaths) expect(failures, changeMode).toContain(`design Task diff 越界：${fixture.readmePath} -> ${path}`);
    });

    it.each(["branch", "worktree", "head-ref"] as const)("Design diff 通过 %s 身份匹配", async (identityMode) => {
        const fixture = await createDesignGateFixture({identityMode});
        await writeText(fixture.root, fixture.boundaryPath, "export const changed = true;\n");
        const previousHeadRef = process.env.GITHUB_HEAD_REF;
        if (identityMode === "head-ref") process.env.GITHUB_HEAD_REF = "feature/design";
        try {
            expect(verifyLegacyTaskProvenance(fixture.root)).toContain(`design Task diff 越界：${fixture.readmePath} -> ${fixture.boundaryPath}`);
        } finally {
            if (previousHeadRef === undefined) delete process.env.GITHUB_HEAD_REF;
            else process.env.GITHUB_HEAD_REF = previousHeadRef;
        }
    });

    it("同一 checkout 命中多个活跃 Design Task 时失败", async () => {
        const {root} = await createDesignGateFixture({secondTask: true});

        expect(verifyLegacyTaskProvenance(root)).toEqual(expect.arrayContaining([
            expect.stringContaining("当前 checkout 命中多个活跃 Design Task"),
        ]));
    });

    it("Design diff 允许产物和直属报告但拒绝 Task 杂散与嵌套报告", async () => {
        const fixture = await createDesignGateFixture();
        await writeText(fixture.root, fixture.outputPath, "# Design output\n");
        await writeText(fixture.root, ".agents/tasks/00161-design/walkthroughs/001.md", "# Walkthrough\n");
        await writeText(fixture.root, ".agents/tasks/00161-design/evidences/proof.txt", "proof\n");
        expect(verifyLegacyTaskProvenance(fixture.root)).toEqual([]);

        await writeText(fixture.root, ".agents/tasks/00161-design/notes.md", "# Notes\n");
        await writeText(fixture.root, ".agents/tasks/00161-design/walkthroughs/nested/002.md", "# Nested\n");
        expect(verifyLegacyTaskProvenance(fixture.root)).toEqual(expect.arrayContaining([
            `design Task diff 越界：${fixture.readmePath} -> .agents/tasks/00161-design/notes.md`,
            `design Task diff 越界：${fixture.readmePath} -> .agents/tasks/00161-design/walkthroughs/nested/002.md`,
        ]));
    });

    it.each(["completed", "abandoned"] as const)("已提交 %s 终止 Design diff 窗口", async (endStatus) => {
        const fixture = await createDesignGateFixture({endStatus});
        await writeText(fixture.root, fixture.boundaryPath, "export const afterEnd = true;\n");

        expect(verifyLegacyTaskProvenance(fixture.root)).not.toContain(`design Task diff 越界：${fixture.readmePath} -> ${fixture.boundaryPath}`);
    });


    it("多个已结束 Design 窗口可独立验证", async () => {
        const fixture = await createDesignGateFixture({secondTask: true, endStatus: "completed", secondEndStatus: "completed"});

        expect(verifyLegacyTaskProvenance(fixture.root)).not.toEqual(expect.arrayContaining([
            expect.stringContaining("当前 checkout 命中多个活跃 Design Task"),
        ]));
    });
    it("Design Task 已提交退出后禁止重开", async () => {
        const fixture = await createDesignGateFixture({endStatus: "completed", reopenStatus: "verifying"});

        expect(verifyLegacyTaskProvenance(fixture.root)).toContain(`design Task 已结束后重新激活：${fixture.readmePath}`);
    });

    it("Design 基线必须是密封合同的严格祖先", async () => {
        const fixture = await createDesignGateFixture({baselineMode: "unrelated"});

        expect(verifyLegacyTaskProvenance(fixture.root)).toEqual(expect.arrayContaining([
            expect.stringContaining("design Task 基线不是密封合同的严格祖先"),
        ]));
    });

    it("应用 Task root 的新 Task 不能绕过 schema 与 Issue 聚合门禁", async () => {
        const taskId = "149-profile";
        const repoRoot = await createApplicationTaskWorkflowFixture(`---
schema: wrong.task/v1
taskId: ${taskId}
---

# Wrong app Task
`, taskId);
        const relativePath = `packages/neuro-book/.agents/tasks/${taskId}/README.md`;

        expect(verifyLegacyTaskProvenance(repoRoot)).toContain(`新 Task 缺少有效 nbook.task/v1 frontmatter：${relativePath}`);
        await writeText(repoRoot, relativePath, currentTaskReadme({taskId, actionIssueId: "0", extraFrontmatter: "actionIssueIds:\n  - 191"}));
        expect(verifyLegacyTaskProvenance(repoRoot)).toEqual(expect.arrayContaining([
            expect.stringContaining("Task actionIssueId 必须是正整数或 null"),
            expect.stringContaining("Task 禁止聚合字段 actionIssueIds"),
        ]));
        await rm(join(repoRoot, relativePath));
        expect(verifyLegacyTaskProvenance(repoRoot)).toContain(`新 Task 缺少 README.md：${relativePath}`);
    });

    it("应用低号 Task 必须命中不可变基线、mapping 和 ownership", async () => {
        const valid = await createHistoricalApplicationTaskFixture("148-legacy", "valid", "---\nschema: wrong.task/v1\ntaskId: 148-legacy\n---\n\n# Historical app Task\n");
        const validPath = "packages/neuro-book/.agents/tasks/148-legacy/README.md";
        expect(verifyLegacyTaskProvenance(valid)).not.toContain("应用 Task 标识无效：148-legacy");
        expect(verifyLegacyTaskProvenance(valid)).not.toContain(`新 Task 缺少有效 nbook.task/v1 frontmatter：${validPath}`);

        for (const mode of ["missing-baseline", "missing-mapping"] as const) {
            const invalid = await createHistoricalApplicationTaskFixture("148-legacy", mode, "# Invalid historical app Task\n");
            expect(verifyLegacyTaskProvenance(invalid), mode).toContain("应用 Task 标识无效：148-legacy");
        }
        const mismatchedOwnership = await createHistoricalApplicationTaskFixture("148-legacy", "mismatched-ownership", "# Invalid historical app Task\n");
        expect(verifyLegacyTaskProvenance(mismatchedOwnership)).toContain("ownership legacyDestination 不匹配：148-legacy/README.md");

        for (const taskId of ["149-current", "999-current"] as const) {
            const repoRoot = await createApplicationTaskWorkflowFixture(`---
schema: wrong.task/v1
taskId: ${taskId}
---

# Current app Task
`, taskId);
            const relativePath = `packages/neuro-book/.agents/tasks/${taskId}/README.md`;
            expect(verifyLegacyTaskProvenance(repoRoot), taskId).toContain(`新 Task 缺少有效 nbook.task/v1 frontmatter：${relativePath}`);
        }
    }, 30_000);

    it("应用历史 Task 不补当前字段但仍守 v1 基础不变量", async () => {
        const taskId = "148-legacy";
        const repoRoot = await createHistoricalApplicationTaskFixture(taskId, "valid", `---
schema: nbook.task/v1
taskId: ${taskId}
status: unknown
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: docs
  routes:
    - documentation-and-adrs
  verification:
    required:
      - docs-check
    notRun: []
---

# Historical v1 Task
`);
        const failures = verifyLegacyTaskProvenance(repoRoot);
        expect(failures).toContain(`Task status 无效：packages/neuro-book/.agents/tasks/${taskId}/README.md`);
        expect(failures).not.toContain(`应用 Task 标识无效：${taskId}`);
        expect(failures).not.toEqual(expect.arrayContaining([
            expect.stringContaining("Task actionIssueId 必须是正整数或 null"),
            expect.stringContaining("Task worktreeId 必须是非空字符串或 null"),
            expect.stringContaining("Task branchId 必须是非空字符串或 null"),
        ]));
    });

    it("应用 Task ownership 拒绝零值、一位和六位数字 ID", async () => {
        for (const taskId of ["00-invalid", "000-invalid", "00000-invalid", "9-invalid", "100000-invalid"] as const) {
            const repoRoot = await createApplicationTaskWorkflowFixture("# Invalid app Task\n", taskId);
            expect(verifyLegacyTaskProvenance(repoRoot), taskId).toContain(`ownership Task 标识无效：${taskId}`);
        }
    });
    it("agentWorkflow 枚举拒绝原型链属性", async () => {
        const repoRoot = await createTaskWorkflowFixture(currentTaskReadme({
            kind: "toString",
            required: ["toString"],
        }));
        const failures = verifyLegacyTaskProvenance(repoRoot);
        expect(failures).toEqual(expect.arrayContaining([
            expect.stringContaining("Task agentWorkflow.kind 无效"),
            expect.stringContaining("Task verification.required[0] 无效"),
        ]));
    });

    it("agentWorkflow 必须显式提供 notRun", async () => {
        const repoRoot = await createTaskWorkflowFixture(currentTaskReadme({includeNotRun: false}));

        expect(verifyLegacyTaskProvenance(repoRoot)).toEqual(expect.arrayContaining([expect.stringContaining("Task verification.notRun 必须显式提供")]));
    });


    it("非法 kind、空 routes、重复 required、缺少 notRun reason 和重叠检查均失败", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 00161-profile
issueRequired: false
actionIssueId: null
worktreeId: null
branchId: master
status: planned
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: unknown
  routes: []
  verification:
    required:
      - focused-test
      - focused-test
    notRun:
      - check: browser
      - check: focused-test
        reason: 未运行
---

# Invalid Profile Task
`);

        const failures = verifyLegacyTaskProvenance(repoRoot);
        expect(failures).toEqual(expect.arrayContaining([
            expect.stringContaining("Task agentWorkflow.kind 无效"),
            expect.stringContaining("Task agentWorkflow.routes 必须是非空数组"),
            expect.stringContaining("Task verification.required 含重复项"),
            expect.stringContaining("Task verification.notRun[0] 缺少非空 reason"),
            expect.stringContaining("Task verification.required 与 verification.notRun 重叠"),
        ]));
    });
});

describe("workspace 包级治理门禁", () => {
    it("允许带根继承链接的可选包治理资产", async () => {
        const repoRoot = await createPackageFixture({runtime: null, autonomous: false});

        expect(verifyWorkspacePackageGovernance(repoRoot)).toEqual([]);
    });

    it("自治包缺少 docs、Task 或状态资产时失败", async () => {
        const repoRoot = await createPackageFixture({runtime: null, autonomous: true});

        expect(verifyWorkspacePackageGovernance(repoRoot)).toEqual([
            "包级治理资产缺少 AGENTS.md：packages/nb-history/AGENTS.md",
            "自治workspace包缺少归属资产：packages/nb-history/.agents/tasks",
            "自治workspace包缺少归属资产：packages/nb-history/docs",
            "自治workspace包缺少归属资产：packages/nb-history/PROJECT-STATUS.md",
        ]);
    });

    it("允许被忽略且未跟踪的包级 .local，拒绝被跟踪的运行态", async () => {
        const ignoredRoot = await createPackageFixture({runtime: ".local", autonomous: false});
        expect(verifyWorkspacePackageGovernance(ignoredRoot)).toEqual([]);

        const trackedRoot = await createPackageFixture({runtime: ".agent", autonomous: false, trackRuntime: true});
        expect(verifyWorkspacePackageGovernance(trackedRoot)).toContain("包级运行态被 Git 跟踪：packages/sample/.agent");
    });
});

describe("最终 monorepo 收敛门禁", () => {
    it("当前迁移结果的旧根入口、应用脚本边界与 sibling 对账均闭合", () => {
        expect(verifyMonorepoCutover(repositoryRoot)).toEqual([]);
        expect(verifyApplicationScriptBoundary(repositoryRoot)).toEqual([]);
        expect(verifySiblingResyncResolution(repositoryRoot)).toEqual([]);
    });

    it("拒绝旧根应用源码和根应用命令重新出现", async () => {
        const repoRoot = await createTestTmpRoot("governance-cutover", "governance-cutover-test");
        fixtureRoots.push(repoRoot);
        await writeText(repoRoot, "package.json", JSON.stringify({name: "fixture", version: "1.0.0", scripts: {dev: "nuxt dev"}}));
        await writeText(repoRoot, "server/index.ts", "export {};\n");
        await runGit(repoRoot, ["init", "--initial-branch", "master"]);
        await runGit(repoRoot, ["add", "."]);

        expect(verifyMonorepoCutover(repoRoot)).toEqual(expect.arrayContaining([
            "旧根应用路径重新出现：server/index.ts",
            "根 workspace orchestrator 不得声明产品 version",
            "根 workspace 保留应用或同步命令：dev",
        ]));
    });

    it("只允许 source-dev 读取根 workspace locator", async () => {
        const repoRoot = await createTestTmpRoot("governance-app-scripts", "governance-app-scripts-test");
        fixtureRoots.push(repoRoot);
        await writeText(repoRoot, "packages/neuro-book/scripts/cli/source-dev.ts", [
            'import {resolveWorkspaceRoots} from "#scripts/utils/workspace-roots";',
            'import type {WorkspaceRoots} from "#scripts/utils/workspace-roots";',
            "export {resolveWorkspaceRoots};",
        ].join("\n"));
        expect(verifyApplicationScriptBoundary(repoRoot)).toEqual([]);

        await writeText(repoRoot, "packages/neuro-book/scripts/smoke/agent.ts", 'import "#scripts/utils/workspace-roots";\n');
        await writeText(repoRoot, "packages/neuro-book/scripts/cli/source-dev.ts", 'import "#scripts/utils/process.mjs";\n');
        expect(verifyApplicationScriptBoundary(repoRoot)).toEqual([
            "应用跨根 #scripts 导入违规：packages/neuro-book/scripts/cli/source-dev.ts -> #scripts/utils/process.mjs",
            "应用跨根 #scripts 导入违规：packages/neuro-book/scripts/smoke/agent.ts -> #scripts/utils/workspace-roots",
        ]);
    });

    it("拒绝 sibling 对账输入 hash 被改写", async () => {
        const repoRoot = await createTestTmpRoot("governance-resync", "governance-resync-test");
        fixtureRoots.push(repoRoot);
        const relativePath = ".agents/tasks/00149-monorepo-workspace-consolidation/evidences/s8-sibling-resync-resolution.json";
        const report = JSON.parse(await readFile(join(repositoryRoot, relativePath), "utf8")) as {inputs: Record<string, string>};
        report.inputs["sibling-import-manifest.json"] = "sha256:invalid";
        await writeText(repoRoot, relativePath, `${JSON.stringify(report)}\n`);

        expect(verifySiblingResyncResolution(repoRoot)).toContain("sibling resync 输入 hash 不匹配：sibling-import-manifest.json");
    });

    it("拒绝 sibling 单包计数被重写", async () => {
        const repoRoot = await createTestTmpRoot("governance-resync-count", "governance-resync-count-test");
        fixtureRoots.push(repoRoot);
        const relativePath = ".agents/tasks/00149-monorepo-workspace-consolidation/evidences/s8-sibling-resync-resolution.json";
        const report = JSON.parse(await readFile(join(repositoryRoot, relativePath), "utf8")) as {
            projects: Record<string, {allowlist: number; exact: number}>;
            totals: {allowlist: number; exact: number};
        };
        report.projects["nb-history"].allowlist -= 1;
        report.projects["nb-history"].exact -= 1;
        report.totals.allowlist -= 1;
        report.totals.exact -= 1;
        await writeText(repoRoot, relativePath, `${JSON.stringify(report)}\n`);

        expect(verifySiblingResyncResolution(repoRoot)).toContain("sibling resync 项目计数不匹配：nb-history");
    });

    it("拒绝仅保留输入 hash 的空 sibling 对账报告", async () => {
        const repoRoot = await createTestTmpRoot("governance-resync-empty", "governance-resync-empty-test");
        fixtureRoots.push(repoRoot);
        const relativePath = ".agents/tasks/00149-monorepo-workspace-consolidation/evidences/s8-sibling-resync-resolution.json";
        const report = JSON.parse(await readFile(join(repositoryRoot, relativePath), "utf8")) as {
            projects: Record<string, unknown>;
            totals: Record<string, number>;
        };
        report.projects = {};
        report.totals = {
            allowlist: 0,
            exact: 0,
            classifiedAllowlistDifferences: 0,
            unclassifiedAllowlistDifferences: 0,
            missing: 0,
            deletionCandidates: 0,
            copyActions: 0,
        };
        await writeText(repoRoot, relativePath, `${JSON.stringify(report)}\n`);

        const failures = verifySiblingResyncResolution(repoRoot);
        expect(failures).toContain("sibling resync 项目集合不匹配：");
        expect(failures).toContain("sibling resync 固定总数不匹配：allowlist");
    });
});

describe("monorepo worktree 根门禁", () => {
    it("解析 linked worktree 的主 checkout，并拒绝 canonical 根外 worktree", async () => {
        const {primary, linked, outside} = await createWorktreeFixture();
        try {
            expect(primaryCheckoutRoot(linked)).toBe(await realpath(primary));
            expect(verifyMonorepoWorktreeLayout(linked).some((failure) => failure.includes("monorepo worktree 位置违规"))).toBe(true);
        } finally {
            await runGit(primary, ["worktree", "remove", "--force", linked]);
            await runGit(primary, ["worktree", "remove", "--force", outside]);
        }
    });
});

type TaskFixtureOptions = {
    appendSections?: boolean;
    preserveIssueRequired?: boolean;
};

const TASK_COLLABORATION_SECTIONS = ["目标", "Agent 工作", "开发者参与", "任务产物", "修改计划", "完成门禁", "Leader 继续条件", "允许文件"] as const;

function taskCollaborationSections(taskId: string): string {
    return `## 目标

完成当前测试合同。

## Agent 工作

- Agent 执行并验证合同。

## 开发者参与

无，Agent 在现有合同内完成。

## 任务产物

- Agent：当前 Task 结果，供 Leader 验收。

## 修改计划

1. 修改 fixture。
2. 运行聚焦检查。

## 完成门禁

- required 检查通过。

## Leader 继续条件

Leader 读取结果后决定下一步；派发后停止。

## 允许文件

- .agents/tasks/${taskId}/**
`;
}

function normalizeCurrentTaskReadme(readme: string, taskId: string, options: TaskFixtureOptions): string {
    let normalized = options.preserveIssueRequired ? readme : readme.replace(/^issueRequired:.*\r?\n/mu, "");
    if (options.appendSections === false || !/^schema:\s*nbook\.task\/v1\s*$/mu.test(normalized)) return normalized;
    const status = /^status:\s*(\S+)\s*$/mu.exec(normalized)?.[1];
    if (!status || !["planned", "in-progress", "blocked", "verifying"].includes(status)) return normalized;
    const missing = TASK_COLLABORATION_SECTIONS.filter((section) => !new RegExp(`^## ${section}$`, "mu").test(normalized));
    if (missing.length === 0) return normalized;
    const template = taskCollaborationSections(taskId);
    const additions = missing.map((section) => {
        const match = new RegExp(`^## ${section}\\r?\\n([\\s\\S]*?)(?=^## |\\s*$)`, "mu").exec(template);
        return match?.[0].trim() ?? "";
    }).filter(Boolean);
    return `${normalized.trimEnd()}\n\n${additions.join("\n\n")}\n`;
}

function currentTaskReadme(options: {
    taskId?: string;
    actionIssueId?: string;
    status?: string;
    kind?: string;
    required?: string[];
    includeNotRun?: boolean;
    extraFrontmatter?: string;
    extraSections?: string;
} = {}): string {
    const taskId = options.taskId ?? "00161-profile";
    const actionIssueId = options.actionIssueId === "missing" ? "" : `actionIssueId: ${options.actionIssueId ?? "null"}\n`;
    const required = options.required ?? ["docs-check"];
    const notRun = options.includeNotRun === false ? "" : "    notRun: []\n";
    const extraFrontmatter = options.extraFrontmatter ? `${options.extraFrontmatter}\n` : "";
    return `---
schema: nbook.task/v1
taskId: ${taskId}
${actionIssueId}${extraFrontmatter}worktreeId: null
branchId: master
status: ${options.status ?? "planned"}
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: ${options.kind ?? "docs"}
  routes:
    - documentation-and-adrs
  verification:
    required:
${required.map((check) => `      - ${check}`).join("\n")}
${notRun}---

# Current Task

${options.extraSections ?? ""}${taskCollaborationSections(taskId)}`;
}

function removeMarkdownSection(readme: string, section: string): string {
    return readme.replace(new RegExp(`^## ${section}\\r?\\n[\\s\\S]*?(?=^## |\\s*$)`, "mu"), "");
}

async function createTaskWorkflowFixture(readme: string, taskId = "00161-profile", options: TaskFixtureOptions = {}): Promise<string> {
    const root = await createTestTmpRoot("governance-task-workflow", "governance-task-workflow-test");
    fixtureRoots.push(root);
    await writeText(root, ".agents/tasks/ownership.json", JSON.stringify({
        schema: "nbook.task-ownership/v1",
        ownerRoot: "packages/neuro-book/.agents/tasks",
        taskCount: 0,
        fileCount: 0,
        tasks: [],
    }));
    await writeText(root, `.agents/tasks/${taskId}/README.md`, normalizeCurrentTaskReadme(readme, taskId, options));
    await writeText(root, `.agents/tasks/${taskId}/context.md`, "# Task Context\n");
    return root;
}

async function createHistoricalTaskWorkflowFixture(taskId: string, mode: "valid" | "missing-baseline" | "missing-mapping" | "mismatched-marker"): Promise<string> {
    const root = await createTestTmpRoot("governance-historical-task", "governance-historical-task-test");
    fixtureRoots.push(root);
    await writeText(root, ".agents/tasks/ownership.json", JSON.stringify({
        schema: "nbook.task-ownership/v1",
        ownerRoot: "packages/neuro-book/.agents/tasks",
        taskCount: 0,
        fileCount: 0,
        tasks: [],
    }));
    if (mode !== "missing-baseline") await writeText(root, `docs/tasks/${taskId}/README.md`, "# Historical source\n");
    await runGit(root, ["init", "--initial-branch", "master"]);
    await runGit(root, ["config", "user.email", "governance-test@example.invalid"]);
    await runGit(root, ["config", "user.name", "Governance Test"]);
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "historical source baseline"]);
    const sourceRevision = (await runGit(root, ["rev-parse", "HEAD"])).trim();
    const mappings = mode === "missing-mapping" ? [] : [{
        source: `docs/tasks/${taskId}/README.md`,
        destination: `.agents/tasks/${taskId}/README.md`,
        sourceSha256: `sha256:${"0".repeat(64)}`,
        destinationSha256: `sha256:${"0".repeat(64)}`,
        kind: "file" as const,
        linkRewrite: false,
    }];
    const manifest = {schema: "nbook.task-migration-manifest/v1", sourceRevision, mappings, repositoryLinkRewrites: [], preservedSourceFiles: []};
    const manifestSha256 = hashBytes(Buffer.from(JSON.stringify(manifest), "utf8"));
    await writeText(root, ".agents/tasks/legacy-index.json", JSON.stringify({schema: "nbook.task-migration-index/v1", sourceRevision, fileCount: mappings.length, manifestSha256, migratedAt: "2026-08-26T00:00:00Z", mappings, repositoryLinkRewrites: [], preservedSourceFiles: [], trackedFileCount: 0, localOnlyFiles: []}));
    await writeText(root, ".agents/tasks/.migration-complete", JSON.stringify({schema: "nbook.task-migration/v1", sourceRevision, fileCount: mappings.length, manifestSha256: mode === "mismatched-marker" ? `sha256:${"f".repeat(64)}` : manifestSha256, completedAt: "2026-08-26T00:00:00Z", repositoryLinkRewrites: [], preservedSourceFiles: [], trackedFileCount: 0, localOnlyFiles: []}));
    await runGit(root, ["add", ".agents/tasks/legacy-index.json", ".agents/tasks/.migration-complete"]);
    await runGit(root, ["commit", "-m", "seal historical migration identity"]);
    await writeText(root, `.agents/tasks/${taskId}/README.md`, `---
schema: nbook.task/v1
taskId: ${taskId}
status: completed
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: docs
  routes:
    - documentation-and-adrs
  verification:
    required:
      - docs-check
    notRun: []
---

# Historical Task
`);
    await writeText(root, `.agents/tasks/${taskId}/context.md`, "# Historical Context\n");
    return root;
}

type HistoricalMappingFixture = {
    source: string;
    destination: string;
    sourceSha256: string;
    destinationSha256: string;
    kind: "file";
    linkRewrite: false;
};

function historicalMapping(taskId: string): HistoricalMappingFixture {
    return {
        source: `docs/tasks/${taskId}/README.md`,
        destination: `.agents/tasks/${taskId}/README.md`,
        sourceSha256: `sha256:${"0".repeat(64)}`,
        destinationSha256: `sha256:${"0".repeat(64)}`,
        kind: "file",
        linkRewrite: false,
    };
}

async function writeHistoricalMigrationMetadata(root: string, sourceRevision: string, mappings: HistoricalMappingFixture[]): Promise<void> {
    const manifest = {schema: "nbook.task-migration-manifest/v1", sourceRevision, mappings, repositoryLinkRewrites: [], preservedSourceFiles: []};
    const manifestSha256 = hashBytes(Buffer.from(JSON.stringify(manifest), "utf8"));
    await writeText(root, ".agents/tasks/legacy-index.json", JSON.stringify({schema: "nbook.task-migration-index/v1", sourceRevision, fileCount: mappings.length, manifestSha256, migratedAt: "2026-08-26T00:00:00Z", mappings, repositoryLinkRewrites: [], preservedSourceFiles: [], trackedFileCount: mappings.length, localOnlyFiles: []}));
    await writeText(root, ".agents/tasks/.migration-complete", JSON.stringify({schema: "nbook.task-migration/v1", sourceRevision, fileCount: mappings.length, manifestSha256, completedAt: "2026-08-26T00:00:00Z", repositoryLinkRewrites: [], preservedSourceFiles: [], trackedFileCount: mappings.length, localOnlyFiles: []}));
}

async function createInvalidSealedJsonShapeFixture(): Promise<string> {
    const root = await createTestTmpRoot("governance-invalid-sealed-json", "governance-invalid-sealed-json-test");
    fixtureRoots.push(root);
    await writeText(root, ".agents/tasks/ownership.json", JSON.stringify({schema: "nbook.task-ownership/v1", ownerRoot: "packages/neuro-book/.agents/tasks", taskCount: 0, fileCount: 0, tasks: []}));
    await writeText(root, "docs/tasks/99-invalid/README.md", "# Historical source\n");
    await runGit(root, ["init", "--initial-branch", "master"]);
    await runGit(root, ["config", "user.email", "governance-test@example.invalid"]);
    await runGit(root, ["config", "user.name", "Governance Test"]);
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "historical source"]);
    const sourceRevision = (await runGit(root, ["rev-parse", "HEAD"])).trim();
    await writeText(root, ".agents/tasks/legacy-index.json", "null\n");
    await writeText(root, ".agents/tasks/.migration-complete", JSON.stringify({schema: "nbook.task-migration/v1", sourceRevision, fileCount: 0, manifestSha256: `sha256:${"0".repeat(64)}`, completedAt: "2026-08-26T00:00:00Z", repositoryLinkRewrites: [], preservedSourceFiles: [], trackedFileCount: 0, localOnlyFiles: []}));
    await runGit(root, ["add", ".agents/tasks/legacy-index.json", ".agents/tasks/.migration-complete"]);
    await runGit(root, ["commit", "-m", "seal invalid migration metadata"]);
    await writeText(root, ".agents/tasks/99-invalid/README.md", "# Invalid historical Task\n");
    await writeText(root, ".agents/tasks/99-invalid/context.md", "# Context\n");
    return root;
}

async function createMalformedSealedMappingFixture(): Promise<string> {
    const root = await createTestTmpRoot("governance-malformed-sealed-mapping", "governance-malformed-sealed-mapping-test");
    fixtureRoots.push(root);
    await writeText(root, ".agents/tasks/ownership.json", JSON.stringify({schema: "nbook.task-ownership/v1", ownerRoot: "packages/neuro-book/.agents/tasks", taskCount: 0, fileCount: 0, tasks: []}));
    await writeText(root, "docs/tasks/99-malformed/README.md", "# Historical source\n");
    await runGit(root, ["init", "--initial-branch", "master"]);
    await runGit(root, ["config", "user.email", "governance-test@example.invalid"]);
    await runGit(root, ["config", "user.name", "Governance Test"]);
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "historical source"]);
    const sourceRevision = (await runGit(root, ["rev-parse", "HEAD"])).trim();
    const mappings = [null];
    const manifest = {schema: "nbook.task-migration-manifest/v1", sourceRevision, mappings, repositoryLinkRewrites: [], preservedSourceFiles: []};
    const manifestSha256 = hashBytes(Buffer.from(JSON.stringify(manifest), "utf8"));
    await writeText(root, ".agents/tasks/legacy-index.json", JSON.stringify({schema: "nbook.task-migration-index/v1", sourceRevision, fileCount: 1, manifestSha256, migratedAt: "2026-08-26T00:00:00Z", mappings, repositoryLinkRewrites: [], preservedSourceFiles: [], trackedFileCount: 1, localOnlyFiles: []}));
    await writeText(root, ".agents/tasks/.migration-complete", JSON.stringify({schema: "nbook.task-migration/v1", sourceRevision, fileCount: 1, manifestSha256, completedAt: "2026-08-26T00:00:00Z", repositoryLinkRewrites: [], preservedSourceFiles: [], trackedFileCount: 1, localOnlyFiles: []}));
    await runGit(root, ["add", ".agents/tasks/legacy-index.json", ".agents/tasks/.migration-complete"]);
    await runGit(root, ["commit", "-m", "seal malformed migration"]);
    await writeText(root, ".agents/tasks/99-malformed/README.md", "# Malformed historical Task\n");
    await writeText(root, ".agents/tasks/99-malformed/context.md", "# Context\n");
    return root;
}

async function createPackageResearchDiffFixture(): Promise<{
    root: string;
    packageRoot: string;
    readmePath: string;
    contextPath: string;
    outputPath: string;
    untrackedOutputPath: string;
    trackedBoundaryPath: string;
    readme: string;
}> {
    const root = await createTestTmpRoot("governance-research-diff", "governance-research-diff-test");
    fixtureRoots.push(root);
    const packageRoot = "packages/neuro-agent-harness";
    const taskRoot = `${packageRoot}/.agents/tasks/02-research`;
    const readmePath = `${taskRoot}/README.md`;
    const contextPath = `${taskRoot}/context.md`;
    const outputPath = `${taskRoot}/evidences/result.md`;
    const untrackedOutputPath = `${taskRoot}/evidences/additional.md`;
    const trackedBoundaryPath = `${packageRoot}/src/tracked.ts`;
    const readme = currentTaskReadme({
        taskId: "02-research",
        kind: "research",
        extraSections: `## 研究问题

- 宿主需要什么？

## 研究产物

- ${outputPath}
- ${untrackedOutputPath}

## 决策范围

- 首版宿主。
`,
    }).replace("branchId: master", "branchId: null").replace(`## 允许文件

- .agents/tasks/02-research/**`, `## 允许文件

- ${outputPath}
- ${untrackedOutputPath}`);
    await writeText(root, ".agents/tasks/ownership.json", JSON.stringify({
        schema: "nbook.task-ownership/v1",
        ownerRoot: "packages/neuro-book/.agents/tasks",
        taskCount: 0,
        fileCount: 0,
        tasks: [],
    }));
    await writeText(root, readmePath, readme);
    await writeText(root, contextPath, "# Research context\n");
    await writeText(root, outputPath, "# Initial research result\n");
    await writeText(root, trackedBoundaryPath, "export const baseline = true;\n");
    await runGit(root, ["init", "--initial-branch", "master"]);
    await runGit(root, ["config", "user.email", "governance-test@example.invalid"]);
    await runGit(root, ["config", "user.name", "Governance Test"]);
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "research task baseline"]);
    return {root, packageRoot, readmePath, contextPath, outputPath, untrackedOutputPath, trackedBoundaryPath, readme};
}
async function createForgedHistoricalIdentityFixture(taskId: string): Promise<string> {
    const root = await createTestTmpRoot("governance-forged-historical-task", "governance-forged-historical-task-test");
    fixtureRoots.push(root);
    await writeText(root, ".agents/tasks/ownership.json", JSON.stringify({schema: "nbook.task-ownership/v1", ownerRoot: "packages/neuro-book/.agents/tasks", taskCount: 0, fileCount: 0, tasks: []}));
    await writeText(root, "docs/tasks/98-sealed/README.md", "# Sealed historical source\n");
    await runGit(root, ["init", "--initial-branch", "master"]);

    await runGit(root, ["config", "user.email", "governance-test@example.invalid"]);
    await runGit(root, ["config", "user.name", "Governance Test"]);
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "sealed migration source"]);
    const sealedSourceRevision = (await runGit(root, ["rev-parse", "HEAD"])).trim();
    const sealedMappings = [historicalMapping("98-sealed")];
    await writeHistoricalMigrationMetadata(root, sealedSourceRevision, sealedMappings);
    await runGit(root, ["add", ".agents/tasks/legacy-index.json", ".agents/tasks/.migration-complete"]);
    await runGit(root, ["commit", "-m", "seal migration identity"]);

    await writeText(root, `docs/tasks/${taskId}/README.md`, "# Forged historical source\n");
    await runGit(root, ["add", `docs/tasks/${taskId}/README.md`]);
    await runGit(root, ["commit", "-m", "add forged reachable source"]);
    const forgedSourceRevision = (await runGit(root, ["rev-parse", "HEAD"])).trim();
    await writeHistoricalMigrationMetadata(root, forgedSourceRevision, [...sealedMappings, historicalMapping(taskId)]);
    await writeText(root, `.agents/tasks/${taskId}/README.md`, `---\nschema: nbook.task/v1\ntaskId: ${taskId}\nstatus: completed\ncreatedAt: 2026-08-26T00:00:00Z\nupdatedAt: 2026-08-26T00:00:00Z\nagentWorkflow:\n  profile: nbook.agent-skills/v1\n  kind: docs\n  routes:\n    - documentation-and-adrs\n  verification:\n    required:\n      - docs-check\n    notRun: []\n---\n\n# Forged Task\n`);
    await writeText(root, `.agents/tasks/${taskId}/context.md`, "# Forged context\n");
    return root;
}

async function createDesignDiffFixture(mutation: "bug" | "completed" | "abandoned" | "removed-baseline"): Promise<string> {
    const root = await createTestTmpRoot("governance-design-diff", "governance-design-diff-test");
    fixtureRoots.push(root);
    await writeText(root, ".agents/tasks/ownership.json", JSON.stringify({
        schema: "nbook.task-ownership/v1",
        ownerRoot: "packages/neuro-book/.agents/tasks",
        taskCount: 0,
        fileCount: 0,
        tasks: [],
    }));
    await writeText(root, "README.md", "# Design fixture\n");
    await runGit(root, ["init", "--initial-branch", "master"]);
    await runGit(root, ["config", "user.email", "governance-test@example.invalid"]);
    await runGit(root, ["config", "user.name", "Governance Test"]);
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "repository baseline"]);
    const baseline = (await runGit(root, ["rev-parse", "HEAD"])).trim();
    const baselineReadme = `---
schema: nbook.task/v1
taskId: 00161-design
actionIssueId: null
worktreeId: null
branchId: master
status: planned
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: design
  routes:
    - documentation-and-adrs
  verification:
    required:
      - docs-check
    notRun: []
---

# Workflow Design Task

## 设计类型

流程编排

## 设计产物

- docs/specs/example/design.md

## 决策范围

- 流程边界。

## 允许文件

- docs/specs/example/design.md

${taskCollaborationSections("00161-design")}
`;
    await writeText(root, ".agents/tasks/00161-design/README.md", baselineReadme);
    await writeText(root, ".agents/tasks/00161-design/context.md", `# Design Context\n\n- 基线 revision：\`${baseline}\`\n`);
    await runGit(root, ["add", ".agents/tasks/00161-design"]);
    await runGit(root, ["commit", "-m", "design task contract"]);
    const mutatedReadme = mutation === "bug"
        ? baselineReadme.replace("kind: design", "kind: bug")
        : baselineReadme.replace("status: planned", `status: ${mutation}`);
    if (mutation !== "removed-baseline") await writeText(root, ".agents/tasks/00161-design/README.md", mutatedReadme);
    else await writeText(root, ".agents/tasks/00161-design/context.md", "# Design Context\n");
    await writeText(root, "packages/neuro-book/app/api.ts", "export const leaked = true;\n");
    return root;
}

function designTaskReadme(options: {
    taskId?: string;
    designType?: string;
    output?: string;
    status?: "planned" | "in-progress" | "blocked" | "verifying" | "completed" | "abandoned";
    worktreeId?: string | null;
    branchId?: string | null;
} = {}): string {
    const taskId = options.taskId ?? "00161-profile";
    const designType = options.designType ?? "流程编排";
    const output = options.output ?? "docs/specs/example/design.md";
    const status = options.status ?? "planned";
    const worktreeId = options.worktreeId === undefined ? "null" : options.worktreeId === null ? "null" : JSON.stringify(options.worktreeId);
    const branchId = options.branchId === undefined ? "master" : options.branchId === null ? "null" : JSON.stringify(options.branchId);
    return `---
schema: nbook.task/v1
taskId: ${taskId}
actionIssueId: null
worktreeId: ${worktreeId}
branchId: ${branchId}
status: ${status}
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: design
  routes:
    - documentation-and-adrs
  verification:
    required:
      - docs-check
    notRun: []
---

# Workflow Design Task

## 设计类型

${designType}

## 设计产物

- ${output}

## 决策范围

- 流程边界。

## 允许文件

- ${output}

${taskCollaborationSections(taskId)}
`;
}

type DesignGateFixture = {
    root: string;
    readmePath: string;
    outputPath: string;
    boundaryPath: string;
};

async function createDesignGateFixture(options: {
    contextMode?: "valid" | "missing" | "short" | "multiple" | "unreachable";
    identityMode?: "branch" | "worktree" | "head-ref";
    baselineMode?: "ancestor" | "unrelated";
    secondTask?: boolean;
    endStatus?: "completed" | "abandoned";
    secondEndStatus?: "completed" | "abandoned";
    reopenStatus?: "planned" | "in-progress" | "blocked" | "verifying";
} = {}): Promise<DesignGateFixture> {
    const root = await createTestTmpRoot("governance-design-gate", "governance-design-gate-test");
    fixtureRoots.push(root);
    const readmePath = ".agents/tasks/00161-design/README.md";
    const outputPath = "docs/specs/example/design.md";
    const boundaryPath = "packages/neuro-book/app/api.ts";
    await writeText(root, ".agents/tasks/ownership.json", JSON.stringify({
        schema: "nbook.task-ownership/v1",
        ownerRoot: "packages/neuro-book/.agents/tasks",
        taskCount: 0,
        fileCount: 0,
        tasks: [],
    }));
    await writeText(root, "README.md", "# Design gate fixture\n");
    await writeText(root, boundaryPath, "export const baseline = true;\n");
    await runGit(root, ["init", "--initial-branch", "master"]);
    await runGit(root, ["config", "user.email", "governance-test@example.invalid"]);
    await runGit(root, ["config", "user.name", "Governance Test"]);
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "repository baseline"]);
    const baseline = (await runGit(root, ["rev-parse", "HEAD"])).trim();
    const unrelatedBaseline = options.baselineMode === "unrelated"
        ? (await runGit(root, ["commit-tree", `${baseline}^{tree}`, "-m", "unrelated baseline"])).trim()
        : null;
    const identityMode = options.identityMode ?? "branch";
    const worktreeId = identityMode === "worktree" ? "." : null;
    const branchId = identityMode === "head-ref" ? "feature/design" : identityMode === "branch" ? "master" : null;
    const contextMode = options.contextMode ?? "valid";
    const baselineLines = contextMode === "missing"
        ? ""
        : contextMode === "short"
            ? "- 基线 revision：`abc1234`\n"
            : contextMode === "multiple"
                ? `- 基线 revision：\`${baseline}\`\n- baseline revision: \`${baseline}\`\n`
                : contextMode === "unreachable"
                    ? `- 基线 revision：\`${"f".repeat(40)}\`\n`
                    : `- 基线 revision：\`${unrelatedBaseline ?? baseline}\`\n`;
    await writeText(root, readmePath, designTaskReadme({taskId: "00161-design", output: outputPath, worktreeId, branchId}));
    await writeText(root, ".agents/tasks/00161-design/context.md", `# Design Context\n\n${baselineLines}`);
    if (options.secondTask) {
        await writeText(root, ".agents/tasks/00162-design/README.md", designTaskReadme({taskId: "00162-design", output: "docs/specs/example/second.md", worktreeId, branchId}));
        await writeText(root, ".agents/tasks/00162-design/context.md", `# Design Context\n\n- 基线 revision：\`${baseline}\`\n`);
    }
    await runGit(root, ["add", ".agents/tasks"]);
    await runGit(root, ["commit", "-m", "seal design task contract"]);
    if (options.endStatus) {
        const ended = designTaskReadme({taskId: "00161-design", output: outputPath, status: options.endStatus, worktreeId, branchId});
        await writeText(root, readmePath, ended);
        await runGit(root, ["add", readmePath]);
        await runGit(root, ["commit", "-m", `end design task as ${options.endStatus}`]);
    }
    if (options.reopenStatus) {
        const reopened = designTaskReadme({taskId: "00161-design", output: outputPath, status: options.reopenStatus, worktreeId, branchId});
        await writeText(root, readmePath, reopened);
        await runGit(root, ["add", readmePath]);
        await runGit(root, ["commit", "-m", `reopen design task as ${options.reopenStatus}`]);
    }
    if (options.secondEndStatus) {
        const ended = designTaskReadme({taskId: "00162-design", output: "docs/specs/example/second.md", status: options.secondEndStatus, worktreeId, branchId});
        await writeText(root, ".agents/tasks/00162-design/README.md", ended);
        await runGit(root, ["add", ".agents/tasks/00162-design/README.md"]);
        await runGit(root, ["commit", "-m", `end second design task as ${options.secondEndStatus}`]);
    }
    return {root, readmePath, outputPath, boundaryPath};
}

async function applyDesignBoundaryChange(fixture: DesignGateFixture, mode: "committed" | "staged" | "unstaged" | "untracked" | "delete" | "rename"): Promise<string[]> {
    if (mode === "untracked") {
        const path = "packages/neuro-book/app/untracked.ts";
        await writeText(fixture.root, path, "export const untracked = true;\n");
        return [path];
    }
    if (mode === "delete") {
        await rm(join(fixture.root, fixture.boundaryPath));
        return [fixture.boundaryPath];
    }
    if (mode === "rename") {
        const renamed = "packages/neuro-book/app/renamed.ts";
        await runGit(fixture.root, ["mv", fixture.boundaryPath, renamed]);
        return [fixture.boundaryPath, renamed];
    }
    await writeText(fixture.root, fixture.boundaryPath, `export const mode = "${mode}";\n`);
    if (mode === "staged" || mode === "committed") await runGit(fixture.root, ["add", fixture.boundaryPath]);
    if (mode === "committed") await runGit(fixture.root, ["commit", "-m", "commit boundary change"]);
    return [fixture.boundaryPath];
}

async function createHistoricalApplicationTaskFixture(
    taskId: string,
    mode: "valid" | "missing-baseline" | "missing-mapping" | "mismatched-ownership",
    readme: string,
): Promise<string> {
    const root = await createTestTmpRoot("governance-historical-application-task", "governance-historical-application-task-test");
    fixtureRoots.push(root);
    const source = `docs/tasks/${taskId}/README.md`;
    const destination = `.agents/tasks/${taskId}/README.md`;
    if (mode !== "missing-baseline") await writeText(root, source, "# Historical source\n");
    await runGit(root, ["init", "--initial-branch", "master"]);
    await runGit(root, ["config", "user.email", "governance-test@example.invalid"]);
    await runGit(root, ["config", "user.name", "Governance Test"]);
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "historical application source baseline"]);
    const sourceRevision = (await runGit(root, ["rev-parse", "HEAD"])).trim();
    const mappings = mode === "missing-mapping" ? [] : [{
        source,
        destination,
        sourceSha256: `sha256:${"0".repeat(64)}`,
        destinationSha256: `sha256:${"0".repeat(64)}`,
        kind: "file" as const,
        linkRewrite: false,
    }];
    const manifest = {schema: "nbook.task-migration-manifest/v1", sourceRevision, mappings, repositoryLinkRewrites: [], preservedSourceFiles: []};
    const manifestSha256 = hashBytes(Buffer.from(JSON.stringify(manifest), "utf8"));
    await writeText(root, ".agents/tasks/legacy-index.json", JSON.stringify({schema: "nbook.task-migration-index/v1", sourceRevision, fileCount: mappings.length, manifestSha256, migratedAt: "2026-08-26T00:00:00Z", mappings, repositoryLinkRewrites: [], preservedSourceFiles: [], trackedFileCount: 0, localOnlyFiles: []}));
    await writeText(root, ".agents/tasks/.migration-complete", JSON.stringify({schema: "nbook.task-migration/v1", sourceRevision, fileCount: mappings.length, manifestSha256, completedAt: "2026-08-26T00:00:00Z", repositoryLinkRewrites: [], preservedSourceFiles: [], trackedFileCount: 0, localOnlyFiles: []}));
    await runGit(root, ["add", ".agents/tasks/legacy-index.json", ".agents/tasks/.migration-complete"]);
    await runGit(root, ["commit", "-m", "seal historical application identity"]);
    await writeText(root, ".agents/tasks/ownership.json", JSON.stringify({
        schema: "nbook.task-ownership/v1",
        ownerRoot: "packages/neuro-book/.agents/tasks",
        taskCount: 1,
        fileCount: 1,
        tasks: [{
            taskId,
            ownerRoot: "packages/neuro-book/.agents/tasks",
            files: [{
                path: `${taskId}/README.md`,
                legacyDestination: mode === "mismatched-ownership" ? `.agents/tasks/other/README.md` : destination,
                sha256: `sha256:${"0".repeat(64)}`,
            }],
        }],
    }));
    await writeText(root, `packages/neuro-book/.agents/tasks/${taskId}/README.md`, readme);
    await writeText(root, `packages/neuro-book/.agents/tasks/${taskId}/context.md`, "# Historical application context\n");
    return root;
}
async function createApplicationTaskWorkflowFixture(readme: string, taskId: string, options: TaskFixtureOptions = {}): Promise<string> {
    const root = await createTestTmpRoot("governance-application-task-workflow", "governance-application-task-workflow-test");
    fixtureRoots.push(root);
    await writeText(root, ".agents/tasks/ownership.json", JSON.stringify({
        schema: "nbook.task-ownership/v1",
        ownerRoot: "packages/neuro-book/.agents/tasks",
        taskCount: 1,
        fileCount: 1,
        tasks: [{
            taskId,
            ownerRoot: "packages/neuro-book/.agents/tasks",
            files: [{path: `${taskId}/README.md`, legacyDestination: `.agents/tasks/${taskId}/README.md`, sha256: `sha256:${"0".repeat(64)}`}],
        }],
    }));
    await writeText(root, `packages/neuro-book/.agents/tasks/${taskId}/README.md`, normalizeCurrentTaskReadme(readme, taskId, options));
    await writeText(root, `packages/neuro-book/.agents/tasks/${taskId}/context.md`, "# App Task Context\n");
    return root;
}
async function createGovernanceCliFixture(): Promise<string> {
    const root = await createTestTmpRoot("governance-cli", "governance-cli-test");
    fixtureRoots.push(root);
    const governanceFiles: readonly [string, string][] = [
        ["WATCHDOG.md", "fixture watchdog\n"],
        [".agents/AGENTS.md", "fixture agents rules\n"],
        [".agents/README.md", "fixture agents readme\n"],
        [".agents/tasks/.migration-complete", "{}\n"],
        [".agents/tasks/legacy-index.json", "{}\n"],
        [".agents/skills/README.md", "- [report/SKILL.md](report/SKILL.md)\n"],
        [".agents/skills/report/SKILL.md", "---\nname: report\ndescription: Report current state and next action.\nargument-hint: 'Request, file, or decision to report'\n---\n$ARGUMENTS\n当前状态\n下一步\n"],
        ["scripts/AGENTS.md", "fixture scripts rules\n"],
        ["scripts/release/AGENTS.md", "fixture release rules\n"],
        ["packages/AGENTS.md", "fixture packages rules\n"],
        ["packages/neuro-book/AGENTS.md", "共享规则见 ../../AGENTS.md\n"],
        ["packages/neuro-book/package.json", JSON.stringify({name: "@notnotype/neuro-book"})],
        ["package.json", JSON.stringify({name: "fixture", type: "module", scripts: {
            "governance:check": "bun scripts/ci/agent-governance.ts",
            "governance:context": "bun scripts/cli/agent-context.ts",
            "governance:worktree": "bun scripts/cli/create-agent-worktree.ts",
            "governance:migrate-tasks": "bun scripts/maintenance/migrate-agent-tasks.ts",
            "governance:migrate-task-ownership": "bun scripts/maintenance/migrate-task-ownership.ts",
            "test:agent-state-root": "workspace-runtime-root.test.ts agent-workspace-state-root.test.ts",
        }})],
        ["bunfig.toml", "[test]\npathIgnorePatterns = [\n    \".agent/**\",\n    \".agents/**\",\n]\n"],
        [".gitignore", ".env.local\n.agent/\n.worktree/\n"],
    ];
    for (const [relativePath, content] of governanceFiles) await writeText(root, relativePath, content);
    for (const relativePath of [
        "AGENTS.md",
        ".omp/RULES.md",
        "docs/proposals/p-005-development-workflow-governance.md",
        ".agents/works/README.md",
        ".agents/works/AGENTS.md",
        "docs/standards/repository-workflow.md",
        "docs/specs/AGENTS.md",
        ".agents/tasks/README.md",
        ".agents/tasks/AGENTS.md",
        ".agents/tasks/00160-leader-driven-development-workflow/README.md",
        ".agents/tasks/00160-leader-driven-development-workflow/context.md",
    ] as const) {
        const content = await readFile(join(repositoryRoot, relativePath), "utf8");
        const normalized = relativePath === ".agents/tasks/00160-leader-driven-development-workflow/README.md"
            ? normalizeCurrentTaskReadme(content, "00160-leader-driven-development-workflow", {})
            : content;
        await writeText(root, relativePath, normalized);
    }
    await writeText(root, ".agents/works/w00001-governance/README.md", "---\nschema: nbook.work/v1\nworkId: w00001-governance\nissueId: null\n---\n\n# Governance\n");
    await writeText(root, ".agents/works/w00001-governance/tasks/t01-model/README.md", "---\nschema: nbook.task/v2\ntaskId: t01-model\n---\n\n# Model\n");
    await writeText(root, ".agents/tasks/ownership.json", JSON.stringify({
        schema: "nbook.task-ownership/v1",
        ownerRoot: "packages/neuro-book/.agents/tasks",
        taskCount: 0,
        fileCount: 0,
        tasks: [],
    }));
    await writeText(root, ".agents/tasks/00161-profile/README.md", currentTaskReadme({kind: "bug", required: ["focused-test"]}));
    await writeText(root, ".agents/tasks/00161-profile/context.md", "# CLI Task Context\n");
    const siblingPath = ".agents/tasks/00149-monorepo-workspace-consolidation/evidences/s8-sibling-resync-resolution.json";
    await writeText(root, siblingPath, await readFile(join(repositoryRoot, siblingPath), "utf8"));

    await runGit(root, ["init", "--initial-branch", "master"]);
    await runGit(root, ["config", "user.email", "governance-test@example.invalid"]);
    await runGit(root, ["config", "user.name", "Governance Test"]);
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "fixture governance"]);
    return root;
}

type GovernanceCliResult = {status: number; report: {failures: string[]}};

async function runGovernanceCli(repoRoot: string): Promise<GovernanceCliResult> {
    try {
        const result = await execFile("bun", [join(repositoryRoot, "scripts/ci/agent-governance.ts"), "--repo-root", repoRoot], {cwd: repositoryRoot, encoding: "utf8"});
        return {status: 0, report: JSON.parse(result.stdout) as {failures: string[]}};
    } catch (error) {
        const result = error as {code?: number | string; stdout?: string; stderr?: string};
        if (result.stdout) {
            return {
                status: typeof result.code === "number" ? result.code : 1,
                report: JSON.parse(result.stdout) as {failures: string[]},
            };
        }
        throw new Error(`治理 CLI 未输出 JSON：${result.stderr ?? ""}`, {cause: error});
    }
}

type AgentContextReport = {
    schema?: string;
    failures: string[];
    work?: string | null;
    workReadme?: string | null;
    task?: string | null;
    taskReadme?: string | null;
};

async function runAgentContextCli(args: readonly string[], repoRoot = repositoryRoot): Promise<{status: number; failures: string[]; report?: AgentContextReport}> {
    try {
        const result = await execFile("bun", [join(repositoryRoot, "scripts/cli/agent-context.ts"), "--repo-root", repoRoot, ...args], {cwd: repositoryRoot, encoding: "utf8"});
        const report = JSON.parse(result.stdout) as AgentContextReport;
        return {status: 0, failures: report.failures, report};
    } catch (error) {
        const result = error as {code?: number | string; stdout?: string; stderr?: string};
        if (result.stdout) {
            const report = JSON.parse(result.stdout) as AgentContextReport;
            return {status: typeof result.code === "number" ? result.code : 1, failures: report.failures, report};
        }
        throw new Error(`agent-context CLI 未输出 JSON：${result.stderr ?? ""}`, {cause: error});
    }
}

async function createPackageFixture(options: {runtime: ".agent" | ".local" | ".worktree" | null; autonomous: boolean; trackRuntime?: boolean}): Promise<string> {
    const root = await createTestTmpRoot("governance-package", "governance-package-test");
    fixtureRoots.push(root);
    const packageName = options.autonomous ? "nb-history" : "sample";
    await writeText(root, ".gitignore", "/packages/*/.agent/\n/packages/*/.local/\n/packages/*/.worktree/\n");
    await writeText(root, `packages/${packageName}/package.json`, JSON.stringify({name: options.autonomous ? "@notnotype/nb-history" : "@notnotype/sample", version: "0.0.0"}));
    if (!options.autonomous) {
        await writeText(root, `packages/${packageName}/AGENTS.md`, "共享规则见 ../../AGENTS.md\n");
        await writeText(root, `packages/${packageName}/.agents/tasks/README.md`, "# Tasks\n");
        await writeText(root, `packages/${packageName}/.agents/tasks/one.md`, "taskId: sample-1\n");
        await writeText(root, `packages/${packageName}/docs/README.md`, "# Docs\n");
        await writeText(root, `packages/${packageName}/PROJECT-STATUS.md`, "# Status\n");
    }
    if (options.runtime) await writeText(root, `packages/${packageName}/${options.runtime}/state.json`, "{}\n");
    await runGit(root, ["init", "--initial-branch", "master"]);
    await runGit(root, ["config", "user.email", "governance-test@example.invalid"]);
    await runGit(root, ["config", "user.name", "Governance Test"]);
    await runGit(root, ["add", ".gitignore", "packages"]);
    if (options.trackRuntime) await runGit(root, ["add", "-f", `packages/${packageName}/${options.runtime}`]);
    await runGit(root, ["commit", "-m", "fixture"]);
    return root;
}

async function createWorktreeFixture(): Promise<{primary: string; linked: string; outside: string}> {
    const primary = await createTestTmpRoot("governance-worktree", "governance-worktree-test");
    fixtureRoots.push(primary);
    await mkdir(join(primary, ".worktree"), {recursive: true});
    const linked = join(primary, ".worktree", "inside");
    const outside = `${primary}-outside`;
    await writeText(primary, "README.md", "fixture\n");
    await runGit(primary, ["init", "--initial-branch", "master"]);
    await runGit(primary, ["config", "user.email", "governance-test@example.invalid"]);
    await runGit(primary, ["config", "user.name", "Governance Test"]);
    await runGit(primary, ["add", "README.md"]);
    await runGit(primary, ["commit", "-m", "fixture"]);
    await runGit(primary, ["worktree", "add", "--detach", linked]);
    await runGit(primary, ["worktree", "add", "--detach", outside]);
    return {primary, linked, outside};
}

async function createOwnershipFixture(options: {trackTask: boolean}): Promise<string> {
    const root = await createTestTmpRoot("governance-ownership", "governance-ownership-test");
    fixtureRoots.push(root);
    const taskPath = "packages/neuro-book/.agents/tasks/01-alpha/README.md";
    const taskContent = Buffer.from("---\nschema: nbook.task/v1\ntaskId: 01-alpha\n---\n\n# Alpha\n", "utf8");
    await writeText(root, ".gitignore", ".worktree/\n");
    await mkdir(join(root, "packages/neuro-book/.agents/tasks/01-alpha"), {recursive: true});
    await writeFile(join(root, taskPath), taskContent);
    await runGit(root, ["init", "--initial-branch", "master"]);
    await runGit(root, ["config", "user.email", "governance-test@example.invalid"]);
    await runGit(root, ["config", "user.name", "Governance Test"]);
    const textAttributes = readGitTextAttributes(root, [taskPath]);
    const taskSha = canonicalSha256(taskContent, textAttributes.get(taskPath) ?? "unspecified");
    await writeText(root, ".agents/tasks/ownership.json", `${JSON.stringify({
        schema: "nbook.task-ownership/v1",
        ownerRoot: "packages/neuro-book/.agents/tasks",
        taskCount: 1,
        fileCount: 1,
        tasks: [{taskId: "01-alpha", ownerRoot: "packages/neuro-book/.agents/tasks", files: [{path: "01-alpha/README.md", legacyDestination: ".agents/tasks/01-alpha/README.md", sha256: taskSha}]}],
    }, null, 2)}\n`);
    await runGit(root, ["add", ".gitignore", ".agents/tasks/ownership.json"]);
    if (options.trackTask) await runGit(root, ["add", taskPath]);
    return root;
}

async function writeText(root: string, relativePath: string, content: string): Promise<void> {
    const path = join(root, relativePath);
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, content, "utf8");
}


async function createLocalOnlyMigrationFixture(): Promise<string> {
    const root = await createTestTmpRoot("governance-migration-local-only", "governance-migration-local-only-test");
    fixtureRoots.push(root);
    const destination = ".agents/tasks/01-local/benchmark.json";
    const source = "docs/tasks/01-local/benchmark.json";
    await writeText(root, ".gitattributes", "**/.agents/tasks/** text eol=lf\n");
    await writeText(root, ".gitignore", `${destination}\n`);
    await writeText(root, ".agents/tasks/ownership.json", `${JSON.stringify({
        schema: "nbook.task-ownership/v1",
        ownerRoot: "packages/neuro-book/.agents/tasks",
        taskCount: 0,
        fileCount: 0,
        tasks: [],
    })}\n`);
    await runGit(root, ["init", "--initial-branch", "master"]);
    await runGit(root, ["config", "user.email", "governance-test@example.invalid"]);
    await runGit(root, ["config", "user.name", "Governance Test"]);
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "fixture migration baseline"]);
    const sourceRevision = (await runGit(root, ["rev-parse", "HEAD"])).trim();

    const destinationBytes = Buffer.from("benchmark\r\nvalue\r\n", "utf8");
    await mkdir(join(root, ".agents/tasks/01-local"), {recursive: true});
    await writeFile(join(root, destination), destinationBytes);
    const destinationSha256 = hashBytes(Buffer.from("benchmark\nvalue\n", "utf8"));
    const mappings = [{source, destination, sourceSha256: destinationSha256, destinationSha256, kind: "file" as const, linkRewrite: false}];
    const manifest = {schema: "nbook.task-migration-manifest/v1", sourceRevision, mappings, repositoryLinkRewrites: [], preservedSourceFiles: []};
    const manifestSha256 = hashBytes(Buffer.from(JSON.stringify(manifest), "utf8"));
    const index = {schema: "nbook.task-migration-index/v1", sourceRevision, fileCount: 1, manifestSha256, migratedAt: new Date().toISOString(), mappings, repositoryLinkRewrites: [], preservedSourceFiles: [], trackedFileCount: 0, localOnlyFiles: [source]};
    const marker = {schema: "nbook.task-migration/v1", sourceRevision, fileCount: 1, manifestSha256, completedAt: new Date().toISOString(), repositoryLinkRewrites: [], preservedSourceFiles: [], trackedFileCount: 0, localOnlyFiles: [source]};
    await writeText(root, ".agents/tasks/legacy-index.json", `${JSON.stringify(index)}\n`);
    await writeText(root, ".agents/tasks/.migration-complete", `${JSON.stringify(marker)}\n`);
    return root;
}

type LinkedWorkKind = "agent-root" | "works-root" | "work" | "tasks-root" | "task";

async function createLinkedWorkFixture(kind: LinkedWorkKind): Promise<{
    root: string;
    workId: string;
    taskId: string;
    workReadme: string | null;
    failure: string;
}> {
    const root = await createTestTmpRoot(`governance-linked-work-${kind}`, `governance-linked-work-${kind}-test`);
    const externalRoot = await createTestTmpRoot(`governance-linked-work-${kind}-external`, `governance-linked-work-${kind}-external-test`);
    fixtureRoots.push(root, externalRoot);
    const workId = "w00001-linked-work";
    const linkedTaskId = "t01-linked";
    const realTaskId = "t02-real";
    const workRoot = `.agents/works/${workId}`;
    const externalWorkRoot = join(externalRoot, workRoot);
    const workReadme = `---\nschema: nbook.work/v1\nworkId: ${workId}\nissueId: null\n---\n\n# Linked Work\n`;
    const linkedTaskReadme = `---\nschema: nbook.task/v2\ntaskId: ${linkedTaskId}\n---\n\n# Linked Task\n`;
    const realTaskReadme = `---\nschema: nbook.task/v2\ntaskId: ${realTaskId}\n---\n\n# Real Task\n`;
    await writeText(externalRoot, `${workRoot}/README.md`, workReadme);
    await writeText(externalRoot, `${workRoot}/tasks/${linkedTaskId}/README.md`, linkedTaskReadme);
    await writeText(externalRoot, `${workRoot}/tasks/${realTaskId}/README.md`, realTaskReadme);
    await writeText(root, "README.md", "# Fixture\n");

    if (kind === "works-root") await writeText(root, ".agents/.keep", "\n");
    if (kind === "work") await writeText(root, ".agents/works/.keep", "\n");
    if (kind === "tasks-root" || kind === "task") await writeText(root, `${workRoot}/README.md`, workReadme);
    if (kind === "task") await writeText(root, `${workRoot}/tasks/${realTaskId}/README.md`, realTaskReadme);
    await initializeGitFixture(root);

    const linkType = process.platform === "win32" ? "junction" : "dir";
    const link = async (target: string, relativePath: string): Promise<void> => {
        await symlink(target, join(root, relativePath), linkType);
    };
    let linkedPath: string;
    if (kind === "agent-root") {
        linkedPath = ".agents";
        await link(join(externalRoot, ".agents"), linkedPath);
    } else if (kind === "works-root") {
        linkedPath = ".agents/works";
        await link(join(externalRoot, ".agents/works"), linkedPath);
    } else if (kind === "work") {
        linkedPath = workRoot;
        await link(externalWorkRoot, linkedPath);
    } else if (kind === "tasks-root") {
        linkedPath = `${workRoot}/tasks`;
        await link(join(externalWorkRoot, "tasks"), linkedPath);
    } else {
        linkedPath = `${workRoot}/tasks/${linkedTaskId}`;
        await link(join(externalWorkRoot, "tasks", linkedTaskId), linkedPath);
    }

    return {
        root,
        workId,
        taskId: kind === "task" ? realTaskId : linkedTaskId,
        workReadme: kind === "tasks-root" || kind === "task" ? join(root, workRoot, "README.md") : null,
        failure: `Work/Task 目录项必须是物理目录：${linkedPath}`,
    };
}

function hashBytes(bytes: Uint8Array): string {
    return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
async function initializeGitFixture(root: string): Promise<void> {
    await runGit(root, ["init", "--initial-branch", "master"]);
    await runGit(root, ["config", "user.email", "governance-test@example.invalid"]);
    await runGit(root, ["config", "user.name", "Governance Test"]);
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "fixture"]);
}

async function runGit(cwd: string, args: string[]): Promise<string> {
    const result = await execFile("git", args, {cwd, encoding: "utf8"});
    return result.stdout;
}
