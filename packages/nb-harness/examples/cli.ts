/**
 * 最小命令行：在终端里和示例写作助手对话，真实模型、真实文件。
 *
 * 用法（在 packages/nb-harness 下）：
 *
 *   NB_HARNESS_API_KEY=<key> bun examples/cli.ts --config <config.json> [--workspace <作品目录>] [--state <状态目录>] [--session <id>]
 *
 * - `config.json` 是 `HarnessConfig`（docs/specs/harness/config.md）：至少给 `models.defaultModel`；用 OMP 目录里没有的服务时
 *   在 `providers` 里自建（`api`、`baseUrl`、`models`，自建模型要带 `contextWindow`，否则压缩阈值算不出）。
 * - `NB_HARNESS_API_KEY` 写进缺省模型所在服务的凭据库；内核不读环境变量，所以由这个命令行代为写入。
 * - `--workspace` 缺省是当前目录，`--state` 缺省是 `<workspace>/.nb-harness`；`--session` 重开一个已有会话。
 *
 * 对话中：空闲时直接输入即发起调用；运行中的输入作为插话（`steer`，下一次模型请求时送达）；需要审批时按提示回答
 * y（一次）、s（本会话内一直允许）、n（拒绝），别的输入重新问。命令：/abort 中止，/compact 手动压缩，/status 看状态，/sessions 列会话，/quit 退出。
 *
 * 输入只有一个读者（`nextLine`）：readline 的行事件不会为后来的提问保存，谁在等谁就拿到下一行；运行中也一直在读，
 * 所以插话和 /abort 不会被丢。调用的进展经 `Invocation.next()` 观察：进入等待（要审批）或结束。
 * 重开的会话可能已经在等待审批（上次进程在审批时退出）：这时没有 `Invocation`，进展按 `status` 事件观察，入口是会话状态而不是本进程发起的调用。
 */

import {mkdir} from "node:fs/promises";
import {createInterface} from "node:readline";
import {parseArgs} from "node:util";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import type {AgentSession, Invocation, PendingInteraction, RuntimeEvent} from "@notnotype/nb-harness";
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

// ---- 事件 → 终端：文字回复按增量打印（stream 事件给的是整条消息的快照，自己算增量）；工具、审批、压缩各打一行 ----
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

// ---- 输入：唯一的读者 ----
const rl = createInterface({input: process.stdin, terminal: false});
const queued: string[] = [];
let waiter: ((line: string | null) => void) | null = null;
let inputClosed = false;
rl.on("line", (line) => {
    if (waiter !== null) {
        const resolveLine = waiter;
        waiter = null;
        resolveLine(line);
    } else queued.push(line);
});
rl.on("close", () => {
    inputClosed = true;
    waiter?.(null);
    waiter = null;
});
/** 下一行输入；输入已关闭（管道到头、Ctrl-D）时为 null。同一时刻只有一个等待者。 */
function nextLine(): Promise<string | null> {
    return startRead().promise;
}
/**
 * 可取消的读取：与 `Invocation.next()` 竞争时用。输掉竞争的读取要 `cancel()`：还没等到就不再等；
 * 已经等到（与 next() 同一拍到达）就把那行放回队列头，不能丢。
 */
function startRead(): {promise: Promise<string | null>; cancel(): void} {
    if (queued.length > 0) {
        const line = queued.shift()!;
        return {promise: Promise.resolve(line), cancel: () => void queued.unshift(line)};
    }
    if (inputClosed) return {promise: Promise.resolve(null), cancel: () => undefined};
    let arrived: string | null | undefined;
    const promise = new Promise<string | null>((resolveLine) => {
        waiter = (line) => {
            arrived = line;
            resolveLine(line);
        };
    });
    return {
        promise,
        cancel: () => {
            waiter = null;
            if (typeof arrived === "string") queued.unshift(arrived);
        },
    };
}

/** 空闲时的一行：命令照办，其余发起调用。返回 false 表示退出。 */
async function idleLine(line: string): Promise<boolean> {
    if (line === "/quit") return false;
    if (line === "/status") console.log(JSON.stringify(session.status, null, 2));
    else if (line === "/sessions") {
        const listed = await assembled.runtime.listSessions();
        console.log(listed.ok ? listed.value.map((item) => `${item.id}  ${item.updatedAt}  ${item.title ?? ""}`).join("\n") : `${listed.code}：${listed.detail}`);
    } else if (line === "/abort") console.log("没有运行中的调用");
    else if (line === "/compact") {
        const compacted = await session.compact();
        console.log(compacted.ok ? (compacted.value === null ? "没有可压缩的历史" : `已压缩：${compacted.value.method}`) : `${compacted.code}：${compacted.detail}`);
    } else if (line.startsWith("/")) console.log(`不认识的命令：${line}`);
    else {
        const started = await session.prompt({content: line});
        if (!started.ok) console.log(`${started.code}：${started.detail}`);
        else await follow(attentionFromInvocation(started.value));
    }
    return true;
}

/** 运行中收到的一行：命令照办，其余作为插话。 */
function runningLine(line: string): void {
    if (line === "/abort") {
        const aborted = session.abort();
        console.log(aborted.ok ? "（已请求中止）" : `${aborted.code}：${aborted.detail}`);
    } else if (line === "/status") console.log(JSON.stringify(session.status, null, 2));
    else if (line === "/quit" || line === "/compact" || line === "/sessions") console.log("调用进行中，先等它结束或 /abort");
    else if (line.startsWith("/")) console.log(`不认识的命令：${line}`);
    else {
        const steered = session.steer({content: line});
        console.log(steered.ok ? "（已插话，下一次模型请求时送达）" : `${steered.code}：${steered.detail}`);
    }
}

/** 逐条问审批：只有明确的 y / s 批准、n 拒绝，别的重新问；/abort 中止调用；输入关闭按拒绝。 */
async function askApprovals(pending: readonly PendingInteraction[]): Promise<void> {
    for (const item of pending) {
        for (;;) {
            process.stdout.write(`批准 ${item.request.toolName}（${item.request.tier ?? "exec"}）？[y 一次 / s 本会话 / n 拒绝] `);
            const answer = ((await nextLine()) ?? "n").trim().toLowerCase();
            if (answer === "/abort") {
                session.abort();
                return;
            }
            const decision = answer === "y" ? {decision: "approve" as const, scope: "once" as const}
                : answer === "s" ? {decision: "approve" as const, scope: "session" as const}
                : answer === "n" ? {decision: "reject" as const, note: "用户拒绝"}
                : null;
            if (decision === null) {
                console.log("只接受 y、s 或 n");
                continue;
            }
            const decided = await session.resolve({interactionId: item.interactionId, ...decision});
            if (!decided.ok) console.log(`应答失败：${decided.code}：${decided.detail}`);
            break;
        }
    }
}

/** 需要调用方处理的点：要审批，或回到空闲。 */
type Attention = {kind: "waiting"; pending: readonly PendingInteraction[]} | {kind: "idle"};

/** 本进程发起的调用：进展经 `Invocation.next()`；结束时顺便报告失败原因。 */
function attentionFromInvocation(invocation: Invocation): () => Promise<Attention> {
    return async () => {
        const step = await invocation.next();
        if (step.kind === "waiting") return step;
        if (step.result.status === "failed") console.log(`调用失败：${step.result.error?.kind}：${step.result.error?.message}`);
        return {kind: "idle"};
    };
}

/** 重开的会话：没有 `Invocation`，进展按 `status` 事件看——等待审批就给事项，回到空闲就结束。 */
function attentionFromStatus(): () => Promise<Attention> {
    return () => new Promise((resolveAttention) => {
        const current = session.status;
        if (current.phase === "idle") return resolveAttention({kind: "idle"});
        if (current.phase === "waiting-user" && current.pending.length > 0) return resolveAttention({kind: "waiting", pending: current.pending});
        const subscription = session.subscribe((event) => {
            if (event.type !== "status") return;
            if (event.status.phase === "idle") {
                subscription.release();
                resolveAttention({kind: "idle"});
            } else if (event.status.phase === "waiting-user" && event.status.pending.length > 0) {
                subscription.release();
                resolveAttention({kind: "waiting", pending: event.status.pending});
            }
        });
    });
}

/** 跟着会话走到空闲：运行中消费输入（插话、/abort），进入等待时问审批。 */
async function follow(next: () => Promise<Attention>): Promise<void> {
    let step = next();
    for (;;) {
        const read = startRead();
        const first = await Promise.race([step.then((value) => ({step: value})), read.promise.then((value) => ({line: value}))]);
        if ("line" in first) {
            if (first.line === null) {
                // 输入关闭：没人能再应答审批，中止
                session.abort();
                await step;
                return;
            }
            runningLine(first.line);
            continue;
        }
        read.cancel();
        if (first.step.kind === "idle") return;
        await askApprovals(first.step.pending);
        step = next();
    }
}

// 重开到的会话若在等待审批（上次进程在审批时退出），先把审批问完、看着它恢复运行到空闲
if (session.status.phase !== "idle") {
    console.log(`会话上次停在 ${session.status.phase}，待处理 ${session.status.pending.length} 项。`);
    await follow(attentionFromStatus());
}

for (;;) {
    process.stdout.write("\n> ");
    const line = (await nextLine())?.trim() ?? "/quit";
    if (line === "") continue;
    if (!(await idleLine(line))) break;
}

await session.close();
assembled.close();
if (!inputClosed) rl.close();
