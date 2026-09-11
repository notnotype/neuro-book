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

2026-09-10 已完成事实核查并写入提案 [`docs/proposals/model-roles-contract.md`](../../../../../docs/proposals/model-roles-contract.md)（状态 `draft`）。三条缺口的最新状态：

1. **role 的后端契约**：已给出方案——全局配置新增 `roles.bindings`（角色目录与回落链写死在代码里），解析链在 `override` 之后、profile 之前插入 role 分支。改动清单见提案「落地清单」8 步，其中最容易踩空的是 `normalizer` 的显式 allowlist 与 `redactGlobalConfig`（漏了会静默丢段，`history` 就是先例）。
2. **候选链写在哪一层**：定为全局配置的可选 `chains`，**本期只存不消费**——Pi 层只有 `maxRetries` 重试，没有模型级回退，自动回退属独立提案。
3. **本地模型**：**缺口已由现有机制覆盖**，不属后端契约。证据：`inspectRunnableModel` 只查 baseURL 不查 apiKey；空 key 走内部占位 `OPENAI_NO_AUTH_KEY`；discovery 接受 http；测试已用 `http://127.0.0.1:11434/v1` 作合法 baseURL。剩余的是产品层的「本地」分类与一键模板。

另修正一处措辞：`@writer` 在代码里不存在（`@` 只是编辑器引用菜单前缀），正式标识是 profileKey；「role 与 profile 的接线」应表述为「role 名与 profileKey 的对应关系」——两者并列，不合并。

开工前需开发者就提案里的四条「未决取舍」拍板（未配置角色怎么取模型 / 候选链是否本期实现回退 / 是否允许 Project 覆盖 / 本地模型是否要分类模板）。

## 执行进度

四步全部落地（2026-09-10）：

1. **Provider 页**：`sections/model` → `sections/providers`、`ModelSettingsView` → `ProviderSettingsView`；默认模型与可见模型两块整段移出；「新增 Provider」入口挪进 Providers 导轨底部（模板选择 + 添加，`ModelProviderRail` 底部一行），内容区不再占一整行。
2. **默认模型区段**：`sections/default-model/DefaultModelSettingsView.vue` + `.md` + fixture（6 场景）——global 选默认模型，project 为覆盖。
3. **可见模型区段**：`sections/agent-visible-models/AgentVisibleModelsView.vue` + `.md` + fixture（7 场景）——global 编辑有序清单，project 只说明「写在全局」。`AgentVisibleModelsEditor` 去掉自带卡片面与标题，由区段视图接管标题层级。
4. **角色区段**：`sections/roles/RolesSettingsView.vue` + `.md` + `roles-settings-draft.ts`（+ 5 项单测）+ fixture（5 场景）——梯度轴 4 个、专精轴 5 个角色各一行，显示用途、建议候选链、当前生效角色与绑定选择；`resolveEffectiveRole()` 沿回落链取，`vision` 不回落到任何角色。

外壳现在 9 个区段（agent-profile-models / web-tools / embedding / cost / observability / providers / default-model / agent-visible-models / roles），smoke 断言同步到 9。测试 49 文件 / 369 项通过。

内容列封顶：默认模型、可见模型、角色三个阅读型区段各自 `max-w-3xl`；Provider 页是两栏型，保持整幅宽度（外壳不封顶的约定见 t17）。

## 已知的可复用资产（t17 产出）

- `settings/sections/` 下的受控视图与 Lab 场景（外壳 + 七个区段 + 三个模型窗口），角色设置页可以直接照这个配方新增一个区段。
- `views/model/model-settings-draft.ts` 的草稿与序列化规则、`AgentVisibleModelsEditor`、`SavedModelsList`、`NovelIdeModelSelect` 等子组件都可复用。
- `component-lab` 的 fixture 与 smoke 断言套路（新增区段固定改六处，见 t17 README「前置事实」）。

## 验收方向（待问题定论后补成完整验收）

- Provider 页只讲 Provider 与模型清单：Providers 导轨上能新增（入口从顶部的下拉 + 按钮挪到导轨），详情里能编辑连接与模型。
- 默认模型 / Agent 可见模型各自有独立 Tab，能单独打开、单独保存。
- 角色页列出梯度轴与专精轴，每行显示当前绑定与回落链；未配置时显示回落目标而不是空白。
