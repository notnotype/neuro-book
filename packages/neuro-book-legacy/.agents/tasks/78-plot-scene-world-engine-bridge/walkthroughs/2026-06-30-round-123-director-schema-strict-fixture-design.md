# Round 123: Director Schema Strict Fixture Design

## Scope

本轮把 `DirectorOutputSchema` 的测试形状写成可执行设计。没有改业务代码、没有运行测试。

## Current Test Gap

`server/agent/profiles/simulation-director-profiles.test.ts` 当前只验证：

- director 使用 `DirectorInitialSchema` / `DirectorOutputSchema`。
- director toolset 包含 `get_scene_world_context`。
- director 没有文件写入工具。
- prompt 包含 `Thread / Scene` 和 reference。

缺口：

- 没有用 `Value.Check()` 证明旧 `simulator_requests` 被拒绝。
- 没有证明 `plot_updates.kind = "plot"` 被拒绝。
- 没有证明 root extra field 被拒绝。
- 没有证明 `plot_updates` item extra field 被拒绝。
- 没有证明新 `world_engine_requests` 是必需输出字段。

## Proposed Test Shape

在同一个测试文件中新增 schema-only 用例，导入：

```ts
import {Value} from "typebox/value";
```

定义一个最小合法输出 fixture：

```ts
const validDirectorOutput = {
    summary: "已整理本章 Scene。",
    status: "completed",
    plot_updates: [{
        kind: "scene",
        action: "read",
        id: "scene-1",
        title: "开场",
        summary: "读取 Scene。",
    }],
    chapter_plan: "",
    writer_handoff: "",
    world_engine_requests: [],
    open_questions: [],
};
```

断言：

```ts
expect(Value.Check(DirectorOutputSchema, validDirectorOutput)).toBe(true);
expect(Value.Check(DirectorOutputSchema, {
    ...validDirectorOutput,
    simulator_requests: [],
})).toBe(false);
expect(Value.Check(DirectorOutputSchema, {
    ...validDirectorOutput,
    plot_updates: [{...validDirectorOutput.plot_updates[0], kind: "plot"}],
})).toBe(false);
expect(Value.Check(DirectorOutputSchema, {
    ...validDirectorOutput,
    unexpected: true,
})).toBe(false);
expect(Value.Check(DirectorOutputSchema, {
    ...validDirectorOutput,
    plot_updates: [{...validDirectorOutput.plot_updates[0], unexpected: true}],
})).toBe(false);
expect(Value.Check(DirectorOutputSchema, {
    ...validDirectorOutput,
    world_engine_requests: undefined,
})).toBe(false);
```

实际实现时不要照抄 `undefined` 作为 JSON shape 的唯一负例；更稳定的是删除字段：

```ts
const missingWorldRequests = {...validDirectorOutput};
delete (missingWorldRequests as Partial<typeof validDirectorOutput>).world_engine_requests;
expect(Value.Check(DirectorOutputSchema, missingWorldRequests)).toBe(false);
```

## Schema Change

目标 schema 应是：

- `plot_updates.kind`: `thread | scene | chapter` 或第一期只保留 `thread | scene`。
- `world_engine_requests`: `string[]`，字段 description 明确“需要 leader.default 或 world.engine 处理的 World Engine 未决问题；director 不直接写 World Engine”。
- `simulator_requests`: 删除，不做 deprecated alias。
- `Type.Object(..., {additionalProperties: false})` 应用于 root。
- `plot_updates` item 也要 `additionalProperties: false`。

`chapter` 是否加入 `plot_updates.kind` 取决于实际 director 是否会报告 chapter ordering。若没有明确落库对象，先不加 `chapter`，避免扩大 Interface。

## Prompt Assertion Change

同一测试还应迁移 prompt 断言：

- 必须不包含 `simulator_requests`。
- 必须不包含 `Simulation gate`。
- 必须不包含“调用 simulator.leader”。
- 必须包含 `world_engine_requests`。
- 必须包含“World Engine 未决问题交回 leader.default”。
- 必须包含“director 不写 World Engine”。

## Why This Test Belongs With Director Profile

`DirectorOutputSchema` 是 director 的 Agent-facing Interface，不只是普通 DTO。把 strict 正负例放在 `simulation-director-profiles.test.ts` 可以把 prompt、toolset、schema 放在同一测试 seam 上，后续改 profile 时能立刻看到合同是否重新漂移。

## Conclusion

Slice 1 的 schema 验收必须是机械拒绝旧合同，而不是人工搜索旧词。`Value.Check()` 负例是防止旧 `simulator_requests` 和旧 `"plot"` kind 回流的最低门禁。

