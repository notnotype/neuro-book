# Task 78: Plot Scene / World Engine Bridge - Implementation Goal

## 任务概述

重新设计 Plot 工作台，将 Scene 作为 Plot 与 World Engine 的桥梁。Scene 通过时间范围、出场 subjects 和地点连接到 World Engine，实现剧情结构与动态世界状态的同步。

## 核心目标

1. **Scene 连接 World Engine**：Scene 新增时间范围、出场 subjects、地点字段，可查询相关 World Engine 状态
2. **删除 StoryPlot / Plot Beat**：简化模型，Scene 成为 Plot 最小单位，事实推进由 World Engine patch 表达
3. **Plot Workbench 接入 World Engine**：用户可在 Plot Workbench 中创建、编辑 Scene，并查看 World Engine 上下文

## 关键决策（已确定）

- Scene `startInstant/endInstant` 允许 nullable（先规划后连接）
- 只用 `subjectIds` 记录所有相关 subjects，不区分 POV/active/mentioned
- 单个 `locationSubjectId`
- `StoryPlot` 立即删除，编写数据迁移脚本合并到 Scene
- Chapter 覆盖存储在 Project SQLite
- Scene 查询 World Engine 使用服务端封装 API：`GET /api/plot/scenes/:sceneId/world-context`
- 查询按时间范围 + subjects 收窄，UI 提供跳转到 World Engine Workbench

## 实施路径

### Phase 1：数据层基础（2-3 天）

**目标**：完成 Scene World Anchor 的数据层支持，不涉及 UI。

#### 核心变更

1. **Prisma Schema** (`prisma/project.schema.prisma`)
   ```prisma
   model StoryScene {
     // ... 现有字段 ...
     
     // 新增字段
     startInstant       BigInt?
     endInstant         BigInt?
     subjectIdsJson     String   @default("[]")
     locationSubjectId  String?
     
     @@index([startInstant])
   }
   ```

2. **TypeScript 类型** (`server/plot/core/types.ts`)
   ```ts
   import type {Instant} from "nb/server/world-engine/types";
   
   export type SceneWorldAnchor = {
       startInstant: Instant | null;
       endInstant: Instant | null;
       subjectIds: string[];
       locationSubjectId: string | null;
   };
   ```

3. **DTO Schema** (`shared/dto/plot.dto.ts`)
   ```ts
   export const StorySceneWorldAnchorDtoSchema = z.object({
       startTime: z.string().trim().min(1).nullable(),
       endTime: z.string().trim().min(1).nullable(),
       startInstant: z.string().nullable(),
       endInstant: z.string().nullable(),
       subjectIds: z.array(z.string().trim().min(1)).max(100),
       locationSubjectId: z.string().trim().min(1).nullable(),
   });
   ```

4. **验证逻辑** (`server/plot/services/scene-world-anchor.validator.ts`)
   - `startInstant <= endInstant`
   - `subjectIds` 去重检查
   - 空字符串检查

5. **Facade 集成 World Engine**
   - 注入 `worldEngineFacade`
   - 实现 `parseTime(projectPath, input)` / `formatTime(projectPath, instant)` 转换

#### 验收标准

- [ ] Prisma 迁移脚本可以在测试项目上成功执行
- [ ] 可以通过 API 创建带 World Anchor 的 Scene
- [ ] Repository 层测试通过

---

### Phase 2：StoryPlot 删除与数据迁移（2-3 天）

**目标**：删除 `StoryPlot` 表和相关代码，迁移数据到 Scene。

#### 核心变更

1. **数据迁移脚本**
   - 读取所有 `StoryPlot`
   - 将 Plot 的 `summary` 追加到 Scene 的 `summary`（分段追加）
   - 将 Plot 的 `effect` 追加到 Scene 的 `purpose`
   - 将 Plot 的 `writingTip` 合并到 Scene 的 `writingTip`
   - 导出原始数据备份（JSON 格式）

2. **Prisma Schema 清理**
   - 删除 `model StoryPlot`
   - 删除 `StoryScene.plots` 关系
   - 删除 `StorySceneRef` 中 `targetPlotId` 等 Plot 相关字段

3. **后端代码清理**
   - 删除 `server/plot/repositories/*plot*`
   - 删除 `server/plot/services/*plot*`
   - 删除 Plot 相关 DTO
   - 更新 `plot.facade.ts`：删除 `createPlot`、`updatePlot`、`deletePlot` 方法
   - 删除 Plot 相关 HTTP endpoints

4. **Agent 工具更新**
   - 删除 `create_story_plot`、`create_story_plots`、`update_story_plot` 工具
   - 更新 Agent 提示词：不再提及 Plot Beat

#### 验收标准

- [ ] 数据迁移脚本可以在测试项目上成功执行
- [ ] 迁移后的 Scene 数据完整（Plot 信息已合并）
- [ ] 后端编译通过，所有 Plot 相关代码已删除
- [ ] Agent 工具列表中不再有 Plot 相关工具

---

### Phase 3：Scene 查询 World Engine API（2-3 天）

**目标**：实现服务端封装的 Scene 查询 World Engine 上下文 API。

#### 核心变更

1. **桥接 Module** (`server/plot/services/scene-world-context.service.ts`)
   - 根据 Scene 的 `startInstant/endInstant` 查询 World Engine slices
   - 过滤只涉及 `subjectIds` 或 `locationSubjectId` 的 patches
   - 查询 subjects 在 `endInstant` 时刻的状态

2. **DTO 设计**
   ```ts
   type SceneWorldContextDto = {
       slices: Array<{
           id: string;
           timeFormatted: string;
           summary: string;
           patchCount: number;
       }>;
       subjectStates: Array<{
           subjectId: string;
           name: string;
           location?: string;
           hp?: number;
           // 其他关键属性
       }>;
   };
   ```

3. **HTTP API**
   - `GET /api/plot/scenes/:sceneId/world-context`
   - 权限校验、错误处理

4. **测试**
   - 单元测试：查询逻辑、收窄策略
   - 集成测试：完整 API 调用

#### 验收标准

- [ ] 可以通过 API 查询 Scene 的 World Engine 上下文
- [ ] 返回的数据按 subjects 过滤，不包含无关 patches
- [ ] 错误处理完善（Scene 不存在、时间范围为空、World Engine 不可用）

---

### Phase 4：前端 UI 实现（3-5 天）

**目标**：Plot Workbench 接入 World Engine，用户可见可用。

#### 核心变更

1. **Scene Card 改动** (`app/components/novel-ide/plot/workbench/PlotWorkbenchSortableSceneCard.vue`)
   - 新增 World Engine 状态指示器：
     - 🕒 时间范围：`公元2020年4月12日 18:00 ~ 20:00`
     - 📍 地点：显示 subject name
     - 👤 出场：显示 subjects 数量
   - 未连接状态：🔗 "未连接到世界引擎" 灰色提示

2. **Inspector 改动** (`app/components/novel-ide/plot/workbench/PlotWorkbenchInspector.vue`)
   - 新增 World Engine 连接编辑区域：
     - 时间范围输入框（文本输入 + 格式提示）
     - Subject 多选选择器
     - 地点单选选择器
     - "查看 World Engine 上下文" 按钮

3. **新增组件**
   - `SubjectMultiSelect.vue`：多选 Subject 选择器（下拉列表 + 搜索）
   - `SubjectSingleSelect.vue`：单选 Subject 选择器
   - `WorldEngineContextPanel.vue`：展示查询结果
     - Slices 列表（时间、summary、patches 数量）
     - Subjects 状态（name、location、HP 等）
     - "在 World Engine Workbench 中打开" 按钮

4. **API 集成**
   - 调用 `GET /api/plot/scenes/:sceneId/world-context`
   - 加载状态、错误处理
   - 跳转到 World Engine Workbench 的路由逻辑

#### 验收标准

- [ ] 用户可以在 Plot Workbench 中创建带 World Engine 连接的 Scene
- [ ] Scene Card 正确显示连接状态
- [ ] 点击"查看 World Engine 上下文"可以看到相关 slices 和角色状态
- [ ] 未连接 World Engine 的 Scene 仍可正常使用（向后兼容）

---

## 关键约束

1. **时间转换**：服务层使用 `Instant = bigint`，HTTP/DTO 使用项目日历字符串
2. **数据兼容**：现有 Scene 数据的新字段为 `null`（未连接 World Engine）
3. **查询收窄**：只返回涉及 `subjectIds` 或 `locationSubjectId` 的 patches
4. **UI 向后兼容**：未连接 World Engine 的 Scene 仍可正常编辑和使用

## 参考文档

- 完整设计文档：`docs/tasks/78-plot-scene-world-engine-bridge/README.md`
- World Engine Reference：`reference/world-engine/README.md`
- Plot System Reference：`reference/plot/system.md`
- 当前 Prisma Schema：`prisma/project.schema.prisma`
- 当前 Plot DTO：`shared/dto/plot.dto.ts`

## 预计工作量

- **Phase 1**：2-3 天
- **Phase 2**：2-3 天（可与 Phase 1 并行）
- **Phase 3**：2-3 天（依赖 Phase 1）
- **Phase 4**：3-5 天（依赖 Phase 3）

**总计**：9-14 天

## 验收总标准

- [ ] 用户可以在 Plot Workbench 中创建 Scene 并连接到 World Engine
- [ ] Scene 可以查询和展示相关的 World Engine 上下文（slices 和 subjects 状态）
- [ ] `StoryPlot` 已完全删除，历史数据已迁移
- [ ] 所有测试通过，后端和前端编译通过
- [ ] 未连接 World Engine 的 Scene 仍可正常使用（向后兼容）
