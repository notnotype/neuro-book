/**
 * 最小命令行：在终端里和示例写作助手对话，真实模型、真实文件。
 *
 * 用法（在 packages/nb-harness 下）：
 *
 *   NB_HARNESS_API_KEY=<key> bun examples/cli.ts --config <config.json> [--workspace <作品目录>] [--state <状态目录>] [--session <id>]
 *
 * - `config.json` 是 `HarnessConfig`（docs/specs/harness/config.md）：至少给 `models.defaultModel`；用 OMP 目录里没有的服务时
 *   在 `providers` 里自建（`api`、`baseUrl`、`models`，自建模型最好带 `contextWindow`）。
 * - `NB_HARNESS_API_KEY` 写进缺省模型所在服务的凭据库；内核不读环境变量，所以由这个命令行代为写入。
 * - `--workspace` 缺省是当前目录，`--state` 缺省是 `<workspace>/.nb-harness`；`--session` 重开一个已有会话。
 *
 * 对话中：直接输入即发起调用；运行中的输入作为插话（`steer`）；需要审批时按提示回答 y（一次）、s（本会话内一直允许）、n（拒绝）。
 * 命令：/abort 中止，/compact 手动压缩，/status 看状态，/sessions 列会话，/quit 退出。
 */

import {mkdir} from "node:fs/promises";
import {createInterface} from "node:readline/promises";
import {parseArgs} from "node:util";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import type {AgentSession, Invocation, RuntimeEvent} from "@notnotype/nb-harness";
import {parseModelRef} from "@notnotype/nb-harness/models";
import {loadProfile} from "@notnotype/nb-harness/profile/loader";
import {assemble} from "./assemble";

const {values} = parseArgs({
    options: {
        config: {type: "string"},
        workspace: {type: "string", default: process.cwd()},
        state: {type: "string"},
        session: {type: "string"},
        profile: {type: "string", default: fileURLToPath(new URL("./profiles/writer.profile.tsx", import.meta.url))},
    },
});
if (values.config === undefined) {
    console.error("缺少 --config <config.json>");
    process.exit(2);
}

const workspace = resolve(values.workspace);
const state = resolve(values.state ?? `${workspace}/.nb-harness`);
await mkdir(state, {recursive: true});
const config = (await Bun.file(resolve(values.config)).json()) as {models?: {defaultModel?: string}};

// key 写进缺省模型所在服务的名下
const apiKeys: Record<string, string> = {};
const key = process.env.NB_HARNESS_API_KEY;
const ref = config.models?.defaultModel === undefined ? null : parseModelRef(config.models.defaultModel);
if (key !== undefined && key !== "" && ref !== null) apiKeys[ref.providerId] = key;

const loaded = await loadProfile(resolve(values.profile));
if (!loaded.ok) {
    console.error(`Profile 加载失败：${loaded.code}：${loaded.detail}`);
    process.exit(2);
}
const assembled = await assemble({workspace, state, config, profiles: [loaded.value], apiKeys});

const opened = values.session === undefined
    ? await assembled.runtime.createSession({profileId: loaded.value.id})
    : await assembled.runtime.openSession(values.session);
if (!opened.ok) {
    console.error(`会话打不开：${opened.code}：${opened.detail}`);
    process.exit(2);
}
const session: AgentSession = opened.value;
console.log(`会话 ${session.id}（Profile ${loaded.value.id}，工作区 ${workspace}）。/quit 退出。`);

// 事件 → 终端：文字回复按增量打印（stream 事件给的是整条消息的快照，自己算增量）；工具、审批、压缩各打一行
let printed = 0;
const textOf = (event: RuntimeEvent & {type: "stream"}): string => event.message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
session.subscribe((event) => {
    switch (event.type) {
        case "invocation":
            if (event.phase === "start") printed = 0;
            else if (event.phase !== "waiting" && event.phase !== "resumed") process.stdout.write(`\n[调用 ${event.phase}]\n`);
            break;
        case "stream": {
            const text = textOf(event);
            process.stdout.write(text.slice(printed));
            printed = text.length;
            break;
        }
        case "tool":
            if (event.stage === "start") process.stdout.write(`\n[工具 ${event.toolName} ${JSON.stringify(event.args)}]\n`);
            else if (event.stage === "end") process.stdout.write(`[工具 ${event.toolName} ${event.isError === true ? "失败" : "完成"}]\n`);
            printed = 0;
            break;
        case "interaction":
            if (event.phase === "request") process.stdout.write(`\n[需要审批 ${event.data.request?.toolName}（${event.data.request?.tier}）]\n`);
            break;
        case "compaction":
            process.stdout.write(event.result.ok ? `\n[已压缩：${event.result.method}]\n` : `\n[压缩失败：${event.result.code} ${event.result.detail}]\n`);
            break;
        default:
            break;
    }
});

const rl = createInterface({input: process.stdin, output: process.stdout});
let closed = false;
rl.on("close", () => {
    closed = true;
});
/** 问一句；输入已经关闭（管道到头、Ctrl-D）时返回 null，调用方按退出处理。 */
async function ask(prompt: string): Promise<string | null> {
    if (closed) return null;
    try {
        return await rl.question(prompt);
    } catch {
        return null;
    }
}

/** 等到这次调用结束；中途要审批就问用户。 */
async function follow(invocation: Invocation): Promise<void> {
    for (;;) {
        // 等 done 或等进入 waiting-user，先到的那个
        const waiting = new Promise<"waiting">((resolveWaiting) => {
            if (session.status.phase === "waiting-user") resolveWaiting("waiting");
            const sub = session.subscribe((event) => {
                if (event.type === "status" && event.status.phase === "waiting-user") {
                    sub.release();
                    resolveWaiting("waiting");
                }
            });
        });
        const outcome = await Promise.race([invocation.done.then((result) => ({result})), waiting]);
        if (outcome !== "waiting") {
            const {result} = outcome;
            if (result.status === "failed") console.log(`调用失败：${result.error?.kind}：${result.error?.message}`);
            return;
        }
        for (const pending of session.status.pending) {
            const answer = ((await ask(`批准 ${pending.request.toolName}（${pending.request.tier ?? "exec"}）？[y 一次 / s 本会话 / n 拒绝] `)) ?? "n").trim().toLowerCase();
            const decided = answer === "n"
                ? await session.resolve({interactionId: pending.interactionId, decision: "reject", note: "用户拒绝"})
                : await session.resolve({interactionId: pending.interactionId, decision: "approve", scope: answer === "s" ? "session" : "once"});
            if (!decided.ok) console.log(`应答失败：${decided.code}：${decided.detail}`);
        }
    }
}

let current: Invocation | null = null;
for (;;) {
    const line = (await ask("\n> "))?.trim() ?? "/quit";
    if (line === "") continue;
    if (line === "/quit") break;
    if (line === "/status") {
        console.log(JSON.stringify(session.status, null, 2));
        continue;
    }
    if (line === "/sessions") {
        const listed = await assembled.runtime.listSessions();
        console.log(listed.ok ? listed.value.map((item) => `${item.id}  ${item.updatedAt}  ${item.title ?? ""}`).join("\n") : `${listed.code}：${listed.detail}`);
        continue;
    }
    if (line === "/abort") {
        const aborted = session.abort();
        if (!aborted.ok) console.log(`${aborted.code}：${aborted.detail}`);
        continue;
    }
    if (line === "/compact") {
        const compacted = await session.compact();
        console.log(compacted.ok ? (compacted.value === null ? "没有可压缩的历史" : `已压缩：${compacted.value.method}`) : `${compacted.code}：${compacted.detail}`);
        continue;
    }
    if (session.status.phase === "running" && current !== null) {
        const steered = session.steer({content: line});
        console.log(steered.ok ? "（已插话，会在当前工具批次之后送给模型）" : `${steered.code}：${steered.detail}`);
        continue;
    }
    const started = await session.prompt({content: line});
    if (!started.ok) {
        console.log(`${started.code}：${started.detail}`);
        continue;
    }
    current = started.value;
    await follow(current);
    current = null;
}

await session.close();
assembled.close();
if (!closed) rl.close();
