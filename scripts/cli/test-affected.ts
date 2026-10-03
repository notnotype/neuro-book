#!/usr/bin/env bun
import {spawnSync} from "node:child_process";
import {existsSync, readFileSync, readdirSync} from "node:fs";
import {join, resolve} from "node:path";

import {changedFiles, readChangeScopeArguments} from "#scripts/ci/change-scope";
import {expandConsumerClosure, workspaceDependencyGraph} from "#scripts/ci/workspace-package-matrix";

export type WorkspacePackageInfo = {
    /** 包目录名，例如 `nb-ui`。 */
    directory: string;
    scripts: Readonly<Record<string, string>>;
};

export type AffectedTarget = {
    /** 包目录名；根脚本测试为 `scripts`。 */
    name: string;
    /** 运行命令的目录，相对仓库根。 */
    cwd: string;
    commands: string[][];
    reason: string;
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
};

// 这些输入变化会影响所有包的依赖解析或测试运行器，无法按包缩小范围。根 package.json 的依赖变化
// 总会带来 bun.lock 的变化，所以它本身只算根脚本的输入（scripts 与 `#scripts/*` 导入映射）。
const FULL_SELECTION_FILES: Record<string, true> = {"bun.lock": true, "bunfig.toml": true};
const FULL_SELECTION_PREFIXES = ["patches/"];
// 根脚本测试覆盖治理脚本本身和 workflow 文件的结构合同。
const ROOT_SCRIPT_FILES: Record<string, true> = {"package.json": true};
const ROOT_SCRIPT_PREFIXES = ["scripts/", ".github/"];
// 旧应用只读，不参加测试。
const LEGACY_PACKAGE = "neuro-book-legacy";

/**
 * 按改动文件选出要测试的目标：改动所在的包，加上直接或间接依赖它的包（与 CI 选包同一套依赖闭包）；
 * 根 `scripts/` 或 workflow 有改动时加上根脚本测试。
 */
export function selectAffectedTargets(input: AffectedSelectionInput): AffectedSelection {
    const files = [...input.changed];
    const full = input.all || files.some((file) => FULL_SELECTION_FILES[file] === true || FULL_SELECTION_PREFIXES.some((prefix) => file.startsWith(prefix)));
    const fullReason = input.all ? "--all" : "依赖锁、运行器配置或补丁有改动";
    const known = new Map(input.packages.filter((info) => info.directory !== LEGACY_PACKAGE).map((info) => [info.directory, info]));
    const direct = new Set<string>();
    for (const file of files) {
        const directory = /^packages\/([^/]+)\//u.exec(file)?.[1];
        if (directory !== undefined && known.has(directory)) direct.add(directory);
    }
    const selected = full ? new Set(known.keys()) : expandConsumerClosure(direct, input.consumersOf);

    const targets: AffectedTarget[] = [];
    const skipped: AffectedSelection["skipped"] = [];
    for (const directory of [...selected].sort()) {
        const info = known.get(directory);
        if (info === undefined) continue;
        if (info.scripts.test === undefined) {
            skipped.push({name: directory, reason: "没有 test 脚本"});
            continue;
        }
        const commands = input.typecheck && info.scripts.typecheck !== undefined ? [["bun", "run", "typecheck"]] : [];
        commands.push(["bun", "run", "test"]);
        const reason = full ? fullReason : direct.has(directory) ? "包内有改动" : "依赖有改动的包";
        targets.push({name: directory, cwd: `packages/${directory}`, commands, reason});
    }
    if (full || files.some((file) => ROOT_SCRIPT_FILES[file] === true || ROOT_SCRIPT_PREFIXES.some((prefix) => file.startsWith(prefix)))) {
        const commands = input.typecheck ? [["bun", "x", "tsc", "--noEmit", "-p", "scripts/tsconfig.json"]] : [];
        commands.push(["bun", "x", "vitest", "run", "--config", "scripts/vitest.config.ts"]);
        targets.push({name: "scripts", cwd: ".", commands, reason: full ? fullReason : "根 scripts、workflow 或根 package.json 有改动"});
    }
    return {targets, skipped};
}

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

if (import.meta.main) {
    const {repoRoot, since, all, flags} = readChangeScopeArguments(import.meta.url, ["--typecheck", "--dry-run"]);
    const changed = all ? new Set<string>() : changedFiles(repoRoot, since);
    const selection = selectAffectedTargets({
        changed,
        packages: readWorkspacePackages(repoRoot),
        consumersOf: workspaceDependencyGraph(resolve(repoRoot, "packages")).consumersOf,
        typecheck: flags.has("--typecheck"),
        all,
    });

    if (!all) console.log(`改动文件 ${String(changed.size)} 个（未提交的改动${since === undefined ? "" : `，以及与 ${since} 分叉以来的提交`}）。`);
    if (selection.targets.length === 0) console.log("没有受影响的包。");
    else console.log(`选中 ${String(selection.targets.length)} 项：`);
    for (const target of selection.targets) {
        console.log(`  ${target.name}（${target.reason}）：${target.commands.map((command) => command.join(" ")).join("；")}`);
    }
    for (const skip of selection.skipped) console.log(`  跳过 ${skip.name}（${skip.reason}）`);

    if (!flags.has("--dry-run")) {
        // 依次运行：几个包的测试同时跑会争用内存。
        const failures: string[] = [];
        for (const target of selection.targets) {
            for (const command of target.commands) {
                console.log(`\n==> ${target.name}：${command.join(" ")}`);
                const result = spawnSync(command[0] as string, command.slice(1), {cwd: resolve(repoRoot, target.cwd), stdio: "inherit"});
                if (result.error !== undefined) failures.push(`${target.name}：${command.join(" ")} 无法启动（${result.error.message}）`);
                else if (result.status !== 0) failures.push(`${target.name}：${command.join(" ")} ${result.status === null ? `被信号 ${String(result.signal)} 终止` : `退出码 ${String(result.status)}`}`);
            }
        }
        if (selection.targets.length > 0) {
            console.log(failures.length === 0 ? "\n全部通过。" : `\n失败 ${String(failures.length)} 项：\n${failures.map((failure) => `  ${failure}`).join("\n")}`);
        }
        if (failures.length > 0) process.exitCode = 1;
    }
}
