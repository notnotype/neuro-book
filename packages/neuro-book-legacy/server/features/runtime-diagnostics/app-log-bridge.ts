import {consola} from "consola";
import {appLogger} from "nbook/server/app-logs/logger";

type ConsolaLogObject = {
    type?: string;
    level?: number;
    tag?: string;
    args?: unknown[];
};

export type AppLogBridge = Readonly<{close: () => void}>;

/** 每个产品运行实例独立安装桥接；关闭时恢复宿主进程的原始观察者。 */
export function installAppLogBridge(): AppLogBridge {
    const production = process.env.NODE_ENV === "production";
    const reporter = {
        log(logObject: ConsolaLogObject) {
            const level = resolveConsolaLevel(logObject);
            void safeLog(() => appLogger[level]("consola", {
                type: logObject.type,
                tag: logObject.tag,
                args: logObject.args ?? [],
            }));
        },
    };
    const previousReporters = [...consola.options.reporters];
    if (production) {
        // Product 的父 stdout/stderr 可能随 supervisor 生命周期关闭；JSONL 是唯一稳定出口。
        consola.setReporters([reporter]);
    } else {
        consola.addReporter(reporter);
    }

    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = (...args: unknown[]) => {
        if (!production) {
            originalWarn.apply(console, args);
        }
        void safeLog(() => appLogger.warn("console.warn", {args}, formatConsoleArgs(args)));
    };
    console.error = (...args: unknown[]) => {
        if (!production) {
            originalError.apply(console, args);
        }
        void safeLog(() => appLogger.error("console.error", {args}, args.find((arg) => arg instanceof Error), formatConsoleArgs(args)));
    };

    const onUnhandledRejection = (reason: unknown): void => {
        appLogger.fatalSync("process.unhandledRejection", undefined, reason, "Unhandled promise rejection");
        setImmediate(() => {
            throw reason instanceof Error ? reason : new Error(`Unhandled promise rejection: ${String(reason)}`);
        });
    };
    const onUncaughtException = (error: unknown): void => {
        appLogger.fatalSync("process.uncaughtException", undefined, error, "Uncaught exception");
    };
    process.on("unhandledRejection", onUnhandledRejection);
    process.on("uncaughtExceptionMonitor", onUncaughtException);


    let closed = false;
    return {
        close() {
            if (closed) return;
            closed = true;
            process.off("unhandledRejection", onUnhandledRejection);
            process.off("uncaughtExceptionMonitor", onUncaughtException);
            console.warn = originalWarn;
            console.error = originalError;
            if (production) {
                consola.setReporters(previousReporters);
            } else {
                consola.removeReporter(reporter);
            }
        },
    };
}

async function safeLog(task: () => Promise<void>): Promise<void> {
    await Promise.resolve().then(task).catch((error: unknown) => {
        appLogger.fatalSync("app.logs.bridgeFailed", undefined, error, "进程日志桥接失败");
    });
}

function resolveConsolaLevel(logObject: ConsolaLogObject): "debug" | "info" | "warn" | "error" {
    if (logObject.type === "error" || logObject.type === "fatal") {
        return "error";
    }
    if (logObject.type === "warn") {
        return "warn";
    }
    if (typeof logObject.level === "number" && logObject.level >= 4) {
        return "debug";
    }
    return "info";
}


function formatConsoleArgs(args: unknown[]): string {
    return args.map((arg) => {
        if (arg instanceof Error) {
            return arg.message;
        }
        if (typeof arg === "string") {
            return arg;
        }
        return typeof arg;
    }).join(" ");
}
