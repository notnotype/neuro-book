/**
 * `nb-site serve`（`site.operations` 输出 1 到 4、8、9 与状态表）。步骤按顺序写在 `serve()` 里，每步旁边写明它在收口的
 * `try` 之内还是之外、在开始受理请求之前还是之后。收口（`finally`）对每条退出路径都一样：断开 HTTP → 停定时任务 →
 * 按创建的相反顺序 `close()` 已建成的实例 → 关探测连接与库 → 放锁 → `site.stopped`。
 */

import type {Database} from "bun:sqlite";
import type {Server} from "bun";

import {createClientAddress} from "../client-address";
import {configFailure, parseSiteConfig, type Env} from "../config";
import {openProbeDb} from "../db/open";
import {createReadiness, type ReadinessTarget} from "../health";
import {JobScheduler} from "../jobs";
import type {StopState} from "../lifecycle";
import {lockModules} from "../lock";
import {errorType, type Logger} from "../log";
import type {Clock, CommandFailure, ModuleInstance, SiteModule} from "../module";
import {createSiteApp, MountError, siteFetch, type MountedModule} from "../site";
import {busyFailure, closeAll, failed, openAndMigrate, SUCCEEDED, type CommandResult} from "./prepare";

const SYSTEM_CLOCK: Clock = {now: () => Date.now()};

function startFailure(module: string, error: unknown): CommandFailure {
    return {code: "start_failed", message: `module ${module} failed to start`, fields: {module, errorType: errorType(error)}};
}

/** `work` 在 `deadline` 之前、且没被强制时 settle 就返回 true；返回前清掉计时器，免得它把进程多留一会儿。`work` 的失败由调用方先接住。 */
async function settlesBefore(work: Promise<void>, deadline: number, forced: Promise<void>): Promise<boolean> {
    let settled = false;
    const tracked = work.then(() => {
        settled = true;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([tracked, new Promise<void>((resolve) => (timer = setTimeout(resolve, Math.max(0, deadline - Date.now())))), forced]);
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
    if (!locks.ok) return failed(busyFailure(locks.module));

    const dbs = new Map<string, Database>();
    const probes = new Map<string, Database>();
    const created: Created[] = [];
    const scheduler = new JobScheduler();
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
        for (const module of modules) {
            const moduleLog = log.child({module: module.name});
            let instance: ModuleInstance;
            try {
                instance = module.create({
                    db: dbs.get(module.name)!,
                    config: parsed.config.modules.get(module.name),
                    site: base.site,
                    log: moduleLog,
                    clock: SYSTEM_CLOCK,
                    jobs: scheduler.registry(moduleLog),
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
            app = createSiteApp({mounts, telemetryHost: base.telemetryHost, readiness: createReadiness(targets, {clock: SYSTEM_CLOCK, log}), log});
        } catch (error) {
            if (!(error instanceof MountError)) throw error;
            return failed(startFailure(error.module, error));
        }

        // 7. 监听之前再查一次停止（try 之内、受理之前）：迁移做完之后、建实例期间到的信号在这里生效，不监听就退出。
        if (stop.requested) return SUCCEEDED;

        // 8. 监听（try 之内；从这一步起受理请求）。
        try {
            server = Bun.serve({hostname: base.host, port: base.port, fetch: siteFetch(app)});
        } catch (error) {
            // Bun 的说明里带着地址与端口，只报错误码。
            const errorCode = (error as {code?: unknown}).code;
            return failed({code: "listen_failed", message: "could not listen on the configured host and port", fields: {errorCode: typeof errorCode === "string" ? errorCode : errorType(error)}});
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
        // 停止请求之外的退出路径（迁移失败、监听失败、start 失败）没有 requestedAt，时限从这里算。
        const deadline = (stop.requestedAt ?? Date.now()) + base.shutdownTimeoutMs;
        if (!(await settlesBefore(scheduler.stop(), deadline, stop.whenForced))) log.warn("job.stop_timeout", "scheduled jobs did not finish before the stop deadline");
        for (const {module, instance, log: moduleLog} of created.reverse()) {
            if (instance.close === undefined) continue;
            // 时限过了也调用：每个建成的实例都要收到一次 close()；只是不再等它。
            // 包进 then：同步抛出的 close() 与 reject 的一样处理。
            const close = instance.close.bind(instance);
            const closing = Promise.resolve()
                .then(close)
                .catch((error: unknown) => {
                    moduleLog.error("module.close_failed", "module close() failed", {errorType: errorType(error)});
                });
            if (!(await settlesBefore(closing, deadline, stop.whenForced))) log.warn("module.close_timeout", "module close() did not finish before the stop deadline", {module});
        }
        closeAll(probes);
        closeAll(dbs);
        locks.release();
        log.info("site.stopped", "site stopped");
    }
}
