#!/usr/bin/env bun
import {spawnSync} from "node:child_process";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync} from "node:fs";
import {join, resolve} from "node:path";

import {resolveAgentScratchPath} from "@notnotype/neuro-book-test-support/paths";

import {changedFiles, readChangeScopeArguments} from "#scripts/ci/change-scope";
import {expandConsumerClosure, workspaceDependencyGraph} from "#scripts/ci/workspace-package-matrix";

export type WorkspacePackageInfo = {
    /** 包目录名，例如 `nb-ui`。 */
    directory: string;
    scripts: Readonly<Record<string, string>>;
};

/** 测试类别与对应的包脚本，见 docs/testing/README.md 的“测试分类与运行”。 */
export type TestTier = "fast" | "e2e" | "llm";
export const TIER_SCRIPTS: Readonly<Record<TestTier, string>> = {fast: "test", e2e: "test:e2e", llm: "test:llm"};

export type AffectedTarget = {
    /** 包目录名；根脚本测试为 `scripts`。 */
    name: string;
    /** 运行命令的目录，相对仓库根。 */
    cwd: string;
    commands: string[][];
    reason: string;
    /** 测试脚本是单条 `bun test`，可以在命令后追加 Bun 测试器参数。 */
    bunTest: boolean;
};

export type AffectedSelection = {
    targets: AffectedTarget[];
    skipped: {name: string; reason: string}[];
};

export type AffectedSelectionInput = {
    changed: Iterable<string>;
    packages: readonly WorkspacePackageInfo[];
    consumersOf: ReadonlyMap<string, ReadonlySet<string>>;
    typecheck: boolean;
    /** 不看改动，选中全部。 */
    all: boolean;
    tier: TestTier;
    /** 不看改动，只选这些包（目录名；根脚本测试写 `scripts`）。 */
    only?: readonly string[];
    /** 与 `only` 同用：连同依赖它们的包。 */
    withConsumers?: boolean;
    /**
     * 改动所在的包只跑受影响的测试文件：Bun 测试器按导入关系选文件，值是 `--changed` 的比较基准
     * （undefined 表示未提交的改动）。它不跨包追踪，依赖方的包仍整包运行。
     */
    changedFilesSince?: {readonly since: string | undefined};
};

// 这些输入变化会影响所有包的依赖解析或测试运行器，无法按包缩小范围。根 package.json 的依赖变化
// 总会带来 bun.lock 的变化，所以它本身只算根脚本的输入（scripts 与 `#scripts/*` 导入映射）。
const FULL_SELECTION_FILES: Record<string, true> = {"bun.lock": true, "bunfig.toml": true};
const FULL_SELECTION_PREFIXES = ["patches/"];
// 根脚本测试覆盖治理脚本本身和 workflow 文件的结构合同。
const ROOT_SCRIPT_FILES: Record<string, true> = {"package.json": true};
const ROOT_SCRIPT_PREFIXES = ["scripts/", ".github/"];
const ROOT_SCRIPTS = "scripts";
// 旧应用只读，不参加测试。
const LEGACY_PACKAGE = "neuro-book-legacy";

/** 脚本是单条 `bun test`（可带环境变量前缀）时，追加的参数会传给 Bun 测试器；串联多条命令时不会。 */
function isSingleBunTest(script: string): boolean {
    return /^(?:[A-Z_][A-Z0-9_]*=\S*\s+)*bun test(?:\s|$)/u.test(script) && !/&&|\|\||;/u.test(script);
}

/**
 * 选出要测试的目标。缺省按改动：改动所在的包，加上直接或间接依赖它的包（与 CI 选包同一套依赖闭包）；
 * 根 `scripts/` 或 workflow 有改动时加上根脚本测试。给出 `only` 时不看改动。
 */
export function selectAffectedTargets(input: AffectedSelectionInput): AffectedSelection {
    const files = [...input.changed];
    const known = new Map(input.packages.filter((info) => info.directory !== LEGACY_PACKAGE).map((info) => [info.directory, info]));
    const direct = new Set<string>();
    let full = false;
    let fullReason = "";
    let rootScripts = false;
    if (input.only !== undefined) {
        for (const name of input.only) {
            if (name === ROOT_SCRIPTS) rootScripts = true;
            else if (known.has(name)) direct.add(name);
            else throw new Error(`没有这个包：${name}`);
        }
    } else {
        full = input.all || files.some((file) => FULL_SELECTION_FILES[file] === true || FULL_SELECTION_PREFIXES.some((prefix) => file.startsWith(prefix)));
        fullReason = input.all ? "--all" : "依赖锁、运行器配置或补丁有改动";
        for (const file of files) {
            const directory = /^packages\/([^/]+)\//u.exec(file)?.[1];
            if (directory !== undefined && known.has(directory)) direct.add(directory);
        }
        rootScripts = full || files.some((file) => ROOT_SCRIPT_FILES[file] === true || ROOT_SCRIPT_PREFIXES.some((prefix) => file.startsWith(prefix)));
    }
    const closure = input.only === undefined || input.withConsumers === true;
    const selected = full ? new Set(known.keys()) : closure ? expandConsumerClosure(direct, input.consumersOf) : direct;

    const scriptName = TIER_SCRIPTS[input.tier];
    const targets: AffectedTarget[] = [];
    const skipped: AffectedSelection["skipped"] = [];
    for (const directory of [...selected].sort()) {
        const info = known.get(directory);
        if (info === undefined) continue;
        const script = info.scripts[scriptName];
        if (script === undefined) {
            skipped.push({name: directory, reason: `没有 ${scriptName} 脚本`});
            continue;
        }
        const commands = input.typecheck && info.scripts.typecheck !== undefined ? [["bun", "run", "typecheck"]] : [];
        const bunTest = isSingleBunTest(script);
        let reason = full ? fullReason : input.only !== undefined ? (direct.has(directory) ? "指定的包" : "依赖指定的包") : direct.has(directory) ? "包内有改动" : "依赖有改动的包";
        const run = ["bun", "run", scriptName];
        if (input.changedFilesSince !== undefined && !full && input.only === undefined && direct.has(directory) && bunTest) {
            const {since} = input.changedFilesSince;
            run.push(since === undefined ? "--changed" : `--changed=${since}`);
            reason += "，只跑受影响的测试文件";
        }
        commands.push(run);
        targets.push({name: directory, cwd: `packages/${directory}`, commands, reason, bunTest});
    }
    if (rootScripts && input.tier === "fast") {
        const commands = input.typecheck ? [["bun", "x", "tsc", "--noEmit", "-p", "scripts/tsconfig.json"]] : [];
        commands.push(["bun", "x", "vitest", "run", "--config", "scripts/vitest.config.ts"]);
        const reason = full ? fullReason : input.only !== undefined ? "指定的包" : "根 scripts、workflow 或根 package.json 有改动";
        targets.push({name: ROOT_SCRIPTS, cwd: ".", commands, reason, bunTest: false});
    }
    return {targets, skipped};
}

export type TestDuration = {target: string; file: string; name: string; ms: number};

/** 从 Bun 的 junit 报告里取每个测试的文件、名称与耗时。 */
export function parseJunitDurations(target: string, xml: string): TestDuration[] {
    const durations: TestDuration[] = [];
    for (const match of xml.matchAll(/<testcase\b([^>]*)>/gu)) {
        const attributes = new Map([...(match[1] as string).matchAll(/(\w+)="([^"]*)"/gu)].map((entry) => [entry[1] as string, decodeXml(entry[2] as string)]));
        const seconds = Number(attributes.get("time"));
        if (!Number.isFinite(seconds)) continue;
        durations.push({target, file: attributes.get("file") ?? "", name: attributes.get("name") ?? "", ms: Math.round(seconds * 1000)});
    }
    return durations;
}

function decodeXml(text: string): string {
    return text.replace(/&(quot|apos|lt|gt|amp);/gu, (_, entity: string) => ({quot: "\"", apos: "'", lt: "<", gt: ">", amp: "&"})[entity] as string);
}

/** 快速类单个测试的耗时预算；超出的在运行结束时列出。 */
export const FAST_TEST_BUDGET_MS = 200;

function readWorkspacePackages(repoRoot: string): WorkspacePackageInfo[] {
    const packagesRoot = resolve(repoRoot, "packages");
    const packages: WorkspacePackageInfo[] = [];
    for (const entry of readdirSync(packagesRoot, {withFileTypes: true})) {
        const manifestPath = join(packagesRoot, entry.name, "package.json");
        if (!entry.isDirectory() || !existsSync(manifestPath)) continue;
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {scripts?: Record<string, string>};
        packages.push({directory: entry.name, scripts: manifest.scripts ?? {}});
    }
    return packages;
}

function readTier(values: readonly string[] | undefined): TestTier {
    const tier = values?.at(-1) ?? "fast";
    if (tier !== "fast" && tier !== "e2e" && tier !== "llm") {
        console.error(`--tier 只能是 fast、e2e 或 llm，收到 ${tier}`);
        process.exit(2);
    }
    return tier;
}

if (import.meta.main) {
    const {repoRoot, since, all, flags, options} = readChangeScopeArguments(import.meta.url, ["--typecheck", "--dry-run", "--with-consumers", "--files"], ["--package", "--tier"]);
    const only = options.get("--package");
    const tier = readTier(options.get("--tier"));
    const changed = all || only !== undefined ? new Set<string>() : changedFiles(repoRoot, since);
    let selection: AffectedSelection;
    try {
        selection = selectAffectedTargets({
            changed,
            packages: readWorkspacePackages(repoRoot),
            consumersOf: workspaceDependencyGraph(resolve(repoRoot, "packages")).consumersOf,
            typecheck: flags.has("--typecheck"),
            all,
            tier,
            only,
            withConsumers: flags.has("--with-consumers"),
            changedFilesSince: flags.has("--files") ? {since} : undefined,
        });
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(2);
    }

    if (!all && only === undefined) console.log(`改动文件 ${String(changed.size)} 个（未提交的改动${since === undefined ? "" : `，以及与 ${since} 分叉以来的提交`}）。`);
    if (selection.targets.length === 0) console.log("没有要运行的测试。");
    else console.log(`选中 ${String(selection.targets.length)} 项（${TIER_SCRIPTS[tier]}）：`);
    for (const target of selection.targets) {
        console.log(`  ${target.name}（${target.reason}）：${target.commands.map((command) => command.join(" ")).join("；")}`);
    }
    // 多数包没有 e2e、llm 类测试，这时只给计数。
    if (tier === "fast") for (const skip of selection.skipped) console.log(`  跳过 ${skip.name}（${skip.reason}）`);
    else if (selection.skipped.length > 0) console.log(`  另有 ${String(selection.skipped.length)} 个包没有 ${TIER_SCRIPTS[tier]} 脚本`);

    if (!flags.has("--dry-run")) {
        // 快速类的 Bun 测试另写一份 junit 报告，用来列出超出耗时预算的测试；报告放在系统临时目录，结束即删。
        const reportRoot = tier === "fast" ? resolveAgentScratchPath("test-affected") : null;
        if (reportRoot !== null) mkdirSync(reportRoot, {recursive: true});
        const reportDirectory = reportRoot === null ? null : mkdtempSync(join(reportRoot, "junit-"));
        const failures: string[] = [];
        const durations: TestDuration[] = [];
        try {
            // 依次运行：几个包的测试同时跑会争用内存。
            for (const target of selection.targets) {
                for (const command of target.commands) {
                    const isTestRun = command[2] === TIER_SCRIPTS[tier];
                    const junit = reportDirectory !== null && target.bunTest && isTestRun ? join(reportDirectory, `${target.name}.xml`) : null;
                    const args = junit === null ? command.slice(1) : [...command.slice(1), "--reporter=junit", `--reporter-outfile=${junit}`];
                    console.log(`\n==> ${target.name}：${command.join(" ")}`);
                    const result = spawnSync(command[0] as string, args, {cwd: resolve(repoRoot, target.cwd), stdio: "inherit"});
                    if (result.error !== undefined) failures.push(`${target.name}：${command.join(" ")} 无法启动（${result.error.message}）`);
                    else if (result.status !== 0) failures.push(`${target.name}：${command.join(" ")} ${result.status === null ? `被信号 ${String(result.signal)} 终止` : `退出码 ${String(result.status)}`}`);
                    if (junit !== null && existsSync(junit)) durations.push(...parseJunitDurations(target.name, readFileSync(junit, "utf8")));
                }
            }
        } finally {
            if (reportDirectory !== null) rmSync(reportDirectory, {recursive: true, force: true});
        }
        const slow = durations.filter((duration) => duration.ms > FAST_TEST_BUDGET_MS).sort((left, right) => right.ms - left.ms);
        if (slow.length > 0) {
            console.log(`\n超过 ${String(FAST_TEST_BUDGET_MS)}ms 的测试 ${String(slow.length)} 个${slow.length > 10 ? "（列出最慢的 10 个）" : ""}：`);
            for (const duration of slow.slice(0, 10)) console.log(`  ${String(duration.ms).padStart(6)}ms  ${duration.target}/${duration.file}  ${duration.name}`);
        }
        if (selection.targets.length > 0) {
            console.log(failures.length === 0 ? "\n全部通过。" : `\n失败 ${String(failures.length)} 项：\n${failures.map((failure) => `  ${failure}`).join("\n")}`);
        }
        if (failures.length > 0) process.exitCode = 1;
    }
}
