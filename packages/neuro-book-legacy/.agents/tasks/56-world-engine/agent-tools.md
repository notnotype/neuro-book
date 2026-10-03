# World Engine — Agent 工具契约

> 本文件是 [README.md](README.md) 的子文档，记录 World Engine 暴露给 Agent 的当前工具协议。
> 当前协议由 Task 67 / 69 / 71 收口而来：旧的固定 RPC 工具已退场，Agent 统一使用 `execute_world` CodeAct 工具。

## 1. 核心原则

- **单工具读写合一**：Leader / world.engine 使用 `execute_world` 在一个 JavaScript 脚本里查询、写入、精确编辑和删除切面。
- **writer 只读**：writer profile 也绑定 `execute_world`，但运行时使用 readonly 模式，不注入 `world.slice.write` / `world.slice.editPatches` / `world.slice.delete`。
- **事务边界在脚本级**：一次 `execute_world` 调用运行在一个 deferred 事务中；脚本正常结束 commit，脚本 throw 或超时 rollback。
- **脚本只返回数据**：工具 details 永远是 `{data, issues}`。写方法返回的 issues 可供脚本自查，但运行时也会统一收集，不要在脚本 return 里重复塞 issues。
- **时间在沙箱内用 instant bigint**：写入前用 `world.time.parse("项目日历字符串")` 得到 `bigint`，需要给人看时用 `world.time.format(instant)`。
- **路径统一 JSON Pointer**：读写两侧都使用 `/hp`、`/memory/师门` 这类 JSON Pointer；`findRefs` / `searchText` 返回的 attr 也是 JSON Pointer。

## 2. 工具入口

```ts
execute_world({
    projectPath: string,
    code: string,
}) -> {
    data: unknown,
    issues: WorldIssue[],
}
```

- `code` 必须是 inline JavaScript，不支持从路径读取脚本。
- 返回数据上限 10KB；查询时只 return 摘要或必要字段，不要倾倒完整世界。
- `undefined` / 无 return 会被转成 `"执行完成"`。
- BigInt 在最终工具 details 中会序列化为字符串。

## 3. 沙箱 World API

### 3.1 时间

```ts
world.time.parse(calendarText: string): bigint;
world.time.format(instant: bigint): string;
world.time.now(): bigint;
```

`world.time.now()` 是脚本开始时的最新切面时间快照。写入时间必须显式传入，不要依赖 now 自动推进。

### 3.2 查询

```ts
world.subject.get(id, options?: {deref?: boolean, derefDepth?: number}): Promise<any | null>;
world.subject.gets(ids: string[]): Promise<Array<any | null>>;
world.subject.list(type?: string): Promise<Array<{id: string, type: string, name: string}>>;
world.subject.findRefs(targetId: string, sourceType?: string): Promise<Array<{subjectId: string, attr: string}>>;

world.search.text(query: string, options?: {k?: number, threshold?: number, types?: string[], attrs?: string[], at?: bigint}): Promise<Array<{subjectId: string, attr: string, text: string, score: number}>>;

world.slice.list(options?: {from?: bigint, to?: bigint, limit?: number, withPatches?: boolean, subjectIds?: string[], subjectMode?: "any" | "all"}): Promise<SliceListItem[]>;
world.slice.get(sliceId: string): Promise<SliceListItem>;
```

- 写入前先查 schema 语义和现有 subject，避免 id/type/ref 拼错。
- 批量读取用 `world.subject.gets(ids)`；缺失 subject 按输入顺序返回 `null`。
- 需要精确编辑 patch 时，用 `world.slice.get(sliceId)` 或 `world.slice.list({withPatches:true})` 取得 `sliceId` 与 `patchId`。
- `world.slice.get` 只接受 `sliceId`；按 subject 查相关切面用 `world.slice.list({subjectIds:["erina"], withPatches:true})`，需要同时包含多个 subject 时传 `subjectMode:"all"`。
- `world.subject.findRefs` 内部批量查询 subject；返回 attr 已转成 JSON Pointer。
- `world.search.text` 的 `types` 过滤 subject type（如 `character` / `location`），不是 slice kind；要搜经历流文本，用 `attrs: ["events"]`。

### 3.3 写入与编辑

```ts
world.slice.write({
    time: bigint,
    title?: string,
    summary?: string,
    kind?: string,
    patches: Array<{
        subjectId: string,
        path: string,
        op: "replace" | "increment" | "remove" | "append",
        value?: unknown,
        summary?: string,
        type?: string,
        name?: string,
    }>,
}): Promise<{sliceId: string, issues: WorldIssue[]}>;

world.slice.editPatches(
    sliceId: string,
    edits: Array<
        | {patchId: string, set: {path?: string, op?: string, value?: unknown, summary?: string}}
        | {patchId: string, remove: true}
        | {add: {subjectId: string, path: string, op: string, value?: unknown, summary?: string}}
    >,
    meta?: {time?: bigint, title?: string, summary?: string, kind?: string},
): Promise<{sliceId: string, issues: WorldIssue[]}>;

world.slice.delete(sliceId: string): Promise<{issues: WorldIssue[]}>;
```

- 首次写入新 subject 时，在任意 patch 上声明 `type`，可选 `name`，`world.slice.write` 会自动创建 subject 并写入 schema default。
- 同一 instant 只能有一个 slice；确实要补同一时刻内容时，读出已有切面的 patches 后用 `world.slice.editPatches` 增加 patch。
- 修一条写错的 patch 时优先 `world.slice.editPatches`，不要 delete 整片重写。
- `world.slice.editPatches` 复用 `service.editSlice`，会整块替换该 slice 的 patch 行；编辑后所有旧 `patchId` 都失效，连续编辑同一 slice 必须重新 `world.slice.get`。
- `world.slice.editPatches` 的 `{add:{...}}` 不继承首写自动建 subject 规则；创建新 subject 仍走 `world.slice.write`。
- `world.slice.delete` 是物理删除，不可恢复，只用于整条切面作废。

## 4. 推荐脚本范式

```js
const time = world.time.parse("公元2020年4月12日 18:00");

const written = await world.slice.write({
    time,
    title: "遗迹余波",
    kind: "event",
    patches: [
        {subjectId: "erina", type: "character", name: "艾莉娜", path: "/hp", op: "replace", value: 90},
    ],
});

if (written.issues.some((issue) => issue.severity === "error")) {
    throw new Error("写入产生 error issue，回滚本次脚本");
}

const erina = await world.subject.get("erina");
return {
    sliceId: written.sliceId,
    time: world.time.format(time),
    hp: erina.hp,
};
```

## 5. Issues 处理

- `severity: "error"` 是数据错误，必须修。
- `severity: "advisory"` 是补过去或覆盖关系的一次性提醒，不自动回滚，但要确认语义是否符合剧情。
- 写方法返回 issues 供脚本内判断是否 throw；工具结果中的 `issues` 是运行时 collector 汇总结果，最终解释给用户时使用后端返回的 `title`、`message`、`explanation`。
- 完整 code 表和 `WorldIssue` 字段见 `reference/world-engine/issues.md`。

## 6. 与旧协议的关系

- `execute_world_query` / `write_world_slice` / `delete_world_slice` 已被 `execute_world` 取代。
- 更早的 `get_world_state`、`list_world_slices`、`create_world_subject`、`edit_world_slice`、`get_world_schema`、`list_world_subjects` 等固定工具只保留在历史 walkthrough / migration 语境。
- `schema.yaml` 已被 Zod `world-engine/schema/index.ts` 取代；Calendar 配置为 `world-engine/calendar.ts`。
