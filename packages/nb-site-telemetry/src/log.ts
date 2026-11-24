/** 模块写日志的出口；`event` 是稳定的英文事件名，`message` 是英文说明，`fields` 不放秘密、正文、请求头与来源地址。 */
export interface TelemetryLog {
    info(event: string, message: string, fields?: Readonly<Record<string, unknown>>): void;
    warn(event: string, message: string, fields?: Readonly<Record<string, unknown>>): void;
    error(event: string, message: string, fields?: Readonly<Record<string, unknown>>): void;
}
