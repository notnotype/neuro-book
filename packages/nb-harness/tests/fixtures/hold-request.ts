/**
 * 测试用的子进程：打开记录器，经包过的端口发一次永远不结束的请求；记录写好、请求到了“适配器”时在标准输出打一行
 * `started`，然后一直挂着，直到被父进程结束。
 * 用法：bun hold-request.ts <记录目录>
 */

import {RequestRecorder, traceModelPort} from "@notnotype/nb-harness/kit/requests";

const [root] = process.argv.slice(2) as [string];
const recorder = new RequestRecorder({root, settings: () => ({enabled: true, payload: true, headers: false}), report: (code, message) => console.error(code, message)});
await recorder.open();
const port = traceModelPort({
    resolve: () => ({
        ok: true,
        info: {id: "test/model", contextWindow: 100_000, capabilities: {vision: false, thinking: false}, efforts: []},
        call: () => {
            console.log("started");
            return new Promise(() => undefined);
        },
    }),
}, recorder);
const resolution = port.resolve({settings: {model: null, effort: null, approvalMode: "ask", readOnly: false}, purpose: "turn", profile: "p"});
if (!resolution.ok) throw new Error(resolution.code);
void resolution.call(
    {purpose: "turn", model: "test/model", params: {}, headers: {}, system: [], messages: [{role: "user", content: [{kind: "text", text: "挂着", origin: {kind: "fixed", by: "kernel"}}]}], tools: []},
    new AbortController().signal,
    () => undefined,
    {session: "held", request: 1, hash: "h1"},
);
setInterval(() => undefined, 1 << 30);
