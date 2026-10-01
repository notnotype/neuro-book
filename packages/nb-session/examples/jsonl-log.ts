/**
 * JSONL 会话日志的三个阶段：追加、重开续写、中断尾修复。
 *
 * 运行：bun examples/jsonl-log.ts
 */
import {appendFile, mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createJsonlSessionLog} from "@notnotype/nb-session";

const root = await mkdtemp(join(tmpdir(), "nb-session-example-"));

try {
    // 1. 追加：seq 由日志分配，批内连续。
    const log = await createJsonlSessionLog({root, sessionId: "demo"});
    await log.append([{kind: "meta", key: "title", value: "示例会话"}]);
    const appended = await log.append([
        {kind: "message", role: "user", text: "读一下 a.txt"},
        {kind: "tool_call", callId: "call-1", toolName: "read", argsJson: JSON.stringify({path: "a.txt"})},
        {kind: "tool_result", callId: "call-1", isError: false, text: "1: alpha"},
        {kind: "message", role: "assistant", text: "文件第一行是 alpha。"},
    ]);
    console.log("追加的 seq：", appended.map((entry) => entry.seq));

    // 2. 重开续写：模拟进程重启，新实例接着最后一条的 seq 写。
    const reopened = await createJsonlSessionLog({root, sessionId: "demo"});
    const [next] = await reopened.append([{kind: "message", role: "user", text: "谢谢"}]);
    console.log("重开后的下一条 seq：", next?.seq);

    // 3. 中断尾：模拟写到一半崩溃，append 被拒绝，repair 截掉残片后恢复。
    await appendFile(join(root, "demo.jsonl"), '{"kind":"message","role":"user","te', "utf-8");
    console.log("中断尾时 read 仍返回完好前缀：", (await reopened.read()).length, "条");
    const blocked = await reopened.append([{kind: "message", role: "user", text: "被拒绝"}]).catch((error: unknown) => error);
    console.log("中断尾时 append：", blocked instanceof Error ? "被拒绝" : "意外成功");
    console.log("repair：", await reopened.repair());
    const [resumed] = await reopened.append([{kind: "message", role: "assistant", text: "继续"}]);
    console.log("修复后的下一条 seq：", resumed?.seq);

    // 窗口读取：只要 seq > 4 的前 2 条。
    const window = await reopened.read({sinceSeq: 4, limit: 2});
    console.log("read({sinceSeq: 4, limit: 2})：", window.map((entry) => `${entry.seq}:${entry.kind}`));
} finally {
    await rm(root, {recursive: true, force: true});
}
