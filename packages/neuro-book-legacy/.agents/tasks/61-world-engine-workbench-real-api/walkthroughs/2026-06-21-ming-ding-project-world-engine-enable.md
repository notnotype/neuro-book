# 2026-06-21 Ming Ding Project World Engine Enable

## Summary

- 为当前 Project Workspace `workspace/ming-ding-zhi-shi-2` 启用 World Engine。
- 本轮是项目级轻量迁移，不做通用 `simulation/subjects -> World Engine` 桥接，也不深度迁移旧 `events.jsonl / memory.jsonl / state.md`。
- 迁移后主 IDE Workbench 能读取非空 schema、看到旧主体系统里的 6 个真实角色和 `world`，并拥有可 reduce 的初始化切片。

## Changes

- `workspace/ming-ding-zhi-shi-2/world-engine/calendar.yaml`
  - 新增当前默认数字日历。
  - 旧 `风信之月` 本轮临时映射为数字 `1月`，不扩展 Calendar 月名能力。
- `workspace/ming-ding-zhi-shi-2/world-engine/schema.yaml`
  - 基于默认模板启用 `world / character / faction / location / item`。
  - `character` 增加旧主体链接字段：`sourcePath / legacyKind / controlledBy / profile / canonicalSource`。
- Project SQLite 数据
  - 通过 `WorldEngineFacade` 创建 `world` subject。
  - 通过 `WorldEngineFacade` 创建 6 个 `character` subjects：`player / armand-brauer / mage / motion-boy / lolita-girl / glasses-girl`。
  - 排除 `sample-npc`。
  - 初始化时间为 `复兴纪元488年 1月15日 14:00:00`。
  - 旧主体链接字段写入 `复兴纪元488年 1月15日 14:00:01` 的 `kind=init` 切片。

## Verification

- `getWorldSchema("workspace/ming-ding-zhi-shi-2")`
  - 返回 `world / character / faction / location / item`。
- `listWorldSubjects("workspace/ming-ding-zhi-shi-2")`
  - 返回 7 个 subject：`world` + 6 个真实角色。
- `listSlices(... withMutations=true)`
  - 返回 2 个 `kind=init` 切片：
    - `复兴纪元488年 1月15日 14:00:00`：subject 默认初始化，27 条 mutations。
    - `复兴纪元488年 1月15日 14:00:01`：旧主体链接初始化，30 条 mutations。
- `queryState({subjectIds:["player","armand-brauer"]})`
  - 返回可 reduce 状态，包含默认 `hp / maxHp / inventory / events` 和旧主体链接字段。
  - `issues: []`。

## Notes

- 计划原本希望编辑同一个 `kind=init` slice 追加旧主体链接字段。实际执行时发现现有 service 存在 create/edit 语义缝隙：`createSubject` 会把 list default 写成 `events set []`，但 `editSlice` 整块保存时按 schema 校验，`list` 不允许 `set`。为避免改后端或直接写 SQLite，本轮改为创建下一秒 `kind=init` 链接切片。
- 这是刻意的最小偏离：仍然通过 facade 写入，保留可 reduce 结果，并把真实后端契约问题留给后续单独处理。
- 本轮没有自动做浏览器验收；后续可打开主 IDE Workbench 确认 schema 警告消失、左侧 Subjects 显示 7 个主体、Slice List 显示两条初始化切片。
