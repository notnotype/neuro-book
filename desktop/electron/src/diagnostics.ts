import {appendFile, mkdir} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";

type DiagnosticEvent = Record<string, unknown>;

type DiagnosticStream = {
    destroyed?: boolean;
    writable?: boolean;
    on(event: "error", listener: (error: NodeJS.ErrnoException) => void): unknown;
    write(chunk: string): boolean;
};

export type ElectronDiagnosticsOptions = {
    stdout?: DiagnosticStream | null;
    stderr?: DiagnosticStream | null;
};

/** Electron GUI 诊断不能假定父终端长期存在；结构化事件同时落入 State Root 日志。 */
export class ElectronDiagnostics {
    private readonly stdout: DiagnosticStream | null;
    private readonly stderr: DiagnosticStream | null;
    private stdoutAvailable = true;
    private stderrAvailable = true;
    private logFile: string | null = null;
    private fileWrites: Promise<void> = Promise.resolve();

    constructor(options: ElectronDiagnosticsOptions = {}) {
        this.stdout = options.stdout === undefined ? process.stdout : options.stdout;
        this.stderr = options.stderr === undefined ? process.stderr : options.stderr;
        this.guard(this.stdout, "stdout");
        this.guard(this.stderr, "stderr");
    }

    setLogRoot(logRoot: string): void {
        this.logFile = join(resolve(logRoot), "desktop-envelope-current.jsonl");
    }

    info(event: DiagnosticEvent): void {
        this.emit("info", event, this.stdout, "stdout");
    }

    error(event: DiagnosticEvent): void {
        this.emit("error", event, this.stderr, "stderr");
    }

    async flush(): Promise<void> {
        await this.fileWrites;
    }

    private emit(level: "info" | "error", event: DiagnosticEvent, stream: DiagnosticStream | null, kind: "stdout" | "stderr"): void {
        const line = `${JSON.stringify(event)}\n`;
        if (this.logFile) {
            const logFile = this.logFile;
            this.fileWrites = this.fileWrites.then(async () => {
                await mkdir(dirname(logFile), {recursive: true});
                await appendFile(logFile, `${JSON.stringify({timestamp: new Date().toISOString(), level, ...event})}\n`, "utf8");
            }).catch(() => undefined);
        }
        if (!stream || !this.available(kind) || stream.destroyed || stream.writable === false) return;
        try {
            stream.write(line);
        } catch {
            this.disable(kind);
        }
    }

    private guard(stream: DiagnosticStream | null, kind: "stdout" | "stderr"): void {
        if (!stream) {
            this.disable(kind);
            return;
        }
        try {
            stream.on("error", () => this.disable(kind));
        } catch {
            this.disable(kind);
        }
    }

    private available(kind: "stdout" | "stderr"): boolean {
        return kind === "stdout" ? this.stdoutAvailable : this.stderrAvailable;
    }

    private disable(kind: "stdout" | "stderr"): void {
        if (kind === "stdout") this.stdoutAvailable = false;
        else this.stderrAvailable = false;
    }
}
