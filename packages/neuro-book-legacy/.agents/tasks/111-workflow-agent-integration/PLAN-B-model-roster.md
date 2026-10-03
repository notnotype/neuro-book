# PLAN-B：Agent 可见模型清单（设置模块，子任务 agent）

目标：用户在设置中维护一份「agent 可见模型清单」，每条 = 模型 key + 一句用途描述；workflow / agent 指定模型时只能从这份清单选。

## 用户需求原样

```
provider-id/model-id   这个属于高性能模型，对于编码任务优先使用他
provider-id2/model-id2 这个属于按次计费模型，对于一次性写作任务，可以是他
provider-id3/claude-opus-4.6 写作模型
```

- 用户自定义；通常不超过 5 条；默认 1 条 =当前默认模型。

## B1. 配置模型

- 落在全局配置 `models` 邻位（`server/utils/app-config.ts` 体系），建议：
  ```ts
  agent: {
      visibleModels?: {modelKey: string; note: string}[];  // modelKey = "provider/model"
  }
  ```
- 语义：为空/缺省 → 视为单条 `[{modelKey: 默认模型, note: "默认模型"}]`。
- 校验：modelKey 必须能被 `resolvePiModelFromConfig` 解析（provider 存在 + model 存在）；解析失败的条目在读取面过滤并 warn，不炸配置。
- 提供读取 helper `resolveAgentVisibleModels(config)`：返回归一化清单（含默认兜底），A 模块的 `run_workflow` 校验与 prompt 渲染都消费它——**单一真相源，勿在两处重复兜底逻辑**。

## B2. 设置 UI

- 挂进现有模型设置面（`app/components/novel-ide/settings/` 的 model-settings-draft/view 体系与 `NovelIdeSettingsDialog.vue`）。
- 形态：可增删排序的小列表（≤5 条给出软提示，不硬限制）；每条两个字段：模型选择（下拉，选项来自已配置 providers 的模型库）+ 用途描述单行文本。
- 颜色/状态遵循主题变量规范（禁 Tailwind 调色板类）；错误文案走 `resolveApiErrorMessage`。
- 草稿/保存流程与现有 model-settings-draft 一致。

## B3. Prompt 渲染

- `profile-dsl.ts` 加一个 fragment（或并入 A5 的 WorkflowCatalog 尾部）：渲染清单为
  `- provider/model —— 用途描述` 行，前置一句「为子 agent / workflow 指定模型时只能从下列清单中选择」。
- 挂 leader profile。注意提示词工程红线：不要把本对话上下文假设带进提示词。

## 交界（与 A 模块）

- A 消费 `resolveAgentVisibleModels`；B 不动 `run_workflow` 工具本体。
- DTO 若需要暴露给前端（设置表单读写），走既有 settings API 面。

## 验证

- `resolveAgentVisibleModels` 单测（空配置兜底 / 非法 modelKey 过滤）。
- `bun run typecheck`。UI 浏览器验收留给用户。
