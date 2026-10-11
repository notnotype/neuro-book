/**
 * 场景 5：命令行作为一个整体——真实子进程、真实 OMP 网络传输、本地的 OpenAI 兼容桩服务。
 *
 * 要说明的事：
 * - “自建服务”配置怎么接一个本地服务：`providers[].baseUrl` 指向本机端口，`api: "openai-completions"`，模型请求就真的走 OMP 的
 *   chat completions 传输（SSE）。桩服务按请求次数回放：先要 `read`，再按 read 结果里的标签头要 `edit`，最后回一句话。
 * - 命令行的输入只有一个读者：模型请求挂起时输入 `/status` 立刻有回应（不是等调用结束才处理）；审批提示只接受 y、s、n，
 *   空行重新问；`n` 拒绝后文件不变，`y` 批准后落盘。
 * - 审批时进程被杀：会话的等待状态在日志里；用 `--session` 重开，命令行先把审批问完，运行时替模型执行那次调用再让模型继续。
 * - 输入到头（管道关闭、Ctrl-D）等于 /quit：会话与凭据库正常收口，进程退出码 0。
 *
 * 这三条正是审查时在旧版命令行上发现的问题（空输入被当作批准；运行中的输入被丢；重开后没有应答入口），所以留一条回归场景。
 *
 * 行为合同：docs/specs/harness/models.md 输出 2（自建服务）；docs/specs/harness/runtime.md 输出 6（审批）、11（插话）。
 */

import {afterAll, describe, expect, test} from "bun:test";
import {readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {CHAPTER_1, createStage} from "../testing/stage";
import type {Stage} from "../testing/stage";

let stage: Stage | null = null;
let server: ReturnType<typeof Bun.serve> | null = null;
const children: ReturnType<typeof Bun.spawn>[] = [];
afterAll(async () => {
    for (const child of children) child.kill();
    server?.stop(true);
    await stage?.cleanup();
});

type Call = {id: string; name: string; args: Record<string, unknown>};
/** 一条 OpenAI chat completions 的 SSE 回复：文字，或一组工具调用。 */
function sse(number: number, reply: {text: string} | {calls: Call[]}): Response {
    const delta = "text" in reply
        ? {role: "assistant", content: reply.text}
        : {role: "assistant", tool_calls: reply.calls.map((call, index) => ({index, id: call.id, type: "function", function: {name: call.name, arguments: JSON.stringify(call.args)}}))};
    const chunk = (body: Record<string, unknown>) => `data: ${JSON.stringify({id: `chat-${number}`, object: "chat.completion.chunk", created: 1, model: "m", choices: [{index: 0, ...body}]})}\n\n`;
    return new Response(`${chunk({delta, finish_reason: null})}${chunk({delta: {}, finish_reason: "text" in reply ? "stop" : "tool_calls"})}data: [DONE]\n\n`, {headers: {"content-type": "text/event-stream"}});
}

describe("示例场景 5：命令行", () => {
    test("运行中 /status 有回应；审批空输入重新问；审批时被杀后重开能应答：n 拒绝文件不变、y 批准落盘", async () => {
        stage = await createStage("05-cli");
        const chapter = join(stage.workspace, "chapter-1.md");
        // 桩服务：第 1 次请求先挂起（让我们在“运行中”输入命令），放行后要 read；第 2 次按 read 的标签头要 edit；第 3 次回话。第 4–6 次同样一轮
        const gate = Promise.withResolvers<void>();
        const requests: {messages: {role: string; content: unknown}[]}[] = [];
        server = Bun.serve({
            hostname: "127.0.0.1", port: 0,
            async fetch(request) {
                const body = (await request.json()) as {messages: {role: string; content: unknown}[]};
                requests.push(body);
                const n = requests.length;
                if (n === 1) await gate.promise;
                const step = (n - 1) % 3;
                if (step === 0) return sse(n, {calls: [{id: `read-${n}`, name: "read", args: {path: "chapter-1.md"}}]});
                if (step === 1) {
                    const tool = [...body.messages].reverse().find((message) => message.role === "tool");
                    const header = /\[chapter-1\.md#[0-9A-Fa-f]{4}\]/u.exec(String(tool?.content))?.[0];
                    if (header === undefined) throw new Error(`read 的结果里没有标签头：${JSON.stringify(tool)}`);
                    return sse(n, {calls: [{id: `edit-${n}`, name: "edit", args: {input: `${header}\nPUT 2.=2:\n+林岚站在远航号的甲板上。\n`}}]});
                }
                return sse(n, {text: n < 4 ? "好的，没改。" : "改好了。"});
            },
        });
        const configPath = join(stage.state, "config.json");
        await writeFile(configPath, JSON.stringify({
            providers: [{id: "local", api: "openai-completions", baseUrl: `http://127.0.0.1:${server.port}/v1`, models: [{id: "m", contextWindow: 100_000}]}],
            models: {defaultModel: "local/m"},
            approval: {mode: "write", tools: {edit: "ask"}},
        }), "utf8");

        const cli = fileURLToPath(new URL("../cli.ts", import.meta.url));
        const spawnCli = (extra: string[]) => {
            const child = Bun.spawn([process.execPath, cli, "--config", configPath, "--workspace", stage!.workspace, "--state", stage!.state, ...extra], {
                // OMP 的 pi-utils 会往用户目录写缓存与会话；全部指到场地里，不碰真实的用户目录
                env: {...process.env, NB_HARNESS_API_KEY: "local-key", PI_CODING_AGENT_DIR: join(stage!.state, "omp"), XDG_DATA_HOME: join(stage!.state, "xdg"), XDG_STATE_HOME: join(stage!.state, "xdg"), XDG_CACHE_HOME: join(stage!.state, "xdg")},
                stdin: "pipe", stdout: "pipe", stderr: "pipe",
            });
            children.push(child);
            const io = {output: "", errors: ""};
            const decoder = new TextDecoder();
            void (async () => {
                for await (const chunk of child.stdout as ReadableStream<Uint8Array>) io.output += decoder.decode(chunk);
            })();
            void (async () => {
                for await (const chunk of child.stderr as ReadableStream<Uint8Array>) io.errors += decoder.decode(chunk);
            })();
            const stdin = child.stdin as import("bun").FileSink;
            return {
                child, io, stdin,
                send: async (line: string) => {
                    stdin.write(`${line}\n`);
                    await stdin.flush();
                },
                prompts: () => io.output.split("\n> ").length - 1,
                asked: () => io.output.split("[y 一次 / s 本会话 / n 拒绝] ").length - 1,
            };
        };

        // 第一个进程：运行中的 /status、审批的输入校验，然后在审批提示时被杀
        const first = spawnCli([]);
        await waitUntil("命令行就绪", () => first.prompts() === 1, {timeoutMs: 15_000});
        const sessionId = /会话 ([0-9a-f-]+)（/u.exec(first.io.output)?.[1];
        if (sessionId === undefined) throw new Error(`没有打印会话 id：${first.io.output}`);
        await first.send("把第二行改成带船名的。");
        await waitUntil("第一次模型请求到达", () => requests.length === 1, {timeoutMs: 15_000});
        await first.send("/status");
        await waitUntil("运行中的 /status", () => first.io.output.includes('"phase": "running"'), {timeoutMs: 5_000});
        gate.resolve();
        await waitUntil("审批提示", () => first.asked() === 1, {timeoutMs: 15_000});
        await first.send("");
        await waitUntil("重新问", () => first.asked() === 2, {timeoutMs: 5_000});
        expect(first.io.output).toContain("只接受 y、s 或 n");
        first.child.kill("SIGKILL");
        await first.child.exited;
        expect(await readFile(chapter, "utf8")).toBe(CHAPTER_1);

        // 第二个进程：重开同一个会话，先问完审批（n）；运行时替模型写拒绝结果、让模型继续，回到空闲
        const second = spawnCli(["--session", sessionId]);
        await waitUntil("重开后的审批提示", () => second.asked() === 1, {timeoutMs: 15_000});
        expect(second.io.output).toContain("上次停在 waiting-user");
        await second.send("n");
        await waitUntil("恢复的调用结束", () => second.io.output.includes("[调用 end]") && second.prompts() === 1, {timeoutMs: 15_000});
        expect(await readFile(chapter, "utf8")).toBe(CHAPTER_1);

        await second.send("再试一次。");
        await waitUntil("第二次审批提示", () => second.asked() === 2, {timeoutMs: 15_000});
        await second.send("y");
        await waitUntil("第二次调用结束", () => second.prompts() === 2, {timeoutMs: 15_000});
        expect(await readFile(chapter, "utf8")).toBe("第一章 出航\n林岚站在远航号的甲板上。\n远处是 1987 年的青岛。\n");
        expect(requests).toHaveLength(6);

        // 不发 /quit，直接关掉输入：等同退出
        second.stdin.end();
        expect(await second.child.exited).toBe(0);
        expect(second.io.errors).toBe("");
    }, 60_000);
});
