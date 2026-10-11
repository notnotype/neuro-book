/** @jsxImportSource @notnotype/nb-harness/profile */
/**
 * 第 6 步：压缩——把较早的历史压成摘要，会话继续。
 *
 * 要说明的事：
 * - 压缩写一条摘要条目，再把种子重写一遍（`once` 的除外）；模型之后看到的是“种子 + 摘要 + 最近的消息”。
 *   `keepRecentTokens` 决定保留多少最近的消息不进摘要（这里调小，好让两轮对话就有东西可压）。
 * - 自动压缩：一次调用完成后，最后一条助手消息报告的用量超过阈值（Profile 的 `compaction.threshold`，缺省窗口的 80%）就压。
 *   这里不靠它，而是在两轮之后手动 `session.compact()` 一次：真实模型报告的用量含推理 token，阈值调得太低会每轮都压。
 * - 内置方法 `soft` 用当前模型写摘要，要两三次模型调用；服务慢的时候一次压缩要几分钟。
 * - `status.context` 给当前用量、窗口与阈值；还没有服务方报告的用量时按分词器估算（`source: "estimated"`）。
 *
 * 运行：`bun examples/steps/06-compaction.tsx`。
 * 行为合同：docs/specs/harness/compaction.md 输出 5–9；docs/specs/harness/runtime.md 输出 5、14。
 */

import {openRuntime, unwrap} from "@notnotype/nb-harness";
import {Appending, defineProfile, History, Input, Prompt, System, User} from "@notnotype/nb-harness/profile";
import {liveModel, replyText} from "./env";

const {config, apiKeys} = liveModel();
const writer = defineProfile({
    id: "writer", name: "写作助手", description: "第 6 步：手动压缩", version: 1,
    compaction: {keepRecentTokens: 200},
    prompt: () => (
        <Prompt>
            <System>你是小说写作助手。</System>
            <History><User>小说设定：1987 年青岛，女海员林岚，货船“海燕号”。</User></History>
            <Appending><Input /></Appending>
        </Prompt>
    ),
});

const runtime = await openRuntime({config, profiles: [writer], apiKeys});
try {
    const session = unwrap(await runtime.createSession({profileId: "writer"}));
    const ask = async (content: string): Promise<void> => {
        const result = await unwrap(await session.prompt({content})).done;
        console.log(`\n> ${content}\n状态：${result.status}${result.error === undefined ? "" : `（${result.error.kind}：${result.error.message}）`}`);
        console.log(replyText(result.entries));
    };
    await ask("写小说开头的第一段，约 150 字。");
    await ask("接着写第二段，约 150 字。");
    console.log("\n压缩前：", session.status.context);

    const compacted = unwrap(await session.compact());
    console.log("压缩：", compacted === null ? "没有可压的" : `方法 ${compacted.method}，写入 ${compacted.entries.map((entry) => entry.type).join("、")}`);

    await ask("前面两段讲了什么？一句话概括。");
    console.log("\n上下文：", session.status.context);
    await session.close();
} finally {
    runtime.close();
}
