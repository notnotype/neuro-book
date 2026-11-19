# llmlint 检测数据 Web 采集（Detection-Data Web）

> 采集**判定标签**（人类主观"AI 味 / 好不好"）的 web 站。这是 reference/render 之外的**第三类数据源**，喂评测第 ② 层（产品成绩单）与规则精度，**永不混进 lift**（见 [CONTEXT.md](../../../CONTEXT.md) 不变量 D1）。
> 术语见 [CONTEXT.md §2.5](../../../CONTEXT.md#25-检测数据--标注category-③)；评测方法论见 [evals/METHODOLOGY.md](../../../evals/METHODOLOGY.md)；数据源关系见 [Task 03 Eval Harness](../03-llmlint-eval-harness/README.md)。

# llmlint 检测数据 Web 采集（Detection-Data Web）

> 本文保留早期采集站 schema 与流程设计；2026-08-14 t133 已将实现切换为独立 Node/Nitro 服务 + NeuroBook 官方 OAuth SSO，文中的 password login/register/admin seed、注册后才可用和旧 MachineRecord 仅作为历史记录，不代表当前生产合同。当前实现与生产部署以 [Task 13](../13-web-five-step-flow/README.md) t133 记录、`web/README.md` 和代码为准。

## User Request / Topic

评测分 A（判别器/检测器，来源标签，客观）与 B（降 AI 味，判定标签，主观）两个目标。先做 A，但 A 只能靠“人类主观判定”闭环收敛到产品。为此建一个 web 站，让用户上传小说正文、给出**结构化打分 + 自然语言“哪里写得不好”**，作为判定标签数据源。后续用户还能公布正文、他人参与打分（众包）。

## Goal

建成**判定标签采集管线**：用户通过官方账号 SSO 进入 → 上传正文 → 盲评打分 → 揭示检测报告 → 可选逐 span NL 标注 → 落库。产出喂评测第 ② 层与规则精度校准。

- **Outcome**：一套 schema + web 流程，稳定产出 `DocJudgment`（doc 级两轴）与 `SpanAnnotation`（span 级 NL），可后处理成规则精度/召回信号。
- **边界**：这套数据是 category ③（判定），**不进 reference/render 的 lift**（不变量 D1）。
- **合规**：用户上传第三方正文需 consent + 保留策略；法律风险归用户。
- **当前认证边界**：生产不提供本地密码登录、注册或 admin seed；llmlint 建立自己的 host-only sealed session，不共享官方 Cookie、ID token、refresh token 或 SQLite。

## Decisions（已定）

- **两目标分离**：A=来源标签（客观、免费、可规模化，喂 lift）；B=判定标签（主观、贵、小，喂产品）。本 web 产 B。
- **三类数据别混池**：① reference（人类，策展）② render（AI，生成管线）③ 检测数据（web，判定标签，来源未知/自述）。③ 只喂 B。
- **四条分离**（schema 硬约束）：③⟂①②（不进 lift）、文本⟂判定（一文多评、众包就绪）、人⟂机（盲评先落、机器后揭，防锚定）、原始⟂结构化（NL 原样存、LLM 结构化派生）。
- **doc 级只两轴**：`aiFlavor 0–5` + `wantReadOn 0–5`；信心/流畅/逻辑/创意等不进采集合同。
- **认证历史**：后文旧 password auth 章节描述最初原型；当前生产只使用 NeuroBook OAuth Authorization Code + PKCE `S256`，官方 ID 通过 `User.neuroBookUserId` 映射本地用户，历史外键不迁移。

## 数据 schema（zod）

```typescript
import {z} from "zod";

// llmlint 检测数据（category ③）web 采集 schema。zod 定义 + z.infer 出类型。
// 铁律：③ 只喂 B（判定/规则精度），永不混进 ①②的 lift；人⟂机盲评先落、原始 NL ⟂ 结构化派生。

// —— enum | string：已知集合优先，允许 LLM 产出新值 ——
export const Genre = z.enum(["xuanhuan", "xianxia", "dushi", "guyan", "xianyan", "kehuan", "xuanyi", "lishi", "light-novel", "literary"]);
export const Pov = z.enum(["first", "third", "omniscient", "second"]);
export const TextType = z.enum(["novel", "prose", "script", "other"]);
const enumOrString = <T extends z.ZodTypeAny>(e: T) => z.union([e, z.string()]);

// —— 用户（web 需注册才能用 → 一等实体，主观按用户结构化）——
export const UserRole = z.enum(["reader", "writer", "editor", "pro"]);
export const User = z.object({
    id: z.string(),                       // 注册账号 ID
    profile: z.object({role: UserRole}),  // 自述身份，低信任（calibration 后处理再算，不进 schema）
    createdAt: z.string(),
});

// —— 正文 ——
export const Provenance = z.enum(["human", "ai", "mixed", "unknown"]);
export const Text = z.object({
    id: z.string(),
    body: z.object({text: z.string(), charCount: z.number().int()}),  // charCount=可见字数（去空白）
    classification: z.object({            // 全 LLM 生成、无用户确认；元数据，允许错
        genre: enumOrString(Genre),
        pov: enumOrString(Pov),
        textType: enumOrString(TextType),
    }),
    // 判别联合替掉两个 optional：自述来源(低信任) 与 gold 真来源(隐藏) 各锁进自己分支
    origin: z.discriminatedUnion("kind", [
        z.object({kind: z.literal("user-upload"), declaredProvenance: Provenance}),
        z.object({kind: z.literal("seeded-gold"), trueProvenance: z.enum(["human", "ai"])}),
    ]),
    ownership: z.object({
        uploaderId: z.string(),                       // → User.id
        visibility: z.enum(["private", "public"]),    // public=进众包池（后置功能，字段先留）
        consent: z.boolean(),
    }),
    createdAt: z.string(),
});

// —— 文档级判定：每 (用户 × 正文 × phase) 一条 ——
export const DocJudgment = z.object({
    id: z.string(),
    textId: z.string(),
    userId: z.string(),
    scores: z.object({                                // 分数单独成层
        aiFlavor: z.number().int().min(0).max(5),     // 0=肯定人类 / 5=百分百 AI
        wantReadOn: z.number().int().min(0).max(5),   // 0=马上关 / 5=想追更
    }),
    phase: z.enum(["pre-edit", "post-edit"]),         // v1 只产 pre-edit
    blind: z.boolean(),                               // 看到机器结果前打=true；非盲不进主一致性
    createdAt: z.string(),
});

// —— span 级标注：v1 只记 NL；哪条规则命中由 LLM 后处理判 ——
export const SpanAnnotation = z.object({
    id: z.string(),
    textId: z.string(),
    userId: z.string(),
    target: z.enum(["original", "edit"]),             // 评原文（检测）/ 评优化后改动（改错了/没改好）
    span: z.object({start: z.number().int(), end: z.number().int()}),  // 码点区间
    note: z.string(),                                 // 用户 NL 建议，原样存；后续 LLM 抽"哪条规则/怎么改"
    createdAt: z.string(),
});

// —— 机器记录：与人分离，盲评后才揭示（防锚定）。命中是客户端 scanText 结果，随引擎版本入库 ——
export const MachineRecord = z.object({
    id: z.string(),
    textId: z.string(),
    scan: z.object({
        engineVersion: z.string(),                    // 浏览器 registry 版本/哈希：规则会变，不记版本命中就无法解读
        hits: z.array(z.object({
            ruleId: z.string(),
            span: z.object({start: z.number().int(), end: z.number().int()}),
            level: z.string(),
            review: z.string(),
        })),
        scannedAt: z.string(),
    }),
    edit: z.object({content: z.string()}).optional(), // null=没提供"优化"；target="edit" 的 span 锚这
    llmGuess: z.object({                              // 服务器 LLM 判 AI味；盲评时不显示给用户
        aiFlavor: z.number().int().min(0).max(5),
        note: z.string(),
    }).optional(),                                    // null=没跑 LLM 判别
    detector: z.object({                              // 外部 AIGC 检测器（机器首检第二路信号，体系环②）；同受 D2 盲评 gate
        name: z.string(),                             // 检测器标识（如 "binoculars"）
        version: z.string(),                          // 检测器/模型版本：跨版本概率不可比（同 engineVersion 的理由）
        probability: z.number().min(0).max(1),        // AI 概率
        checkedAt: z.string(),
    }).optional(),                                    // null=没接/没跑外部检测器；由服务器调用写入，不走客户端 DTO（机器信号不可伪造，D5）
});

export type User = z.infer<typeof User>;
export type Text = z.infer<typeof Text>;
export type DocJudgment = z.infer<typeof DocJudgment>;
export type SpanAnnotation = z.infer<typeof SpanAnnotation>;
export type MachineRecord = z.infer<typeof MachineRecord>;
```

## 存储 vs 请求 DTO（🔴 审查补充）

上面 zod 是**存储实体**形状。**客户端 POST 绝不能带服务器字段**——尤其 `origin`：用户若能自报 `seeded-gold` 就能伪造金标真来源、投毒校准。

**服务器职责（客户端一律不可设）**：`id`、`createdAt`/`scannedAt`、`Text.charCount`（服务器算，复用 evals 口径 `[...text.replace(/\s/gu,"")].length`）、`Text.classification`（服务器调 LLM）、`origin`（客户端流恒 `user-upload`；`seeded-gold` 只由系统注入）、`uploaderId`/`userId`（取 session，不信客户端）、`DocJudgment.phase/blind`（上传流恒 `pre-edit`/`true`）。

**请求 DTO（= 存储实体 omit 服务器字段）**：

```typescript
export const CreateTextDto = z.object({
    text: z.string().min(1).max(60_000),          // 体量上限，防超大章/滥用
    declaredProvenance: Provenance,               // 用户自述、低信任
    visibility: z.enum(["private", "public"]),
    consent: z.boolean(),
});
export const CreateJudgmentDto = z.object({textId: z.string(), aiFlavor: z.number().int().min(0).max(5), wantReadOn: z.number().int().min(0).max(5)});
export const CreateAnnotationDto = z.object({textId: z.string(), target: z.enum(["original", "edit"]), span: z.object({start: z.number().int(), end: z.number().int()}), note: z.string().min(1).max(2000)});
export const SubmitScanDto = z.object({textId: z.string(), engineVersion: z.string(), hits: z.array(z.object({ruleId: z.string(), span: z.object({start: z.number().int(), end: z.number().int()}), level: z.string(), review: z.string()}))});
```

**id 策略**：`User.id` = **Int autoincrement**（照抄 NeuroBook，auth 少改）；四张内容表 = **cuid2 字符串 id**（防枚举）。API 对外一律 `String(id)`。

**User 两种 role 别混**：存储 User = 照抄 NeuroBook（`username`/`passwordHash`/authz `role` admin|user/`status`/`sessionVersion`/时间戳）**+ 自述 `identityRole`**（reader/writer/editor/pro，即上面 zod 的 `UserRole` 改名）。上面 zod 的 `User` 只是对外 DTO、非完整存储实体。authz `role` 管导出/审核；`identityRole` 是自述身份、低信任。

**关系 / 约束（Prisma）**：`Text 1—N DocJudgment/SpanAnnotation`、`Text 1—1 MachineRecord`、`User 1—N *`；删除级联；`@@unique([userId, textId, phase])`（一人一文一 phase 一条判定，重打 = upsert）。

## 采集流程 → 落到哪张表

| 时机 | 交互 | 写入 |
|---|---|---|
| 上传 | 传正文 + 填来源(默认 unknown) + consent | `Text`（LLM 顺手填 `classification`） |
| 上传即**盲评** | 打 aiFlavor + wantReadOn | `DocJudgment{phase:pre-edit, blind:true}` |
| 揭示结果 | 显示命中 + 检测器概率（+ 可选优化版） | `MachineRecord` |
| 深度档 | 选句评论 / 指出改错 | `SpanAnnotation{target, note}` |
| 看完优化版（后续） | 再打一次分 | `DocJudgment{phase:post-edit}` |
| 后处理 | LLM 把 `note` 抽成规则/改法 | 派生表（不覆盖原 note） |

三个白赚性质：**seeded-gold** 同管子校准用户 + 测 LLM 分类；**pre/post-edit 两次打分**量"降 AI 味"效果；**declaredProvenance vs aiFlavor** 一比就是"读者被骗了没"。

## UX / 架构（v1）

**流程**（每步落哪张表）：未登录 → 注册/登录(`User`) → 上传+盲评(`Text` + `DocJudgment{blind}`) → 两栏报告+标注(`MachineRecord` + `SpanAnnotation`)。

**三屏**：
1. **注册/登录**：简单用户密码（认证栈参考 NeuroBook）。
2. **单列全宽**：大文本域(上传/粘贴) + 来源下拉(默认不确定) + consent + 两轴打分 → 提交。**此屏不显示任何命中**（打分先于报告 = 天然盲评 D2）。
3. **两栏**：左=正文+行内高亮，选中 span→评论(`SpanAnnotation`)；右=报告(揭示盲评分+命中+LLM 体裁)+命中列表(列表↔正文联动)。

**架构决策（已定）**：
- **现有 `web/` 静态 SPA 升级为全栈 Nuxt 应用**（启用 nitro server 做认证 + 数据存储），参考 NeuroBook 的 Nuxt/认证/持久化栈（NeuroBook 用 Prisma）。不新建独立 app——升级现有站、复用检测组件。
- **扫描留浏览器**：继续客户端 `scanText`，server 只管认证 + 落库、**不跑 llmlint**。盲评靠 UI gate（可被 devtools 绕过，v1 可接受）。
- **后果**：不再是纯静态 GitHub Pages —— 需 Node/serverless 宿主 + DB；Task 05 的静态 Pages 部署对"采集 app"部分作废（纯检测 playground 若要仍可静态）。

**复用**（Task 05 已有）：行内高亮、命中列表、列表↔正文联动、`scanText`。
**新建**：认证(nitro+session)、盲评 gate(关掉边打字边出结果)、布局切换、span 评论捕获、提交落库、LLM 分类调用、DB。

## 参考实现（NeuroBook 栈，已调研）

llmlint web 照搬 NeuroBook（neuro-book 仓）的全栈做法。关键发现：NeuroBook 也是 `ssr:false`(SPA) + nitro `server/api`，所以**不改 SSR、保留客户端 `scanText`、只"打开服务端"**。

**部署形态（已定）**：**单 node 应用**——一个 `nuxt build` + node 宿主同时托管公开检测 playground / `/report` / `/dataset` + 鉴权的 `/contribute` 采集流。**鉴权范围与 NeuroBook 相反**：默认公开，只 gate `/contribute` 页 + 写库 API（`/api/texts` 等）。脱离纯静态 GitHub Pages。

**栈**：Nuxt 4 `ssr:false` + nitro server/api · `nuxt-auth-utils`（密封 cookie session）· 自撸 scrypt 密码 · Prisma 7 + libSQL（`file:` 本地 SQLite）。

**照搬 / 简化 / 新增**（来源 = neuro-book 仓文件）：

| 动作 | 来源 | 备注 |
|---|---|---|
| 直接抄 | `server/utils/password.ts` | scrypt 哈希/校验（`node:crypto`，零依赖，逐字） |
| 直接抄 | `server/database/prisma.ts` | `new PrismaLibSql({url})` + `globalThis` 单例；url=`file:./data.db` |
| 抄骨架 | `server/utils/auth.ts` | `setAuthSession`/`getCurrentUser`/`requireCurrentUser`；去掉 admin 守卫/lastSeen |
| 抄模式 | `server/middleware/auth.ts` | **倒过来**：默认公开，只 gate `/contribute` + 写 API |
| 抄 | `server/api/auth/{login,logout,me}` | session 只存 `{id,username,role,sessionVersion}` |
| 简化/跳过 | 登录限流、admin-last 守卫、`isAuthEnabled` 开关、lastSeen、prisma-runtime-preflight | v1 不需要 |
| **新增** | `server/api/auth/register.post.ts` | NeuroBook 只有 CLI 建管理员；采集站要**自助注册** = 校验 + `hashUserPassword` + `user.create` + `setAuthSession` |

**依赖**：`nuxt-auth-utils` · `prisma` · `@prisma/client` · `@prisma/adapter-libsql` · `@libsql/client`（+ `zod`）。
**配置**：modules 加 `nuxt-auth-utils`；env `NUXT_SESSION_PASSWORD`(≥32 字)；build `generate`→`build`+node 宿主。

**最小文件骨架**（web/ 下新建）：

```
web/
  nuxt.config.ts               # +nuxt-auth-utils；ssr:false 保留
  prisma/schema.prisma         # datasource sqlite + generator；User + Text/DocJudgment/SpanAnnotation/MachineRecord
  server/
    database/prisma.ts         # libSQL 单例（抄）
    utils/{password,auth}.ts   # scrypt + session helpers（抄）
    middleware/auth.ts         # 只 gate /contribute + 写 API
    api/auth/{login,logout,me,register}.post.ts
    api/{texts,judgments,annotations}.post.ts   # 写库
  app/pages/contribute.vue     # 上传+盲评+两栏标注（复用现有检测组件）
```

**User 模型**：照抄 NeuroBook（`id`/`username`@unique/`passwordHash`/`role`/`status`/`sessionVersion`/时间戳）。
**注**：Prisma 是关系型——zod 的判别联合/嵌套在存储层会摊平（如 `originKind` + 可空列，或 JSON 列）；**zod 管 API 校验、Prisma 管持久化**。

## 数据导出（喂回评测第②层，🔴 审查补充）

采集是手段，**用**才是目的。落库后要能把判定标签导出喂回 [Task 03](../03-llmlint-eval-harness/README.md)：
- `GET /api/export`（管理员）或 `bun scripts/export.ts` → dump `Text + DocJudgment + SpanAnnotation + MachineRecord` 为 JSON。
- 下游：① LLM 把 `SpanAnnotation.note` 结构化成"哪条规则/怎么改"；② 对 MachineRecord 命中算 per-rule 精度（命中被判 real vs 误报，靠 span 交并）；③ 判定标签接第②层产品成绩单。
- **按 `engineVersion` 分组**：规则会变，跨版本命中不可直接比。

## Implementation Log（2026-07-01）

**状态**：v1 已落地到 `web/`，保留 `ssr:false` 和浏览器扫描，新增 Nitro API / Prisma / auth / contribute UI。

**已实现**

- 依赖与配置：`nuxt-auth-utils`、Prisma 7、libSQL adapter、zod；`nuxt.config.ts` 加 auth module；`prisma.config.ts` 默认 `DATABASE_URL=file:./data.db`。
- DB：`web/prisma/schema.prisma` 定义 `User`、`Text`、`DocJudgment`、`SpanAnnotation`、`MachineRecord`；`User.id` 为 Int autoincrement，四张内容表为 cuid2 字符串；`DocJudgment` 有 `@@unique([userId,textId,phase])`；初始化 SQL 已写入 `web/prisma/migrations/20260701000000_init_detection_data/migration.sql`；`bun run db:init` 可用 libSQL 直接应用 migration。
- 认证：`server/utils/password.ts` 使用 scrypt；`server/utils/auth.ts` 写入密封 cookie session；`server/middleware/auth.ts` 默认公开，只 gate `/contribute` 和 `/api/texts|judgments|scans|annotations|export`。
- API：`auth/login|logout|me|register`、`texts.post`、`judgments.post`、`scans.post`、`annotations.post`、`export.get`。DTO 用 zod；客户端不可提交 id/userId/uploaderId/origin/phase/blind/charCount/classification。
- UI：`/login`、`/register`、Header 登录态/登出/贡献入口、`/contribute` 上传 + 盲评 + 揭示两栏报告 + span NL 标注。
- 导出：`GET /api/export` 需要 admin，dump Text/DocJudgment/SpanAnnotation/MachineRecord，并按 `engineVersion` 分组。

**与计划的出入**

- 原计划提交序列写成 `POST /texts → scan → POST /scans → POST /judgments`；实现改为 `POST /texts → POST /judgments → 浏览器 scan → POST /scans → 揭示`，更严格满足 D2「盲评先落」。
- LLM classification 仍为 `null` stub，未接模型；这是 v1 允许的 defer。
- ~~当前本机 `bunx prisma migrate dev` / `db push` 在 schema engine 落库阶段报空的 `Schema engine error`~~（2026-07-01 复核已解决）：**根因是命令没读到 `DATABASE_URL`**——schema engine 拿不到连接串就抛一个空的 `Schema engine error`，不是 schema 本身的问题。`DATABASE_URL="file:./data.db" bunx prisma migrate dev` 干净应用、建出五张表，标准 migrate 命令可用。已加 `web/.env.example` + `web/README.md`（把这个坑写进"本地开发"），并把 `.env`/`data.db*` 补进 `web/.gitignore`。

**验证**

- `bun install`：依赖安装成功，锁文件已更新。
- `bunx prisma generate`：通过，生成 `web/server/generated/prisma`。
- `bun run typecheck`：通过；输出一个现有 Vue 插件加载警告 `vue-router/volar/sfc-route-blocks`，退出码 0。
- `bunx nuxi typecheck`：通过；同样输出上述 Volar 插件警告。
- `bun run db:init`：临时库验证通过，能应用初始化 migration。
- dev server：`NUXT_SESSION_PASSWORD=... DATABASE_URL=file:./data.db bun run dev -- --host 127.0.0.1 --port 3020` 启动通过；公开页 `/`、`/report`、`/dataset` 返回 200；未登录 `/contribute` 返回 302；注册后 `/contribute` 返回 200；`texts/judgments/scans/annotations` API 写入通过。
- `bun run build`：client/server 编译阶段通过，但最终清理 `web/.output` 时遇到既有 `EBUSY` 文件锁，未产出完整 `.output`。
- libSQL 执行初始化迁移 SQL：通过，建出 `User/Text/DocJudgment/SpanAnnotation/MachineRecord`。
- Prisma Client + libSQL adapter 写读临时库：通过，五张核心表计数为 `1,1,1,1,1`。
- 浏览器自动化：允许后尝试 Playwright 控制本机 Chrome/Edge，但两者都卡在浏览器进程启动阶段；因此本轮未获得截图级验证，改用真实 dev server HTTP/API 路径验证。
- **端到端 API 闭环复核（2026-07-01，带 cookie jar 的 curl 跑真 Nitro server）**：`register`→`me`(authEnabled/user)→未登录 `/contribute` 302→`POST /texts`（服务器算 `charCount`、`origin` 恒 user-upload）→`POST /judgments`（落 `phase=pre-edit,blind=true`）→`POST /scans`（`MachineRecord.engineVersion=2.0.0`）→`POST /annotations`（`note` 原样）→提管理员后 `GET /export` 返回**按 engineVersion 分组**（`unscanned` / `2.0.0`）；非 admin `/export` 403。全部不变量（DTO 拆分 / 盲评 / engineVersion / NL 原样 / id 策略 / gate）运行时确认。空 `textId` 被 zod 正确拒 400（负路径也验证）。

### 2026-07-14 认证页场景化改造

- 登录与注册页改为共用 `AuthWorkspace`：左侧是真实稿件高亮、命中/批注/状态摘要和审稿印章，右侧保留原认证表单，减少原先表单外的大面积空白。
- 认证 API、字段、校验、redirect 和 session 行为不变；共用组件只负责页面外壳，登录/注册表单仍由各自页面维护。
- 计划出入：本轮只优化认证入口的视觉语境，没有扩展账号能力、注册策略或后端状态。
- 验证：1280x720 深色与浅色注册页均完整显示；390x844 下稿件与表单纵向排列，页面可滚动，`scrollWidth=375` 与可视文档宽度一致，无横向溢出。登录页同一外壳已在桌面和移动视口复核。

## 开放项 / 默认

- `target` 保留（"指出哪里改错了"要用）；v1 没上"优化"前恒 `original`。
- `enumOrString` 的 TS 推断塌成 `string`（枚举仅作文档/校验白名单）；如需类型区分再上 `.brand`。
- **后端（已定）**：现有 `web/` 升级为**单 node 全栈 Nuxt**（`ssr:false` 保留 + nitro server 做认证/存储），检测站公开、`/contribute` + 写 API 鉴权。栈=`nuxt-auth-utils` + Prisma 7 + libSQL(`file:` sqlite)；扫描留浏览器。部署换 node 宿主（脱离纯静态 Pages）。详见上「参考实现」节。
- **seeded-gold 需"被指派评分"流（🟡）**：schema 支持 gold，但当前是纯上传 UX；gold 校准需系统**发文本给用户评**的另一种模式，非上传流（gold 仍是 TODO）。
- **注册滥用（🟡）**：公开自助注册 = 垃圾账号/提交。v1 至少：密码 ≥8 位 + 注册限流（或先邀请码）；我们主动跳过了 NeuroBook 的 `login-security`。

## TODO / Follow-ups

- [ ] **Agent 优化**（"优化"功能：LLM/Agent 改写出 `editedContent`）→ 解锁 `post-edit` 打分 + `target:edit` 标注。**用户明确后置。**
- [ ] **接外部 AIGC 检测器**：server 调检测器写 `MachineRecord.detector`（趁 0 数据先落 schema，免迁移）；同受 D2 盲评 gate。
- [ ] **应用验收环（体系环 ④）**：改后送检对比（检测概率前后差）+ post-edit 人评，按 **D5 双条件**验收（检测概率降 且 `wantReadOn` 不降）；编辑面复用 Task 07。
- [ ] **众包/公开**：`visibility:public`，他人打分，一文多评 → inter-annotator 一致性、共识标签、高分歧=边界样本。
- [ ] **seeded-gold 掺入**：从 ①/② 已知来源样本混进流，校准用户 + 测 LLM 分类准确率。
- [x] **后端 + 存储**（合规的 consent 删除/保留策略仍待细化）。
- [x] `bun add zod`（实现时装）。
- [x] UX 实现（基于现有 `web/` 改：认证 + 盲评 gate + 两栏 + span 评论捕获 + 提交落库）。
- [ ] （⚪）LLM 分类的模型/prompt/失败处理（server 调、失败则 `classification` 置空、注意成本/延迟）。
- [ ] （⚪）consent 删除/保留策略（存了第三方版权正文，"删我的数据"）。
- [x] （⚪）右栏报告渲染（轻量摘要 + IssueList/FilterControls）、span 拖选评论、写 API 基础验证。
- [x] 落地后同步 `PROJECT-STATUS.md` 与本 README。

### 2026-08-14 Task 133 认证切换与生产服务器前置

- Web 认证从本地密码/注册切换为 NeuroBook 官方 OAuth Authorization Code + S256 PKCE。生产只接受 host-only `llmlint-session` sealed session；官方短时 access token 只在 callback 内存中使用，userinfo 成功后立即丢弃。
- 本地 `User.id` 及既有文本、评分、批注外键保持不变；官方用户 ID 写入 nullable `User.neuroBookUserId`。同一官方 ID 重复登录复用原本地行；username 已存在但未映射时返回 `account_mapping_conflict`，不自动合并。
- 删除本地密码登录、注册、admin seed 入口；生产配置缺失、错误或仍存在旧 `NUXT_ADMIN_USERNAME` / `NUXT_ADMIN_PASSWORD` 时 fail closed。登录关闭只保留本地开发身份，SSO start 返回 503，不降级密码认证。
- 部署前置已完成：生产服务器 Ubuntu 24.04.3 / Node / Bun 版本已核对，Linux frozen build 与真实 Node artifact smoke 通过；旧测试入口已停止。公网 DNS 已解析到 `<公网 IP>`，但 TLS vhost、443 stream、official provider migration、llmlint secret 和正式 unit 尚未完成，因此尚未回收真实 SSO 人评。
- 计划出入：原计划直接安装正式服务，但实际先发现官方公网仍返回 Nuxt HTML 且线上数据库缺少 `OAuthClient`，因此先把 OAuth client 初始化工具编译进官方生产镜像并补部署 runbook，再进行双仓 PR 与生产切换。PR #1 / PR #3 均已创建且检查通过；不自行合并。
- 代码门禁和 smoke 证据详见 `PROJECT-STATUS.md` 的 2026-08-14 t133 记录；本 walkthrough 保留流程语义，公网切换结果待后续更新。
