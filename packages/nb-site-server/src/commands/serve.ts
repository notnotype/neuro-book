/**
 * `nb-site serve`（`site.operations` 输出 1 到 4、8、9 与状态表）。步骤按顺序写在 `serve()` 里，每步旁边写明它在收口的
 * `try` 之内还是之外、在开始受理请求之前还是之后。收口（`finally`）对每条退出路径都一样：断开 HTTP → 不再开始新的任务运行 →
 * 按创建的相反顺序 `close()` 已建成的实例（模块据此让正在跑的任务收手）→ 停定时任务、等正在跑的那一次 → 关探测连接与库 →
 * 放锁 → `site.stopped`。
 *
 * 时限：排空在途请求用停止时限（从收到停止请求算起）；之后每个模块的 `close()`、停定时任务各另有至多
 * `MODULE_CLEANUP_MS`，不与排空共用，排空用满时限时模块照样有时间收尾。停止期间再来一次信号时这几步都不再等。
 * 截止时刻都按单调时钟（`performance.now()`）算，墙钟回拨不会把它推后。
 */

import type {Database} from "bun:sqlite";
import type {Server} from "bun";

import {createClientAddress} from "../client-address";
import {configFailure, parseSiteConfig, type Env} from "../config";
import {yieldToEventLoop} from "../db/migrate";
import {openProbeDb} from "../db/open";
import {createReadiness, type ReadinessTarget} from "../health";
import {JobScheduler} from "../jobs";
import type {StopState} from "../lifecycle";
import {lockModules} from "../lock";
import {errorType, type Logger} from "../log";
import type {Clock, CommandFailure, ModuleInstance, SiteModule} from "../module";
import {createSiteApp, MountError, responseFailed, siteFetch, type MountedModule} from "../site";
import {createTestControl} from "../test-control";
import {createWebHandler} from "../web";
import {closeAll, failed, lockFailure, openAndMigrate, SUCCEEDED, type CommandResult} from "./prepare";

/**
 * 给模块的业务时间（`ModuleContext.clock`），是墙钟；设了测试控制口令时换成测试控制入口的时钟（墙钟加拨过的偏移量）。
 * 入口自己的时限（停止、就绪结果的复用、卡住的期限）按单调时钟算，不用它，也就不受拨动影响。
 */
const SYSTEM_CLOCK: Clock = {now: () => Date.now()};

/** 停定时任务、每个模块的 `close()` 各自的上限（`site.operations` 输出 9 的“每个模块至多 2 秒收尾”）。 */
const MODULE_CLEANUP_MS = 2_000;

function startFailure(module: string, error: unknown): CommandFailure {
    return {code: "start_failed", message: `module ${module} failed to start`, fields: {module, errorType: errorType(error)}};
}

/**
 * `work` 在 `deadline`（`performance.now()` 的时刻）之前、且没被强制时 settle 就返回 true；返回前清掉计时器，免得它把进程
 * 多留一会儿。`work` 的失败由调用方先接住。
 */
async function settlesBefore(work: Promise<void>, deadline: number, forced: Promise<void>): Promise<boolean> {
    let settled = false;
    const tracked = work.then(() => {
        settled = true;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([tracked, new Promise<void>((resolve) => (timer = setTimeout(resolve, Math.max(0, deadline - performance.now())))), forced]);
    clearTimeout(timer);
    return settled;
}

interface Created {
    readonly module: string;
    readonly instance: ModuleInstance;
    readonly log: Logger;
}

export async function serve(env: Env, modules: readonly SiteModule[], log: Logger, stop: StopState): Promise<CommandResult> {
    // 1. 配置（try 之外、受理之前）：不合格时还没碰过数据目录，没有要收口的东西。
    const parsed = parseSiteConfig(env, modules);
    if (!parsed.ok) return failed(configFailure(parsed.problems));
    const {base} = parsed.config;

    // 2. 按模块取锁（try 之外、受理之前）：取不到时 `lockModules` 已放掉取到的，不打开库、不执行迁移。
    const locks = lockModules(base.dataDir, modules.map((module) => module.name));
    if (!locks.ok) return failed(lockFailure(locks));

    const dbs = new Map<string, Database>();
    const probes = new Map<string, Database>();
    const created: Created[] = [];
    const scheduler = new JobScheduler();
    // 第一次停止请求一到（信号处理函数之后的微任务里）就不再开始新的任务运行；停计时、等正在跑的那一次仍在收口的
    // finally 里、排空之后（`jobs.ts` 的文件头）。不放在第 10 步的 await 之后：停止可能在监听之前就到了。
    void stop.whenRequested.then(() => scheduler.stopAccepting());
    let server: Server<undefined> | undefined;
    // 从这里起进收口的 try：下面任何一步失败或抛出，finally 都把已经拿到的东西按相反顺序放掉。
    try {
        // 3. 迁移（try 之内、受理之前）：端口在这一步之后才监听，迁移没做完时端口不可连。两条迁移之间收到停止就到此为止。
        const migrated = await openAndMigrate(base.dataDir, modules, log, stop, dbs);
        if (migrated.kind === "failed") return failed(migrated.failure);
        if (migrated.kind === "stopped") return SUCCEEDED;

        // 4. 探测连接（try 之内、受理之前）：库在上一步已经建好。
        for (const module of modules) probes.set(module.name, openProbeDb(base.dataDir, module.name));

        // 5. 建实例（try 之内、受理之前）：建成一个就记进 `created`，之后任何退出路径都会 `close()` 它。
        const clientAddress = createClientAddress(base.trustedProxies);
        // 测试控制入口的状态属于这一次运行；没设口令时不建，模块拿到的就是墙钟。
        const testControl = base.testControlToken === null ? undefined : createTestControl({token: base.testControlToken, scheduler, log});
        const clock = testControl?.clock ?? SYSTEM_CLOCK;
        for (const module of modules) {
            const moduleLog = log.child({module: module.name});
            let instance: ModuleInstance;
            try {
                instance = await module.create({
                    db: dbs.get(module.name)!,
                    config: parsed.config.modules.get(module.name),
                    site: base.site,
                    log: moduleLog,
                    clock,
                    jobs: scheduler.registry(module.name, moduleLog),
                    clientAddress,
                });
            } catch (error) {
                return failed(startFailure(module.name, error));
            }
            created.push({module: module.name, instance, log: moduleLog});
            if (instance.mounts.some((mount) => !module.surfaces.includes(mount.surface))) {
                return failed(startFailure(module.name, new MountError(module.name, "mount uses a surface the module did not declare")));
            }
        }

        // 6. 装根应用（try 之内、受理之前）。
        const targets: ReadinessTarget[] = created.map(({module, instance}) => ({
            module: modules.find((candidate) => candidate.name === module)!,
            probe: probes.get(module)!,
            business: dbs.get(module)!,
            instance,
        }));
        const mounts: MountedModule[] = created.flatMap(({module, instance}) => instance.mounts.map((mount) => ({module, mount})));
        let app: ReturnType<typeof createSiteApp>;
        try {
            app = createSiteApp({
                mounts,
                telemetryHost: base.telemetryHost,
                readiness: createReadiness(targets, {log}),
                log,
                testControl: testControl?.app,
                web: base.webDir === null ? undefined : createWebHandler(base.webDir, log.child({module: "web"})),
            });
        } catch (error) {
            if (!(error instanceof MountError)) throw error;
            return failed(startFailure(error.module, error));
        }
        if (testControl !== undefined) log.warn("site.test_control_enabled", "test control endpoints are enabled; NB_SITE_TEST_CONTROL is for contract tests only");

        // 7. 监听之前再查一次停止（try 之内、受理之前）。先让出一次：上一次让出之后的步骤（最后一条迁移之后的收尾、
        // 探测连接、同步的 create()）期间到的信号排在宏任务里，不让出就看不见，进程会先监听再停。
        await yieldToEventLoop();
        if (stop.requested) return SUCCEEDED;

        // 8. 监听（try 之内；从这一步起受理请求）。
        try {
            server = Bun.serve({
                hostname: base.host,
                port: base.port,
                fetch: siteFetch(app),
                // 不随 `NODE_ENV` 变：镜像里没设它，Bun 缺省就是开发模式，出错时回带源码路径与栈的错误页。
                development: false,
                // `fetch` 之外出的错：写一行 `http.response_failed`、回 500 `internal`，不让 Bun 往标准错误打它的说明（见 `responseFailed`）。
                error: responseFailed(log),
            });
        } catch (error) {
            // Bun 的说明里带着地址与端口，只报系统给的错误码；拿不到时省略这个字段。
            const errorCode = (error as {code?: unknown} | undefined)?.code;
            return failed({code: "listen_failed", message: "could not listen on the configured host and port", fields: typeof errorCode === "string" ? {errorCode} : {}});
        }
        log.info("site.listening", "site is listening", {url: server.url.href});

        // 9. 模块的 start() 与定时任务（try 之内、受理之后）：定时任务从这里起才开始跑。
        for (const {module, instance} of created) {
            try {
                instance.start?.();
            } catch (error) {
                return failed(startFailure(module, error));
            }
        }
        scheduler.start();

        // 10. 服务中（受理之后），直到信号或请求之外的致命错误。
        await stop.whenRequested;

        // 11. 排空（try 之内、不再受理）：`server.stop()` 之后新连接被拒、在途请求继续，它在在途请求都结束时 resolve。
        // 与停止时限、第二次信号赛跑，输了就断开剩下的。
        const deadline = stop.requestedAt! + base.shutdownTimeoutMs;
        const drained = await settlesBefore(server.stop(), deadline, stop.whenForced);
        if (!drained) log.warn("site.drain_cut", "in-flight requests cut off at stop", {forced: stop.forced});
        return SUCCEEDED;
    } finally {
        // 收口：每条退出路径都走这里（受理之后的路径已不再受理）。
        // 断开还连着的：失败路径上没排空过；排空赢了时这一步什么都不做。
        if (server !== undefined) await server.stop(true);
        // 先 `close()`、后等定时任务：`close()` 是模块让自己正在跑的任务收手的唯一时机（统计模块在下一批之前停下），
        // 反过来先等任务时，积压多的任务会跑满等任务的时限才轮到 `close()`。不再开始新的运行在停止请求一到时已经做了，
        // 这里再做一次，盖住不经停止请求走到收口的路径：`close()` 之后不能再起新的运行。
        scheduler.stopAccepting();
        for (const {module, instance, log: moduleLog} of created.reverse()) {
            if (instance.close === undefined) continue;
            // 强制之后也调用：每个建成的实例都要收到一次 close()；只是不再等它。
            // 包进 then：同步抛出的 close() 与 reject 的一样处理。
            const close = instance.close.bind(instance);
            const closing = Promise.resolve()
                .then(close)
                .catch((error: unknown) => {
                    moduleLog.error("module.close_failed", "module close() failed", {errorType: errorType(error)});
                });
            if (!(await settlesBefore(closing, performance.now() + MODULE_CLEANUP_MS, stop.whenForced))) {
                log.warn("module.close_timeout", "module close() did not finish in time", {module, forced: stop.forced});
            }
        }
        // 关库之前等正在跑的任务 settle：`close()` 没管住、或不理会 `close()` 的任务还在用库。
        if (!(await settlesBefore(scheduler.stop(), performance.now() + MODULE_CLEANUP_MS, stop.whenForced))) {
            log.warn("job.stop_timeout", "scheduled jobs did not finish in time", {forced: stop.forced});
        }
        closeAll(probes);
        closeAll(dbs);
        locks.release();
        log.info("site.stopped", "site stopped");
    }
}
