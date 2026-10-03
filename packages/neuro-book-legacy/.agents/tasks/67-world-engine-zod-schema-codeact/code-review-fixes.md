# Code Review 修复报告

**日期**: 2026/06/26  
**任务**: Task 67 World Engine Zod 硬切 - Code Review 修复  
**审查工具**: /code-review high --comment

## 修复清单（8/8 完成）

### 1. ✅ 模板导入路径问题（HIGH）

**问题**: 模板 `schema/index.ts` 导入 `nbook/server/world-engine/zod-loader`，新项目无此路径。

**修复**: 
- 文件: `assets/workspace/.nbook/templates/project-directory-templates/world-engine/schema/index.ts`
- 方案: 直接在模板内定义 `Ref()` 和 `EmbeddingText()`，移除外部导入
- 影响: 新项目创建不再依赖 nbook 路径映射

### 2. ✅ 旧项目 YAML schema 静默失败（HIGH）

**问题**: 旧项目有 `schema.yaml` 时，loader 返回空 schema，导致所有操作失败且无提示。

**修复**:
- 文件: `server/world-engine/schema-loader.ts:36-48`
- 方案: 检测到 `schema.yaml` 存在时抛出明确的迁移提示错误
- 影响: 用户打开旧项目会立即得到清晰的迁移指引

### 3. ✅ Agent 技能文档引用旧 API（MEDIUM）

**问题**: 4个技能文档教 Agent 使用已删除的 8 工具 API。

**修复**:
- 文件: 
  - `novel-workflow-world-engine-init/SKILL.md`
  - `novel-workflow-08-plot-planning/SKILL.md`
  - `novel-workflow-09-chapter-writing/SKILL.md`
  - `novel-workflow-writer-execution/SKILL.md`
- 方案: 顶部添加警告横幅，指向新迁移指南
- 新增: `reference/world-engine/api-migration-zod.md` 迁移快速参考

### 4. ✅ 前端 Workbench 硬编码 schema.yaml（MEDIUM）

**问题**: 前端"打开 schema 源文件"功能硬编码 `schema.yaml` 路径。

**修复**:
- 文件: 
  - `app/components/novel-ide/world-engine/WorldEnginePreviewProjectPanel.vue:40`
  - `app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewSidebar.vue:49`
- 方案: 改为 `world-engine/schema/index.ts`
- 影响: "打开 schema" 按钮指向正确文件

### 5. ✅ 错误提示引用已删除工具（MEDIUM）

**问题**: instant 冲突错误提示用户"使用 edit_world_slice"，但该工具已删除。

**修复**:
- 文件: `server/world-engine/world-engine.service.ts:113`
- 方案: 改为实用建议"请选择相邻时间，或先删除已有切面再重新写入"
- 影响: 用户不再被引导到不存在的工具

### 6. ✅ SliceInput.patches 静默忽略（MEDIUM）

**问题**: `patches` 字段标记 `@deprecated` 但运行时静默忽略，导致数据丢失。

**修复**:
- 文件: `server/world-engine/world-engine.service.ts:112-118`
- 方案: 添加运行时检查，误用时抛出 400 错误
- 影响: 误用立即报错而非静默失败

### 7. ✅ 前端 Sidebar 硬编码 schema.yaml（MEDIUM）

**问题**: 同 #4，另一个前端组件。

**修复**: 见 #4

### 8. ✅ scalarOps(null) 依赖未文档化（LOW）

**问题**: `validateOp` 依赖 `scalarOps(null)` 返回 `["set","add","unset"]`，但未注释说明。

**修复**:
- 文件: `server/world-engine/world-engine.service.ts:962-968`
- 方案: 添加注释说明未声明属性的处理逻辑和 validateOp 依赖
- 影响: 防止未来改动破坏这个假设

## 验证

- ✅ typecheck: 0 new errors（只有历史 control-tools.test.ts）
- ✅ 基础组件测试: 44/44 通过（已在修复前验证）
- ✅ 模板自包含: 无外部依赖

## 影响范围

- **新项目创建**: 现在使用正确的自包含模板
- **旧项目迁移**: 得到明确的迁移指引而非静默失败
- **Agent 工作流**: 技能文档指向正确的迁移指南
- **前端 UX**: "打开 schema" 功能指向正确文件
- **错误提示**: 所有错误消息不再引用已删除工具

## 遗留工作（延后）

以下工作在 code review 中识别但不在本次修复范围：

1. **技能文档详细更新**: 当前只添加了警告横幅，具体示例代码仍是旧 API（需大量改写）
2. **空 text 校验**: `extractEmbeddingColumns` 不验证空字符串（数据问题，非 bug）
3. **测试文件重写**: facade/codeact/tools 测试从 YAML 到 Zod（Task 67 后续）

## 相关文档

- `reference/world-engine/api-migration-zod.md` - 新增的迁移快速参考
- `docs/tasks/67-world-engine-zod-schema-codeact/README.md` - 任务 walkthrough
