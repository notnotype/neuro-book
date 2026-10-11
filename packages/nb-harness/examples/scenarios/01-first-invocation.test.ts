/**
 * 场景 1：第一次调用——装配、Profile 渲染、工具调用、日志与事件。
 *
 * 要说明的事：
 * - 一次调用写进会话的顺序：`invocation start` → 新会话的种子 → 用户输入与提醒 → Profile 状态 → 助手消息与工具结果交替 → `invocation end`。
 *   会话只追加：之后模型看到的上下文都是从这些条目回放出来的。
 * - 模型看到的请求：`<System>` 成为系统提示词；种子（含 `<WorkspaceTree />` 列出的目录）在历史的开头；本次输入在最后。
 * - 事件：`status`、`stream`（文字增量的快照）、`tool`、`entry` 都带会话内单调递增的序号；订阅只收订阅之后的。
 * - 第二次调用不再写种子；`every={3}` 的提醒在第 2 轮不出现。
 *
 * 阅读顺序：`testing/scripted-model.ts` → `profiles/writer.profile.tsx` → `nodes/workspace-tree.ts` → `assemble.ts` → 这里。
 *
 * 行为合同：docs/specs/harness/runtime.md 输出第 2–5 条；docs/specs/harness/profile.md 输出第 7、8、10、11 条；
 * docs/specs/harness/builtin-tools.md 输出第 2 条。
 */

import {afterAll, describe, expect, test} from "bun:test";
import type {RuntimeEvent} from "@notnotype/nb-harness";
import {assemble} from "../assemble";
import type {Assembled} from "../assemble";
import {contextText, scriptedModel} from "../testing/scripted-model";
import {createStage, exampleConfig, kinds, loadWriterProfile, toolResults} from "../testing/stage";
import type {Stage} from "../testing/stage";

let stage: Stage | null = null;
let assembled: Assembled | null = null;
afterAll(async () => {
    assembled?.close();
    await stage?.cleanup();
});

describe("示例场景 1：第一次调用", () => {
    test("模型读了第一章再回答；日志、模型看到的上下文与事件都能对上", async () => {
        stage = await createStage("01-first-invocation");
        const model = scriptedModel([
            {calls: [{id: "c1", name: "read", args: {path: "chapter-1.md"}}]},
            {text: "第一章写林岚在 1987 年从青岛出航。"},
            {text: "好的。"},
        ]);
        assembled = await assemble({
            workspace: stage.workspace, state: stage.state, config: exampleConfig(), profiles: [await loadWriterProfile()],
            apiKeys: {scripted: "example-key"}, model: {stream: model.stream},
        });

        const created = await assembled.runtime.createSession({profileId: "writer", id: "s1"});
        if (!created.ok) throw new Error(`${created.code}: ${created.detail}`);
        const session = created.value;
        const events: RuntimeEvent[] = [];
        session.subscribe((event) => events.push(event));

        const started = await session.prompt({content: "第一章讲了什么？"});
        if (!started.ok) throw new Error(`${started.code}: ${started.detail}`);
        const result = await started.value.done;
        expect(result.status).toBe("completed");

        // 写入顺序：调用开始、两条种子、本会话第一次选中的模型、输入、提醒（第 1 轮出现）、Profile 状态、助手调用工具、工具结果、助手回复、调用结束
        expect(kinds(result.entries)).toEqual([
            "custom:harness/invocation",
            "custom_message:harness/seed", "custom_message:harness/seed",
            "model_change",
            "message:user", "custom_message:harness/reminder", "custom:harness/profile-state",
            "message:assistant", "message:toolResult", "message:assistant",
            "custom:harness/invocation",
        ]);
        expect(result.entries).toEqual(session.log.entries);

        // read 的结果：标签头加行号；标签是内容哈希，edit 要用它
        const [read] = toolResults(result.entries);
        expect(read?.isError).toBe(false);
        expect(read?.text).toMatch(/^\[chapter-1\.md#[0-9a-z]+\]\n1: 第一章 出航\n2: 林岚站在甲板上。\n3: /u);

        // 模型第一次看到的：系统提示词来自 <System>；历史开头是种子，其中工作区列表列出了两个条目；本次输入在最后
        const first = model.contexts[0]!;
        expect(String(first.systemPrompt)).toContain("小说写作助手");
        const seen = contextText(first);
        expect(seen).toContain("<workspace>\n- chapter-1.md\n- notes/\n</workspace>");
        expect(seen).toContain("<system-reminder>");
        expect(first.messages.at(-1)).toMatchObject({role: "user"});
        expect(first.tools?.map((tool) => tool.name)).toEqual(["read", "edit"]);
        // 第二次请求里多了助手的工具调用与结果
        expect(model.contexts[1]!.messages.slice(-2).map((message) => message.role)).toEqual(["assistant", "toolResult"]);

        // 事件：序号单调递增；状态 running → idle；工具有 start 与 end；文字回复有 stream 快照
        expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1));
        const statuses = events.filter((event) => event.type === "status").map((event) => (event.type === "status" ? event.status.phase : ""));
        expect(statuses[0]).toBe("running");
        expect(statuses.at(-1)).toBe("idle");
        const tools = events.filter((event) => event.type === "tool").map((event) => (event.type === "tool" ? `${event.toolName}:${event.stage}` : ""));
        expect(tools).toEqual(["read:start", "read:end"]);
        expect(events.some((event) => event.type === "stream")).toBe(true);
        expect(events.filter((event) => event.type === "entry")).toHaveLength(result.entries.length);

        // 第二次调用：不再写种子，提醒也没到期（every=3）
        const second = await session.prompt({content: "继续"});
        if (!second.ok) throw new Error(`${second.code}: ${second.detail}`);
        const secondResult = await second.value.done;
        expect(kinds(secondResult.entries)).toEqual(["custom:harness/invocation", "message:user", "message:assistant", "custom:harness/invocation"]);
        expect(session.status).toMatchObject({phase: "idle", profileId: "writer", model: "scripted/m", pending: []});

        await session.close();
        // 关闭后重新打开：条目一个不少（JSONL 存储）
        const reopened = await assembled.runtime.openSession("s1");
        if (!reopened.ok) throw new Error(reopened.code);
        expect(reopened.value.log.entries).toEqual(session.log.entries);
        await reopened.value.close();
    });
});
