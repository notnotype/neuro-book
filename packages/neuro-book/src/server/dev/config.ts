/**
 * 开发模式参数：页面由 Vite 在 `NBOOK_DEV_PORT`（缺省 3000）提供，后端在 `NBOOK_DEV_BACKEND_PORT`（缺省 3001）。
 * 后端端口在整个开发会话中固定，重启前后代理目标不变；0 表示启动时取一个空闲端口，此后同样固定。
 * 状态根缺省是包内被 git 忽略的 `.dev-state/`：每个 worktree 各一份，不碰旧应用的数据目录。
 */

import {join, resolve} from "node:path";

export interface DevConfig {
    readonly host: string;
    readonly pagePort: number;
    readonly backendPort: number;
    readonly stateRoot: string;
}

export class DevConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DevConfigError";
    }
}

export function readDevConfig(env: Readonly<Record<string, string | undefined>>, packageRoot: string): DevConfig {
    const stateRoot = env.NBOOK_STATE_ROOT?.trim();
    return {
        // 开发模式不加载鉴权插件，与后端宿主一样只监听本机。
        host: "127.0.0.1",
        pagePort: port(env, "NBOOK_DEV_PORT", 3000),
        backendPort: port(env, "NBOOK_DEV_BACKEND_PORT", 3001),
        stateRoot: stateRoot ? resolve(packageRoot, stateRoot) : join(packageRoot, ".dev-state"),
    };
}

function port(env: Readonly<Record<string, string | undefined>>, name: string, fallback: number): number {
    const value = env[name]?.trim();
    if (!value) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) throw new DevConfigError(`${name} 必须是 0..65535 的整数，收到 ${value}`);
    return parsed;
}
