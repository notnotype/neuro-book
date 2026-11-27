---
schema: nbook.task/v2
taskId: t01-design-standard
status: done
updated: 2026-11-27
---

# 设计标准写进文档、接进审查，修掉查出的问题

## 目标与范围

开发者 2026-11-23 要求制定设计标准并接进审查（前端反复出现没有动效、细节没打磨、界面写说明文字）。按调研草稿把 NN/g、WCAG 2.2 AA、HIG、M3 转场模式等翻译成能判对错的条目，拆进 nb-ui 设计语言与开发规范、前端规范，接进 UI Skill 与前端审查说明；并修掉查出的问题：`--text-muted` 对比度、焦点指示、`Button` 缺省 `primary`、减弱动效全部归零、加载指示闪烁、`lab:shot` 加只报告的三项机检。草稿第四节 11 项开发者全按推荐通过，见 [plan.md](plan.md) 的 D1 到 D11。

合同：`ui/component-lab` 的 `lab:shot` 加三项报告；nb-ui 的 `Button` 缺省 `variant` 改为 `secondary`（公开接口变化，进 migration-0.4.md 与应用 CHANGELOG 的“不兼容的改动”）；减弱动效的行为改了（`files-explorer` 输出“动画”、`page-agent` 输出 10 的措辞跟上）。

## 当前状态

已合入 master（合并提交 `78832eecf`，分支 `feat/w00057-t01-design-standard`；之后在 master 上补了 Spec、Skill、CHANGELOG 与本记录）。worktree 与分支已删除。

### 做了什么

- **文档（S1，`557e872f9`）**：设计语言开头加“依据的设计理论与规范”来源表；新节“反馈与等待”“分组与层次”“对比度”“进出方向与来处一致”“动效的行为”；“界面不靠说明文字解释自己”改成三类表；动效小节标题改成“时长按语义选”。开发规范加“4.8 界面文案”、第 5 节第 8 到 12 条（停用原因、结果播报、可点区域与焦点）、“4.1”的空态与四态场景。前端规范、组件规范、测试 README 各补一句。引文由 Sonnet 子代理逐条打开原文核对（[source-check-sonnet.txt](evidences/source-check-sonnet.txt)）：数字与条目号全对，6 句引文原文里没有、几处依据比原文宽；进仓库的文档不抄英文原文，超出原文的写明是本库的口径。
- **组间距（D6）**：量了设置窗口、模型服务商详情与网络页（[ly1-spacing.txt](evidences/ly1-spacing.txt)），请 Gemini 当顾问（[ly1-gemini-advice.txt](evidences/ly1-gemini-advice.txt)），开发者 2026-11-27 定：组内最大间距的 2 倍不超过组间最小间距，组标题到第一行不大于行距，已有边框或分隔线的不卡，只管最内两层。设置窗口与网络页的组标题收了 2px。
- **配色与焦点（S2，`251651518`）**：内置配色加对比度用例（`builtin-colorways-contrast.dom.test.ts`，与主题编辑器同一段计算）。查出的比草稿多：除 `--text-muted` 外还有状态色文字、悬停底上的强调文字、主按钮的蓝底白字（3.92 到 4.02）。都调到 4.5 以上；亮色强调蓝 `#007aff` → `#076ce1` 由开发者 2026-11-27 拍板。改前改后截图在本地 `/tmp/w00057-t01/compare/`，层次没有塌。焦点环最内圈改成实色 2px 的 `--focus-outline`，总外扩仍 3.5px（`lab:shot` 的光晕被裁判据不变）；亮色输入框边框按 D3 记为已知偏离，写进设计语言。
- **减弱动效（D1）**：`tokens.css` 只把有位移的时长归零，`--motion-fast`、`--motion-base` 与悬停显隐的 `--motion-reveal-*` 留给淡入淡出。位移的配方逐处把起点与终点收成同一个值，按下与悬停的缩放原子类在 `styles.css` 一处收成 `scale: none`，浮层与侧栏关键帧同名覆盖成只有透明度，对话框不从来处长出来。代码里拿 fast、base 是否为 0 判断“减弱动效”的（ExplorerTree）改看 `--motion-move`。
- **Button 缺省（S3，`85939b03c`、`53709f9e4`、`64c4ad482`）**：脚本按模板 AST 给没写 `variant` 的 56 处补 `primary`（另手改 2 处），再把缺省改成 `secondary`。按区域数主按钮，同一屏两个主按钮的只有 nb-story 设置页冲突提示的“重新载入”，改成次按钮。合入时在合并后的树上重跑试跑，0 处遗漏。
- **加载不闪（S4，`9fb6f22e6`）**：nb-ui 加 `useDelayedVisibility`（200ms 后出现、出现后至少停 400ms，计时器可注入），DataTable 改用它。应用里别的区域加载指示（31 个文件用 `Spinner`）多数连 200ms 延时都没有，这次没逐个改，记为后续。
- **lab:shot（S5，`c518d2272`）**：`--media reduced-motion,reduced-transparency`、`--text-spacing`；`measure()` 加 `smallTargets`、`clippedText`。都只报告，不改退出码。请求详情查找条的上下箭头从 14px 改成 24px。

### 审查

前端实现审查派 Claude Sonnet（说明见本地 `/tmp/review-w00057-t01-impl/brief.md`，报告 [impl-review-sonnet.txt](evidences/impl-review-sonnet.txt)）：16 条，重要 3、建议 13。处理见 [impl-review-disposition.md](evidences/impl-review-disposition.md)，修正在 `6eb51de84`。最要紧的一条：第一版在 components 层用 `* { transition-property: … !important }` 统一收位移，几项时长不同的过渡会按下标错配、透明度拿到 0，组件自己也盖不过它；改成逐处收位移值。nb-layout 仍把四档都归零（落点框拿 base 做位置过渡），按审查第 4 条记为后续。

变异检查：单元层 6 处，5 处被抓到，1 处是等价变异（见处理记录）。

### 验证

- 类型检查：nb-ui、nb-layout、nb-agent-ui、dev-panel、nb-story、应用都通过。
- `test:affected --since master`：与本 Task 有关的全过。失败项逐条分辨：nb-ui 的 `Tabs.vue` 字面颜色、应用 SDK 导出面两条（`PopoverReference` 等、nb-layout `NestedGrid` 快照）在 master 上同样失败；其余是负载 17 到 30 下的 5 秒超时（dev-panel 真实 herdr、nb-harness、nb-story 命令行、应用两条），单独重跑时失败的用例每次不同。
- e2e（`NB_E2E_WIDE`，9 个文件）：191 过、15 挂。挂的里面：themes 241、397、601（四条）、files-explorer:629（菜单项被盖住 2 个）、lab-scenes 的 ThemeEditor 404 是已知原有的；settings:242 是本 Task 改了行为（减弱动效下设置窗口原地淡入），改了期望后通过（`541d0360a`）；editor-area 2209、2303，files-explorer:241，themes:489，settings:808 单独重跑通过或一过一挂（已知的负载偶发）；settings:773 在分支起点的对照 worktree 上同样两次都挂（冷启动的开发服务在负载下起不来）。lab-shot 的 9 条（含新加 3 条，修正后加到 10 条）通过。
- 因为 ThemeEditor 的 404 挡在前面，lab-scenes 的版面比对这次没跑到；配色、焦点环与按钮缺省对各组件版面的影响只按截图抽看了设置窗口与模型服务商详情。

### 未验证与后续

- nb-layout 在减弱动效下仍四档归零，与 nb-ui 不一致；放开要先收落点框的位置过渡，并改 nested-grid Spec 输出 59、142。
- 应用里区域级的加载指示多数没有延时与最短停留，按 `useDelayedVisibility` 逐个改。
- `lab:shot` 三项新报告还没全量跑一轮看条数与误报（D11 说先报告、看误报再定阻断），下一次大范围 Lab 截图时一起跑。请求详情查找条的页签小按钮（`.ard__find-page`）也偏小，等报告出来一起看。
- editorial、aurora 两套示范主题的焦点环与对比度不在用例里。
- 真机上的系统“减少动态效果”“增强对比度”开关没试，只在浏览器模拟里测。

## 下一步

无。后续项进 Work 的记录，开发者挑了再开 Task。
