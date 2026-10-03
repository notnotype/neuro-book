import {readFile, readdir} from "node:fs/promises";
import {resolve} from "node:path";

import {describe, expect, it} from "vitest";
import {parse} from "yaml";

import {WORKSPACE_PACKAGE_CHECKS, selectWorkspaceMatrix} from "#scripts/ci/workspace-package-matrix";

type WorkflowStep = {
    id?: string;
    name?: string;
    run?: string;
    uses?: string;
    "working-directory"?: string;
    with?: Record<string, unknown>;
};

type Workflow = {
    name?: string;
    on?: {
        push?: {branches?: string[]; paths?: string[]; tags?: string[]};
        pull_request?: {paths?: string[]};
        workflow_dispatch?: Record<string, unknown>;
    };
    permissions?: Record<string, string>;
    jobs: Record<string, {
        steps?: WorkflowStep[];
        needs?: string | string[];
        if?: string;
        outputs?: Record<string, string>;
        strategy?: {
            "fail-fast"?: boolean;
            matrix?: {include?: Array<Record<string, unknown>>};
        };
    }>;
};

const root = resolve(import.meta.dirname, "../..");
const workflowNames = [
    "community-docs.yml",
    "code-baseline.yml",
    "workspace-packages.yml",
] as const;

async function readWorkflow(name: string): Promise<Workflow> {
    return parse(await readFile(resolve(root, ".github", "workflows", name), "utf8")) as Workflow;
}

async function readWorkflows(): Promise<Map<string, Workflow>> {
    return new Map(await Promise.all(workflowNames.map(async (name) => [name, await readWorkflow(name)] as const)));
}

function steps(workflow: Workflow): WorkflowStep[] {
    return Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);
}

function commands(workflow: Workflow): string {
    return steps(workflow).map((step) => step.run ?? "").join("\n");
}

function paths(workflow: Workflow): string[] {
    return [
        ...(workflow.on?.push?.paths ?? []),
        ...(workflow.on?.pull_request?.paths ?? []),
    ];
}

describe("v2 重建期间的 CI 工作流结构合同", () => {
    it("所有批准的 workflow 文件均存在且 YAML 可解析", async () => {
        const configs = await readWorkflows();
        expect([...configs.keys()]).toEqual(workflowNames);
        for (const [name, workflow] of configs) {
            expect(workflow.name, name).toBeTruthy();
            expect(Object.keys(workflow.jobs), name).not.toHaveLength(0);
        }
    });

    it("code baseline 只运行治理与仓库合同，监听现存 owner 路径", async () => {
        const workflow = await readWorkflow("code-baseline.yml");
        const triggerPaths = workflow.on?.pull_request?.paths ?? [];
        for (const governancePath of [".agents/**", ".omp/**", "AGENTS.md", "docs/**", "PROJECT-STATUS.md", "packages/neuro-book/**", "scripts/**"]) {
            expect(triggerPaths).toContain(governancePath);
        }
        expect(triggerPaths).not.toContain("packages/neuro-book-legacy/**");
        expect(workflow.name).toBe("Code Baseline");
        expect(Object.keys(workflow.jobs)).toEqual(["governance"]);
        expect(commands(workflow)).toContain("bun run governance:check");
        expect(commands(workflow)).toContain("bun x tsc --noEmit -p scripts/tsconfig.json");
        expect(commands(workflow)).toContain("scripts/ci/agent-governance.test.ts");
        expect(commands(workflow)).toContain("scripts/ci/workspace-workflows.test.ts");
        expect(commands(workflow)).not.toMatch(/packages\/neuro-book-legacy/u);
        expect(workflow.jobs.governance?.if).toBeUndefined();
    });

    it("所有 CI workflow 使用 Bun run --cwd 语法", async () => {
        const workflows = await readWorkflows();
        const invalid = [...workflows.entries()]
            .filter(([, workflow]) => /bun --cwd [^\n]*\brun\b/u.test(commands(workflow)))
            .map(([name]) => name);
        expect(invalid).toEqual([]);
    });

    it("Governance checkout 保留完整历史以校验迁移 sourceRevision", async () => {
        const workflow = await readWorkflow("code-baseline.yml");
        const checkout = workflow.jobs.governance?.steps?.find(({name}) => name === "Checkout");
        expect(checkout?.with?.["fetch-depth"]).toBe(0);
    });

    it("Community workflow 的 push/PR paths 一致并只运行社区文件与文档检查", async () => {
        const community = await readWorkflow("community-docs.yml");
        expect(community.on?.push?.paths).toEqual(community.on?.pull_request?.paths);
        expect(community.on?.push?.paths).toEqual(expect.arrayContaining([
            ".agents/**",
            "packages/neuro-book/**",
            "package.json",
            "bun.lock",
        ]));
        expect(commands(community)).toContain("bun scripts/ci/validate-community-files.ts");
        expect(commands(community)).toContain("bun run docs:check");
        expect(commands(community)).not.toContain("docs:build");
    });

    it("六自治包 matrix 由变更选择器驱动并保留 owner、命令、路径和 artifact", async () => {
        const workflow = await readWorkflow("workspace-packages.yml");
        expect(paths(workflow)).toEqual(expect.arrayContaining([
            "packages/llmlint/web/**",
            "packages/llmlint/skill/**",
            "bunfig.toml",
            "packages/llmlint/evals/report/**",
        ]));
        const packageJob = workflow.jobs.package;
        expect(packageJob?.needs).toBe("select-packages");
        expect(packageJob?.strategy?.["fail-fast"]).toBe(false);
        expect(packageJob?.strategy?.matrix).toBe("${{ fromJSON(needs.select-packages.outputs.matrix) }}");
        const selectRun = String(workflow.jobs["select-packages"]?.steps?.find((step) => step.id === "select")?.run ?? "");
        expect(selectRun).toContain("scripts/ci/workspace-package-matrix.ts");
        for (const check of WORKSPACE_PACKAGE_CHECKS) {
            expect(check.directory).toBe(`packages/${check.name}`);
            expect(check.commands.trim()).not.toBe("");
        }
        const harnessRow = WORKSPACE_PACKAGE_CHECKS.find((row) => row.name === "neuro-agent-harness");
        expect(harnessRow?.commands).toContain("bun run verify");
        const uiRow = WORKSPACE_PACKAGE_CHECKS.find((row) => row.name === "nb-ui");
        expect(uiRow?.commands).toContain("bun run test");
        const packageStep = packageJob?.steps?.find((step) => step.name === "Run package checks");
        expect(packageStep).toMatchObject({"working-directory": "${{ matrix.directory }}", run: "${{ matrix.commands }}"});
        expect(workflow.jobs["llmlint-web"]?.if).toBe("needs.select-packages.outputs.run_web_island == 'true'");
        const webSteps = workflow.jobs["llmlint-web"].steps ?? [];
        expect(webSteps).toEqual(expect.arrayContaining([
            expect.objectContaining({"working-directory": "packages/llmlint/web", run: "bun install --frozen-lockfile"}),
            expect.objectContaining({"working-directory": "packages/llmlint/web", run: "bunx nuxt prepare"}),
            expect.objectContaining({"working-directory": "packages/llmlint/web", run: "bun run typecheck"}),
            expect.objectContaining({"working-directory": "packages/llmlint/web", run: "bun run typecheck:server"}),
            expect.objectContaining({"working-directory": "packages/llmlint/web", run: "bun run build"}),
            expect.objectContaining({
                uses: "actions/upload-artifact@v4",
                with: expect.objectContaining({path: "packages/llmlint/web/.output", "include-hidden-files": true, "if-no-files-found": "error"}),
            }),
        ]));
    });

    it("workspace 变更选择器按反向依赖闭包收缩矩阵", () => {
        const single = selectWorkspaceMatrix(["packages/nb-history/src/a.ts"], "pull_request");
        expect(single.include.map((row) => row.name)).toEqual(["nb-history"]);
        expect(single.runWebIsland).toBe(false);

        const closure = selectWorkspaceMatrix(["packages/neuro-agent-harness/src/b.ts"], "pull_request");
        expect(closure.include.map((row) => row.name)).toEqual(["neuro-agent-harness", "llmlint"]);
        expect(closure.runWebIsland).toBe(true);

        const mixed = selectWorkspaceMatrix(["bun.lock", "packages/nb-history/src/a.ts"], "pull_request");
        expect(mixed.include).toHaveLength(WORKSPACE_PACKAGE_CHECKS.length);
        expect(mixed.runWebIsland).toBe(true);

        const webIsland = selectWorkspaceMatrix(["packages/llmlint/web/app.vue"], "pull_request");
        expect(webIsland.include.map((row) => row.name)).toEqual(["llmlint"]);
        expect(webIsland.runWebIsland).toBe(true);

        const shared = selectWorkspaceMatrix(["bun.lock"], "pull_request");
        expect(shared.include).toHaveLength(WORKSPACE_PACKAGE_CHECKS.length);
        expect(shared.runWebIsland).toBe(true);

        const dispatched = selectWorkspaceMatrix([".agents/tasks/x/README.md"], "workflow_dispatch");
        expect(dispatched.include).toHaveLength(WORKSPACE_PACKAGE_CHECKS.length);
        expect(dispatched.runWebIsland).toBe(true);
    });

    it("所有 workflow 的 trigger paths 不保留已迁移的根应用配置路径", async () => {
        const configs = await readWorkflows();
        const staleRootDirectories = /^(?:app|server|shared|world-engine|prisma)(?:\/|\*\*)/u;
        const staleRootConfigs = new Set([
            "*.d.ts",
            ".env.example",
            "config.example.yaml",
            "release-state-migration.json",
            "tsconfig.json",
            "uno.config.ts",
            "vitest.config.ts",
            "nuxt.config.ts",
            "prisma.config.ts",
        ]);
        for (const [name, workflow] of configs) {
            for (const triggerPath of paths(workflow)) {
                expect(triggerPath, name).not.toMatch(staleRootDirectories);
                expect(staleRootConfigs.has(triggerPath), `${name}: ${triggerPath}`).toBe(false);
            }
            expect(commands(workflow), name).not.toMatch(/(?:^|\n)\s*bun run (?:generate|nuxt:prepare|nuxt:build|runtime:typecheck|test:agent-state-root)(?:\s|$)/u);
        }
    });

    it("code-baseline 的 PR paths 覆盖除旧应用外的全部 packages 目录", async () => {
        const dirents = await readdir(resolve(root, "packages"), {withFileTypes: true});
        const packageDirs = dirents.filter((d) => d.isDirectory() && d.name !== "neuro-book-legacy").map((d) => d.name);
        expect(packageDirs.length).toBeGreaterThanOrEqual(12);
        const prPaths = (await readWorkflow("code-baseline.yml")).on?.pull_request?.paths ?? [];
        for (const dir of packageDirs) {
            expect(prPaths, `code-baseline.yml: packages/${dir}`).toContain(`packages/${dir}/**`);
        }
    });
});
