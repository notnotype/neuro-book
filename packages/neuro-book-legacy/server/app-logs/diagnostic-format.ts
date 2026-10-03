import type {DiagnosticOrigin, DiagnosticRecord} from "nbook/runtime/diagnostics/diagnostics";

/** 诊断记录与 appLogger 共用同一行布局；来源身份放进 data.$source。 */
export function formatDiagnosticLine(record: DiagnosticRecord): string {
    const entry: Record<string, unknown> = {
        timestamp: record.timestamp,
        level: record.level,
        event: record.event,
        message: record.message,
        data: attachSource(record.data, record.origin),
    };
    if (record.error !== null) {
        entry.error = record.error;
    }
    return `${JSON.stringify(entry)}\n`;
}

function attachSource(data: unknown, origin: DiagnosticOrigin): Record<string, unknown> {
    if (data === null) {
        return {$source: origin};
    }
    if (typeof data === "object" && !Array.isArray(data)) {
        const prototype = Object.getPrototypeOf(data);
        if (prototype === Object.prototype || prototype === null) {
            return {...data, $source: origin};
        }
    }
    return {value: data, $source: origin};
}
