/**
 * 一个模块交给进程入口的全部东西（`site.operations`；ADR 0059 决策 2 到 5）。
 *
 * 模块包不导入本文件：入口依赖模块包，反过来导入就成了环。模块包只导出自己的迁移清单、读配置与建实例的函数，
 * `modules.ts` 的适配器把它们包成 `SiteModule`，用 `satisfies` 让类型检查核对形状。拆成两个进程时只在本包加入口文件，
 * 各自 `runCli(argv, [某一个模块])`；配置、锁、迁移、健康检查、日志都按传入的模块列表工作，不写死两个模块。
 */

import type {Database} from "bun:sqlite";
import type {Context, Hono} from "hono";

import type {Migration} from "./db/migrate";

export type {Migration} from "./db/migrate";

/** 请求按主机名分到两处：`site` 是站点地址，`ingest` 是遥测写入口地址（`site.operations` 的输入一节）。 */
export type Surface = "site" | "ingest";

/** 配置问题只带变量名与问题词，不带取值（`site.operations` 输出 1；问题词见它的失败与恢复一节）。 */
export interface ConfigProblem {
    readonly name: string;
    readonly problem: string;
}

export type ConfigResult<C> = {readonly ok: true; readonly config: C} | {readonly ok: false; readonly problems: readonly ConfigProblem[]};

/** 写日志的出口；`event` 是稳定的英文事件名，`message` 是英文说明，`fields` 不放秘密、正文、来源地址与路径。 */
export interface ModuleLog {
    info(event: string, message: string, fields?: Readonly<Record<string, unknown>>): void;
    warn(event: string, message: string, fields?: Readonly<Record<string, unknown>>): void;
    error(event: string, message: string, fields?: Readonly<Record<string, unknown>>): void;
}

/**
 * 模块取时间只经这里，不直接用 `Date.now()`：合同测试经测试控制入口（`site.operations` 输出 11）把 `serve` 交给模块的时钟
 * 往前拨，只有经这里取的时间跟着走。模块命令是另一个进程，拿到的总是墙钟。
 */
export interface Clock {
    now(): number;
}

/**
 * 一个定时任务。上一次没跑完时不开始下一次；抛错或 reject 只记一行 `job.failed`，下一次照常排。测试控制入口能按模块名与
 * `name` 立即跑一次（同样不与正在跑的那一次叠着），所以同一个模块里 `name` 不能重复。
 */
export interface JobDefinition {
    readonly name: string;
    readonly intervalMs: number;
    /**
     * 开始调度之后第一次等多久（非负整数毫秒），缺省等于 `intervalMs`。之后每次照旧从上一次按间隔排的运行结束起等
     * `intervalMs`。给 0 时开始调度后立即跑一次：服务重启比间隔频繁时，第一次只等间隔的任务永远轮不到。
     */
    readonly initialDelayMs?: number;
    run(): void | Promise<void>;
}

/**
 * 模块的定时任务都经这里登记，不自己 `setInterval`：入口在 `start()` 之后才开始调度；停止时先不再开始新的运行，
 * 调过 `close()` 之后再停掉计时并等正在跑的那一次（至多 2 秒，见 `ModuleInstance.close`）。只能在 `create()` 与 `start()`
 * 里登记，调度开始之后再登记抛错。
 */
export interface JobRegistry {
    register(job: JobDefinition): void;
}

/** 两个模块共用的站点设置。 */
export interface SiteSettings {
    /** `NB_SITE_URL` 的 origin，例如 `https://neuro-book.example`。 */
    readonly siteUrl: string;
    /** `NB_SITE_TELEMETRY_URL` 的 origin；本进程没有模块用到写入口时为 null，入口也不要求配它。 */
    readonly telemetryUrl: string | null;
}

export interface ModuleContext<C> {
    /**
     * 本模块自己的库连接，迁移已全部执行。连接归模块所有：入口在模块建好之后不在它上面开事务、不执行语句
     * （就绪检查另有一条探测连接）。停止时入口在 `close()` 之后关它。
     *
     * 每个模块只有这一条连接，连接上同一时刻只有一个事务：一方 `BEGIN` 之后 `await`，这期间别的请求、定时任务在这条连接
     * 上执行的语句都落进它的事务，它回滚时一起消失，别人再 `BEGIN` 直接报错。所以这条连接上的全部访问（请求、定时任务、
     * `close()`）必须由模块自己排成一队；开跨 await 的事务的一方在提交或回滚之前独占这条连接。做不到时模块另开自己的连接。
     */
    readonly db: Database;
    readonly config: C;
    readonly site: SiteSettings;
    /** 每行自动带上 `module`。 */
    readonly log: ModuleLog;
    readonly clock: Clock;
    readonly jobs: JobRegistry;
    /**
     * 请求方的地址（取法见 `site.operations` 的输入一节）：取 TCP 对端地址，对端在 `NB_SITE_TRUSTED_PROXIES` 里时才读
     * `X-Forwarded-For`，从右往左跳过可信的代理，取第一个不可信的地址，它左边的不看。走到的那一跳不是合法的 IP 字面量
     * （带端口的写法也算不合法）、或可信的对端没给转发头时返回 null，调用方按“取不到”处理。
     * 只能用在入口挂上的子应用的请求里。返回值是来源地址，不写进日志（`site.telemetry-ingest` 输出 8）。
     */
    clientAddress(c: Context): string | null;
}

export interface ModuleMount {
    readonly surface: Surface;
    /** 以 `/` 开头、不以 `/` 结尾；子应用里的路由不再带前缀。 */
    readonly prefix: string;
    readonly app: Hono;
}

export interface ModuleInstance {
    readonly mounts: readonly ModuleMount[];
    /** 库探测之外、模块自己的就绪条件；缺省只看库。同步调用，不能等 I/O：就绪检查在事件循环上逐个模块跑。 */
    ready?(): boolean;
    /** 开始监听、写出 `site.listening` 之后调用一次。抛错按 `start_failed` 收口。 */
    start?(): void;
    /**
     * 停止时在 HTTP 排空、入口不再开始新的任务运行之后调用；任何退出路径上，凡 `create()` 成功的实例都按创建的相反顺序
     * 调用一次。调用时本模块的定时任务可能还有一次正在跑：入口在全部 `close()` 之后才停计时、等它（同样至多 2 秒），
     * 再关库。所以要让长任务收手的模块在这里通知它、等它 settle（统计模块置“正在关闭”，任务在下一批之前停下）；
     * 先等任务再 `close()` 的话，积压多的任务会跑满那 2 秒。每个模块的 `close()` 另有至多 2 秒（`site.operations` 输出 9），
     * 不占排空用的停止时限；超时或停止期间又来一次信号时只记一行 `warn` 不再等，随后入口照样关库。
     */
    close?(): Promise<void>;
}

/** 模块命令的失败：`code` 是稳定的英文码，`message` 是英文说明，`fields` 不放取值与路径。 */
export interface CommandFailure {
    readonly code: string;
    readonly message: string;
    readonly fields?: Readonly<Record<string, unknown>>;
}

export interface CommandContext<C> {
    /** 本模块的库连接，迁移已全部执行（`shared` 且服务在跑时由服务执行过）。命令返回后由入口关掉。 */
    readonly db: Database;
    readonly config: C;
    readonly site: SiteSettings;
    readonly log: ModuleLog;
    readonly clock: Clock;
    /** 按 `SiteCommand.arguments` 的名字取位置参数；可选参数没给时为 undefined。 */
    readonly args: Readonly<Record<string, string | undefined>>;
    /** 第一次收到 `SIGTERM` 或 `SIGINT` 时 abort。命令收手的写法见 `SiteCommand`。 */
    readonly signal: AbortSignal;
}

/**
 * 模块提供的子命令（t07 的创建管理员、t12 的导入）。`access` 决定它与服务、迁移的关系：
 * - `exclusive`：取本模块的锁、先执行本模块的迁移，拿着锁运行；取不到锁就 `data_dir_busy`（服务在跑时不能执行）。
 * - `shared`：先试本模块的锁，取到就执行迁移，迁移做完就放锁再运行，所以它停在等输入的地方时服务照样能启动；
 *   取不到说明服务在跑，核对迁移记录完整后直接运行，不完整报 `not_ready`（`site.operations` 的时序一节）。
 *   运行时与服务同时写这个库，靠 SQLite 的写锁排队。
 *
 * 停止信号（`site.operations` 输出 5、失败表的 `interrupted`）：运行之前收到就不运行；运行中 `context.signal` abort，
 * 命令自己决定在哪里收手，收手时 reject 为 `signal.reason`（或任何 `AbortError`），入口报 `interrupted`；不理会它的命令，
 * 第二次信号时入口不再等 `run()`，同样报 `interrupted`。这几种都照常关库、放锁，以 1 退出。收到信号之后仍然做完了的，
 * 照常按结果报。
 */
export interface SiteCommand<C> {
    readonly name: string;
    /** 英文，进 `--help`。 */
    readonly description: string;
    readonly access: "exclusive" | "shared";
    readonly arguments?: readonly {readonly name: string; readonly required: boolean}[];
    /** 成功时 resolve 为 undefined；预料之中的失败 resolve 为 `CommandFailure`，进程以 1 退出。 */
    run(context: CommandContext<C>): Promise<CommandFailure | undefined>;
}

export interface SiteModule<C = unknown> {
    /** `^[a-z][a-z0-9]*$`；也是库文件名、锁文件名与日志里的 `module`。 */
    readonly name: string;
    /**
     * 本模块会挂子应用的入口，静态声明：入口据此在读配置时决定要不要 `NB_SITE_TELEMETRY_URL`，不必先建实例。
     * `create()` 返回的 mount 用了没声明的入口时按 `start_failed` 失败。
     */
    readonly surfaces: readonly Surface[];
    /** 按编号递增（`db/migrate.ts`）。 */
    readonly migrations: readonly Migration[];
    /** 读本模块的环境变量（`NB_SITE_<模块>_*`，以及只有本模块用的共用变量）；只报变量名与问题词。 */
    parseConfig(env: Readonly<Record<string, string | undefined>>): ConfigResult<C>;
    /**
     * 迁移全部成功之后、开始监听之前调用，可以是异步的（例如在监听之前确认依赖的库能建成）。抛错或 reject 按
     * `start_failed` 收口，已建成的别的模块照样 `close()`。
     */
    create(context: ModuleContext<C>): ModuleInstance | Promise<ModuleInstance>;
    readonly commands?: readonly SiteCommand<C>[];
    /**
     * 备份命令写出本模块库的副本之后，在副本上调用（例如清空统计模块的原始上报表，`site.operations` 输出 6）；随后入口对
     * 副本 `VACUUM`，删掉的内容不留在空闲页里，再做 `quick_check`。
     *
     * `copy` 是副本的读写连接，不是原库：这里改什么都不影响服务正在用的库。备份命令是另一个进程，不调用 `create()`，
     * 也不读本模块的配置，所以这里不能依赖 `create()` 建的状态。
     *
     * 同步调用，入口不等它：返回之后马上 `VACUUM`、关连接、改名，写成 async 的话 `await` 之后的删除落在副本关掉之后，
     * 要删的数据留在正式备份里。返回类型是 `undefined` 而不是 `void`，就是让类型检查拦下返回 Promise 的实现；类型断言能绕过它，
     * 所以入口另在运行时查一遍。返回之前提交或回滚自己开的事务。抛错、返回了 `undefined` 以外的值、或留下
     * 未提交的事务时，这次备份以 `backup_failed`（`prepare_failed`）失败。
     */
    prepareBackupCopy?(copy: Database): undefined;
}
