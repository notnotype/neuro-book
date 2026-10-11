/**
 * 第 2 步：Profile 放进文件，发起调用之前先预览模型会收到什么。
 *
 * 要说明的事：
 * - `loadProfile(path)` 就是导入那个模块、取默认导出：提示词是函数，只能执行模块才拿得到。它只认 `defineProfile` 的结果，
 *   并把文件里对 `@notnotype/nb-harness/profile` 的导入解析到本包，所以 Profile 文件可以放在用户目录里。
 * - `session.preview(input)` 回答“此刻发起这次调用，模型会收到什么”：系统提示词、新会话的种子、这次追加的消息、
 *   完整的请求消息与诊断。不写会话、不发请求、不要凭据——改 Profile 时先看这个。
 *
 * 运行：`bun examples/steps/02-profile-file.ts`。
 * 行为合同：docs/specs/harness/profile.md 输出 13；docs/specs/harness/runtime.md 输出 17。
 */

import {fileURLToPath} from "node:url";
import {openRuntime, unwrap} from "@notnotype/nb-harness";
import {loadProfile} from "@notnotype/nb-harness/profile/loader";
import {liveModel, replyText} from "./env";

const {config, apiKeys} = liveModel();
const profile = unwrap(await loadProfile(fileURLToPath(new URL("../profiles/assistant.profile.tsx", import.meta.url))));

const runtime = await openRuntime({config, profiles: [profile], apiKeys});
try {
    const session = unwrap(await runtime.createSession({profileId: "assistant"}));
    const input = {content: "用一句话介绍林岚：1987 年青岛港的年轻女海员。"};

    const preview = unwrap(await session.preview(input));
    console.log("系统提示词：", preview.system);
    console.log("请求消息：");
    for (const message of preview.request) console.log(`  [${message.role}] ${JSON.stringify(message.content).slice(0, 120)}`);
    console.log("诊断：", preview.diagnostics);

    const result = await unwrap(await session.prompt(input)).done;
    console.log(`状态：${result.status}${result.error === undefined ? "" : `（${result.error.kind}：${result.error.message}）`}`);
    console.log(replyText(result.entries));
    await session.close();
} finally {
    runtime.close();
}
