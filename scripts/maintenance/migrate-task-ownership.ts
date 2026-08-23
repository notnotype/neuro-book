#!/usr/bin/env bun
import {randomBytes} from "node:crypto";
import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {relative, resolve, sep} from "node:path";

import {resolveAgentRunRoot} from "@notnotype/neuro-book-test-support/paths";
import {APPLICATION_TASK_OWNER_ROOT, ROOT_TASK_OWNER_ROOT, canonicalSha256, defaultRepoRoot, git, gitRevision, readGitTextAttributes, type TaskOwnershipManifest} from "#scripts/ci/agent-governance-contract";

type Mapping = {
    source: string;
    destination: string;
    sourceSha256: string;
    destinationSha256: string;
    kind: "file";
    linkRewrite: boolean;
};

type LegacyIndex = {
    schema: string;
    sourceRevision: string;
    fileCount: number;
    manifestSha256: string;
    mappings: Mapping[];
    localOnlyFiles: string[];
};

type MovePlan = {taskId: string; from: string; to: string};
type Finding = {path: string; reason: string};

const APPLICATION_TASK_IDS = [
    "01-agent-roleplay-mode", "02-pi-agent-harness-migration", "03-config-system", "04-tsx-profile-workbench",
    "05-leader-profile-v2-adaptation", "06-leader-default-prompt-parity", "07-agent-turn-commit-boundary", "08-sqlite-first-database",
    "10-agent-variable-system", "11-portable-project-workspace", "12-profile-variable-types", "14-agent-sse-front-end-contract",
    "17-session-title-summary-enhancement", "18-agent-runtime-pipeline-hooks", "21-project-workspace-index-watcher", "22-agent-public-event-projection",
    "23-agent-sidecar-profile-pass", "24-agent-sse-reload-recovery", "28-lorebook-information-control-protocol", "31-novel-writing-workflow-emulation",
    "32-novel-workflow-emulation-implementation", "36-agent-prompt-engineering-simulation-director", "42-simulation-rollback-mechanism", "43-subject-rag-memory",
    "47-agent-profile-tool-bindings", "48-agent-tool-definition-layer", "49-agent-session-tree-ui", "53-agent-initial-payload-schema", "55-inline-editor-agent",
    "56-world-engine", "58-agent-profile-settings-low-code", "59-world-engine-workbench-redesign", "60-agent-profile-home", "61-world-engine-workbench-real-api",
    "62-harness-contract-sse-recovery-fixes", "63-tool-approval-policy-system", "64-world-engine-prompt-engineering", "65-world-engine-calendar-enhancement",
    "67-world-engine-zod-schema-codeact", "68-global-profile-home-resource-preset", "69-world-engine-tool-cleanup", "71-world-engine-codeact-readwrite",
    "72-error-report-logs", "73-agent-session-list-performance-pagination", "74-agent-command-performance", "75-world-engine-api-calendar-embedding-cleanup",
    "76-world-engine-issue-contract", "78-plot-scene-world-engine-bridge", "79-profile-build-system", "81-profile-mcp-config", "83-project-list-performance",
    "85-fullstack-template-ui-library", "86-pi-request-observability", "87-plot-two-trees-and-writer-modes", "89-theme-system-v2", "90-agent-mode-system",
    "91-operation-log-file-history", "92-project-resource-lifecycle", "93-plot-planning-layer", "94-project-lifecycle-model", "96-session-title-summarizer",
    "97-plot-tool-surface-redesign", "98-leader-assets-profile-reshape", "99-plot-planning-ui", "101-markdown-studio-dialect-and-performance",
    "102-agent-change-inbox-and-prompt-order", "104-pi-models-runtime-upgrade", "106-agent-chat-flow-pagination", "107-agent-event-memory-boundaries",
    "108-agent-image-attachment-references", "109-agent-workspace-path-runtime", "111-workflow-agent-integration", "116-agent-workflow-reliability",
    "118-project-catalog-snapshot-path-integration", "120-agent-skill-package-contract", "121-novel-skill-reorg", "122-writing-pipeline-batch2",
    "124-writing-pipeline-batch3", "125-runtime-artifact-storage-lifecycle", "126-agent-context-inspector", "129-project-picker-and-session-entry",
    "132-shared-image-variants-project-covers", "133-book-import-and-style-distill", "134-agent-profile-settings-navigation", "135-agent-asset-install-protocol",
    "136-one-shot-model-providers", "137-agent-ui-approval-workflow-bubble", "138-agent-conversation-branch-projection", "139-agent-abort-error-projection",
    "147-agent-context-compaction-reliability", "148-provider-details-transition",
] as const;

const ROOT_TASK_IDS = [
    "00149-monorepo-workspace-consolidation", "26-windows-portable-packaging", "51-anti-ai-slop-skill", "66-codebase-cleanup",
    "77-llmlint-rule-registry", "82-llmlint-eval-harness", "84-llmlint-standalone-repo", "88-workshop-platform", "95-nb-history-integration",
    "100-deployment-auth-and-source-carry", "103-agpl-license-migration", "105-unified-installation-manager", "110-agent-workflow-orchestration",
    "112-passport-official-site", "113-memory-system", "114-file-snapshot-cache-package", "115-workspace-root-agent-path-contract", "117-windows-process-tree-lifecycle",
    "119-workshop-account-admin", "123-repo-structure-optimization", "125-docs-site-overhaul", "127-nightly-audit", "128-neuro-book-site-deployment",
    "130-desktop-application-foundation", "131-github-contribution-system", "133-style-eval", "140-pr-review-and-release-gates", "141-merged-pr-browser-acceptance",
    "142-post-merge-reliability-hardening", "143-desktop-envelope-installation-spike", "144-electron-desktop-polish", "145-electron-desktop-productization", "146-nb-ui-shadcn-vue-refactor",
] as const;

const args = process.argv.slice(2);
const repoArgument = args.indexOf("--repo-root");
const repoRoot = resolve(repoArgument >= 0 ? args[repoArgument + 1] ?? "" : defaultRepoRoot(import.meta.url));
const apply = args.includes("--apply");
const runRoot = resolveAgentRunRoot("task-ownership-migration", randomBytes(4).toString("hex"));
const indexPath = resolve(repoRoot, ".agents", "tasks", "legacy-index.json");
const ownershipPath = resolve(repoRoot, ".agents", "tasks", "ownership.json");
const blockers: Finding[] = [];
const warnings: Finding[] = [];


function relativeTaskPath(mapping: Mapping): string {
    const prefix = ".agents/tasks/";
    if (!mapping.destination.startsWith(prefix)) throw new Error(`legacy destination 不在 .agents/tasks：${mapping.destination}`);
    return mapping.destination.slice(prefix.length);
}

function taskIdOf(mapping: Mapping): string {
    return relativeTaskPath(mapping).split("/")[0] ?? "";
}

function taskRoot(ownerRoot: string, taskId: string): string {
    return `${ownerRoot}/${taskId}`;
}

function directTaskDirectories(ownerRoot: string): string[] {
    const absolute = resolve(repoRoot, ownerRoot);
    if (!existsSync(absolute)) return [];
    return readdirSync(absolute, {withFileTypes: true}).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

function addSetDifference(actual: readonly string[], expected: readonly string[], label: string): void {
    const expectedSet = new Set(expected);
    const actualSet = new Set(actual);
    for (const name of actual) if (!expectedSet.has(name)) blockers.push({path: `${label}/${name}`, reason: "不在批准 Task 目录清单"});
    for (const name of expected) if (!actualSet.has(name)) blockers.push({path: `${label}/${name}`, reason: "缺少批准 Task 目录"});
}

function buildOwnership(index: LegacyIndex): TaskOwnershipManifest {
    const appSet = new Set<string>(APPLICATION_TASK_IDS);
    const tasks = new Map<string, {taskId: string; ownerRoot: string; files: {path: string; legacyDestination: string; sha256: string}[]}>();
    for (const mapping of index.mappings) {
        const taskId = taskIdOf(mapping);
        if (!appSet.has(taskId)) continue;
        const relativePath = relativeTaskPath(mapping);
        const entry = tasks.get(taskId) ?? {taskId, ownerRoot: APPLICATION_TASK_OWNER_ROOT, files: []};
        entry.files.push({path: relativePath, legacyDestination: mapping.destination, sha256: mapping.destinationSha256});
        tasks.set(taskId, entry);
    }
    const orderedTasks = [...tasks.values()].sort((left, right) => left.taskId.localeCompare(right.taskId));
    for (const task of orderedTasks) task.files.sort((left, right) => left.path.localeCompare(right.path));
    return {
        schema: "nbook.task-ownership/v1",
        ownerRoot: APPLICATION_TASK_OWNER_ROOT,
        taskCount: orderedTasks.length,
        fileCount: orderedTasks.reduce((count, task) => count + task.files.length, 0),
        tasks: orderedTasks,
    };
}

function inspectTaskFiles(index: LegacyIndex, ownership: TaskOwnershipManifest, textAttributes: ReadonlyMap<string, string>): void {
    const appSet = new Set<string>(APPLICATION_TASK_IDS);
    const ownershipByPath = new Map(ownership.tasks.flatMap((task) => task.files.map((file) => [file.legacyDestination, file] as const)));
    for (const mapping of index.mappings) {
        if (index.localOnlyFiles.includes(mapping.source)) continue;
        const taskId = taskIdOf(mapping);
        const ownerRoot = appSet.has(taskId) ? APPLICATION_TASK_OWNER_ROOT : ROOT_TASK_OWNER_ROOT;
        const relativePath = relativeTaskPath(mapping);
        const desired = `${ownerRoot}/${relativePath}`;
        const alternate = `${ownerRoot === APPLICATION_TASK_OWNER_ROOT ? ROOT_TASK_OWNER_ROOT : APPLICATION_TASK_OWNER_ROOT}/${relativePath}`;
        const desiredAbsolute = resolve(repoRoot, desired);
        const alternateAbsolute = resolve(repoRoot, alternate);
        const actualPath = existsSync(desiredAbsolute) ? desiredAbsolute : existsSync(alternateAbsolute) ? alternateAbsolute : null;
        if (!actualPath) {
            blockers.push({path: desired, reason: "Task 文件在双 root 均不存在"});
            continue;
        }
        if (existsSync(desiredAbsolute) && existsSync(alternateAbsolute)) blockers.push({path: desired, reason: "Task 文件在双 root 重复存在"});
        const actualRelativePath = relative(repoRoot, actualPath).replaceAll(sep, "/");
        if (canonicalSha256(readFileSync(actualPath), textAttributes.get(actualRelativePath) ?? "unspecified") !== mapping.destinationSha256) {
            blockers.push({path: actualPath, reason: "当前 canonical bytes 不等于 legacy destination SHA-256"});
        }
        if (appSet.has(taskId) && !ownershipByPath.has(mapping.destination)) blockers.push({path: mapping.destination, reason: "应用 Task 未登记 ownership 文件"});
    }
}

function collectExternalTaskLinks(): void {
    for (const relativePath of git(repoRoot, ["ls-files"]).split(/\r?\n/u).filter((path) => path.endsWith(".md") && !path.startsWith("docs/tasks/") && !path.startsWith(".agents/tasks/") && !path.includes("/.agents/tasks/"))) {
        const absolutePath = resolve(repoRoot, relativePath);
        if (!existsSync(absolutePath)) continue;
        const text = readFileSync(absolutePath, "utf8");
        if (text.includes("docs/tasks/")) warnings.push({path: relativePath, reason: "活跃 Markdown 仍包含旧 docs/tasks/ 链接，需单独切换"});
    }
}

function applyMoves(moves: readonly MovePlan[]): void {
    for (const move of moves) git(repoRoot, ["mv", move.from, move.to]);
}

function main(): void {
    mkdirSync(runRoot, {recursive: true});
    const index = JSON.parse(readFileSync(indexPath, "utf8")) as Partial<LegacyIndex>;
    if (index.schema !== "nbook.task-migration-index/v1") blockers.push({path: ".agents/tasks/legacy-index.json", reason: "schema 不匹配"});
    if (!Array.isArray(index.mappings)) blockers.push({path: ".agents/tasks/legacy-index.json", reason: "mappings 不是数组"});
    if (!Array.isArray(index.localOnlyFiles)) blockers.push({path: ".agents/tasks/legacy-index.json", reason: "localOnlyFiles 不是数组"});
    if (blockers.length > 0) {
        writeReport(null, [], "blocked");
        process.exitCode = 1;
        return;
    }
    const validIndex = index as LegacyIndex;
    const ownership = buildOwnership(validIndex);
    if (ownership.taskCount !== APPLICATION_TASK_IDS.length) blockers.push({path: ownershipPath, reason: `应用 Task 数量错误：${ownership.taskCount} != ${APPLICATION_TASK_IDS.length}`});
    if (ownership.fileCount !== 855) blockers.push({path: ownershipPath, reason: `应用 Task 文件数量错误：${ownership.fileCount} != 855`});
    addSetDifference(directTaskDirectories(APPLICATION_TASK_OWNER_ROOT), APPLICATION_TASK_IDS, APPLICATION_TASK_OWNER_ROOT);
    const rootDirectories = new Set(directTaskDirectories(ROOT_TASK_OWNER_ROOT));
    for (const taskId of ROOT_TASK_IDS) if (!rootDirectories.has(taskId)) blockers.push({path: `${ROOT_TASK_OWNER_ROOT}/${taskId}`, reason: "缺少批准根 Task 目录"});
    for (const taskId of APPLICATION_TASK_IDS) if (rootDirectories.has(taskId)) blockers.push({path: `${ROOT_TASK_OWNER_ROOT}/${taskId}`, reason: "批准应用 Task 错放在根 root"});
    const moves: MovePlan[] = [];
    for (const taskId of APPLICATION_TASK_IDS) {
        const from = taskRoot(ROOT_TASK_OWNER_ROOT, taskId);
        const to = taskRoot(APPLICATION_TASK_OWNER_ROOT, taskId);
        if (existsSync(resolve(repoRoot, from)) && !existsSync(resolve(repoRoot, to))) moves.push({taskId, from, to});
    }
    for (const taskId of ROOT_TASK_IDS) {
        const from = taskRoot(APPLICATION_TASK_OWNER_ROOT, taskId);
        const to = taskRoot(ROOT_TASK_OWNER_ROOT, taskId);
        if (existsSync(resolve(repoRoot, from)) && !existsSync(resolve(repoRoot, to))) moves.push({taskId, from, to});
    }
    const canonicalPaths = validIndex.mappings.flatMap((mapping) => {
        if (validIndex.localOnlyFiles.includes(mapping.source)) return [];
        const taskId = taskIdOf(mapping);
        const ownerRoot = APPLICATION_TASK_IDS.includes(taskId as typeof APPLICATION_TASK_IDS[number]) ? APPLICATION_TASK_OWNER_ROOT : ROOT_TASK_OWNER_ROOT;
        return [`${ownerRoot}/${relativeTaskPath(mapping)}`];
    });
    const textAttributes = readGitTextAttributes(repoRoot, canonicalPaths);
    inspectTaskFiles(validIndex, ownership, textAttributes);
    collectExternalTaskLinks();
    const report = {
        schema: "nbook.task-ownership-migration-report/v1",
        mode: apply ? "apply" : "dry-run",
        repoRoot,
        revision: gitRevision(repoRoot),
        runRoot,
        ownershipPath: ".agents/tasks/ownership.json",
        taskCount: ownership.taskCount,
        fileCount: ownership.fileCount,
        moves,
        blockers,
        warnings,
    };
    writeFileSync(resolve(runRoot, "ownership-draft.json"), `${JSON.stringify(ownership, null, 2)}\n`, "utf8");
    if (apply && blockers.length === 0) {
        applyMoves(moves);
        writeFileSync(ownershipPath, `${JSON.stringify(ownership, null, 2)}\n`, "utf8");
        (report as {mode: string}).mode = "applied";
    }
    writeReport(report, moves, apply && blockers.length === 0 ? "applied" : "dry-run");
    if (blockers.length > 0) process.exitCode = 1;
}

function writeReport(report: Record<string, unknown> | null, moves: readonly MovePlan[], mode: string): void {
    const output = report ?? {schema: "nbook.task-ownership-migration-report/v1", mode, repoRoot, runRoot, moves, blockers, warnings};
    writeFileSync(resolve(runRoot, "migration-report.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(output, null, 2));
}

main();
