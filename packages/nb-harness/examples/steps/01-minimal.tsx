/** @jsxImportSource @notnotype/nb-harness/profile */
/**
 * 第 1 步：最短的程序——一份配置、一个 Profile、一个 key，问一句、拿到回复。
 *
 * 要说明的事：
 * - `openRuntime` 是便捷入口：配置可以直接给对象（内部校验并建存储），Profile 可以直接给数组（内部建目录），
 *   凭据只给 key（内部开一个不落盘的 `:memory:` 凭据库），会话存在内存里。之后几步会把这些换成自己管的东西。
 * - 各方法返回 `{ok, value}` 或 `{ok: false, code, detail}`，这是合同；脚本里不想每步判 `ok` 就用 `unwrap`，
 *   失败变成带同一个 `code` 的 `HarnessError` 异常。
 * - `prompt` 受理后立刻返回 `Invocation`；`done` 在这次调用的终态写进会话之后完成，状态是 completed、waiting、aborted 或 failed。
 *
 * 运行：`bun examples/steps/01-minimal.tsx`（真实模型，读仓库根 `.env`）。
 * 行为合同：docs/specs/harness/runtime.md 输出 2、3、18。
 */

import {openRuntime, unwrap} from "@notnotype/nb-harness";
import {Appending, defineProfile, History, Input, Prompt, System} from "@notnotype/nb-harness/profile";
import {liveModel, replyText} from "./env";

const {config, apiKeys} = liveModel();

// Profile：系统提示词、历史（这里没有种子，<History /> 是“把会话历史放在这里”）、本次输入
const assistant = defineProfile({
    id: "assistant", name: "助手", description: "第 1 步的最小 Profile", version: 1,
    prompt: () => (
        <Prompt>
            <System>你是简洁的写作助手，回答不超过三句。</System>
            <History />
            <Appending><Input /></Appending>
        </Prompt>
    ),
});

const runtime = await openRuntime({config, profiles: [assistant], apiKeys});
try {
    const session = unwrap(await runtime.createSession({profileId: "assistant"}));
    const invocation = unwrap(await session.prompt({content: "给一部发生在 1987 年青岛的航海小说起三个书名。"}));
    const result = await invocation.done;
    console.log(`状态：${result.status}${result.error === undefined ? "" : `（${result.error.kind}：${result.error.message}）`}`);
    console.log(replyText(result.entries));
    await session.close();
} finally {
    runtime.close();
}
