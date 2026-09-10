---
schema: nbook.task/v2
taskId: t18-provider-and-role-settings
role: tasker
---

# Provider 设置与角色设置分家

## 状态

**草稿，等三个前置问题定论后再开工**（见文末「待定问题」）。本任务由开发者在 t17 验收时提出，不属于 t17 范围。

## 目标

开发者 2026-09-10 对 `ProviderSettingsView` 的验收结论：

1. `ProviderSettingsView` 一页塞了三件事（默认模型、Agent 可见模型、Provider 与模型清单），布局读不出主次。
2. 「全局默认模型」与「Agent 可见模型」应当各自独立成一个设置界面 Tab，不留在 Provider 页。
3. `ProviderSettingsView` 改名为 `ProviderSettingsView`（它就是 Provider 与模型清单的管理页）。
4. 新增一个单独的设置 Tab 放**角色设置**：把「哪个角色用哪个模型」做成可配置项，参考开发者给的 role 集合：

   **梯度轴（任何任务都可回落到这里）**

   | role | 候选链（按序尝试） | 用途 |
   | --- | --- | --- |
   | `tiny` | 本地 1B/4B → 本地 27B →（可选）deepseek-flash | 会话标题、记忆抽取、分类、打标 |
   | `fast` | deepseek-flash → 本地 27B → gpt-5.6-terra | 子代理、网页搜索、文档整理、机械改写 |
   | `main` | 用户当前手选的主力模型 | 主会话；所有专精角色的最终回落点 |
   | `deep` | gpt-6-astra → claude-fable-5.1 → claude-opus-5 | 架构设计、复杂推理、难 bug |

   **专精轴（按需，未配置时声明式回落到某个梯度）**

   | role | 候选链 | 回落 |
   | --- | --- | --- |
   | `summarize` | claude-5-sonnet → deepseek-flash | `main` |
   | `writer` | kimi-k3 → gemini-3.8-flash → claude-opus-5 → claude-fable-5.1 | `main` |
   | `narrative` | claude-opus-5 → claude-fable-5.1 | `writer` |
   | `plan` | 进入计划模式后切换的模型 | `deep` |
   | `vision` | 视觉模型，其他不支持原生多模态视觉的走这里 | 不能回落（特殊视觉模型） |

5. 开发者明确区分的两层概念：**role 是模型角色**，**profile 是代理类型**；`@writer` 这样的 profile 可以装载到 `writer.default` 这类 profile 配置上。两者不是同一层。

## 已定决策（2026-09-10）

- **角色页 UI 先行**：先按前端映射表把角色设置页做出来，保证 Lab 可用；后端契约（role 的 schema、候选链写在哪一层、本地模型怎么绑定、role 与 profile 的接线）**记录为缺口，正式接入时再做**。
- **布局问题的四条全部成立**（开发者验收回执）：顶部两栏控件不对齐；三块内容平铺、主次不分；内容列没封顶、控件拉满整行；间距与分隔节奏不一致。前三条由本任务的拆分与内容列封顶解决，第四条在拆分时统一到本批次的线条语言。

## 执行计划

1. **`sections/model` → `sections/providers`**，视图改名 `ProviderSettingsView`：只留 Provider 导轨 + 详情（连接表单 + 已启用模型清单）；把「全局默认模型」与「Agent 可见模型」两块整段移出。
2. **新增「默认模型」区段**：`DefaultProviderSettingsView`（global 选默认模型；project 为覆盖，留空跟随全局）。
3. **新增「可见模型」区段**：`AgentVisibleModelsView`（包住现有 `AgentVisibleModelsEditor`，附用途说明）。
4. **新增「角色」区段**：`RolesSettingsView`，UI 先行——梯度轴（tiny / fast / main / deep）与专精轴（summarize / writer / narrative / plan / vision）各一行，显示当前绑定与回落链；未配置时显示回落目标而不是空白。草稿与序列化放 `roles/roles-settings-draft.ts`，形状对齐将来的后端契约位。
5. **布局收口**：内容列封顶（阅读型区段按规范 ≈768px，两栏型 Provider 页保持整幅）、顶部两栏控件同一条基线、分隔统一 `--divider` 横线。
6. 每个区段照 t17 的六处配方补齐：视图 + 同名 `.md` + fixture + 注册表 + 外壳 fixture 的两条内容槽 + smoke 断言（`sectionCount` 5 → 8）。

## 待定问题（正式接入时处理，不阻塞 UI 先行）

1. **role 的后端契约**：`shared/dto` 与 Provider Config 里今天没有 role 这一层，i18n 也没有文案。
2. **候选链写在哪一层配置**：全局配置还是 boot config；「本地 1B/4B / 本地 27B」意味着 role 要能绑定 Provider 之外的本地推理端点，这一层今天不存在。
3. **role 与 profile 的接线关系**：`@writer` → `writer.default` 是配置项还是约定。

## 已知的可复用资产（t17 产出）

- `settings/sections/` 下的受控视图与 Lab 场景（外壳 + 七个区段 + 三个模型窗口），角色设置页可以直接照这个配方新增一个区段。
- `views/model/model-settings-draft.ts` 的草稿与序列化规则、`AgentVisibleModelsEditor`、`SavedModelsList`、`NovelIdeModelSelect` 等子组件都可复用。
- `component-lab` 的 fixture 与 smoke 断言套路（新增区段固定改六处，见 t17 README「前置事实」）。

## 验收方向（待问题定论后补成完整验收）

- Provider 页只讲 Provider 与模型清单：Providers 导轨上能新增（入口从顶部的下拉 + 按钮挪到导轨），详情里能编辑连接与模型。
- 默认模型 / Agent 可见模型各自有独立 Tab，能单独打开、单独保存。
- 角色页列出梯度轴与专精轴，每行显示当前绑定与回落链；未配置时显示回落目标而不是空白。
