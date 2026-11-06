/**
 * e2e 的范围闸（docs/testing/README.md 的“验证门禁”）：一次选中太多文件时拒绝运行，除非写明这轮要消除什么不确定性。
 *
 * 规则写在文档里拦不住：开发 Agent 在发命令那一刻想不起来，或者把列得具体的清单当成每轮都要跑（经过见 w00001 的 Task 记录）。放在 Playwright 配置里，什么工具、哪个子代理发的命令都绕不过去。
 * 拦的是文件数，不判断该不该跑：确实要大范围跑时带上理由就行，理由留在日志里。
 */

import {readdirSync} from "node:fs";
import {join} from "node:path";

export const WIDE_RUN_MAX_FILES = 8;
export const WIDE_RUN_ENV = "NB_E2E_WIDE";

/** 后面跟一个值的选项：那个值不是文件过滤词（`--reporter line` 里的 line）。 */
const OPTIONS_WITH_VALUE = new Set(["-c", "--config", "--reporter", "--project", "-j", "--workers", "--timeout", "--retries", "--repeat-each", "--output", "--trace", "--max-failures", "--global-timeout", "--shard", "--tsconfig", "--grep-invert", "-gv", "-g", "--grep", "--update-snapshots", "-u", "--ignore-snapshots-from", "--pass-with-no-tests-from"]);

/** 不是在跑一大批：只列出、只重跑上次失败的、按用例名挑的。 */
const NARROW_FLAGS = new Set(["--list", "--last-failed", "--lf", "-g", "--grep", "--only-changed"]);

interface RunArguments {
    readonly filters: ReadonlyArray<string>;
    readonly narrow: boolean;
}

function readArguments(argv: ReadonlyArray<string>): RunArguments | null {
    const start = argv.indexOf("test");
    // 不是 `playwright test`：工作进程也会加载配置，它们的参数里没有这个词。
    if (start < 0) return null;
    const filters: string[] = [];
    let narrow = false;
    for (let at = start + 1; at < argv.length; at += 1) {
        const argument = argv[at] as string;
        if (!argument.startsWith("-")) {
            filters.push(argument);
            continue;
        }
        const name = argument.split("=", 1)[0] as string;
        if (NARROW_FLAGS.has(name)) narrow = true;
        if (OPTIONS_WITH_VALUE.has(name) && !argument.includes("=")) at += 1;
    }
    return {filters, narrow};
}

/** 选中了哪些文件：过滤词按正则匹配绝对路径，和 Playwright 一样；`:行号` 后缀不算。所以 worktree 目录名里含过滤词时选中的是全部，这里也算得出来。 */
export function selectedFiles(files: ReadonlyArray<string>, filters: ReadonlyArray<string>): ReadonlyArray<string> {
    if (filters.length === 0) return files;
    const patterns = filters.map((filter) => new RegExp(filter.replace(/(?::\d+){1,2}$/u, "")));
    return files.filter((file) => patterns.some((pattern) => pattern.test(file)));
}

/** 这次运行要拒绝时给出原因；放行是 null。 */
export function wideRunProblem(input: {readonly argv: ReadonlyArray<string>; readonly files: ReadonlyArray<string>; readonly reason: string | undefined}): string | null {
    const run = readArguments(input.argv);
    if (run === null || run.narrow || (input.reason ?? "").trim() !== "") return null;
    const count = selectedFiles(input.files, run.filters).length;
    if (count <= WIDE_RUN_MAX_FILES) return null;
    return [
        `这次选中了 ${String(count)} 个 e2e 文件，超过 ${String(WIDE_RUN_MAX_FILES)} 个（docs/testing/README.md 的“验证门禁”）。`,
        "改了什么就跑覆盖它的文件；改完只重跑覆盖改动的文件和失败项，同一份清单不重复跑。",
        `确实要大范围跑：${WIDE_RUN_ENV}="这轮要消除什么不确定性" 加在命令前面。`,
    ].join("\n");
}

/** 配置加载时调用：工作进程不查，只查发起运行的那个进程。 */
export function guardWideRun(directory: string): void {
    if (process.env.TEST_WORKER_INDEX !== undefined) return;
    const files = readdirSync(directory).filter((name) => name.endsWith(".e2e.ts")).map((name) => join(directory, name));
    const reason = process.env[WIDE_RUN_ENV];
    const problem = wideRunProblem({argv: process.argv, files, reason});
    if (problem !== null) throw new Error(problem);
    if ((reason ?? "").trim() !== "" && selectedFiles(files, readArguments(process.argv)?.filters ?? []).length > WIDE_RUN_MAX_FILES) console.log(`[e2e] 大范围运行：${reason as string}`);
}
