/**
 * 后端进程入口：解析启动参数，启动唯一的运行实例，等停止结算后以约定的退出码结束进程。
 *
 *   NBOOK_STATE_ROOT=<状态根> [NBOOK_HOST=127.0.0.1] [NBOOK_PORT=3000] bun src/server/main.ts [--stop-stdin]
 *
 * 监听成功后在标准输出打印一行 `Listening on <地址>`，开发监督进程与 smoke 据此取得实际端口。
 */

import {writeSync} from "node:fs";

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

function startOrExit(config: ServerConfig): RunningServer {
    try {
        return startServer({
            config,
            stopInput: config.stopStdin ? process.stdin : null,
            onListening: (url) => {
                console.log(`Listening on ${url}`);
            },
        });
    } catch (error) {
        // 致命诊断已由 startServer 同步写出。
        if (!(error instanceof ServerAssemblyError)) throw error;
        process.exit(1);
    }
}

const server = startOrExit(readConfigOrExit());
const {exitCode} = await server.stopped;
process.exit(exitCode);
