// 宿主拥有的 worker 引导脚本：加载插件预构建的单文件 ESM，逐个执行调用。
// 插件模块形状：export default async function (input, {progress}) { return output }
import {parentPort, workerData} from "node:worker_threads";

let task;
try {
    const module = await import(workerData.moduleUrl);
    task = module.default;
    if (typeof task !== "function") throw new TypeError(`worker 模块缺少 default 导出函数：${workerData.moduleUrl}`);
    parentPort.postMessage({type: "ready"});
} catch (error) {
    parentPort.postMessage({type: "load-failed", error: describe(error)});
}

parentPort.on("message", async (message) => {
    if (message.type !== "run" || !task) return;
    const {callId, input} = message;
    const progress = (value) => parentPort.postMessage({type: "progress", callId, value});
    let value;
    try {
        value = await task(input, {progress});
    } catch (error) {
        parentPort.postMessage({type: "result", callId, ok: false, error: {code: "task-error", ...describe(error)}});
        return;
    }
    try {
        parentPort.postMessage({type: "result", callId, ok: true, value});
    } catch (error) {
        parentPort.postMessage({type: "result", callId, ok: false, error: {code: "output-not-cloneable", ...describe(error)}});
    }
});

function describe(error) {
    return error instanceof Error
        ? {name: error.name, message: error.message, stack: error.stack}
        : {name: "NonError", message: String(error)};
}
