# Round 15：现有 Project EmbeddingText 受控迁移

## 用户问题

Leader smoke 中 `world.search.text("薇洛丝 项链")` 返回空。需要确认 embedding 搜索能否工作，并系统性修复当前 Project 的数据能力，不能靠 SQL 临时补列或静默兜底。

## 根因

- embedding provider / model 可用；空结果不是模型未配置。
- `workspace/ming-ding-zhi-shi-2/.nbook/project.sqlite` 有 216 条 WorldPatch，但 `text IS NOT NULL` 为 0。
- 项目 schema 的 events / memory 仍是 string，写入时不会生成 WorldPatch.text/vector/model 检索列。
- 搜索服务此前无法区分“schema 没有 EmbeddingText”“filter 拼错”和“合法范围内确实没有文本”，三者都会表现为 `[]`。

## 本轮实现

1. `WorldEngineService.searchText` 在请求 embedding 前校验 schema 能力与 types / attrs：
   - schema 或选定 types 没有 EmbeddingText：400；
   - 未声明 type：400；
   - attr 不是当前范围内的 EmbeddingText 容器：400；
   - 合法范围但无文本行：保持 `[]`。
2. 当前 Project schema 将 world / character / faction / location / item 的 events，以及 character memory 改为 `EmbeddingText`。
3. 三个仍写入该项目语义的 seed / chapter 脚本统一写 `{text:"..."}`，避免迁移后重新播种时写回旧形状。
4. 新增 `scripts/db/migrate-ming-ding-zhi-shi-2-embedding-text.ts`：
   - 默认 dry-run；
   - 非空 `/events` string[] replace 转为 `replace []` + 每条文本独立 append；
   - string append 与 memory replace 转为 `{text}` 并填充 WorldPatch.text；
   - 同 slice 重排 seq，保持原 patch 相对顺序；
   - `--apply` 前 checkpoint + 独占备份，写入使用单事务；
   - 前后按 slice 比较 events / memory 纯文本 reduce 结果，并验证非目标 patch 未变化与写后数据库等于 dry-run 计划。

## 实际 dry-run

```text
patch: 216 -> 232
affected slices: 7
embedding text rows: 26
```

dry-run 没有修改 SQLite。真实 migration 本轮明确不执行，等待用户单独授权 `--apply`。

## 与原计划的差异

Task 75 的旧 D14 曾决定暂时保留 string events。本轮真实故障证明该决定会让 `world.search.text` 永远没有数据源，因此 D14 被 D27 明确取代；Calendar 迁移仍与 embedding 数据迁移保持独立，没有混成一个不可回滚动作。

## 验证

- Facade 回归覆盖无 EmbeddingText、未知 type、非 embedding attr、空 filters。
- 真实 Project SQLite dry-run 覆盖迁移计数与 slice 级文本等价检查。
- 未执行 `--apply`，数据库仍保持迁移前状态。
