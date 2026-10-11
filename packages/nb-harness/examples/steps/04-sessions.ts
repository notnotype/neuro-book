/**
 * 第 4 步：会话落盘，换一个进程（这里是换一个运行时）接着聊。
 *
 * 要说明的事：
 * - 会话是一份只追加的条目日志；模型看到的历史、是否在等用户、当前模型都由回放日志得出，运行时不另存状态。
 * - `createJsonlSessionStore({root})` 每个会话一个 JSONL 文件（目录要先存在）；不给 `store` 就是内存存储，进程退出即丢。
 * - `openSession(id)` 打开已有会话：上次没收口的调用会先收口（等待审批中的会恢复成等待），然后照常 `prompt`。
 * - 凭据库也可以落盘：`credentialsPath` 给一个文件路径；这里仍用缺省的 `:memory:`。
 *
 * 运行：`bun examples/steps/04-sessions.ts`。
 * 行为合同：docs/specs/harness/session.md 输出 1–6；docs/specs/harness/runtime.md 输出 13。
 */

import {mkdir} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {openRuntime, unwrap} from "@notnotype/nb-harness";
import {loadProfile} from "@notnotype/nb-harness/profile/loader";
import {createJsonlSessionStore} from "@notnotype/nb-harness/session/jsonl";
import {liveModel, replyText, scratch} from "./env";

const {config, apiKeys} = liveModel();
const profile = unwrap(await loadProfile(fileURLToPath(new URL("../profiles/assistant.profile.tsx", import.meta.url))));
const state = await scratch("step-04");
try {
    const sessions = join(state.root, "sessions");
    await mkdir(sessions);

    // 第一个运行时：新建会话、说一件事，然后整个关掉
    const first = await openRuntime({config, profiles: [profile], apiKeys, store: createJsonlSessionStore({root: sessions})});
    try {
        const session = unwrap(await first.createSession({profileId: "assistant", id: "voyage", title: "航海小说"}));
        console.log(replyText((await unwrap(await session.prompt({content: "记住：主角叫林岚，她的船叫“海燕号”。只回答“记住了”。"})).done).entries));
        await session.close();
    } finally {
        first.close();
    }

    // 第二个运行时：同一个目录，按 id 打开，接着问
    const second = await openRuntime({config, profiles: [profile], apiKeys, store: createJsonlSessionStore({root: sessions})});
    try {
        console.log("目录里的会话：", unwrap(await second.listSessions()).map((summary) => `${summary.id}（${summary.title ?? "无标题"}）`));
        const session = unwrap(await second.openSession("voyage"));
        const result = await unwrap(await session.prompt({content: "主角的船叫什么？"})).done;
        console.log(`状态：${result.status}${result.error === undefined ? "" : `（${result.error.kind}：${result.error.message}）`}`);
        console.log(replyText(result.entries));
        console.log(`日志里共有 ${session.log.entries.length} 条条目`);
        await session.close();
    } finally {
        second.close();
    }
} finally {
    await state.cleanup();
}
