/**
 * 后端进程的启动与退出：解析启动参数，按给定清单启动唯一的运行实例，等停止结算后以约定的退出码结束进程。
 * 产品入口（`main.ts`）与开发入口（`development-main.ts`）只差加载的清单。
 *
 * 监听成功后在标准输出打印一行 `Listening on <地址>`，开发监督进程与 smoke 据此取得实际端口；内核 RPC 端口
 * 另打印一行 `RPC listening on <ws 地址>`。
 */

import {writeSync} from "node:fs";

import type {PluginDescriptor} from "nbook/manifest";

import {readServerConfig, ServerConfigError} from "./config";
import type {ServerConfig} from "./config";
import {ServerAssemblyError, startServer} from "./start";
import type {RunningServer} from "./start";

function readConfigOrExit(): ServerConfig {
    try {
        return readServerConfig(process.argv.slice(2), process.env, process.cwd());
    } catch (error) {
        if (!(error instanceof ServerConfigError)) throw error;
        writeSync(2, `${JSON.stringify({level: "fatal", event: "runtime.config.invalid", code: error.code, message: error.message})}\n`);
        process.exit(1);
    }
}

function startOrExit(config: ServerConfig, manifest: ReadonlyArray<PluginDescriptor>, projectEntry: string | undefined): RunningServer {
    try {
        return startServer({
            config,
            manifest,
            projectEntry,
            stopInput: config.stopStdin ? process.stdin : null,
            onListening: (url) => {
                console.log(`Listening on ${url}`);
            },
            onRpcListening: (url) => {
                console.log(`RPC listening on ${url}`);
            },
        });
    } catch (error) {
        // 致命诊断已由 startServer 同步写出。
        if (!(error instanceof ServerAssemblyError)) throw error;
        process.exit(1);
    }
}

/** `projectEntry` 是项目宿主入口；缺省为产品入口，开发入口给开发用的项目入口。 */
export async function runServerProcess(manifest: ReadonlyArray<PluginDescriptor>, options: {readonly projectEntry?: string} = {}): Promise<never> {
    const server = startOrExit(readConfigOrExit(), manifest, options.projectEntry);
    const {exitCode} = await server.stopped;
    process.exit(exitCode);
}
