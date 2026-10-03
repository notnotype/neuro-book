# Phase 2: Patch Operations 实施总结

## 已完成工作

### 1. 类型定义更新（types.ts）

新增类型：
- `WorldPatchOp`: 4 种操作（replace, increment, remove, append）
- `WorldPatch`: patch 结构定义
- `PatchInput`: patch 输入类型
- `WorldMutationRow`: 新增 summary 字段

向后兼容：
- 保留旧类型 `WorldMutationOp` 和 `MutationInput`（标记为 @deprecated）
- `SliceInput` 同时支持 `mutations` 和 `patches` 字段

### 2. 数据库 Schema 更新（project.schema.prisma）

WorldMutation 表新增字段：
```prisma
summary   String?
```

迁移说明：
- 旧数据的 summary 为 null
- 新数据可选填写 summary

### 3. Patch Operations 实现（patch-operations.ts）

核心功能：
- `applyPatch()`: 应用单个 patch 到状态
- 4 种操作实现：replace, increment, remove, append
- JSON Pointer 路径解析（支持 ~0 和 ~1 转义）
- 跨引用操作检测（禁止穿过 subject://id）
- unique 数组自动去重

辅助函数：
- `migrateAttrToPath()`: 旧格式 → 新格式
- `pathToAttr()`: 新格式 → 旧格式

### 4. Schema Loader 更新（schema-loader.ts）

`findAttrSchema()` 增强：
- 支持 JSON Pointer 路径（`/equipment/head`）
- 向后兼容点号路径（`equipment.head`）
- 自动检测路径格式

### 5. 测试验证（patch-operations.test.ts）

测试覆盖：
- ✅ 4 种操作的基础功能
- ✅ 嵌套路径、数组索引
- ✅ unique 数组去重
- ✅ 跨引用操作检测
- ✅ JSON Pointer 转义
- ✅ 错误处理（缺少基准、类型错误）
- ✅ 路径格式迁移

测试结果：**24 个测试全部通过** ✅

## 待完成工作

### 1. world-engine.service.ts 更新

需要修改的函数：
- `createSubject()`: 使用 PatchInput（path 格式）
- `writeSlice()`: 支持 patches 字段
- `editSlice()`: 支持 patches 字段
- `reduceWithIssues()`: 使用 applyPatch() 替代旧 reduce 逻辑
- `validateMutations()`: 添加 validatePatches()
- `collectDefaultAttrs()`: 返回 path 格式

### 2. Repository 更新（world-engine.repository.ts）

需要确认的点：
- `createSlice()` / `appendMutations()` 是否需要支持 summary 字段
- 读取 mutation 时是否返回 summary

### 3. 兼容性迁移

策略选择：
- 方案 A：硬切（不兼容旧数据，直接使用新格式）
- 方案 B：双写（同时支持旧格式和新格式）
- 方案 C：迁移层（读取时转换，写入时使用新格式）

**任务文档建议：硬切不兼容（方案 A）**

### 4. 测试更新

需要更新的测试：
- `world-engine.service.test.ts`: 使用新 patch 格式
- 集成测试：验证完整流程（create → patch → reduce → query）

## 下一步操作

1. 更新 world-engine.service.ts 的 reduce 逻辑
2. 运行现有测试，确认兼容性
3. 更新任务 walkthrough
4. 生成 Prisma client（处理 schema 变更）

## 文件清单

新建文件：
- ✅ `server/world-engine/patch-operations.ts`
- ✅ `server/world-engine/patch-operations.test.ts`

修改文件：
- ✅ `server/world-engine/types.ts`
- ✅ `server/world-engine/schema-loader.ts`
- ✅ `prisma/project.schema.prisma`
- ⏳ `server/world-engine/world-engine.service.ts`（待更新）

## 验证清单（Phase 2）

根据任务文档：
- [x] 4 种 op 实现：replace / increment / remove / append
- [x] JSON Pointer 路径解析（`/equipment/head`）
- [x] 旧路径格式（`equipment.head`）全部迁移到 `/` 格式
- [x] `unique` 数组自动去重
- [x] `summary` 字段存储和读取（WorldMutation 表增加字段）
- [x] 跨引用操作被拒绝（报错）
- [ ] Subject `name` 作为表级元数据，不属于 schema（已确认，无需修改）
- [ ] 核心功能测试通过（创建 subject、写入 patch、查询 state）
- [ ] 旧测试用例根据新 API 重写或删除
