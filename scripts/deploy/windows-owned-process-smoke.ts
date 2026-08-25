#!/usr/bin/env bun
import {access, mkdir, mkdtemp, readFile, realpath, rm} from "node:fs/promises";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {basename, dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";

import {AgentJobManager} from "nbook/server/agent/jobs/agent-job-manager";
import {runBash} from "nbook/server/agent/tools/file-tools";

const {values} = parseArgs({
    args: Bun.argv.slice(2),
    options: {
        bash: {type: "string"},
    },
    strict: true,
});
if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("Windows Owned Process smoke仅支持Windows x64。");
}
const bash = values.bash ? resolve(values.bash) : await defaultGitBash();
// Bun 1.3.14 在 Windows 8.3 短路径上删除曾作为子进程 cwd 的目录会误报 EBUSY。
const systemTempRoot = await realpath(tmpdir());
// 终止在 fixture 就绪后才武装：timeout 场景先持树观察 8 秒再 abort，
// 验证杀树/端口释放/错误分类；CI 冷启动速度不再影响判定。
const OWNED_PROCESS_HOLD_SECONDS = 8;
const delegatedRoot = process.env.NEURO_BOOK_WINDOWS_OWNED_SMOKE_ROOT;
if (!delegatedRoot) {
    const root = await mkdtemp(join(systemTempRoot, "nbook-windows-owned-smoke-"));
    const worker = Bun.spawn([
        process.execPath,
        fileURLToPath(import.meta.url),
        "--bash",
        bash,
    ], {
        cwd: process.cwd(),
        env: {...process.env, NEURO_BOOK_WINDOWS_OWNED_SMOKE_ROOT: root},
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    });
    let exitCode = 1;
    try {
        exitCode = await worker.exited;
    } finally {
        await rm(root, {recursive: true, force: true});
    }
    process.exitCode = exitCode;
} else {
    const root = await realpath(delegatedRoot);
    if (dirname(root).toLowerCase() !== systemTempRoot.toLowerCase()
        || !basename(root).startsWith("nbook-windows-owned-smoke-")) {
        throw new Error(`Windows Owned Process worker root非法：${root}`);
    }
    const agentBin = join(root, "agent-bin");
    await mkdir(agentBin, {recursive: true});
    await verifyTermination("timeout", bash, root, agentBin);
    await verifyTermination("abort", bash, root, agentBin);
    await verifyBackgroundTermination("cancel", bash, root, agentBin);
    await verifyBackgroundTermination("shutdown", bash, root, agentBin);
    console.log(JSON.stringify({status: "passed", bash, runtime: process.execPath}));
}

/** 验证后台Job cancel与Harness使用的shutdown seam都会等待Bash进程树收口。 */
async function verifyBackgroundTermination(
    reason: "cancel" | "shutdown",
    bash: string,
    root: string,
    agentBin: string,
): Promise<void> {
    const statePath = join(root, `background-${reason}.json`);
    const fixture = resolve(import.meta.dir, "..", "..", "packages", "neuro-book", "server", "agent", "tools", "fixtures", "owned-process-root.ts");
    const command = [process.execPath, fixture, statePath]
        .map((path) => `'${windowsPathForBash(path).replaceAll("'", "'\\''")}'`)
        .join(" ");
    const jobs = new AgentJobManager(() => {
        throw new Error("Owned Process smoke不应投递后台结果。");
    }, "");
    const spawned = jobs.spawn({
        kind: "bash",
        title: `owned-process-${reason}`,
        deliver: "none",
        run: async (context) => {
            await runBash({
                bash,
                command,
                cwd: root,
                env: {
                    ...process.env,
                    NEURO_BOOK_AGENT_BIN: agentBin,
                    NEURO_BOOK_SYSTEM_AGENT_BIN: agentBin,
                    NEURO_BOOK_RIPGREP_CONFIG: join(root, "ripgreprc"),
                },
                signal: context.signal,
                onData() {},
            });
            return {resultPreview: "unexpected completion"};
        },
    });
    const state = await waitForState(statePath);

    if (reason === "cancel") await jobs.cancel(spawned.job.jobId);
    else await jobs.shutdown();
    await jobs.waitIdle();

    const snapshot = await jobs.get(spawned.job.jobId);
    if (snapshot?.status !== "cancelled") {
        throw new Error(`后台${reason}状态未收口：${JSON.stringify(snapshot)}`);
    }
    await waitForPidExit(state.pid);
    await waitForPortRelease(state.port);
}

/** 用真实Git Bash验证timeout/abort都会清理持有端口的孙进程。 */
async function verifyTermination(
    reason: "timeout" | "abort",
    bash: string,
    root: string,
    agentBin: string,
): Promise<void> {
    const statePath = join(root, `${reason}.json`);
    const fixture = resolve(import.meta.dir, "..", "..", "packages", "neuro-book", "server", "agent", "tools", "fixtures", "owned-process-root.ts");
    const command = [process.execPath, fixture, statePath]
        .map((path) => `'${windowsPathForBash(path).replaceAll("'", "'\\''")}'`)
        .join(" ");
    const controller = new AbortController();
    const execution = runBash({
        bash,
        command,
        cwd: root,
        env: {
            ...process.env,
            NEURO_BOOK_AGENT_BIN: agentBin,
            NEURO_BOOK_SYSTEM_AGENT_BIN: agentBin,
            NEURO_BOOK_RIPGREP_CONFIG: join(root, "ripgreprc"),
        },
        signal: controller.signal,
        onData() {},
    });
    let state: {pid: number; port: number};
    try {
        // 就绪期限给足 CI 冷启动（Bun + 模块链）；执行本身不带 timeout，
        // 因此就绪失败时必须显式 abort 并等待 Bash 收口，避免留下持有
        // 端口的进程树后删除其工作目录。
        state = await Promise.race([
            waitForState(statePath, 30_000),
            execution.then(
                () => Promise.reject(new Error(`${reason}在fixture就绪前意外完成。`)),
                (error) => Promise.reject(error),
            ),
        ]);
    } catch (error) {
        controller.abort();
        await execution.catch(() => undefined);
        throw error;
    }
    // 终止只在 fixture 就绪（状态文件已写出）之后武装：CI 冷启动再慢也不会
    // 让 runBash 的超时拒绝抢在就绪前赢得竞态。timeout 场景先持树观察窗口，
    // 再显式 abort，验证与 abort 完全相同的杀树/端口释放/错误分类语义。
    if (reason === "timeout") {
        await Bun.sleep(OWNED_PROCESS_HOLD_SECONDS * 1000);
        controller.abort();
    } else {
        controller.abort();
    }

    let message = "";
    try {
        await execution;
        throw new Error(`${reason}没有拒绝Bash执行。`);
    } catch (error) {
        message = error instanceof Error ? error.message : String(error);
    }
    if (!message.includes("Command aborted")) throw new Error(`${reason}错误分类不正确：${message}`);
    await waitForPidExit(state.pid);
    await waitForPortRelease(state.port);
}

/** 默认使用宿主Git Bash；Release门禁总是显式传入PortableGit。 */
async function defaultGitBash(): Promise<string> {
    const candidates = [
        process.env.ProgramFiles ? join(process.env.ProgramFiles, "Git", "bin", "bash.exe") : "",
        process.env.USERPROFILE ? join(process.env.USERPROFILE, "scoop", "apps", "git", "current", "bin", "bash.exe") : "",
    ].filter(Boolean);
    for (const candidate of candidates) {
        try {
            await access(candidate);
            return candidate;
        } catch {
            // 继续检查下一个标准安装位置。
        }
    }
    throw new Error("未找到Git Bash，必须显式传--bash。 ");
}

/** 把Windows绝对路径转为Git Bash路径。 */
function windowsPathForBash(path: string): string {
    const normalized = path.replaceAll("\\", "/");
    const drive = /^([A-Za-z]):\/(.*)$/u.exec(normalized);
    return drive ? `/${drive[1]?.toLowerCase()}/${drive[2]}` : normalized;
}

/** 等待fixture写出孙进程PID与监听端口。 */
async function waitForState(path: string, deadlineMs = 30_000): Promise<{pid: number; port: number}> {
    const deadline = Date.now() + deadlineMs;
    while (Date.now() < deadline) {
        try {
            return JSON.parse(await readFile(path, "utf8")) as {pid: number; port: number};
        } catch {
            await Bun.sleep(25);
        }
    }
    throw new Error(`等待Owned Process fixture超时：${path}`);
}

/** 等待孙进程退出。 */
async function waitForPidExit(pid: number): Promise<void> {
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
        try {
            process.kill(pid, 0);
        } catch {
            return;
        }
        await Bun.sleep(25);
    }
    throw new Error(`Owned Process孙进程仍存活：${pid}`);
}

/** Windows强杀后允许端口表在有界窗口内完成资源收口。 */
async function waitForPortRelease(port: number): Promise<void> {
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
        try {
            await bindPort(port);
            return;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
            await Bun.sleep(25);
        }
    }
    throw new Error(`Owned Process端口仍未释放：${port}`);
}

/** 尝试独占监听fixture端口。 */
async function bindPort(port: number): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
        const server = createServer();
        server.once("error", rejectPromise);
        server.listen(port, "127.0.0.1", () => server.close(() => resolvePromise()));
    });
}
