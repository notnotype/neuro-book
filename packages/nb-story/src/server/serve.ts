/**
 * `nbstory serve`：启动查看器的独立服务（docs/specs/story/cli-skill.md 输出 5、F3）。
 *
 * 先后：拿服务锁 → 开始监听 → 装上停止信号的处理 → 写登记 → 打印登录链接。收到 SIGINT、SIGTERM 或 SIGHUP 时：
 * 停下抽取与问答 → 删登记 → 停止监听（在途请求随连接断开结束）→ 放锁。
 * 信号处理必须在打印之前装：调用方读到登录链接就可能马上发 SIGTERM，Bun 在监听期间先打印、后装处理时，这个信号会
 * 按默认动作杀掉进程（退出码 143），登记留在书库里（2026-10-20 实测，先打印时 30 次全中）。
 * 任何一步启动失败（书库目录、锁、监听、登记）都先关掉已开的监听、放锁，不留下登记，退出码 3；`--json` 时失败也只
 * 输出一份 JSON。
 */

import {randomUUID} from "node:crypto";
import {mkdir} from "node:fs/promises";
import {join} from "node:path";

import {onProcessTermination} from "@notnotype/nb-harness";

import {createStoryApi} from "../core/api";
import {defaultLibraryRoot} from "../core/library";
import {coordinatedLibrary} from "../ingest/coordinator";
import {createIngestService, type IngestService} from "./ingest-service";
import {createQaService} from "./qa-service";
import type {CliIo} from "../cli/main";
import {createServeAuth} from "./auth";
import {createHandler} from "./http";
import {acquireServeLock, registeredUrl, type ServeLock} from "./registry";
import {checkWebFreshness} from "./web-stamp";

const PACKAGE_ROOT = join(import.meta.dir, "..", "..");
export const WEB_ROOT = join(PACKAGE_ROOT, "dist", "web");

export interface ServeOptions {
    library: string | undefined;
    port: number | undefined;
    open: boolean;
    /** 标准输出只写一份 JSON（docs/specs/story/cli-skill.md 输出 2）。 */
    json: boolean;
}

function openInBrowser(url: string): void {
    // Windows 上用 cmd 的 start（第一个引号参数是窗口标题，留空）；登录链接里只有 `?token=`，没有 cmd 要转义的字符。
    const command = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
    try {
        Bun.spawn(command, {stdout: "ignore", stderr: "ignore"}).unref();
    } catch (error) {
        console.error({error}, "打开浏览器失败");
    }
}

/**
 * 从源码运行时网页包比源码旧，就在标准错误提示（issue 267）。判据是 `src/web/index.html` 在不在：npm 发的包不带 `src/web`
 * （package.json 的 files），网页包是发布前在干净的构建里打的，不用查。检查本身出错只提示一句，不挡启动。
 */
async function warnIfWebBundleStale(io: CliIo): Promise<void> {
    if (!(await Bun.file(join(PACKAGE_ROOT, "src", "web", "index.html")).exists())) return;
    const rebuild = `先在 ${PACKAGE_ROOT} 下运行 bun run build:web 重打`;
    try {
        const result = await checkWebFreshness(WEB_ROOT, PACKAGE_ROOT);
        if (result.state === "stale") {
            const list = result.changed.slice(0, 3).join("、");
            io.stderr(`网页包比源码旧（打于 ${result.builtAt.slice(0, 16).replace("T", " ")} UTC，之后有 ${result.changed.length} 个源文件改过：${list}${result.changed.length > 3 ? " 等" : ""}），${rebuild}。`);
        } else if (result.state === "no-stamp") {
            io.stderr(`网页包没有构建记录（早先版本打的），不能确认它是不是比源码旧，${rebuild}。`);
        }
    } catch (error) {
        io.stderr(`没能检查网页包是否比源码旧：${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function serveCommand(options: ServeOptions, io: CliIo): Promise<number> {
    const fail = (code: string, message: string): number => {
        if (options.json) io.stdout(JSON.stringify({ok: false, error: {code, message}}));
        else io.stderr(message);
        return 3;
    };
    const library = options.library ?? defaultLibraryRoot();
    let lock: ServeLock | null;
    try {
        await mkdir(library, {recursive: true});
        lock = acquireServeLock(library);
    } catch (error) {
        return fail("serve_failed", `启动失败：书库目录 ${library} 用不了（${error instanceof Error ? error.message : String(error)}）`);
    }
    if (!lock) {
        const url = await registeredUrl(library);
        return fail("already_running", `这个书库已有服务在运行${url ? `：${url}` : ""}`);
    }

    const instance = randomUUID();
    // 本服务运行的抽取任务由抽取服务管；删除书时书库的协调者经它先停这个 id 的任务（含正在启动的）。抽取服务要用
    // 书库，书库要用抽取服务，所以协调者在调用时才取它。
    let ingest!: IngestService;
    const books = coordinatedLibrary(library, {stop: id => ingest.stopLocal(id)});
    const api = createStoryApi({library: books});
    // 抽取的模型取自默认位置的配置（与 nbstory ingest 相同），每次发起时重读。
    ingest = createIngestService({library: books});
    // 网页问答与设置页：配置取默认位置（与 nbstory config 相同），每轮开始时重读。
    const qa = createQaService({api});
    let server: ReturnType<typeof Bun.serve>;
    let handler: ((request: Request) => Promise<Response>) | null = null;
    try {
        server = Bun.serve({
            hostname: "127.0.0.1",
            port: options.port ?? 0,
            fetch: request => (handler ? handler(request) : new Response(null, {status: 503})),
        });
    } catch (error) {
        lock.release();
        return fail("serve_failed", `启动失败：${error instanceof Error ? error.message : String(error)}`);
    }

    const port = server.port!;
    const auth = createServeAuth(port);
    handler = createHandler({api, ingest, qa, auth, instance, webRoot: WEB_ROOT, timeout: (request, seconds) => server.timeout(request, seconds)});
    const url = `http://127.0.0.1:${port}`;
    const stop = async (): Promise<number> => {
        // 先停下本服务的抽取任务、等它们放锁，再撤销登记、停监听（ingest-service.ts 模块头）；问答同样先取消、等保存完。
        await Promise.all([ingest.close(), qa.close()]);
        // 撤销登记失败（例如书库目录变成只读）也要停掉监听、放锁，否则进程停不下来并一直占着锁；这时退出码为 1。
        let code = 0;
        try {
            await lock.withdraw();
        } catch (error) {
            code = 1;
            io.stderr(`撤销服务登记失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
            await server.stop(true);
            lock.release();
        }
        return code;
    };
    // 问答引擎依赖的 OMP 一被导入就接管了 SIGINT、SIGTERM、SIGHUP（跑完清理就以 128 加信号号退出），自己装的处理拦不住，
    // 所以经 nb-harness 登记：停完以 stop 的退出码退出。
    // 在写登记之前登记：登记一出现别的进程就可能发信号来停它。
    let unregister = () => {};
    const exited = new Promise<number>(resolve => {
        unregister = onProcessTermination(async () => {
            const code = await stop();
            resolve(code);
            return code;
        });
    });

    try {
        await lock.publish({instance, url, port, pid: process.pid});
    } catch (error) {
        unregister();
        await server.stop(true);
        await lock.withdraw();
        lock.release();
        return fail("serve_failed", `写服务登记失败：${error instanceof Error ? error.message : String(error)}`);
    }

    await warnIfWebBundleStale(io);
    const login = `${url}/login?token=${auth.token}`;
    if (options.json) io.stdout(JSON.stringify({ok: true, data: {login, url}}));
    else io.stdout(`剧情图谱查看器已启动：${login}`);
    if (options.open) openInBrowser(login);
    return exited;
}
