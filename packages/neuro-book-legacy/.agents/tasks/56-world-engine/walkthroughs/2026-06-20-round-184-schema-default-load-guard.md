# Round 184：schema default 加载期校验

## 背景

本轮继续按用户调整，暂停前端推进，只做后端与 API 设计收口。

巡检 schema / default 路径时发现：`createSubject()` 已经会校验 schema default，并在失败时通过事务回滚 subject 身份；但 `getWorldSchema()` 仍可能把类型不合法的 default 投影给 Agent / API 调用方。这样坏 schema 的暴露时机偏晚，也让“schema 投影可用于写入前判断约束”的契约不够干净。

## 变更

- `server/world-engine/schema-loader.ts`
  - 在 schema 加载期校验显式 `default` 的纯形状 / 类型：
    - `int` 必须是整数；
    - `float` 必须是 finite number；
    - `text` / `bool` 必须匹配类型；
    - `enum` 必须命中取值，复杂 object enum 继续按 stable JSON 比较；
    - `list` / `collection` default 必须是 array；
    - `itemType: object` 的 default item 必须是 JSON object；
    - 固定 `object.fields` default 不允许多余 key；
    - 开放 `object itemType` default 会逐 key 校验；
    - `ref(type)` default 先校验 `subject://<id>` 形状与 id 空白规则。
  - ref default 的目标 subject 是否存在、type 是否匹配仍保留在 `createSubject()` 写 init mutation 时校验，因为这依赖 Project SQLite 当前数据。
- `server/world-engine/world-engine.facade.test.ts`
  - 把 `hp default: bad` 从创建期错误改为 schema 加载期错误。
  - 保留事务回滚覆盖：用 `ref(location) default: subject://capital` 触发创建期“引用目标不存在”，确认 subject 身份和 slice 都没有落库。
- `server/api/projects/world-engine/[...segments].test.ts`
  - HTTP object default 测试改为“schema 加载期校验”，断言错误带 `世界 schema 解析失败：...` 前缀。
- 文档同步：
  - `docs/tasks/56-world-engine/README.md`
  - `docs/tasks/56-world-engine/schema-design.md`
  - `docs/tasks/56-world-engine/sqlite-and-api.md`
  - `docs/tasks/56-world-engine/agent-tools.md`
  - `PROJECT-STATUS.md`

## 验证

- `bun run test server/world-engine/world-engine.facade.test.ts`
  - 1 file passed，66 tests passed。
- 首次目标组合测试发现 HTTP 旧断言仍期待创建期错误消息：
  - 失败测试：`HTTP 创建 subject 时校验 itemType object 的 schema default`
  - 修复：改名为 schema 加载期校验，并断言 `世界 schema 解析失败：notes[0] default 必须是 object`。
- `bun run test server/world-engine/world-engine.facade.test.ts 'server/api/projects/world-engine/[...segments].test.ts' server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files passed，126 tests passed。
- `bun run typecheck`
  - passed。

## 与计划出入

- 原大路线仍包含前端 Preview / Workbench 收口；本轮按用户最新调整不做前端。
- 本轮不是新增 UI 能力，而是把 schema default 的纯配置错误前移到 schema loader，减少 API / Agent 看到坏 schema 投影的机会。
