/**
 * t36 的真实网关验证：用 t36 分支的 callModel 发一个嵌了草稿 JSON、约 120 KB 的用户消息（模型 gpt-6-luna），看是否先被 413
 * 拒、拆后成功，并记下每次尝试的用量（含 cacheRead）。再发一次同样的请求，看是否一开始就拆。
 *
 *   bun --env-file=<仓库根>/.env gateway-check.ts
 */
import {callModel, type Attempt} from "../../../../../../.worktree/w00024-t36-long-message-split/packages/nb-story/src/ingest/model";
import {sampleDataset} from "../../../../../../.worktree/w00024-t36-long-message-split/packages/nb-story/testing/sample";

const sample = await sampleDataset();
const draft = JSON.stringify({statements: sample.statements.slice(0, 260)});
const text = sample.sources.slice(0, 12).map(source => source.paragraphs.join("\n")).join("\n\n");
const user = `【材料】\n${text}\n\n【草稿】\n${draft}\n\n【任务】不用读上面的材料，只输出 {"ok":true}。`;
console.log(`用户消息 ${Buffer.byteLength(user)} 字节`);
const endpoint = {baseUrl: process.env.NBOOK_LLM_BASE_URL!, model: "gpt-6-luna", apiKey: process.env.NBOOK_LLM_API_KEY!, maxTokens: 200, apiKeyEnv: "NBOOK_LLM_API_KEY"};
for (const round of [1, 2]) {
    const attempts: Attempt[] = [];
    const started = Date.now();
    try {
        const reply = await callModel(endpoint, {system: "你是测试助手。只输出 JSON。", user, effort: "minimal", onAttempt: attempt => attempts.push(attempt), maxAttempts: 4});
        console.log(`第 ${round} 次：成功 ${reply.text.slice(0, 40)}，${Date.now() - started} 毫秒`);
    } catch (error) {
        console.log(`第 ${round} 次：失败 ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`);
    }
    for (const attempt of attempts) console.log(`  尝试 ${attempt.attempt}：${attempt.error ? `错误 ${attempt.error.status} ${attempt.error.message.slice(0, 120)}` : "成功"}，用量 ${JSON.stringify(attempt.usage)}`);
}
