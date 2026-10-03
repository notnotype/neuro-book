# Round 301 - Preview Schema Fill Current Subject

## 背景

继续沿独立 `/world-engine.preview` 的真实写作路径检查：作者创建或点击一个 subject 后，通常会在左侧 Schema 区域点击某个 attr 快捷项，把 mutation 填进写入表单。

旧 `subjectIdForSchemaType()` 的优先级是“找该类型的第一个已有 subject”。在 `ming-ding-zhi-shi-2` 这类多个 `character` 并存的项目里，作者当前选中 / 刚创建的是 `player`，但点击 `character.hp` 之类快捷项时可能填到第一个 character，而不是当前上下文 subject。

## 实际变更

- `world-engine.preview.vue`
  - 调整 `subjectIdForSchemaType(typeName)` 优先级：
    1. 当前 Mutation Builder subject，且类型匹配。
    2. 当前 Query 的第一个 subject，且类型匹配。
    3. 创建表单里的 subject id，且类型匹配。
    4. 同类型第一个已存在 subject。
    5. 最后才回退到 `subjectForm.id || "world"`。

- `world-engine-ide-entry.test.ts`
  - 增加静态契约断言，确认 schema attr 快捷填充会优先使用当前 Builder / Query subject。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。

## 与计划出入

- 本轮没有改 schema 展示 UI，只修正快捷填充的 subject 选择语义。
- 本轮没有自动浏览器验证，符合当前约定。
