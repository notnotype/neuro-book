#!/usr/bin/env bun
/**
 * 一条命令发版（w00046 t24；流程见 docs/standards/releasing.md 的“发版”）。由开发者在主工作区的 master 上运行：
 *
 * - `bun run release rehearse`：推 master，在 Actions 里对 master 跑一次 Release 演练（workflow_dispatch：跑到冒烟为止，
 *   不发 npm、不建 Release），盯到结束。
 * - `bun run release <版本> [--stage canary|preview]`：确认 HEAD 上有一次成功的演练，跑 `release:prepare` 提交
 *   `release: v<版本>`，打标签，把 master 与标签一次原子推送（两个一起成、一起不成），再盯标签触发的 Release 流水线到结束。
 *   `--no-rehearsal` 跳过演练检查（只在明白为什么时用）。
 * - `bun run release watch <版本>`：重新盯某个标签的 Release 流水线（盯的终端断了、或作业重跑后）。
 *
 * 推送与打标签是发布授权（标签规则集只允许开发者建 `v*`），所以这个命令只在开发者的机器上、用开发者的凭据跑。
 * 演练检查来自 v0.14.0 的教训：只在发布流水线上跑的冒烟被新加的首次启动向导挡住，打了标签才发现，版本号作废。
 *
 * 外部命令（git、gh、bun）经注入的 `run` 端口调用，单测用记录调用的替身。退出码：0 成功；1 失败；2 用法错误。
 */

import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";

const REPOSITORY = fileURLToPath(new URL("../../", import.meta.url));
const WORKFLOW = "release.yml";
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export class ReleaseCommandFailure extends Error {}
class UsageError extends Error {}

export type CommandResult = {code: number; stdout: string};
/** `capture` 收下标准输出（给要读结果的命令）；否则输出直接给终端（prepare、`gh run watch`）。 */
export type Run = (argv: readonly string[], options?: {capture?: boolean}) => Promise<CommandResult>;
export type Sleep = (ms: number) => Promise<void>;

/** `gh run list --json databaseId,headSha,status,conclusion,event,url,createdAt` 的一项。 */
export type WorkflowRun = {databaseId: number; headSha: string; status: string; conclusion: string | null; event: string; url: string; createdAt: string};

const RUN_FIELDS = "databaseId,headSha,status,conclusion,event,url,createdAt";

export type Command =
    | {kind: "rehearse"}
    | {kind: "release"; version: string; stage: "canary" | "preview" | undefined; rehearsal: boolean}
    | {kind: "watch"; version: string};

const USAGE = "用法：bun run release <版本> [--stage canary|preview] [--no-rehearsal] | rehearse | watch <版本>";

export function parseCommand(argv: readonly string[]): Command {
    let parsed;
    try {
        parsed = parseArgs({args: [...argv], options: {stage: {type: "string"}, "no-rehearsal": {type: "boolean"}}, allowPositionals: true});
    } catch (error) {
        throw new UsageError(`${(error as Error).message}\n${USAGE}`);
    }
    const [first, second, ...extra] = parsed.positionals;
    const {stage} = parsed.values;
    const rehearsal = parsed.values["no-rehearsal"] !== true;
    const hasOptions = stage !== undefined || !rehearsal;
    if (first === "rehearse" && second === undefined && !hasOptions) return {kind: "rehearse"};
    if (first === "watch" && second !== undefined && extra.length === 0 && !hasOptions && STABLE_VERSION.test(second)) return {kind: "watch", version: second};
    if (first !== undefined && second === undefined && STABLE_VERSION.test(first) && (stage === undefined || stage === "canary" || stage === "preview")) {
        return {kind: "release", version: first, stage, rehearsal};
    }
    throw new UsageError(USAGE);
}

/** `gh run view --json jobs` 的一项。 */
export type WorkflowJob = {name: string; conclusion: string | null};

/** macOS 的作业（release.yml 调用 desktop-macos-build.yml，作业名带调用方作业名的前缀）：尽力而为，失败不挡发布，也不挡演练。 */
const MACOS_JOB = /^macOS \/ /u;

/**
 * 一轮演练算不算通过：除 macOS 的作业外都成功或被跳过（演练本来就跳过远端写入的作业），且至少有一个作业成功。
 * 启动即失败（startup_failure）的一轮没有作业，不算通过。
 */
export function rehearsalPassed(jobs: readonly WorkflowJob[]): boolean {
    const required = jobs.filter((job) => !MACOS_JOB.test(job.name));
    return required.some((job) => job.conclusion === "success") && required.every((job) => job.conclusion === "success" || job.conclusion === "skipped");
}

/**
 * HEAD 上已结束的演练（Release 工作流、workflow_dispatch、在这个提交上），新的在前；通不通过另按作业判定（`rehearsalPassed`）。
 * 只认这个提交：演练之后又合了别的提交，那些改动没在发布流水线上跑过。
 */
export function rehearsalsOn(runs: readonly WorkflowRun[], head: string): WorkflowRun[] {
    return runs.filter((run) => run.event === "workflow_dispatch" && run.headSha === head && run.status === "completed").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 刚推送触发的那一轮：`after` 之后建的、在这个提交上的最新一轮（同一提交上可能有更早被取消的轮次）。 */
export function triggeredRun(runs: readonly WorkflowRun[], head: string, event: string, after: Date): WorkflowRun | null {
    const matching = runs.filter((run) => run.headSha === head && run.event === event && new Date(run.createdAt).getTime() >= after.getTime() - 60_000);
    matching.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return matching[0] ?? null;
}

/**
 * master 与标签一次推送：`--atomic` 让远端两个引用一起更新或都不更新，不会出现标签上去了、master 没上去。master 的源写确切的
 * 提交号，不写分支名：主工作区几个会话共用，推送那一刻的本地 master 可能已经被别人推进。
 */
export function pushArgv(version: string, commit: string): string[] {
    return ["git", "push", "--atomic", "origin", `${commit}:refs/heads/master`, `refs/tags/v${version}:refs/tags/v${version}`];
}

export class ReleaseCommand {
    readonly #run: Run;
    readonly #sleep: Sleep;
    readonly #log: (line: string) => void;

    constructor(run: Run, sleep: Sleep, log: (line: string) => void = console.log) {
        this.#run = run;
        this.#sleep = sleep;
        this.#log = log;
    }

    async #must(argv: readonly string[], capture = true): Promise<string> {
        const result = await this.#run(argv, {capture});
        if (result.code !== 0) throw new ReleaseCommandFailure(`${argv.join(" ")} 失败（退出码 ${String(result.code)}）`);
        return result.stdout.trim();
    }

    async #runs(filter: readonly string[]): Promise<WorkflowRun[]> {
        return JSON.parse(await this.#must(["gh", "run", "list", "--workflow", WORKFLOW, "--limit", "30", "--json", RUN_FIELDS, ...filter])) as WorkflowRun[];
    }

    /** 在 master 上、HEAD 包含刚取到的 origin/master（否则推送会被拒或要强推）。交回 HEAD。 */
    async #onMaster(): Promise<string> {
        const branch = await this.#must(["git", "rev-parse", "--abbrev-ref", "HEAD"]);
        if (branch !== "master") throw new ReleaseCommandFailure(`当前在 ${branch}，发版要在 master 上`);
        await this.#must(["git", "fetch", "--quiet", "--tags", "origin", "master"]);
        const contains = await this.#run(["git", "merge-base", "--is-ancestor", "origin/master", "HEAD"], {capture: true});
        if (contains.code !== 0) throw new ReleaseCommandFailure("HEAD 不包含 origin/master：先把远端的提交合进来");
        return this.#must(["git", "rev-parse", "HEAD"]);
    }

    /** 等推送触发的那一轮出现（GitHub 建运行有几秒到一两分钟的延迟），最多 3 分钟。 */
    async #waitForRun(filter: readonly string[], head: string, event: string, after: Date): Promise<WorkflowRun> {
        for (let attempt = 0; attempt < 36; attempt += 1) {
            const run = triggeredRun(await this.#runs(filter), head, event, after);
            if (run !== null) return run;
            await this.#sleep(5_000);
        }
        throw new ReleaseCommandFailure(`3 分钟内没看到 ${head.slice(0, 9)} 上的 Release 流水线：到 Actions 页面看${event === "push" ? `，或稍后 bun run release watch <版本>` : ""}`);
    }

    async #jobs(run: WorkflowRun): Promise<WorkflowJob[]> {
        return (JSON.parse(await this.#must(["gh", "run", "view", String(run.databaseId), "--json", "jobs"])) as {jobs: WorkflowJob[]}).jobs;
    }

    /** 盯到结束，列出各作业；交回作业的结果（判定由调用方按演练或发布的规则做）。 */
    async #watch(run: WorkflowRun): Promise<{exit: number; jobs: WorkflowJob[]}> {
        this.#log(`盯着 ${run.url}`);
        // gh run watch 在运行结束前不退出；--exit-status 让失败的运行以非零退出。启动即失败的一轮没有作业，GitHub 页面上有原因。
        const watched = await this.#run(["gh", "run", "watch", String(run.databaseId), "--interval", "30", "--exit-status"]);
        const jobs = await this.#jobs(run);
        if (jobs.length === 0) this.#log(`  这一轮没有作业（多半是工作流文件在启动时就被拒，原因在 ${run.url}）`);
        for (const job of jobs) this.#log(`  ${job.conclusion === "success" ? "✓" : job.conclusion === "skipped" ? "·" : "✗"} ${job.name}（${job.conclusion ?? "没结束"}）`);
        return {exit: watched.code, jobs};
    }

    /** 发布这一轮：全绿为成功；只有 macOS 失败时 Windows 与 npm 已经发出，照实说明、按失败退出，让开发者去补 macOS。 */
    #releaseOutcome(result: {exit: number; jobs: WorkflowJob[]}): boolean {
        if (result.exit !== 0 && rehearsalPassed(result.jobs)) this.#log("macOS 的构建没成功，Release 只带 Windows 的资产：用 Desktop macOS 工作流手动补包");
        return result.exit === 0;
    }

    async rehearse(): Promise<boolean> {
        const head = await this.#onMaster();
        const started = new Date();
        // 推的是读到的那个提交，不是分支名：推送前别人推进了本地 master 时，演练的就不是推上去的提交。
        await this.#must(["git", "push", "origin", `${head}:refs/heads/master`], false);
        await this.#must(["gh", "workflow", "run", WORKFLOW, "--ref", "master"], false);
        const run = await this.#waitForRun(["--event", "workflow_dispatch", "--branch", "master"], head, "workflow_dispatch", started);
        const {exit, jobs} = await this.#watch(run);
        const ok = rehearsalPassed(jobs);
        if (ok && exit !== 0) this.#log("macOS 的作业失败：不挡发布，发出去的 Release 只带 Windows 的资产");
        this.#log(ok ? `✓ 演练通过（${head.slice(0, 9)}）：可以 bun run release <版本>` : "✗ 演练失败：看上面失败的作业，修好后再演练");
        return ok;
    }

    async release(command: Extract<Command, {kind: "release"}>): Promise<boolean> {
        const head = await this.#onMaster();
        if (command.rehearsal) {
            let passed: WorkflowRun | null = null;
            for (const run of rehearsalsOn(await this.#runs(["--event", "workflow_dispatch"]), head)) {
                if (rehearsalPassed(await this.#jobs(run))) {
                    passed = run;
                    break;
                }
            }
            if (passed === null) throw new ReleaseCommandFailure(`HEAD（${head.slice(0, 9)}）上没有通过的演练：先 bun run release rehearse`);
            this.#log(`✓ HEAD 上的演练通过：${passed.url}`);
        }
        const tag = `v${command.version}`;
        const existing = await this.#run(["git", "rev-parse", "--verify", "--quiet", `refs/tags/${tag}`], {capture: true});
        if (existing.code === 0) throw new ReleaseCommandFailure(`标签 ${tag} 已经存在：标签不能改指，换一个版本号`);
        await this.#must(["bun", "scripts/release/prepare.ts", command.version, ...(command.stage === undefined ? [] : ["--stage", command.stage])], false);
        const commit = await this.#must(["git", "rev-parse", "HEAD"]);
        // 发版提交要正好建在演练过的提交上：主工作区几个会话共用，prepare 前后别人可能合进了提交。
        const parent = await this.#must(["git", "rev-parse", `${commit}^`]);
        const subject = await this.#must(["git", "log", "-1", "--format=%s", commit]);
        if (parent !== head || subject !== `release: ${tag}`) {
            throw new ReleaseCommandFailure(`HEAD（${commit.slice(0, 9)}，“${subject}”）不是建在演练过的 ${head.slice(0, 9)} 上的 release: ${tag}：有别的提交插了进来。没打标签、没推送；看 git log 处理后重来`);
        }
        await this.#must(["git", "tag", tag, commit]);
        const started = new Date();
        const push = pushArgv(command.version, commit);
        const pushed = await this.#run(push);
        if (pushed.code !== 0) {
            // 非零不一定是被拒：服务端可能已经落下两个引用、只是确认没传回来。只读地问远端，不猜。
            const remote = await this.#run(["git", "ls-remote", "origin", `refs/tags/${tag}`], {capture: true});
            const landed = remote.code === 0 && remote.stdout.split(/\s+/u)[0] === commit;
            if (!landed) {
                const state = remote.code === 0 ? `远端没有 ${tag}（原子推送：master 也没动）` : "远端的状态没查到（git ls-remote 也失败了）";
                throw new ReleaseCommandFailure(`推送失败，${state}。本地留着提交 release: ${tag} 与标签 ${tag}，查明原因（网络、权限、远端 master 前进了）后原样重推：${push.join(" ")}，推上去以后 bun run release watch ${command.version}`);
            }
            this.#log(`推送报了错，但远端的 ${tag} 已经指向 ${commit.slice(0, 9)}：按推上去了处理`);
        }
        this.#log(`✓ 推送了 master 与 ${tag}（${commit.slice(0, 9)}）`);
        return this.#releaseOutcome(await this.#watch(await this.#waitForRun(["--event", "push", "--branch", tag], commit, "push", started)));
    }

    async watchTag(version: string): Promise<boolean> {
        const tag = `v${version}`;
        const commit = await this.#must(["git", "rev-list", "-n", "1", `refs/tags/${tag}`]);
        const run = triggeredRun(await this.#runs(["--event", "push", "--branch", tag]), commit, "push", new Date(0));
        if (run === null) throw new ReleaseCommandFailure(`没有 ${tag} 的 Release 流水线`);
        return this.#releaseOutcome(await this.#watch(run));
    }
}

/** 真正执行外部命令：在仓库根运行；`capture` 时收下标准输出，否则直接给终端。stdin 不接（gh 在非交互时不提问）。 */
export const spawnCommand: Run = (argv, options = {}) =>
    new Promise((resolve, reject) => {
        const child = spawn(argv[0] as string, argv.slice(1), {cwd: REPOSITORY, stdio: ["ignore", options.capture === true ? "pipe" : "inherit", "inherit"]});
        let stdout = "";
        child.stdout?.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
        child.on("error", reject);
        child.on("close", (code) => resolve({code: code ?? 1, stdout}));
    });

async function main(argv: readonly string[]): Promise<number> {
    const command = parseCommand(argv);
    const release = new ReleaseCommand(spawnCommand, (ms) => Bun.sleep(ms));
    if (command.kind === "rehearse") return (await release.rehearse()) ? 0 : 1;
    if (command.kind === "watch") return (await release.watchTag(command.version)) ? 0 : 1;
    return (await release.release(command)) ? 0 : 1;
}

if (import.meta.main) {
    try {
        process.exit(await main(process.argv.slice(2)));
    } catch (error) {
        if (error instanceof UsageError) {
            console.error(error.message);
            process.exit(2);
        }
        console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
