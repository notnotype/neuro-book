---
标签: [env:portal, state:local, state:inject]
别名: ["模型与角色选择", "Role Model Picker"]
---

# AgentRoleModelPicker

输入框工具栏里选模型的按钮加面板，宿主给了模型角色时用它（没有角色的宿主用 [`AgentModelPicker`](AgentModelPicker.md)）。模型、角色、思考档一体。受控零件，选中后只发事件，由输入框转成 `model.set`、`thinking.set`。

## 布局与交互

- 触发器：一行文字，“角色图标 选的是谁 · 服务商图标 实际用的模型”用次要色、过长省略，档位在最后、不省略（明确选的用强调色，跟随来的用次要色），全文在悬停。选的就是模型时不重复写模型。
- 面板贴着 `anchor`（输入框）向上弹，同宽；放不下翻到下面。高度固定，两页切换不跳。
- 头部两行。第一行：当前选择（角色图标、角色名 · 服务商图标、模型），右边“角色”“模型库”两页切换。第二行：思考图标、“思考”、思考档分段、说明。
- 角色页：“跟随默认”，然后梯度角色，专精角色另起一组。每个角色一行：角色图标、角色名，右边服务商图标、绑定的模型、角色的默认档，行尾是当前项的勾。面板内容宽不到 480px 时单列，够宽时两列（容器查询）。用不了的角色仍能选，模型那一格变警告色，悬停看原因：选了之后绑定好就能用。选角色不关面板。
- 模型库页：搜索（显示名、组名、key），按服务商分组：组头是折叠箭头、服务商图标、组名与个数，行里是模型名、能力图标、窗口、单价。用不了的灰掉不能选。选模型关面板。
  - 超过 30 个的组默认收起；当前模型在这组里时只展开它前后各 10 行，下面写“显示全部 N 个”，点了才展开整组（一次渲染几百行会卡）。其他的组与不超过 30 个的组按组头点开、收起。
  - 搜索时只渲染命中项，命中的组一律展开；清空后回到默认的收起状态。清空时焦点还在被收起的行上，焦点落到那一组的组头，不掉到页面上。
  - 打开模型库时当前模型滚进可见。
- 键盘：搜索框、组头、行在同一条方向键序列里：搜索框按下进入第一个组头，向上走回搜索框；折叠组的行不在 DOM 里，不在序列里；Home、End 到序列首末（搜索框里 Home、End 是移动光标，不接管）。当前模型行带 `aria-current`。
- 思考档（`SegmentedControl` 的 raised 外观，各档等宽）：
  - 模型不推理或不能调档时没有分段，右边写原因；可调档时第一项在能真关闭时是“关闭”，只能降到最低档的模型没有“关闭”这一项。
  - 档位多于 5 个或面板窄于 400px 时分段里写缩写，全名在悬停与可访问名称里。
  - 方向键即选中（radio 组的约定）。选了立刻显示，停 200 毫秒才发一次 `select-thinking`，连选只发最后一档。
  - 跟随来的档只画细框（`inherited`），右边写“跟随主力的默认”；再选它发出 `select-thinking`（钉成明确选择）。明确选了档时右边是“用主力的默认”，点了发 `reset-thinking`。档位是未验证的梯级时右边有问号，悬停写“没写支持哪几档”。
- `canManage` 时底部有“管理模型…”，发出 `manage` 并关面板。
- 打开时焦点进面板；Esc 关闭并回到触发器；点外面关闭；`disabled` 变真时关闭。
- 钩子：`data-model-picker`（触发器）、`-panel`、`-pages`、`-search`、`-role`、`-model`、`-manage`；`data-model-picker-thinking` 在思考档分段组上（不是当前档的文字）；另有 `-effort-note`、`-reset`、`-show-all`，组头带 `data-group-head`。

## 数据

属性见组件头部：`roles`、`models`、`modelKey`、`effectiveModel`、`thinkingLevels`、`thinking`、`effort`、`groups`、`anchor`、`disabled`、`showImageSupport`、`canManage`。事件 `select-model`、`select-thinking`、`reset-thinking`、`manage`。`models` 里 key 为空串的一项是“跟随默认”，放在角色页。

- `effort`（`ComposerEffortView`）不给时按 `thinkingLevels`（含 `off` 表示能关）与 `thinking` 推出，旧宿主不用改：没有档位没有控件，一档写成“不能调档”，多于一档才有分段。
- `groups` 不给时按每个模型的 `group` 名分组；给了时模型行只带 `groupId`，组的名字与图标在 `groups` 里写一次，同名的两家分得开。
- 图标在视图里只是键（`ComposerIcon`），由宿主经 `provideAgentView` 的 `renderers.icons` 注入解析端口，在渲染时解析：图标表晚到时首字母块自动换成图标（`AgentIcon`）。

## 隐藏通道理由

- `env:portal`：面板经 `AnchoredPopover` 传送到 `body`，否则被消息流与输入框的裁剪挡住。
- `state:local`：开关、当前页、搜索词、面板宽度是纯界面状态。
- `state:inject`：翻译端口，同视图里的其它零件。
