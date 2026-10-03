import {execFile as execFileCallback} from "node:child_process";
import {mkdir, realpath, rm, symlink, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {promisify} from "node:util";
import {afterEach, describe, expect, it} from "vitest";

import {primaryCheckoutRoot, rareDocumentSymbolWarnings, verifyLegacyTaskRoots, verifyMonorepoWorktreeLayout, verifyPackageScriptBoundary, verifyWorkContracts, verifyWorkspacePackageGovernance} from "#scripts/ci/agent-governance-contract";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

const execFile = promisify(execFileCallback);
const fixtureRoots: string[] = [];
const repositoryRoot = join(import.meta.dirname, "..", "..");

afterEach(async () => {
    await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});


describe("文档罕见符号警告", () => {
    it("每个文件一条，只数正文里的 § 与 ¶，历史归档不算", async () => {
        const repoRoot = await createTestTmpRoot("governance-symbols", "governance-symbols-test");
        fixtureRoots.push(repoRoot);
        await writeText(repoRoot, "docs/a.md", "见 §3 与 ¶2。\n\n`§` 是在说符号本身。\n\n  ```\n  § 代码块里的\n  ```\n");
        await writeText(repoRoot, "docs/b.md", "见 §1。\n");
        await writeText(repoRoot, ".agents/tasks/01-old/README.md", "旧记录 §1\n");
        await writeText(repoRoot, "docs/clean.md", "没有符号。\n");
        await runGit(repoRoot, ["init", "--initial-branch", "master"]);

        expect(rareDocumentSymbolWarnings(repoRoot)).toEqual([
            {path: "docs/a.md", label: "文档用 § 或 ¶ 代替中文词", detail: "docs/a.md（2 处），改写成小节名或锚点链接"},
            {path: "docs/b.md", label: "文档用 § 或 ¶ 代替中文词", detail: "docs/b.md（1 处），改写成小节名或锚点链接"},
        ]);
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

        expect(verifyLegacyTaskRoots(repoRoot)).toEqual(expect.arrayContaining([
            expect.stringContaining("旧归档根拒收 v2"),
        ]));
    });
    it("根旧归档的 nested v2 Task 由 legacy 校验拒收", async () => {
        const repoRoot = await createTestTmpRoot("governance-root-archive-v2", "governance-root-archive-v2-test");
        fixtureRoots.push(repoRoot);
        const relativePath = ".agents/tasks/archived/nested-v2/README.md";
        await writeText(repoRoot, relativePath, "---\nschema: nbook.task/v2\ntaskId: t01-nested\n---\n\n# Nested\n");

        expect(verifyLegacyTaskRoots(repoRoot)).toContain(`旧归档根拒收 v2，请移入 .agents/works/<work>/tasks/<task>/：${relativePath}`);
    });

    it("自治包旧归档的 nested v2 Task 由 legacy 校验拒收", async () => {
        const repoRoot = await createTestTmpRoot("governance-package-archive-v2", "governance-package-archive-v2-test");
        fixtureRoots.push(repoRoot);
        const relativePath = "packages/neuro-agent-harness/.agents/tasks/archived/nested-v2/README.md";
        await writeText(repoRoot, relativePath, "---\nschema: nbook.task/v2\ntaskId: t01-nested\n---\n\n# Nested\n");

        expect(verifyLegacyTaskRoots(repoRoot)).toContain(`旧归档根拒收 v2，请移入 .agents/works/<work>/tasks/<task>/：${relativePath}`);
    });
    it("根旧归档的非 archived nested v2 Task 由 legacy 校验拒收", async () => {
        const repoRoot = await createTestTmpRoot("governance-root-nested-v2", "governance-root-nested-v2-test");
        fixtureRoots.push(repoRoot);
        const relativePath = ".agents/tasks/group/t01-hidden/README.md";
        await writeText(repoRoot, relativePath, "---\nschema: nbook.task/v2\ntaskId: t01-hidden\n---\n\n# Hidden\n");

        expect(verifyLegacyTaskRoots(repoRoot)).toContain(`旧归档根拒收 v2，请移入 .agents/works/<work>/tasks/<task>/：${relativePath}`);
    });

    it("自治包旧归档的非 archived nested v2 Task 由 legacy 校验拒收", async () => {
        const repoRoot = await createTestTmpRoot("governance-package-nested-v2", "governance-package-nested-v2-test");
        fixtureRoots.push(repoRoot);
        const relativePath = "packages/neuro-agent-harness/.agents/tasks/group/t01-hidden/README.md";
        await writeText(repoRoot, relativePath, "---\nschema: nbook.task/v2\ntaskId: t01-hidden\n---\n\n# Hidden\n");

        expect(verifyLegacyTaskRoots(repoRoot)).toContain(`旧归档根拒收 v2，请移入 .agents/works/<work>/tasks/<task>/：${relativePath}`);
    });
});

describe("治理命令", () => {
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

    it("治理 CLI 的警告只逐条列出改动范围内的文件", async () => {
        const repoRoot = await createGovernanceCliFixture();
        await writeText(repoRoot, "docs/stock.md", "见 §1。\n");
        await runGit(repoRoot, ["add", "docs/stock.md"]);
        await runGit(repoRoot, ["commit", "-m", "stock"]);
        await runGit(repoRoot, ["switch", "-c", "feature"]);
        await writeText(repoRoot, "docs/committed.md", "见 §2。\n");
        await runGit(repoRoot, ["add", "docs/committed.md"]);
        await runGit(repoRoot, ["commit", "-m", "feature"]);
        await writeText(repoRoot, "docs/draft.md", "见 ¶3。\n");
        const warning = (path: string): string => `文档用 § 或 ¶ 代替中文词：${path}（1 处），改写成小节名或锚点链接`;

        const uncommitted = await runGovernanceCli(repoRoot);
        expect(uncommitted.report.warnings).toEqual([warning("docs/draft.md")]);
        expect(uncommitted.report.stockWarnings).toBe("另有 2 条警告不在本次改动范围（文档用 § 或 ¶ 代替中文词 2），加 --all 逐条列出");

        const sinceMaster = await runGovernanceCli(repoRoot, ["--since", "master"]);
        expect(sinceMaster.report.warnings).toEqual([warning("docs/committed.md"), warning("docs/draft.md")]);

        const all = await runGovernanceCli(repoRoot, ["--all"]);
        expect(all.report.warnings).toHaveLength(3);
        expect(all.report.stockWarnings).toBeUndefined();
        expect(all.status).toBe(0);
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
    it("包不得依赖旧应用", async () => {
        const repoRoot = await createPackageFixture({runtime: null, autonomous: false, dependencies: {"@notnotype/neuro-book-legacy": "workspace:*"}});
        await writeText(repoRoot, "packages/neuro-book-legacy/package.json", JSON.stringify({name: "@notnotype/neuro-book-legacy"}));

        expect(verifyWorkspacePackageGovernance(repoRoot)).toEqual(["包不得依赖旧应用：packages/sample -> @notnotype/neuro-book-legacy"]);
    });
});


describe("包与根 scripts 的边界", () => {
    it("拒绝包导入根 #scripts/*，旧应用不检查", async () => {
        const repoRoot = await createTestTmpRoot("governance-script-boundary", "governance-script-boundary-test");
        fixtureRoots.push(repoRoot);
        await writeText(repoRoot, "packages/sample/src/index.ts", "import {git} from \"#scripts/ci/agent-governance-contract\";\n");
        await writeText(repoRoot, "packages/sample/src/clean.ts", "export const value = 1;\n");
        await writeText(repoRoot, "packages/neuro-book-legacy/scripts/dev.ts", "import \"#scripts/utils/workspace-roots\";\n");
        await runGit(repoRoot, ["init", "--initial-branch", "master"]);

        expect(verifyPackageScriptBoundary(repoRoot)).toEqual(["包导入了根 scripts：packages/sample/src/index.ts -> #scripts/ci/agent-governance-contract"]);
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

async function createGovernanceCliFixture(): Promise<string> {
    const root = await createTestTmpRoot("governance-cli", "governance-cli-test");
    fixtureRoots.push(root);
    const governanceFiles: readonly [string, string][] = [
        ["AGENTS.md", "fixture root rules\n"],
        [".omp/RULES.md", "fixture omp rules\n"],
        ["WATCHDOG.md", "fixture watchdog\n"],
        [".agents/AGENTS.md", "fixture agents rules\n"],
        [".agents/README.md", "fixture agents readme\n"],
        [".agents/works/README.md", "fixture works readme\n"],
        [".agents/works/AGENTS.md", "fixture works rules\n"],
        [".agents/tasks/README.md", "fixture legacy tasks readme\n"],
        [".agents/tasks/AGENTS.md", "fixture legacy tasks rules\n"],
        [".agents/skills/README.md", "fixture skills readme\n"],
        ["scripts/AGENTS.md", "fixture scripts rules\n"],
        ["packages/AGENTS.md", "fixture packages rules\n"],
        ["packages/neuro-book/AGENTS.md", "共享规则见 ../../AGENTS.md\n"],
        ["packages/neuro-book/package.json", JSON.stringify({name: "@notnotype/neuro-book"})],
        ["package.json", JSON.stringify({name: "fixture", type: "module", scripts: {
            "governance:check": "bun scripts/ci/agent-governance.ts",
            "governance:context": "bun scripts/cli/agent-context.ts",
            "governance:worktree": "bun scripts/cli/create-agent-worktree.ts",
            "docs:check": "bun scripts/ci/check-documentation.ts",
            "test:affected": "bun scripts/cli/test-affected.ts",
        }})],
        ["bunfig.toml", "[test]\npathIgnorePatterns = [\n    \".agent/**\",\n    \".agents/**\",\n]\n"],
        [".gitignore", ".env.local\n.agent/\n.worktree/\n"],
        [".agents/works/w00001-governance/README.md", "---\nschema: nbook.work/v1\nworkId: w00001-governance\nissueId: null\n---\n\n# Governance\n"],
        [".agents/works/w00001-governance/tasks/t01-model/README.md", "---\nschema: nbook.task/v2\ntaskId: t01-model\n---\n\n# Model\n"],
    ];
    for (const [relativePath, content] of governanceFiles) await writeText(root, relativePath, content);
    await initializeGitFixture(root);
    return root;
}

type GovernanceCliReport = {failures: string[]; warnings: string[]; stockWarnings?: string};
type GovernanceCliResult = {status: number; report: GovernanceCliReport};

async function runGovernanceCli(repoRoot: string, args: readonly string[] = []): Promise<GovernanceCliResult> {
    try {
        const result = await execFile("bun", [join(repositoryRoot, "scripts/ci/agent-governance.ts"), "--repo-root", repoRoot, ...args], {cwd: repositoryRoot, encoding: "utf8"});
        return {status: 0, report: JSON.parse(result.stdout) as GovernanceCliReport};
    } catch (error) {
        const result = error as {code?: number | string; stdout?: string; stderr?: string};
        if (result.stdout) {
            return {
                status: typeof result.code === "number" ? result.code : 1,
                report: JSON.parse(result.stdout) as GovernanceCliReport,
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

async function createPackageFixture(options: {runtime: ".agent" | ".local" | ".worktree" | null; autonomous: boolean; trackRuntime?: boolean; dependencies?: Record<string, string>}): Promise<string> {
    const root = await createTestTmpRoot("governance-package", "governance-package-test");
    fixtureRoots.push(root);
    const packageName = options.autonomous ? "nb-history" : "sample";
    await writeText(root, ".gitignore", "/packages/*/.agent/\n/packages/*/.local/\n/packages/*/.worktree/\n");
    await writeText(root, `packages/${packageName}/package.json`, JSON.stringify({name: options.autonomous ? "@notnotype/nb-history" : "@notnotype/sample", version: "0.0.0", dependencies: options.dependencies}));
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

async function writeText(root: string, relativePath: string, content: string): Promise<void> {
    const path = join(root, relativePath);
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, content, "utf8");
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
