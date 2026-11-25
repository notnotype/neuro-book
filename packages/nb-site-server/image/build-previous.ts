/**
 * 打“上一个版本”的程序给相邻版本测试用（包脚本 `build:previous`，`site.operations` 输出 7、验收 2）：把基准提交检出到
 * `--out` 下的一棵独立的树里，在那里装依赖、照那个提交自己的 `build:image --no-docker` 打出 `server.js`。
 *
 * 不能用当前树的 `node_modules` 去打旧的源码：工作区包的链接指回当前树，打出来的会是当前的代码。克隆用 `--shared`
 * 共用本仓库的对象、不在本仓库登记 worktree，删掉 `--out` 就清理干净。
 *
 * 用法：`bun run build:previous --base <提交> --out <目录> --command-out <文件>`。成功时往 `--command-out` **追加**三行
 * `键=值`（CI 直接把 `$GITHUB_OUTPUT` 交给它）：
 * - `command=<JSON 数组>`：上一个版本的 argv，交给合同测试的 `NB_SITE_PREVIOUS_SERVER_COMMAND`；
 * - `without_ingest=0|1`：基准提交的树里没有统计的写入口（`packages/nb-site-telemetry/src/ingest.ts`）时为 1，交给
 *   `NB_SITE_PREVIOUS_WITHOUT_INGEST`；
 * - `without_telemetry_jobs=0|1`：树里没有统计的两个定时任务（`aggregate.ts`、`purge.ts`）时为 1，交给
 *   `NB_SITE_PREVIOUS_WITHOUT_TELEMETRY_JOBS`。
 * 上一个版本有没有某个接口由这里看源码树定，不由测试看运行结果猜：上一个版本把接口弄丢了时测试照样失败。
 *
 * 没有上一个版本时（`--base` 为空或全是 0、不是本仓库的提交、不是 HEAD 的祖先、那棵树里还没有 `image/build.ts`）只在标准错误
 * 写一行原因、以 0 退出、不写 `--command-out`；CI 看 `command` 为空就跳过相邻版本那一步。解析出的基准提交同样写到标准错误。
 * 别的失败（克隆、装依赖、打包）以非零退出。标准输出只有子进程自己的输出，不给机器读。
 */

import {appendFile, mkdir, stat} from "node:fs/promises";
import {join, resolve} from "node:path";
import {parseArgs} from "node:util";

const PACKAGE_ROOT = resolve(import.meta.dir, "..");
/** 基准提交的树里有它，才能照那个提交自己的写法打产物（t05 第 7 片之前没有）。 */
const BUILD_SCRIPT = "packages/nb-site-server/image/build.ts";
const INGEST_SOURCE = "packages/nb-site-telemetry/src/ingest.ts";
const JOB_SOURCES = ["packages/nb-site-telemetry/src/aggregate.ts", "packages/nb-site-telemetry/src/purge.ts"] as const;

const {values} = parseArgs({
    args: process.argv.slice(2),
    options: {
        base: {type: "string", default: ""},
        out: {type: "string"},
        "command-out": {type: "string"},
    },
    strict: true,
});
if (values.out === undefined || values.out === "" || values["command-out"] === undefined || values["command-out"] === "") {
    console.error("usage: build-previous --base <commit> --out <dir> --command-out <file>");
    process.exit(2);
}
const outDir = resolve(values.out);
const commandOut = resolve(values["command-out"]);

interface Run {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
}

/** 跑一个要读结果的命令（git 查询）；不按退出码抛错，由调用方按各自的含义判断。 */
async function capture(argv: readonly string[], cwd: string): Promise<Run> {
    const child = Bun.spawn([...argv], {cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe"});
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return {exitCode, stdout: stdout.trim(), stderr: stderr.trim()};
}

/** 跑一个只看成败的步骤，输出直接接到本进程的标准错误；不是 0 时带着原退出码退出。 */
async function step(what: string, argv: readonly string[], cwd: string): Promise<void> {
    const child = Bun.spawn([...argv], {cwd, stdin: "ignore", stdout: "inherit", stderr: "inherit"});
    const exitCode = await child.exited;
    if (exitCode !== 0) {
        console.error(`build-previous: ${what} exited with ${String(exitCode)}`);
        process.exit(exitCode);
    }
}

function noPrevious(reason: string): never {
    console.error(`build-previous: no previous version (${reason}); adjacent-version tests are skipped`);
    process.exit(0);
}

/**
 * 基准提交的树里有没有这个文件（`git cat-file -e`：有为 0，否则非零）。git 自己出错也是非零、会被当成“没有”，
 * 所以只在确认过提交存在之后调用。
 */
async function treeHas(repo: string, commit: string, path: string): Promise<boolean> {
    return (await capture(["git", "cat-file", "-e", `${commit}:${path}`], repo)).exitCode === 0;
}

const repoRun = await capture(["git", "rev-parse", "--show-toplevel"], PACKAGE_ROOT);
if (repoRun.exitCode !== 0) {
    console.error(`build-previous: not inside a git checkout: ${repoRun.stderr}`);
    process.exit(1);
}
const repo = repoRun.stdout;

const base = values.base.trim();
// 推送新分支时 `github.event.before` 是全 0；手动触发与发布流水线调用时没有基准。
if (base === "" || /^0+$/u.test(base)) noPrevious("no base commit given");

const resolved = await capture(["git", "rev-parse", "--verify", "--quiet", `${base}^{commit}`], repo);
if (resolved.exitCode !== 0) noPrevious(`base ${base} is not a commit in this repository`);
const commit = resolved.stdout;
const subject = (await capture(["git", "log", "-1", "--format=%s", commit], repo)).stdout;
console.error(`build-previous: base ${base} resolves to ${commit} ${subject}`);

const ancestor = await capture(["git", "merge-base", "--is-ancestor", commit, "HEAD"], repo);
// `--is-ancestor` 不是祖先时退出码 1，别的退出码是 git 自己出错。
if (ancestor.exitCode === 1) noPrevious(`base ${commit} is not an ancestor of HEAD`);
if (ancestor.exitCode !== 0) {
    console.error(`build-previous: git merge-base --is-ancestor failed: ${ancestor.stderr}`);
    process.exit(1);
}
if (!(await treeHas(repo, commit, BUILD_SCRIPT))) noPrevious(`base ${commit} has no ${BUILD_SCRIPT}`);

const withoutIngest = !(await treeHas(repo, commit, INGEST_SOURCE));
const withoutJobs = !(await Promise.all(JOB_SOURCES.map((path) => treeHas(repo, commit, path)))).every(Boolean);
console.error(`build-previous: previous version has ingest: ${withoutIngest ? "no" : "yes"}; telemetry jobs: ${withoutJobs ? "no" : "yes"}`);

const tree = join(outDir, "tree");
// 已有的树可能是别的基准提交的，直接复用会打出错误的版本；要调用方自己删掉。
if (await stat(tree).then(() => true, () => false)) {
    console.error(`build-previous: ${tree} already exists; remove it first`);
    process.exit(1);
}
await mkdir(outDir, {recursive: true});
await step("git clone", ["git", "clone", "--quiet", "--shared", "--no-checkout", repo, tree], outDir);
await step("git checkout", ["git", "-C", tree, "checkout", "--quiet", "--detach", commit], outDir);
await step("bun install", [process.execPath, "install", "--frozen-lockfile"], tree);
await step("build:image", [process.execPath, "run", "--cwd", "packages/nb-site-server", "build:image", "--no-docker"], tree);

const server = join(tree, "packages", "nb-site-server", "dist", "image", "server.js");
if (!(await stat(server).then((info) => info.isFile(), () => false))) {
    console.error(`build-previous: build:image of ${commit} did not produce ${server}`);
    process.exit(1);
}
// 与 CI 里 NB_SITE_SERVER_COMMAND 的写法一致：用 PATH 上的 bun 跑，两个版本用同一个运行时。
const command = JSON.stringify(["bun", "--no-env-file", server]);
await appendFile(commandOut, `command=${command}\nwithout_ingest=${withoutIngest ? "1" : "0"}\nwithout_telemetry_jobs=${withoutJobs ? "1" : "0"}\n`);
console.error(`build-previous: wrote the previous version's command to ${commandOut}`);
