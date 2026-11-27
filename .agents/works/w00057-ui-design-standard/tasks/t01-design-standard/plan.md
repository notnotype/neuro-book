# w00057 t01 实施计划：界面设计标准写进文档、接进审查，修掉查出的问题

## 1. Context

**为什么做**：开发者 2026-11-23 指出前端反复出三类问题：组件没有动效、细节没打磨；界面上写解释内部处理的小字；没有可遵守、可审查的设计标准。原话：“设计标准要制定并遵守，用上各种 UI 设计理论和规范来审查”。当天先补了两条（设计语言收紧说明文字规则、自检加“状态变化有动效”、UI Skill 第 5、6 条，提交 `8f4009543`），同时派子代理调研，写成草稿（本地 `.local/agent/ui-design-standard/draft.md`，不进 Git）。

**草稿内容**：对照 NN/g 十条与几篇专题、WCAG 2.2、Apple HIG（动效、反馈、写作、无障碍）、Material 3 的转场模式、格式塔（接近、相似、共同区域）、费茨与希克定律、Butterick 的排版，做了差距分析，提出约 30 条能判对错的条目（编号 FB 反馈、MO 动效、TX 文案、LY 布局、TG 可点区域、AX 可达性、PL 打磨），每条写判据、依据、怎么查，并给出落点表与可贴进前端审查说明的“固定检查”。

**开发者已确认的决定**（2026-11-23，对草稿第四节 11 项回复“都同意”，即全按推荐）：

| # | 决定 |
|---|---|
| D1 | 减弱动效时位移、缩放、模糊换成淡入淡出：保留 `--motion-fast`、`--motion-base` 的颜色与透明度过渡，其余归零（MO-7） |
| D2 | `--text-muted` 调到 4.5:1 以上，内置配色加对比度用例挡回归（AX-1） |
| D3 | 焦点指示修到 3:1；亮色输入框边框（约 1.4:1）不改，记为已知偏离（AX-2） |
| D4 | `Button` 的 `variant` 缺省改成 `secondary`：先给现有没写 `variant` 的用法显式补 `primary`（行为不变），再改缺省，再逐处判断哪些不该是主按钮（LY-3） |
| D5 | 加载指示维持约 200 毫秒延时出现，加“出现后至少停留 400 到 500 毫秒”（PL-2） |
| D6 | 组间距规则（LY-1 的“至少差一倍”）先量现有界面再定阈值 |
| D7 | 不换 Material 3 的时长刻度，只借四种转场模式作配方词汇（MO-5） |
| D8 | MO-1（`.md` 写出状态之间的过渡）只管新建与改动的组件，不一次性补齐 |
| D9 | WCAG 以 AA 为门槛；AAA 的 2.4.13、2.5.5 只作设计目标 |
| D10 | 不另起新文件，按落点表拆进已有文档；设计语言加一张“依据的设计理论与规范”来源表 |
| D11 | `lab:shot` 新增的机检（目标尺寸、文字间距、媒体参数）先只报告，不阻断 |

**工作方式**：一个 worktree `.worktree/w00057-t01`，分支 `feat/w00057-t01-design-standard`；文档与代码在同一分支，合入后在 master 上改 Skill 与 Task 记录。草稿只是起点：进仓库前把引用的原文与数字再核一遍。

## 2. 技术选型

| 问题 | 选用 | 理由；否决 |
|---|---|---|
| Button 补 `variant` 的批量迁移 | `@vue/compiler-sfc` 解析模板 AST，按偏移量插入属性 | 多行标签、别名导入（`NbButton`）、`v-bind` 展开都要认；否决正则（462 处标签里很多跨行） |
| 对比度计算 | 复用应用里的 `ui/theme/color.ts` 与 `contrast-checks.ts` | 已有 WCAG 公式与半透明叠色；否决另写一份 |
| 目标尺寸与文字间距的机检 | 加进 `lab:shot`（Playwright 已在用）与 Lab 的 `window.__nbLab` 测量 | 与现有溢出测量同一出口；否决引入 axe-core（它的 target-size 规则不算本库的标签可点、浮层层级，误报多，且多一个依赖。查过即可再定） |

## 3. 关键设计

### 3.1 文档：`packages/nb-ui/docs/design-language.md`、`ui-development-spec.md`，`docs/standards/code/{frontend.md, components.md}`，`docs/testing/README.md`

按草稿第三节的落点表写，每条写判据、依据（出处一句）、怎么查；已有的条目只链接不重写。要点：

- 设计语言开头加“依据的设计理论与规范”一节：来源表（出处、管哪几条），不抄原文。
- 新节：“反馈与等待”（FB-1、FB-2、FB-5）、“七、动效”下的“动效的行为”（MO-2、MO-3、MO-4、MO-6）与转场四模式总表（MO-5）、“分组与层次”（LY-1 到 LY-4）；“四、排版”加 PL-3、PL-5，“三、几何”加 PL-4，“五、颜色角色”加对比度一段（AX-1、AX-2，含 D3 的已知偏离），“六、无障碍”加 AX-3 到 AX-5 与 MO-7。
- 改写：“界面不靠说明文字解释自己”加三类表（TX-1：约束与后果常驻、补充解释进说明图标、内部处理进注释）；动效小节标题“时长只有三档”改成与表一致；自检“状态变化有动效”的例外改成指向 MO-4。
- 开发规范：第 5 节加停用原因（FB-3）、结果播报（FB-4）、“可点区域与焦点”一组（TG-1 到 TG-4）；“4.1 状态下限”补空态与四态场景（TX-5、PL-1）；新增“4.8 界面文案”（TX-2 到 TX-4）。
- 前端规范“加载与流畅性”第 7 条补最短停留（PL-2，D5）；`components.md` 组件文档的“状态”一项补“写出状态之间的过渡”（MO-1，D8 的口径）；测试 README 的“UI 验收分档”共享基础组件一行加减弱动效与减弱透明度截图（AX-4）。
- LY-1 的数值阈值等 3.6 的测量结果出来后再写（D6）。
- 出处复核：派一个 Sonnet 子代理按来源表逐条打开原文，核对引号里的句子存在、条目号与级别（AA、AAA）正确，报告不一致的；它读不到的页面由主会话 `curl` 补读。

### 3.2 令牌：`packages/nb-ui/themes/{nbook,macos}/colorways.ts`、`packages/nb-ui/src/tokens.css`

- `--text-muted`（D2）：nbook 亮色在 `--bg-main` 上现在约 2.99:1、`--bg-panel` 上约 3.57:1，暗色 4.22:1；macos 两套一并算。调到对它实际所在的四个底（`--bg-main`、`--bg-panel`、`--bg-sidebar`、`--bg-hover`）都不低于 4.5:1，色相不变、只动明度。调完截图对比次要文字与正文的层次，层次塌了交开发者看。
- 焦点（D3）：`--focus-ring` 最内一圈从 1 像素、35% 的强调色改成 2 像素的实色 `--focus-outline`，外面的淡晕保留；改完量无边框控件（ghost 按钮、行）聚焦前后的像素比值，达到 3:1。`.nb-ui-focus-ring-inset` 已约 3.3:1，不动。
- 减弱动效（D1）：`prefers-reduced-motion: reduce` 下只把位移类时长归零，`--motion-fast`、`--motion-base` 保留；用到 `scale`、`translate`、`blur` 的配方（`.nb-ui-popover-motion`、内容换页、页边批注等，实施时 grep `transform`、`translate`、`scale`、`filter` 列全）在同一媒体块里去掉变换、只留透明度。先列清单再改：哪些配方拿 `--motion-fast`、`--motion-base` 做了位移，漏掉的会在减弱动效下仍有小幅缩放。

### 3.3 对比度用例：`packages/neuro-book/src/ui/theme/`

在 `contrast-checks.test.ts` 旁加 `builtin-colorways-contrast.test.ts`：经 `@notnotype/nb-ui/themes/*` 的公开入口读四种组合（nbook、macos × 亮、暗）的配色，用 `checkContrast` 断言文字类变量全部 `ok`；再加控件色对的 3:1（选中态、焦点外框；输入框边框按 D3 列为已知偏离，用例里写明跳过的理由）。`theme-packages.test.ts` 里“不做对比度判定”的注释改为指向这条用例。

### 3.4 Button 缺省（D4）：`packages/nb-ui/src/components/controls/Button.{vue,md}`

- 迁移脚本放在仓库外的临时目录：遍历工作区所有 `.vue`（不含旧应用），找出从 `@notnotype/nb-ui` 导入的 `Button`（含别名），模板里没有 `variant`、`:variant`、`v-bind` 展开的标签插入 `variant="primary"`；TS 里的 `h(Button, …)` 同样处理（目前看到的都写了 `variant`）。先 dry run 列出全部命中（文件、行、标签原文）并核对数量，再统一写入；`v-bind` 展开的逐处人工看。
- 再把缺省改成 `secondary`，同步 `Button.md` 与 `migration-0.4.md`（nb-ui 公开接口的变化）。
- 再逐处判断：按区域（对话框、面板头、工具条、卡片）数 `primary`，一块区域多于一个的列成清单，明显不该是主按钮的改成 `secondary`；拿不准的截图交开发者。

### 3.5 加载不闪（D5）：`packages/nb-ui/src/composables/`

新增 `useDelayedVisibility(source, {delay = 200, minVisible = 400})`：`source` 为真后等 `delay` 才显示；显示后至少停留 `minVisible` 才隐藏；`source` 在 `delay` 之内变回假则始终不显示。时钟可注入（测试用手动时钟，按测试规范不用假计时器）。现有的延时显示（`DataTable` 的 `LOADING_DELAY`，以及实施时 grep `Spinner`、区域级 `role="status"` 找到的外壳加载）改用它。

### 3.6 测量与机检：`packages/neuro-book/scripts/lab-shot.ts`、Lab 的 `window.__nbLab`

- LY-1 摸底（D6，先做）：在 e2e 环境的 Lab 里量设置窗口与模型服务商详情两处的组内、组间间距，出截图与数字交开发者定阈值。
- `lab:shot` 加三项只报告（D11）：目标尺寸（TG-1，按 WCAG 2.5.8 的 24 像素圆间距例外，关联 `<label>` 的盒子算进可点区域）、`--media reduced-motion|reduced-transparency`（AX-4）、文字间距注入后的溢出（AX-5）。报告里分开列，不影响退出码。`docs/specs/ui/component-lab.md` 的 `lab:shot` 一条补这三项。
- 全量跑一次，条数与误报归类存证据；已知的 `IconButton` `2xs`（`AgentRequestDetail.vue` 两处 14×14）改成满足 24 像素圆的间距或换档。

## 4. Spec 与文档改动

- `docs/specs/ui/component-lab.md`：`lab:shot` 的三项报告。
- `docs/specs/theme/editor.md`：只在内置配色对比度用例改变输出 14 的说法时改。
- 其余见 3.1。合入后在 master 上：`.agents/skills/ui-development/SKILL.md`“三、UI 专属检查”末尾放草稿第三节的“固定检查”十条（改成指向仓库内的小节），替换第 6 条最后一句；`reviewing` Skill“领域专项”的“界面与组件”一行指向它；CHANGELOG。

## 5. 切片

| 片 | 内容 | 对应 | 提交边界与自跑验证 |
|---|---|---|---|
| S0 | LY-1 摸底与截图，交开发者定阈值；同时派出处复核 | 3.6 首条、3.1 末条 | 不提交代码；结果进 Task 证据 |
| S1 | 文档条目（LY-1 阈值除外） | 3.1 | 一个提交；`bun run docs:check`、`bun run governance:check` |
| S2 | 令牌与对比度用例 | 3.2、3.3 | 一个提交；nb-ui 与应用的主题测试、`test:affected` |
| S3 | Button 迁移：补 `primary` 一个提交（行为不变），改缺省一个提交，逐处判断一个提交 | 3.4 | 每个提交后 typecheck、`test:affected` |
| S4 | 加载不闪 | 3.5 | 一个提交；composable 单测、`DataTable` dom 测试 |
| S5 | `lab:shot` 三项报告与 `IconButton` 处理 | 3.6 | 一个提交；全量 `lab:shot --no-fail` 出报告 |
| S6 | 前端实现审查（Sonnet），处理发现，变异检查 | 全部 | 修正单独提交 |

## 6. 验收映射

- MO-7（D1）：新 e2e 用 `emulateMedia({reducedMotion: "reduce"})` 打开 Lab 的浮层与内容换页场景，读计算样式：变换类过渡时长为 0，透明度过渡不为 0。
- AX-1、AX-2（D2、D3）：3.3 的用例；焦点环另在 e2e 里聚焦一个 ghost 按钮，截图取环上与相邻像素算比值不低于 3:1。
- LY-3（D4）：`Button` dom 测试断言不写 `variant` 时是 `secondary`；迁移后 Lab 场景比对没有新的版面差异（行为不变的那个提交）。
- PL-2（D5）：composable 单测四种时序（`delay` 内结束不显示、刚显示就结束仍停够 `minVisible`、长请求照常、反复切换）。
- `ui/component-lab` 的 `lab:shot` 新条目：在溢出测量的同一组用例里加一个 14×14 的密排按钮场景，报告列出它、退出码仍为 0。

## 7. 验证

- 每片：typecheck、`bun run test:affected`。
- 合入前跑一次的 e2e：`e2e/lab-scenes.e2e.ts`（令牌与 Button 缺省影响全体组件的版面；ThemeEditor 的 404 是原有失败）、`e2e/themes.e2e.ts`（配色变化；241、397、601 是原有失败）、新加的减弱动效与焦点 e2e、`e2e/settings.e2e.ts`（设置窗口按钮最多）。实施中只重跑新 e2e 与失败项。
- 给开发者看：`--text-muted` 调整前后、焦点环前后、减弱动效下的浮层，各在 nbook 与 macos 的亮、暗下截图（亮色在前）。
- 未验证边界：macOS、Windows 系统级“减弱动效”“增强对比度”开关只在浏览器模拟里测，不在真机上开。

## 8. 不做与风险

- 不做：既有组件一次性补齐 MO-1 的过渡清单（D8）；输入框边框加深（D3）；换 M3 时长（D7）；AX-5、TG-1 转成阻断（D11，跑一轮看误报再定，另开 Task）；`prefers-contrast: more` 下的边框替换（D3 只要求记为已知偏离）。
- 风险：`--text-muted` 加深后次要文字与正文的层次变弱，靠截图交开发者判断，必要时用字号或字重补；Button 改缺省后漏迁移的地方会从实底变成次按钮，由 dry run 的数量核对与 Lab 场景比对兜底；减弱动效下漏掉的变换配方由 3.2 的 grep 清单与 e2e 兜底。
