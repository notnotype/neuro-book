# World Engine API 迁移指南（Zod 硬切）

> 本文档用于旧技能文档和代码迁移。2026/06 Task 67 完成后，World Engine 已硬切到 Zod schema + 2工具API。

## Schema 格式变更

- ❌ **旧**：`world-engine/schema.yaml` (YAML 格式)
- ✅ **新**：`world-engine/schema/index.ts` (TypeScript + Zod)

## Agent 工具变更

### 旧 8 工具（已删除）

| 旧工具 | 新替代方案 |
|--------|-----------|
| `get_world_state` | `execute_world_query` + `world.get(subjectId, instant)` |
| `list_world_subjects` | `execute_world_query` + `world.list(type)` |
| `get_world_schema` | `execute_world_query` + `world.schema()` |
| `list_world_slices` | `execute_world_query` + `world.slices(...)` |
| `create_world_subject` | **集成到 `write_world_slice`**：首次写入时自动创建 |
| `edit_world_slice` | **已删除**：改用覆盖写入或删除重写 |
| `delete_world_slice` | **暂无 Agent 工具**：需要后端支持 |

### 新 2 工具

1. **`execute_world_query`**：只读查询（CodeAct 沙箱执行 JS 代码）
2. **`write_world_slice`**：写入切面（`patches` 列表）

## 常见迁移模式

### 查询单个 subject 状态

```typescript
// 旧
get_world_state(projectPath, {
    subjectId: "erina",
    time: "星辉历312年 5月15日",
})

// 新
execute_world_query(projectPath, {
    code: `
        const state = world.get("erina", "星辉历312年 5月15日");
        return state;
    `
})
```

### 列出所有 character

```typescript
// 旧
list_world_subjects(projectPath, {type: "character"})

// 新
execute_world_query(projectPath, {
    code: `
        const subjects = world.list("character");
        return subjects;
    `
})
```

### 创建 subject

```typescript
// 旧
create_world_subject(projectPath, {
    type: "character",
    id: "erina",
    instant: 1000,
})

// 新：首次 write_world_slice 时自动创建
write_world_slice(projectPath, {
    instant: 1000,
    title: "艾莉娜登场",
    patches: [
        {subjectId: "erina", path: "/hp", op: "replace", value: 100},
        {subjectId: "erina", path: "/name", op: "replace", value: "艾莉娜"},
    ]
})
```

### 查询 schema

```typescript
// 旧
get_world_schema(projectPath)

// 新
execute_world_query(projectPath, {
    code: `
        const schema = world.schema();
        return schema;
    `
})
```

### 搜索文本（向量搜索）

```typescript
// 新功能：只在新 API 中存在
execute_world_query(projectPath, {
    code: `
        const results = world.searchText("character", "memory", "师门", {
            instant: "星辉历312年 5月15日",
            topK: 5,
        });
        return results;
    `
})
```

## World API 参考（execute_world_query 中可用）

- `world.get(subjectId, instant)` - 获取单个 subject 状态
- `world.list(type, instant?)` - 列出某类型所有 subjects
- `world.schema()` - 获取 schema
- `world.slices(subjectId, options?)` - 获取切面列表
- `world.searchText(query, options)` - 向量搜索
- `world.findRefs(targetId, instant?)` - 反向查找引用
- `world.now()` - 获取当前时间 instant

完整 API 见 `reference/world-engine/codeact-api.md`
