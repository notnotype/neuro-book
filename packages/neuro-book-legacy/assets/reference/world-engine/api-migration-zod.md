# World Engine API 迁移速查：Zod Schema + execute_world

本文只给 Agent 快速校准当前协议。完整概念见同目录 `schema-system.md`、`subject-lifecycle.md`、`workflow.md`。

## 当前真相源

- Schema 文件：`world-engine/schema/index.ts`，使用 TypeScript + Zod。
- Calendar 文件：`world-engine/calendar.ts`。
- Agent 写作模式工具：单一 `execute_world`。
  - Leader / world.engine：readwrite 模式，提供查询、写入、精确编辑、删除。
  - writer：readonly 模式，只提供查询，不注入写方法。
- 工具统一返回 `{data, issues}`；脚本只 return 数据，issues 由运行时 collector 汇总。

## 旧协议对照

| 旧说法 | 当前做法 |
| --- | --- |
| `schema.yaml` | `world-engine/schema/index.ts` |
| `create_world_subject` | 首次 `world.slice.write` 时在任意 patch 上声明 `type`，自动创建 subject |
| `execute_world_query` | `execute_world` 中使用 `world.subject.*` / `world.slice.*` / `world.search.*` / `world.time.*` |
| `write_world_slice` | `execute_world` 中使用 `world.slice.write` |
| `delete_world_slice` | `execute_world` 中使用 `world.slice.delete`，仅用于整条切面作废 |
| `edit_world_slice` / 整片覆盖 | `world.slice.editPatches(sliceId, edits, meta?)` 按 `patchId` 精确编辑 |
| `mutations` | `patches` |
| `attr` | JSON Pointer `path`，如 `/hp`、`/equipment/weapon` |
| `set` / `add` / `listAppend` | `replace` / `increment` / `append` |

## 最小读写示例

```javascript
const time = world.time.parse("公元2020年4月12日 18:00");

const written = await world.slice.write({
    time,
    title: "艾莉娜登场",
    patches: [
        {subjectId: "erina", type: "character", name: "艾莉娜", path: "/hp", op: "replace", value: 100},
        {subjectId: "erina", path: "/events", op: "append", value: {text: "在无名祭坛醒来"}},
    ],
});

const erina = await world.subject.get("erina");
return [
    `已写入切面：${written.sliceId}`,
    `时间：${world.time.format(time)}`,
    `艾莉娜生命值：${erina.hp}`,
].join("\n");
```

## 精确修正示例

```javascript
const slice = await world.slice.get(written.sliceId);
const wrong = slice.patches.find((patch) => patch.path === "/HP");

await world.slice.editPatches(written.sliceId, [
    {patchId: wrong.patchId, set: {path: "/hp", summary: "修正 HP 路径"}},
]);
```

## 提醒

- 在 `execute_world` 沙箱内，写入时间用 instant bigint：`world.time.parse()` 转入，`world.time.format()` 转出。
- 已知道 subject schema 字段含义时，优先在脚本内把 subject state 转成文本摘要并 `return string`，不要默认返回原始 JSON。
- 写入前先查已有 subject 和目标时间附近的 slice。
- 批量读取使用 `world.subject.gets(ids)`；`world.getMany` 已删除，不保留 alias。
- `world.slice.get(sliceId)` 只接受 sliceId；按 subject 查相关切面用 `world.slice.list({subjectIds:["id"], withPatches:true})`。
- 同一 instant 只能有一个 slice；要补同一时刻内容，读 patchId 后用 `world.slice.editPatches`。
- 默认 `EmbeddingText` 字段只写 `{text:"..."}`；`vector` / `model` 由系统维护。
- E issues 必须修；A issues 只需确认语义。
- 用户不需要理解 schema、slice、patch、op；对用户汇报用时间线和当前状态摘要。
