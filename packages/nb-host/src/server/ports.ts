/**
 * 缺省端口被占用时成组顺延（docs/specs/runtime/server-host.md 的“输入与前置条件”与开发模式）：HTTP 与 RPC 端口一起
 * 加 100 再试，至多 10 组。只在端口都取缺省时顺延；显式给出的端口被占用照旧启动失败，调用方要的就是那个端口。
 *
 * 正式运行：RPC 端口在这里真正监听；HTTP 端口要等宿主的 HTTP 插件激活才监听，这里只试探。开发模式：页面、后端 HTTP 与
 * RPC 三个端口都只试探，由监督进程把定下的端口交给 Vite 与后端子进程。试探与真正监听之间被别的进程抢走时，启动照常
 * 以端口占用失败，不再顺延。
 *
 * 试探也是一次监听：每个入口先核对地址在回环上（`loopback.ts`），不靠调用方事先校验过。
 */

import {assertLoopbackHost} from "./loopback";

export const PORT_SHIFT_STEP = 100;
export const PORT_SHIFT_ATTEMPTS = 10;

export interface ShiftedListen<T> {
    readonly httpPort: number;
    readonly rpc: T;
    /** 相对缺省端口顺延了多少；0 表示用的就是缺省端口。 */
    readonly offset: number;
}

export interface ListenWithShiftOptions<T> {
    readonly host: string;
    readonly httpPort: number;
    readonly rpcPort: number;
    readonly shift: boolean;
    /** 在给定端口上监听 RPC；端口被占用时同步抛出带 `code: "EADDRINUSE"` 的错误（`Bun.serve` 的行为）。 */
    readonly listenRpc: (port: number) => T;
}

export function listenWithShift<T>(options: ListenWithShiftOptions<T>): ShiftedListen<T> {
    assertLoopbackHost(options.host, options.host);
    const attempts = options.shift ? PORT_SHIFT_ATTEMPTS : 1;
    for (let attempt = 0; ; attempt++) {
        const offset = attempt * PORT_SHIFT_STEP;
        try {
            if (options.shift) probe(options.host, options.httpPort + offset);
            return {httpPort: options.httpPort + offset, rpc: options.listenRpc(options.rpcPort + offset), offset};
        } catch (error) {
            if (attempt + 1 >= attempts || !isAddressInUse(error)) throw error;
        }
    }
}

/** 几个端口作为一组顺延：返回第一组都空闲的偏移量；顺延到上限仍被占用时抛出最后那次的 `EADDRINUSE`。 */
export async function freeGroupOffset(host: string, ports: ReadonlyArray<number>): Promise<number> {
    assertLoopbackHost(host, host);
    for (let attempt = 0; ; attempt++) {
        const offset = attempt * PORT_SHIFT_STEP;
        try {
            for (const port of ports) await probePort(host, port + offset);
            return offset;
        } catch (error) {
            if (attempt + 1 >= PORT_SHIFT_ATTEMPTS || !isAddressInUse(error)) throw error;
        }
    }
}

export function isAddressInUse(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "EADDRINUSE";
}

/** 试探一个端口此刻能不能监听：监听上就关掉；被占用时抛出带 `code: "EADDRINUSE"` 的错误（`Bun.serve` 同步抛）。 */
export async function probePort(host: string, port: number): Promise<void> {
    assertLoopbackHost(host, host);
    const server = Bun.serve({hostname: host, port, fetch: () => new Response(null, {status: 503})});
    await server.stop(true);
}

function probe(host: string, port: number): void {
    const server = Bun.serve({hostname: host, port, fetch: () => new Response(null, {status: 503})});
    void server.stop(true);
}
