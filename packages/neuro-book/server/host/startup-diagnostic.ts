import {writeSync} from "node:fs";
import {serializeDiagnosticError} from "nbook/runtime/diagnostics/diagnostics";
import {appLogger} from "nbook/server/app-logs/logger";

/** 启动器只捕获进程输出；致命原因必须在任何异步资源释放之前同步可见。 */
export function reportProductStartupFailure(error: unknown): void {
    const event = "runtime.startup.failed";
    const message = "Product 启动门禁失败，Product将有序关闭";
    appLogger.fatalSync(event, undefined, error, message);
    try {
        // Worker 的 stderr 是代理流，没有 fd；进程的标准错误描述符仍为 2。
        writeSync(2, `${JSON.stringify({level: "fatal", event, message, error: serializeDiagnosticError(error)})}\n`);
    } catch (outputError) {
        appLogger.fatalSync("runtime.startup.diagnosticFailed", undefined, outputError, "启动致命诊断无法写入进程输出");
    }
}
