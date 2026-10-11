/** @jsxImportSource @notnotype/nb-harness/profile */
/**
 * 第 7 步：工具返回一大段文字时，上下文不会被撑爆。
 *
 * 要说明的事：
 * - 预算在适配层统一做，与工具无关（照 OMP 的缺省）：文本超过 50 KiB 时全文存进溢出存储，交给模型的只留头尾各 20 KiB
 *   与一句 `read artifact://N` 的回读提示。会话日志里的工具结果就是模型看到的那份。
 * - 溢出存储由装配方给（`artifacts`；不给是内存的）。把同一个存储经 `createArtifactProvider` 登记成 `artifact://` 方案，
 *   模型就能用内置 `read` 按 `offset`、`limit` 翻到要看的行。
 * - 示例工具 `dump` 吐出约 220 KiB 的编号文本（见 examples/tools/dump.ts）。
 *
 * 运行：`bun examples/steps/07-spill.tsx`。
 * 行为合同：docs/specs/harness/tools.md 输出 9；docs/specs/harness/session.md 输出 24；docs/specs/harness/builtin-tools.md 输出 9。
 */

import {openRuntime, unwrap} from "@notnotype/nb-harness";
import {createArtifactProvider, createBuiltinTools, createResourceAccess} from "@notnotype/nb-harness/builtin";
import {Appending, defineProfile, History, Input, Prompt, System} from "@notnotype/nb-harness/profile";
import {createMemoryArtifactStore} from "@notnotype/nb-harness/session";
import {createStaticToolSource} from "@notnotype/nb-harness/tools";
import {dumpTool} from "../tools/dump";
import {liveModel, replyText} from "./env";

const {config, apiKeys} = liveModel();
const artifacts = createMemoryArtifactStore();
const resources = createResourceAccess({artifact: {provider: createArtifactProvider(artifacts), doc: "超过预算的工具结果全文，只读；按结果里给的 artifact://N 回读，可带 offset、limit"}});

const reader = defineProfile({
    id: "reader", name: "读数助手", description: "第 7 步：大结果与回读", version: 1,
    tools: ["read", "dump"],
    prompt: () => (
        <Prompt>
            <System>你是助手。工具结果被截断时，按结果末尾的提示用 read 回读需要的部分。</System>
            <History />
            <Appending><Input /></Appending>
        </Prompt>
    ),
});

const runtime = await openRuntime({
    config, profiles: [reader], apiKeys, artifacts,
    tools: [createBuiltinTools({resources}), createStaticToolSource([dumpTool()])],
    limits: {maxTurns: 6},
});
try {
    const session = unwrap(await runtime.createSession({profileId: "reader"}));
    const result = await unwrap(await session.prompt({content: "调用 dump，然后读出它输出的第 2000 行，原样告诉我那一行。"})).done;
    console.log(`状态：${result.status}${result.error === undefined ? "" : `（${result.error.kind}：${result.error.message}）`}`);
    for (const entry of result.entries) {
        if (entry.type !== "message" || entry.message.role !== "toolResult") continue;
        const text = entry.message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
        console.log(`工具 ${entry.message.toolName}：${new TextEncoder().encode(text).length} 字节进了上下文；末行 ${text.split("\n").at(-1)!.slice(0, 100)}`);
    }
    console.log("溢出存储：", unwrap(await artifacts.list(session.id)));
    console.log(replyText(result.entries));
    await session.close();
} finally {
    runtime.close();
}
