/**
 * 场景 2：审批与 edit——先读后改、询问用户、批准与拒绝、本会话内允许。
 *
 * 要说明的事：
 * - `edit` 的等级是 `write`，审批模式 `write` 本来直接放行；配置里把 `edit` 设为 `ask` 后每次都要问用户。
 *   判定顺序见 tools Spec 输出第 6 条：策略 → 配置 deny → 本会话内允许 → 策略 ask → 配置 allow/ask → 模式表。
 * - 询问用户时运行时写 `interaction request` 与 `invocation waiting`，状态变成 `waiting-user`，`done` 不会完成，直到 `resolve`。
 * - `scope: "session"` 的批准记在日志里：同一会话再调 `edit` 不再问；另一个会话照问。
 * - 拒绝时工具不执行，模型拿到 `denied: …` 的错误结果并继续回答；文件不变。
 * - `edit` 的输入是 OMP 的 hashline 协议：首行是 `read` 给出的 `[path#tag]` 头，之后是对已展示行的操作；
 *   标签是内容哈希，所以脚本化模型要从上下文里的 read 结果取它。
 *
 * 行为合同：docs/specs/harness/runtime.md 输出第 6、7 条；docs/specs/harness/tools.md 输出第 6 条；docs/specs/harness/builtin-tools.md 输出第 6 条。
 */

import {afterAll, describe, expect, test} from "bun:test";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import type {Context} from "@oh-my-pi/pi-ai";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import type {RuntimeEvent} from "@notnotype/nb-harness";
import {assemble} from "../assemble";
import type {Assembled} from "../assemble";
import {lastToolResultText, scriptedModel} from "../testing/scripted-model";
import type {Reply} from "../testing/scripted-model";
import {CHAPTER_1, createStage, exampleConfig, invocationPhases, kinds, loadWriterProfile, toolResults} from "../testing/stage";
import type {Stage} from "../testing/stage";

let stage: Stage | null = null;
let assembled: Assembled | null = null;
afterAll(async () => {
    assembled?.close();
    await stage?.cleanup();
});

/** 读到第一章之后，把第二行改成带船名的句子：头取自上下文里 read 的结果。 */
const editSecondLine = (id: string, line: string) => (context: Context): Reply => {
    const header = lastToolResultText(context).split("\n")[0] ?? "";
    return {calls: [{id, name: "edit", args: {input: `${header}\nPUT 2.=2:\n+${line}\n`}}]};
};

describe("示例场景 2：审批与 edit", () => {
    test("edit 要问用户：批准后落盘，本会话内不再问；另一个会话拒绝则文件不变", async () => {
        stage = await createStage("02-approval-and-edit");
        const model = scriptedModel([
            // 会话 s1 第一次：读 → 改（等审批）→ 回复
            {calls: [{id: "c1", name: "read", args: {path: "chapter-1.md"}}]},
            editSecondLine("c2", "林岚站在远航号的甲板上。"),
            {text: "改好了。"},
            // 会话 s1 第二次：再改一次，这次不问
            {calls: [{id: "c3", name: "read", args: {path: "chapter-1.md"}}]},
            editSecondLine("c4", "林岚站在远航号的甲板上，望着海。"),
            {text: "又改了一处。"},
            // 会话 s2：被拒绝
            {calls: [{id: "c5", name: "read", args: {path: "chapter-1.md"}}]},
            editSecondLine("c6", "这一行不会写进去。"),
            {text: "好的，不改了。"},
        ]);
        assembled = await assemble({
            workspace: stage.workspace, state: stage.state, config: exampleConfig({mode: "write", tools: {edit: "ask"}}),
            profiles: [await loadWriterProfile()], apiKeys: {scripted: "example-key"}, model: {stream: model.stream},
        });
        const chapter = join(stage.workspace, "chapter-1.md");

        const created = await assembled.runtime.createSession({profileId: "writer", id: "s1"});
        if (!created.ok) throw new Error(`${created.code}: ${created.detail}`);
        const session = created.value;
        const events: RuntimeEvent[] = [];
        session.subscribe((event) => events.push(event));

        const started = await session.prompt({content: "把第二行改成带船名的。"});
        if (!started.ok) throw new Error(`${started.code}: ${started.detail}`);
        await waitUntil("等待审批", () => session.status.phase === "waiting-user");
        // 待处理事项：哪个调用、哪个工具、什么等级；界面据此向用户提问
        expect(session.status.pending).toHaveLength(1);
        expect(session.status.pending[0]!.request).toMatchObject({toolName: "edit", tier: "write", toolCallId: "c2"});
        expect(events.some((event) => event.type === "interaction" && event.phase === "request")).toBe(true);
        expect(await readFile(chapter, "utf8")).toBe(CHAPTER_1);
        // 等待期间不能再发起调用；应答用 resolve
        expect(await session.prompt({content: "快点"})).toMatchObject({ok: false, code: "busy"});

        const answered = await session.resolve({interactionId: session.status.pending[0]!.interactionId, decision: "approve", scope: "session"});
        expect(answered).toEqual({ok: true, value: undefined});
        const result = await started.value.done;
        expect(result.status).toBe("completed");
        expect(await readFile(chapter, "utf8")).toBe("第一章 出航\n林岚站在远航号的甲板上。\n远处是 1987 年的青岛。\n");
        expect(invocationPhases(result.entries)).toEqual(["start", "waiting", "resumed", "end"]);
        expect(kinds(result.entries).filter((kind) => kind === "custom:harness/interaction")).toHaveLength(2);
        // edit 的回显带新标签，模型可以据此连续修改
        const [, edited] = toolResults(result.entries);
        expect(edited?.isError).toBe(false);
        expect(edited?.text).toContain("chapter-1.md#");

        // 同一会话第二次 edit：本会话内允许，直接执行，没有新的询问
        const again = await session.prompt({content: "再加一句望着海。"});
        if (!again.ok) throw new Error(`${again.code}: ${again.detail}`);
        const againResult = await again.value.done;
        expect(againResult.status).toBe("completed");
        expect(invocationPhases(againResult.entries)).toEqual(["start", "end"]);
        expect(await readFile(chapter, "utf8")).toBe("第一章 出航\n林岚站在远航号的甲板上，望着海。\n远处是 1987 年的青岛。\n");
        await session.close();

        // 另一个会话：允许是按会话记的，这里照问；拒绝后工具不执行，模型拿到 denied 并继续回答
        const other = await assembled.runtime.createSession({profileId: "writer", id: "s2"});
        if (!other.ok) throw new Error(other.code);
        const run = await other.value.prompt({content: "把第二行改掉。"});
        if (!run.ok) throw new Error(`${run.code}: ${run.detail}`);
        await waitUntil("等待审批", () => other.value.status.phase === "waiting-user");
        const before = await readFile(chapter, "utf8");
        expect(await other.value.resolve({interactionId: other.value.status.pending[0]!.interactionId, decision: "reject", note: "先别改"})).toEqual({ok: true, value: undefined});
        const rejected = await run.value.done;
        expect(rejected.status).toBe("completed");
        const [, denied] = toolResults(rejected.entries);
        expect(denied).toMatchObject({isError: true});
        expect(denied?.text).toMatch(/^denied: .*先别改/u);
        expect(await readFile(chapter, "utf8")).toBe(before);
        await other.value.close();
    });
});
