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

/** 模块取时间只经这里，不直接用 `Date.now()`：以后合同测试要从进程外拨时间时只换这一处（Task README 里待定的测试通道）。 */
export interface Clock {
    now(): number;
}

/** 一个定时任务。上一次没跑完时不开始下一次；抛错或 reject 只记一行 `job.failed`，下一次照常排。 */
export interface JobDefinition {
    readonly name: string;
    readonly intervalMs: number;
    run(): void | Promise<void>;
}

/**
 * 模块的定时任务都经这里登记，不自己 `setInterval`：入口在 `start()` 之后才开始调度，停止时在 `close()` 之前停掉并等
 * 正在跑的那一次。只能在 `create()` 与 `start()` 里登记，调度开始之后再登记抛错。
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
     * （就绪检查另有一条探测连接），模块可以在上面开跨 await 的事务。停止时入口在 `close()` 之后关它。
     */
    readonly db: Database;
    readonly config: C;
    readonly site: SiteSettings;
    /** 每行自动带上 `module`。 */
    readonly log: ModuleLog;
    readonly clock: Clock;
    readonly jobs: JobRegistry;
    /**
     * 请求方的地址：取 TCP 对端地址，对端在 `NB_SITE_TRUSTED_PROXIES` 里时才读 `X-Forwarded-For`，从右往左跳过可信的代理，
     * 取第一个不可信的地址。转发头里有不合法的地址、或可信的对端没给转发头时返回 null，调用方按“取不到”处理。
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
     * 停止时在 HTTP 排空、定时任务停下之后、关库之前调用；任何退出路径上，凡 `create()` 成功的实例都按创建的相反顺序
     * 调用一次。与停止时限剩下的时间赛跑，超时只记一行 `warn`，随后入口照样关库。
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
}

/**
 * 模块提供的子命令（t07 的创建管理员、t12 的导入）。`access` 决定它与服务、迁移的关系：
 * - `exclusive`：取本模块的锁、先执行本模块的迁移再运行；取不到锁就 `data_dir_busy`（服务在跑时不能执行）。
 * - `shared`：先试本模块的锁，取到就执行迁移、拿着锁运行；取不到说明服务在跑，核对迁移记录完整后直接运行，
 *   不完整报 `not_ready`（`site.operations` 的时序一节：创建管理员在服务运行期间可以执行）。
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
    /** 迁移全部成功之后、开始监听之前调用。抛错按 `start_failed` 收口。 */
    create(context: ModuleContext<C>): ModuleInstance;
    readonly commands?: readonly SiteCommand<C>[];
}
