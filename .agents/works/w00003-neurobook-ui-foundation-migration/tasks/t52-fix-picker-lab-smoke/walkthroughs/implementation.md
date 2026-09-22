# t52 修复 Component Lab 项目书架 smoke 的既有漂移

## 结论

`--suite project-picker` 恢复绿色（exit 0），`--suite all` 与另外两个子套件同样 exit 0。改动只有本文末尾列出的 3 个文件；没有提交、没有 push。

## 运行环境与命令

- cwd：`C:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/.worktree/w00003-neurobook-ui-foundation-migration/packages/neuro-book`
- 服务：**复用开发者已在运行的 3001**（Leader 裁定；Lab 路由只在该实例上，smoke 是只读浏览）。隔离 State/Cache 根与独立端口的自建 server 只在早期试过一次：`bun run dev` + `NEURO_TEST...`（`NEURO_BOOK_STATE_ROOT/CACHE_ROOT` 指向 `Temp/nb-t52-picker/*`、`NUXT_PORT=PORT=4412`、先 `migrate:application-state --apply`），随后 `/lab` 返回 `503 Dev server is unavailable`——同目录两个 dev server 争 `packages/neuro-book/.nuxt` 的典型表现；按 Leader 裁定停掉 4412 并改为复用 3001。**未停止/重启 3001，未在其中创建或修改任何 Project 与业务数据。**
- 命令（4 次真实运行，日志留在 `Temp/nb-t52-picker/final-*.log`）：

```text
node --import tsx scripts/smoke/component-lab.ts --url http://127.0.0.1:3001 \
  --browser-executable "C:/Program Files/Google/Chrome/Application/chrome.exe" --suite <suite>
```

| 套件 | 退出码 | 失败条目 | 结束行 |
|---|---|---|---|
| `project-picker` | 0 | 0 | `Component Lab Project Picker smoke passed: http://127.0.0.1:3001/` |
| `core` | 0 | 0 | `Component Lab smoke passed: http://127.0.0.1:3001/` |
| `agent-profile` | 0 | 0 | `Component Lab Agent Profile smoke passed: http://127.0.0.1:3001/` |
| `all` | 0 | 0 | `Component Lab smoke passed: http://127.0.0.1:3001/` |

（`all` 第一次运行时 exit 1，失败条目为 `[vite] Failed to reload /components/common/DesktopTitleBarChrome.vue` + 一条 404——那是 t50 返工代理在共享 dev server 上 HMR 半成品文件造成的幻影失败，与本次改动无关；其改动落地后复跑即为上表结果。）

其它验算：

```text
bunx tsc --noEmit --pretty false -p scripts/tsconfig.json   # 只余基线错误 scripts/deploy/product-agent-state-root-smoke.ts:318
```

## 逐阶段结果（`--suite project-picker` 实跑）

| 阶段 | 断言 | 实测 |
|---|---|---|
| 选择组件与默认场景 | 树节点 `ProjectPickerView` + 场景 `data-value="default"` 可点 | 通过 |
| 经典网格 | 卡片数 `=== 14` | 14 |
| 经典网格 | 首张卡片有 `.project-cover` | 有 |
| 经典网格 | 书封高宽比 `≈1.5`（±0.1） | 1.5 |
| 经典网格 | `documentElement` 无横向溢出 | 0px |
| 封面覆盖 | 14 张卡片每张都有 `.project-cover img` 或 `.project-cover-fallback`，且两条分支都非空 | 5 img + 9 fallback |
| 密集列表 | `[data-classic-compact-view]` 可见、行标题 14、网格卡片让位 | 14 / 0 |
| 宽幅图文 | `[data-classic-editorial-view]` 可见、行标题 14、网格卡片让位 | 14 / 0 |
| 零项目空态 | 卡片 0 + 渲染文案含「还没有作品」 | 通过 |
| 新建对话框 | `[data-project-create-form]` + `#create-book-title` + `#create-book-summary` | 三者均挂载 |
| 加载中 | 卡片 0 + `[role="status"][aria-busy="true"]` + 文案含「正在读取书架」 | 通过 |
| 加载失败 | 卡片 0 + `[role="alert"]` 含「读取书架失败」「503 Service Unavailable」与「重试」按钮 | 通过 |
| 手机 390×844 | `[data-lab-subject]` 存在、宽 0 < w ≤ 390、容器无横向滚动溢出 | 390 / 0px |

## 场景与断言的映射表

| 旧脚本（漂移） | 现在 | 依据 |
|---|---|---|
| `[role="radio"]` + `hasText: "标准书架"`（等待 30s 超时） | `[role="group"][aria-label="场景"] [role="radio"][data-value="default"]` | fixture 场景表里 `default` 的 label 已是「经典网格」；`data-value` 由 nb-ui `SegmentedControl` 用场景 id 渲染，换词不漂 |
| `hasText: "零项目空态"` | `data-value="empty"` | 同上（label 恰好未变，仍改用 id） |
| `hasText: "新建对话框"` | `data-value="create-dialog"` | 同上 |
| `hasText: "手机 390×844"` | `data-value="phone"` | 同上 |
| 空态文案 `还没有任何书籍` / `ide.picker.emptyTitle` 原文 | 渲染文案「还没有作品」（zh-CN 的 `ide.picker.emptyTitle`） | 真实浏览器渲染的是本地化文案；`nuxt.config.ts` 里 `defaultLocale: "zh-CN"`、`detectBrowserLanguage: false`，浏览器语言不影响结果 |
| 卡片数 `>= 5` | `=== 14` | 夹具 `SAMPLE_PROJECTS` 14 条；`ProjectPickerViewFixture.test.ts:42` 也按 14 断言（这不是收紧容差，是把"够了就行"改成夹具真实语义） |
| 封面比 `1.5 ± 0.1` | 不变（实测正好 1.5） | `.project-cover` 是 `aspect-[2/3]`，封面变体预设 `project-cover` 384×576 |
| 「所有卡片有 img 或 fallback」 | 不变，另加 14 张全覆盖 + 两条分支都非空 | 夹具 5 部带封面、9 部没有，若 `v-else` 回退坏了旧断言在某些排布下仍可能通过 |
| 手机场景 `subjectWidth <= 390` | 增加 `hasSubject` 与 `width > 0` 前置 | 旧写法在元素缺失时读出 0，`0 <= 390` 会假通过 |
| 注释里承诺的「加载态、错误态、会话恢复」 | 新增 `loading`/`load-error` 两个阶段；**删除**「会话恢复」 | 加载/失败是 picker 的 `role="status"` / `role="alert"` 主区域分支，夹具确有这两个场景，注释原来承诺却没实现；「会话恢复」在夹具里没有对应场景（`pickerRecoveries` 只由真实的删除/建书 mutation 恢复流产生，夹具不喂这份数据），**不伪造**：从注释与断言中移除，失去的覆盖是「待确认归属的会话」文案与重试入口，改由 `ProjectPickerView.test.ts` 的 recovery 用例覆盖 |

## 其它陈旧选择器/契约清查（要求 3）

脚本里每个选择器都在本轮实跑中被真实命中（任一处失效都会因 locator 超时或断言失败而 exit 1）：

| 选择器/契约 | 现状 | 证据 |
|---|---|---|
| `.lab-columns > .nb-lab-panel--nav [role="treeitem"]` + `/^ProjectPickerView$/u` | 有效 | 阶段 1 通过；`core`/`agent-profile` 也用同一族选择器且通过 |
| `[role="group"][aria-label="场景"]` | 有效 | Lab 顶栏的 `NbSegmentedControl aria-label="场景"`（`LabShell.vue:750`） |
| `[data-project-picker-view]` | 有效 | `ProjectPickerView.vue:201` 根元素 |
| `[data-project-card]` | 有效 | `components/ProjectCard.vue:64`（仅经典网格用它） |
| `.project-cover` / `.project-cover img` / `.project-cover-fallback` | 有效 | `ProjectCard.vue` 封面三分支 |
| `[data-project-create-form]` / `#create-book-title` / `#create-book-summary` | 有效 | `ProjectCreateForm.vue:75` 与 `:176/:190`（对话框 `teleport-target="body"`，故在 document 级查询） |
| `[data-lab-subject]` | 有效 | 夹具根（`ProjectPickerViewFixture.vue:256`），`phone` 场景加 `max-w-[390px]` |
| `[data-classic-compact-view]` / `[data-classic-editorial-view]` | 有效（新增用） | 两个 Alt 布局的根元素 |

顺带核对：picker 组件里**再没有**其它 missing i18n key（详见 t53 报告），所以本次没有为了通过而放宽 console warning 判定——`observePage` 的 warning/error 收集一行未动。

## 5 条 `400 (Server Error)` 的结论（要求 5）

**结论：既不是 smoke 自身的请求，也不是 Lab 的安全注入，而是应用对非法 `projectRoot` 的正确拒绝；触发源是 Lab 夹具的合成项目根。**

证据链：

1. 默认场景 14 张卡片里恰好 5 张带封面，`img` 的 `src` 是：

```text
/api/projects/cover?projectRoot=workspace%2Fprojects%2Fcyber-city&preset=project-cover
/api/projects/cover?projectRoot=workspace%2Fprojects%2Fmagic-chronicles&preset=project-cover
/api/projects/cover?projectRoot=workspace%2Fprojects%2Fcrimson-abyss&preset=project-cover
/api/projects/cover?projectRoot=workspace%2Fprojects%2Fdesert-dynasty&preset=project-cover
/api/projects/cover?projectRoot=workspace%2Fprojects%2Fgreenhouse-witch&preset=project-cover
```

（用独立 Chrome 打开 3001 的 `/lab`、挂上 `ProjectPickerView` 后从页面里读出来的真实 `img[src]`；请求是在该页面 `page.on("response")` 里看到的，同一 URL 的响应 status 400。）

2. 同一 URL 在页面里 `fetch` 得到的响应体原文（3001）：

```json
{
  "error": true,
  "url": "http://127.0.0.1:3001/api/projects/cover?projectRoot=workspace%2Fprojects%2Fcyber-city&preset=project-cover",
  "statusCode": 400,
  "statusMessage": "Server Error",
  "message": "projectRoot 必须是一级目录名",
  "data": {"code": "INVALID_PROJECT_ROOT"}
}
```

浏览器控制台原文：`Failed to load resource: the server responded with a status of 400 (Server Error)`，`location.url` 就是上面这条 URL——与红分支登记里的记录逐字一致。

3. 代码依据：`shared/dto/project.dto.ts:13-21` 的 `ProjectRootDtoSchema` 要求 `projectRoot` 是**一级目录名**（`!value.includes("/") && !value.includes("\\")`）；`server/api/projects/project-control-plane.ts:26-36` 的 `requireProjectRefQuery` 校验失败即 `statusCode: 400` + `code: "INVALID_PROJECT_ROOT"`。夹具 `ProjectPickerViewFixture.vue` 的 `SAMPLE_PROJECTS` 用的是 `workspace/projects/<slug>`，天然含 `/`。产品路径上 `projectRoot` 来自 `/api/projects`（合法目录名），永远走不到这个分支。

4. 修法与边界：这 5 条是**应用正确行为**，但会让 smoke 的 console 监听变红。脚本里只对**契约非法**（`projectRoot` 含 `/` 或 `\`）的夹具封面请求做本地定格成一张 1×1 PNG（`stubFixtureCoverRequests`），合法 `projectRoot` 的封面请求继续走真实端点——真实封面加载回归照旧会以 console error 暴露。

5. 负面对照（同一 revision、同一实例）：临时关掉定格后复跑 `--suite project-picker`，exit 1，失败条目恰好是这 5 条

```text
- [console] error: Failed to load resource: the server responded with a status of 400 (Server Error)   ×5
```

（日志 `Temp/nb-t52-picker/run-negative.log`；随后已还原定格。）夹具根不是合法目录名这一点按缺陷条目单独上报，本 Task 未改夹具数据。

## 未验证项与边界

- 未跑 `bun run typecheck` / `nuxt prepare|generate|build`：会重建共享的 `packages/neuro-book/.nuxt` 并摧毁 3001（Leader 明令禁止）；类型信息用只读的 `tsc --noEmit -p scripts/tsconfig.json` 代替（仅余已登记的基线错误）。
- 未跑 `docs:check` / `governance:check`：不属于本 Task 交付清单，且全项目门禁由 Leader 统一执行。
- 未在自建隔离 server 上复跑：按 Leader 裁定复用 3001。`--suite all` 里对 `/`、`/lab` 的浏览都是只读。
- 未覆盖：`creating`（创建中）场景仍只由 `ProjectPickerViewFixture.test.ts` 覆盖；Alt 布局的封面比例沿用经典网格的 1.5 断言，未在 Alt 布局上重复测量。
- 3001 上的 5 条 400 只在 Lab surface 出现；产品书架（真实 `projectRoot`）未做端到端取封面验证（不在本 Task 范围）。

## 变更清单（仅 3 个文件，未提交）

| 文件 | 改动 |
|---|---|
| `packages/neuro-book/scripts/smoke/project-picker-view.ts` | 场景切换改用稳定 id；逐条重标定断言；新增 加载中/加载失败/密集列表/宽幅图文 覆盖；删除不存在的「会话恢复」；非法夹具封面请求本地定格 |
| `packages/neuro-book/app/components/novel-ide/project-picker/components/ProjectPickerClassicCompactView.vue` | 见 t53：`changeCover`/`deleteProject` → 既有 `setCover`/`deleteBook` |
| `packages/neuro-book/app/components/novel-ide/project-picker/components/ProjectPickerClassicEditorialView.vue` | 同上 |
