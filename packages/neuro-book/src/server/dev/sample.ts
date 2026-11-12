/**
 * 开发模式的样例作品：后端带着 `NBDEV_SAMPLE=1` 启动时，运行实例可用之后在后台放一部样例作品，并在标准输出报告结果：
 * 成功打一行 `[dev] open-path <同源路径>`（打开它的地址），失败或超时打一行 `[dev] sample-failed <原因>`，服务照常运行。
 * 这两种行是与 nbdev 的约定（packages/dev-panel/docs/cli.md 的“开发服务、worktree、查找与截图”）。
 *
 * 只经后端自己的登记表实例写登记表，所以“登记表只由服务端进程写入”（docs/specs/runtime/projects.md 输出第 1、2 条）
 * 不变；一个状态根只跑一个后端（runtime.server-host 的实例认领），登记表只有这一个写者。
 *
 * 样例作品是 `<包目录>/.dev-sample/sample/`（被 Git 忽略），按登记表里的路径认出它，不按短名：短名 `sample` 可能已经
 * 是用户自己的另一部作品，不能往那里补样例文件。内容从本目录的 `sample/` 复制，只补缺少的文件，不覆盖在样例里改过的。
 *
 * 只由开发入口（`../development-main.ts`）装配；生产入口不读 `NBDEV_SAMPLE`，产品构建不含本模块。
 */

import {mkdir, readdir, readFile, realpath, stat, writeFile} from "node:fs/promises";
import {basename, dirname, join, relative} from "node:path";

import {describe} from "@notnotype/nb-file-lock";

import {projectUrl} from "nbook/plugins/projects/shared/project-url";
import type {ProjectRecord} from "nbook/shared/projects";

import {checkProjectDirectory, ensureParentDirectory, readProjectIdentity, writeProjectIdentity} from "../projects/identity";
import type {ProjectPathOptions} from "../projects/identity";
import {isAbortedBy} from "../projects/registry";
import type {ProjectRegistry} from "../projects/registry";

/** 开关样例的环境变量，只由 nbdev 设置（`nbdev dev start --sample`）。 */
export const DEV_SAMPLE_ENV = "NBDEV_SAMPLE";
/** 样例作品的父目录（相对包目录）与目录名；目录名即书名，短名由目录名得出，没被占用时就是 `sample`。 */
export const DEV_SAMPLE_PARENT = ".dev-sample";
export const DEV_SAMPLE_DIRECTORY = "sample";
const DEV_SAMPLE_DESCRIPTION = "样例作品：nbdev dev start --sample 放的原创短篇，用来在开发服务里打开工作台。";
/** 入库的样例内容。 */
const CONTENT_ROOT = join(import.meta.dir, "sample");

/** 放样例的总截止：到点打 `sample-failed`，后面的写入不再执行。 */
export const DEV_SAMPLE_TIMEOUT_MS = 30_000;
/** 停止序列等样例任务结束的截止：文件操作卡住时不拖住停止。 */
export const DEV_SAMPLE_STOP_MS = 5_000;

export function devSampleEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
    return env[DEV_SAMPLE_ENV] === "1";
}

export type DevSampleResult = {readonly ok: true; readonly openPath: string; readonly project: ProjectRecord} | {readonly ok: false; readonly reason: string};

export interface DevSampleOptions {
    readonly stateRoot: string;
    readonly packageRoot: string;
    /**
     * abort 之后不再开始新的写入步骤；已开始的那一步照常完成。一路传进登记表与建目录的操作（`ProjectWriteOptions`），
     * 所以卡在登记内部的读写返回之后也不再写。
     */
    readonly signal: AbortSignal;
}

const ABORTED_REASON = "样例任务已取消";

function code(error: unknown): string | undefined {
    return (error as NodeJS.ErrnoException | null)?.code;
}

/**
 * 放样例并返回打开它的路径。只有意料之外的文件系统错误会 reject；登记表无效、目录在状态根里、身份冲突这类都以
 * `ok: false` 交回原因，不改登记表与已有的身份文件。
 */
export async function seedDevSample(registry: ProjectRegistry, options: DevSampleOptions): Promise<DevSampleResult> {
    try {
        return await seed(registry, options);
    } catch (error) {
        if (isAbortedBy(options.signal, error)) return {ok: false, reason: ABORTED_REASON};
        throw error;
    }
}

async function seed(registry: ProjectRegistry, options: DevSampleOptions): Promise<DevSampleResult> {
    const {signal} = options;
    const paths: ProjectPathOptions = {stateRoot: options.stateRoot, cwd: options.packageRoot};
    const parent = join(options.packageRoot, DEV_SAMPLE_PARENT);
    const listed = await registry.list();
    if (!listed.ok) return {ok: false, reason: `项目登记表无效，不改它：${listed.detail}`};
    // 登记表里记的是解析过符号链接的真实路径（`.dev-sample` 或 `sample` 可能是链接）；样例目录被删时解析还在的那一级。
    const expected = await realpathAllowMissing(join(options.packageRoot, DEV_SAMPLE_PARENT, DEV_SAMPLE_DIRECTORY));
    const existing = listed.value.find((project) => project.path === expected);
    let project: ProjectRecord;
    if (existing === undefined) {
        signal.throwIfAborted();
        // 父目录的规则（不存在就建、拒绝状态根和状态根里面的位置）由 create 自己执行。
        const created = await registry.create({title: DEV_SAMPLE_DIRECTORY, description: DEV_SAMPLE_DESCRIPTION, parent}, {signal});
        if (created.ok) {
            project = created.project;
        } else if (created.reason === "exists") {
            // 目录还在、登记丢了（例如换了状态根）：按登记的规则接回来，身份文件在就沿用它的 id。
            const registered = await registry.register(created.path, {signal});
            if (!registered.ok) return {ok: false, reason: `登记已有的样例目录失败（${registered.reason}）：${registered.detail}`};
            project = registered.project;
        } else {
            return {ok: false, reason: `新建样例作品失败（${created.reason}）：${created.detail}`};
        }
    } else {
        const restored = await restore(registry, existing, parent, paths, signal);
        if (!restored.ok) return restored;
        project = restored.project;
    }
    await copyMissing(CONTENT_ROOT, project.path, signal);
    return {ok: true, openPath: projectUrl(project.name), project};
}

/**
 * 路径的真实路径；末尾几级还不存在时，解析最近一级还在的祖先，再拼上其余各级。这样样例目录被删、父目录是符号链接时，
 * 拼出的仍是登记表里记的那个真实路径。
 */
async function realpathAllowMissing(path: string): Promise<string> {
    try {
        return await realpath(path);
    } catch (error) {
        if (code(error) !== "ENOENT" && code(error) !== "ENOTDIR") throw error;
        const up = dirname(path);
        if (up === path) throw error;
        return join(await realpathAllowMissing(up), basename(path));
    }
}

/**
 * 登记表里已有样例：目录在，先按打开作品的同一套规则校验它（状态根换到了它上方时不在那里补文件），再核对身份文件，
 * 对得上就沿用，缺了按登记的 id 修复；目录没了按原 id 重建。
 */
async function restore(
    registry: ProjectRegistry,
    existing: ProjectRecord,
    parent: string,
    paths: ProjectPathOptions,
    signal: AbortSignal,
): Promise<{readonly ok: true; readonly project: ProjectRecord} | {readonly ok: false; readonly reason: string}> {
    if (!(await isDirectory(existing.path))) {
        signal.throwIfAborted();
        // 与新建时同一套父目录规则：状态根换到了样例目录上方时不在那里建。
        const checked = await ensureParentDirectory(parent, paths, signal);
        if (!checked.ok) return {ok: false, reason: `样例目录不能放在这里（${checked.reason}）：${checked.detail}`};
        signal.throwIfAborted();
        await mkdir(existing.path, {recursive: true});
        const written = await writeProjectIdentity(existing.path, existing.id, signal);
        if (written.status !== "found" || written.id !== existing.id) return {ok: false, reason: `重建样例目录的身份文件失败：${written.status === "invalid" ? written.detail : "读回的 id 与登记表不一致"}`};
    } else {
        // 打开作品时也做这项校验（`manager.ts`）：校验不过的目录打不开，不在那里补文件、不报 open-path。
        const checked = await checkProjectDirectory(existing.path, paths);
        if (!checked.ok) return {ok: false, reason: `样例目录不能作为作品打开（${checked.reason}）：${checked.detail}`};
        const identity = await readProjectIdentity(existing.path);
        if (identity.status === "invalid") return {ok: false, reason: `样例目录的身份文件损坏，不覆盖它：${identity.detail}`};
        if (identity.status === "found" && identity.id !== existing.id) {
            return {ok: false, reason: `样例目录的身份文件写的是 ${identity.id}，登记表里是 ${existing.id}；不覆盖`};
        }
        if (identity.status === "found") return {ok: true, project: existing};
    }
    // 身份文件缺失时，登记会按登记表里的 id 重建它（projects.md 输出第 1 条）。
    const registered = await registry.register(existing.path, {signal});
    if (!registered.ok) return {ok: false, reason: `修复样例作品的登记失败（${registered.reason}）：${registered.detail}`};
    return registered;
}

async function isDirectory(path: string): Promise<boolean> {
    try {
        return (await stat(path)).isDirectory();
    } catch (error) {
        if (code(error) === "ENOENT" || code(error) === "ENOTDIR") return false;
        throw error;
    }
}

/** 把样例内容复制进作品目录：目标已有的文件（含用户改过的）不动，只建缺少的。 */
async function copyMissing(source: string, target: string, signal: AbortSignal): Promise<void> {
    for (const entry of await readdir(source, {withFileTypes: true})) {
        const from = join(source, entry.name);
        const to = join(target, entry.name);
        if (entry.isDirectory()) {
            signal.throwIfAborted();
            await mkdir(to, {recursive: true});
            await copyMissing(from, to, signal);
            continue;
        }
        if (!entry.isFile()) throw new Error(`样例内容里只能有文件和目录：${relative(CONTENT_ROOT, from)}`);
        const text = await readFile(from);
        signal.throwIfAborted();
        try {
            await writeFile(to, text, {flag: "wx"});
        } catch (error) {
            // 已有同名的东西：是用户的版本（或用户把它换成了目录），都不动。
            if (code(error) !== "EEXIST") throw error;
        }
    }
}

export interface DevSampleTask {
    /** abort 样例任务并等它结束，至多等 `stopMs`；之后不再报告结果。 */
    stop(): Promise<void>;
}

export interface StartDevSampleOptions {
    readonly registry: ProjectRegistry;
    readonly stateRoot: string;
    readonly packageRoot: string;
    /** 写一行到标准输出（`[dev] open-path …`、`[dev] sample-failed …`）。 */
    readonly report: (line: string) => void;
    readonly timeoutMs?: number;
    readonly stopMs?: number;
}

/**
 * 在后台放样例。结果至多报告一次：先到截止就报超时并 abort，任务之后的结果不再报告；停止开始后什么都不报，
 * 免得被 nbdev 当成这一代后端的结果。
 */
export function startDevSample(options: StartDevSampleOptions): DevSampleTask {
    const timeoutMs = options.timeoutMs ?? DEV_SAMPLE_TIMEOUT_MS;
    const stopMs = options.stopMs ?? DEV_SAMPLE_STOP_MS;
    const controller = new AbortController();
    let reported = false;
    const report = (line: string): void => {
        if (reported) return;
        reported = true;
        options.report(line);
    };
    const timer = setTimeout(() => {
        report(`[dev] sample-failed 超时（${String(timeoutMs / 1000)} 秒内没有放好样例）`);
        controller.abort();
    }, timeoutMs);
    const task = seedDevSample(options.registry, {stateRoot: options.stateRoot, packageRoot: options.packageRoot, signal: controller.signal}).then(
        (result) => report(result.ok ? `[dev] open-path ${result.openPath}` : `[dev] sample-failed ${result.reason}`),
        (error: unknown) => report(`[dev] sample-failed ${describe(error)}`),
    ).finally(() => clearTimeout(timer));
    return {
        async stop() {
            reported = true;
            clearTimeout(timer);
            controller.abort();
            let cancel = (): void => undefined;
            const deadline = new Promise<"deadline">((resolve) => {
                const handle = setTimeout(() => resolve("deadline"), stopMs);
                cancel = () => clearTimeout(handle);
            });
            try {
                if ((await Promise.race([task, deadline])) === "deadline") {
                    process.stderr.write(`[dev] sample-abandoned 停止时样例任务 ${String(stopMs / 1000)} 秒内没有结束，不再等它\n`);
                }
            } finally {
                cancel();
            }
        },
    };
}
