import {readFile} from "node:fs/promises";
import {resolve} from "node:path";

import {describe, expect, it} from "vitest";
import {parse} from "yaml";

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
        strategy?: {
            "fail-fast"?: boolean;
            matrix?: {include?: Array<Record<string, unknown>>};
        };
    }>;
};

const root = resolve(import.meta.dirname, "../..");
const workflowNames = [
    "community-docs.yml",
    "deploy-docs.yml",
    "code-baseline.yml",
    "desktop-envelope-contract.yml",
    "product-platforms.yml",
    "product-runtime-baselines.yml",
    "release-container.yml",
    "release-manager.yml",
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

describe("迁移后九个 CI 工作流结构合同", () => {
    it("所有批准的 workflow 文件均存在且 YAML 可解析", async () => {
        const configs = await readWorkflows();
        expect([...configs.keys()]).toEqual(workflowNames);
        for (const [name, workflow] of configs) {
            expect(workflow.name, name).toBeTruthy();
            expect(Object.keys(workflow.jobs), name).not.toHaveLength(0);
        }
    });

    it("code baseline 只监听真实 owner 路径，不保留根应用配置过滤", async () => {
        const workflow = await readWorkflow("code-baseline.yml");
        const triggerPaths = workflow.on?.pull_request?.paths ?? [];
        for (const required of [
            "packages/neuro-book/tsconfig.json",
            "packages/neuro-book/uno.config.ts",
            "packages/neuro-book/vitest.config.ts",
            "packages/neuro-book/release-state-migration.json",
            "packages/neuro-book/config.example.yaml",
            "packages/neuro-book/.env.example",
            "packages/neuro-book/*.d.ts",
        ]) {
            expect(triggerPaths).toContain(required);
        }
        for (const governancePath of [".agents/**", ".omp/**", "AGENTS.md", "docs/**", "PROJECT-STATUS.md", "packages/neuro-book/assets/**"]) {
            expect(triggerPaths).toContain(governancePath);
        }
        expect(triggerPaths).not.toContain("assets/**");
        for (const stale of [
            "*.d.ts",
            ".env.example",
            "config.example.yaml",
            "release-state-migration.json",
            "tsconfig.json",
            "uno.config.ts",
            "vitest.config.ts",
        ]) {
            expect(triggerPaths).not.toContain(stale);
        }
        expect(commands(workflow)).toContain("bun run --cwd packages/neuro-book generate");
        expect(commands(workflow)).toContain("bun run --cwd packages/neuro-book typecheck");
        expect(commands(workflow)).toContain("bun run --cwd packages/neuro-book test -- --reporter=dot");
        expect(commands(workflow)).not.toMatch(/bun --cwd packages\/neuro-book run/u);
        expect(commands(workflow)).not.toContain("bun install --cwd desktop/electron");
        expect(workflow.name).toBe("Code Baseline");
        expect(Object.keys(workflow.jobs)).toContain("governance");
        expect(commands(workflow)).toContain("bun run governance:check");
        expect(commands(workflow)).toContain("bun x tsc --noEmit -p scripts/tsconfig.json");
        expect(commands(workflow)).toContain("scripts/ci/agent-governance.test.ts");
        expect(commands(workflow)).toContain("scripts/ci/workspace-workflows.test.ts");
        expect(commands(workflow)).toContain("scripts/build/dockerfile-contract.test.ts");
        expect(Object.values(workflow.jobs).map((job) => job.name ?? "").join(" ")).not.toContain("advisory");
    });

    it("所有 CI workflow 使用 Bun run --cwd 语法", async () => {
        const workflows = await readWorkflows();
        const invalid = [...workflows.entries()]
            .filter(([, workflow]) => /bun --cwd [^\n]*\brun\b/u.test(commands(workflow)))
            .map(([name]) => name);
        expect(invalid).toEqual([]);
    });

    it("Electron 独立 lockfile 使用 POSIX workspace 路径", async () => {
        const lockfile = await readFile(resolve(root, "desktop/electron/bun.lock"), "utf8");
        expect(lockfile).not.toContain("file:..\\\\");
        expect(lockfile).toContain("@notnotype/neuro-book-test-support@file:../../packages/neuro-book-test-support");
    });

    it("Governance checkout 保留完整历史以校验迁移 sourceRevision", async () => {
        const workflow = await readWorkflow("code-baseline.yml");
        const checkout = workflow.jobs.governance?.steps?.find(({name}) => name === "Checkout");
        expect(checkout?.with?.["fetch-depth"]).toBe(0);
    });

    it("Community 与 Deploy Docs 的 runtime paths 指向应用 owner", async () => {
        const community = await readWorkflow("community-docs.yml");
        expect(community.on?.push).toBeUndefined();
        expect(community.on?.pull_request?.paths).toEqual(expect.arrayContaining([
            "packages/neuro-book/**",
            "packages/neuro-book/tsconfig.json",
            "scripts/ci/stage-docs-locales*",
            "package.json",
            "bun.lock",
        ]));
        expect(commands(community)).toContain("bun run --cwd packages/neuro-book nuxt:prepare");
        const deploy = await readWorkflow("deploy-docs.yml");
        expect(paths(deploy)).toEqual(expect.arrayContaining([
            "packages/neuro-book/**",
            "packages/neuro-book/tsconfig.json",
            "scripts/ci/stage-docs-locales*",
            "package.json",
            "bun.lock",
        ]));
        expect(commands(deploy)).toContain("bun run --cwd packages/neuro-book nuxt:prepare");
        expect(commands(community)).toContain("bun run docs:check");
        expect(commands(deploy)).toContain("bun run docs:check");
        expect(commands(deploy)).toContain("bun scripts/ci/validate-community-files.ts");
    });

    it("六自治包 matrix 与 llmlint Web island 保留 owner、命令、路径和 artifact", async () => {
        const workflow = await readWorkflow("workspace-packages.yml");
        expect(paths(workflow)).toEqual(expect.arrayContaining([
            "packages/llmlint/web/**",
            "packages/llmlint/skill/**",
            "packages/llmlint/evals/report/**",
        ]));
        const packageJob = workflow.jobs.package;
        expect(packageJob?.strategy?.["fail-fast"]).toBe(false);
        const rows = packageJob?.strategy?.matrix?.include ?? [];
        const expected = ["nb-history", "nb-workflow", "nb-memory", "nb-ui", "neuro-agent-harness", "llmlint"];
        expect(rows.map((row) => row.name)).toEqual(expected);
        for (const row of rows) {
            expect(row.directory).toBe(`packages/${row.name as string}`);
            expect(String(row.commands ?? "").trim()).not.toBe("");
        }
        const harnessRow = rows.find((row) => row.name === "neuro-agent-harness");
        expect(String(harnessRow?.commands ?? "")).toContain("bun run verify");
        const uiRow = rows.find((row) => row.name === "nb-ui");
        expect(String(uiRow?.commands ?? "")).toContain("bun run test");
        const packageStep = packageJob?.steps?.find((step) => step.name === "Run package checks");
        expect(packageStep).toMatchObject({"working-directory": "${{ matrix.directory }}", run: "${{ matrix.commands }}"});
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

    it("Product baseline 与 platform workflow 覆盖 runner、应用 build 和 measurement artifact", async () => {
        const baseline = await readWorkflow("product-runtime-baselines.yml");
        const baselineRows = baseline.jobs.measure.strategy?.matrix?.include ?? [];
        expect(baselineRows.map((row) => row.platform)).toEqual([
            "windows-x64",
            "linux-x64-glibc",
            "linux-aarch64-glibc",
            "darwin-x64",
            "darwin-aarch64",
        ]);
        expect(commands(baseline)).toContain("bun run product:measure --output");
        expect(commands(baseline)).toContain("compare-product-runtime-measurements.ts");
        expect(steps(baseline)).toContainEqual(expect.objectContaining({uses: "actions/upload-artifact@v4", with: expect.objectContaining({path: expect.stringContaining("product-runtime-measurement-")})}));
        const platforms = await readWorkflow("product-platforms.yml");
        expect(paths(platforms)).toEqual(expect.arrayContaining([
            "packages/neuro-book/**",
            "packages/neuro-book-contracts/**",
            "packages/neuro-book-manager/**",
            "bun.lock",
            "package.json",
        ]));
        expect(platforms.jobs.product?.strategy?.matrix).toBe("${{ fromJSON(needs.select-platforms.outputs.matrix) }}");
        const selectRun = String(platforms.jobs["select-platforms"]?.steps?.find((step) => step.id === "select")?.run ?? "");
        for (const platform of ["linux-x64-glibc", "linux-aarch64-glibc", "darwin-x64", "darwin-aarch64"]) {
            expect(selectRun).toContain(platform);
        }
        expect(selectRun).toContain("pull_request");
        expect(commands(platforms)).toContain("bun run --cwd packages/neuro-book nuxt:build");
        expect(commands(platforms)).toContain("./packages/neuro-book/package.json");
        expect(commands(platforms)).toContain("bun run test:install");
        expect(commands(platforms)).toContain("bun run manager:test");
        expect(commands(platforms)).toContain("bun run --cwd packages/owned-process test");
        const diagnostics = steps(platforms).find((step) => step.name === "Upload native Product diagnostics");
        expect(diagnostics).toMatchObject({
            uses: "actions/upload-artifact@v4",
            with: expect.objectContaining({
                name: expect.stringContaining("product-diagnostics"),
                path: expect.stringContaining("product-build.json"),
            }),
        });
    });

    it("Desktop、Manager 与 Release workflow 使用正确 owner 命令和产物边界", async () => {
        const desktop = await readWorkflow("desktop-envelope-contract.yml");
        expect(paths(desktop)).toEqual(expect.arrayContaining([
            "packages/neuro-book-contracts/src/desktop-*.ts",
            "packages/neuro-book-manager/src/desktop-uac-client*.ts",
            "packages/neuro-book-manager/**",
        ]));
        expect(commands(desktop)).toContain("bun x vitest run --config scripts/vitest.config.ts scripts/build/product-runtime-bundle.test.ts scripts/build/product-build-environment.test.ts");
        expect(commands(desktop)).not.toContain("bun run scripts/build/product-runtime-bundle.test.ts");
        const manager = await readWorkflow("release-manager.yml");
        expect(commands(manager)).toContain("bun run --cwd packages/neuro-book runtime:typecheck");
        expect(commands(manager)).toContain("bun run --cwd packages/neuro-book nuxt:prepare");
        expect(commands(manager)).toContain("bun run manager:typecheck");
        expect(commands(manager)).toContain("bun run manager:test");
        expect(steps(manager)).toContainEqual(expect.objectContaining({uses: "actions/setup-node@v6", with: expect.objectContaining({"package-manager-cache": false})}));
        const release = await readWorkflow("release-container.yml");
        expect(commands(release)).toContain("bun run --cwd packages/neuro-book generate");
        expect(commands(release)).toContain("bun run --cwd packages/neuro-book nuxt:build");
        const windowsCache = release.jobs["product-windows"].steps?.find((step) => step.uses === "actions/cache@v4");
        const windowsCacheKey = String(windowsCache?.with?.key ?? "");
        expect(windowsCacheKey).toContain("packages/neuro-book/package.json");
        expect(windowsCacheKey).toContain("packages/neuro-book-contracts/package.json");
        expect(windowsCacheKey).toContain("packages/neuro-book-manager/package.json");
        const dockerBuild = steps(release).find((step) => step.uses === "docker/build-push-action@v6");
        expect(dockerBuild?.with?.["cache-from"]).toBe("type=gha,scope=app-${{ matrix.arch }}");
        expect(dockerBuild?.with?.["cache-to"]).toBe("type=gha,mode=max,scope=app-${{ matrix.arch }}");
    });

    it("九 workflow 的 trigger paths 不保留已迁移的根应用配置路径", async () => {
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
});
