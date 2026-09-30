// 浏览器端宿主 worker 引导脚本（module worker）：与服务端 worker-host.mjs 同一消息协议。
let task = null;
self.onmessage = async (event) => {
    const message = event.data;
    if (message.type === "init") {
        try {
            const module = await import(message.moduleUrl);
            if (typeof module.default !== "function") throw new TypeError(`worker 模块缺少 default 导出函数：${message.moduleUrl}`);
            task = module.default;
            self.postMessage({type: "ready"});
        } catch (error) {
            self.postMessage({type: "load-failed", error: describe(error)});
        }
        return;
    }
    if (message.type !== "run" || !task) return;
    const {callId, input} = message;
    const progress = (value) => self.postMessage({type: "progress", callId, value});
    let value;
    try {
        value = await task(input, {progress});
    } catch (error) {
        self.postMessage({type: "result", callId, ok: false, error: {code: "task-error", ...describe(error)}});
        return;
    }
    try {
        self.postMessage({type: "result", callId, ok: true, value});
    } catch (error) {
        self.postMessage({type: "result", callId, ok: false, error: {code: "output-not-cloneable", ...describe(error)}});
    }
};
function describe(error) {
    return error instanceof Error ? {name: error.name, message: error.message, stack: error.stack} : {name: "NonError", message: String(error)};
}
