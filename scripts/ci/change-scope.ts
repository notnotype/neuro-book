import {resolve} from "node:path";

import {defaultRepoRoot, git} from "#scripts/ci/agent-governance-contract";

/** 检查与测试命令共用的改动范围参数。 */
export type ChangeScopeArguments = {
    repoRoot: string;
    /** 再算上从它与 HEAD 的分叉点到 HEAD 的提交；未给出时只算未提交的改动。 */
    since: string | undefined;
    /** 为 true 时不按改动范围裁剪。 */
    all: boolean;
    /** 命令自己的开关，例如 `--dry-run`。 */
    flags: ReadonlySet<string>;
    /** 命令自己带值的参数，可重复给出，例如 `--package nb-ui --package nb-runtime`。 */
    options: ReadonlyMap<string, readonly string[]>;
};

/** 归属到某个文件的警告；`label` 是固定的类别名，存量计数按它分组。 */
export type FileWarning = {path: string; label: string; detail: string};

export type ScopedWarnings = {
    /** 改动范围内的警告，逐条列出。 */
    warnings: string[];
    /** 范围外的警告合成的一行计数；没有时省略。 */
    stockWarnings?: string;
};

/**
 * 解析 `--repo-root <dir>`、`--since <rev>`、`--all` 与命令自己声明的开关和带值参数。
 * 未知参数直接报错：拼错的 `--since` 若被忽略，会悄悄退回默认范围。
 */
export function parseChangeScopeArguments(
    args: readonly string[],
    moduleUrl: string,
    commandFlags: readonly string[] = [],
    commandOptions: readonly string[] = [],
): ChangeScopeArguments {
    let repoRoot = defaultRepoRoot(moduleUrl);
    let since: string | undefined;
    let all = false;
    const flags = new Set<string>();
    const options = new Map<string, string[]>();
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index] as string;
        if (argument === "--") continue;
        if (argument === "--repo-root" || argument === "--since" || commandOptions.includes(argument)) {
            const value = args[index + 1];
            if (value === undefined || value.startsWith("--")) throw new Error(`参数缺少值：${argument}`);
            if (argument === "--repo-root") repoRoot = resolve(value);
            else if (argument === "--since") since = value;
            else options.set(argument, [...(options.get(argument) ?? []), value]);
            index += 1;
        } else if (argument === "--all") {
            all = true;
        } else if (commandFlags.includes(argument)) {
            flags.add(argument);
        } else {
            throw new Error(`未知参数：${argument}`);
        }
    }
    return {repoRoot, since, all, flags, options};
}

/** 命令入口用：参数错误时打印原因并以 2 退出。 */
export function readChangeScopeArguments(moduleUrl: string, commandFlags: readonly string[] = [], commandOptions: readonly string[] = []): ChangeScopeArguments {
    try {
        return parseChangeScopeArguments(process.argv.slice(2), moduleUrl, commandFlags, commandOptions);
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(2);
    }
}

/**
 * 本次改动涉及的仓库相对路径：未提交的改动（暂存、未暂存与未跟踪文件）；给出 `since` 时再加上
 * 从它与 HEAD 的分叉点到 HEAD 的提交。重命名拆成删除与新增，两端路径都算改动。
 */
export function changedFiles(repoRoot: string, since?: string): Set<string> {
    const paths = new Set<string>();
    // porcelain v1 的 -z 输出每项为 "XY <path>"；关掉重命名检测后每项只有一个路径。
    for (const entry of git(repoRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"]).split("\0")) {
        if (entry.length > 3) paths.add(entry.slice(3));
    }
    if (since !== undefined) {
        const base = git(repoRoot, ["merge-base", since, "HEAD"]).trim();
        for (const path of git(repoRoot, ["diff", "--name-only", "-z", "--no-renames", base, "HEAD"]).split("\0")) {
            if (path) paths.add(path);
        }
    }
    return paths;
}

/** 按改动范围拆分警告；`scope` 为 null 时全部逐条列出。 */
export function scopeWarnings(findings: readonly FileWarning[], scope: ReadonlySet<string> | null): ScopedWarnings {
    const format = (finding: FileWarning): string => `${finding.label}：${finding.detail}`;
    if (scope === null) return {warnings: findings.map(format)};
    const warnings: string[] = [];
    const stockByLabel = new Map<string, number>();
    for (const finding of findings) {
        if (scope.has(finding.path)) warnings.push(format(finding));
        else stockByLabel.set(finding.label, (stockByLabel.get(finding.label) ?? 0) + 1);
    }
    if (stockByLabel.size === 0) return {warnings};
    const total = [...stockByLabel.values()].reduce((sum, count) => sum + count, 0);
    const kinds = [...stockByLabel].map(([label, count]) => `${label} ${String(count)}`).join("、");
    return {warnings, stockWarnings: `另有 ${String(total)} 条警告不在本次改动范围（${kinds}），加 --all 逐条列出`};
}
