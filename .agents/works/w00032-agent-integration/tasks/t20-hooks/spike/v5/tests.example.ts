/**
 * 插件作者给扩展写测试的样子（testing.ts 只有类型，这里只过 tsc，不执行）。
 * 内核是真的，只假模型、工具、时钟、资源；严格模式在关闭时检查“没有没认领的 error 诊断”“重放得到的状态与现场一致”。
 */

import {expect, test} from "bun:test";
import {memory, tasks} from "./plugins.ts";
import {createTestSession} from "./testing.ts";

test("检索结果排在用户的话前面，日志里仍是用户的话先写", async () => {
    await using session = await createTestSession({extensions: [memory(async () => [{id: "m1", text: "林舟左手有旧伤"}])]});
    session.model.script("好的");
    await session.say("续写第三章");
    expect(session.requests[0]!.outline()).toEqual(["system: fixed:profile", "user: event:nb-memory/retrieved | event:input"]);
    expect(session.events.map((event) => event.type).filter((type) => type === "input" || type === "nb-memory/retrieved")).toEqual(["input", "nb-memory/retrieved"]);
});

test("回退之后任务清单跟着回去", async () => {
    await using session = await createTestSession({extensions: [tasks], tools: {todo: () => ({text: "已记下", details: [{text: "写第 4 章", done: false}]})}});
    session.model.script("好的");
    await session.say("先别列任务");
    const before = session.mark();
    session.model.script({text: "", tools: [{name: "todo", args: {}}]}, "列好了");
    await session.say("列一下任务");
    expect(session.state(tasks).items).toHaveLength(1);
    await session.rewind(before);
    expect(session.state(tasks).items).toHaveLength(0);
});
