# 夜审运行状态

夜审循环的真相源。每轮开头全文重读，Phase 6 回写。格式契约见 `~/.claude/skills/night-audit/`。

## 本次运行

- runId: 2026-07-27-0249
- 状态: finished
- 起: 2026-07-27 02:49:52 (epoch 1785091792)
- 止: 2026-07-27 07:00:00 (epoch 1785106800)
- **实际停止: 2026-07-27 07:04:36 (epoch 1785107076)** —— 超出截止 4 分 36 秒，属「截止时间是软的」的正常表现（cron 只在 REPL 空闲时 fire，实际停止 = 截止 + 最多一轮）
- 上次唤醒: 2026-07-27 07:04:36 (epoch 1785107076)
- 已完成轮数: 13（+ 本收尾轮）
- 连续无推进轮数: 0
- 工作区基线: d2191517 130f  119 files changed, 1393 insertions(+), 2960 deletions(-)
- 上一轮基线: d2191517 130f  119 files changed, 1393 insertions(+), 2960 deletions(-) —— **两侧同口径且逐字持平**，新基线公式生效后第一次正常判定通过

> **基线口径在第 12 轮变了**：原命令把夜审自己写的文件也算进去（追踪目录占 6 行），等于拿自己的写入当别人的动静。新口径用 `git status --short -- . ":(exclude)<tracking-dir>"` 排除。
>
> 因为口径变更，本轮的「上一轮基线」不可比，按**保守方向**处理：视同已变化，不跑构建型命令。下一轮起两侧同口径，恢复正常判定。

### 本次运行的用户授权（每轮必读，不要按默认纪律行事）

用户在 2026-07-27 02:49 起循环时给了三条明确授权与告知，**它们覆盖 skill 的默认约定**：

1. **跳过 bootstrap 门禁**。用户说「直接开始执行这个 skill」并已去睡觉，Phase 0 建完地基后不停机，直接进 Phase 1。
2. **允许编辑 skill 本身**。`~/.claude/skills/night-audit/SKILL.md` 与 `REFERENCE.md` 是本次运行**除本追踪目录外唯一允许写入的地方**。用户原话：「顺便优化这个 skill（这是唯一允许编辑的地方）」。仓库业务代码仍然一行都不许动。
3. **Task 118 正在并行执行**。另一个会话此刻正在改这个仓库，见下方「并发热区」。核心纪律二全程生效。

## 项目速览

- 仓库根: `C:\Users\<user>\Documents\CodeRepository\GithubProjects\neuro-book`
- 技术栈: Nuxt 4 + Nitro + Vue 3 + TypeScript + Prisma/SQLite + Bun；测试 vitest；文档站 VitePress；部署管理器在 `packages/neuro-book-manager`
- 语言: 中文为默认交互语言，代码注释用中文
- 单轮预算: 15 分钟
- cron 间隔: 20 分钟（本次由 `/loop 20m` 指定，job id `2609cd53`，触发点 :03 / :23 / :43）
- **断线阈值: 50 分钟** —— (20 + 15) × 1.4。Phase 1 的运行身份判定用这个数，**不是 skill 正文举例的 30 分钟**。改 cron 间隔或单轮预算必须重算
- 默认运行窗口: until 07:00

### 允许命令白名单

**这张表是 Phase 4 的唯一判据。没登记的命令一律不执行。**

#### A 组 · 无条件允许（只读，不写任何文件，不受工作区基线约束）

| 命令 | 用途 | 典型耗时 |
|---|---|---|
| `git status --short` | 看工作区范围 | <1s |
| `git log --oneline -N` / `git log --stat -N` | 看近期提交 | <1s |
| `git show <ref>:<path>` | 看某文件的已提交版本，用来把「在途改动」和「已落地代码」分开 | <1s |
| `git diff --shortstat` / `git diff --stat` | 取工作区基线 | <1s |
| `git rev-parse --short HEAD` | 取基线 | <1s |
| `date +%s` / `date +%F` / `date -d ...` | 计时与运行窗口 | <1s |
| `ls` / `wc -l` / `head -c N` | 目录与文件体量勘察 | <1s |
| `node -e "..."`（纯 JSON 解析 / 纯计算，禁止 fs 写入） | 读 package.json 之类的结构化文件 | <2s |
| `grep -n` / `sed -n '<起>,<止>p'`（**只能接在管道后面读 stdin，禁止 `-i`、禁止直接对文件写**） | 在 `git show HEAD:<path>` 的输出里定位片段。热区文件必须这样读已提交版本，不能读工作副本 | <1s |

#### B1 组 · 严格条件（**会写共享的根 `.nuxt/`**，必须过完整并发闸门）

| 命令 | 用途 | 典型耗时 | 备注 |
|---|---|---|---|
| `bun run typecheck` | 全仓类型检查 | **实测 40 秒**（第 6 轮测得，原表写的 ~3-5min 是错的） | 重写 `.nuxt/tsconfig`，**与 vitest 互斥**，见噪音基线 |
| `bunx vitest run <具体路径> --testTimeout 20000` | 指定路径单测 | 视范围 | 必须带具体路径，禁止全量；同样触及 `.nuxt/` |

#### B2 组 · 宽松条件（**独立 tsconfig / 独立工作目录，不碰根 `.nuxt/`**）

| 命令 | 用途 | 典型耗时 | 备注 |
|---|---|---|---|
| `bun run manager:typecheck` | manager 包类型检查 | ~30s | 只读 `packages/neuro-book-manager/`，今夜全程冷区 |
| `bunx tsc --noEmit -p server/runtime/tsconfig.json` | runtime 子项目类型检查 | ~20s | 独立 tsconfig |

**B2 只要求「它要读的那些路径此刻没在被改」**，不要求全仓静止。理由：并发的危害来自**共享产物**（根 `.nuxt/tsconfig`）被两边互相重写，B2 不写它，唯一外溢只剩 CPU 争用。

**今夜实况**：Task 118 全程在跑，B1 组连续五轮跳过。这是设计如此，不是故障——不要为了「跑一次」去等或去重试。B2 组同样没跑，因为今夜的 finding 全是静态语义缺陷，类型检查既不能证实也不能证伪它们，跑了只是做样子。

### 并发热区（今夜）

以下路径正被别的会话改写。**在这些路径下发现的问题一律不记 finding**，最多写进「未决问题」：

| 热区 | 归属 | 说明 |
|---|---|---|
| `server/workspace-files/**` | Task 118 | ProjectSession / File Index / snapshot 发布 |
| `server/api/projects/**` | Task 118 | 控制面 Facade、`close.post.ts`、`project-control-plane.ts` 均为未提交新文件 |
| `server/workspace/**` | Task 118 | Project root 发布与 Occupancy |
| `app/composables/useProjectSession.ts` | Task 118 | 前端 session 合同 |
| `app/stores/**`（project 相关） | Task 118 | Phase 4B 未翻转，store 随时会改 |
| `scripts/db/migrate-agent-sessions-v2.ts` | Task 118 | 迁移引擎 |
| `server/agent/harness/**` | Task 118 + 126 | session header 消费面与 compaction 归因 |
| `server/agent/observability/**` | Task 126 | 上下文检查面板，含 3 个未提交新文件 |
| `app/components/novel-ide/agent/context-inspector/**` | Task 126 | 未提交新目录 |
| `shared/dto/agent-context-inspection.dto.ts` | Task 126 | 未提交新文件 |

判定方法：每轮开头 `git status --short`，凡带 `M` / `??` 标记的路径都按热区处理，上表只是今夜的先验。

## 已知噪音基线

**命中以下任何一条的现象不得记为 finding。** 这一节偷懒的代价是每晚几十条假发现。

- **全量 vitest 套件本身就是红的** —— 实测基线 41–53 个文件失败 / 169–192 个用例失败，且两次运行的用例总数能差 167 个，大量 5000ms 超时。套件处于不稳定状态（Task 123 已登记）。所以：**全量测试不许跑，跑了也不能拿失败数当证据。**
- **`server/api/` 路由测试大面积失败** —— `validateBody` 收到的 mock event 缺 `node` 字段，是套件级缺陷不是业务缺陷。
- **`server/agent/workflow/` 目录约 12 个失败** —— Task 111 的 vi API 不兼容与断言漂移，已知。
- **typecheck 的 26 项错误全在 `llmlint.test.ts`** —— **第 6 轮已实测确认**（26 项 = 25×TS2345 + 1×TS2322，全部集中在该文件，跑前跑后基线未变）。typecheck 只有在错误数 ≠ 26 或错误文件 ≠ `llmlint.test.ts` 时才值得看。根因见 F-012。
- **typecheck 与 vitest 不能并发** —— nuxt 会重写 `.nuxt/tsconfig`，两边都拿到假失败。今夜别的会话可能正在跑其中之一。
- **`server/agent/harness` 有 5 个稳定失败** —— Task 126 已用 `git show HEAD:` 比对确认属于他人未提交的在途工作；另有 1 个 `abort clearQueue` 抖动。
- **CRLF/LF 警告** —— `warning: in the working copy of ..., LF will be replaced by CRLF`，Windows 环境常态。
- **`dist/`、`.output/`、`.nuxt/`、`node_modules/`、`workspace/`、`product/` 下的内容** —— 构建产物与运行时数据，不是源码，不审。
- **`workspace/ming-ding-zhi-shi-2`** —— legacy RP 导入项目，不是验收样本。
- **已归档目录**（`docs/archived/**`、`docs/tasks/archived/**`、`assets/**/templates/archived/**`）—— 明知过期，不审。

## 覆盖率地图

风险评级来自：模块体量 × 最近变更频率 × 出事后果。全部初值为 `未检查`。

| 模块 | 上次检查 | 轮次 | 结论 | 风险 |
|---|---|---|---|---|
| `packages/neuro-book-manager/` | 2026-07-27 | 01 | 部分：`process.ts` 全文 + `health.ts` 的 `verifyNativeProduct`，出 F-003 / F-004。`docker.ts` `runtime.ts` 未看 | 高 |
| `scripts/deploy/` | 2026-07-27 | 01 | 部分：`product-start.mjs` 全文 + 其测试，出 F-001 / F-002。`product-runtime.mjs` 未看 | 高 |
| `server/runtime/` | 2026-07-27 | 10 | **paths 三个源文件全读**（225 行）。`file-path.ts` **是今夜最扎实的一份代码，零缺陷**（branded type / 词法与真实 containment 分离 / rename 用父目录检查 / `..` 误报处理正确）。出 F-019（便捷层绕过 Adapter 边界） | 高 |
| `server/agent/harness/` | — | — | 未检查（**热区，只读不定级**） | 高 |
| `server/agent/`（harness 除外） | — | — | 未检查 | 高 |
| `server/backup/` | 2026-07-27 | 04–06 | **已查完**：打包侧出 F-009 / F-010 / F-011；恢复侧 `verifyManifest` 与 `sanitizeZipEntryName` 处理均正确；规则层三个函数全读。**不要再回头查** | 高 |
| `server/passport/` | 2026-07-27 | 07 | **两个源文件全读**，出 F-013 / F-014 / F-015。`refreshInFlight` 并发共享、`slow_down` 处理均正确。**`server/api/passport/**` 路由层未读**，`normalizeSiteBaseUrl` 依赖的 DTO schema 未读 | 高 |
| `server/world-engine/` | — | — | 未检查 | 中 |
| `server/plot/` | — | — | 未检查 | 中 |
| `server/content/` | — | — | 未检查 | 中 |
| `server/database/` + `prisma/` | — | — | 未检查 | 中 |
| `server/config/` | 2026-07-27 | 03 | 部分：`readJsonFile` / `readJsonFileSync` / `writeJsonFile` 已查（读的是 `HEAD:` 版本），出 F-008。其余未看 | 高 |
| `server/utils/` | — | — | 未检查（Task 123 已标为杂物抽屉） | 中 |
| `server/api/`（projects 除外） | — | — | 未检查 | 中 |
| `scripts/`（deploy 除外） | 2026-07-27 | 02 | 部分：`build/prepare-system-assets.ts` 与 `cli/sync-user-assets.ts` 只是 CLI 壳，实现全在 `server/workspace-files/novel-workspace.ts` | 中 |
| `server/workspace-files/`（资产同步部分） | 2026-07-27 | 02 | `syncManagedSystemAssetsToUserAssets` + sync state 读写已查，出 F-005 / F-006。**profile 与 variable 两条同步链未查**。注意本目录整体是热区，但这两个文件当时未被改动 | 高 |
| `shared/` | — | — | 未检查 | 中 |
| `app/composables/` | — | — | 未检查 | 中 |
| `app/components/common/` | — | — | 未检查 | 中 |
| `app/components/novel-ide/` | — | — | 未检查 | 中 |
| `app/utils/` | — | — | 未检查 | 低 |
| `app/stores/` | — | — | 未检查（热区） | 中 |
| `world-engine/` + `assets/workspace/` | — | — | 未检查 | 低 |
| `docs/` + `reference/` 文档一致性 | — | — | 未检查 | 低 |
| **`~/.claude/skills/night-audit/`（本 skill）** | — | — | 未检查（今夜唯一可写） | 中 |

## 当前方向

第 1–6 轮：持久化的崩溃安全性与错误处理口径（已收敛，见下方病因）。
第 7–8 轮：**鉴权与安全面**，出 F-013…F-017，含 2 条 high。**这条线已经超过持久化线，是早报的头条。**

> ### 头条：F-017 + F-018 —— Portable 默认绑所有网卡且无鉴权，**而看起来能关掉它的那个开关是假的**
>
> 三级逐条确认：守卫在关闭时整体空操作（`auth.ts`）／ `cli.ts:98` 让 Portable 默认 `authEnabled=false` ／ Portable 的 `.env` 不含 `HOST`、原生启动路径也不设，而 Nitro 两个 preset 都是 `process.env.NITRO_HOST || process.env.HOST` → `undefined` → 绑所有接口。同局域网任何人可读写全部小说、下载含 `.env` 的整份备份、解除关联。
>
> **第 9 轮纠正了第 8 轮写错的机制**：`config.yaml` 的 `server.host` **没有任何消费者**（F-018）。所以危险不止于「有个危险的默认值」，而是「**用户打开 config.yaml 把 host 改成 127.0.0.1 并重启，会以为修好了，实际毫无变化**」。
>
> 「桌面应用免登录」本身合理，正确搭配是 `127.0.0.1`。修法必须落在**启动路径显式设 `HOST`**，不是改 `config.yaml`。
>
> 与 F-016（DTO 允许 `http://` 到任意主机 → refresh token 与整份备份走明文）合起来看，是同一种毛病：**为本地开发方便开的口子，没有限定在本地。**

其余三条（F-013 / F-014 / F-015）的共同点是「撤销动作管不住已经发出去的东西」——

> **第二条线的病因：撤销只清了引用，没有失效凭据本身。**
>
> `unlink()` 清 `accessTokenCache`、删凭据行，但管不住三样东西：已经拷进局部变量的 bearer token（F-013）、正在飞行中即将 upsert 回来的 refresh 结果（F-014）、内存里早已过期的设备码会话（F-015）。
>
> 三条一个修法：**给凭据加代次（generation）标记，`unlink()` 递增，所有消费点在每次网络分片前校验。** 光清缓存挡不住任何一条。

早报按「两条线 + 各自的病因」写，不要罗列十五条。

---

**第 1–6 轮的病因（持久化线）**：

> ### 病因：代码没有一致地区分「预期内的缺失」和「意料外的失败」
>
> 两个方向的症状相反，病因是同一个：
>
> - **兜得太窄**（F-006 sync state / F-008 config）——`catch` 里只认 `ENOENT`，于是文件损坏时 SyntaxError 直冲到顶，进程起不来
> - **兜得太宽**（F-009 备份）——裸 `catch` 全吞，于是权限或 I/O 错误变成**静默丢数据**，备份照样报成功
>
> 巧的是这两处的注释都写着「文件不存在时……」。**写的人心里想的是 ENOENT，手上写的却是「所有错误」或「只有 ENOENT」**，两次都没对齐。统一判据只有一句：**每个 catch 都要说清楚，我想放过的是哪个 errno？**
>
> ### 并发的第二个缺口：没有原子写
>
> 全仓没有「原子写 JSON / 原子替换文件」的公共 helper，五个受害点各写各的：三条 user-assets 同步链、sync state、Global/Project Config。最讲究的 `replaceFileWithRollback` 只做到**进程内事务回滚**，不是崩溃原子性——名字有误导性（F-007）。
>
> ### 修法不能一刀切
>
> - 派生缓存（sync state）：写入原子化 **+** 解析失败按「不存在」处理，可重建
> - **真实用户数据（config.json，含 API key）：只能写入原子化，绝不能「解析失败就当不存在」**——那是静默清空用户设置
> - 收集类操作（备份）：只放过 `ENOENT`，其余接进已有的 warnings 通道
>
> ### 现成的正面样板，照抄即可
>
> 不用新发明，本仓库里已经有写对的：
> - 读取端：`backup-restore-service.ts` 的 `verifyManifest` —— 裸 catch + 转成领域错误
> - 降级端：`backup-archive-service.ts` 里 `snapshotSqlite` 的调用点 —— 记 warning + 退化，不中断

## 未决问题

1. **今夜的 12 条 finding 全部来自静态阅读，一条都没有经过编译或测试验证。** 第 6 轮跑的 typecheck 只验证了噪音基线本身，不验证任何 finding——它们都是静态语义缺陷（错误处理口径、规则写宽、崩溃窗口），类型检查证实不了也证伪不了。**早报必须原样说清这一点。**
2. F-006 / F-008 定级 high 但**刻意没推通知**，判据已改写进 skill 的「通知」节（严重度 ≠ 紧急度）。若你认为这类 high 就该半夜叫醒你，改回去的地方在那一节。
3. `readUserSystemAssetsSyncState` 把「文件损坏」和「文件不存在」区别对待，是不是有意为之？从代码看不出理由。**若有历史原因需要人来判**。
5. **【今夜最值得跟进的线索，但只是假设】F-019 可能解释那个一直没查清的不稳定测试基线。** 至少 4 个测试文件必须 `process.chdir` 才能控制路径解析，且都靠 `afterEach` 还原。**一旦某个用例在还原前抛出，同一个 fork 里后续测试文件的 cwd 就是错的**——而 vitest 的 fork 会串行跑多个文件。这可能是 Task 123 记的「41–53 文件失败、两次运行用例总数差 167、大量 5000ms 超时」的贡献因素。**本轮没有实测**（要跑全量套件，MUST NOT 禁止），也没确认 vitest 的 pool 配置。验证成本很低（看 `vitest.config.ts` 的 pool + 给那几个 chdir 加 try/finally），收益是可能修好一个长期问题。
4. F-008 是对 `git show HEAD:` 的已提交版本确认的，`server/config/config-service.ts` 当前正被另一会话改。**早报呈现时要复核在途改动有没有已经动到这三个函数**。

## 下一轮入口

F-017 的验证缺口**已在第 9 轮补完并纠正**，不用再回头。

剩余时间只够 3–4 轮，**从现在起按「收敛」而不是「铺开」来安排**：

**第 10 轮已完成**（`server/runtime/`，出 F-019）。**探索到此为止，不要再开新方向。**

**第 11 轮已完成（收敛轮）**：19 条 finding 全部复核（只有 F-008 所在文件被并发改过，diff 未触及那三个函数，仍成立）；没有找到第二个像 F-017 那样机制写错的；**`REPORT-2026-07-27.md` 已提前写完**。

> 提前写报告是对原计划的刻意偏离：会话整夜被 compact，Phase 7 那轮若只剩「凭记忆总结 19 条」，质量取决于那一刻上下文还剩什么。现在写，十份 round 文件都还在手边。

**第 12 轮已完成**：修掉了 skill 的工作区基线把夜审自己写入算进去的缺陷（详见 `rounds/2026-07-27-12.md`）。**原计划的两件事都没做**——定向单测仍说不出要证实哪条 finding；`CHECKLIST.md` 复核被基线这件事占掉了预算，**这是本夜唯一计划了却没做的事**，只影响将来几晚的效率，不影响今夜产出。

**第 13 轮已完成**：`CHECKLIST.md` 复核做完，找到**一处真矛盾**（第 4 轮说裸 catch 是「静默丢数据的标准形状」vs 第 5 轮实测「裸 catch 本身不是信号」，两条会导出相反行为）、三处逐字重复、一处阈值不一致。规则是只增不删，所以只在文件末尾加了「待人工整理」一节列出问题，**没有动手删**。

**今夜所有计划项已清空，无欠项。**

**07:04（过截止）→ Phase 7**：报告已写好，**只需三件事**——
1. 改 `REPORT-2026-07-27.md` 顶部的「完成轮数」与「实际停止」，删掉那行草稿状态标注
2. RUN 块落 `状态: finished` + 实际停止时间（**先落盘，再删 job，顺序不能反**）
3. `CronList` 找 prompt 含 `night-audit` 且 tracking-dir basename 完全等于 `127-nightly-audit` 的 job，**恰好一个才 `CronDelete`**；零个或多个一律不删并如实报告。job id 记录为 `2609cd53`
4. `PushNotification` 一条（运行窗口结束，属于允许通知的三种情况之一）

**明确不再排期**：`server/app-logs/archive.ts:67` 等三处 JSON 读取点；`server/api/passport/` 剩余 6 个路由；`.{uuid}.backup` 残留；`product-runtime.mjs`；`docker.ts`。全部写进早报的「今夜没查到的地方」。
