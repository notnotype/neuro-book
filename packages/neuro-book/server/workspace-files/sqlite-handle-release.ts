import v8 from "node:v8";
import vm from "node:vm";

type RuntimeWithGarbageCollector = typeof globalThis & {
    Bun?: {
        gc?: (force?: boolean) => void;
    };
    __sqliteHandleReleaseGcExposed?: boolean;
};

type GarbageCollector = () => void | Promise<void>;

export type SqliteHandleReleaseOptions = {
    force?: boolean;
};

const NODE_GC_INTERVAL_MS = 100;
let lastNodeGcAt = 0;
let nodeGarbageCollector: (() => void) | undefined;

/**
 * Bun / Node + libsql 在 Windows 上可能要等 native Database 对象被 GC 后才释放文件句柄。
 */
export function collectReleasedSqliteHandles(options: SqliteHandleReleaseOptions = {}): void {
    const runtime = globalThis as RuntimeWithGarbageCollector;
    const force = options.force ?? false;
    runtime.Bun?.gc?.(force);
    if (!force && Date.now() - lastNodeGcAt < NODE_GC_INTERVAL_MS) {
        return;
    }
    resolveNodeGarbageCollector(runtime)?.();
    lastNodeGcAt = Date.now();
}

function resolveNodeGarbageCollector(runtime: RuntimeWithGarbageCollector): (() => void) | undefined {
    if (nodeGarbageCollector) {
        return nodeGarbageCollector;
    }
    const globalCollector = (globalThis as {gc?: GarbageCollector}).gc;
    if (globalCollector) {
        nodeGarbageCollector = () => {
            void globalCollector();
        };
        return nodeGarbageCollector;
    }
    try {
        if (!runtime.__sqliteHandleReleaseGcExposed) {
            v8.setFlagsFromString("--expose_gc");
            runtime.__sqliteHandleReleaseGcExposed = true;
        }
        // HMR 会丢掉本模块的函数缓存，进程标记只证明已启用，不能代替重新取得 collector。
        const exposed = vm.runInNewContext("gc") as unknown;
        if (typeof exposed !== "function") {
            return undefined;
        }
        const collector = exposed as GarbageCollector;
        nodeGarbageCollector = () => {
            void collector();
        };
        return nodeGarbageCollector;
    } catch {
        return undefined;
    }
}
