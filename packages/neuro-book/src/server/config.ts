/**
 * 后端进程的启动参数：从命令行与环境变量解析、校验并归一化，宿主与插件只消费结果。
 *
 * 鉴权插件尚未加载，只允许在回环地址上监听，额外放行的页面来源也只能在回环地址上；状态根必须显式给出，
 * 宿主不猜测默认目录。前端构建产物的位置同样显式给出（`NBOOK_WEB_ROOT`）：不给时只提供 API，开发模式由
 * Vite 提供页面。
 */

import {join, resolve} from "node:path";

import {assertLoopbackHost, HostConfigError, parseAllowedOrigins} from "@notnotype/nb-host/server";

export interface ServerConfig {
    readonly host: string;
    /** 0 表示由系统分配端口，实际地址见监听日志。 */
    readonly port: number;
    readonly stateRoot: string;
    /** 诊断文件出口获授的日志位置。 */
    readonly logDirectory: string;
    /** `vite build` 的输出目录；null 时后端不提供页面。 */
    readonly webRoot: string | null;
    /** 是否把标准输入的 `stop` 行作为停止来源（开发监督进程与 smoke 使用）。 */
    readonly stopStdin: boolean;
    /** 内核 RPC 端口，缺省 4218；0 表示由系统分配。浏览器总是经引导接口得知实际端口。 */
    readonly rpcPort: number;
    /** 两个端口都取缺省时为 true：被占用就成对顺延（见 `ports.ts`）。 */
    readonly shiftPorts: boolean;
    /** 额外放行的页面来源（已规范化），给页面不由本进程 HTTP 端口提供的情形，即开发模式的页面服务。 */
    readonly allowedOrigins: ReadonlyArray<string>;
    /** 项目子进程的时限（毫秒）：宽限期、等启动结果的截止、每个子进程的停止截止。 */
    readonly projects: {readonly graceMs: number; readonly startMs: number; readonly stopMs: number};
}

export type ServerConfigErrorCode = "unknown-argument" | "invalid-port" | "non-loopback-host" | "missing-state-root" | "invalid-origin" | "invalid-duration";

export class ServerConfigError extends Error {
    readonly code: ServerConfigErrorCode;

    constructor(code: ServerConfigErrorCode, message: string) {
        super(message);
        this.name = "ServerConfigError";
        this.code = code;
    }
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4217;
/** 固定缺省，TUI 与脚本不经引导接口也能连上。 */
const DEFAULT_RPC_PORT = 4218;
/** 项目子进程时限的缺省值：宽限期 5 分钟、等启动结果 30 秒、每个子进程停止 20 秒。 */
export const PROJECT_LIMIT_DEFAULTS: ServerConfig["projects"] = {graceMs: 5 * 60_000, startMs: 30_000, stopMs: 20_000};
/** 计时器能表示的最大毫秒数；更大的值会被运行时缩成立即触发。 */
const MAX_TIMER_MS = 2 ** 31 - 1;

export function readServerConfig(argv: readonly string[], env: Readonly<Record<string, string | undefined>>, cwd: string): ServerConfig {
    let stopStdin = false;
    for (const argument of argv) {
        if (argument === "--stop-stdin") stopStdin = true;
        else throw new ServerConfigError("unknown-argument", `未知参数：${argument}`);
    }
    const host = env.NBOOK_HOST?.trim() || DEFAULT_HOST;
    hostConfig(() => assertLoopbackHost(host, `NBOOK_HOST=${host}`));
    const port = parsePort("NBOOK_PORT", env.NBOOK_PORT, DEFAULT_PORT);
    const rpcPort = parsePort("NBOOK_RPC_PORT", env.NBOOK_RPC_PORT, DEFAULT_RPC_PORT);
    const allowedOrigins = hostConfig(() => parseAllowedOrigins(env.NBOOK_ALLOWED_ORIGINS, "NBOOK_ALLOWED_ORIGINS"));
    const stateRootInput = env.NBOOK_STATE_ROOT?.trim();
    if (!stateRootInput) {
        throw new ServerConfigError("missing-state-root", "缺少 NBOOK_STATE_ROOT：后端需要显式的状态根来存放日志与数据");
    }
    const stateRoot = resolve(cwd, stateRootInput);
    const webRootInput = env.NBOOK_WEB_ROOT?.trim();
    const webRoot = webRootInput ? resolve(cwd, webRootInput) : null;
    const projects = {
        graceMs: parseDuration("NBOOK_PROJECT_GRACE_MS", env.NBOOK_PROJECT_GRACE_MS, PROJECT_LIMIT_DEFAULTS.graceMs),
        startMs: parseDuration("NBOOK_PROJECT_START_MS", env.NBOOK_PROJECT_START_MS, PROJECT_LIMIT_DEFAULTS.startMs),
        stopMs: parseDuration("NBOOK_PROJECT_STOP_MS", env.NBOOK_PROJECT_STOP_MS, PROJECT_LIMIT_DEFAULTS.stopMs),
    };
    const shiftPorts = isUnset(env.NBOOK_PORT) && isUnset(env.NBOOK_RPC_PORT);
    return {host, port, stateRoot, logDirectory: join(stateRoot, "logs"), webRoot, stopStdin, rpcPort, shiftPorts, allowedOrigins, projects};
}

function parseDuration(name: string, value: string | undefined, fallback: number): number {
    if (value === undefined || value.trim() === "") return fallback;
    const milliseconds = Number(value);
    if (!/^\d+$/.test(value.trim()) || milliseconds < 1 || milliseconds > MAX_TIMER_MS) {
        throw new ServerConfigError("invalid-duration", `${name} 必须是 1..${String(MAX_TIMER_MS)} 的整数毫秒，收到 ${value}`);
    }
    return milliseconds;
}

function isUnset(value: string | undefined): boolean {
    return value === undefined || value.trim() === "";
}

function parsePort(name: string, value: string | undefined, fallback: number): number {
    if (isUnset(value)) return fallback;
    const port = Number(value);
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
        throw new ServerConfigError("invalid-port", `${name} 必须是 0..65535 的整数，收到 ${value}`);
    }
    return port;
}

/** 回环与来源的校验在 nb-host：它的错误原样转成本模块的错误，码与消息不变，调用方只认 `ServerConfigError`。 */
function hostConfig<T>(check: () => T): T {
    try {
        return check();
    } catch (error) {
        if (error instanceof HostConfigError) throw new ServerConfigError(error.code, error.message);
        throw error;
    }
}
