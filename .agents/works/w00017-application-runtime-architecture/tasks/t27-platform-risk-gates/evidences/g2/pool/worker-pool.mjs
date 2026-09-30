// 服务端 worker 池：Bun 的 node:worker_threads。
import {Worker} from "node:worker_threads";
import {availableParallelism} from "node:os";
import {WorkerPool as CorePool} from "./worker-pool-core.mjs";

const HOST_SCRIPT = new URL("./worker-host.mjs", import.meta.url);

export class WorkerPool extends CorePool {
    constructor(options = {}) {
        super({
            maxWorkers: Math.max(1, availableParallelism() - 1),
            createWorker: (moduleUrl) => new Worker(HOST_SCRIPT, {workerData: {moduleUrl}}),
            ...options,
        });
    }
}
