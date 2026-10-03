/**
 * 开发模式的后端子进程：以 `--stop-stdin` 启动。标准输出出现 `Listening on <地址>` 只说明端口已监听，其余插件
 * 可能还在激活；就绪以 `GET /api/runtime/health` 返回 200 为准：就绪前的请求会等待，启动失败时得到 503
 * （runtime.server-host 启动序列第 5 步）。
 *
 * 停止只经标准输入发 `stop`，后端按停止序列排空并关闭（runtime.server-host）。监督进程意外退出时管道随之
 * 关闭，后端读到标准输入结束同样有序停止，所以不需要另外的孤儿进程收口。后端的输出逐行转发（缺省到监督进程自己的输出）。
 */

export interface BackendSpec {
    readonly command: ReadonlyArray<string>;
    readonly cwd: string;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly output?: (line: string, stream: "stdout" | "stderr") => void;
}

function forwardToOwnOutput(line: string, stream: "stdout" | "stderr"): void {
    (stream === "stdout" ? process.stdout : process.stderr).write(`${line}\n`);
}

export interface BackendProcess {
    readonly pid: number;
    /** 运行实例就绪时 resolve 为地址；启动失败或在此之前退出则 reject。 */
    readonly ready: Promise<string>;
    /** 退出码；被信号结束时为 null。 */
    readonly exited: Promise<number | null>;
    /** 请求有序停止；重复调用与进程已退出时无副作用。 */
    requestStop(): void;
    /** 不等排空直接结束（第二个停止信号）。 */
    kill(): void;
}

export class BackendStartError extends Error {
    readonly exitCode: number | null;

    constructor(message: string, exitCode: number | null = null) {
        super(message);
        this.name = "BackendStartError";
        this.exitCode = exitCode;
    }
}

export function spawnBackend(spec: BackendSpec): BackendProcess {
    const output = spec.output ?? forwardToOwnOutput;
    const child = Bun.spawn([...spec.command], {cwd: spec.cwd, env: {...spec.env}, stdin: "pipe", stdout: "pipe", stderr: "pipe"});
    const ready = Promise.withResolvers<string>();
    // 调用方可能只关心 exited（例如启动中就被要求停止）；没有人等 ready 时它的 reject 不算未处理。
    ready.promise.catch(() => undefined);
    const exited = child.exited.then(() => child.exitCode);
    void forwardLines(child.stderr, (line) => output(line, "stderr"));
    void forwardLines(child.stdout, (line) => {
        output(line, "stdout");
        const match = /^Listening on (\S+)/u.exec(line);
        if (match) void probeReady(match[1] as string).then(ready.resolve, ready.reject);
    });
    void exited.then((code) => ready.reject(new BackendStartError(`后端在就绪前退出（退出码 ${String(code)}）`, code)));
    let stopRequested = false;
    return {
        pid: child.pid,
        ready: ready.promise,
        exited,
        requestStop() {
            if (stopRequested || child.exitCode !== null || child.signalCode !== null) return;
            stopRequested = true;
            try {
                child.stdin.write("stop\n");
                child.stdin.flush();
            } catch (error) {
                // 管道已断开说明进程正在退出；它退出时 exited 照常结算，这里不用再做什么。
                process.stderr.write(`[dev] 向后端发送 stop 失败：${error instanceof Error ? error.message : String(error)}\n`);
            }
        },
        kill() {
            child.kill("SIGKILL");
        },
    };
}

async function probeReady(url: string): Promise<string> {
    let response: Response;
    try {
        response = await fetch(new URL("/api/runtime/health", url));
    } catch (error) {
        throw new BackendStartError(`就绪检查连接失败：${error instanceof Error ? error.message : String(error)}`);
    }
    await response.body?.cancel();
    if (!response.ok) throw new BackendStartError(`后端启动失败（就绪检查 HTTP ${String(response.status)}）`);
    return url;
}

async function forwardLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of stream) {
        buffer += decoder.decode(chunk, {stream: true});
        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
            onLine(buffer.slice(0, newline));
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf("\n");
        }
    }
    if (buffer !== "") onLine(buffer);
}
