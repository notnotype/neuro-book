/**
 * 测试用的 HTTP 代理：真的转发。收到绝对地址形式的请求（`GET http://host/path`）时改写成路径形式发给上游，收到 `CONNECT` 时
 * 建隧道；每个请求的方法、目标与请求头记下来，测试据此断言“走了代理”“带了 Proxy-Authorization”。转发时把 `Connection`
 * 改成 `close`，一个连接只转一个请求，记录与连接一一对应。只由测试引用。
 *
 * `resolve` 把请求里的主机换成实际连的地址：测试的目标用 `models.test` 这种不是本机的名字（本机地址出口总是直连），代理再把它
 * 接到本机的假端点上。
 */

import type {Socket} from "bun";

export interface ProxiedRequest {
    readonly method: string;
    /** 请求行里的目标：绝对地址，或 `CONNECT` 的 `host:port`。 */
    readonly target: string;
    /** 请求头，名字小写。 */
    readonly headers: Readonly<Record<string, string>>;
}

export interface HttpProxy {
    readonly port: number;
    /** `http://127.0.0.1:<port>`。 */
    readonly url: string;
    /** 收到的请求，按到达顺序。 */
    readonly requests: readonly ProxiedRequest[];
    /** 建立过的客户端连接数（没发完请求头就断的也算）。 */
    connections(): number;
    stop(): void;
}

export interface HttpProxyOptions {
    readonly resolve?: (host: string, port: number) => {readonly host: string; readonly port: number};
}

/**
 * 一个方向上的写：Bun 的 `socket.write` 可能只收下一部分（交回实收的字节数），余下的排队，等 `drain` 再写；排空之前不关写端。
 * 不排队时读端慢一点，大的响应体就被截掉。
 */
class Outbox {
    private readonly queue: Uint8Array[] = [];
    private ending = false;
    constructor(private readonly socket: Socket<unknown>) {}

    write(chunk: Uint8Array | string): void {
        const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
        if (this.queue.length > 0) {
            this.queue.push(bytes);
            return;
        }
        const written = this.socket.write(bytes);
        if (written < bytes.length) this.queue.push(bytes.subarray(Math.max(0, written)));
    }

    drain(): void {
        while (this.queue.length > 0) {
            const head = this.queue[0]!;
            const written = this.socket.write(head);
            if (written < head.length) {
                this.queue[0] = head.subarray(Math.max(0, written));
                return;
            }
            this.queue.shift();
        }
        if (this.ending) this.socket.end();
    }

    end(): void {
        this.ending = true;
        if (this.queue.length === 0) this.socket.end();
    }
}

interface Link {
    head: Uint8Array;
    /** 写给客户端的那一路。 */
    out: Outbox;
    upstream: Socket<Outbox> | null;
    readonly pending: Uint8Array[];
    forwarding: boolean;
    closed: boolean;
}

const HEAD_END = new TextEncoder().encode("\r\n\r\n");

function indexOfHeadEnd(bytes: Uint8Array): number {
    outer: for (let index = 0; index + HEAD_END.length <= bytes.length; index += 1) {
        for (let offset = 0; offset < HEAD_END.length; offset += 1) if (bytes[index + offset] !== HEAD_END[offset]) continue outer;
        return index;
    }
    return -1;
}

export function startHttpProxy(options: HttpProxyOptions = {}): HttpProxy {
    const requests: ProxiedRequest[] = [];
    const clients = new Set<Socket<Link>>();
    let connections = 0;
    const resolve = options.resolve ?? ((host: string, port: number) => ({host, port}));

    /**
     * `closeAfter`：转发的是绝对地址形式的请求（一个连接只转一个）。上游的响应头里补上 `Connection: close`：否则客户端会把这条到代理的
     * 连接留着复用，下一个请求正好撞上代理关掉它（`ECONNRESET`）。隧道（`CONNECT`）原样转发。
     */
    const connect = (client: Socket<Link>, host: string, port: number, first: Uint8Array | null, established: string | null, closeAfter = false): void => {
        const link = client.data;
        const target = resolve(host, port);
        let responseHead: Uint8Array | null = closeAfter ? new Uint8Array(0) : null;
        void Bun.connect<Outbox>({
            hostname: target.host,
            port: target.port,
            socket: {
                open(upstream) {
                    if (link.closed) {
                        upstream.terminate();
                        return;
                    }
                    upstream.data = new Outbox(upstream as Socket<unknown>);
                    link.upstream = upstream;
                    if (established !== null) link.out.write(established);
                    if (first !== null) upstream.data.write(first);
                    for (const chunk of link.pending.splice(0)) upstream.data.write(chunk);
                },
                data(_upstream, chunk) {
                    if (responseHead === null) {
                        link.out.write(new Uint8Array(chunk));
                        return;
                    }
                    const joined = new Uint8Array(responseHead.length + chunk.length);
                    joined.set(responseHead);
                    joined.set(chunk, responseHead.length);
                    const end = indexOfHeadEnd(joined);
                    if (end < 0) {
                        responseHead = joined;
                        return;
                    }
                    const lines = new TextDecoder().decode(joined.slice(0, end)).split("\r\n").filter((line, index) => index === 0 || !/^(connection|keep-alive)\s*:/iu.test(line));
                    link.out.write(new TextEncoder().encode([...lines, "connection: close", "", ""].join("\r\n")));
                    link.out.write(joined.slice(end + HEAD_END.length));
                    responseHead = null;
                },
                drain(upstream) {
                    upstream.data.drain();
                },
                close() {
                    link.out.end();
                },
            },
        }).catch(() => {
            link.out.write("HTTP/1.1 502 Bad Gateway\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
            link.out.end();
        });
    };

    const listener = Bun.listen<Link>({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
            open(client) {
                connections += 1;
                client.data = {head: new Uint8Array(0), out: new Outbox(client as Socket<unknown>), upstream: null, pending: [], forwarding: false, closed: false};
                clients.add(client);
            },
            data(client, chunk) {
                const link = client.data;
                if (link.forwarding) {
                    if (link.upstream === null) link.pending.push(new Uint8Array(chunk));
                    else link.upstream.data.write(new Uint8Array(chunk));
                    return;
                }
                const joined = new Uint8Array(link.head.length + chunk.length);
                joined.set(link.head);
                joined.set(chunk, link.head.length);
                const end = indexOfHeadEnd(joined);
                if (end < 0) {
                    link.head = joined;
                    return;
                }
                link.forwarding = true;
                const lines = new TextDecoder().decode(joined.slice(0, end)).split("\r\n");
                const [method = "", target = "", version = "HTTP/1.1"] = (lines[0] ?? "").split(" ");
                const headers: Record<string, string> = {};
                for (const line of lines.slice(1)) {
                    const colon = line.indexOf(":");
                    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
                }
                requests.push({method, target, headers});
                const rest = joined.slice(end + HEAD_END.length);
                if (method === "CONNECT") {
                    const colon = target.lastIndexOf(":");
                    connect(client, target.slice(0, colon), Number(target.slice(colon + 1)), rest.length > 0 ? rest : null, "HTTP/1.1 200 Connection Established\r\n\r\n");
                    return;
                }
                let url: URL;
                try {
                    url = new URL(target);
                } catch {
                    client.write("HTTP/1.1 400 Bad Request\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
                    client.end();
                    return;
                }
                const forwarded = lines.slice(1).filter((line) => !/^(proxy-[a-z-]+|connection|keep-alive)\s*:/iu.test(line));
                const head = [`${method} ${url.pathname}${url.search} ${version}`, ...forwarded, "connection: close", "", ""].join("\r\n");
                const encoded = new TextEncoder().encode(head);
                const first = new Uint8Array(encoded.length + rest.length);
                first.set(encoded);
                first.set(rest, encoded.length);
                connect(client, url.hostname, Number(url.port === "" ? 80 : url.port), first, null, true);
            },
            drain(client) {
                client.data.out.drain();
            },
            close(client) {
                client.data.closed = true;
                clients.delete(client);
                client.data.upstream?.data.end();
            },
        },
    });
    return {
        port: listener.port,
        url: `http://127.0.0.1:${String(listener.port)}`,
        requests,
        connections: () => connections,
        stop() {
            for (const client of [...clients]) {
                client.data.closed = true;
                client.data.upstream?.terminate();
                client.terminate();
            }
            listener.stop(true);
        },
    };
}
