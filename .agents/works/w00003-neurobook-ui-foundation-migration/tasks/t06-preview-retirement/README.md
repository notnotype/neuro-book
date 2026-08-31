---
schema: nbook.task/v2
taskId: t06-preview-retirement
role: tasker
---

# 保留 preview 场景数据并删除 preview 页面

## 已顺延

原为 t05，未开工即由开发者顺延。原因是范围过大，且 Lab 更需要先建起来。清退本身没有取消——14 个 preview 页面目前随产品一起发布（从构建配置读出，未跑构建验证），仍须清理。

顺延后本 Task 多了一个前置好处：[t05 建 Lab](../t05-component-lab/README.md) 会先做出产物门禁，届时 preview 页面为什么会被发出去这件事已经查清，清退不必再重新调查一遍。

## 目标

在删除 14 个 preview 页面之前，先把其中可复用的确定性演示数据提取为结构化证据，再删除页面本身及其专属资源，使产品不再随发布带上开发页面。

## 前提已核实

开发者判断 preview 页面已无使用价值。执行前已静态核实：t01 标为「真实行为」的功能均存在正式入口，删除页面不会使任何功能失去访问路径。

- Model Settings 面板由 `NovelIdeSettingsDialog.vue` 挂载。
- Profile 可视编辑器由 `UserProfileWorkbenchDialog.vue` 挂载，后者由 `app/pages/index.vue` 使用。
- World Engine 在活动栏与工具面板均有入口。
- Workflow 运行在 Agent 侧有完整渲染，包括工具气泡、待定面板与渲染注册表。

上述结论来自静态引用查找，未经浏览器验证。执行时重新核对一次，出现与此不符的情况即停止并报告，不按本 Task 继续删除。

## 允许改动

- 新增 `evidences/`：从 14 个 preview 页面提取的确定性演示数据与场景说明。至少覆盖 t01 记录的可复用样本，包括 diff 的 7 份文档、timeline 的 3 个阶段、dnd 的卷与章两种结构，以及其余 demo 场景的输入形状与预期结果。数据脱敏，不含真实用户内容。
- 删除 `packages/neuro-book/app/pages/` 下 14 个 `*preview.vue` 页面，以及仅为它们存在的样式、mock、路由链接与控制器片段。
- 删除因页面移除而不再有任何调用方的代码。有其它调用方的一律保留。

## 场景来源

页面集合使用 `packages/neuro-book/app/pages/*preview.vue`，精确 14 个。窄化为 `*.preview.vue` 会漏掉 `world-engine.workbench-preview.vue`，不使用该写法。精确清单与 31 个场景的标识、分类见 [t01 的场景基线](../t01-migration-design/evidences/preview-scenario-baseline.json)。

## 提取标准

提取的是数据与场景意图，不是页面实现。每条记录说明：属于哪个组件、输入是什么、初始状态、可执行的动作、预期可观察结果。这些记录将来直接用于 Lab 的 fixture，因此不复制页面的布局代码、样式或组件挂载方式。

t01 标为「真实行为」的 5 个场景不提取数据，它们依赖真实接口与真实模型，不能表达为确定性输入；只记录其正式入口位置。

## 开发者参与

出现某个 preview 页面是唯一入口、或删除会牵动仍在使用的代码时，由开发者决定保留还是继续删除。Agent 负责引用查找与影响清单，不自行扩大删除范围。

## 验证

1. `bun run --cwd packages/neuro-book typecheck`。
2. 与删除表面相关的聚焦测试。
3. 全仓静态查找确认 14 个页面路径、导航链接与专属 mock 均无残留引用；普通业务词 `preview` 不作为判据。
4. 启动开发入口确认主页面与设置、Profile、World Engine、Agent 四处正式入口仍可打开。

## 完成门禁

- 14 个页面文件与其专属资源全部删除，无残留引用。
- 提取的场景数据可独立阅读，不依赖已删除的页面才能理解。
- 有其它调用方的组件与代码一处未删。
- 未运行或未授权的项目标注为未验证。

## 固定依据与非目标

- 现状证据：[t01 迁移设计](../t01-migration-design/README.md) 与其场景基线。
- Lab 边界：[`docs/specs/ui/component-lab.md`](../../../../../docs/specs/ui/component-lab.md)。

本 Task 不建立 Lab、不编写 fixture、不迁移任何组件、不修改主题、不新增正式界面入口，也不执行 push、PR、远端写入、合并、发布或部署。
