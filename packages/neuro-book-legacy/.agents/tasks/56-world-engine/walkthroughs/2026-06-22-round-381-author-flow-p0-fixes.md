# Round 381 - Author Flow P0 Fixes

## 背景

Round 380 真实浏览器验收发现两个作者流 P0：

- 历史 slice 的 `files N` / Inspector proposal 入口不稳定，尤其是 `player` 语境承接 `world.events` 时容易丢焦点。
- Slice Composer 编辑模式里，Builder value 修改后保存返回 200，但 mutation value 没有落库。

本轮按用户要求继续推进真实作者流，不再扩张畸形输入测试。

## 变更

- `files N` 入口现在会把 proposal 的 subjectId 一起传上来；父层选中 slice 后会恢复该主体焦点，再打开 Inspector 的 `Subject file proposals`。
- `alignFocusedSubject()` 对 `world.events` slice 增加主体系统语境保护：当前 focused subject 有 `simulation/subjects` summary 时，不会被强行改成 `world`。
- Slice Composer 保存前会把已编辑但未应用的 Builder 草稿同步进 mutations JSON，避免提交旧 textarea。
- Builder text/ref value 不再走 loose JSON 解析；`[验收] ...` 这类普通文本不会被误判成 JSON 数组。
- 主体文件 proposal 生成现在优先使用 `events` mutation narrative，再回退到 slice summary；编辑 mutation value 后，`events.jsonl` 建议会反映最新事件正文。
- 为 Composer 子组件关键路径补函数型回调 prop，保留原 emits，避免嵌套组件事件链在真实 Dialog 中漏传时静默失败。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts` 通过。
- `bun run typecheck` 未通过，但失败仍集中在无关 `server/agent/tools/control-tools.test.ts` 旧类型漂移。
- 真实浏览器验收使用临时 `localhost:3001` dev server 跑当前源码：
  - `Step C files 1` 打开后，Inspector 显示 `薇洛丝 / 当前主体语境下的 world 事件建议 / simulation/subjects/player`，且 proposal 时间为 `14:00:08`。
  - Step A / Step B 历史 `files 1` 分别打开对应 `14:00:06` / `14:00:07` proposal，没有串到 Step C。
  - Composer 编辑 Step C value，`POST /edit` 返回 `200 {sliceId, issues: []}`。
  - Facade 只读确认 Step C mutation value 已落库并包含 `她决定暂时不暴露任何异常。`
  - 重新打开 Step C proposal，`events.jsonl draft` 包含追加句。

## 真实数据状态

`workspace/ming-ding-zhi-shi-2` 的三条 `[验收]` 主线 slice 仍保留。Step C 当前 value 已追加：

```text
她决定暂时不暴露任何异常。
```

删除测试 slice 仍不存在。

## 与计划出入

- 本轮额外发现并修复了 proposal 文案优先级问题：保存后 timeline 已刷新，但 proposal 因优先使用 summary 没反映 mutation value；这属于同一个作者流 P0 的直接后续。
- 为确认当前源码，另起了 `localhost:3001` 临时 dev server；原 `localhost:3000` 服务看起来未加载本轮最新源码。
