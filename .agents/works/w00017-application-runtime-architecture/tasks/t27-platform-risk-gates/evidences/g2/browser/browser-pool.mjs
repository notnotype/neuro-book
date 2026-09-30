// 浏览器端 worker 池：同一个池核心，注入 Web Worker 适配器。
// Web Worker 没有 exit 事件；terminate() 按规范立即中止脚本，适配器在终止后同步报告退出。
import {WorkerPool as CorePool} from "../pool/worker-pool-core.mjs";
const HOST = new URL("./worker-host.browser.mjs", import.meta.url);

class WebWorkerAdapter {
    constructor(moduleUrl) {
        this.listeners = {message: new Set(), error: new Set(), exit: new Set()};
        this.worker = new Worker(HOST, {type: "module"});
        this.worker.onmessage = (event) => this.emit("message", event.data);
        this.worker.onerror = (event) => { event.preventDefault(); this.emit("error", new Error(event.message || "worker error")); };
        this.worker.postMessage({type: "init", moduleUrl});
    }
    postMessage(message, transfer) { this.worker.postMessage(message, transfer); }
    terminate() {
        this.worker.terminate();
        queueMicrotask(() => this.emit("exit", 1));
        return Promise.resolve(1);
    }
    on(type, fn) { this.listeners[type].add(fn); return this; }
    off(type, fn) { this.listeners[type].delete(fn); return this; }
    once(type, fn) { const wrap = (v) => { this.off(type, wrap); fn(v); }; return this.on(type, wrap); }
    emit(type, value) { for (const fn of [...this.listeners[type]]) fn(value); }
}

export class BrowserWorkerPool extends CorePool {
    constructor(options = {}) {
        super({maxWorkers: Math.max(1, (navigator.hardwareConcurrency || 2) - 1), createWorker: (moduleUrl) => new WebWorkerAdapter(moduleUrl), ...options});
    }
}
