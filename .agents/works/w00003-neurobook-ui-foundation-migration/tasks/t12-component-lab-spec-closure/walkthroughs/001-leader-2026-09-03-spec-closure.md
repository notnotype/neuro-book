---
schema: nbook.walkthrough/v1
taskId: t12-component-lab-spec-closure
sequence: 1
role: leader
status: completed
createdAt: 2026-09-03T00:00:00Z
---

# t12 Component Lab 当前规范补全

## 结论

Component Lab 的当前行为合同已补全，`docs/specs/ui/component-lab.md` 已从 `planned` 原地晋升为 `implemented`，并同步 `docs/specs/README.md`。这只闭合 Lab 规范，不表示 `w00003` 整体完成。

## 本次改动

- 将原型阶段的“导航、检视面板、组件索引形状、场景交互与失败呈现尚未定义”改为当前已实现的黑盒合同。
- 补充组件树按组导航、公开 string-id 选中、文档扫描派生索引、不可挂载原因和 fixture 关联边界。
- 补充文档、元素、事件、数据四个右侧 tab，检查器 hover/选中/复制/退出行为，场景切换与数据还原行为。
- 补充随窗口、手机 `390 × 844`、平板 `768 × 1024`、自由画布、运行中 `<=700px` 收起和 reduced-motion 合同。
- 补充 Lab 专属 localStorage/IndexedDB 偏好边界、字段校验、fail-open、事件上限与产品数据隔离。
- 补充 Source Dev 注册、Product 构建排除、生产路径不可达和构建门禁合同。
- 补充 implemented Spec 所需的 owner、实现入口、索引边界、状态/持久化边界、关键不变量、测试入口与 smoke 证据。
- t09 延期已记录：当前 `LabShell.vue` 约 1242 行，仍未满足 `<800` 硬验收；延期不等于完成，也不改变 t09 后续目标。

## 验证

- `bun run docs:check`：通过，`checkedFiles: 5364`，`failures: []`。
- `bun run governance:check`：通过，`failures: []`，`warnings: []`。
- `git diff --check`：通过；仅有仓库常态 LF→CRLF warning，无 whitespace error。
- Spec 旧文案扫描：`component-lab.md` 不再包含“尚未定义”“尚未实现”“有意保留的缺口”或 `planned`。
- 本次未重新运行生产构建、完整 nb-ui E2E、真实 `/lab` smoke、应用测试或人工视觉验收；已有真实 smoke 与生产排除记录按原 revision 链接并如实标注。

## Work 边界

- t09 仍延期，未执行 LabShell 拆分。
- C 产品 `theme.system` clean cutover 尚未创建或开始；Lab 使用 nb-ui 主题不等于产品主题迁移。
- 渐进式产品组件迁移仍未完成。
- nb-ui 全量 E2E 仍有既有失败，不由本次 Spec 补全重新分类或更新快照。
- Issue #191 不因本 Task 完成而关闭；远端 Issue、PR、push、合并和发布均未执行。
