/**
 * 浏览器诊断出口：把记录写到 console，只写不读。有界的内存记录与查询由内核的诊断存储负责，
 * 这里不持有句柄，打开总是成功。
 */

import type {
    DiagnosticExporter,
    DiagnosticExporterFactory,
    DiagnosticFallback,
    DiagnosticLevel,
    DiagnosticRecord,
} from "@notnotype/nb-runtime/diagnostics";

/** console 的最小面：只要求 error；其它级别缺省时退到 error，不静默丢弃。 */
export interface DiagnosticsConsole {
    readonly debug?: (...args: unknown[]) => void;
    readonly info?: (...args: unknown[]) => void;
    readonly warn?: (...args: unknown[]) => void;
    readonly error: (...args: unknown[]) => void;
}

export function createConsoleExporterFactory(target: DiagnosticsConsole): DiagnosticExporterFactory {
    return async () => ({status: "open", exporter: new ConsoleDiagnosticExporter(target)});
}

class ConsoleDiagnosticExporter implements DiagnosticExporter {
    readonly kind = "console";
    readonly #target: DiagnosticsConsole;

    constructor(target: DiagnosticsConsole) {
        this.#target = target;
    }

    write(record: DiagnosticRecord): void {
        // 保留 this：浏览器 console 的方法离开 console 对象调用会抛 Illegal invocation。
        Reflect.apply(methodFor(this.#target, record.level), this.#target, [`${record.timestamp} [${record.level}] ${record.event}: ${record.message}`, record]);
    }

    async close(): Promise<void> {}
}

function methodFor(target: DiagnosticsConsole, level: DiagnosticLevel): (...args: unknown[]) => void {
    switch (level) {
        case "debug":
            return target.debug ?? target.error;
        case "info":
            return target.info ?? target.error;
        case "warn":
            return target.warn ?? target.error;
        case "error":
        case "fatal":
            return target.error;
    }
}

/** 出口不可用时的兜底通道：用 console.error 留下最小可见信息；它自己失败时没有更低一级的出口，按合同不抛。 */
export function createConsoleFallback(target: DiagnosticsConsole): DiagnosticFallback {
    return (record) => {
        try {
            Reflect.apply(target.error, target, [`[diagnostic-fallback] ${record.timestamp} [${record.level}] ${record.event}: ${record.message}`, record]);
        } catch {
            // 见上：兜底通道失败只能放弃这一条。
        }
    };
}
