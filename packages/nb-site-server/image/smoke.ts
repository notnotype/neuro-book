/**
 * 镜像的冒烟（包脚本 `smoke:image`）：对 `build:image` 打好的镜像起真容器，核对部署时会碰到的几件事。
 *
 * 1. 挂宿主的临时目录、以宿主的 uid 跑（容器写出的文件宿主删得掉；CI 的 runner 不是 uid 1000）：就绪检查 200，
 *    数据目录里有每个模块的锁文件；第二个容器挂同一个目录时以 `data_dir_busy` 退出，证明打成单文件之后 nb-flock
 *    （bun:ffi 加载 libc 的 flock）在容器里照样起作用。`docker stop` 之后退出码 0、日志里有 `site.stopped`：
 *    bun 是 1 号进程，内核不替 1 号进程执行信号的缺省动作，这一步证明进程自己处理了 SIGTERM。
 *    同一个容器上 `/` 回镜像里的 `index.html`（与 `build:image` 写进 `dist/image/web/` 的那份逐字节相同）并带内容安全策略：
 *    镜像设好了 `NB_SITE_WEB_DIR`，网页随镜像一起发（`site.operations` 输出 12）。
 * 2. 不带 `--user`、挂一个新的命名卷：镜像里的 `/data` 属于 bun 用户，卷照它初始化，进程能写；同样就绪、停止后退出码 0。
 * 3. 给容器设 `NB_SITE_TEST_CONTROL`：镜像监听 0.0.0.0，进程以 `config_invalid` 拒绝，问题是 `NB_SITE_HOST` 的 `not_loopback`。
 *
 * 用法：`bun run smoke:image [--tag <名字>]`，缺省 `nb-site:local`。起过的容器、卷与临时目录在 finally 里删掉，失败时也删；
 * 删不掉的逐个报出来并让脚本以非零退出（`smoke:image passed` 只在清理也成功之后打印）。
 * 会话密钥与测试控制口令每次随机生成，经 `docker run -e 名字`（不带值）从本进程的环境传进去，不出现在命令行与输出里。
 *
 * 时限：每条 docker 命令都有上限，到点结束 docker 命令行并让冒烟失败。第 1 步的第二个容器与第 3 步的容器预期自己退出，
 * 回归时它们会一直跑着 `serve`：结束 docker 命令行不会停掉容器，所以容器都在 `docker run` 之前按名字登记，清理按名字删。
 * 不靠 CI 作业的时限收口：作业被取消时不保证执行 finally，本地也没有那个时限。
 */

import {randomBytes} from "node:crypto";
import {mkdir, readdir, readFile, rm} from "node:fs/promises";
import {join, resolve} from "node:path";
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
/** 预期自己退出的容器（第二个实例、设了测试控制口令的）从 `docker run` 到退出的上限；正常一两秒内退出。 */
const EXPECTED_EXIT_TIMEOUT_MS = 30_000;
/** 别的 docker 命令的缺省上限；`docker stop` 要等停止宽限，另给。 */
const DOCKER_TIMEOUT_MS = 30_000;
/** 就绪轮询里一次 HTTP 请求的上限。 */
const REQUEST_TIMEOUT_MS = 5_000;

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

/** docker 命令行在时限内没有退出：已经结束了它，它起的容器（如果有）还在，由清理按名字删。 */
class DockerTimeout extends Error {}

/** 跑一条 docker 命令，`timeoutMs` 内没退出就 SIGKILL 它并抛 `DockerTimeout`。 */
async function docker(args: readonly string[], timeoutMs = DOCKER_TIMEOUT_MS): Promise<Docker> {
    const child = Bun.spawn(["docker", ...args], {stdout: "pipe", stderr: "pipe", env: {...process.env, ...secretEnv}});
    const output = Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timeout">((resolve) => (timer = setTimeout(() => resolve("timeout"), timeoutMs)));
    try {
        const result = await Promise.race([output, timedOut]);
        if (result === "timeout") {
            child.kill("SIGKILL");
            await child.exited;
            throw new DockerTimeout(`docker ${args[0] ?? ""} did not exit within ${String(timeoutMs)}ms`);
        }
        const [exitCode, stdout, stderr] = result;
        return {exitCode, stdout, stderr};
    } finally {
        clearTimeout(timer);
    }
}

async function dockerOk(args: readonly string[], timeoutMs?: number): Promise<string> {
    const result = await docker(args, timeoutMs);
    if (result.exitCode !== 0) throw new Error(`docker ${args[0] ?? ""} exited with ${String(result.exitCode)}: ${result.stderr.trim()}`);
    return result.stdout.trim();
}

/**
 * 删一个对象，返回是否删成了。`--force` 时对象不存在也以 0 退出（`docker run` 没建成容器时就是这样），所以非零退出与
 * 超时都是真的没删掉，报出来、记为清理失败，接着删别的。
 */
async function remove(args: readonly string[]): Promise<boolean> {
    try {
        const result = await docker(args);
        if (result.exitCode === 0) return true;
        console.error(`cleanup: docker ${args.join(" ")} exited with ${String(result.exitCode)}: ${result.stderr.trim()}`);
    } catch (error) {
        if (!(error instanceof DockerTimeout)) throw error;
        console.error(`cleanup: ${error.message} (docker ${args.join(" ")})`);
    }
    return false;
}

function containerName(label: string): string {
    const name = `nb-site-smoke-${runId}-${label}`;
    containers.push(name);
    return name;
}

/** 合格的站点配置；会话密钥只写名字，值从环境来。 */
const SITE_ENV = ["-e", "NB_SITE_URL=https://site.test", "-e", "NB_SITE_TELEMETRY_URL=https://telemetry.test", "-e", "NB_SITE_SESSION_SECRET", "-e", "NB_SITE_IDENTITY_TERMS_VERSION=2026-11-20"];

/** 标准错误里最后一行 JSON 失败行。 */
function failureLine(stderr: string): {code?: unknown; problems?: unknown} | null {
    const lines = stderr.trim().split("\n").filter((line) => line.startsWith("{"));
    const last = lines.at(-1);
    return last === undefined ? null : (JSON.parse(last) as {code?: unknown; problems?: unknown});
}

function check(condition: boolean, message: string): void {
    if (!condition) throw new Error(`smoke failed: ${message}`);
}

/** 前台跑一个预期自己很快退出的容器；`EXPECTED_EXIT_TIMEOUT_MS` 内没退出时让冒烟失败（容器留给清理删）。 */
async function runToExit(label: string, args: readonly string[]): Promise<Docker> {
    try {
        return await docker(["run", "--name", containerName(label), ...args], EXPECTED_EXIT_TIMEOUT_MS);
    } catch (error) {
        if (!(error instanceof DockerTimeout)) throw error;
        throw new Error(`smoke failed: ${label}: the container should exit by itself but was still running after ${String(EXPECTED_EXIT_TIMEOUT_MS)}ms`, {cause: error});
    }
}

/** 起一个后台容器，等到就绪检查 200，返回容器名与映射到本机的 `地址:端口`。 */
async function startServing(label: string, mount: readonly string[]): Promise<{readonly name: string; readonly hostPort: string}> {
    const name = containerName(label);
    await dockerOk(["run", "--detach", "--name", name, "--publish", "127.0.0.1:0:8080", ...mount, ...SITE_ENV, IMAGE]);
    const hostPort = (await dockerOk(["port", name, "8080/tcp"])).split("\n")[0]!;
    await waitUntil(`${label}: /health/ready returns 200`, async () => {
        const state = await dockerOk(["inspect", "--format", "{{.State.Running}}", name]);
        if (state !== "true") throw new Error(`${label}: container exited before becoming ready\n${(await docker(["logs", name])).stderr}`);
        // 进程还没监听时连接被拒是预期的，当作“还没就绪”再查；进程退出由上面的 Running 判断报出来。
        // 一次请求挂住时也到点放弃，算“还没就绪”，下一轮重查；整体仍受 READY_TIMEOUT_MS 约束。
        const response = await fetch(`http://${hostPort}/health/ready`, {signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)}).catch(() => null);
        return response?.status === 200;
    }, {timeoutMs: READY_TIMEOUT_MS, intervalMs: 200});
    console.log(`${label}: ready on ${hostPort}`);
    return {name, hostPort};
}

/** `build:image` 拷进构建上下文的网页入口；镜像里的 `/app/web/index.html` 就是它。 */
const BUILT_INDEX = resolve(import.meta.dir, "..", "dist", "image", "web", "index.html");

/** 镜像里的网页：`/` 是一个前端路由地址，回 `index.html` 的内容与 HTML 的安全头。 */
async function checkWebPage(label: string, hostPort: string): Promise<void> {
    const response = await fetch(`http://${hostPort}/`, {signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
    const body = Buffer.from(await response.arrayBuffer());
    check(response.status === 200, `${label}: GET / returned ${String(response.status)}, expected 200 with index.html`);
    check(body.equals(await readFile(BUILT_INDEX)), `${label}: GET / did not return the index.html copied into the image`);
    check(response.headers.get("Content-Security-Policy")?.startsWith("default-src 'self'") === true, `${label}: GET / has no Content-Security-Policy`);
    console.log(`${label}: GET / returned the image's index.html`);
}

/** `docker stop` 之后核对退出码 0 与日志里的 `site.stopped`。 */
async function stopCleanly(label: string, name: string): Promise<void> {
    await dockerOk(["stop", "--time", String(STOP_GRACE_SECONDS), name], (STOP_GRACE_SECONDS + 15) * 1_000);
    const exitCode = await dockerOk(["inspect", "--format", "{{.State.ExitCode}}", name]);
    const logs = await docker(["logs", name]);
    const events = logs.stdout.split("\n").filter((line) => line.startsWith("{")).map((line) => (JSON.parse(line) as {event?: unknown}).event);
    check(exitCode === "0", `${label}: exit code after docker stop is ${exitCode}, expected 0`);
    check(events.includes("site.stopped"), `${label}: no site.stopped in the log after docker stop`);
    console.log(`${label}: stopped with exit code 0 and site.stopped`);
}

const dataDir = resolveAgentScratchPath("nb-site-smoke-image", runId);
/** 全部检查都过了；清理也成功时才打印通过。 */
let checksPassed = false;
try {
    await mkdir(dataDir, {recursive: true});
    const uid = process.getuid?.();
    const gid = process.getgid?.();
    check(uid !== undefined && gid !== undefined, "smoke:image needs a POSIX host (process.getuid)");
    const hostMount = ["--user", `${String(uid)}:${String(gid)}`, "--volume", `${dataDir}:/data`];

    // 1. 宿主目录、宿主 uid。
    const {name: first, hostPort: firstHostPort} = await startServing("host-dir", hostMount);
    await checkWebPage("host-dir", firstHostPort);
    const files = await readdir(dataDir);
    check(files.includes("identity.lock") && files.includes("telemetry.lock"), `host-dir: lock files missing in the data directory (found ${files.join(", ")})`);
    const busy = await runToExit("busy", [...hostMount, ...SITE_ENV, IMAGE]);
    check(busy.exitCode !== 0 && failureLine(busy.stderr)?.code === "data_dir_busy", `busy: second container on the same data directory should exit with data_dir_busy (exit ${String(busy.exitCode)})`);
    console.log("busy: second container exited with data_dir_busy");
    await stopCleanly("host-dir", first);

    // 2. 命名卷、镜像里的 bun 用户。
    const volume = `nb-site-smoke-${runId}`;
    await dockerOk(["volume", "create", volume]);
    volumes.push(volume);
    const {name: second} = await startServing("named-volume", ["--volume", `${volume}:/data`]);
    await stopCleanly("named-volume", second);

    // 3. 镜像里设测试控制口令被拒。
    const control = await runToExit("test-control", [...hostMount, ...SITE_ENV, "-e", "NB_SITE_TEST_CONTROL", IMAGE]);
    const failure = failureLine(control.stderr);
    const problems = Array.isArray(failure?.problems) ? (failure.problems as {name?: unknown; problem?: unknown}[]) : [];
    check(
        control.exitCode !== 0 && failure?.code === "config_invalid" && problems.some((item) => item.name === "NB_SITE_HOST" && item.problem === "not_loopback"),
        `test-control: expected config_invalid with NB_SITE_HOST not_loopback (exit ${String(control.exitCode)})`,
    );
    console.log("test-control: rejected with config_invalid, NB_SITE_HOST not_loopback");
    checksPassed = true;
} finally {
    // 容器都不带 --rm，名字在 docker run 之前登记。删不掉的都要人看：报出来、接着删别的，最后让脚本失败。
    // 冒烟本身已经失败时，原来的错误照样在 finally 之后抛出，这里只追加清理的问题。
    let cleanupFailures = 0;
    for (const name of containers) if (!(await remove(["rm", "--force", name]))) cleanupFailures += 1;
    for (const volume of volumes) if (!(await remove(["volume", "rm", "--force", volume]))) cleanupFailures += 1;
    try {
        await rm(dataDir, {recursive: true, force: true});
    } catch (error) {
        cleanupFailures += 1;
        console.error(`cleanup: could not remove the temporary data directory (${(error as NodeJS.ErrnoException).code ?? "unknown error"})`);
    }
    if (cleanupFailures > 0) {
        console.error(`smoke:image cleanup failed for ${String(cleanupFailures)} item(s)`);
        process.exitCode = 1;
    } else if (checksPassed) {
        console.log("smoke:image passed");
    }
}
