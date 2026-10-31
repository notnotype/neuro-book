/**
 * 测试用的子进程：在指定的时刻停住，打一行 `<时刻> <会话 id>`，等父进程 `kill -9`（runtime.md 输出 34、session.md 场景 4）。
 * 用法：bun crash-session.ts <根目录> in-tool|after-accept
 *
 * - in-tool：缓冲区先排一条 followup，再发一条话；模型调用 `lab.block`（开始执行后停住）与 `lab.never`（排在后面，没开始）。
 * - after-accept：`runStarted` 的反应停住：受理批已经落盘，运行循环还没开始。
 */

import {defineExtension} from "@notnotype/nb-harness/kernel";
import {createTestSession} from "@notnotype/nb-harness/kernel/testing";

const [root, mode] = process.argv.slice(2) as [string, "in-tool" | "after-accept"];
const hang = () => new Promise<never>(() => undefined);
let announce = (_what: string) => undefined as void;
const stall = defineExtension({id: "lab.stall", on: {runStarted: async () => {
    if (mode !== "after-accept") return;
    announce("accepted");
    await hang();
}}});
const session = await createTestSession({
    store: {root},
    extensions: [stall],
    tools: [
        {id: "lab.block", execute: async () => {
            announce("started");
            return hang();
        }},
        {id: "lab.never", execute: () => "不会执行"},
    ],
});
announce = (what) => console.log(`${what} ${session.id}`);
session.model.script({tools: [{tool: "lab.block"}, {tool: "lab.never"}]});
if (mode === "in-tool") await session.raw.enqueue({commandId: "queued", input: {text: "排着的"}, mode: "followup"});
void session.raw.send({commandId: "first", input: {text: "问"}});
setInterval(() => undefined, 1 << 30);
