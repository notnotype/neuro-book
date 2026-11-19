# NeuroBook Workshop（创意工坊平台）

> 2026-07-29 协议更新：本文保留第一版整数版本与 `nbook-package.json` 的历史过程；当前发布真相源已改为 [Agent Asset Package Protocol](../../../reference/agent/agent-asset-package.md)，安装身份见 [ADR 0011](../../adr/0011-agent-asset-install-identity.md)。现行站点支持 Skill / Workflow / Profile、根 `package.json` 和 SemVer；站点 AST 检查不是安全沙箱，客户端安装/更新和第三方 Workflow 隔离仍是后续任务。

## Relative documents refs

- [../../README.md](../../README.md)：NeuroBook 文档入口。
- [../../../PROJECT-STATUS.md](../../../PROJECT-STATUS.md)：仓库当前状态。
- [../85-fullstack-template-ui-library/README.md](../85-fullstack-template-ui-library/README.md)：`nb-fullstack-template` / `nb-ui`，Workshop 的工程基座。
- [../84-llmlint-standalone-repo/README.md](../84-llmlint-standalone-repo/README.md)：sibling 仓协作模式先例。
- [../../../reference/workspace/TERMS.md](../../../reference/workspace/TERMS.md)：Workspace 术语；Workshop 资产的最终安装目标是 Workspace Root `.nbook`。
- [../../../reference/agent/agent-asset-package.md](../../../reference/agent/agent-asset-package.md)：现行统一发布包、SemVer、三类入口与旧包迁移合同。
- [../../adr/0011-agent-asset-install-identity.md](../../adr/0011-agent-asset-install-identity.md)：`package.json.name` 是唯一安装身份；Profile 点分 key 不再是待定冲突。

## User Request / Topic

- 为 NeuroBook 提供一个后端平台（创意工坊），用户可以分享提示词、Profile、Skill 等资产。
- 第一版默认信任用户，不做上传审批。
- 产品形态：NeuroBook 是用户下载安装的客户端程序；Workshop 是 NeuroBook 默认集成的工坊服务，由项目作者单独部署官方实例。
- Workshop 必须能独立访问：提供 API 和 Web 两套访问方式，Web 侧核心动作是浏览与下载资产。
- NeuroBook 侧资产管理第一版从简：只负责安装，删除由用户手动删文件。
- 实施顺序：第一版只做 Workshop 本体，先不动 NeuroBook。

## Goal

建成可独立部署的 NeuroBook Workshop 第一版：邀请码注册的作者可以上传 skill / profile 资产包，任何人无需账号即可浏览、搜索、下载，登录用户可点赞、评论、收藏。验证面为新仓 `typecheck` / `test` / `build` 全绿、`db:setup` 非交互通过，以及"上传 → 浏览 → 下载 → 解压内容与原始资产一致"的 round-trip 冒烟。约束：不修改 NeuroBook / nb-ui / nb-fullstack-template 现有行为，NeuroBook 集成留待 Phase 2。若 `nb-fullstack-template` 基座能力不足（如缺 multipart 处理），优先在 Workshop 仓内补齐，不倒灌模板仓。

## Current State

- 设计已定稿（见 Decisions）。sibling 仓 `nb-workshop` 已建成 **Phase 1 后端 + Web 前端**：API v1 全套 + 邀请码注册 + zip 上传下载 + 社交互动 + admin 管理；Web 全量页面（浏览 / 详情 / 作者页 / 发布向导 / 个人页 / admin / 登录注册）。测试 41 全绿（含 21 个真实 HTTP 集成用例），typecheck / build 全绿。详见 nb-workshop 仓 `PROJECT-STATUS.md` 与 `docs/tasks/web-ui/README.md`。
- 基座就绪：`nb-fullstack-template` 已具备 Nuxt 4 + Nitro + Prisma/libSQL + scrypt 账号 + admin 初始化 + nb-ui 接入，派生流程见 Task 85。
- NeuroBook 侧的安装目标（Workspace Root `.nbook` 下 `agent/skills/`、agent profile 目录）与 user-assets Studio 均为现成能力，**Phase 2（客户端安装闭环）尚未开始**。

## Decisions / Discussion

### 产品决策

- **命名**：平台名 **Workshop**（NeuroBook Workshop），仓库 sibling `nb-workshop`，manifest 文件名 `nbook-package.json`。刻意避开 Workbench——IDE 内已有 Plot Workbench / World Engine Workbench 两个术语。
- **第一版资产类型**：只做 **skill + profile**。"提示词"不设独立类型（在 NeuroBook 中无独立物理形态，轻量提示词包按 skill 分发）。lorebook / 角色卡 / project 模板 / World Engine schema 为后续候选类型，打包格式从第一版起按类型可扩展设计。
- **信任模型（2026-07-05 二轮收紧范围）**：第一版**完全信任用户，不做安全防范**——zip slip / zip bomb / symlink / markdown sanitize / 频率限制 / 防爆破等技术防线全部不实现，只保留与平台功能正确性相关的数据校验（manifest 合法性、version 递增等）。全部安全注意点集中记录在 TODO 的**安全债清单**，按"公网开放前"与"Phase 2 客户端安装前"两个门分批回补。运营兜底只剩举报 + admin 下架 + 上传时勾选 ToS。**profile 是会在用户本机服务端进程执行的 TS 代码**，其详情页固定展示"包含可执行代码"警示条（一行文案，保留）。
- **社区功能第一版就做全**：点赞（公开热度信号，参与排序）、评论（扁平一级、无审核，与完全信任口径一致，admin 可删兜底）、收藏（私人书签，`/me` 查看）、作者公开页（该作者全部发布）。评论**纯文本展示**（Vue 插值默认转义，不渲染 markdown）——这是实现选择而非安全防范：更简单，顺带没有 XSS 面。
- **注册策略**：上传需邀请码注册（无审批模式下唯一供给侧闸门，放开时清空限制即可）；浏览与下载永远无需账号。
- **版本形态**：整数递增 version + changelog 文本，不用 semver。manifest 带可选 `minAppVersion`（NeuroBook 迭代快，profile TSX DSL / skill 约定都在演进；第一版仅存储展示，客户端校验属 Phase 2）。
- **slug**：全局唯一、先到先得；社区规模出现抢注问题后再考虑 `@author/name` 两级。

### 技术决策

- **独立 sibling 仓** `nb-workshop`，从 `nb-fullstack-template` 派生，UI 用 `link:@notnotype/nb-ui`；不进 NeuroBook 主仓。
- **存储**：SQLite（Prisma/libSQL）存元数据；zip 文件存本地磁盘，**文件根目录走 config**（env `WORKSHOP_FILES_DIR`，默认 `./data/files`，进 `.env.example`），存储布局 `<filesDir>/<itemId>/<version>.zip`；`DATABASE_URL` 沿用模板惯例。不引入对象存储。
- **API 从 `/api/v1` 起版本化**：Workshop 将被散布在用户手里、版本不可控的 NeuroBook 客户端长期依赖，公开 API 是稳定契约。
- **认证**：Web 用模板现成 session cookie；面向客户端的 PAT / API token 延后到 NeuroBook 集成阶段。
- **部署**：Docker 镜像 + volume（SQLite + files），HTTPS / 域名由部署环境决定。

## Design

### 数据模型（Prisma 草案）

- `User`：模板底座（id、username、passwordHash、role）。
- `InviteCode`：code、createdById、usedById?、usedAt?、createdAt。usedById 为空表示未使用；注册消费后作废。
- `WorkshopItem`：id、slug(unique)、name（**安装名**，取自首版 manifest，同条目恒定不可改）、type(`skill`|`profile`)、title、summary、description(markdown)、tagsJson、authorId、status、downloadCount、likeCount、createdAt、updatedAt。
- `WorkshopItem.status` 三态：`published` | `unlisted`（作者自主下架，作者可自行恢复）| `removed`（admin 下架，作者不可恢复）。两态区分不了"作者下架后想重新上架"和"admin 下架不许作者复活"这两种权限。
- `name` 不做全局唯一（允许 fork 别人的包发改进版）；slug 才是平台唯一标识。详情页必须展示安装名，Phase 2 客户端靠它在下载前判断与本地资产的同名冲突。
- `ItemVersion`：id、itemId、version(int 递增)、changelog、fileName、fileSize、sha256、minAppVersion?、createdAt。
- `Like`：(userId, itemId) 唯一。
- `Favorite`：(userId, itemId) 唯一。点赞是公开热度信号（参与排序），收藏是私人书签（`/me` 列表），两者并存分工。
- `Comment`：id、itemId、authorId、content（纯文本）、createdAt、deletedAt?。deletedAt 非空表示已删除（本人或 admin 软删），列表查询过滤；第一版扁平一级，不做回复树。
- `Report`：id、itemId、reporterId、reason、createdAt、resolvedAt?。resolvedAt 为空表示未处理。

### 资产包格式（2026-07-05 已按仓库实物确认）

NeuroBook 中两类资产的真实物理形态：

- **skill**：目录 `agent/skills/<name>/`，必有 `SKILL.md`（frontmatter：`name` / `description` / `when_to_use`），可带任意附属文件。跨度很大：最简如 `novel-workflow-08-plot-planning` 只有一个 SKILL.md；最重如 `llmlint` 是完整 runtime package（`src/`、`bin/`、`package.json`、`bun.lock`、`rulesets/`、`references/`）。约定 manifest.name = skill 目录名 = SKILL.md frontmatter name。
- **profile**：单文件 `<key>.profile.tsx` + 可选同名资料目录 `<key>.home/`（如 `writer.profile.tsx` + `writer.home/`，home 内是 `references/`、`styles/` 等 markdown 资料）。tsx 内部是 Profile DSL：import `nbook/server/...` 内部模块，export `profileManifest`（key/name/version/description）、typebox Schemas、低代码 settings 等——**与 NeuroBook 内部 API 强耦合，跨版本可能编译失败**，这是 minAppVersion 存在的根本原因。
- 落点（Phase 2 安装用）：系统层在 `agent/profiles/builtin/`，用户层是 `workspace/.nbook/agent/profiles/`（无 builtin 子目录）与 `workspace/.nbook/agent/skills/<name>/`，对应 server `userProfileRoot()` 约定。
- **两个 version 不要混淆**：`profileManifest.version` 是 profile 协议内部版本（如 writer 当前为 2），Workshop 的 `version` 是发布版本，二者独立演进。

Workshop 分发格式：zip 包，根部放 `nbook-package.json`：

```jsonc
{
    "manifestVersion": 1,
    "type": "skill",           // skill | profile
    "name": "my-skill",        // kebab-case；安装时的目录名 / 文件基名
    "version": 3,
    "minAppVersion": "0.5.6"   // 可选；为空表示未声明兼容下限
}
```

zip 内布局与发布约定：

- skill 包：zip 根 = `SKILL.md` + 附属文件（不要嵌套一层目录）；安装时整体落入 `skills/<name>/`。
- profile 包：zip 根 = `<name>.profile.tsx` + 可选 `<name>.home/` 目录。
- profile 常引用 skill（如 novel-workflow-* 系列）。第一版**没有依赖系统**：发布表单提示作者在 description 中列出依赖的 skill 及其工坊链接；manifest `requires` 字段留待 Phase 2 按安装闭环需要评估。
- `version` 以 manifest 为真相源、平台只校验递增，而不是平台自动分配——这样安装到本地后资产自描述，Phase 2 更新检查直接拿本地 manifest.version 与远端对比。代价是作者忘 bump 会被拒，拒绝报错必须直接指出"请把 manifest version 改为 N+1"。

服务端上传校验——**第一版只做功能正确性所需的数据校验，不做安全防范**（安全项全部记入 TODO 安全债清单）：

1. manifest 存在、字段合法（type 枚举、name kebab-case、version 正整数）。
2. manifest 与条目一致性：非首个版本时，manifest.type / manifest.name 必须与条目现有值一致（防止 v1 是 skill、v2 变成 profile 的脏数据）。
3. 按 type 校验入口存在：skill 必须有 `SKILL.md`；profile 必须有 `<name>.profile.tsx`。
4. 新版本 version 必须大于该条目当前最新 version。
5. 服务端计算并落库 sha256。

账号口径：不收集邮箱，无自助密码找回——忘密码 = 联系 admin 手动重置。这是刻意的隐私与复杂度简化，注册页需写明。

### API 面（v1）

公开（无需账号）：

- `GET /api/v1/items`：分页列表，支持 `q` / `type` / `tags` / `sort`（latest | downloads | likes）。
- `GET /api/v1/items/:slug`：详情。
- `GET /api/v1/items/:slug/versions`：版本历史。
- `GET /api/v1/items/:slug/download?version=`：下载 zip，缺省最新版；递增 downloadCount。
- `GET /api/v1/items/:slug/comments`：评论列表（分页，过滤软删）。
- `GET /api/v1/users/:username`：作者公开页数据（资料 + 其发布的条目列表）。
- `GET /api/v1/meta`：平台版本、上传限制等元信息，预留客户端握手。

登录（session）：

- `POST /api/v1/items`：创建条目（元数据）。
- `POST /api/v1/items/:slug/versions`：上传新版本 zip（multipart）。
- `PATCH /api/v1/items/:slug`：作者编辑元数据 / 自主下架与重新上架（`unlisted` ↔ `published`，不可触碰 `removed`）。
- `PUT / DELETE /api/v1/items/:slug/like`：点赞 / 取消。
- `PUT / DELETE /api/v1/items/:slug/favorite`：收藏 / 取消。
- `GET /api/v1/me/favorites`：我的收藏列表。
- `POST /api/v1/items/:slug/comments`：发表评论（纯文本）。
- `DELETE /api/v1/comments/:id`：删除评论（本人或 admin，软删）。
- `POST /api/v1/items/:slug/report`：举报。
- 注册接口改造为必须携带有效邀请码。

admin：

- `PATCH /api/v1/admin/items/:id/status`：admin 下架（`removed`）/ 恢复。
- `GET /api/v1/admin/reports`：举报列表与处理。
- `POST /api/v1/admin/invite-codes`：签发邀请码。

### Web 页面

- `/`：浏览列表（搜索、type/tag 筛选、排序）。
- `/items/:slug`：详情（markdown 描述、版本历史、下载、点赞、收藏、举报、评论区；profile 类型固定警示条）。
- `/users/:username`：作者公开页（该作者全部发布）。
- `/publish`：上传页（选 zip → 服务端解析 manifest 预填 → 补充元数据提交）。
- `/me`：我的发布（编辑、传新版本、自主下架 / 重新上架）+ 我的收藏。
- `/login` / `/register`（邀请码）。
- `/admin`：邀请码签发、举报处理、下架、删评论。

### Phase 2 蓝图（NeuroBook 集成，本任务不做）

- NeuroBook 设置中的 Workshop 服务地址：默认官方实例，允许用户替换为自部署实例。
- 客户端安装：粘贴链接 / ID → 下载 → sha256 校验 → zip slip 防护解压 → 落 Workspace Root `.nbook`；profile 等代码档安装前显式警示。
- 最小安装记账 `workspace/.nbook/workshop/installed.json`（itemId / version / 文件清单）：第一版口径"只装不卸、用户手动删"，但记账为将来更新检查留底。
- **安装同名冲突语义必须显式设计**：workshop 包的 name 可能与本地已有 skill / profile 同名（包括 bundled 官方资产——比如有人上传名为 `llmlint` 的包），静默覆盖不可接受；与 user-assets sync"受管 / 手改副本"冲突规则的第三种来源（workshop-managed）一起定。
- 客户端内打包上传 + PAT token 更靠后。

### 已知局限（第一版明确接受）

- **无任何安全防线**（用户决策：完全信任用户）：zip 炸弹可打满磁盘、恶意 zip 条目路径可逃逸、description 可注入脚本、接口可被脚本刷。全部风险点已逐条列入 TODO 安全债清单，公网开放前必须回补。
- downloadCount 裸计数、不去重，`sort=downloads` 排序可被刷量。
- minAppVersion 由作者手填，Web 上传场景下作者通常不知道确切兼容下限，大概率留空——第一版只展示不承诺；Phase 2 客户端打包时自动填当时的 NeuroBook 版本才可靠。
- tag 是自由文本，中文 / 大小写 / 同义词会分裂（如「写作」vs「writing」）；第一版接受，热门 tag 固化后再考虑受控词表。
- slug 先到先得存在抢注风险，社区规模小时接受。

## Phase 1 Backend Goal（执行指令）

> 2026-07-05 定稿。范围 = 后端（数据层 + DTO + API v1），不做 web 页面。可直接作为 /goal 交给执行者。

```text
/goal 在 C:\Users\<user>\Documents\CodeRepository\GithubProjects\nb-workshop 建成 NeuroBook Workshop 第一版后端（只做数据层 + DTO + API v1，不做 web 页面 UI），主体流程端到端跑通：admin 签发邀请码 → 邀请码注册 → 登录 → 创建条目 → 上传 skill / profile zip 版本 → 公开列表 / 详情 / 版本列表可见 → 下载且字节与上传一致 → 点赞 / 收藏 / 评论 / 举报 → 作者 unlisted 与 admin removed 后公开面不可达。

设计真相源是 neuro-book 仓 docs/tasks/88-workshop-platform/README.md（数据模型、manifest 约定、API v1 清单、安全债边界）。实现与文档冲突或发现设计缺口时，停下报告，不要自行改设计、不要用 hack 绕过。

验证面：
- bun install --frozen-lockfile / typecheck / test / build 全绿；DATABASE_URL 指向临时 SQLite 时 bun run db:setup 非交互通过。
- 主体流程用真实 HTTP 集成测试证明（起 dev / preview server 或 Nitro 测试环境走 /api/v1/*，不允许只直调内部函数替代）。
- 上传数据校验单测：缺 manifest、字段非法、entry 缺失、version 不递增、非首版 type/name 与条目不一致，全部拒绝且报错信息可读（version 拒绝要提示应改为 N+1）。

范围与约束：
- 从 nb-fullstack-template 派生新仓；先在 ../nb-ui 执行 bun link（模板依赖 link:@notnotype/nb-ui 才能安装）。不修改 neuro-book / nb-fullstack-template / nb-ui 三仓的代码；neuro-book 仓只允许最后回填 docs/tasks/88 与 PROJECT-STATUS.md 文档。
- Prisma 模型按 88 文档：InviteCode、WorkshopItem（含安装名 name、status 三态 published/unlisted/removed）、ItemVersion、Like、Favorite、Comment（纯文本、软删）、Report；User 沿用模板。
- API 按 88 文档 v1 清单实现，分页返回结构对齐 NeuroBook 的 Page 惯例（Task 73）。
- 上传只做数据正确性校验（manifest 合法、非首版 type/name 一致、entry 存在、version 递增、sha256 落库）；安全债清单项（zip slip / bomb / symlink / sanitize / 频率限制 / 防爆破 / 计数去重）明确不实现，也不要顺手实现。
- zip 文件落盘 WORKSHOP_FILES_DIR（默认 ./data/files，进 .env.example），布局 <filesDir>/<itemId>/<version>.zip。
- DTO 全部 zod 且类型完整（禁 any / unknown / Record<string, unknown>），沿用模板 server/utils/dto.ts 模式；4 空格缩进；接口与函数写中文注释。
- 测试 fixture：skill 包可拷贝 neuro-book assets 的 stop-slop；profile 包手工构造最小样本（<name>.profile.tsx + <name>.home/），不要拷贝 writer.profile.tsx（内含不宜带入新仓的默认提示词内容）。

迭代策略：按 schema → DTO → API → 集成测试的顺序推进，每完成一个模块跑 typecheck + 相关测试再前进；round-trip 失败时先用单测缩小到具体 API 再回集成层；单次补丁不超过 800 行，按模块拆分。

阻塞停止条件：bun link / Prisma 迁移 / dev server 在环境层面反复失败（Task 85 记录过 migrate 卡死先例），或无法既遵循 88 文档又跑通流程时——停止并报告已尝试路径、证据、阻塞点和需要的决策输入。

完成后回填 neuro-book 仓 docs/tasks/88-workshop-platform/README.md 的 Implementation Walkthrough 与 Verification（实际结果与计划的出入要写明），并同步 PROJECT-STATUS.md 任务行状态。
```



## Verification / Test

2026-07-05 Phase 1 后端验收结果（对照计划逐条回填）：

- ✅ `nb-workshop`：`bun install --frozen-lockfile` / `typecheck`（nuxt prepare + prisma generate + vue-tsc）/ `test` / `build` 全绿；`DATABASE_URL` 指向临时 SQLite 时 `bun run db:setup` 非交互通过（两个迁移应用 + 默认 admin 创建）。
- ✅ 测试总量 40 用例全绿：模板遗留 4（password 1 + auth DTO 3，后者已按邀请码改造更新）+ 包校验单测 16 + 真实 HTTP 集成测试 20（17 条主链 + 审查修复轮新增并发双码注册 / 并发同版本上传字节一致性 / 下架后撤销收藏点赞 3 条）。
- ✅ round-trip 冒烟 × 2（集成测试内完成）：skill 用真实 stop-slop（从 neuro-book assets 拷贝为 fixture，SKILL.md + references/ 共 4 文件）上传 v1/v2；profile 用手工构造的最小样本 `mini-writer`（`mini-writer.profile.tsx` + `mini-writer.home/notes.md`）——**与计划的出入**：计划写"真实 profile 如 writer"，goal 定稿时明确改为手工最小样本，因 `writer.profile.tsx` 内含不宜带入新仓的默认提示词内容。下载验证：sha256 与上传字节一致（v2 与 v1 分别对比）、解压后 entry 集合与 SKILL.md 字节与 fixture 一致、`version=99` 404、downloadCount 递增。
- ✅ 数据校验单测（`tests/workshop-package.test.ts`）：非法 zip / 缺 manifest / 非法 JSON / manifestVersion≠1 / type 非法 / name 非 kebab-case / version 非正整数 / skill 缺 SKILL.md / profile 缺 `<name>.profile.tsx` 全部拒绝；version 不递增的报错直接提示"请把 manifest version 改为 N+1"（latest=2 提示改为 3、latest=5 提示改为 6，允许跳号放行）。集成层另证五类上传拒绝走真实 multipart 同样生效。
- ✅ 邀请码：无码 / 错码注册 400，有效码注册成功且码作废（复用同码二次注册被拒）；admin 才能签码（非 admin 403）。
- ✅ status 权限：作者 unlisted 后公开列表 / 详情 / 下载三处 404，作者可自行恢复 published；admin `removed` 后作者 PATCH / 上传均 403（报错明示"管理员下架"），admin 可恢复。
- ✅ 社区功能：点赞 / 取消幂等（重复 PUT 计数不变）、likeCount 与 viewer 状态正确；收藏后 `GET /me/favorites` 可见、取消后消失；评论发表可见、他人删 403、本人与 admin 可软删、软删后列表与 commentCount 归零；举报落库、admin 列表可见并 resolve（幂等保留首次处理时间）。
- ⬜ 种子内容：未做（上线前动作，随部署一起，TODO 保留）。

2026-07-06 Web 前端验收结果：

- ✅ `nb-workshop`：`typecheck`（nuxt prepare + prisma generate + vue-tsc）0 error；`build` 产物含新增 `me/items.get.mjs`，全部页面 / 组件与 UnoCSS `i-lucide-*` 类解析通过。
- ✅ `test`：4 文件 **41 用例**全绿（原 40 + 新增 `/me/items` 集成用例，证明 unlisted 条目对作者 `GET /api/v1/me/items` 可见、对公开 `GET /api/v1/items` 不可见，未登录 401，各用户只见自己条目）。
- ✅ 页面全量落地：`/` 浏览（筛选态映射 URL query）、`/items/:slug` 详情（双栏 + sticky 下载栏 + 点赞/收藏乐观更新 + 举报 + 评论区 + 404 整页态）、`/users/:username`、`/publish` 四步向导（前端 fflate 解析 manifest + createdItem 重试防 slug 409）、`/me`（发布/收藏两 Tab）、`/admin`（邀请码/举报/条目管理 + 非 admin 拦截）、`/login`+`/register`（补邀请码）。
- ⬜ 浏览器验证：未做（按项目规约不自动跑浏览器验证，交用户手动验收）。

## Implementation Walkthrough

- 2026-07-29：Task 01 系统性收口覆盖旧结论：Skill / Workflow 安装身份使用 kebab-case，Profile 保留点分 key，三类都只以 `package.json.name` 为安装身份；不新增 alias。首版改为不可公开草稿加原子版本提交，旧包迁移增加确定性 sidecar、只读 preflight、启动 guard 与 readiness。本文后续 2026-07-05 记录继续作为历史过程，不再作为现行协议。
- 2026-07-05：需求讨论与设计定稿，本文档落档。代码未开始。
- 2026-07-05：设计审查查漏补缺。安全面补 zip bomb（解压总大小 / 条目数上限）、symlink 条目拒绝、markdown sanitize、登录防爆破；数据面补 `WorkshopItem.name` 入库（安装名一等字段）、status 升三态（published / unlisted / removed）、非首版 manifest type/name 一致性校验、version 真相源理由；产品面补 profile 依赖 skill 的 description 约定、种子内容策略、Phase 2 安装同名冲突语义；验收面补 profile round-trip 与新增拒绝用例；新增"已知局限"小节（刷量 / minAppVersion 手填 / tag 分裂 / slug 抢注）。
- 2026-07-05：二轮范围调整（用户决策）。① 资产格式按仓库实物确认并写入文档：skill = `agent/skills/<name>/` 目录（SKILL.md frontmatter name/description/when_to_use + 附属，轻至单文件重至 llmlint 完整 runtime package）；profile = `profiles/builtin/<key>.profile.tsx` + 可选 `<key>.home/`，DSL import `nbook/server/...` 内部 API 强耦合 NeuroBook 版本，用户层落点 `workspace/.nbook/agent/profiles|skills/`，`profileManifest.version` 与 Workshop version 独立。② 第一版完全信任用户：全部安全防线（zip slip / bomb / symlink / sanitize / 频率 / 防爆破 / 计数去重）从实现范围移除，改为 TODO 安全债清单，按"公网开放前 / Phase 2 客户端安装前"两个门回补；上传只保留数据正确性校验。③ 文件存储确认本地磁盘并配置化：`WORKSHOP_FILES_DIR`（默认 `./data/files`）。④ 社区功能扩充：新增评论（扁平一级、纯文本、软删、admin 兜底）、收藏（Favorite 表 + `/me` 列表）、作者公开页（`/users/:username`），点赞保留并与收藏分工。
- 2026-07-05：定稿 Phase 1 Backend Goal 执行指令（见上方专节）：范围收敛为后端数据层 + DTO + API v1，主体流程以真实 HTTP 集成测试跑通为完成标准，web 页面 UI 留待下一阶段。
- 2026-07-05：**Phase 1 后端实施完成**（`nb-workshop` 仓）。交付：Prisma schema 扩展（InviteCode / WorkshopItem / ItemVersion / Like / Favorite / Comment / Report + 两个枚举）与手写迁移 SQL（沿用 Task 85 结论：`migrate deploy` 绕开 Windows 下 `migrate dev` 卡死）；共享 DTO `shared/dto/workshop.dto.ts`（纯类型）+ 请求 schema `server/utils/workshop-dto.ts`（zod，全中文报错）；`server/utils/workshop-package.ts`（fflate 解 zip + manifest 校验 + `assertUploadAllowed` 纯函数）、`workshop-files.ts`（`WORKSHOP_FILES_DIR` 落盘）、`workshop.ts`（DTO 映射 + 权限 helper）；API v1 路由 20 个文件（公开 / 登录 / admin 三层，分页对齐 Task 73 Page 惯例）；模板 register 改造为邀请码消费（事务内建用户 + 作废码）；测试 fixture（skill=stop-slop 拷贝、profile=手工 mini-writer）+ 包校验单测 16 + 真实 HTTP 集成测试 17（build 产物 spawn `node .output/server/index.mjs`、临时 SQLite + 临时文件目录、手写 CookieJar、FormData multipart 上传）。**实现与计划的出入与补充决策**：
    1. **manifest.name kebab-case vs 真实 builtin profile key 带点**（如 `leader.default`）：按文档 kebab-case 执行；真实 builtin profile 若要上架需改名或放宽约束，留给 Phase 2 客户端集成时定命名迁移策略。
    2. **首版上传也校验 manifest.type 与条目 type 一致**：文档条款 2 只约束非首版，但条目创建时已声明 type，首版 manifest.type 不一致同属脏数据，实现上一并拒绝（数据正确性的自然推论）。
    3. **admin reports 处理端点具体化**：文档只写"举报列表与处理"，实现补充为 `POST /api/v1/admin/reports/:id/resolve`（幂等，保留首次处理时间），列表按未处理优先 + 时间倒序。
    4. **`GET /me/favorites` 过滤非 published 条目**：与公开面口径一致，收藏的条目被下架后从列表消失而非泄露。
    5. **API 清单缺 `GET /me/items`**：作者管理自己条目（含 unlisted 状态）需要它，本版未加（不自行扩设计），Web 阶段按页面需要补。
    6. **Prisma SQLite 不支持 `createMany skipDuplicates`**：点赞 / 收藏幂等改为 `create` + 捕获 P2002 唯一约束冲突；计数只在真正新建 / 删除时增减。
    7. **Windows 部署坑（基座缺口，按 goal 约束在 Workshop 仓内补齐、未倒灌模板仓）**：Prisma 7 生成 client 顶层 `globalThis['__dirname'] = path.dirname(fileURLToPath(import.meta.url))` 被 nitro bundle 后 `import.meta.url` 变为虚拟入口 `file:///_entry.js`，Windows `fileURLToPath` 抛 `ERR_INVALID_FILE_URL_PATH` 导致 server 启动即崩（Linux 无害，故模板 Docker 部署从未暴露）。修复：`nuxt.config.ts` 加 build-time rollup transform（`patch-prisma-generated-dirname`）给该行包 try/catch 兜底；driver adapter 模式下该 `__dirname` 不用于定位引擎文件，兜底安全。Prisma 升级若生成形态变化，集成测试会在启动阶段直接暴露。
    8. **新仓首次 `db:setup` 前必须先 `nuxt prepare`**：prisma.config.ts 加载链依赖 `.nuxt/tsconfig.json`，模板 dev/build/typecheck 脚本都自带 prepare、唯独 db:setup 不带，全新 clone 直接跑会报错——模板可改进点，本轮未动模板仓。
    9. 集成测试形态：goal 允许"dev / preview server 或 Nitro 测试环境"，实际采用 build 产物 spawn（最接近生产形态，顺带逼出了第 7 条 Windows 崩溃）。
- 2026-07-05：**实现后审查 + 修复轮**。审查方法：API 清单 / 数据模型逐条对照文档核对（无遗漏）+ 全路由代码审查 + 真实 server 链路走查脚本（39 条集成测试未覆盖的边角链路全通过，脚本留存 `nb-workshop/.agent/review/walk.ts`）。审查发现并修复 5 项：
    1. **邀请码并发双花**（`register.post.ts`）：原实现"先查后写"两步间无锁，同一码并发注册可一码两用。修复为事务内条件更新（`updateMany` 加 `usedById: null`，count=0 抛错回滚），并发同名注册撞 username 唯一约束时转 409。
    2. **同版本并发上传字节与记录不一致**（`versions.post.ts`）：原实现先落盘后写库，并发上传同版本时文件互相覆盖而库记录只属其一，下载 sha256 校验必炸。修复为**先写库后落盘**——输者撞 `(itemId, version)` 唯一约束（转 409）根本不落盘，磁盘字节永远与库内 sha256 对应同一次上传；落盘失败时补偿删除版本记录（name 不回滚，下次首版上传自愈）。
    3. 建条目 slug 并发抢注撞唯一约束时 500 → 409（保留预检查做友好报错）。
    4. **下架条目的收藏/点赞撤不掉**：取消收藏 / 取消点赞原走 `requirePublishedItem`，条目 unlisted/removed 后用户的收藏"在 `/me/favorites` 看不见、又删不掉"成幽灵记录。新增 `requireItemBySlug`（不限 status，仅限"撤销自己既有关系"类操作使用），两个 DELETE 端点改用；PUT（建立关系）仍要求 published。
    5. `meta` 补 `platformVersion`（package.json version），补全文档"平台版本"承诺。
    未修（审查记录在案）：admin 恢复 removed 条目强制回 published（作者原 unlisted 意愿丢失，语义留 Web 阶段定）；`users/:username` 条目列表不分页（作者条目少，第一版接受）；tag 含逗号无法被逗号分隔的筛选参数命中（tag 自由文本已知局限）。验证：typecheck / build 全绿，测试 37 → **40**（新增并发双码注册、并发同版本上传字节一致性、下架后撤销收藏点赞三个集成用例），全部通过。
- 2026-07-06：**Web 前端实施完成**（`nb-workshop` 仓，7 波次一次做完；设计规范与落地 walkthrough 落 nb-workshop `docs/tasks/web-ui/README.md`）。设计经用户预览选定：列表卡片网格 / 发布分步向导 / 详情双栏右侧 sticky 下载栏 / 全量页面本轮做完。交付：Nuxt 4 SPA 全量页面（`/` 浏览、`/items/:slug` 详情、`/users/:username` 作者页、`/publish` 四步向导、`/me` 个人页、`/admin` 控制台、`/login`+`/register`）+ 类型化 `useWorkshopApi`（单一 `$fetch` 出口，入出参取 `shared/dto`）+ 共享组件（ItemCard / ItemTypeBadge / ExecutableWarning / TagChips / StateBlock / ItemComments / MyItemManageCard）+ 应用壳（AppHeader 登录态切换、layout、主题）。**落地决策与本次补充**：
    1. **图标走 `unocss:{icons:true}` module flag**（不新建 `uno.config.ts`），避免动到模板已依赖的 wind3 utilities。
    2. **description / 评论纯文本渲染**（`whitespace-pre-wrap`，不解析 markdown / 不渲染 raw HTML）：88 文档把 markdown sanitize 列为门 A 安全债，纯文本天然规避存储型 XSS、零新依赖，门 A 加固时再引入 sanitized markdown。
    3. **修既有失效**：`register.vue` 未发 `inviteCode`，后端已把邀请码设为必填 → 老注册页对新后端已失效，本轮补邀请码字段。
    4. **后端补口 `GET /api/v1/me/items`**：本人全部状态条目分页（含 unlisted / removed），补上第 5 条记录的 Web 阶段缺口；按 goal 约束在 Workshop 仓内补齐，加集成用例证明 unlisted 对作者可见、对公开面不可见。
    5. **发布向导两阶段失败安全**：`createItem` → `uploadVersion` 两步，用 `createdItem` ref 记住已建条目，重试只补上传、跳过创建，避免 slug 抢注 409。前端 `fflate` 就地解析 manifest 只为早暴露错误，真相源仍是后端校验。
    6. 实现中修复：index.vue 的 `route.query` 联合类型不收窄到字面量（改三元直接返回 `"skill"`/`"profile"` 字面量）；IconButton 无 `ghost` variant（删评论按钮改 `danger`）；publish.vue 误写恒真的 `ExecutableWarning` 判定（删除）。
  验证：typecheck / build / test（41 用例）全绿，见 Verification 节。**未做浏览器验证**（按规约交用户手动验收）。
- 2026-07-06：**友好上传改造**（`nb-workshop` 仓；落地细节见 web-ui walkthrough）。用户反馈"只能传压缩包不友好"，希望简单资产提供编辑页面（profile 只传一个 profile 文件、skill 只传目录压缩包）。设计原则：canonical 包格式（zip + 根部 `nbook-package.json`）作为存储 / 下载 / Phase 2 安装契约**保持不变、后端零改动**；只在前端加友好输入方式，用 `fflate` 就地打成 canonical zip 再走现有 `createItem` + `uploadVersion`，后端 `parseWorkshopPackage` 仍是校验真相源。**用户决策**：在线编辑用 CodeMirror（非纯 textarea）+ 保留"完整包"高级模式作回退。落地：
    1. 输入方式——profile：在线编辑 `.tsx` / 上传单文件；skill：在线编辑 `SKILL.md`（覆盖多数单文件 skill）/ 上传目录压缩包（无需 manifest）；完整包模式：上传自带 manifest 的 canonical zip，type/name/version 取自其 manifest。
    2. manifest 由发布表单**自动生成**、version **平台自增**（新建 1，`/me` 传新版 latest+1），简单模式安装名 = slug；profile 入口文件名由平台按 name 生成，顺带**绕开第 219 行记录的 builtin key 带点 vs kebab-case 冲突**（平台重命名入口即可，用户原文件名无所谓）。
    3. 目录压缩包**自动剥离单层顶层文件夹**（Windows 右键压缩文件夹产生 `my-skill/` 前缀）并覆盖用户自带旧 manifest（表单为真相源）。
    4. 新增前端产物：`app/utils/workshop-package.ts`（客户端打包）、`CodeEditor.vue`（CodeMirror 6 包装，仅客户端挂载）、`PackageContentInput.vue`（输入 UI，发布向导与 `/me` 复用）；改造 `publish.vue`（向导重构为 类型与来源 → 元数据 → 确认 → 发布）与 `MyItemManageCard.vue`（传新版本接入同组件 + 自动版本号）。避坑：bun 首装 `codemirror` 元包目录空（Windows 抽取 glitch），删除重装修复。
  验证：typecheck 0 error / build 通过（CodeMirror 正常打包）/ test **41 → 50**（新增 `workshop-package-client.test.ts` 9 用例，含"客户端生成的包被后端 `parseWorkshopPackage` 接受"跨端契约）。**未做浏览器验证**。

## TODO / Follow-ups

- [x] 创建 sibling 仓 `nb-workshop`（从 `nb-fullstack-template` 派生），实现第一版**后端**（2026-07-05 完成，见 Implementation Walkthrough）。
- [x] Workshop Web 页面 UI（列表 / 详情 / 上传 / `/me` / admin 面板，见 Design 的 Web 页面节）：2026-07-06 完成，全量页面一次做完，已补后端 `GET /api/v1/me/items`（见 Implementation Walkthrough / Verification 与 nb-workshop `docs/tasks/web-ui/README.md`）。
- [x] 友好上传改造（在线编辑 / 单文件 / 目录压缩包，平台生成 manifest + 自增 version，保留完整包高级模式）：2026-07-06 完成，后端零改动，测试 41→50（见 Implementation Walkthrough）。
- [ ] 对外发放邀请码前完成 ToS 文案：上传即授权平台分发、下架权、内容免责，以及**下载内容的使用许可口径**（下载者能拿这些内容做什么，第一版在 ToS 统一约定，不做逐条目 license 字段）。Task 128 的 owner-only 私有内测不自动开放此 Gate。
- [ ] 对外发放邀请码前完成官方站异地备份：数据库与文件必须来自同一停写窗口或可证明一致的快照，并完成异机恢复。Task 128 按用户决策暂不做生产主机 → 测试主机站点备份，只接受 owner-only 内测；生产主机整盘丢失风险不能带入公开邀请。
- [ ] 实现时：分页返回结构对齐 NeuroBook 的 `Page` 惯例（Task 73），降低 Phase 2 客户端接入的心智成本。
- [ ] Phase 2：NeuroBook 客户端安装闭环（另立任务，含 installed.json、代码档警示、安装路径约定、同名冲突语义、user-assets sync 第三来源、manifest `requires` 依赖字段评估）。
- [ ] Phase 2+：PAT / API token、更新检查接口（如 `batch-latest`）、更多资产类型（lorebook / 角色卡 / project 模板 / World Engine schema）按需评估。

### 安全债清单（第一版明确不做；按两个门分批回补）

**门 A：对外发放邀请码前全部回补**。Task 128 的生产主机私有内测会提前完成其中会威胁主机可用性的上传大小、zip bomb、解析库与上传/评论限频；其余项仍留在 Public Invite Gate。checkbox 保持未完成，直到代码与拒绝用例落地：

- [ ] 上传大小上限（multipart 层，默认建议 20MB）——否则任意大文件直接打满磁盘。
- [ ] zip bomb 解压防护：解压后总大小上限（建议 100MB）+ 条目数上限（建议 500）——服务端解析 manifest 必须解包，缺这层平台自己先被炸。
- [x] markdown sanitize：详情页 description 已使用 marked + DOMPurify，外链强制安全属性。
- [x] 登录防爆破（Task 119 已完成）。
- [ ] 上传 / 评论频率限制由 Task 128 接管。
- [ ] 下载计数去重（防刷量，IP + 条目窗口级即可）。
- [ ] zip 解析库选型复核 symlink 识别与流式大小控制能力（做防护时的前置调研）。

**门 B：Phase 2 客户端自动安装上线前必须回补**（此时是功能正确性而非加固）：

- [ ] zip slip：拒绝 `../` 与绝对路径条目——客户端自动解压时恶意条目可写到用户磁盘任意位置。
- [ ] symlink 条目拒绝（只允许普通文件）——zip slip 之外的第二条路径逃逸向量；服务端与客户端解压执行同一规则。
- [ ] 下载安装链路的 sha256 校验落地（服务端已存值，客户端安装时必须真的验）。
