# t05 实施计划：nb-ui 规范文档整理

## Context

- **为什么做**：nb-ui 的规范与代码已经不一致，读者照文档写会写错。`ui-development-spec.md` 有近一半篇幅逐个复述组件参数，与同名 `.md` 重复且互相冲突；`design-language.md` 有和现状相反的判据；README 的示例不能编译。
- **输入**：[审查报告](evidences/spec-review.txt)（10-20，43 条，下称报告，条目 F01 到 F43）与开发者 10-20 的三项决定（见 [Task README](README.md) 的“下一步”）。w00030 完成后，前置都已满足。
- **2026-11-04 按当前 master 重新核对**（用报告里的特征文字搜索）：

| 状态 | 条目 |
|---|---|
| 已解决 | F10、F43（w00030 t03）；F18 的 Button（w00030 t04 改取 `--control-h-*`，IconButton 定值，理由已写进规范） |
| 仍然成立 | F01、F02、F03、F04、F05、F06（数值变了：nbook 现在是 10px，DL 还写 12px）、F07、F08、F09、F11、F12、F13、F14、F15、F17、F19、F20、F21、F22、F23、F26、F27、F29、F33 等，特征文字都还在 |
| 变了形状 | 新增的 4.6、4.7、`migration-0.4.md` 也用章节锚点；SPEC 现 466 行，DL 现 1334 行，同名 `.md` 60 份。开工时报告里的行号全部作废，以特征文字定位 |
| 报告留作另议 | `packages/nb-ui/PROJECT-STATUS.md` 还是 T149 的快照。治理检查要求自治包有这个文件（`scripts/ci/agent-governance-contract.ts`），所以重写，不删 |

- **工作方式**：worktree `.worktree/w00029-t05-docs`，分支 `docs/w00029-t05-nb-ui-docs`。`docs/specs/`、`docs/proposals/` 与 Task 记录在主工作区 master 上改。只改文档与注释，不改组件行为。

## 原则

沿用报告的原则：一条规则只在一处写；数值只在 token、CSS、主题 `vars.css` 与同名 `.md` 里；规范写角色、判据与选型。文档和代码不一致时以代码为准，除非代码是错的；发现代码错了不在本 Task 修，记下来报告。

## 关键设计

### 1. `packages/nb-ui/docs/ui-development-spec.md`（工程合同）

目标结构：

1. 事实源：加“组件行为与能力标签：同名 `.md`”，删 `src/theme/contracts.ts` 一行（F12、F32）。
2. 材料、颜色与层级：第 1 到 6 条的序号不变（已接受的 `nb-ui-surface-model` 提案按序号引用）。2.1 叠放层级原样保留。新增 2.2 浮层外框：一张表写浮层种类用哪个类（小提示、弹出列表、气泡与命令面板、对话框、浮动窗口），吸收原 4.2 第 16 项与第 9 节，数值不进表。去掉 Tier 1 到 4 与 Tier 2.5（F19、F20）。
3. 几何、排版与动效：第 4 条拆成一条一行（F38），应用页面的规则（多 Tab 共享 Header）随受控视图搬到 `frontend.md`（第 4 节）；吸收第 8 节里不重复的按压缩放与位移（F35）。
4. 组件合同：
   - 开头指向同名 `.md` 与 `components.md`，透传属性的写法保留；
   - 4.1 状态下限（骨架规则按第 2 节改写）；
   - 4.2 同类零件的分工（原 4.5，提前，读者先选组件）；
   - 4.3 取值词表与文案属性（原 4.6）；
   - 4.4 浮层的打开与关闭（原 4.7，吸收 QuickPick 条目里的关闭交接）；
   - 4.5 弹出列表的共同合同（行结构、`MenuRow`、截断与 `usePopupScroll`、`useMenuCascade`、`roving.ts`，含 w00029 t04 定下的列表项样式；这些跨六个组件，留在规范）；
   - 4.6 滚动条：一张三行表（弹出列表、工作台视图、其它容器各用什么），加 token 与单层滚动权（F24）。
5. 表单与无障碍：通用规则留下；控件合同链到 `docs/specs/ui/forms.md`（第 3 节决定）。
6. 测试与交付：改掉 `/components` 与“阶段 2”（F14、F34）。
7. Component Lab：缩成一条加链接（F31）。
8. 开发后自检：全仓唯一一份检查表，每条一行并指向规则出处；吸收 DL 第九节里不重复的条目（F27）。Agent 工具卡片一条依赖旧应用路径，删除或改到 Agent 对话视图的 Spec，开工时核对。

原 4.2 的 17 项逐项处理：跨组件的规则留在上面的小节；单组件的内容和同名 `.md` 比对，`.md` 没有且代码属实的并进去，和代码不符的丢弃。每项的去向记进 `evidences/spec-migration.txt`（条目、去向、是否与代码核对），规则不能悄悄消失。代表项：`Splitter` 与拖放反馈约 30 行并进 `Splitter.md`、`DropFeedbackOverlay.md`；`Checkbox`、`SegmentedControl`、`Badge`、`Popover` 基本是过时内容，核对后丢弃。

### 2. 文档与代码的判据（报告列出的“谁对”）

| 问题 | 处理 | 来源 |
|---|---|---|
| 投影几层 | 保留多层，文档写角色，不写数值 | 开发者 10-20 定（F04） |
| 暗色玻璃 | 保持 `brightness(1.0)`，坑 7 判据改为“暗色档要有自己的配方” | 开发者 10-20 定（F05） |
| 浮层外观的来源 | 只认 CSS 类 | 开发者 10-20 定，代码已改（F43） |
| 页面级加载不画骨架，书架页却在用 | 改写规则：结构还不知道时不画骨架；结构已知（书架的卡片格）可以用 `Skeleton`，装饰性、读屏听文字 | 待确认 1 |
| DL 说按钮是整颗胶囊，代码不是 | DL 按现状改，Apple 的胶囊实测移到调研文档 | 待确认 2 |

### 3. `packages/nb-ui/docs/design-language.md`

- 一到七节：按上表改；比较表不抄主题数值（F28）；“当前实例”换成新应用的实例或去掉（F37）；超椭圆只留“目前未使用”（F29）。
- 第八节：删已删组件与 UnoCSS 时期的条目，或改成不依赖具体组件的写法（F26）；调试过程的复述收成判据。**坑号不重排**（待确认 3）。
- 第九节：删除，不重复的条目并进 SPEC 第 8 节（F27）。
- Apple UI Kit 读数、对话框实测表、平台引用移到 `docs/research/`，DL 留结论与一行链接（F41）。调研文档只写事实，不写推荐。

### 4. 受控视图（原 4.3、4.4）搬到 `docs/standards/code/frontend.md`

这两节是应用的数据流，不是 UI 库规范，但已接受的 `workbench-view-host` 提案继承它们，所以搬不删（F11 更正）。去掉只在旧应用的实例名、Nuxt 与旧 i18n 键，规则保留。提案正文冻结，在决策记录追加一行说明新位置（待确认 4）。

### 5. 其余文档

| 文档 | 改什么 | 条目 |
|---|---|---|
| `docs/authoring-themes.md` | 删组件替换残留、透明度规范一节；实物参照不写数量 | F12、F13、F39 |
| `docs/README.md` | 缩成目录；受管组件范围只链 `components.md` | F33 |
| `README.md` | 删迁移公告与组件替换示例；组件清单留分组与一句话，链同名 `.md`；统一中文（待确认 5）；Tooltip 与端口说明改对 | F12、F14 到 F17 |
| `AGENTS.md`、`PROJECT-STATUS.md` | 删阶段 2、3 与 `/components`；状态页重写成现状，去掉 T149 快照 | F14、F34 |
| `docs/standards/code/components.md` | 改适用范围与旧应用范例；Fixture 一节并入 Lab 的 fixtures README | F30 |
| `.agents/skills/ui-development/SKILL.md` | 只留路由；删对 SPEC 的概括与“50+” | F16、F30 |
| `docs/specs/ui/forms.md` | 第 224 行的“并入”改成“SPEC 第 5 节链到这里” | 待确认 6 |

### 6. 入链与注释

- 按特征文字清点全部入链，改标题或锚点：组件 `.md` 四处 `#45-…`、`migration-0.4.md`、`ui-development` Skill、`frontend.md`、Lab 的两处注释、`close-handoff.ts`（路径与 `§4.2.18` 都错）、DL 自引。
- 注释里的评审代号一并清掉（BH1-C、方案 2、S4、黄金、N.5），`themes/editorial/manifest.ts` 的过时注释（F39、F42）。
- 已接受提案的章节号引用：`nb-ui-surface-model` 的第 2 节序号不变，不用动；`workbench-view-host` 见第 4 节。

## 切片

| 片 | 内容 | 验证 |
|---|---|---|
| S1 | 原 4.2 逐项核对，并入同名 `.md`，`spec-migration.txt` | `docs:check`；抽查核对记录 |
| S2 | SPEC 其余小节重排；受控视图搬到 `frontend.md` | `docs:check`、`governance:check` |
| S3 | DL 改判据、第八节清理、删第九节、调研文档 | 同上；按特征文字复查 F04、F05、F26、F27 |
| S4 | README、主题指南、目录、AGENTS、状态页、组件规范、Skill、`forms.md`；提案决策记录 | 同上 |
| S5 | 入链与注释 | 同上；确认源码 diff 只有注释（去注释后相同）；`bun run test:affected --since master --typecheck` |
| S6 | 审查：`doc-review` 看读者能否照做；Sonnet 按报告逐条核对文档与代码；处理后合入 master | `docs:check`、`governance:check` |

## 验收映射

| 判据 | 怎么证明 |
|---|---|
| 报告 43 条逐条有结果 | `evidences/spec-review-disposition.txt`：改了、已解决或不改加理由 |
| 原 4.2 没有悄悄丢规则 | `spec-migration.txt` |
| 规范没有和代码相反的数值 | 审查者按报告核对；规范里不再出现投影、模糊的具体取值 |
| 没有失效链接 | `docs:check` 校验链接与锚点 |
| 代码行为没变 | 去注释后的 diff 为空，`test:affected` |

## 不做与风险

- 不做：改组件外观或行为；`--panel-surface` 等表面变量迁移（`nb-ui-surface-model` 提案的事）；给 README 清单加生成脚本。
- 风险：S1 体量最大，可能发现 `.md` 和代码也不一致，就地按代码改，记进 `spec-migration.txt`。
- 风险：规范变短后，判据少了具体数值，读者要多跳一层到 CSS；这是“数值只在一处”的代价，接受。

## 待开发者确认

1. **骨架规则**：结构还不知道时不画骨架；结构已知可以用 `Skeleton`。推荐，书架页不用改。
2. **按钮胶囊**：DL 按现状改，不把按钮改成胶囊。推荐，改按钮是全库外观变化，不属于文档整理。
3. **坑号不重排**：报告建议按主题重新编号；推荐保留原号，删掉的留空号。代码注释、Task 记录都按号引用，分组已按主题，重排的收益抵不上这些引用失效。
4. **受控视图的新家**：`docs/standards/code/frontend.md`。推荐，它是写应用时的约定，不是可验收的产品行为，放 Spec 不合适。
5. **README 统一中文**：推荐，其它包的 README 都是中文，现在这份中英混写。代价是 npm 页面上的说明只有中文。
6. **表单合同不搬**：`forms.md` 第 224 行写着输出 26 到 31 要并入 nb-ui 规范。推荐反过来，`forms.md` 留作真相源，规范第 5 节只链接：这些输出有验收映射，搬走要改编号，两边写又违反“只写一处”。
7. **nb-ui 不单独建 Spec**：组件合同在同名 `.md`，工程规则在本规范，`docs/specs/README.md` 已登记入口；再建一份只会多一个要同步的地方。推荐不建。
