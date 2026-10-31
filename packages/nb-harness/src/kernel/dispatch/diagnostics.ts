/** 诊断：同一个（码、扩展、入口、事件类型）合并计数，不刷屏（提案第 12 节）。 */

import {diagnosticCodes, type Diagnostic, type DiagnosticCode} from "../api/index.js";

export interface DiagnosticInput {
    readonly code: DiagnosticCode;
    readonly extension?: string | null;
    readonly entry?: Diagnostic["entry"];
    readonly event?: Diagnostic["event"];
    readonly request?: number;
    readonly params?: Diagnostic["params"];
    readonly message: string;
    readonly hint?: string;
    readonly cause?: unknown;
    readonly persisted?: boolean;
}

export class Diagnostics {
    readonly #byKey = new Map<string, Diagnostic>();
    readonly #listeners = new Set<(diagnostic: Diagnostic) => void>();

    add(input: DiagnosticInput, seq: number): Diagnostic {
        const key = [input.code, input.extension ?? "", input.entry ?? "", input.event?.type ?? ""].join("|");
        const previous = this.#byKey.get(key);
        const cause = input.cause instanceof Error ? {name: input.cause.name, message: input.cause.message, ...(input.cause.stack === undefined ? {} : {stack: input.cause.stack})} : input.cause === undefined ? undefined : {name: "Error", message: String(input.cause)};
        const diagnostic: Diagnostic = {
            id: key,
            level: diagnosticCodes[input.code],
            code: input.code,
            extension: input.extension ?? null,
            entry: input.entry ?? "host",
            ...(input.event === undefined ? {} : {event: input.event}),
            ...(input.request === undefined ? {} : {request: input.request}),
            params: input.params ?? {},
            message: input.message,
            ...(input.hint === undefined ? {} : {hint: input.hint}),
            ...(cause === undefined ? {} : {cause}),
            count: (previous?.count ?? 0) + 1,
            firstSeq: previous?.firstSeq ?? seq,
            lastSeq: seq,
            persisted: input.persisted ?? false,
        };
        this.#byKey.set(key, diagnostic);
        for (const listener of this.#listeners) listener(diagnostic);
        return diagnostic;
    }

    all(): Diagnostic[] {
        return [...this.#byKey.values()];
    }

    subscribe(listener: (diagnostic: Diagnostic) => void): () => void {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }
}
