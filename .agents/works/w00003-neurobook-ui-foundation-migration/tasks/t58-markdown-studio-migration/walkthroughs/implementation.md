# EditorWorkbench 实施与隔离验收

## 交付范围

本任务以 EditorWorkbench 替代旧 MarkdownStudioWorkbench 直接迁入方案。主代理实现共享合同、Config、store 文档生命周期、内核与 ViewHost、编排和主页面；配套代理实现受控外壳、文案、Lab 和展示行为测试。中央 Editor Part 不复用侧栏 descriptor，不改受保护的 `descriptors.ts` / `descriptors.test.ts`。

- 一个领域正文、多个注册视图：`code` 统一使用 Monaco，`markdown` 使用 TipTap。JSON 不 parse/stringify，HTML 只有源码；第三视图仅在 Lab 注册，不作为产品 HTML 预览发布。
- Config 分别配置扩展名→视图、扩展名→语言。内置→Global→Project 逐扩展名覆盖；PATCH 未提交字段保留，提交映射整表替换，空表清除该层覆盖。字体字段级合并。合法未知 ID 显示诊断，非法手写结构拒绝且保留原件。
- store 唯一拥有正文、buffer、dirty、保存冲突和会话。目标由 workspaceKey/generation/documentId/path 标识；activation token 隔离乱序读取，保存只确认提交快照，不清后续输入。旧标签 source/monaco→code、Markdown rich/split/mixed→markdown，保留 dirty/pin。
- ViewHost 惰性创建当前文档访问过的视图，隐藏不持续推全文，目标就绪再切可见。切换意图与真正隐藏前均结算输入；旧回调、旧 disposer、旧保存不能污染新文档。
- 保存失败、冲突、取消、保存中新增输入均保留标签；只有显式放弃允许强关。blur 只 flush，不自动保存。撤销由当前内核负责，不建设跨内核统一历史。
- 设置中的 Markdown 默认打开方式仅更新 Global `.md`；原全局 store viewMode writer 已删除。现有字体偏好的 Config/本地来源债务不在本任务迁移。
- 删除旧 Studio wrapper/controller/sync/toolbar，迁移欢迎区和通用源码内核。StructuredTextEditor、ProfileTemplateSourcePanel 保持原表单语义。

## 隔离与保护

- 实现分支：`refactor/w00003-nb-ui-adoption`，起点 `5b3b1069`；主工作区未切分支。
- 验收根：`C:/Users/notnotype/AppData/Local/Temp/neuro-book/acceptance/editor-44caddf6`。
- 独立 linked worktree：`src`；独立依赖、`.nuxt`、State/Workspace/Cache 与 Chrome profile。服务 `http://127.0.0.1:44322`，Chrome CDP 44323。
- 仅本次空 State 执行四个 SQLite migrations 和 Application State 初始化，runId `f9106bf1-c473-42d0-9988-a8a811776eac`；不迁移真实数据。Editor Alpha / Editor Beta 均由产品创建入口创建。
- 3001 保留给开发者。本任务期间收到其无 exit code 退出通知，仅查日志，没有停止、重启或用作验收。收到本次独立服务/Chrome 退出通知后，仅恢复本次资源。
- 两个用户文件 SHA256 与进入任务时一致：`descriptors.ts = 11BDDDA87159DAA3A5C70D3CE83EC54581F866155C5C2974C6C1E545BAEA7CAA`；`descriptors.test.ts = 81D3CC7374763ABDDD7D97CABBF72D875BC19433F94042CCDF1DBB78870ED414D`。只将其只读快照带入验收副本，不纳入提交。
- package.json、锁文件没有交付差异；未升级依赖。未 push、PR、合并、部署、调用真实 Provider/Model，未删除 t61 原件或任何历史验收根。

## 浏览器证据

以下均针对上述独立服务；组件替身与真实内核证据分开记录。

| 场景 | 实际观察 |
|---|---|
| JSON 源码 | 模型语言 json，出现 `Value expected` / `Unexpected end of string.`；真实键盘输入得到非法文本 `{"chapter": }"}`，Ctrl+S 后文件内容与实际模型一致。自动闭合导致字符串不同于最初计划，不把预期输入字面量误记为实际值 |
| 富文本/源码切换 | chapter 输入 `pending-X` 后切源码再回富文本，内容保留；磁盘仍为旧内容，无隐式保存 |
| 保存并关闭失败 | 拦截 write 返回500 `验收写入失败`，标签仍在、错误可见、正文保留；解除拦截重试才落盘并关闭 |
| 配置继承/重载 | Beta 原 Project `.md:markdown`，Global `.md:code`；清 Project 映射并重载，已有富文本保持 markdown，新 `reload-check.md` 为 code/markdown language |
| 独立语言/未知 ID | 仅 `.note:markdown` 语言映射后是 code + markdown language；`.weird:missing-view` 显示未知视图诊断并用 code，配置原值保留 |
| HTML/未知文本/二进制 | HTML language=html，无预览选项；未知扩展默认 plaintext；image.png editable=false、document=null、保存禁用 |
| 设置写入 | PUT Global 注入500 `settings-save-probe-failed`，可见失败且仍显示源码；解除后选择富文本写入成功，markdown/monaco fontSize 保持23/19，其它关联和语言映射保留 |
| 跨项目迟到 read | 挂起 Beta late-read.txt，通过真实路由打开 Alpha chapter，随后释放 Beta read；仍为 Alpha `# 开场\n\n原文pending-X`，loading=false |
| 跨项目迟到 save | 挂起 Alpha write，打开真实 Beta Project Session 再切 store；释放旧 write 后 Beta 正文不变、saving=false、旧 target 更新返回false。Alpha 磁盘包含已确认 `late-save-probe` |
| 原生撤销 | 文件搜索 input 输入 `native-undo-probe`，标题栏命令路由执行 undo 后变为 `nat`（浏览器原生撤销分组），Beta 正文不变 |
| 批注 | 真实 TipTap 读取 `<comment body="批注验收">有批注的正文</comment>`；菜单打开评论面板，修改批注后共享正文包含 `body="已修改批注"` |
| 引用 | 真实 resolveReference(`chapter.md`) 返回 broken=false / resolvedPath=chapter.md，openReference 回调切到该文件，旧文件 dirty buffer 保留。未把 `[[...]]` 或断链旧协议当作有效引用 |
| frontmatter 权限 | 普通 review.md（即便含type）不开放面板；`manuscript/probe/index.md` contentNode=true 才开放。面板改 title 后 flush，正文前置元数据为 Metadata Updated |
| 源码表单 | 在独立浏览器临时宿主挂载实际 StructuredTextEditor 与 ProfileTemplateSourcePanel，不替换内核；语言分别 markdown/typescript，append+flush 返回真实 change/modelValue，源码面板真实 Ctrl+S 发出一次 save-request。临时挂载已卸载；不声称验收了整个 Plot/Profile 工作流 |

## Lab 与视觉

- 八场景：empty、mixed、long-titles、loading、diagnosis、closing-cancel、keyboard-menu、multi-view，均真实挂载且编辑器横向溢出为0。
- 外壳、注册表和 ViewHost 为产品组件；内联 textarea/阅读预览明确是领域示例，不冒称 Monaco/TipTap。输入 `shared-preview-text`，选择 test.preview 能读到同一未保存内容，回 code 后逐字保留。
- NeuroBook/macOS × light/dark 四组合，浏览器1440与真实390×844均测量 pageOverflow=0；390画布编辑器宽388、editorOverflow=0。另有 Editorial/Aurora 的390画布观察。大于舞台的受控画布有 Lab 自身横向滚动，不误报成产品页面溢出。
- 截图留在验收根：`final-{nbook|macos}-{nbook-light|nbook-dark}-{1440|390}.png`；完整组件截图 `editor-{nbook|macos}-{nbook-light|nbook-dark}-{1180|390}.png`。已查看浅/深及宽/窄实际画面；标签区内部横向滚动，菜单入口可见。
- `node --import tsx scripts/smoke/component-lab.ts --url http://127.0.0.1:44322 --browser-executable "C:/Program Files/Google/Chrome/Application/chrome.exe" --suite all`：exit0，22.94s。此既有脚本覆盖与新编辑器场景逐项验收分别记账。

## 发现与修复

1. 恢复事务被新 activation 取代导致 restoring 永久true：finally 改为工作面身份清恢复状态、sequence owner 清正文 loading；close/reset 显式清失去 owner 的 loading。新增延迟恢复回归。EditorDataReview 复核 correct。
2. 目标视图异步准备时旧视图继续输入，切可见前未 flush：releaseActive 在撤句柄前 flush，change 同步 preparing snapshot。新增延迟 ready 回归。EditorViewReview 复核通过。
3. Monaco ready 前外部正文更新被空模型吞掉：CodeEditorView ready 重同步最新 props，ready前不伪记已同步。新增延迟内核回归。EditorViewReview 复核通过。
4. TipTap 异步创建跨过 readonly watcher：onCreate 按当前 readonly 设置 editable，真实输入通过。
5. 隐藏 Monaco 初始化尺寸5×5：layout 使用根元素正尺寸，可见时完整布局。
6. nb-ui Menubar 不消费 checked/任意 aria 数据：外壳映射真实已选文案和check图标，select 恢复完整原始项。新增翻译依赖后测试缺 useI18n stub，5例失败；补正确测试环境和选中态用例后6/6通过。
7. Lab data回写重置场景：区分场景初始化与外部数据patch，抑制自身echo；传纯数据快照，修复 Vue Proxy 导致 structuredClone DataCloneError。最终743行，小于800行限制；八场景与第三视图实测通过。
8. 删除的 novel-writing-mode-entries.test.ts 主要为文件源码/文案字符串断言，不迁移这些实现细节断言；正文安全、菜单、标签、标题栏和文件树采用真实行为验证。

## 门禁与限制

- 聚焦测试实际包含新的组件、解析器、store、编排、文件树、标题栏和Config；第一次注册表测试未被include收集，已补显式目录，不能将命令参数当作覆盖。
- 全包使用 `bun run typecheck`，不以裸 tsc 基线替代。OpenAPI 在隔离副本生成，37路由生成成功，仅回填4个相关config路由。
- LSP 两次返回 `No language servers configured for this project`；消费者通过精准搜索、实际类型门禁及行为验证核对，不声称 LSP 通过。
- 初次独立空State启动被迁移门禁拒绝，按隔离授权完成初始化。一次dev端口先接受连接、Nitro尚未生成worker时出现 `worker entry not found`，等待实际构建完成后正常；未修改产品逻辑绕门禁。
- 浏览器工具有头会话 visibility hidden/RAF不推进；改用本次独立headless进程。`tab.run` 的 page.evaluate 使用隔离realm，读取Vue实例需 mainFrame().mainRealm()；已报告工具差异。不能把探针realm错误当成产品失败。
- 未运行全仓完整测试、生产build、真实桌面bridge、真实Provider/Model、多窗口或World Engine/Agent Chat Flow整页验收。聚焦通过不代表这些范围通过。
- 最终 `bun run typecheck`：exit0，46.82s（包含最终743行Lab fixture与菜单翻译）。
- 最终聚焦命令：18文件166例通过，exit0，55.31s。范围为 `shared/editor-workbench.test.ts shared/editor-associations.test.ts app/utils/editor-workbench app/stores/novel-ide.test.ts app/stores/novel-ide-editor.test.ts app/stores/novel-ide-legacy-writer.test.ts app/composables/useEditorWorkbench.test.ts app/components/editor-workbench app/components/novel-ide/workspace/WorkspaceFilePanel.test.ts app/utils/workbench-chrome.test.ts app/composables/useTitleBarEditTarget.test.ts server/config/normalizer.test.ts server/config/config-service.test.ts server/api/config/project-http-contract.test.ts`，cwd为验收副本 `packages/neuro-book`，入口 `bun run test`。
- `git diff --check`：exit0，仅Git既有LF/CRLF提示。
- 两名独立审查者完成复核：EditorDataReview 的恢复P1关闭；EditorViewReview 的两项输入丢失风险关闭，无剩余阻断。原始会话审查为只读，不冒充额外测试执行。
- `bun run docs:check`：5935文件，failures=[]；`bun run governance:check`：failures=[]、warnings=[]。
- 最终验收结束已停止本次 `editor-workbench-acceptance`，停止时exit1为dev进程终止结果，不是测试失败；独立Chrome随后释放。验收根、截图与历史原件保留，无仓库内临时脚本残留。

## 2026-09-22 拖放反馈与分屏丢签修复

- 范围：EditorWorkbench 分屏事务与草稿身份、Workbench 单轴边缘插入/中央保持反馈、源几何稳定与唯一 Custom DragOverlay。WorkbenchShellLayout 仍只负责布局；未加入新容器、复制 View 或四向分屏。
- 工作树：`.worktree/w00003-neurobook-ui-foundation-migration`，分支 `refactor/w00003-nb-ui-adoption`；本轮最后读取 HEAD 为 `ba220d31`。验证覆盖未提交工作树，没有独立提交 revision；保留其它在途修改。
- Editor：三草稿将 `note-02.md` 拖到右缘后，真实结果为 `primary=[note-01,note-03]`、`group-2=[note-02]`；中央释放和 Escape 保持集合，新建草稿为 `note-04.md`。分屏先验证候选 Grid 再发布；非法活动路径或非法场景 split 不写入正文。
- Workbench：侧栏沿 y、Panel 沿 x，以可见叶前后 20% 为插入带、中央 60% 为整叶保持反馈；中央释放不提交。切换器复用 `resolveListInsertion({edgeGap:4})`，插入锚点与插线同源，内容区域不叠线。
- 源稳定：活动栏容器按钮的按压缩放已取消；真实拖动前后均为 40×40、opacity=1，唯一拖影=1、placeholder=0。Editor 标签真实起拖前后矩形也一致。
- 键盘：移除 `useWorkbenchDrag` 逐源仅含 PointerSensor 的覆盖，沿用 Provider 整套传感器；真实 Space 起拖后 `aria-grabbed=true`、拖影=1，Escape 后拖影=0。已将键盘取消不提交加入 `workbench-containers.ts` 冒烟。
- 取消：Editor 与 Workbench 的 `pointercancel`、窗口 blur 探针均在鼠标释放前清除拖影及反馈。Editor 在 NeuroBook、macOS、Editorial、Aurora 的 390px 画布下保留 3 个标签、每组宽 193.5px、实测横向溢出 0。
- 聚焦门禁：应用 9 文件 / 139 例通过；nb-ui 全量测试、typecheck、`build:css` 通过且保留 `dist/nb-ui.css`；Splitter 浏览器测试 14 例通过。最终 `bun run nuxt:build:raw` 在键盘与场景校验修复后通过，96.29s，日志 `artifact://8164`。
- 全量限制：应用 `bun run test` 在 600s 超时，已观察到 `project-image-experience.contract.test.ts` 与 `novel-ide-settings-current-project.contract.test.ts` 两个测试失败；两者不在本轮改动范围，不能声称全量通过。应用 typecheck 为 113 条 / 12 文件诊断，本轮修改文件无诊断；`scripts:typecheck` 在 `product-agent-state-root-smoke.ts:318` 报缺少 `colorwayId` / `userColorways`。额外执行的 `bun run build` 未通过，不能以 raw build 通过替代它的结果。
- 独立审查：`DragParityReview` 复核最新文件后撤回已修复的正文事务 finding，无剩余已确认 Required/Critical；审查为只读，未重复运行验证。
- 本轮证据根：`C:/Users/NOTNOT~1/AppData/Local/Temp/neuro-book/acceptance/product-runtime/drag-parity-1790011684506`；包含 `editor-browser-proof.json`、`editor-cancel-themes.json`、`activity-final.json`、`workbench-center.json`、`workbench-keyboard.json`、`workbench-cancel.json` 和四主题截图。
- 最终完整 Workbench 冒烟通过：`node --import tsx scripts/smoke/component-lab.ts --url http://127.0.0.1:3001 --browser-executable "C:\Program Files\Google\Chrome\Application\chrome.exe" --suite workbench-shell`，275.08s，日志 `artifact://8166`，包含新增键盘起拖/取消不提交回归。此前源码热更新期间的一轮出现夹具空白，失败日志 `artifact://8158` 与 `workbench-interrupted.png` 保留；重启 3001 并保持源码静止后的完整复跑未再出现。空白与 HMR 的因果关系未单独验证。
- 用户授权的 3001 重启已完成并保留服务；未执行 commit、push、合并、部署、数据库迁移或删除存储锁。本轮临时 `dev.mjs` / `format.cjs` 已移除，证据保留。

## 2026-09-22 拖拽需求访谈文档落盘

- 开发者要求把 EditorWorkbench 与 Workbench 的容器定义、讨论结论和行为表写入相关文档；最后明确多 View 并入保留来源比例。本次仅文档，不实现新行为、不运行浏览器、不变更服务。
- 行为正文归现有 [ui.workbench-shell](../../../../../../docs/specs/ui/workbench-shell.md#editor-与-workbench-的容器层级)，避免新增重叠 capability。正文包含 Editor 与 Workbench 分表、区域方向表、反馈表、1:1／3:1 比例例子、空态入口、成员归零清理与验收场景；成熟度仍为 planned。
- 已确认的 Workbench 中央禁投取代访谈早期的“中央并入”猜测；Editor 正文中央仍为保持布局，不自动创建文档 Tab。“整个目标容器”表示并入后的归属，尺寸变化范围由 D/E/F 例子确定为命中窗格。
- 已同步 Spec 注册表，以及 EditorWorkbench、WorkbenchShellLayout、WorkbenchContainerTab、WorkbenchPartHost、WorkbenchViewHost、WorkbenchViewSection 的文档入口；组件页明确区分当前代码描述与待实现目标，不把文档写入当成代码已完成。
- 本次执行身份：Work w00003、Task t58、role tasker，分支 refactor/w00003-nb-ui-adoption，HEAD ba220d31；`bun run governance:context -- --work w00003-neurobook-ui-foundation-migration --task t58-markdown-studio-migration --role tasker` 返回 failures=[]。文档覆盖未提交工作树。
- 后续实现设计仍需明确：来源含 hidden/collapsed 成员时比例基准、尺寸约束无法满足严格半区时的可观察结果、同容器挪动时腾出空间的回收、整容器跨轴搬移的尺寸意图恢复，以及动态容器身份／保存格式。这些边界未在访谈中另行拍板，不用均分、删除隐藏成员或新建嵌套容器等默认值代替决定。
- 文档结构检查：仓库根 `bun run docs:check`，6230 文件，failures=[]。本轮没有代码变化，未重跑单元测试、应用构建或浏览器验收；前一节的测试仅证明此前实现，不覆盖新目标。

## 2026-09-22 Workbench 半区并入验收收口

- 实现保持批准合同：View 投 Switcher 插入位创建 `custom:` 容器；容器源整体移动；非空内容中央禁投且无反馈；边缘命中带 20%，预览与分配使用命中叶 50%；跨轴保留来源比例。
- 两个独立只读审查最终均无 findings。隐藏成员不进入 `sourceSizes` 是合同语义；window 自建容器进入可移动目标也是合同允许，两条均撤回。
- 浏览器冒烟脚本修正两处过期断言：纵向目标的非等比并入改为命中叶前缘 10%；连续拖走 Panel 容器时按当前顺序取目标的直接前驱。产品判定未放宽。
- 最终独立冒烟：`node --import tsx C:/Users/notnotype/AppData/Local/Temp/neuro-book/acceptance/workbench-drop-v2-1790048794054/smoke.ts`，172.97s；结果文件 `smoke-result.json` 为 `{"version":1,"failures":[]}`。截图 `smoke-final.png` 同目录保留。
- 最终聚焦测试：`bun run test` 指定 14 个 Workbench/Editor 拖放相关文件，实际 13 files / 341 tests passed，Vitest v4.1.10，28.86s。
- 未把应用全量 test、全量 typecheck、`scripts:typecheck` 或完整 `bun run build` 记为通过；此前已知失败与诊断仍在范围外。3001 未停止、未重启、未用于验收。
