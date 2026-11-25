# t19 实施计划第 1 稿的审查处理

两份并行：前端 Claude Sonnet（[报告](plan-review-frontend-sonnet.txt)，说明 [brief](plan-review-frontend-brief.md)），布局 omp `@review`（[报告](plan-review-layout-gpt.txt)，说明 [brief](plan-review-layout-brief.md)；第一轮 90 分钟截停时写了 3 条，续跑只写报告补到 7 条）。两份到齐后一起归类，改成[计划第 2 稿](../plan.md)。另收测试第 A 段子代理提出的约定缺口（[报告](e2e-segment-a-report.txt)第三节），一并列在最后。

归类按 reviewing 的四类：说明没写清 / 成立要改 / 成立但接受取舍 / 不成立。

## 前端（F1–F17）

| 编号 | 级别 | 归类 | 处理 |
|---|---|---|---|
| F1 停靠态头的去向 | 阻断 | 成立，要改（作者写错） | 停靠照旧接管面板头的标题区，只把“新对话”挪进视图段、按标题不再开列表；改 conversation 输出 44 的指引与 57 开头、`rail-states.md`；片 3b 把接管宽度改按面板头宽量 |
| F2 去掉 VIEW_HEAD 连带废掉自绘头 | 重要 | 成立，要改 | 保留 `VIEW_HEAD` 声明，`claim` 停靠恒真 |
| F3 两条侧轨后标记不唯一 | 重要 | 成立，要改 | 沿用 `data-tool-*` 现名，一律限定在 `[data-rail]` 内；不另起 `data-rail-entries`；右轨底段不带 `data-activity-items`；迁移归段 B |
| F4 ToolStrip 内部版式 | 重要 | 成立，要改 | 计划写三段高度分配、展开后两栏、提示方向、右轨不画书脊 |
| F5 roving 横跨两个所有者 | 重要 | 成立，要改 | 侧轨组件统一管 roving，成员带 `data-rail-item`；两条侧轨同一模型（Spec 输出 50 已写），左轨的 Tab 用例由段 B 迁移 |
| F6 片 3 太大 | 重要 | 成立，要改 | 拆成 3a（相连与角）与 3b（侧轨组件、去入口条、拖放、F6） |
| F7 片 5 没有可测的视图 | 重要 | 成立，要改 | 测试插件加一个声明 `VIEW_RAIL` 与位置限制的右栏测试视图 |
| F8 VIEW_RAIL 加载后才读、骨架缺失 | 重要 | 成立，要改 | `railOf` 同步读实现对象；工作台画骨架，标 `data-rail-loading` |
| F9 window 变体缺宽度与顶格、Teleport 拆除、request 时机 | 重要 | 成立，要改 | `window{width}`、顶格留空由宿主画（改 views 输出 21）；借用沿用面板头 `watchEffect` 的分发；`request` 同步判定、先提交再 resolve |
| F10 列表搜索词与 Esc | 重要 | 成立，要改 | Bot 页搜索词提成 `v-model`；`focusSearch`、`escape-search`；Lab 加 200 与 420 宽 |
| F11 最近会话刷新 | 建议 | 成立，要改 | 写明刷新时机与用例 |
| F12 拖放里的 sidebar 特例 | 重要 | 成立，要改 | 列出各处改成按轴与 id；拒绝区用 `data-drop-refuse`，在 `layoutDropOverPanel` 同一处判 |
| F13 `.md` 与 Lab 清单不全 | 重要 | 成立，要改 | 补全 `.md` 与 Lab 场景、删死分支、去掉旧物清单 |
| F14 测试分工的所有权与并发 | 重要 | 成立，要改 | 主会话不改 e2e 文件；同一时刻只一边跑；段 A 已按“只列不改”交回；标记表补最小结构；动效用例开回动效取样 |
| F15 性能与真实页面没落到步骤 | 重要 | 成立，要改 | 加片 0b 取基线；片 8 用 `layout-frames.ts`，判据 110%；3a、3b、5、7 各点一遍真实页面 |
| F16 手柄与分隔线抢命中 | 重要 | 成立，要改 | 写互斥规则与可访问名称；实现前用真实投影确认隐藏时分隔线在不在 |
| F17 标记重复与漏项 | 建议 | 部分成立 | 补漏项（骨架、`aria-pressed`、“+N”、等你处理、弱描边、当前 bot）。`data-rail-joined` 保留：它在侧轨根上给用例一个状态，Surface 的 `data-shell-join` 是区域卡片哪一边相连，两者由同一个相连判断算出，不是两份来源 |

## 布局（L1–L7）

| 编号 | 级别 | 归类 | 处理 |
|---|---|---|---|
| L1 `rail` 字段的重建路径与非致命诊断 | 阻断 | 成立，要改 | 片 1 逐个列出重建函数与 `rail` 的去向（保留、转移、清掉），各一条单测；解码结果加非致命诊断，store 不标损坏 |
| L2 位置限制的提交出口不止一个 | 重要 | 成立，要改 | 收成一个判整份文档的关卡函数，store 对最终文档判、候选与预览对模拟结果判；单测按路径逐条对真实 store |
| L3 预算覆盖被写进意图 | 重要 | 成立，要改 | 投影标出被覆盖的节点，回写跳过；片 2 加经真实 store 的往返用例 |
| L4 保留 id 与旧记录撞名 | 重要 | 成立，但接受取舍 | 应用生成的 id 不会是 `rail:` 写法，只有手写记录会撞；撞了按现有规则拒收、不覆盖原记录。记为已知限制，不加迁移 |
| L5 nb-layout 公开入口与 API 检查 | 重要 | 成立，要改 | 片 6 写明入口、入口测试、`api:report`，验证加 `api:check` |
| L6 空的合成叶不进离场队列 | 重要 | 成立，要改 | nb-layout 加宿主给的“离场保留”名单，dom 测试覆盖打断与收口 |
| L7 程序宽度过渡与 nested-grid 输出 105 冲突 | 重要 | 成立，要改 | nested-grid 输出 105 加 planned 指引：程序改宽度走过渡，手势照旧 |

## 测试第 A 段提出的约定缺口

| 缺口 | 处理 |
|---|---|
| 右轨卡片的标记 | 表里补 `data-shell-card="rail:auxiliarybar"` |
| `data-rail-joined` 按有无判 | 表里写明“不写 `"false"`” |
| 右轨的按下底块 | 沿用 `data-tool-indicator` |
| 左轨也带 `data-rail="sidebar"` | 是 |
| 入口带属性名 | 两条侧轨都用 `data-tool-band`；段 A 的 `data-rail-entries` 由段 B 改 |
| 没有落点处松手 | 按 Spec 取消、不浮出、零写入（`data-drop-refuse`） |
| 盘点里“消息视图的头不由工作台接管” | 跟着计划第 1 稿的错写的；停靠照旧接管，段 C 按第 2 稿改写对话用例 |

## 数量

24 条：成立要改 22，部分成立 1（F17），接受取舍 1（L4），不成立 0。
