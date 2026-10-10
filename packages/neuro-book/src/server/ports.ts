/**
 * 缺省端口被占用时成对顺延（docs/specs/runtime/server-host.md 的“输入与前置条件”）：HTTP 与 RPC 端口一起加 100
 * 再试，至多 10 组。只在两个端口都取缺省时顺延；显式给出的端口被占用照旧启动失败，调用方要的就是那个端口。
 *
 * RPC 端口在这里真正监听；HTTP 端口要等 `nbook.http` 激活才监听，这里只试探。试探与真正监听之间被别的进程抢走时，
 * 启动照常以端口占用失败，不再顺延。
 */

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

export function isAddressInUse(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "EADDRINUSE";
}

function probe(host: string, port: number): void {
    const server = Bun.serve({hostname: host, port, fetch: () => new Response(null, {status: 503})});
    void server.stop(true);
}
