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
