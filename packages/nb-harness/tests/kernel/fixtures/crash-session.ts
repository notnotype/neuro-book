/**
 * 测试用的子进程：在指定的时刻停住，打一行 `<时刻> <会话 id>`，等父进程 `kill -9`（runtime.md 输出 34、session.md 场景 4）。
 * 用法：bun crash-session.ts <根目录> in-tool|after-accept|waiting-approval|compacting
 *
 * - in-tool：缓冲区先排一条 followup，再发一条话；模型调用 `lab.block`（开始执行后停住）与 `lab.never`（排在后面，没开始）。
 * - after-accept：`runStarted` 的反应停住：受理批已经落盘，运行循环还没开始。
 * - waiting-approval：模型先调用 `lab.asker`（提一个异步问题就返回），再调用 `lab.gated`（审批判定 ask），运行进 waiting 时停住。
 * - compacting：一轮对话之后开一次只压缩的运行，压缩方法的模型请求（`modelStarted{purpose: "compaction"}`）写下后停住。
 */

import {defineExtension} from "@notnotype/nb-harness/kernel";
import {createTestSession, summarizingCompaction} from "@notnotype/nb-harness/kernel/testing";

const [root, mode] = process.argv.slice(2) as [string, "in-tool" | "after-accept" | "waiting-approval" | "compacting"];
const hang = () => new Promise<never>(() => undefined);
let announce = (_what: string) => undefined as void;
const stall = defineExtension({id: "lab.stall", on: {runStarted: async () => {
    if (mode !== "after-accept") return;
    announce("accepted");
    await hang();
}}, intercept: {model: async (request, next) => {
    if (mode === "compacting" && request.purpose === "compaction") {
        // 拦截在 modelStarted 之前；等这次请求写下（下面订阅帧时宣布）再停住。
        return next(request).then(hang);
    }
    return next(request);
}}});

const session = await createTestSession({
    store: {root},
    // 缺省 Profile 的压缩顺序以 shake 开头：把测试的摘要方法登记在这个名字下（父进程按缺省 Profile 重开）。
    compaction: {methods: {shake: summarizingCompaction}},
    extensions: [stall],
    tools: [
        {id: "lab.block", execute: async () => {
            announce("started");
            return hang();
        }},
        {id: "lab.never", execute: () => "不会执行"},
        {id: "lab.asker", execute: async (_args, context) => {
            await context.ask?.({question: "主角叫什么？"}, {async: true});
            return "问过了";
        }},
        {id: "lab.gated", execute: () => "执行了"},
    ],
    approve: async (call) => (call.tool === "lab.gated" ? {verdict: "ask", reason: "要写文件"} : {verdict: "allow", by: "rule"}),
});
announce = (what) => console.log(`${what} ${session.id}`);
if (mode === "compacting") {
    session.raw.subscribe((frame) => {
        if (frame.type === "log" && frame.event.type === "modelStarted" && (frame.event.data as {purpose: string}).purpose === "compaction") announce("compacting");
    });
    session.model.script("答一");
    await session.say("第一问");
    void session.raw.compact({commandId: "compact"});
} else if (mode === "waiting-approval") {
    session.raw.subscribe((frame) => {
        if (frame.type === "status" && frame.status.state === "waiting") announce("waiting");
    });
    session.model.script({tools: [{tool: "lab.asker"}, {tool: "lab.gated"}]});
} else session.model.script({tools: [{tool: "lab.block"}, {tool: "lab.never"}]});
if (mode === "in-tool") await session.raw.enqueue({commandId: "queued", input: {text: "排着的"}, mode: "followup"});
if (mode !== "compacting") void session.raw.send({commandId: "first", input: {text: "问"}});
setInterval(() => undefined, 1 << 30);
