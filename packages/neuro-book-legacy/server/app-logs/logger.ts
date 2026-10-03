import path from "node:path";
import {resolveStateLogRoot, resolveStateWorkspaceRoot} from "nbook/server/runtime/installation-paths";
import {MAX_STRING_LENGTH, redactText, sanitizeDiagnosticValue, serializeDiagnosticError} from "nbook/runtime/diagnostics/diagnostics";
import {
    JsonlLogWriter,
    SERVER_LOG_CURRENT_NAME,
    listLogFiles,
    type LogFileSummary,
} from "./jsonl-log-writer";
import type {DiagnosticRecord} from "nbook/runtime/diagnostics/diagnostics";
import {formatDiagnosticLine} from "./diagnostic-format";

// 脱敏与序列化只有一份实现（runtime/diagnostics/redaction）；这里保留既有导出名，产品调用方不受影响。
export {redactSensitiveText} from "nbook/runtime/diagnostics/diagnostics";
export {
    sanitizeDiagnosticValue as sanitizeAppLogValue,
    serializeDiagnosticError as serializeAppLogError,
} from "nbook/runtime/diagnostics/diagnostics";

export type AppLogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export type AppLogEntry = {
    timestamp: string;
    level: AppLogLevel;
    event: string;
    message?: string;
    data?: unknown;
    error?: unknown;
};

export type AppLogFileSummary = LogFileSummary;

export type AppLogStatus = {
    directory: string;
    currentFile: string;
    files: AppLogFileSummary[];
    fileCount: number;
    totalBytes: number;
    latestMtimeMs: number | null;
};

type AppFileLoggerOptions = {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    maxFileBytes?: number;
    retention?: number;
    maxAgeMs?: number;
    maxTotalBytes?: number;
    now?: () => Date;
};

/**
 * 解析运行时日志目录。Windows portable 会通过环境变量显式指向 data/logs。
 */
export function resolveAppLogDirectory(options: Pick<AppFileLoggerOptions, "cwd" | "env"> = {}): string {
    const cwd = options.cwd ?? process.cwd();
    const env = options.env ?? process.env;
    const configured = env.NEURO_BOOK_LOG_DIR?.trim();
    if (configured) {
        return path.isAbsolute(configured) ? path.resolve(configured) : path.resolve(cwd, configured);
    }
    if (env.NODE_ENV === "production") {
        return resolveStateLogRoot(cwd, env);
    }
    return path.join(resolveStateWorkspaceRoot(cwd, env), ".nbook", "logs");
}

/**
 * 返回当前 server JSONL 文件路径。
 */
export function resolveCurrentServerLogPath(directory = resolveAppLogDirectory()): string {
    return path.join(directory, SERVER_LOG_CURRENT_NAME);
}

/**
 * 列出当前日志目录中的 server / launcher 日志。
 */
export async function listAppLogFiles(directory = resolveAppLogDirectory()): Promise<AppLogFileSummary[]> {
    return listLogFiles(directory, isAppLogFileName);
}

/**
 * 汇总日志目录状态，供错误报告界面或 API 展示。
 */
export async function readAppLogStatus(directory = resolveAppLogDirectory()): Promise<AppLogStatus> {
    const files = await listAppLogFiles(directory);
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    return {
        directory,
        currentFile: resolveCurrentServerLogPath(directory),
        files,
        fileCount: files.length,
        totalBytes,
        latestMtimeMs: files[0]?.mtimeMs ?? null,
    };
}

/**
 * JSONL 文件日志器。写入失败不应打断业务请求：调用方看到的写入 Promise 永不 reject，
 * 完整日志不可用由诊断出口的降级状态负责报告。
 */
export class AppFileLogger {
    readonly #writer: JsonlLogWriter;
    readonly #now: () => Date;

    constructor(options: AppFileLoggerOptions = {}) {
        this.#writer = new JsonlLogWriter({
            directory: resolveAppLogDirectory(options),
            ownsFile: isAppLogFileName,
            maxFileBytes: options.maxFileBytes,
            retention: options.retention,
            maxAgeMs: options.maxAgeMs,
            maxTotalBytes: options.maxTotalBytes,
            now: options.now,
        });
        this.#now = options.now ?? (() => new Date());
    }

    /** 排空写队列并关闭共享 writer；产品日志器不参与位置授予。 */
    async close(): Promise<void> {
        await this.#writer.close();
    }

    /** 诊断出口复用 appLogger 的 writer，不创建第二个 JSONL writer。 */
    writeDiagnostic(record: DiagnosticRecord): Promise<void> {
        return this.#writer.write(formatDiagnosticLine(record));
    }

    /**
     * 写 debug 级别诊断事件。
     */
    debug(event: string, data?: unknown, message?: string): Promise<void> {
        return this.write("debug", event, data, undefined, message);
    }

    /**
     * 写 info 级别诊断事件。
     */
    info(event: string, data?: unknown, message?: string): Promise<void> {
        return this.write("info", event, data, undefined, message);
    }

    /**
     * 写 warn 级别诊断事件。
     */
    warn(event: string, data?: unknown, message?: string): Promise<void> {
        return this.write("warn", event, data, undefined, message);
    }

    /**
     * 写 error 级别诊断事件。
     */
    error(event: string, data?: unknown, error?: unknown, message?: string): Promise<void> {
        return this.write("error", event, data, error, message);
    }

    /**
     * 写 fatal 级别诊断事件。
     */
    fatal(event: string, data?: unknown, error?: unknown, message?: string): Promise<void> {
        return this.write("fatal", event, data, error, message);
    }

    /**
     * 同步写 fatal 日志，用于即将崩溃的进程级异常路径。
     */
    fatalSync(event: string, data?: unknown, error?: unknown, message?: string): void {
        try {
            this.#writer.writeSync(formatLogLine(this.#now(), "fatal", event, data, error, message));
        } catch {
            // 日志出口本身不可用时必须静默收口；再次写 stderr 会在断管时递归触发 EPIPE。
        }
    }

    /**
     * 等待当前日志写入队列清空，主要供测试使用。
     */
    async flush(): Promise<void> {
        await this.#writer.flush();
    }

    get logDirectory(): string {
        return this.#writer.directory;
    }

    get currentFilePath(): string {
        return this.#writer.currentFilePath;
    }

    private write(level: AppLogLevel, event: string, data?: unknown, error?: unknown, message?: string): Promise<void> {
        return this.#writer.write(formatLogLine(this.#now(), level, event, data, error, message)).catch(() => undefined);
    }
}

export const appLogger = new AppFileLogger();

/** 既有 JSONL 字段含义保持不变；消息、数据与错误在格式化时脱敏并截断。 */
function formatLogLine(now: Date, level: AppLogLevel, event: string, data?: unknown, error?: unknown, message?: string): string {
    const entry: AppLogEntry = {
        timestamp: now.toISOString(),
        level,
        event,
        ...(message ? {message: redactText(message, MAX_STRING_LENGTH)} : {}),
        ...(data !== undefined ? {data: sanitizeDiagnosticValue(data)} : {}),
        ...(error !== undefined ? {error: serializeDiagnosticError(error)} : {}),
    };
    return `${JSON.stringify(entry)}\n`;
}

/** 日志器拥有的文件名：current、server 轮转产物与 launcher 日志；其它文件不列出也不回收。 */
function isAppLogFileName(name: string): boolean {
    return name === SERVER_LOG_CURRENT_NAME
        || /^server-\d{8}-\d{6}-\d+-[a-f0-9]+\.jsonl$/iu.test(name)
        || /^launcher-\d{4}-\d{2}-\d{2}(?:-\d{6}-\d+-[a-f0-9]+)?\.log$/iu.test(name);
}
