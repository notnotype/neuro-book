---
标签: [env:portal, state:local, state:inject]
别名: ["模型与角色选择", "Role Model Picker"]
---

# AgentRoleModelPicker

输入框工具栏里选模型的按钮加面板，宿主给了模型角色时用它（没有角色的宿主用 [`AgentModelPicker`](AgentModelPicker.md)）。模型、角色、思考档一体。受控零件，选中后只发事件，由输入框转成 `model.set`、`thinking.set`。

## 布局与交互

- 触发器：一行文字，“选的是谁 · 实际用的模型”用次要色、过长省略，档位用强调色、不省略，全文在悬停。选的就是模型时不重复写模型。
- 面板贴着 `anchor`（输入框）向上弹，同宽；放不下翻到下面。高度固定，两页切换不跳。
- 顶部写当前选择，“角色”“模型库”两页切换；档位多于一个时有滑块，档位文字宽度固定，滑块不动。
- 角色页：“跟随默认”，然后梯度角色两列，专精角色另起一组。用不了的角色仍能选，模型那一行变警告色，悬停看原因：选了之后绑定好就能用。选角色不关面板。
- 模型库页：搜索（显示名、组名、key），按组列模型，右侧能力图标、窗口、输入与输出单价。用不了的灰掉不能选。选模型关面板。
- `canManage` 时底部有“管理模型…”，发出 `manage` 并关面板。
- 打开时焦点进面板；Esc 关闭并回到触发器；点外面关闭；`disabled` 变真时关闭。

## 数据

属性见组件头部：`roles`、`models`、`modelKey`、`effectiveModel`、`thinkingLevels`、`thinking`、`anchor`、`disabled`、`showImageSupport`、`canManage`。事件 `select-model`、`select-thinking`、`manage`。`models` 里 key 为空串的一项是“跟随默认”，放在角色页。

## 隐藏通道理由

- `env:portal`：面板经 `AnchoredPopover` 传送到 `body`，否则被消息流与输入框的裁剪挡住。
- `state:local`：开关、当前页、搜索词、面板宽度是纯界面状态。
- `state:inject`：翻译端口，同视图里的其它零件。
