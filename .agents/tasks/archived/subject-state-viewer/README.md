# Subject State Viewer 组件

## Relative documents refs

- [WorldPreviewSchemaAttr 类型](file:///c:/Users/<user>/Documents/CodeRepository/GithubProjects/neuro-book/app/utils/world-engine-preview.ts#L23-L32)
- [WorldPreviewSchemaType 类型](file:///c:/Users/<user>/Documents/CodeRepository/GithubProjects/neuro-book/app/utils/world-engine-preview.ts#L34-L38)
- [SubjectStateDto 类型](file:///c:/Users/<user>/Documents/CodeRepository/GithubProjects/neuro-book/app/components/novel-ide/world-engine/world-engine-workbench.types.ts#L42-L46)
- [Zod Schema 定义](file:///c:/Users/<user>/Documents/CodeRepository/GithubProjects/neuro-book/world-engine/schema/index.ts)
- [现有 WorldEngineStateSummary 组件](file:///c:/Users/<user>/Documents/CodeRepository/GithubProjects/neuro-book/app/components/novel-ide/world-engine/WorldEngineStateSummary.vue)
- [现有 JsonViewer 组件](file:///c:/Users/<user>/Documents/CodeRepository/GithubProjects/neuro-book/app/components/common/JsonViewer.vue)
- [Inspector 中原有的快照区域](file:///c:/Users/<user>/Documents/CodeRepository/GithubProjects/neuro-book/app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewInspector.vue#L554)

## User Request / Topic

- JSON Editor（JsonViewer）用来查看 subject 状态虽然通用，但无法展示 Zod schema 中的 `.describe()` 描述信息。用户希望做一个专门的 Subject State Viewer 组件来替代 JSON Editor，让 schema 中的 description 在 UI 上直观可见。
- 先用单独的 preview 页面 + 示例数据来开发和测试这个组件。

## Goal

**Outcome**：创建一个可复用的 `WorldEngineSubjectStateViewer.vue` 组件，接收 `SubjectStateDto` 和 `WorldPreviewSchemaType` 数据，以结构化表格/卡片的形式展示 subject 的 attrs，每个 attr 旁边显示来自 Zod schema 的 `desc`（中文描述）、`kind`（scalar/list/collection/object）和 `type` 信息。

**Verification surface**：在 `app/pages/subject-state-viewer.preview.vue` 页面中用硬编码示例数据（包含各种 attr kind：scalar、list、collection、object、嵌套 object）渲染组件，浏览器中可直观验证。

**Constraints**：
- 不破坏现有组件的功能
- 组件只读，不涉及编辑功能
- 样式遵循 World Engine 现有 CSS 变量体系（`--we-*`）

**Boundaries**：
- 新增文件：`WorldEngineSubjectStateViewer.vue`、`subject-state-viewer.preview.vue`
- 修改文件：暂无（先独立开发测试，后续再替换 Inspector 中的 JsonViewer）

## Current State

### 现有数据流

1. **Zod Schema**（`world-engine/schema/index.ts`）→ 每个字段用 `.describe("中文描述")` 标注
2. **Schema Loader**（`server/world-engine/schema-loader.ts`）→ `zodFieldToAttr()` 提取 `description` 到 `WorldSchemaProjectionAttr.desc`
3. **前端 Schema 类型**（`WorldPreviewSchemaAttr`）→ `desc?: string` 字段已经可用

```typescript
// WorldPreviewSchemaAttr 结构
{
    name: string;              // attr 名称，如 "hp", "skills"
    kind: "scalar" | "list" | "collection" | "object";
    type?: string;             // 如 "number", "string"
    itemType?: string;         // list/collection 的元素类型
    enum?: JsonValue[];        // 枚举值
    default?: JsonValue;       // 默认值
    desc?: string;             // ← Zod .describe() 的中文描述
    fields?: Record<string, WorldPreviewSchemaAttr>;  // 嵌套字段
}
```

```typescript
// SubjectStateDto 结构
{
    subjectId: string;
    type: string;              // 对应 WorldPreviewSchemaType.type
    attrs: Record<string, WorkbenchJsonValue>;  // 实际运行时的值
}
```

### 现有相关组件

| 组件 | 用途 | 不足 |
|------|------|------|
| `JsonViewer.vue` | 通用 JSON 树形编辑器 | 无法展示 schema description |
| `WorldEngineStateSummary.vue` | 简单的 attr name→value 两列表格 | 无 description、无 kind/type 信息、无法展示嵌套 |

## Decisions / Discussion

### 展示设计方向

每个 subject 渲染为一张卡片，卡片内按 attr 逐行展示：

```
┌─ 艾莉娜·晨曦 (character) ──────────────────────┐
│                                                  │
│  hp         100           生命值        scalar    │
│  maxHp      100           最大生命值    scalar    │
│  level      5             等级          scalar    │
│  location   "古代图书馆"   当前位置      scalar    │
│  mentor     → 奥兰多三世   导师引用      scalar    │
│  skills     ["剑术","魔法"] 技能列表     collection│
│  ▸ equipment                装备（展开） object    │
│    ├ weapon  "精灵长剑"                           │
│    └ armor                                        │
│      ├ name  "学徒法袍"                           │
│      └ def   12                                   │
│                                                  │
└──────────────────────────────────────────────────┘
```

关键设计点：
1. **四列布局**：`attr name` | `value` | `desc`（来自 schema） | `kind badge`
2. **嵌套展开**：`object` 类型的 attr 可折叠展开，递归渲染子字段
3. **Ref 识别**：当 `desc` 以 `ref:` 开头时，识别为引用类型，尝试解析为被引用 subject 的名称
4. **值的格式化**：string 原样显示，number 直接显示，array 显示简短预览（如 `["剑术", ...] (3)`），object 折叠
5. **空值提示**：当 attr 有 schema 定义但运行时没有值时，显示 default 值或占位提示

### 待定问题

- 对于非常深层嵌套的 object（如 `equipment.armor.enchantments`），是否限制展开层级？建议先不限制，后续按需加
- 是否需要支持搜索/过滤 attr？初版先不加

## Verification / Test

- 创建 `app/pages/subject-state-viewer.preview.vue` 页面
- 硬编码 schema + state 示例数据，覆盖所有 attr kind
- 浏览器访问 `/subject-state-viewer/preview` 验证渲染效果

## Implementation Walkthrough

-

## TODO / Follow-ups

- [ ] 创建 `WorldEngineSubjectStateViewer.vue` 组件
- [ ] 创建 `subject-state-viewer.preview.vue` 测试页面，用示例数据验证
- [ ] 浏览器验证各种 attr kind 的渲染效果
- [ ] （后续）用新组件替换 Inspector 中的 JsonViewer
- [ ] （后续）考虑在 MutationEditor 侧也用此组件展示当前 subject 状态
