/**
 * 项目子进程的启动与退出：读启动参数，经 IPC 与服务端相连，运行项目宿主，停止结算后以退出码结束进程。
 * 产品入口（`main.ts`）、开发入口（`development-main.ts`）与测试入口只差清单与插件。
 */

import {writeSync} from "node:fs";

import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import type {PluginDescriptor} from "nbook/manifest";

import {ProjectConfigError, readProjectConfig} from "./config";
import type {ProjectConfig} from "./config";
import type {ProjectPluginContext} from "./plugins";
import {startProject} from "./start";
import type {ProjectChannel} from "./start";

function readConfigOrExit(): ProjectConfig {
    try {
        return readProjectConfig(process.env);
    } catch (error) {
        if (!(error instanceof ProjectConfigError)) throw error;
        writeSync(2, `${JSON.stringify({level: "fatal", event: "project.config.invalid", variable: error.variable, message: error.message})}\n`);
        process.exit(1);
    }
}

/** 本进程与服务端之间的 IPC；不是由服务端带 IPC 启动的进程没有它。 */
function parentChannel(): ProjectChannel {
    const send = process.send?.bind(process);
    if (send === undefined) {
        writeSync(2, `${JSON.stringify({level: "fatal", event: "project.ipc.missing", message: "项目宿主只能由服务端经 IPC 启动"})}\n`);
        process.exit(1);
    }
    return {
        send: (envelope) => {
            send(envelope);
        },
        disconnect: () => process.disconnect?.(),
        onMessage: (listener) => {
            process.on("message", listener);
        },
        onDisconnect: (listener) => {
            process.on("disconnect", listener);
        },
    };
}

export async function runProjectProcess(
    manifest: ReadonlyArray<PluginDescriptor>,
    plugins?: (context: ProjectPluginContext) => ReadonlyArray<PluginDefinition>,
): Promise<never> {
    const config = readConfigOrExit();
    // 终端的 Ctrl+C 发给整个进程组；项目何时停由服务端决定（停止请求或 IPC 断开），这里不因 SIGINT 退出。
    process.on("SIGINT", () => undefined);
    const exitCode = await startProject({config, manifest, plugins, channel: parentChannel()});
    process.exit(exitCode);
}
