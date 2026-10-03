/**
 * 浏览器诊断出口：把记录写到宿主 console，只写不读，不要求落盘。
 *
 * 本目录只允许相对导入与 runtime 合同：不引用后端、node 内置、Vue、Nuxt 或 `#imports`，
 * 也不持有任何文件句柄——有界内存记录与查询由 runtime.diagnostics 的 store 负责。
 */

import type {
    DiagnosticExporter,
    DiagnosticExporterFactory,
    DiagnosticFallback,
    DiagnosticLevel,
    DiagnosticRecord,
} from "../../../runtime/diagnostics/diagnostics";

/** 宿主 console 的最小面：只要求写通道；缺省级别方法时退到 error，绝不静默丢弃。 */
export interface DiagnosticsConsole {
    readonly debug?: (...args: unknown[]) => void;
    readonly info?: (...args: unknown[]) => void;
    readonly warn?: (...args: unknown[]) => void;
    readonly error: (...args: unknown[]) => void;
}

/** 创建 console 出口工厂：始终可用，不校验位置、不读任何历史。 */
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
        const method = methodFor(this.#target, record.level);
        // 保留 this 绑定：宿主 console 的实现可能依赖自身状态。
        Reflect.apply(method, this.#target, [`${record.timestamp} [${record.level}] ${record.event}: ${record.message}`, record]);
    }

    async close(): Promise<void> {
        // 只写通道没有句柄：关闭是空操作，重复关闭共享同一结果。
    }
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

/** 宿主兜底通道：降级时用 console.error 输出最小可见信息；本身永不抛错。 */
export function createConsoleFallback(target: DiagnosticsConsole): DiagnosticFallback {
    return (record) => {
        try {
            Reflect.apply(target.error, target, [`[diagnostic-fallback] ${record.timestamp} [${record.level}] ${record.event}: ${record.message}`, record]);
        } catch {
            // 兜底通道自身异常时不再尝试第二次上报。
        }
    };
}
