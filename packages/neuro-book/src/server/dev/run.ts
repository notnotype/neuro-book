/**
 * 一次开发会话（runtime.server-host 开发模式）：先起页面服务，再启动后端并监视后端文件。
 * 后端要知道页面服务的实际来源才能放行页面直连 RPC 端口，所以页面服务先起、后端环境在它之后才定。
 *
 * 页面服务起不来（例如端口被占）时以 1 退出，不启动后端。第一个 SIGINT 或 SIGTERM 有序结束：停止监视、
 * 后端经标准输入有序停止、再关页面服务；后端以 0 退出时会话以 0 结束。第二个信号不再等排空，直接结束后端，
 * 以 1 结束。终端 Ctrl+C 会同时把 SIGINT 发给后端，后端自己也开始停止，与监督进程发来的 stop 汇合为同一次停止。
 */

import {loopbackOrigins} from "../config";

import {spawnBackend} from "./backend-process";
import type {BackendSpec} from "./backend-process";
import type {DevConfig} from "./config";
import {startDevFrontend} from "./frontend";
import type {DevFrontend} from "./frontend";
import {createDevSupervisor} from "./supervisor";
import type {DevEvent} from "./supervisor";
import {watchBackendFiles} from "./watch";

export interface DevRunOptions {
    readonly config: DevConfig;
    readonly configFile: string;
    readonly watchRoots: ReadonlyArray<string>;
    /** 后端启动命令；`env` 已带上状态根、监听地址、RPC 端口与页面来源。产品入口启动 `src/server/main.ts`，测试换成自己的入口。 */
    readonly backend: (env: Record<string, string | undefined>) => BackendSpec;
    readonly signals?: ReadonlyArray<NodeJS.Signals>;
    readonly output?: (line: string) => void;
}

const systemClock = {
    schedule(task: () => void, milliseconds: number): () => void {
        const timer = setTimeout(task, milliseconds);
        return () => clearTimeout(timer);
    },
};

export async function runDev(options: DevRunOptions): Promise<0 | 1> {
    const output = options.output ?? ((line: string) => process.stdout.write(`${line}\n`));
    const {host, stateRoot} = options.config;
    const backendPort = options.config.backendPort === 0 ? await freePort(host) : options.config.backendPort;
    let pageUrl: string | null = null;
    const backendEnv = (): Record<string, string | undefined> => ({
        ...process.env,
        NBOOK_STATE_ROOT: stateRoot,
        NBOOK_HOST: host,
        NBOOK_PORT: String(backendPort),
        NBOOK_WEB_ROOT: "",
        NBOOK_RPC_PORT: String(options.config.rpcPort),
        // 页面由 Vite 提供，Origin 是页面服务的来源，不是后端 HTTP 端口的；页面直连 RPC 端口，要后端放行它。
        NBOOK_ALLOWED_ORIGINS: pageUrl === null ? "" : loopbackOrigins(pageUrl).join(","),
    });
    const supervisor = createDevSupervisor({
        launch: () => spawnBackend(options.backend(backendEnv())),
        clock: systemClock,
        onEvent: (event) => output(describeEvent(event)),
    });

    let frontend: DevFrontend;
    try {
        frontend = await startDevFrontend({
            host,
            port: options.config.pagePort,
            backendUrl: `http://${host}:${String(backendPort)}`,
            configFile: options.configFile,
            admit: () => supervisor.admit(),
        });
    } catch (error) {
        output(`[dev] page-failed 页面服务启动失败，未启动后端：${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
    pageUrl = frontend.url;
    output(`[dev] page-ready ${frontend.url} 状态根 ${stateRoot}`);
    supervisor.start();
    const watcher = watchBackendFiles(options.watchRoots, (path) => supervisor.notifyChange(path));

    const finished = Promise.withResolvers<0 | 1>();
    let signals = 0;
    let forced = false;
    const onSignal = (): void => {
        signals += 1;
        if (signals > 1) {
            if (!forced) output("[dev] force 再次收到停止信号，不等排空，直接结束后端");
            forced = true;
            supervisor.kill();
            return;
        }
        output("[dev] stopping 正在有序停止");
        void (async () => {
            watcher.close();
            const backendCode = await supervisor.stop();
            output(`[dev] backend-stopped ${backendCode === 0 ? "后端已有序停止" : "后端停止不完整"}`);
            await frontend.close();
            output("[dev] page-closed");
            finished.resolve(forced ? 1 : backendCode);
        })();
    };
    const signalNames = options.signals ?? ["SIGINT", "SIGTERM"];
    for (const signal of signalNames) process.on(signal, onSignal);
    try {
        return await finished.promise;
    } finally {
        for (const signal of signalNames) process.off(signal, onSignal);
    }
}

function describeEvent(event: DevEvent): string {
    switch (event.type) {
        case "backend-starting":
            return `[dev] backend-starting pid=${String(event.pid)}`;
        case "backend-ready":
            return `[dev] backend-ready pid=${String(event.pid)} ${event.url}`;
        case "backend-start-failed":
            return `[dev] backend-start-failed pid=${String(event.pid)} exit=${String(event.exitCode)} 后端启动失败，修改后端文件后重试`;
        case "backend-exited":
            return event.expected
                ? `[dev] backend-exited pid=${String(event.pid)} exit=${String(event.exitCode)}`
                : `[dev] backend-crashed pid=${String(event.pid)} exit=${String(event.exitCode)} 后端意外退出，修改后端文件后重试`;
        case "change":
            return `[dev] change ${event.path}`;
    }
}

/** 取一个当前空闲的端口，整个会话固定使用（Vite 的代理目标在会话内不变）。 */
async function freePort(host: string): Promise<number> {
    const probe = Bun.serve({hostname: host, port: 0, fetch: () => new Response(null, {status: 404})});
    const port = probe.port as number;
    await probe.stop(true);
    return port;
}
