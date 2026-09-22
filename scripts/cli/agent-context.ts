#!/usr/bin/env bun
import {existsSync, readFileSync} from "node:fs";
import {resolve} from "node:path";
import {
    defaultRepoRoot,
    git,
    gitBranch,
    gitRevision,
    governanceRoots,
    resolveWorkReadmePath,
    resolveWorkTaskReadmePath,
} from "#scripts/ci/agent-governance-contract";

type ContextFlags = {repoRoot?: string; work?: string; task?: string};
const flagKeys: Record<string, keyof ContextFlags> = {
    "--repo-root": "repoRoot",
    "--work": "work",
    "--task": "task",
};

const failures: string[] = [];
const flags: ContextFlags = {};
const args = process.argv.slice(2);
let argumentIndex = 0;
while (argumentIndex < args.length) {
    const flag = args[argumentIndex];
    if (flag === "--") {
        argumentIndex += 1;
        continue;
    }
    const flagKey = Object.hasOwn(flagKeys, flag) ? flagKeys[flag] : undefined;
    if (!flagKey) {
        failures.push(`未知参数：${flag}`);
        argumentIndex += 1;
        continue;
    }
    const value = args[argumentIndex + 1];
    const hasValue = value !== undefined && !value.startsWith("-");
    if (Object.hasOwn(flags, flagKey)) failures.push(`参数重复：${flag}`);
    else if (!hasValue) failures.push(`参数缺少值：${flag}`);
    else flags[flagKey] = value;
    argumentIndex += hasValue ? 2 : 1;
}

if (failures.length === 0 && flags.task && !flags.work) failures.push(`Task 必须同时指定 Work：${flags.task}`);

const repoRoot = resolve(flags.repoRoot ?? defaultRepoRoot(import.meta.url));
let workReadme: string | null = null;
let taskReadme: string | null = null;
if (failures.length === 0) {
    if (flags.work && flags.task) {
        const resolution = resolveWorkTaskReadmePath(repoRoot, flags.work, flags.task);
        workReadme = resolution.workPath;
        taskReadme = resolution.taskPath;
        failures.push(...resolution.failures);
    } else if (flags.work) {
        const resolution = resolveWorkReadmePath(repoRoot, flags.work);
        workReadme = resolution.path;
        failures.push(...resolution.failures);
    }
}

const statusText = existsSync(resolve(repoRoot, "PROJECT-STATUS.md"))
    ? readFileSync(resolve(repoRoot, "PROJECT-STATUS.md"), "utf8")
    : "";
const statusLine = statusText.split(/\r?\n/u).find((line) => line.startsWith("NeuroBook 当前处于"))
    ?? statusText.split(/\r?\n/u).find((line) => line.startsWith(">"))
    ?? "PROJECT-STATUS.md 未提供一句话结论";
const report = {
    schema: "nbook.governance-context/v2",
    repoRoot,
    revision: gitRevision(repoRoot),
    branch: gitBranch(repoRoot),
    worktree: git(repoRoot, ["rev-parse", "--show-toplevel"]),
    work: flags.work ?? null,
    workReadme,
    task: flags.task ?? null,
    taskReadme,
    status: statusLine.replace(/^>\s*/u, "").trim(),
    roots: governanceRoots(repoRoot),
    trackedChanges: git(repoRoot, ["status", "--short"]),
    failures,
};
console.log(JSON.stringify(report, null, 2));
if (failures.length > 0) process.exitCode = 1;
