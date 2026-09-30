// worker 池原型核心（服务端与浏览器共用）。
// 语义：按需创建、总数与每插件上限、同一插件同一模块的空闲 worker 复用、
// signal 中止即 terminate 并以“已中断”结算、禁用插件时终止该插件全部 worker。
// 结果一律以结构化结果返回，不向调用方抛异常（P4 第 4 条）。
// 本文件不依赖任何平台模块：服务端与浏览器各自注入 createWorker（返回 node:worker_threads 形状的 worker）。

/** @typedef {{ok: true, value: unknown} | {ok: false, error: {code: string, message: string, name?: string, stack?: string, reason?: string}}} RunResult */

export class WorkerPool {
    constructor({maxWorkers, maxWorkersPerPlugin = 2, idleTimeoutMs = 30_000, createWorker}) {
        this.maxWorkers = maxWorkers;
        this.maxWorkersPerPlugin = maxWorkersPerPlugin;
        this.idleTimeoutMs = idleTimeoutMs;
        this.createWorker = createWorker;
        this.workers = new Set();
        this.queue = [];
        this.disabled = new Map();
        this.counters = {spawned: 0, terminated: 0, reused: 0, maxConcurrent: 0};
        this.nextCallId = 1;
    }

    /** SDK 注入给插件的 ctx.workers；pluginId 由宿主绑定，插件不能冒用。 */
    forPlugin(pluginId) {
        return {run: (moduleUrl, input, options = {}) => this.run(pluginId, String(moduleUrl), input, options)};
    }

    /** @returns {Promise<RunResult>} */
    run(pluginId, moduleUrl, input, {signal, onProgress, transfer} = {}) {
        if (this.disabled.has(pluginId)) return Promise.resolve(interrupted("plugin-disabled"));
        if (signal?.aborted) return Promise.resolve(interrupted("aborted"));
        return new Promise((resolve) => {
            const call = {id: this.nextCallId++, pluginId, moduleUrl, input, transfer, onProgress, signal, resolve, settled: false, worker: null};
            call.settle = (result) => {
                if (call.settled) return;
                call.settled = true;
                signal?.removeEventListener("abort", call.onAbort);
                resolve(result);
            };
            call.onAbort = () => this.abort(call, "aborted");
            signal?.addEventListener("abort", call.onAbort, {once: true});
            this.queue.push(call);
            this.pump();
        });
    }

    /** 禁用插件：拒绝新调用，结算排队与在途调用，终止它的全部 worker，等待线程退出。 */
    async disablePlugin(pluginId, reason = "plugin-disabled") {
        this.disabled.set(pluginId, reason);
        for (const call of this.queue.filter((c) => c.pluginId === pluginId)) {
            this.queue.splice(this.queue.indexOf(call), 1);
            call.settle(interrupted(reason));
        }
        const exits = [];
        for (const record of [...this.workers].filter((w) => w.pluginId === pluginId)) {
            if (record.call) record.call.settle(interrupted(reason));
            exits.push(this.retire(record));
        }
        await Promise.all(exits);
        this.pump();
    }

    enablePlugin(pluginId) { this.disabled.delete(pluginId); }

    async close() {
        for (const call of this.queue.splice(0)) call.settle(interrupted("host-stopping"));
        await Promise.all([...this.workers].map((record) => {
            record.call?.settle(interrupted("host-stopping"));
            return this.retire(record);
        }));
    }

    stats() {
        return {...this.counters, live: this.workers.size, queued: this.queue.length};
    }

    // ---- 内部 ----

    abort(call, reason) {
        if (call.settled) return;
        const queued = this.queue.indexOf(call);
        if (queued >= 0) this.queue.splice(queued, 1);
        // 同步代码无法被协作打断：直接终止执行它的 worker，调用方立刻得到“已中断”
        call.settle(interrupted(reason));
        if (call.worker) void this.retire(call.worker);
        this.pump();
    }

    pump() {
        for (let i = 0; i < this.queue.length;) {
            const call = this.queue[i];
            const idle = [...this.workers].find((w) => w.state === "idle" && w.pluginId === call.pluginId && w.moduleUrl === call.moduleUrl);
            if (idle) {
                this.queue.splice(i, 1);
                this.counters.reused++;
                this.dispatch(idle, call);
                continue;
            }
            const pluginCount = [...this.workers].filter((w) => w.pluginId === call.pluginId).length;
            if (pluginCount < this.maxWorkersPerPlugin) {
                if (this.workers.size >= this.maxWorkers) {
                    // 满员时回收一个别人的空闲 worker 给排队者
                    const victim = [...this.workers].find((w) => w.state === "idle");
                    if (victim) void this.retire(victim);
                }
                if (this.workers.size < this.maxWorkers) {
                    this.queue.splice(i, 1);
                    this.dispatch(this.spawn(call.pluginId, call.moduleUrl), call);
                    continue;
                }
            }
            i++;
        }
    }

    spawn(pluginId, moduleUrl) {
        const worker = this.createWorker(moduleUrl);
        this.counters.spawned++;
        const record = {pluginId, moduleUrl, worker, state: "starting", call: null, idleTimer: null, exited: null, retiring: false, loadError: null};
        record.exited = new Promise((resolve) => worker.once("exit", resolve));
        record.ready = new Promise((resolve) => {
            const onMessage = (message) => {
                if (message.type === "ready") { worker.off("message", onMessage); resolve(true); }
                if (message.type === "load-failed") { worker.off("message", onMessage); record.loadError = message.error; resolve(false); }
            };
            worker.on("message", onMessage);
        });
        worker.on("message", (message) => this.onMessage(record, message));
        worker.on("error", (error) => this.onCrash(record, {code: "worker-crashed", message: error.message, name: error.name, stack: error.stack}));
        worker.on("exit", (code) => {
            this.workers.delete(record);
            if (!record.retiring) this.onCrash(record, {code: "worker-crashed", message: `worker 意外退出，exitCode=${code}`});
            this.pump();
        });
        this.workers.add(record);
        this.counters.maxConcurrent = Math.max(this.counters.maxConcurrent, this.workers.size);
        return record;
    }

    async dispatch(record, call) {
        clearTimeout(record.idleTimer);
        record.state = "busy";
        record.call = call;
        call.worker = record;
        if (!await record.ready) {
            call.settle({ok: false, error: {code: "load-failed", ...record.loadError}});
            void this.retire(record);
            return;
        }
        if (call.settled) return; // 等待就绪期间已被中止
        try {
            record.worker.postMessage({type: "run", callId: call.id, input: call.input}, call.transfer ?? []);
        } catch (error) {
            // 输入不可结构化克隆：同步抛 DataCloneError，worker 仍可复用
            call.settle({ok: false, error: {code: "input-not-cloneable", name: error.name, message: error.message}});
            this.release(record);
        }
    }

    onMessage(record, message) {
        const call = record.call;
        if (!call || message.callId !== call.id) return; // 迟到消息一律丢弃
        if (message.type === "progress") {
            if (!call.settled) call.onProgress?.(message.value);
            return;
        }
        if (message.type === "result") {
            call.settle(message.ok ? {ok: true, value: message.value} : {ok: false, error: message.error});
            this.release(record);
        }
    }

    onCrash(record, error) {
        const call = record.call;
        record.call = null;
        call?.settle({ok: false, error});
        if (!record.retiring) void this.retire(record);
    }

    release(record) {
        record.call = null;
        record.state = "idle";
        record.idleTimer = setTimeout(() => void this.retire(record), this.idleTimeoutMs);
        record.idleTimer.unref?.();
        this.pump();
    }

    retire(record) {
        if (!record.retiring) {
            record.retiring = true;
            record.state = "retiring";
            clearTimeout(record.idleTimer);
            this.counters.terminated++;
            void record.worker.terminate();
        }
        return record.exited;
    }
}

function interrupted(reason) {
    return {ok: false, error: {code: "interrupted", reason, message: `已中断：${reason}`}};
}
