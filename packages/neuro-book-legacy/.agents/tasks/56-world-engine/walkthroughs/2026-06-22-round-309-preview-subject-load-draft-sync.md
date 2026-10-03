# Round 309 - Preview Subject Load Draft Sync

## 背景

继续按作者真实路径检查独立 `/world-engine.preview` 时，发现点击左侧 subject 后会同步 Query 和 Builder 的 subject，但不会同步右侧 mutations textarea。

如果当前 textarea 仍是系统自动生成的默认草稿，作者点击某个 subject 后直接写入 slice，可能实际提交的 mutation 仍指向上一个 subject。

## 实际变更

- `app/pages/world-engine.preview.vue`
  - `loadSubjectIntoQuery()` 在设置 `subjectForm` / `mutationBuilder.subjectId` 后，判断：
    - 当前不是编辑已有 slice；
    - 当前 mutations 仍是系统自动默认草稿。
  - 满足条件时调用 `applyDefaultSliceMutation(subject.id)`，把待写入 mutation 同步到点击的 subject。
  - 作者手写过 mutations，或正在编辑已有 slice 时，不覆盖 textarea。

- `app/utils/world-engine-ide-entry.test.ts`
  - 增加静态契约断言，确认 `loadSubjectIntoQuery()` 会在安全条件下同步默认 mutation，并且发生在 state query 前。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`

通过。

## 与计划出入

- 本轮没有修改后端、API 或主 Workbench。
- 本轮没有自动浏览器验证，符合当前约定。
