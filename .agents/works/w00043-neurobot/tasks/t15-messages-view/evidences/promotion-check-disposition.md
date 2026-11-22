# t15 Spec 晋升核对：处理

开发者 2026-11-22 让晋升。逐句核对派两个 Claude Opus 并行：A 核 `ui/agent-conversation-view.md`（[报告](promotion-check-a-opus.txt)，80 句：有断言 66、字面不符 6、没有测试 8），B 核 `agent/conversation.md`、`bots/view.md`、`bots/bots.md`、`workbench/bookshelf.md`（[报告](promotion-check-b-opus.txt)，175 句：有断言 119、没有测试 47、字面不符 9）。两份都没有查出代码缺陷，也没有“没实现”的句子。

## 补的测试

- 提示词编辑器：补全菜单开着时 Esc 只收菜单、不发 `escape`，菜单收了再按才发（`PromptEditor.dom.test.ts`）。
- 对话视图：`canMutateHistory`、`canOpenTree` 为假时没有编辑、重新生成、从此处新开分支、分支树；停靠档的输入框不在 inert 里、可写；未读线出现时不滚动（`AgentConversationView.dom.test.ts`）。
- 适配器：正在生成的那条不算计数消息（`kernel-transcript.test.ts`）。
- 宿主：有归属的会话压缩失败时是固定会话的说法、普通会话照旧（`session-host.test.ts`，真内核、压缩模型两次 400；去掉宿主的 `pinned` 接线时失败）。
- bots 的浏览器入口：`list` 失败是 `failed` 加码、重试只重读，订阅失败重试重新订阅；没有未读、位置不超过已存时不交“看到”；入口停止后不再跟着 `botsChanged` 更新（`bots.test.ts`）。
- e2e `bots-chat` 验收 3：测试名改对，补“拿回焦点后状态栏不再写新消息”。

## 改的 Spec 说法（按实现）

- `ui/agent-conversation-view.md`：按天的线比的是“上一条有日子的轮”；线的画法（细线、颜色、圆形头像）挪给组件同名 .md，Spec 不写；`session` 一行补 `avatar`；验收 41 的焦点放到停靠区的容器上；固定会话的说法只出在只压缩的运行失败时（真内核只在那里以 `compaction-failed` 收口），删掉“运行出错”那处。
- `agent/conversation.md`：输出 50 的表与“继续是一个操作”挪回 50（原先挂在 53 下面）；输出 52 删掉“与编辑区页面”（编辑区页面不开有归属的会话，见 53），写明有归属的会话不走表里 `enqueue` 那行；“不画第一屏”改成“盖住”（第一屏在 inert 的盖层下面）；抽屉回焦点只在 Esc 与选了联系人时；`agent.sessionOwners` 与 `projects.desk` 的“声明是空对象”改成“声明不用”（贡献点没设声明的 schema）；验收 11 照 e2e 的先后写。
- `bots/bots.md`：补“转义的表情写法照字面留着”。

## 留着“（planned）”的句子

整条去掉标记，没有断言守着的句子各自挂“（planned）”，主要是：版式阈值与像素（消息视图 600×360、260 列表栏、书房 420 面板、案头格子尺寸）、贡献点的只收浏览器入口、id 前缀、每插件至多一条、联系人字段映射、多窗口共用“看到”、视图计数、身份找不到时的回落、排队与异步事项的 `settlePending`、归属读到之前的加载中、`focus-session` 对 bot 子会话、书房面板的代表次序、Tab 循环、不抢焦点、关面板作废在途的打开、两处各算各的未读线、首屏指标的诊断名、`last` 的 200 条上限与为 null。补测试的成本高于价值，或要量像素与真实布局；记在这里，之后有人改到再补。

## 晋升

- `bots/view.md`：`planned` 改 `implemented`，补实现合同与三条证据（审查者 B 建议这次不晋升；按 `docs/specs/README.md` 的“整份晋升，补不上的几句挂标记”处理）。
- 其余四份本来就是 `implemented`，去掉 t15 加的条目级标记。
- `agent/conversation.md` 里 37、39、40、49、126、133、209 行的标记不是 t15 这次核对的范围，没动。
