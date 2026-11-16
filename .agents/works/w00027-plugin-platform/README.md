---
schema: nbook.work/v1
workId: w00027-plugin-platform
issueId: null
status: active
updated: 2026-10-23
---

# 插件平台完善：非内置插件与插件配置

## 目标

为非内置（第三方）插件制定可实施的规范与最小端到端链路：包与清单格式、发现与安装、代码加载、公开 API／SDK、示例与作者文档；同时补齐插件配置与设置插件（密钥、长文本与结构化值的编辑等），让内置插件与外部插件都能声明、编辑并使用自己的配置。

来源：开发者 2026-10-17 提出；w00017 收尾时把插件清单与 [t63 插件触发自己的激活事件](../w00017-application-runtime-architecture/tasks/t63-plugin-activation-trigger/README.md) 一并移交本 Work。

## 范围与非目标

- 范围：`docs/specs/runtime/` 下仍为 `planned` 的插件平台合同（清单、安装、代码装载、公开 API、API 文档、热插拔、看门狗），把它们变成可实施、可验证、能写给第三方的规范；以及设置插件尚未实现的配置能力。
- 已确认不做（[ADR 0022](../../../docs/adr/0022-extensible-platform-and-plugin-trust.md)）：插件市场、在线分发、签名、权限沙箱；第一版完全信任，安装即告知插件可访问全部作品、服务器与本机资源。不支持多个用户各自安装插件。
- 内置插件仍随产品构建静态装配；本 Work 不把它们迁出仓库。

## 分支

本 Work 的代码在 worktree `.worktree/w00027-plugin-platform`、分支 `feat/w00027-plugin-platform` 上（2026-10-20 按“一个 Work 一条分支”由 t03 的分支改名而来），各 Task 依次在这条分支上提交、在这条分支上验证；合入 master 的时机由开发者决定。2026-10-20 开发者同意合入：先把 master 合进 Work 分支（合进了 w00029 t04 的弹出列表），在 Work 分支上验证后 master 快进到 `da4e006af`，内容为 t03、t07 S0 与 S1（含两轮审查修正）、t02 S1 与 S6。合并后的验证：类型检查，应用 Bun 1560 例、Vitest 382 例，内核 347 例，nb-form 93 例，nb-ui 498 例，`docs:check`、`governance:check`，以及设置、插件、代码编辑器设置、编辑器区、书架、浏览器宿主、nb-ui Lab、Markdown 输入八组 e2e 71 例。`editor-area.e2e.ts` 的“重新打开回到上次的光标”在负载重时两次失败、单独与整份重跑共五次通过，没抓到失败现场，原因未查明。之后 Work 分支继续用于后续 Task。

## 任务

| Task | 当前范围 |
|---|---|
| [t01](tasks/t01-requirements/README.md) | 需求与规范范围：规范收口、切片与实施计划（计划已写，见 [plan.md](tasks/t01-requirements/plan.md)） |
| [t03](tasks/t03-manifest-and-install/README.md) | S1：清单校验与第三方插件安装、`nbook.plugins` 与设置页 |
| [t04](tasks/t04-browser-loading-sdk/README.md) | S2–S3：浏览器入口装载、插件文件端点与 SDK 构建预设 |
| [t05](tasks/t05-author-experience/README.md) | S4：脚手架、作者文档与完整示例 |
| [t02](tasks/t02-settings-completion/README.md) | 设置补齐：通用编辑、搜索、页面未保存保护、动态选项、声明 API 易用性；开发者 2026-10-20 定提前到 t04 之前、不并行 |
| [t07](tasks/t07-low-code-forms/README.md) | 低代码：全项目共用的 schema 表单与表单组件（nb-ui 控件统一合同、补缺）；排在 t02 之前 |
| [t06](tasks/t06-settings-ui-polish/README.md) | 设置界面的样式收口：按设计稿重新收口设置窗口与设置组件的外观（t02 之后） |
| [t10](tasks/t10-settings-window-chrome/README.md) | 设置窗口的外框（去掉标题栏、可拖、圆角）与“本作品”沿用行（控件一直在、标“来自用户设置”）；开发者看 t06 实现后提出 |
| [t08](tasks/t08-secret-store/README.md) | 密钥存储（搁置）：开发者 2026-10-20 定暂时不做加密，API Key 用明文的普通配置项；计划、审查与调研留作重开时的参考 |
| [t11](tasks/t11-activation-output-shape/README.md) | 内核核对入口激活产出的形状，不对时报 `activation-threw`（t05 回写建议；2026-10-24 并入 t13 S1b 完成） |
| [t12](tasks/t12-plugin-dx-review/README.md) | 插件开发体验（Sonnet 以作者身份走一遍）与可维护性复查，及待确认清单改判的三项（2026-10-24 开发者要求） |
| [t13](tasks/t13-sdk-package-split/README.md) | SDK 拆成独立包（作者工具、模板、文档、示例）、内核去掉 NeuroBook 常量、通用插件管理在目录上分开（开发者 2026-10-24 定；计划待写） |
| [t14](tasks/t14-plugin-author-api/README.md) | 作者 API 的形状：`definePlugin` 与贡献助手、结果助手、短名与缺省值、出错可见（t13 design.md A1 到 A9，开发者 2026-10-24 定 D5） |
| [t15](tasks/t15-author-api-round2/README.md) | 作者 API 第二轮（第一期）；应用的 npm 包与 `nbook` 命令行（第二期）；发布 0.11.0、SDK 上 npm、CI 重建、文档（第三期）。已完成 |
| [t16](tasks/t16-patch-0-11-1/README.md) | 0.11.1 补丁：t15 真实用户冒烟的缺陷与小改进（新建作品后打开、插件页内置名称、整页切换不报 error、帮助对齐等） |
| [t18](tasks/t18-data-migrations/README.md) | 统一的数据版本迁移（应用与插件）：有序迁移步骤、迁移账本、插件可用。搁置（开发者 2026-11-15 定，要用时再开） |

## 后续的插件功能

开发者 2026-10-24 记下，还没排进 Task：

- 从 git（GitHub、GitLab）安装插件；
- 从压缩包安装插件；
- 开发调试体验：热插拔（[`runtime.plugin-hot-plug`](../../../docs/specs/runtime/plugin-hot-plug.md)）；
- 设置窗口的插件清单显示插件的详细信息：作者可以给更新地址（从 git 安装的，地址就是那个仓库），以后也考虑从 nbook 平台安装；
- 插件可以附带 README.md，在插件详情里显示。

t15 第一期的实现审查与作者验收留下的（[t15 plan.md 第 11 节](tasks/t15-author-api-round2/plan.md)）：

- 给作者的测试替身：SDK 的 `/testing` 子路径（内存里的存储、设置与时钟，激活一个入口再调用它的远程方法）；
- `nbooke create --with-server`：生成带服务端入口与远程服务的模板；
- 状态栏条目点击执行命令失败时也弹通知（现在只有命令面板与快捷键弹）；
- 纯度检查的报错按来源模块分组、先写原因与改法，共享清单放进 `--verbose`；
- 服务键带 id 的字面量类型，`require` 未声明的服务按 id 而不是接口核对（改内核 `defineServiceKey` 与全部定义）；
- nb-ui 的 NumberInput 的 `modelValue` 是字符串。

## 关键现状

平台设计已 acceptance，机制部分已实现，但外部插件的运行路径完全没有：应用只用代码里的静态 `productPlugins` 装配内置插件，没有从目录发现、安装或执行外部代码的入口（`packages/neuro-book/src/manifest.ts`、`server/plugins.ts`、`web/plugins.ts`）。详见 [t01](tasks/t01-requirements/README.md)。

## 待确认清单

开发者 2026-10-21 指定按 autonomous-delivery 推进 t02，2026-10-23 指定 t04、t05 同样自主推进：照推荐做、等事后追认的决定记在 [pending-confirmations.md](pending-confirmations.md)。

## 后续事项

开发者 2026-10-20 确认记为本 Work 的后续，按插件需求再排，还没有建 Task：

- 缺的贡献点：编辑器的补全与悬停（例如人物名补全、悬停显示人物卡）、编辑区正文的右键菜单、文件树装饰（徽标、字数）、快速打开的提供者（命令面板里搜人物与地点）、主题与配色贡献（现在主题是写死的两个选项）。
- 内置插件都没有提供按需激活的事件，所有入口启动即激活；t02 先补“设置分区被显示时激活”。
- 凭据的加密存储（t08 搁置）：需要时按插件隔离的键值密钥库重开，起点见 t08 的“下一步”。
- 生成式视图：Agent 对话流里 LLM 生成的 TSX 可视化程序，在不同源的沙箱 iframe 里运行，只做 Web；复用 t07 的表单组件；随 Agent 对话流重建，先写提案（开发者 2026-10-20 定名）。
- 插件页显示第三方插件各入口的激活状态（plugin-manifest 输出 6 的后半），卸载与禁用确认里列出依赖它的插件（t04 设计审查提出，2026-10-23）。
- `nbdev worktree new` 只能建 Task 级 worktree，要补 Work 级的（`.worktree/<Work 编号>-<短名>`、`{type}/<Work 编号>-<slug>`）。
- `nbook` 的后台运行（开发者 2026-10-27 定）：注册成操作系统的服务（systemd 用户单元、launchd、Windows 计划任务），由 `nbook service install|uninstall|start|stop|restart|status` 管，停止与查看也放在 `service` 下、对前台实例同样有效；实现前先调研有没有现成的第三方库，没有就自己做一个包。实例认领的套接字协议（t15 第二期）是它的停止与查询通道。
- 装好后让 agent 给 NeuroBook 写插件（开发者 2026-10-27 定为后续，参照 [deepseek-harness 调研](tasks/t15-author-api-round2/evidences/dsh-research.md)）：给外部 agent 的“写 NeuroBook 插件”Skill 与模板（照 `nbstory skill install`）；应用内的 Creator 模式、只读的运行时检视工具（贡献点、服务键、设置 schema）、agent 触发安装并热生效。后两样依赖应用内 agent 与插件热插拔（`runtime/plugin-hot-plug.md`）。
- 桌面版（开发者 2026-10-27 定另开 Task）：先写提案，实测 Electron、Tauri、Electrobun 三个壳（安装包大小、启动时间、Monaco 与工作台的显示）；壳捆绑 Bun 运行应用包目录的 `server/nbook.js`、窗口加载回环页面；定状态根是否与命令行共用、自动更新与签名。过渡办法是页面加 PWA 清单，浏览器“安装为应用”。
- 0.11.0 真实用户冒烟的发现（[evidences/p3-user-smoke.md](tasks/t15-author-api-round2/evidences/p3-user-smoke.md)）：缺陷与小改进并入 [t16](tasks/t16-patch-0-11-1/README.md)（0.11.1）。开发者 2026-10-27 定以下三项先记下、不急：**新建章节**（建好后进入改名、聚焦编辑器、空页面占位，章节命名规则与放不放进“正文”文件夹；要先出设计稿）；**中文书名的短名**（现在按 Spec 是 `project`、`project-2`，可选允许中文、转拼音或让用户改短名，要改 runtime/projects 的短名规则）；**装插件后的重启入口**（插件页“重启 NeuroBook”按钮，服务端有序停下后自己重新启动、页面重连；长远是热插拔 runtime/plugin-hot-plug.md）。

## 范围外发现

- `packages/neuro-book/src/server/projects/registry.ts` 的作品登记表 `projects.json` 只做进程内串行，注释写“只由本服务端进程写入”；而同一状态根可以有多个服务端进程（`runtime/projects.md`）。两个进程同时登记作品会互相覆盖。与 t03 设计审查第 8 条（插件登记表）同类，t03 改用 `replaceLocked`；`projects.json` 不在本 Work 范围，待开发者安排。

## 授权与限制

- 当前只做需求、规范与设计；实施切片经开发者确认后另建 Task。
- 远端 Issue／PR 写入、push、合并、发布逐次授权；`issueId: null`。
