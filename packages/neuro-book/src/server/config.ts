/**
 * 后端进程的启动参数：从命令行与环境变量解析、校验并归一化，宿主与插件只消费结果。
 *
 * 鉴权插件尚未加载，只允许在回环地址上监听；状态根必须显式给出，宿主不猜测默认目录。
 * 前端构建产物的位置同样显式给出（`NBOOK_WEB_ROOT`）：不给时只提供 API，开发模式由 Vite 提供页面。
 */

import {join, resolve} from "node:path";

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
}

export type ServerConfigErrorCode = "unknown-argument" | "invalid-port" | "non-loopback-host" | "missing-state-root";

export class ServerConfigError extends Error {
    readonly code: ServerConfigErrorCode;

    constructor(code: ServerConfigErrorCode, message: string) {
        super(message);
        this.name = "ServerConfigError";
        this.code = code;
    }
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function readServerConfig(argv: readonly string[], env: Readonly<Record<string, string | undefined>>, cwd: string): ServerConfig {
    let stopStdin = false;
    for (const argument of argv) {
        if (argument === "--stop-stdin") stopStdin = true;
        else throw new ServerConfigError("unknown-argument", `未知参数：${argument}`);
    }
    const host = env.NBOOK_HOST?.trim() || DEFAULT_HOST;
    if (!LOOPBACK_HOSTS.has(host)) {
        throw new ServerConfigError("non-loopback-host", `未加载鉴权插件时只允许监听回环地址，收到 NBOOK_HOST=${host}`);
    }
    const port = parsePort(env.NBOOK_PORT);
    const stateRootInput = env.NBOOK_STATE_ROOT?.trim();
    if (!stateRootInput) {
        throw new ServerConfigError("missing-state-root", "缺少 NBOOK_STATE_ROOT：后端需要显式的状态根来存放日志与数据");
    }
    const stateRoot = resolve(cwd, stateRootInput);
    const webRootInput = env.NBOOK_WEB_ROOT?.trim();
    const webRoot = webRootInput ? resolve(cwd, webRootInput) : null;
    return {host, port, stateRoot, logDirectory: join(stateRoot, "logs"), webRoot, stopStdin};
}

function parsePort(value: string | undefined): number {
    if (value === undefined || value.trim() === "") return DEFAULT_PORT;
    const port = Number(value);
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
        throw new ServerConfigError("invalid-port", `NBOOK_PORT 必须是 0..65535 的整数，收到 ${value}`);
    }
    return port;
}
