---
schema: nbook.task/v2
taskId: t43-models-ux
status: active
updated: 2026-11-22
---

# 服务商、模型角色与模型选择器的体验改进

## 目标与范围

按开发者 2026-11-20 的反馈改进三处：服务商与模型页（在线目录、多列分组带图标的添加、模板化服务商、添加即全部模型、协议检测、代理）、模型角色的推理档、Composer 模型选择器的重新设计。

合同：会改 [`models/settings-pages.md`](../../../../../docs/specs/models/settings-pages.md)、[`models/service.md`](../../../../../docs/specs/models/service.md)，以及 Composer 选择器所在的对话视图 Spec；改哪些输出在计划里写明。

前情：服务商与模型页、角色页的设计与实现在 [t09](../t09-models/README.md)；选择器分“角色”“模型库”两页的稿在 [t28](../t28-conversation-ui-followups/README.md) 静态稿第 1 轮。

## 开发者的反馈（2026-11-20）

服务商和模型：

1. omp 好像提供不更新依赖就能拿到最新模型目录的办法，我们现在没有。
2. 不够直观：点“添加服务商”后弹出的选择列表可以改成多列、分组，并加上服务商图标。先看已装的依赖里有没有专门提供这些图标的库，没有就看 Magpie 的图标从哪来。
3. 选 OpenRouter 作模板后只有“管理模型”“添加全部”，“管理模型”不能自动发现、也没有重新拉取。所有服务商都应一样：能从 Gemini 模板创建、再手动改成 GPT 的模板也没关系；服务商列表提供的是模板（Magpie 支持给服务商自己改图标）。
4. 添加服务商后自动添加这个服务商提供的全部模型。
5. Magpie 有检测协议的功能，我们也加一个。
6. Magpie 可以克隆到本地研究（已克隆到 `.local/github/magpie`，提交 `9494a38`）。
7. 支持代理，同 Magpie：应用级代理，服务商有自己的代理设置；代理分全局（走主机代理设置）、自定义、直连三种。

模型角色：

8. 模型角色也能设推理档。

模型选择器（Composer 里用的）：

9. UI 有点丑，要重新设计；模型库这里加服务商图标，角色也有自己的专属图标。
10. 角色页里有些模型没提供思考档，界面直接把思考档调节隐藏了，这样不好。
11. 思考档调节不好用，要重新设计。
12. 选择器的阴影太重。
13. 角色选择这里 UI 有点丑，角色卡片太大、浪费空间；以前出过静态稿。

## 调研

- [Magpie 的做法](research/magpie.md)
- [OMP 的在线目录与发现](research/omp-catalog.md)

调研要点（2026-11-20）：

- OpenRouter 不能发现是我们自己挡的：服务端 `discover` 只放行 OpenAI 兼容的自定义服务商，前端“重新拉取”也只给自定义服务商；OMP 有 OpenRouter 的端点发现，不要密钥也能拉。只放开发现还不够：目录服务商的模型解析只认打包目录里的 id，新发现的模型照样调不了。
- OMP 不升级依赖拿新目录：`createModelManager` 合并打包目录、本机缓存 `models.db`、stencil.so 的目录（`catalog.stencil.so/models.json.zstd`，40 家，不含 OpenRouter）与各家 `/models`；不传缓存路径时会写进 `~/.omp/agent/models.db`，接入时要放进状态根。
- 规模：OpenRouter 打包的对话模型 587 个；现在的“管理模型”不按类别过滤，还会列出图片、embedding 等非对话模型（从代码推断）。
- 推理档：角色没有推理档字段；自定义模型的 `efforts` 只进快照、不进解析。选择器在档位少于两个时隐藏调节（`AgentRoleModelPicker.vue` 的 `thinkingLevels.length > 1`）。
- 图标：已装的 `simple-icons` 是 vitepress 的传递依赖，缺智谱、豆包、硅基流动、xAI、Groq 等；Magpie 用 lobehub/icons（npm `@lobehub/icons-static-svg`，MIT，约 2.5 MB），用户可上传、填 URL、抓站点图标、首字母色块。
- Magpie 的模板建出来后协议与地址只读、模板之间不能互改；开发者要的是全部可改，与它不同。
- 代理：OMP 每次请求可传 `fetch`，按服务商带 `proxy` 能接上；Magpie 的“自动”依次读设置、环境变量、操作系统设置。
- t28 第 1 轮的稿里角色卡片有图标、“跟随默认”旁写出默认是哪个角色，实现都没有做。

## 决定（开发者 2026-11-20 会话）

1. 服务商只有一种：都从模板复制，名称、协议、地址、图标都能改；模板只决定初始值和去哪查模型能力。取代 t09 决定 11、12 里目录服务商与自定义服务商之分。
2. 添加服务商后加入它的全部对话模型，几百个的（OpenRouter）也加，不设阈值。主 Agent 的理解（开发者没有异议前照此做）：设置里只记移除和改过的，目录新出的模型自动出现；图片、embedding 等非对话模型不加。为此服务商详情与选择器的模型列表按系列分组、搜索只渲染命中项，必要时虚拟列表；“检测全部”先确认要检测的个数并限并发。
3. 在线目录默认开：启动先用缓存、后台更新；添加服务商、填完密钥、点“重新拉取”时立即拉这一家；设置里给“自动更新模型目录”开关。缓存放状态根。
4. 图标：内置用 `@lobehub/icons-static-svg`；自定义支持上传图片与首字母色块；抓站点图标第一版不做。
5. 代理：应用级放设置里新的“网络”分区，服务商级放服务商的“高级”；模式为跟随系统、自定义、直连；第一版只管模型服务的请求（对话、发现、检测、目录更新）。Bun 的 fetch 能否走 socks5 待验证。
6. 推理档优先级：会话里明确选的 > 角色上设的 > 模型默认。控件不再隐藏：不支持思考的停用并写原因，支持但没声明档位的给通用几档，只有一档的显示为固定值。
7. 协议检测照 Magpie：对同一地址并行发四种协议的极小请求，逐行显示结果，点“用这个”才写入。

第 1 轮静态稿的答复（开发者 2026-11-20，评审板 `review` v1）：

8. 选择器里的角色排成两列紧凑行（`r1-roles` = `grid`，没选推荐的一列）：单行项，角色图标、角色名，右边服务商图标、绑定的模型与角色的思考档。
9. 思考档用分段按钮（`r1-effort` = `seg`），附意见“样式还是可以优化一下”：下一轮出分段按钮的样式变体再定。
10. 阴影整档调轻（`r1-shadow` = `global`）：气泡这档（`--elevation-popover`）改成菜单那档的轻投影，约 20 处一起变。
11. “添加服务商”用分组、组内多列的行（`r1-add` = `list`）。

第 2 轮静态稿的答复（开发者 2026-11-20，评审板 `review` v2）：

12. 思考档的分段按钮用 C “浮起的纸”（`r2-effort-style` = `raised`）：浅轨道，当前档是浮起的面板色、字用强调色，跟随角色时只留细框；附意见“排版排好一点”。
13. 服务商详情按第 2 轮的稿做（`r2-provider` = 是）：点图标换图标（内置、上传、首字母，可恢复模板的）、名称就地改、“复制一份”；协议每家都能改，旁边“检测协议”就地列结果、点“用这个”才写入；“恢复模板地址”；高级里的代理（跟随应用、跟随系统、自定义、直连）；“重新拉取”每家都有、写出目录更新时间；“服务商新出的模型自动加入”开关（默认开）。
14. “网络”分区不按第 2 轮的稿（`r2-network` = 否，意见“有点丑”）：重画。
15. 角色页的思考档按第 2 轮的稿做（`r2-roles` = 是）：角色图标、模型右边一列思考档，第一项“跟随模型”；没绑定、不支持思考时停用并写在框里，没写档位的给通用几档加“?”。

第 3 轮静态稿的答复（开发者 2026-11-20，评审板 `review` v3）：

16. “网络”分区按第 3 轮的稿做（`r3-network` = 是）：照设置窗口现有页面的画法；小组“代理”（代理方式：跟随系统、自定义、直连；自定义时多一行代理地址；跟随系统时行下信息色写出现在用的代理与来源；“测试代理”经代理请求一次、行下写出口 IP 与耗时）与“模型目录”（自动更新开关；“现在更新”，说明写上次更新时间与模型数）。
17. 选择器头部的思考档按第 3 轮的稿排（`r3-effort-layout` = 是）：思考图标与角色图标同一列、各档等宽、“主力的默认”或“用主力的默认”贴行尾与“角色｜模型库”右边对齐。

计划阶段（开发者 2026-11-20 会话，按推荐）：

18. 环境里设了代理时的“直连”与 SOCKS5：做本机中继（只听 127.0.0.1，每个模型请求显式指向它，中继按出口直连、走 HTTP 代理或经 `socks` 走 SOCKS5）。依据：Bun 1.4.4 的 `fetch` 按环境变量走代理且按次关不掉、不认 `socks5://`，进程环境又要留给子进程（[计划](plan.md)的“网络出口”）。
19. 删除服务商仍在列表条目上（`models/settings-pages.md` 输出 12），标题区只放图标、名称与“复制一份”；第 2 轮稿里标题区的“删除”是出稿时没核对 Spec。
20. 复制服务商连密钥一起复制；代理地址不带用户名密码；上传图标不收 SVG、存成设置里 ≤48 KB 的图；模板建后不变（主 Agent 定，开发者没有异议）。

计划设计审查之后（开发者 2026-11-20 会话；审查与处理见 [`evidences/design-review-disposition.md`](evidences/design-review-disposition.md)）：

21. 不做本机中继，取代决定 18：跟随系统、自定义 HTTP 代理用 Bun 的按次 `proxy`，直连用 `proxy: false`（Bun 1.4.3 起；审查查出、主 Agent 复测）；SOCKS5 地址拒收，提示改用代理软件的 HTTP 端口。
22. 网络设置连网页工具（`nbook.web-tools` 的搜索与抓取）一起接，扩大决定 5 的范围。
23. 不为装回旧版本做保护：新的设置形状写入后旧版本会整项丢弃服务商与角色设置，Spec 的兼容一节与发布说明写明。
24. 计划按审查意见整份重写，分三段（A 推理档与选择器、B 服务商模板化与模型来源、C 网络与代理），三段一起再审一轮，然后按顺序实施；每段单独合入。
25. 第二轮审查（[处理](evidences/design-review-r2-disposition.md)）后：上传图标改存状态根文件，PNG ≤ 64 KB、客户端缩到 128 像素、经 `setIcon` 的 RPC 上传，取代决定 20 里“存成设置里 ≤48 KB 的图”；出口不做重定向（模型请求遇 3xx 报错）；“检测协议”只测已保存的配置；“测试代理”访问 Cloudflare 的 `cdn-cgi/trace`；本机与空白模板里类型不明的模型默认启用。这几项由主 Agent 定，开发者没有异议前照做。

第三轮计划审查之后（开发者 2026-11-21 会话；审查与处理见 [`evidences/design-review-r3-disposition.md`](evidences/design-review-r3-disposition.md)，47 条成立 46、接受取舍 1）：
26. 段 B 拆成 B1（模板与身份：模板表、配置 v2 与 v1 读法、模型身份与完整线地址核对、`uid` 与日志 `origin`、图标、添加与标题区、选用数据模块；模型清单暂只用打包目录）与 B2（模型来源：在线列表、缓存、在线目录、自动更新、协议检测、来源状态界面）。B1 先做先合入；B2 开工前对照 B1 的实际形状微调计划，不再开计划审查，靠实现审查兜底。计划审查三轮已到上限。
27. 改决定 25 的一处：本机与空白模板里类型不明的模型，有上下文窗口（列表给或用户填）才自动启用，没有窗口的进“需补字段”、不启用，不默填猜测值；云服务商模板的类型不明模型不自动启用，管理模型里可一键启用。
28. 添加对话框里的登录类服务商不再默认收起，回到 `models/settings-pages.md` 现行写法：列在同一张表里、停用并写要登录，服务端同样拒绝。
29. 应用的最低 Bun 版本在 B1 提到 1.4.4（CLI、服务入口、发布产物与桌面随包版本一起；按次 `proxy: false` 从 1.4.3 起），发布说明写明：设了环境代理的用户，模型请求在段 C 提供代理设置之前走直连。

审查结论里主 Agent 定的办法（开发者没有异议前照做）：出站核对改比完整线请求地址；每个实例加永不复用的 `uid`；v1 里旧运行时本来忽略的字段首次 v2 写入时丢弃并写进发布说明；元数据查找按同模板且同协议；设置层预检与锁内写之间的窗口接受取舍；合同 v3 的 `setIcon` 收 base64、`providerModels` 分页带修订且不带 `query`、新增 `modelsByReference`；不做服务端 `checkAll`；协议检测用库自己的请求构造、采纳用单独的 `adoptApi`。

设计定稿（决定 1 到 17）。草稿在 `.worktree/w00032-t43-drafts` 的 `packages/neuro-book/src/plugins/drafts/web/components/models-ux/`（不合并），评审板 `artifacts/review` 三轮。

## 当前状态

2026-11-20 建 Task；调研、三轮静态稿完成，设计定稿。计划第二稿经第二轮设计审查（omp 38 条、Sonnet 前端 14 条，全部成立、已处理），改为第三稿，开发者确认后开工；第三稿的段 B 经第三轮审查（omp 29 条、Sonnet 18 条）后拆成 B1 与 B2，改为[第四稿](plan.md)（决定 26 至 29）。

段 A（推理档与选择器）：2026-11-20 合入 master（提交 84b810ad1）。实现审查后端 omp 8 条、前端 Sonnet 15 条，全部核实并处理（[处理](evidences/impl-review-a-disposition.md)，报告 [后端](evidences/impl-review-a-backend-omp.txt)、[前端](evidences/impl-review-a-frontend-sonnet.txt)）；四个包类型检查、`test:affected --since master`、e2e（models、agent-conversation、lab-agent-ui 共 79 条）通过，`lab-scenes` 的 ThemeEditor 404 是分支起点上就有的失败。Spec 与 ADR 0057 同日提交。证据：[`evidences/a1-reasoning.txt`](evidences/a1-reasoning.txt)。

段 B1（模板与身份）：2026-11-22 合入 master（合并提交 63516eb7e）。合入前的验证：五个包的类型检查、`test:affected --since master`、e2e（models、settings、agent-conversation、agent-request-trace、lab-agent-ui、lab-scenes 共 102 条，100 通过）；没过的两条是分支起点与 master 上就有的失败（`lab-agent-ui:572` 模型选择器的窄面板用例、`lab-scenes` 的 ThemeEditor 404），不算本段。Spec（`models/service.md` 输出 19 至 24、`models/settings-pages.md` 输出 19 与验收 4、`harness/models.md` 输出 21、22、`ui/agent-conversation-view.md`）与 [ADR 0058](../../../../../docs/adr/0058-models-wire-identity-full-url-and-uid.md) 同日提交。开工核对记在 [`evidences/b1-probes.txt`](evidences/b1-probes.txt)。实现审查后端 omp 22 条（重要 16）、前端 Sonnet 20 条（重要 8），逐条核实：后端改 19 条、接受取舍 1 条（每页重算成员）、不改 1 条（`checkAll` 留到 B2）、已修 1 条；前端改 18 条、部分 1 条（插件层的计数用例）、接受取舍 1 条（Profile 页选项不封顶），见[处理](evidences/impl-review-b1-disposition.md)。另补了计划要求、开工时漏掉的两条验收测试（经真实会话日志关闭重开的回放；删建与换密钥后的签发身份）与 e2e 验收 4（同模板两份、改名、复制、上传真实图片、搜索、移出与加回、390 宽）。与计划不同的地方：
- 中性身份叫 `generic-endpoint`（计划写的 `nbook-compatible` 被 nb-harness 的应用中立检查拒绝）；发送前核对与身份的取舍另写 [ADR 0058](../../../../../docs/adr/0058-models-wire-identity-full-url-and-uid.md)（部分取代 0057 决策 4）。
- `nbook.network` 插件壳没在 B1 建，挪到 B2（B1 没有要它的设置项与调用方）。
- 模型区的系列在模型不多于 30 个时默认展开（计划写默认收起；几个模型也要点开才看得到，e2e 与日常用都别扭），多于 30 个照计划收起、收起的不渲染。
- “管理模型”不单列“已移出”一组：移出的与没加过的都列为不在列表里、可以加回来（快照与行里没有区分两者的字段）。
- 帧字节核对按服务商设置项整份 `JSON.stringify` 的 UTF-8 字节，不是整个设置文件。
- 模型区头的次要操作没有收进“更多”：390 宽下按钮换行、没有横向溢出（e2e 验收 4 断言）。
- 新组件只有英文的 Lab 场景，没有 390 宽的：组件内部溢出 Lab 量不到，改由 e2e 验收 4 在真实页面上断言 390 宽没有横向溢出。
- 段 C 之前模型请求一律直连（按次 `proxy: false`），设了环境代理的用户照决定 29 走直连。

段 B2a（模型来源）：2026-11-22 合入 master（合并提交 a69d38485）。开工时按 B1 的实际形状改写了计划的 B2 节并拆成 B2a、B2b（决定 26），核对记在 [`evidences/b2a-probes.txt`](evidences/b2a-probes.txt)。合入前的验证：nb-harness、nb-models（含浏览器侧）、nb-story、neuro-book 的类型检查，`test:affected --since master` 全部通过；e2e models、settings、agent-conversation、agent-request-trace 共 51 条通过（审查修正后 models、agent-request-trace 重跑 7 条通过）。Spec（`models/service.md` 输出 25 与相关条目、`models/settings-pages.md` 输出 6、10、20）与 `CHANGELOG` 同日提交。实现审查后端 omp（`review` 角色 `aihub/gpt-6.2-sol:max`）21 条（阻断 2、重要 14）、前端 Sonnet 10 条（重要 2），逐条核实：后端改 18 条、接受 2 条（Cloudflare 改写 id 的在线行价目未知、单家状态变化全量重算）、不改 1 条（`304` 用内存副本）；前端改 8 条、部分 2 条，见[处理](evidences/impl-review-b2a-disposition.md)。与计划不同的地方：
- 删 `pinned.json`：缓存按部署判可用、凭据只判 `changed`；在线目录只补打包里没有的模型（打包优先）；目录查询对所有非空白模板的实例都做；“本机”就是空白模板。
- `catalogAutoUpdate` 归 `nbook.models`，显示在 `nbook.network` 的“网络”分区（插件壳只声明分区与文字）；关着时添加、设密钥之后也不跟着拉，只剩手动“重新拉取”。
- 没有条目、缺上下文窗口的来源模型按停用算（决定 27 的“不启用”）；管理模型里加入后不启用、补上窗口才启用。
- 新增启动环境 `NBOOK_MODELS_CATALOG_URL`：改在线目录地址，设空不取；e2e 夹具、Bun 测试预加载与各测试场地都设空，测试不出本机。
- 删了模型服务的 `discover`（管理模型对所有服务商读来源行），但 nb-harness 根入口的 `discoverModels` 保留：nb-story 的问答服务还在用（审查查出，第一次跑 `test:affected` 时 nb-story 的失败被误判成 worktree 缺构建）。

## 下一步

段 A 待办：给开发者看常驻卡片（提示卡、批注卡、向导浮层）改轻投影后的亮暗截图（决定 10；截图已拍，在 Task 的 `shots/`）。

段 B2b（协议检测，[计划](plan.md#段-b2模型来源与协议检测)的 B2b 节）：新分支实施；界面改成逐个 `check` 时删掉 `checkAll`（B1 后端审查第 20 条）。然后段 C（代理与网络出口，加进 B2a 建的 `nbook.network`）。

待查：`lab-agent-ui:572`（模型选择器窄面板与英文）在 B1 起点上就失败，段 A 合入时是通过的，原因没查。
