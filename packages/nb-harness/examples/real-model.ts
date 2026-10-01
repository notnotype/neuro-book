/**
 * 真实模型跑一轮：模型调用 read 工具读文件后回答。会产生一次真实计费调用。
 * 需要 DEEPSEEK_API_KEY（可选 DEEPSEEK_API_BASE、REAL_MODEL_SMOKE_MODEL）；缺凭据时打印跳过原因并以 0 退出。
 *
 * 运行：bun examples/real-model.ts
 */
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHarness} from "@notnotype/nb-harness";
import {ProfilePrompt, System} from "@notnotype/nb-profile";
import {createJsonlSessionLog} from "@notnotype/nb-session";

if ((process.env.DEEPSEEK_API_KEY ?? "") === "") {
    console.log("跳过：未设置 DEEPSEEK_API_KEY，本示例未验证真实模型。");
    process.exit(0);
}

const root = await mkdtemp(join(tmpdir(), "nb-harness-real-"));

try {
    await writeFile(join(root, "note.txt"), "第三章的反派叫沈默。\n", "utf-8");
    const log = await createJsonlSessionLog({root, sessionId: "real"});
    const harness = await createHarness({
        model: process.env.REAL_MODEL_SMOKE_MODEL ?? "deepseek/deepseek-flash",
        cwd: root,
        sessionLog: log,
        node: ProfilePrompt({children: [System({children: ["你是严谨的写作助手，回答前必须用工具核实文件内容。"]})]}),
    });

    try {
        harness.subscribe((event) => {
            if (event.type === "tool_execution_start") console.log(`→ 调用工具 ${event.toolName}`);
        });
        const result = await harness.turn("用 read 读取 note.txt，告诉我第三章的反派叫什么。");
        // 模型失败、缺 key 或中止时 turn 也会正常返回空文本（见 Spec 已知缺口），这里显式检查。
        if (result.text === "") {
            console.error("模型没有返回文本：可能是调用失败或被中止。");
            process.exitCode = 1;
        }
        console.log("回答：", result.text);
        console.log("日志条目：", (await log.read()).map((entry) => entry.kind));
    } finally {
        await harness.close();
    }
} finally {
    await rm(root, {recursive: true, force: true});
}
