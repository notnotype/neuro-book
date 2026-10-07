/**
 * 测试用的 TCP 转发：客户端连它，它把字节原样转给目标端口。`drop()` 直接掐断当前全部连接（两端都看到异常断开，
 * 像网络中断），服务端进程照常运行，用来验证“同一服务端进程的断线重连”。只由测试引用。
 */

import type {Socket} from "bun";

export interface TcpProxy {
    readonly port: number;
    /** 掐断当前全部连接；之后的新连接照常转发。 */
    drop(): void;
    stop(): void;
}

interface Pair {
    upstream: Socket<undefined> | null;
    /** 上游连上之前客户端先发来的字节。 */
    readonly pending: Uint8Array[];
    closed: boolean;
}

export function startTcpProxy(target: {readonly host: string; readonly port: number}): TcpProxy {
    const clients = new Set<Socket<Pair>>();
    const listener = Bun.listen<Pair>({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
            open(client) {
                const pair: Pair = {upstream: null, pending: [], closed: false};
                client.data = pair;
                clients.add(client);
                void Bun.connect({
                    hostname: target.host,
                    port: target.port,
                    socket: {
                        open(upstream) {
                            if (pair.closed) {
                                upstream.terminate();
                                return;
                            }
                            pair.upstream = upstream;
                            for (const chunk of pair.pending.splice(0)) upstream.write(chunk);
                        },
                        data(_upstream, chunk) {
                            client.write(chunk);
                        },
                        close() {
                            client.end();
                        },
                    },
                }).catch(() => client.terminate());
            },
            data(client, chunk) {
                if (client.data.upstream === null) client.data.pending.push(new Uint8Array(chunk));
                else client.data.upstream.write(chunk);
            },
            close(client) {
                client.data.closed = true;
                clients.delete(client);
                client.data.upstream?.end();
            },
        },
    });
    return {
        port: listener.port,
        drop() {
            for (const client of [...clients]) {
                client.data.closed = true;
                client.data.upstream?.terminate();
                client.terminate();
            }
        },
        stop() {
            this.drop();
            listener.stop(true);
        },
    };
}
