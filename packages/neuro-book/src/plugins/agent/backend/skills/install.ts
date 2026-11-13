/**
 * 初始化 Skill 的依赖（docs/specs/agent/skills.md 输出 18–22）：设置里的 Skill 页、`$` 选它时的确认、命令行三处调用同一个
 * 模块，在 Skill 目录里用应用自带的 Bun 按 `bun.lock` 安装，不运行包的安装脚本。
 *
 * 同一个 Skill 同一时间只装一次：同一个进程里并入正在进行的那一次；跨进程靠状态根下按 Skill 分文件的系统文件锁，进程怎样结束
 * 锁都会放掉。锁文件建好不删（锁的是 inode，删了再建是另一把锁）。
 */

import {mkdir, readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import {tryLock} from "@notnotype/nb-harness/file-lock";
import type {TextRef} from "@notnotype/nb-ui/text";

import type {BackgroundTasks, TaskHandle} from "nbook/plugins/tasks/shared/contracts";

import type {SkillInitPlan} from "../../shared/skills";
import {agentText} from "../../shared/text";
import type {SkillItem} from "./catalog";
import {currentPlatform, installInputs, LOCK_FILE, MARKER_FILE, MARKER_SCHEMA, PACKAGE_FILE} from "./readiness";
import type {SkillDepsMarker} from "./readiness";

/** 一次安装至多这么久，超时按失败算（skills.md 输出 19）。 */
export const INSTALL_TIMEOUT_MS = 10 * 60_000;
/** 失败原因只留安装输出的最后这么多行。 */
const OUTPUT_TAIL_LINES = 12;

export type SkillInitCode = "skill-not-found" | "not-initializable" | "busy" | "lock-missing" | "install-failed" | "interrupted";
export type SkillInitResult = {readonly ok: true} | {readonly ok: false; readonly code: SkillInitCode; readonly detail?: string};


export interface SkillInstallerOptions {
    readonly item: (id: string) => SkillItem | undefined;
    /** 状态变了（开始、结束）时重扫这个 Skill，目录里显示“正在初始化”或新的结果。 */
    readonly refresh: (id: string) => Promise<void>;
    /** 放锁文件的目录（状态根下 `agent/skills/locks`）。 */
    readonly locksRoot: string;
    /** 执行安装的 Bun（应用自己的 `process.execPath`）。 */
    readonly bun: string;
    readonly clock: RuntimeClock;
    readonly timeoutMs?: number;
    /** 应用里的后台任务（skills.md 输出 29）；命令行在另一个进程里，不给。 */
    readonly tasks?: BackgroundTasks;
}

const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";

async function readJson(path: string, parse: (text: string) => unknown): Promise<unknown> {
    try {
        return parse(await readFile(path, "utf8"));
    } catch (error) {
        if (missing(error)) return undefined;
        return null;
    }
}

const tail = (text: string): string => text.trimEnd().split("\n").slice(-OUTPUT_TAIL_LINES).join("\n");

/** 确认框与后台任务的进展用的内容：有锁时是锁里的包数，两种都列直接依赖。 */
async function planOf(directory: string): Promise<SkillInitPlan> {
    const manifest = await readJson(join(directory, PACKAGE_FILE), (text) => JSON.parse(text)) as {dependencies?: Record<string, unknown>; optionalDependencies?: Record<string, unknown>} | null | undefined;
    const dependencies = [...Object.keys(manifest?.dependencies ?? {}), ...Object.keys(manifest?.optionalDependencies ?? {})];
    const lock = await readJson(join(directory, LOCK_FILE), (text) => Bun.JSONC.parse(text));
    if (lock === undefined) return {lock: false, dependencies};
    const packages = typeof lock === "object" && lock !== null && "packages" in lock && typeof lock.packages === "object" && lock.packages !== null ? Object.keys(lock.packages).length : null;
    return {lock: true, packages, dependencies};
}

/**
 * 按安装的结果结束任务（skills.md 输出 29）。中断有两种：用户取消（任务的 `signal` 以 `cancelled` abort）结束为已取消；应用停止时
 * 不动它，由后台任务在 Agent 入口停止之后转成已中断。`outcome` 为空是安装中途抛错，按失败算。
 */
function finishTask(task: TaskHandle, outcome: SkillInitResult | undefined): void {
    if (outcome?.ok === true) {
        task.succeed(agentText("skills.task.ready"));
        return;
    }
    if (outcome?.code === "interrupted") {
        if (task.signal.reason === "cancelled") task.cancelled();
        return;
    }
    const detail = outcome?.code === "install-failed" ? outcome.detail : undefined;
    task.fail({message: agentText("skills.task.failed"), ...(detail === undefined ? {} : {detail})});
}

/** 后台任务的进展：窗口按界面语言翻文字引用（background-tasks.md 的“输入与前置条件”）。 */
function installingText(plan: SkillInitPlan): TextRef {
    if (!plan.lock) return agentText("skills.task.resolving");
    return plan.packages === null ? agentText("skills.task.installingUnknown") : agentText("skills.task.installing", {count: plan.packages});
}

export class SkillInstaller {
    readonly #options: SkillInstallerOptions;
    /** 本进程正在进行的安装，按 id。 */
    readonly #running = new Map<string, Promise<SkillInitResult>>();
    /** 正在进行的安装的中止器：停止时一起中止。 */
    readonly #aborts = new Set<AbortController>();
    #stopped = false;

    constructor(options: SkillInstallerOptions) {
        this.#options = options;
    }

    /** 这个 Skill 正在初始化：本进程在装，或别的进程拿着它的锁。 */
    installing(id: string): boolean {
        if (this.#running.has(id)) return true;
        let lock: ReturnType<typeof tryLock>;
        try {
            lock = this.#tryLock(id);
        } catch {
            // 锁目录还没建（从没装过），或锁文件打不开：按没人在装算，真正初始化时再报。
            return false;
        }
        if (lock === null) return true;
        lock.release();
        return false;
    }

    async plan(id: string): Promise<{readonly ok: true; readonly plan: SkillInitPlan} | {readonly ok: false; readonly code: "skill-not-found" | "not-initializable"}> {
        const checked = await this.#initializable(id);
        if (!checked.ok) return checked;
        return {ok: true, plan: await planOf(checked.item.directory)};
    }

    /** 初始化；本进程已在装就交回那一次的结果。`resolve` 为真时允许在没有 `bun.lock` 时解析并生成它。 */
    init(id: string, options: {readonly resolve?: boolean} = {}): Promise<SkillInitResult> {
        const running = this.#running.get(id);
        if (running !== undefined) return running;
        if (this.#stopped) return Promise.resolve({ok: false, code: "interrupted"});
        // 中止器在同步段里就登记：`stop()` 或取消在拿锁、起子进程之前到达时，后面每一步都看得到。
        const abort = new AbortController();
        this.#aborts.add(abort);
        // 先移出“在装”再重扫：重扫按 `installing` 算状态，还在表里会一直显示“正在初始化”。
        const work = this.#init(id, options.resolve === true, abort).finally(async () => {
            this.#aborts.delete(abort);
            this.#running.delete(id);
            await this.#options.refresh(id);
        });
        this.#running.set(id, work);
        return work;
    }

    /** 中止正在进行的安装（应用停止、命令行收到中断），等它们收尾（写下 `interrupted`、放锁）。 */
    async stop(): Promise<void> {
        this.#stopped = true;
        for (const abort of this.#aborts) abort.abort();
        await Promise.allSettled([...this.#running.values()]);
    }

    async #initializable(id: string): Promise<{readonly ok: true; readonly item: SkillItem} | {readonly ok: false; readonly code: "skill-not-found" | "not-initializable"}> {
        const item = this.#options.item(id);
        if (item === undefined) return {ok: false, code: "skill-not-found"};
        if (item.entry.source !== "user" || item.entry.status === "invalid") return {ok: false, code: "not-initializable"};
        const manifest = await readFile(join(item.directory, PACKAGE_FILE), "utf8").then(() => true, () => false);
        return manifest ? {ok: true, item} : {ok: false, code: "not-initializable"};
    }

    #tryLock(id: string) {
        return tryLock(join(this.#options.locksRoot, `${id}.lock`));
    }

    async #init(id: string, resolve: boolean, abort: AbortController): Promise<SkillInitResult> {
        const checked = await this.#initializable(id);
        if (!checked.ok) return checked;
        const {directory} = checked.item;
        const hasLock = await readFile(join(directory, LOCK_FILE), "utf8").then(() => true, () => false);
        if (!hasLock && !resolve) return {ok: false, code: "lock-missing"};
        await mkdir(this.#options.locksRoot, {recursive: true});
        // 还没开始装就被停下：不拿锁、不写标记。
        if (abort.signal.aborted) return {ok: false, code: "interrupted"};
        const lock = this.#tryLock(id);
        if (lock === null) return {ok: false, code: "busy"};
        // 拿到锁之后的每一步都在 try 里，锁只在 finally 放。写完标记才算有结果：中途抛错时任务按失败收尾，不留一件一直在跑的。
        let task: TaskHandle | null = null;
        let outcome: SkillInitResult | undefined;
        try {
            // 拿到锁才登记：并入的请求、`busy`、`lock-missing` 都不是一次安装，不进清单。
            task = await this.#startTask(checked.item, resolve, abort);
            await this.#options.refresh(id);
            const result = await this.#run(directory, hasLock, abort.signal);
            const error: SkillDepsMarker["error"] = result.ok ? undefined : result.code === "interrupted" ? {code: "interrupted"} : {code: "install-failed", detail: result.detail ?? ""};
            await this.#writeMarker(directory, error);
            outcome = result;
            return result;
        } finally {
            lock.release();
            if (task !== null) finishTask(task, outcome);
        }
    }

    /** skills.md 输出 29：用户取消就中止安装；`nbook.tasks` 自己停止时（reason `interrupted`）安装照常进行。 */
    async #startTask(item: SkillItem, resolve: boolean, abort: AbortController): Promise<TaskHandle | null> {
        const tasks = this.#options.tasks;
        if (tasks === undefined) return null;
        const handle = tasks.start({
            title: agentText("skills.task.title", {name: item.entry.name}),
            message: installingText(await planOf(item.directory)),
            cancellable: true,
            // 重试只在拿到锁时登记新的一件；别处正在装、锁文件没了、Skill 不在了这些结果没有新任务可看，抛出让后台任务记诊断
            // （background-tasks.md 的“失败与恢复”）。
            retry: async () => {
                const result = await this.init(item.entry.id, {resolve});
                if (!result.ok && result.code !== "install-failed" && result.code !== "interrupted") throw new Error(`skill init retry for ${item.entry.id}: ${result.code}`);
            },
        });
        handle.signal.addEventListener("abort", () => {
            if (handle.signal.reason === "cancelled") abort.abort();
        }, {once: true});
        return handle;
    }

    async #run(directory: string, frozen: boolean, signal: AbortSignal): Promise<SkillInitResult> {
        // 在已中止的 signal 上挂监听不会再触发：起子进程前先看一眼。
        if (signal.aborted) return {ok: false, code: "interrupted"};
        const command = [this.#options.bun, "install", ...(frozen ? ["--frozen-lockfile"] : []), "--ignore-scripts"];
        const child = Bun.spawn(command, {cwd: directory, stdin: "ignore", stdout: "pipe", stderr: "pipe"});
        let timedOut = false;
        const cancelTimer = this.#options.clock.schedule(() => {
            timedOut = true;
            child.kill("SIGKILL");
        }, this.#options.timeoutMs ?? INSTALL_TIMEOUT_MS);
        const onAbort = () => child.kill("SIGKILL");
        signal.addEventListener("abort", onAbort, {once: true});
        try {
            const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
            if (signal.aborted) return {ok: false, code: "interrupted"};
            if (timedOut) return {ok: false, code: "install-failed", detail: tail(`${stdout}\n${stderr}\ninstall timed out`)};
            return exitCode === 0 ? {ok: true} : {ok: false, code: "install-failed", detail: tail(`${stdout}\n${stderr}`)};
        } finally {
            cancelTimer();
            signal.removeEventListener("abort", onAbort);
        }
    }

    /** 成功写下现状的输入（生成锁文件的那次也按装完后的锁算）；失败写原因。 */
    async #writeMarker(directory: string, error: SkillDepsMarker["error"]): Promise<void> {
        const marker: SkillDepsMarker = {
            schema: MARKER_SCHEMA,
            runtime: "bun",
            inputs: (await installInputs(directory)) ?? "",
            platform: currentPlatform(),
            bun: Bun.version,
            installedAt: new Date(this.#options.clock.now()).toISOString(),
            ...(error === undefined ? {} : {error}),
        };
        await mkdir(join(directory, "node_modules"), {recursive: true});
        await writeFile(join(directory, MARKER_FILE), `${JSON.stringify(marker, null, 4)}\n`);
    }
}
