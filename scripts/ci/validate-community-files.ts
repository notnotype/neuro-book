import {readdir, readFile} from "node:fs/promises";
import {basename, resolve} from "node:path";
import {parse} from "yaml";

import {readLabelManifest} from "#scripts/ci/community-labels";

interface FormOption {
    label: string;
    required?: boolean;
}

interface FormField {
    type: string;
    id?: string;
    attributes?: {
        label?: string;
        options?: FormOption[];
    };
    validations?: {
        required?: boolean;
    };
}

interface IssueForm {
    name: string;
    description: string;
    labels: string[];
    body: FormField[];
}

interface IssueTemplateConfig {
    blank_issues_enabled: boolean;
    contact_links?: Array<{
        name: string;
        url: string;
        about: string;
    }>;
}

interface FormContract {
    path: string;
    typeLabel: string;
    requiredLabels?: string[];
    requiredIds: string[];
}

interface WorkflowStep {
    id?: string;
    run?: string;
    uses?: string;
    "working-directory"?: string;
    with?: {
        "node-version"?: string | number;
        "fetch-depth"?: number;
        name?: string;
        path?: string;
        "if-no-files-found"?: string;
    };
}

interface WorkflowJob {
    name?: string;
    "timeout-minutes"?: number;
    needs?: string | string[];
    if?: string;
    strategy?: {
        "fail-fast"?: boolean;
        matrix?:
            | {
                include?: Array<{name?: string; directory?: string; commands?: string}>;
            }
            | string;
    };
    steps?: WorkflowStep[];
}

interface WorkflowConfig {
    name: string;
    on: {
        push?: {
            branches?: string[];
            paths?: string[];
        };
        pull_request?: {
            paths?: string[];
        };
    };
    permissions: Record<string, string>;
    jobs: Record<string, WorkflowJob>;
}

const root = resolve(import.meta.dir, "../..");

const formContracts: FormContract[] = [
    {
        path: ".github/ISSUE_TEMPLATE/01-bug-report.yml",
        typeLabel: "type: bug",
        requiredIds: [
            "version",
            "installation",
            "operating-system",
            "architecture",
            "reproducibility",
            "steps",
            "actual-result",
            "expected-result",
            "privacy-confirmation",
            "duplicate-check",
        ],
    },
    {
        path: ".github/ISSUE_TEMPLATE/02-feature-request.yml",
        typeLabel: "type: feature",
        requiredIds: [
            "problem",
            "desired-outcome",
            "current-workaround",
            "target-users",
            "privacy-confirmation",
            "duplicate-check",
        ],
    },
    {
        path: ".github/ISSUE_TEMPLATE/03-prompt-contribution.yml",
        typeLabel: "type: feature",
        requiredLabels: ["area: agent"],
        requiredIds: [
            "contribution-kind",
            "asset-kind",
            "target",
            "use-case",
            "desired-behavior",
            "content-authorization",
            "privacy-confirmation",
            "duplicate-check",
        ],
    },
    {
        path: ".github/ISSUE_TEMPLATE/04-support-request.yml",
        typeLabel: "type: support",
        requiredIds: [
            "question",
            "version",
            "installation",
            "environment",
            "attempted",
            "current-result",
            "privacy-confirmation",
            "duplicate-check",
        ],
    },
    {
        path: ".github/ISSUE_TEMPLATE/99-other-request.yml",
        typeLabel: "type: other",
        requiredIds: [
            "topic",
            "why-other",
            "details",
            "privacy-confirmation",
            "duplicate-check",
        ],
    },
];

const yamlPaths = [
    ".github/labels.yml",
    ...formContracts.map((contract) => contract.path),
    ".github/ISSUE_TEMPLATE/config.yml",
    ".github/workflows/community-docs.yml",
    ".github/workflows/code-baseline.yml",
    ".github/workflows/deploy-docs.yml",
    ".github/workflows/desktop-envelope-contract.yml",
    ".github/workflows/product-platforms.yml",
    ".github/workflows/product-runtime-baselines.yml",
    ".github/workflows/release-container.yml",
    ".github/workflows/release-manager.yml",
    ".github/workflows/workspace-packages.yml",
];

const codeBaselinePaths = [
    "packages/neuro-book/**",
    "packages/neuro-book-contracts/**",
    "packages/neuro-book-test-support/**",
    "packages/neuro-book-manager/**",
    "packages/owned-process/**",
    "packages/file-snapshot-cache/**",
    "packages/nb-history/**",
    "packages/nb-workflow/**",
    "packages/nb-memory/**",
    "packages/nb-ui/**",
    "packages/neuro-agent-harness/**",
    "packages/llmlint/**",
    "packages/neuro-book/assets/**",
    "plugins/**",
    "scripts/**",
    "packages/neuro-book/nuxt.config.ts",
    "packages/neuro-book/prisma.config.ts",
    "packages/neuro-book/*.d.ts",
    "packages/neuro-book/.env.example",
    "packages/neuro-book/.env.docker.example",
    "packages/neuro-book/Dockerfile*",
    "bunfig.toml",
    "packages/neuro-book/config.example.yaml",
    "packages/neuro-book/docker-compose*.yml",
    "packages/neuro-book/release-state-migration.json",
    "packages/neuro-book/tsconfig.json",
    "packages/neuro-book/uno.config.ts",
    "packages/neuro-book/vitest.config.ts",
    "package.json",
    "bun.lock",
    "patches/**",
    ".github/workflows/code-baseline.yml",
];

const docsRuntimePaths = [
    ".omp/**",
    "WATCHDOG.md",
    "CONTEXT.md",
    "RELEASE.md",
    "patches/**",
    "scripts/ci/check-documentation*",
    "scripts/ci/stage-docs-locales*",
    "scripts/ci/validate-nitropack-patch.ts",
    "packages/neuro-book/**",
    "packages/neuro-book/nuxt.config.ts",
    "packages/neuro-book/tsconfig.json",
    "package.json",
    "bun.lock",
];

const communityOnlyPaths = [".agents/**"] as const;

const nitroPatchTestCommand = "bun scripts/ci/validate-nitropack-patch.ts";
const documentationCheckCommand = "bun run docs:check";

/** 读取仓库内的 UTF-8 文本文件。 */
async function readRepoFile(path: string): Promise<string> {
    return await readFile(resolve(root, path), "utf8");
}

/** 解析受版本控制的 YAML 配置。 */
async function readYaml<T>(path: string): Promise<T> {
    return parse(await readRepoFile(path)) as T;
}

/** 在社区配置违反明确合同时终止校验。 */
function ensure(condition: boolean, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

/** 验证标签名称、颜色和描述可以作为仓库标签真相源。 */
async function validateLabels(): Promise<Set<string>> {
    const labels = await readLabelManifest(resolve(root, ".github/labels.yml"));
    return new Set(labels.map((label) => label.name));
}

/** 判断表单字段是否通过字段级或 checkbox option 声明为必填。 */
function isRequired(field: FormField): boolean {
    if (field.validations?.required === true) {
        return true;
    }
    return field.type === "checkboxes"
        && Boolean(field.attributes?.options?.some((option) => option.required === true));
}

/** 验证 Issue Form 的标签引用、字段 ID、必填字段和隐私确认。 */
async function validateForm(contract: FormContract, labelNames: Set<string>): Promise<void> {
    const form = await readYaml<IssueForm>(contract.path);
    ensure(Boolean(form.name) && Boolean(form.description), `${contract.path} 缺少 name 或 description`);
    ensure(form.labels.filter((label) => label.startsWith("type: ")).length === 1, `${contract.path} 必须恰好引用一个 type:* 标签`);
    ensure(form.labels.filter((label) => label.startsWith("status: ")).length === 1, `${contract.path} 必须恰好引用一个 status:* 标签`);
    ensure(form.labels.includes(contract.typeLabel), `${contract.path} 缺少 ${contract.typeLabel}`);
    ensure(form.labels.includes("status: needs-triage"), `${contract.path} 缺少 status: needs-triage`);
    for (const label of contract.requiredLabels ?? []) {
        ensure(form.labels.includes(label), `${contract.path} 缺少 ${label}`);
    }

    for (const label of form.labels) {
        ensure(labelNames.has(label), `${contract.path} 引用了未登记标签: ${label}`);
    }

    const ids = new Set<string>();
    for (const field of form.body) {
        if (!field.id) {
            continue;
        }
        ensure(!ids.has(field.id), `${contract.path} 字段 ID 重复: ${field.id}`);
        ids.add(field.id);
    }

    for (const id of contract.requiredIds) {
        const field = form.body.find((candidate) => candidate.id === id);
        ensure(Boolean(field), `${contract.path} 缺少字段: ${id}`);
        ensure(isRequired(field!), `${contract.path} 字段必须为必填: ${id}`);
    }

    const privacy = form.body.find((field) => field.id === "privacy-confirmation");
    ensure(privacy?.type === "checkboxes", `${contract.path} 隐私确认必须使用 checkboxes`);
    ensure(Boolean(privacy.attributes?.label?.includes("隐私")), `${contract.path} 隐私确认缺少中文标识`);
    ensure(Boolean(privacy.attributes?.label?.includes("Privacy")), `${contract.path} 隐私确认缺少英文标识`);
}

/** 验证 Issue Form 文件集合与文件名排序合同完全一致。 */
async function validateFormFiles(): Promise<void> {
    const actual = (await readdir(resolve(root, ".github/ISSUE_TEMPLATE")))
        .filter((name) => name.endsWith(".yml") && name !== "config.yml")
        .sort();
    const expected = formContracts.map((contract) => basename(contract.path));

    ensure(
        JSON.stringify(actual) === JSON.stringify(expected),
        `Issue Form 文件或排序不一致：期望 ${expected.join(", ")}，实际 ${actual.join(", ")}`,
    );
}

/** 验证指定短语在文档中存在并保持给定顺序。 */
function ensurePhraseOrder(text: string, phrases: readonly string[], label: string): void {
    let previousIndex = -1;
    for (const phrase of phrases) {
        const index = text.indexOf(phrase);
        ensure(index > previousIndex, `${label} 缺少短语或顺序错误: ${phrase}`);
        previousIndex = index;
    }
}

/** 验证中英文贡献指南保持相同章节、入口与分流合同。 */
async function validateGuides(): Promise<void> {
    const chinese = await readRepoFile("CONTRIBUTING.md");
    const english = await readRepoFile("CONTRIBUTING.en.md");
    ensure(chinese.includes("[English](CONTRIBUTING.en.md)"), "中文贡献指南必须链接英文镜像");
    ensure(english.includes("[中文](CONTRIBUTING.md)"), "英文贡献指南必须链接中文主入口");

    const chineseHeadings = chinese.match(/^## .+$/gm) ?? [];
    const englishHeadings = english.match(/^## .+$/gm) ?? [];
    const expectedChineseHeadings = [
        "## 开始之前",
        "## 本地开发",
        "## 找到正确规范",
        "## Issue 与实现授权",
        "## 准备变更",
        "## Pull Request",
        "## Review 与合并",
        "## 许可证",
    ];
    const expectedEnglishHeadings = [
        "## Before You Start",
        "## Local Development",
        "## Find the Right Specification",
        "## Issues and Implementation Authorization",
        "## Prepare a Change",
        "## Pull Request",
        "## Review and Merge",
        "## License",
    ];
    ensure(JSON.stringify(chineseHeadings) === JSON.stringify(expectedChineseHeadings), `中文贡献指南二级章节不匹配：${chineseHeadings.join(", ")}`);
    ensure(JSON.stringify(englishHeadings) === JSON.stringify(expectedEnglishHeadings), `英文贡献指南二级章节不匹配：${englishHeadings.join(", ")}`);
    for (const phrase of [
        "needs-triage",
        "needs-info",
        "needs-design",
        "status: ready",
        "status: blocked",
        "help wanted",
        "good first issue",
    ]) {
        ensure(chinese.includes(phrase), `中文贡献指南缺少分流合同: ${phrase}`);
        ensure(english.includes(phrase), `英文贡献指南缺少分流合同: ${phrase}`);
    }

    ensurePhraseOrder(chinese, [
        "错误报告",
        "功能建议",
        "提示词与内置 Agent 资产",
        "使用与安装问题",
        "其它问题",
    ], "中文贡献指南 Issue 入口");
    ensurePhraseOrder(english, [
        "Bug report",
        "Feature request",
        "Prompts and built-in Agent assets",
        "Usage and installation question",
        "Other issue",
    ], "英文贡献指南 Issue 入口");
    ensure(chinese.includes("提示词表单还会添加 `area: agent`"), "中文贡献指南缺少提示词表单 area: agent 例外");
    ensure(english.includes("The prompt form also adds `area: agent`"), "英文贡献指南缺少提示词表单 area: agent 例外");
    ensure(chinese.includes("不要借此绕过安全报告"), "中文贡献指南缺少其它问题的安全边界");
    ensure(english.includes("not a way to bypass private security reporting"), "英文贡献指南缺少其它问题的安全边界");
}

/** 验证公开 Issue 配置、PR 模板和安全政策的关键入口。 */
async function validatePublicTemplates(): Promise<void> {
    const config = await readYaml<IssueTemplateConfig>(".github/ISSUE_TEMPLATE/config.yml");
    ensure(config.blank_issues_enabled === false, "Issue 配置必须禁止空白 Issue");
    ensure((config.contact_links ?? []).length === 0, "Issue chooser 不得配置 contact link；安全报告使用 GitHub 原生入口");

    const pullRequest = await readRepoFile(".github/PULL_REQUEST_TEMPLATE.md");
    for (const heading of [
        "## 关联 Issue / Related issue",
        "## 本次范围 / Scope",
        "## 验证 / Verification",
        "## 文档与记录 / Documentation and records",
        "## 风险与边界 / Risks and boundaries",
        "## 提交者确认 / Contributor confirmation",
    ]) {
        ensure(pullRequest.includes(heading), `PR 模板缺少章节: ${heading}`);
    }
    ensure(pullRequest.includes("无 / None"), "PR 模板必须允许轻量文档修正不关联 Issue");

    const security = await readRepoFile(".github/SECURITY.md");
    ensure(security.includes("Private Vulnerability Reporting"), "安全政策必须说明私密漏洞报告");
    ensure(security.includes("/security/advisories/new"), "安全政策必须链接私密漏洞报告入口");
}

/** 取得工作流 job 的 run 命令列表。 */
function jobCommands(job: WorkflowJob | undefined, label: string): readonly string[] {
    ensure(Boolean(job), `工作流缺少 job: ${label}`);
    ensure(Array.isArray(job!.steps), `工作流 job 缺少 steps: ${label}`);
    return job!.steps!.flatMap((step) => step.run ? [step.run] : []);
}

/** 验证 job 在执行命令前按固定顺序准备 Node 24 与 Bun。 */
function ensureRuntimeSetup(job: WorkflowJob | undefined, label: string): void {
    const steps = job?.steps;
    ensure(Array.isArray(steps), `工作流 job 缺少 steps: ${label}`);
    const checkoutIndex = steps.findIndex((step) => step.uses === "actions/checkout@v5");
    const nodeIndex = steps.findIndex((step) => step.uses === "actions/setup-node@v5");
    const bunIndex = steps.findIndex((step) => step.uses === "oven-sh/setup-bun@v2");
    const firstCommandIndex = steps.findIndex((step) => Boolean(step.run));

    ensure(checkoutIndex >= 0, `${label} 缺少 actions/checkout@v5`);
    ensure(nodeIndex > checkoutIndex, `${label} 必须在 checkout 后设置 Node`);
    ensure(bunIndex > nodeIndex, `${label} 必须在 Node 后设置 Bun`);
    ensure(firstCommandIndex > bunIndex, `${label} 必须在运行命令前完成 Node/Bun 设置`);
    ensure(String(steps[nodeIndex]?.with?.["node-version"]) === "24", `${label} 必须使用 Node 24`);
}

/** 判断两个 paths 列表是否为完全相同的集合。 */
function haveSamePaths(left: readonly string[], right: readonly string[]): boolean {
    const leftSorted = [...left].sort();
    const rightSorted = [...right].sort();
    return leftSorted.length === rightSorted.length
        && leftSorted.every((path, index) => path === rightSorted[index]);
}

/** 验证若干命令存在并保持给定顺序。 */
function ensureCommandOrder(commands: readonly string[], expected: readonly string[], label: string): void {
    let previousIndex = -1;
    for (const command of expected) {
        const index = commands.indexOf(command);
        ensure(index > previousIndex, `${label} 缺少命令或顺序错误: ${command}`);
        previousIndex = index;
    }
}

/** 验证社区、文档部署、代码基线与 workspace 包工作流的稳定合同。 */
async function validateWorkflows(): Promise<void> {
    const community = await readYaml<WorkflowConfig>(".github/workflows/community-docs.yml");
    ensure(community.permissions.contents === "read", "Community workflow 必须保持 contents: read");
    ensure(Object.keys(community.permissions).length === 1, "Community workflow 不得获得写权限");
    const communityPush = community.on.push;
    const communityPullRequest = community.on.pull_request;
    ensure(communityPush?.branches?.includes("master") === true, "Community workflow 必须监听 master push");
    const communityPushPaths = communityPush?.paths ?? [];
    const communityPullRequestPaths = communityPullRequest?.paths ?? [];
    ensure(haveSamePaths(communityPushPaths, communityPullRequestPaths), "Community workflow 的 push 与 PR paths 必须完全一致");
    for (const path of [...docsRuntimePaths, ...communityOnlyPaths]) {
        ensure(communityPushPaths.includes(path), `Community workflow 缺少运行时 path: ${path}`);
    }
    const communityJob = community.jobs["community-docs"];
    ensure(communityJob?.["timeout-minutes"] === 15, "Community workflow 超时必须为 15 分钟");
    ensureRuntimeSetup(communityJob, "Community workflow");
    ensureCommandOrder(jobCommands(communityJob, "community-docs"), [
        "bun install --frozen-lockfile",
        nitroPatchTestCommand,
        "bun run --cwd packages/neuro-book nuxt:prepare",
        "bun scripts/ci/validate-community-files.ts",
        documentationCheckCommand,
        "bun run docs:build",
    ], "Community workflow");

    const deployDocs = await readYaml<WorkflowConfig>(".github/workflows/deploy-docs.yml");
    ensure(deployDocs.permissions.contents === "read", "Deploy Docs 必须保持 contents: read");
    ensure(deployDocs.permissions.pages === "write", "Deploy Docs 必须声明 pages: write");
    ensure(deployDocs.permissions["id-token"] === "write", "Deploy Docs 必须声明 id-token: write");
    ensure(deployDocs.on.push?.branches?.includes("master") === true, "Deploy Docs 必须监听 master push");
    const deployPaths = deployDocs.on.push?.paths ?? [];
    for (const path of docsRuntimePaths) {
        ensure(deployPaths.includes(path), `Deploy Docs 缺少运行时 path: ${path}`);
    }
    const deployBuild = deployDocs.jobs.build;
    ensure(deployBuild?.["timeout-minutes"] === 15, "Deploy Docs build 超时必须为 15 分钟");
    ensure(deployDocs.jobs.deploy?.["timeout-minutes"] === 10, "Deploy Docs deploy 超时必须为 10 分钟");
    ensureRuntimeSetup(deployBuild, "Deploy Docs build");
    ensureCommandOrder(jobCommands(deployBuild, "deploy-docs/build"), [
        "bun install --frozen-lockfile",
        nitroPatchTestCommand,
        "bun run --cwd packages/neuro-book nuxt:prepare",
        documentationCheckCommand,
        "bun run docs:build",
    ], "Deploy Docs");

    const baseline = await readYaml<WorkflowConfig>(".github/workflows/code-baseline.yml");
    ensure(baseline.name === "Code Baseline", "Code Baseline 不得保留 Advisory 标记");
    ensure(baseline.permissions.contents === "read", "Code Baseline 必须保持 contents: read");
    ensure(Object.keys(baseline.permissions).length === 1, "Code Baseline 不得获得写权限");
    const paths = baseline.on.pull_request?.paths ?? [];
    for (const path of codeBaselinePaths) {
        ensure(paths.includes(path), `Code Baseline 缺少 paths 合同: ${path}`);
    }
    const governance = baseline.jobs.governance;
    const typecheck = baseline.jobs.typecheck;
    const test = baseline.jobs.test;
    ensure(governance?.name?.toLocaleLowerCase("en-US").includes("advisory") !== true, "Governance job 不得标记 advisory");
    ensure(typecheck?.name?.toLocaleLowerCase("en-US").includes("advisory") !== true, "Typecheck job 不得标记 advisory");
    ensure(test?.name?.toLocaleLowerCase("en-US").includes("advisory") !== true, "Test job 不得标记 advisory");
    ensure(typecheck?.["timeout-minutes"] === 15, "Typecheck 超时必须为 15 分钟");
    ensure(test?.["timeout-minutes"] === 30, "Full tests 超时必须为 30 分钟");
    ensureRuntimeSetup(typecheck, "Code Baseline typecheck");
    ensureRuntimeSetup(test, "Code Baseline test");
    ensureRuntimeSetup(governance, "Code Baseline governance");
    const governanceCommands = jobCommands(governance, "code-baseline/governance");
    ensure(governance?.["timeout-minutes"] === 15, "Governance 超时必须为 15 分钟");
    for (const command of ["bun run governance:check", "bun x tsc --noEmit -p scripts/tsconfig.json", "scripts/ci/workspace-workflows.test.ts", "scripts/build/dockerfile-contract.test.ts"]) {
        ensure(governanceCommands.some((actual) => actual.includes(command)), `Code Baseline governance 缺少命令：${command}`);
    }
    ensure(jobCommands(typecheck, "code-baseline/typecheck").includes("bun run --cwd packages/neuro-book typecheck"), "缺少应用 typecheck 命令");
    ensure(jobCommands(test, "code-baseline/test").includes("bun run --cwd packages/neuro-book test -- --reporter=dot"), "缺少应用全量测试命令");
    const changesJob = baseline.jobs.changes;
    ensure(Boolean(changesJob?.steps?.length), "Code Baseline 缺少 changes 变更作用域 job");
    ensure(changesJob?.steps?.some((step) => step.uses === "actions/checkout@v5" && step.with?.["fetch-depth"] === 0), "changes job 必须全量 checkout 以计算 merge-base");
    ensure(changesJob?.steps?.some((step) => step.uses === "oven-sh/setup-bun@v2"), "changes job 必须安装 Bun");
    ensure(typecheck?.needs === "changes" && typecheck?.if === "needs.changes.outputs.typecheck == 'true'", "Typecheck 必须按变更作用域条件执行");
    ensure(test?.needs === "changes" && test?.if === "needs.changes.outputs.tests == 'true'", "Full tests 必须按变更作用域条件执行");
    ensure(governance?.if === undefined, "Governance 必须无条件运行");

    const workspace = await readYaml<WorkflowConfig>(".github/workflows/workspace-packages.yml");
    ensure(workspace.permissions.contents === "read", "Workspace Packages 必须保持 contents: read");
    ensure(Object.keys(workspace.permissions).length === 1, "Workspace Packages 不得获得写权限");
    const packageJob = workspace.jobs.package;
    ensure(packageJob?.strategy?.["fail-fast"] === false, "Workspace package matrix 必须独立报告全部包结果");
    ensure(packageJob?.needs === "select-packages", "Workspace package matrix 必须由 select-packages 选择");
    ensure(workspace.on?.pull_request?.paths?.includes("bunfig.toml") === true, "Workspace Packages 必须监听 bunfig.toml 变更");
    ensure(packageJob?.strategy?.matrix === "${{ fromJSON(needs.select-packages.outputs.matrix) }}", "Workspace package matrix 必须消费动态选择输出");
    const selectJob = workspace.jobs["select-packages"];
    ensure(selectJob?.steps?.some((step) => step.id === "select"), "Workspace 缺少包选择步骤");
    ensure(selectJob?.steps?.some((step) => step.uses === "actions/checkout@v5" && step.with?.["fetch-depth"] === 0), "包选择必须全量 checkout 以计算 merge-base");
    ensure(workspace.jobs["llmlint-web"]?.if === "needs.select-packages.outputs.run_web_island == 'true'", "llmlint Web island 必须按选择结果条件运行");
    const packageStep = packageJob?.steps?.find((step) => step.name === "Run package checks");
    ensure(packageStep?.["working-directory"] === "${{ matrix.directory }}", "Workspace package checks 必须在包 owner cwd 执行");
    ensure(packageStep?.run === "${{ matrix.commands }}", "Workspace package checks 必须执行 matrix commands");
    const webJob = workspace.jobs["llmlint-web"];
    const webSteps = webJob?.steps ?? [];
    for (const command of ["bun install --frozen-lockfile", "bun run typecheck", "bun run typecheck:server", "bun run build"]) {
        ensure(webSteps.some((step) => step["working-directory"] === "packages/llmlint/web" && step.run === command), `llmlint Web island 缺少 owner cwd 命令: ${command}`);
    }
    ensure(webSteps.some((step) => step.uses === "actions/upload-artifact@v4" && step.with?.path === "packages/llmlint/web/.output"), "llmlint Web island 缺少构建产物上传");
}
/** 解析所有新增 YAML，提前发现 GitHub 无法读取的配置。 */
async function validateYaml(): Promise<void> {
    for (const path of yamlPaths) {
        await readYaml<object>(path);
    }
}

/** 执行贡献体系静态合同校验。 */
async function main(): Promise<void> {
    await validateYaml();
    await validateFormFiles();
    const labelNames = await validateLabels();
    for (const contract of formContracts) {
        await validateForm(contract, labelNames);
    }
    await validateGuides();
    await validatePublicTemplates();
    await validateWorkflows();
    console.log(`贡献体系校验通过：${labelNames.size} 个标签、${formContracts.length} 个 Issue Form、${yamlPaths.length} 个 YAML。`);
}

await main();
