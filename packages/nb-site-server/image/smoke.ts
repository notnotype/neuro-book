/**
 * 镜像的冒烟（包脚本 `smoke:image`）：对 `build:image` 打好的镜像起真容器，核对部署时会碰到的几件事。
 *
 * 1. 挂宿主的临时目录、以宿主的 uid 跑（容器写出的文件宿主删得掉；CI 的 runner 不是 uid 1000）：就绪检查 200，
 *    数据目录里有每个模块的锁文件；第二个容器挂同一个目录时以 `data_dir_busy` 退出，证明打成单文件之后 nb-flock
 *    （bun:ffi 加载 libc 的 flock）在容器里照样起作用。`docker stop` 之后退出码 0、日志里有 `site.stopped`：
 *    bun 是 1 号进程，内核不替 1 号进程执行信号的缺省动作，这一步证明进程自己处理了 SIGTERM。
 * 2. 不带 `--user`、挂一个新的命名卷：镜像里的 `/data` 属于 bun 用户，卷照它初始化，进程能写；同样就绪、停止后退出码 0。
 * 3. 给容器设 `NB_SITE_TEST_CONTROL`：镜像监听 0.0.0.0，进程以 `config_invalid` 拒绝，问题是 `NB_SITE_HOST` 的 `not_loopback`。
 *
 * 用法：`bun run smoke:image [--tag <名字>]`，缺省 `nb-site:local`。起过的容器、卷与临时目录在 finally 里删掉，失败时也删。
 * 会话密钥与测试控制口令每次随机生成，经 `docker run -e 名字`（不带值）从本进程的环境传进去，不出现在命令行与输出里。
 */

import {randomBytes} from "node:crypto";
import {mkdir, readdir, rm} from "node:fs/promises";
import {join} from "node:path";
import {parseArgs} from "node:util";

import {resolveAgentScratchPath} from "@notnotype/neuro-book-test-support/paths";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

const {values} = parseArgs({
    args: process.argv.slice(2),
    options: {tag: {type: "string", default: "nb-site:local"}},
    strict: true,
});
const IMAGE = values.tag;
/** 停止宽限按 nb-site-server/AGENTS.md 部署一节的公式：停止时限（缺省 10 秒）加 2 秒乘（模块数加 1），再留 1 秒。 */
const STOP_GRACE_SECONDS = 17;
const READY_TIMEOUT_MS = 30_000;

interface Docker {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
}

const runId = `${String(process.pid)}-${randomBytes(4).toString("hex")}`;
/** 只经 `-e 名字` 传给容器的环境：值留在本进程的环境里，不进 docker 的命令行。 */
const secretEnv: Record<string, string> = {
    NB_SITE_SESSION_SECRET: randomBytes(24).toString("hex"),
    NB_SITE_TEST_CONTROL: randomBytes(24).toString("hex"),
};
const containers: string[] = [];
const volumes: string[] = [];

async function docker(args: readonly string[]): Promise<Docker> {
    const child = Bun.spawn(["docker", ...args], {stdout: "pipe", stderr: "pipe", env: {...process.env, ...secretEnv}});
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return {exitCode, stdout, stderr};
}

async function dockerOk(args: readonly string[]): Promise<string> {
    const result = await docker(args);
    if (result.exitCode !== 0) throw new Error(`docker ${args[0] ?? ""} exited with ${String(result.exitCode)}: ${result.stderr.trim()}`);
    return result.stdout.trim();
}

async function removeOrReport(args: readonly string[]): Promise<void> {
    const result = await docker(args);
    if (result.exitCode !== 0) console.error(`cleanup: docker ${args.join(" ")} exited with ${String(result.exitCode)}: ${result.stderr.trim()}`);
}

function containerName(label: string): string {
    const name = `nb-site-smoke-${runId}-${label}`;
    containers.push(name);
    return name;
}

/** 合格的站点配置；会话密钥只写名字，值从环境来。 */
const SITE_ENV = ["-e", "NB_SITE_URL=https://site.test", "-e", "NB_SITE_TELEMETRY_URL=https://telemetry.test", "-e", "NB_SITE_SESSION_SECRET"];

/** 标准错误里最后一行 JSON 失败行。 */
function failureLine(stderr: string): {code?: unknown; problems?: unknown} | null {
    const lines = stderr.trim().split("\n").filter((line) => line.startsWith("{"));
    const last = lines.at(-1);
    return last === undefined ? null : (JSON.parse(last) as {code?: unknown; problems?: unknown});
}

function check(condition: boolean, message: string): void {
    if (!condition) throw new Error(`smoke failed: ${message}`);
}

/** 起一个后台容器，等到就绪检查 200，返回容器名。 */
async function startServing(label: string, mount: readonly string[]): Promise<string> {
    const name = containerName(label);
    await dockerOk(["run", "--detach", "--name", name, "--publish", "127.0.0.1:0:8080", ...mount, ...SITE_ENV, IMAGE]);
    const hostPort = (await dockerOk(["port", name, "8080/tcp"])).split("\n")[0]!;
    await waitUntil(`${label}: /health/ready returns 200`, async () => {
        const state = await dockerOk(["inspect", "--format", "{{.State.Running}}", name]);
        if (state !== "true") throw new Error(`${label}: container exited before becoming ready\n${(await docker(["logs", name])).stderr}`);
        // 进程还没监听时连接被拒是预期的，当作“还没就绪”再查；进程退出由上面的 Running 判断报出来。
        const response = await fetch(`http://${hostPort}/health/ready`).catch(() => null);
        return response?.status === 200;
    }, {timeoutMs: READY_TIMEOUT_MS, intervalMs: 200});
    console.log(`${label}: ready on ${hostPort}`);
    return name;
}

/** `docker stop` 之后核对退出码 0 与日志里的 `site.stopped`。 */
async function stopCleanly(label: string, name: string): Promise<void> {
    await dockerOk(["stop", "--time", String(STOP_GRACE_SECONDS), name]);
    const exitCode = await dockerOk(["inspect", "--format", "{{.State.ExitCode}}", name]);
    const logs = await docker(["logs", name]);
    const events = logs.stdout.split("\n").filter((line) => line.startsWith("{")).map((line) => (JSON.parse(line) as {event?: unknown}).event);
    check(exitCode === "0", `${label}: exit code after docker stop is ${exitCode}, expected 0`);
    check(events.includes("site.stopped"), `${label}: no site.stopped in the log after docker stop`);
    console.log(`${label}: stopped with exit code 0 and site.stopped`);
}

const dataDir = resolveAgentScratchPath("nb-site-smoke-image", runId);
try {
    await mkdir(dataDir, {recursive: true});
    const uid = process.getuid?.();
    const gid = process.getgid?.();
    check(uid !== undefined && gid !== undefined, "smoke:image needs a POSIX host (process.getuid)");
    const hostMount = ["--user", `${String(uid)}:${String(gid)}`, "--volume", `${dataDir}:/data`];

    // 1. 宿主目录、宿主 uid。
    const first = await startServing("host-dir", hostMount);
    const files = await readdir(dataDir);
    check(files.includes("identity.lock") && files.includes("telemetry.lock"), `host-dir: lock files missing in the data directory (found ${files.join(", ")})`);
    const busy = await docker(["run", "--name", containerName("busy"), ...hostMount, ...SITE_ENV, IMAGE]);
    check(busy.exitCode !== 0 && failureLine(busy.stderr)?.code === "data_dir_busy", `busy: second container on the same data directory should exit with data_dir_busy (exit ${String(busy.exitCode)})`);
    console.log("busy: second container exited with data_dir_busy");
    await stopCleanly("host-dir", first);

    // 2. 命名卷、镜像里的 bun 用户。
    const volume = `nb-site-smoke-${runId}`;
    await dockerOk(["volume", "create", volume]);
    volumes.push(volume);
    const second = await startServing("named-volume", ["--volume", `${volume}:/data`]);
    await stopCleanly("named-volume", second);

    // 3. 镜像里设测试控制口令被拒。
    const control = await docker(["run", "--name", containerName("test-control"), ...hostMount, ...SITE_ENV, "-e", "NB_SITE_TEST_CONTROL", IMAGE]);
    const failure = failureLine(control.stderr);
    const problems = Array.isArray(failure?.problems) ? (failure.problems as {name?: unknown; problem?: unknown}[]) : [];
    check(
        control.exitCode !== 0 && failure?.code === "config_invalid" && problems.some((item) => item.name === "NB_SITE_HOST" && item.problem === "not_loopback"),
        `test-control: expected config_invalid with NB_SITE_HOST not_loopback (exit ${String(control.exitCode)})`,
    );
    console.log("test-control: rejected with config_invalid, NB_SITE_HOST not_loopback");
    console.log("smoke:image passed");
} finally {
    // 容器都不带 --rm，名字在 docker run 之前登记：run 没建成容器时这里会多报一行，其余删不掉的都要人看。报出来，不影响后面的清理。
    for (const name of containers) await removeOrReport(["rm", "--force", name]);
    for (const volume of volumes) await removeOrReport(["volume", "rm", "--force", volume]);
    await rm(dataDir, {recursive: true, force: true});
}
