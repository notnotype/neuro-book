/**
 * 进程的两路输出（`site.operations` 输出 1、8）：日志每行一个 JSON 对象写到标准输出；命令失败的那一行写到标准错误。
 *
 * 用 `writeSync`：每一行写出即落到管道，进程马上退出时最后几行也不丢，测试与部署侧读到 `migration.applied`、
 * `site.listening` 时它们描述的事已经发生。代价是读端很慢时写日志会阻塞事件循环。
 * 日志里不放环境变量的取值、数据目录的路径、来源地址、请求头与请求体：调用方只传这些之外的字段。
 */

import {writeSync} from "node:fs";

import type {CommandFailure, ModuleLog} from "./module";

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger extends ModuleLog {
    /** 之后每一行都带上这些字段，例如 `{module: "identity"}`。 */
    child(fields: LogFields): Logger;
}

export type LineWriter = (line: string) => void;

export const writeStdout: LineWriter = (line) => {
    writeSync(1, line);
};

export const writeStderr: LineWriter = (line) => {
    writeSync(2, line);
};

function line(level: "info" | "warn" | "error", event: string, message: string, fields: LogFields): string {
    // 固定字段放在前面，再用同样的值盖一次：字段里同名的键不能改掉 time、level、event 与 message。
    const fixed = {time: new Date().toISOString(), level, event};
    return `${JSON.stringify(Object.assign({}, fixed, fields, fixed, {message}))}\n`;
}

export function createLogger(write: LineWriter, base: LogFields = {}): Logger {
    const emit = (level: "info" | "warn" | "error") => (event: string, message: string, fields: LogFields = {}) => write(line(level, event, message, {...base, ...fields}));
    return {
        info: emit("info"),
        warn: emit("warn"),
        error: emit("error"),
        child: (fields) => createLogger(write, {...base, ...fields}),
    };
}

/** 命令失败时标准错误上的那一行：`code` 取 `site.operations` 失败表里的码，其余字段随码而定。 */
export function writeFailure(write: LineWriter, failure: CommandFailure): void {
    write(line("error", "command.failed", failure.message, {...failure.fields, code: failure.code}));
}

/** 错误的类型，给日志用：不带说明文字，说明里可能有请求内容、取值或路径。 */
export function errorType(error: unknown): string {
    if (error instanceof Error) return error.name === "Error" ? error.constructor.name : error.name;
    return typeof error;
}
