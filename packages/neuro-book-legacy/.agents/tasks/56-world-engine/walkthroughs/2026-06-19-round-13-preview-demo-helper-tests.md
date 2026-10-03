# Round 13 - Preview Demo Helper Tests

## Scope

本轮继续推进浏览器验证前的稳健性工作。Round 11 已给 `/world-engine.preview` 一键示例世界增加 schema 属性级预检，但这段纯业务规则仍写在 Vue 组件内，不利于单元测试覆盖。

本轮目标是把示例世界的纯规则抽到 util，并补测试覆盖，减少真实页面点击前的盲区。

## Actual Changes

- 更新 `app/utils/world-engine-preview.ts`：
  - 新增 `WorldPreviewSchemaAttr / WorldPreviewSchemaType / WorldPreviewSubject` 类型。
  - 新增 `previewDemoSubjects()`，集中返回一键示例世界所需的 `world / capital / erina / old-sword`。
  - 新增 `previewDemoMutations()`，集中返回示例事件 slice 的 mutations。
  - 新增 `validatePreviewDemoSchema(schemaTypes, subjects)`：
    - 检查必需 subject type 是否存在。
    - 检查示例依赖属性的 kind/type 是否兼容。
    - 检查已有 subject id 是否与示例 id 发生 type 冲突。
- 更新 `app/pages/world-engine.preview.vue`：
  - 移除组件内的本地示例 subject、属性要求、schema 校验和 demo mutations 定义。
  - 改为调用 util helper，组件只负责 API orchestration 和 UI 状态。
- 更新 `app/utils/world-engine-preview.test.ts`：
  - 覆盖兼容 schema 通过。
  - 覆盖已有 subject id/type 冲突。
  - 覆盖缺少 `item` 类型。
  - 覆盖缺少 `character.inventory`。
  - 覆盖 `character.inventory` kind 不兼容。
  - 覆盖 `previewDemoMutations()` 本身可被 `parseMutationJson()` 接受。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts server/api/projects/world-engine/[...segments].test.ts`
  - 通过：2 个测试文件，11 个用例。
- `bun run typecheck`
  - 通过。

## Browser Testing

仍未自动浏览器验证。项目指令要求不要自动浏览器验证；当前只是提升浏览器前的测试证据。

## Code Review Notes

- 这轮没有改变后端契约，也没有改变一键示例世界的用户可见行为。
- 组件职责更清楚：Vue 负责读取表单、调用 API、更新状态；示例数据和 schema 预检由 util 管理。
- 真实浏览器验证仍然必要，因为这些测试不覆盖按钮点击、布局、loading 状态和页面错误展示。

## Walkthrough Delta

计划与实际一致。本轮没有遇到堵塞或绕道。
