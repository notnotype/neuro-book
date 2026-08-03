# Agent 资产安装协议

## User Request / Topic

- 继续开发 NeuroBook 的 Skill / Workflow / Profile 协议，新协议写进 `reference/`。
- 现有更新途径只有「装新版 NeuroBook」，且用户资产覆盖机制复杂丑陋，需要重做。
- Skill 需要支持安装依赖。
- 需要支持从 git remote 和 NeuroBook 创意工坊安装、更新资产。
- 调研外部 Skill 协议的最新形态，判断需要对齐到什么程度。

## Goal

1. 把「包」而不是「文件」确立为安装、升级、卸载和记账的最小单位。
2. 内置资产从模板投影层改为「随程序附带、已下载好的包」，与工坊 / git 走同一条安装路径。
3. 兼容 Agent Skills 开放标准，外部 Skill 零转换可用。
4. 建立 provenance 账本，让更新、冲突和卸载有据可依。
5. 支持中文展示名，同时保持 id 为 ASCII kebab-case。

## Research

调研于 2026-08-01 完成，来源为 [agentskills.io 规范](https://agentskills.io/specification)、[agentskills.io 总览](https://agentskills.io) 与 [Claude Code Skills 文档](https://code.claude.com/docs/en/skills)。

- Agent Skills 已从 Anthropic 私有格式变成开放标准，Cursor / Gemini CLI / GitHub Copilot / VS Code / OpenCode / Goose / Codex / JetBrains Junie 等数十家采纳。
- 标准 frontmatter 只有 6 个字段：`name`（必填，≤64，kebab-case，必须等于父目录名）、`description`（必填，≤1024）、`license`、`compatibility`（≤500）、`metadata`（任意 string map）、`allowed-tools`（标注为实验性）。
- **标准把 `version` 放在 `metadata` 下**，官方示例即 `metadata: {author, version}`。
- **标准不覆盖依赖声明、分发、registry 和更新协议**，这些是各家自行扩展的空白区。
- Claude Code 的分发方案是 plugin + marketplace（git 仓库为单位），不是「每个 skill 一个包」；另外私有扩展了十余个 frontmatter 字段。
- 官方提供校验器 `skills-ref validate`。

## Prior State

- 内置资产经 `syncSystemAssetsToUserAssets`（`server/workspace-files/novel-workspace.ts:534`）逐文件投影进 Workspace Root `.nbook`，用 `.system-assets-sync-state.json` 记 `{upstreamHash, lastSyncedUserHash}` 做三方比较。
- 废弃受管文件依赖五份硬编码墓碑名单共约 50 条（`novel-workspace.ts:41-117`），单调增长且永不能删。
- `package.json.version` 只是 catalog 的只读展示字段（`skill-catalog.ts:127`），不参与任何更新决策。
- 依赖失效靠 `skillDependencyKey()` 从路径反推包身份，再比对 17 个 install 相关字段。
- catalog 层「整目录遮蔽」与 sync 层「逐文件三方合并」语义不一致。
- 冲突只产生 warning 文本，没有可操作出口。
- 联网更新、git 安装、工坊安装全部为零。工坊站点已实现完整发布与下载 API，客户端一行未接。
- Passport 设备码 + Bearer 认证通道已在客户端跑通，可直接复用。

## Decisions

用户拍板，不再重议：

1. **兼容外部 Skill。** frontmatter 是真相源，`package.json` 可选；`version` 与 `author` 进 frontmatter，与 `package.json` 尽量同步。
2. **id 与展示名分离。** 目录名 = `name` = id（ASCII kebab-case），中文展示名走 `metadata.displayName`。
3. **禁用目录不做。** 不提供「保留目录但不加载」的开关。
4. **加 provenance。**
5. **git remote 安装全部信任放行**，信任分级留待后续专门处理。
6. **frontmatter 是 Skill 的真相源。**
7. **放弃内置资产投影到用户目录。** 内置资产改为随程序附带的已下载包，只保留用户级与项目级两层。接受由此产生的 user-assets 同步协议不一致。
8. **删除的内置包记 uninstall 墓碑，不复活，可在设置页手动恢复。**
9. **新安装模型覆盖 Skill / Workflow / Profile 三类。**

由本协议直接推导、未单独提问的：

- `minAppVersion` 客户端必须消费，安装前与加载前都生效。
- 安装走「下载 → 校验 → 暂存 → 原子换 → 失败回滚」，账本写入是唯一提交点。
- 所有安装落点在 State Root 之下，Windows Portable 搬移 `data/` 不丢。
- Skill 获得项目级层（与 Workflow 对齐）。规划阶段曾建议不做，按决策 7 撤回。
- Profile 的 Publisher 提交边界优先于本协议的事务回滚规则。

## Implementation Walkthrough

### 2026-08-01 · 协议建档

只写协议文档，未修改任何业务代码。

- 新增 [reference/agent/agent-asset-install.md](../../../reference/agent/agent-asset-install.md)：核心安装协议。定义包模型、三类 root、provenance 账本、七阶段安装事务、种子投放规则、依赖生命周期、兼容性门禁、信任边界、三类资产各自的补充规则和迁移要求。
- 重写 [reference/agent/skill-package.md](../../../reference/agent/skill-package.md)：以 Agent Skills 开放标准为基线，frontmatter 成为身份 / 展示名 / 版本的真相源，`package.json` 降级为可选，删除已作废的 Override And Sync 小节。
- 更新 [reference/agent/agent-asset-package.md](../../../reference/agent/agent-asset-package.md)：Client Boundary 改为指向新安装协议；新增 Pending Site Changes 小节，明确标注 Skill 发布身份改读 frontmatter 是**站点尚未实施**的合同变化。
- 更新 [reference/agent/workflow/README.md](../../../reference/agent/workflow/README.md)：目录与覆盖小节从三层改为 `Install Root → Project Root` 两层，写明 Seed Root 不是 catalog 层。
- 更新 [reference/agent/profile-compiled-artifacts.md](../../../reference/agent/profile-compiled-artifacts.md)：Sync 小节加取代关系提示块，正文保留对当前生产行为的准确描述。
- 更新 [docs/adr/0011-agent-asset-install-identity.md](../../adr/0011-agent-asset-install-identity.md)：新增修订块。核心「单一安装身份」原则不变，Skill 的身份读取位置改为 frontmatter，`package.json` 降级为可选；决策 2、3、4、6、7、8 不变。
- 更新 [reference/workspace/TERMS.md](../../../reference/workspace/TERMS.md)：新增 Seed Root / Install Root 术语，精确化 `.nbook` 覆盖规则的适用范围。
- 更新 [reference/agent/README.md](../../../reference/agent/README.md) 索引与阅读规则。
- 更新 `PROJECT-STATUS.md`：新增 Task 135 行。

### 2026-08-01 · 协议自审与修订

建档后对协议做了一轮对抗式检查，查出 8 处实质缺陷并全部修订。**核对手段是读真实内置资产，不是推演。**

**A. 无版本包永久停更（严重，会直接废掉核心需求）**

原 Seeding 规则把升级门槛写成「种子版本更高」，而 Core Model 断言每个包「有稳定 id 和 SemVer 版本」。实测：**17 个内置 Skill 中 0 个在 frontmatter 声明版本，只有 llmlint 与 novel-data 有 `package.json.version`；7 个内置 Workflow 全部没有 `package.json`。** 即 15 个 Skill 和全部 Workflow 无版本，版本门槛对它们永远不成立，首次安装后再也收不到更新——比现状（文件同步每次都更新）是硬回归，且直接废掉「资产需要支持更新」这条核心需求。Workflow 小节原文「缺失时视为无版本包，只能被整体替换，不参与版本比较升级」本身也自相矛盾（既然不参与升级，替换由什么触发）。

修订：新增 Version And Change Detection 小节。版本改为显式可选；双方都有版本走 SemVer 比较，任一方缺版本回退到 `contentHash` 比较。无版本包因此仍能跟随更新，代价是无法表达「内容变了但不算升级」。

**B. `restore` 被版本门槛拦死（严重，与用户决策 8 直接冲突）**

原 Resolve 写「同 id 已存在且版本不高于当前版本时直接结束」，而恢复内置包装的是同一个版本 → 用户拍板的「设置页恢复内置 Skill」永远执行不了。原文还把「安装、升级、恢复共用同一个事务」和这条门槛并列，没意识到二者互斥。

修订：拆出 `install` / `upgrade` / `repair` / `restore` / `takeover` 五种意图，版本门槛只约束 `upgrade`。顺带补上了原本完全缺失的 `repair`（同版本重装修损坏）。

**C. Profile 的 commit unit 套不上目录 rename 模型（严重）**

原事务阶段 5 假设「旧目录 rename 进 `.trash`，staging rename 到目标位」。但 Profile 的固定入口是 profiles root 下的**一个文件** `<name>.profile.tsx`（可带同名资料目录），且 `.compiled/` 与 `manifest.json` 是**整个 root 共享**的。目录 rename 对 Profile 无定义，照抄会破坏共享状态。

修订：新增 Commit Unit 小节，明确 Skill / Workflow 是整目录 rename，Profile 是「入口文件 + 同名资料目录」逐条移动，共享的 `.compiled/` 与 `manifest.json` 不进阶段 5、只能由 Publisher 在阶段 7 改。

**D. 账本无并发控制（中）**

账本是单文件共享可变状态，原文只规定了「临时文件 + 原子 rename」，那只保证写原子，不防读—改—写丢更新。多标签页、Manager、CLI 和后台种子投放都能并发触发安装。

修订：新增 Concurrency 小节，整个事务在 Install Root 排他锁内执行，账本读—改—写在同一持锁窗口内完成；并明确它与 Profile `.publish.lock` 是两把独立的锁、不得反向嵌套（否则与后台编译 Coordinator 死锁）。

**E. 账本丢失导致静默永久停更（中）**

原文「账本里没有记录的包一律视为 `local`」+ 账本放在用户可编辑的 `workspace/.nbook/agent/` 下 = 用户误删一个 JSON 文件，全部内置包降级为 `local`，从此静默不再更新。

修订：新增 Ledger Recovery 小节。账本缺失或损坏时从磁盘重建，逐个与 Seed Root 同 id 包比对 `contentHash` 判定来源，只有比对不中的才记 `local`；并明确重建无法恢复 `removed` 墓碑，必须告知用户而非静默发生。

**F. 跨来源同 id 冲突未定义（中）**

`agent-asset-package.md` 的 Client Boundary 原本明确把「同名冲突」列为待设计项，我在改写时声称由新协议接管，实际只覆盖了 dirty（用户手改）冲突，没覆盖跨来源冲突：工坊的 `novel-guide` 装到已有内置 `novel-guide` 上会发生什么，原文没有答案。

修订：新增「跨来源同 id」小节。一个 id 一个槽位，走 `takeover`，需用户确认，成功后 `origin` 改写并脱离种子投放接管；可通过卸载 + `restore` 回到内置版本。

**G. 墓碑与显式安装的交互未定义（中）**

原文只说种子投放遇 `removed` 跳过，没说用户显式从工坊装同 id 包时墓碑怎么办。

修订：明确任何显式安装动作都清除墓碑，只有自动种子投放会被墓碑拦住。

**H. frontmatter-only Skill 无处声明 `minAppVersion`（中，两份文档互相矛盾）**

协议要求 `minAppVersion` 在安装前和加载前都生效，但 `minAppVersion` 只存在于 `package.json` 的 `neurobook` 字段里，而同一轮我刚把 Skill 的 `package.json` 降级为可选——frontmatter-only 的 Skill 根本没有位置声明它。

修订：`skill-package.md` frontmatter 表新增 `metadata.minAppVersion`；协议 Compatibility 小节改为按类型分列声明位置，并写明未声明即无约束。

Review Checklist 同步从 8 条扩到 14 条，把上述每条都变成可核对项。

### 2026-08-02 · 存量冲突面收口

处理建档轮审计出的三处冲突面。**本轮首次修改业务资产（skill-creator 的两个脚本），并做了真实执行验证。**

**1. `quick_validate.py` 重写（原为阻塞项）**

原实现有两个方向相反的错误：`allowed_keys` 只放行 `name` / `description` 并拒绝其余一切 key，同时 `parse_frontmatter` 明确拒绝任何缩进行——`metadata` 嵌套块与 `license` / `compatibility` 全部会被判不合格；而 `is_valid_skill_name` 用 `char.isalpha()` 判定，Python 的 `isalpha()` 对中文和大写字母都返回 `True`，等于放行了 `RP模式` 这类不合规 id。

重写后按标准校验：顶层字段白名单、`name` 严格 kebab 且必须等于父目录名、`description` ≤1024、`compatibility` ≤500、`metadata.version` 与 `metadata.minAppVersion` 必须是 canonical SemVer，并支持 `metadata` 嵌套映射与 `when_to_use` 块列表两种结构。

**实测发现协议漏字段**：首轮跑全量内置 Skill 时 6 个报 `Unexpected frontmatter keys: when_to_use`。核查 `server/agent/skills/skill-catalog.ts:161` 确认 `when_to_use` 是 **NeuroBook 真实消费的既有字段**（解析后输出 `whenToUse`，且 `:152-158` 专门处理了 YAML 列表形态），4 个 Skill 用标量、2 个用列表，Claude Code 也把它作为私有扩展消费。**我在重写 `skill-package.md` 时把这个生产字段整个丢了**，属于协议缺陷而非校验器缺陷。已在 `skill-package.md` 补回字段表条目与专门小节，说明它是标准之外的容忍扩展。

**2. `init_skill.py` 重写**

原实现的用法示例是 `init_skill.py shuangwen-style --name 爽文风格`，正好教了「目录名 ≠ frontmatter name、且 name 用中文」，与决策 2 完全相反；`SKILL_NAME_PATTERN` 为 `^[^\s\\/]+$`，只要没有空格和斜杠就放行。

重写后 `name` 恒等于目录名，`--name` 改为 `--display-name` 并写入 `metadata.displayName`，模板按需生成 `metadata` 块，标题优先用展示名，中文 id 直接拒绝并提示改用 `--display-name`。

**3. `skill-creator/SKILL.md`**

发现路径描述、`## What A Neuro Book Skill Is` 的目录说明、`## Frontmatter Rules` 全段（含 `name may be English or Chinese`）与手工自检清单四处更新为新契约，并指向 `reference/agent/skill-package.md` 作为真相源。

**4. 文档站**

`docs/agent/skills.md` 与英文镜像原本列了 Skill 的「项目层」，但 `SkillCatalog` 构造函数只接 `(systemRoot, userRoot)`、`list()` 没有 project 参数——**Skill 今天没有项目层，这是与 Task 135 无关的既有文档错误**。已改为如实描述当前两层并说明整目录覆盖语义。顺带发现表格漏掉 Task 124 加入的 `novel-data`，实际内置 Skill 是 17 个而非文档写的 16 个，中英文均已补齐。

`skill-creator-zh` 的归档与 `RP模式` 的改名仍未执行，原因见 Open Items。

## Verification

- [ ] 未运行任何测试。本轮只有文档变更，不涉及业务代码。
- [ ] 协议尚未实施，因此没有任何行为证据。文档中的所有机制描述都是目标合同，不是当前生产行为。
- [x] 内置资产版本声明覆盖率已用真实文件核对：17 个 Skill 中 15 个无任何版本（llmlint `3.0.0`、novel-data `1.0.0` 走 `package.json`），7 个 Workflow 全部无 `package.json`。缺陷 A 据此确认，不是推演。
- [x] 自审后重读全文，确认修订未引入新的自相矛盾：版本门槛只出现在 `upgrade` 分支，Seeding 与 Version And Change Detection 判据一致，Commit Unit 与 Profile 小节互相引用无冲突。
- [x] `quick_validate.py` 全量跑过 17 个内置 Skill：16 通过，唯一失败的 `RP模式` 报中文 id 不合规，属预期待办而非校验器缺陷。
- [x] `quick_validate.py` 做过失败注入：name 与目录名不符、大写 id、连续连字符、非 SemVer `metadata.version`、未知顶层 key、空 description、`metadata` 写成内联值 7 个坏用例全部按正确原因拒绝；含 `metadata` / `when_to_use` 列表 / `license` / `minAppVersion` 的合法用例通过。**「全通过」不作为有效性依据。**
- [x] `init_skill.py` → `quick_validate.py` 端到端自洽：纯 ASCII id、中文 `--display-name`、带资源目录三种生成结果均通过校验；中文 id 被正确拒绝并提示改用 `--display-name`。
- [x] `bun run docs:build` 通过，无死链。
- [ ] 未运行仓库单元测试。本轮改动的两个 Python 脚本不在 Vitest 覆盖范围内，其余为文档。

## Plan Differences

- 规划阶段建议 Skill 不做项目级层，理由是复杂度不值。用户决策 7 明确要求「只需要用户、项目级 skill」，因此改为纳入，与 Workflow 现有三层结构中的 project 层对齐。
- 规划阶段准备就「内置可运行 Skill 的依赖如何在只读 Application Root 上安装」提问并给了三个方案。决策 7 让内置包直接安装进可写的 State Root，该问题连同三个方案一并作废。
- 规划阶段假设 `agent-asset-package.md` 可以直接改写以支持无 `package.json` 的 Skill。核对后发现该文档描述的是**站点已部署行为**，直接改写会让文档对生产失真，因此改为新增 Pending Site Changes 小节隔离未实施部分。

## Contradicting Surfaces

建档同轮对存量文件做了只读审计，查出三处描述或强制执行已被推翻的旧模型。**三处均已于 2026-08-02 收口**，过程见上方实施记录。

1. ~~`skill-creator/scripts/quick_validate.py:76`~~ —— `allowed_keys` 白名单会直接判定新协议的合法 Skill 不合格，属阻塞项。**已重写**，并顺带暴露出协议漏掉 `when_to_use` 生产字段。
2. ~~`skill-creator/SKILL.md`~~ —— 发现路径与 frontmatter 规则仍是旧模型。**已更新四处**；同轮发现 `init_skill.py` 的示例在教「目录名 ≠ name 且 name 用中文」，一并重写。
3. ~~`docs/agent/skills.md:49`~~ —— 声称 Skill 有三层覆盖。**已改为如实描述当前两层**；同轮查实「项目层」在 `SkillCatalog` 里根本不存在，属既有文档错误，且表格漏了 `novel-data`。

审计更正：首轮 grep 模式过窄，曾错误断言「`reference/` 下除本轮改动的三个文件外没有其它文件描述旧覆盖模型」。放宽模式后又查到两处，**已一并修正**：

- `reference/agent/workflow/README.md:37-41` 原文完整描述了 `Bundled system → user-assets → Project Workspace` 三层覆盖。已改为 `Install Root → Project Root` 两层，并写明 Seed Root 不是 catalog 层。
- `reference/agent/profile-compiled-artifacts.md` 的 Sync 小节描述的是旧投影同步。因该节准确描述当前生产行为，未改写正文，改为加显式提示块标注取代关系，并声明三条不可回滚边界与 Publisher 约束在新模型中原样保留。

同文件的另外三处旧同步引用（`:77` 前端 user-assets sync 翻转 system/user 两个 root 的 Registry、`:129` 发布点不可回滚边界、`:136` 依赖标签按 `assets/workspace/.nbook/agent/profiles` 字符串把 system entry rehome 成 user entry）都准确描述当前实现，实施时会随旧同步路径一起失效，本轮不动。实施时必须逐条核对这三行。

`reference/workspace/TERMS.md` 已同步：新增 **Seed Root** 与 **Install Root** 两个术语；原「用户的 `workspace/.nbook` 可以覆盖系统 `assets/workspace/.nbook`」精确化为只对 `templates/` 与 `variables/` 成立。

- `reference/agent/workflow/README.md:37-41` 原文完整描述了 `Bundled system → user-assets → Project Workspace` 三层覆盖。已改为 `Install Root → Project Root` 两层，并写明 Seed Root 不是 catalog 层。
- `reference/agent/profile-compiled-artifacts.md` 的 Sync 小节描述的是旧投影同步。因该节准确描述当前生产行为，未改写正文，改为加显式提示块标注取代关系，并声明三条不可回滚边界与 Publisher 约束在新模型中原样保留。

同文件的另外三处旧同步引用（`:77` 前端 user-assets sync 翻转 system/user 两个 root 的 Registry、`:129` 发布点不可回滚边界、`:136` 依赖标签按 `assets/workspace/.nbook/agent/profiles` 字符串把 system entry rehome 成 user entry）都准确描述当前实现，实施时会随旧同步路径一起失效，本轮不动。实施时必须逐条核对这三行。

`reference/workspace/TERMS.md` 已同步：新增 **Seed Root** 与 **Install Root** 两个术语；原「用户的 `workspace/.nbook` 可以覆盖系统 `assets/workspace/.nbook`」精确化为只对 `templates/` 与 `variables/` 成立。

## Open Items

实施前需要确认或决策的：

1. **站点跟进 Skill frontmatter 身份**（`neuro-book-site`）。在站点改造完成前，无 `package.json` 的标准 Skill 只能本地安装和 git 安装，传不上工坊。
2. **恢复内置资产的入口位置。** 决策 8 要求「设置页可手动恢复」，具体挂在哪个设置分区未定。
3. **依赖安装由谁触发。** 协议规定依赖安装是可延迟阶段且状态记在账本，但「系统在安装后自动跑」还是「首次使用时由 Agent 按账本状态触发」未定。当前实现是后者且靠提示词约束。
4. **`RP模式` 改名与 `skill-creator-zh` 归档。** 两项都还没做。建档时以为只是移动目录，核查后发现都有活代码引用，且**在当前同步模型下都必须补墓碑名单条目**（否则存量用户机器上留下孤儿目录），而墓碑名单正是本任务要退役的东西——迁移计划要求名单先执行完再删，所以补条目与退役并不冲突，但需要用户确认这个时机。

   `skill-creator-zh` 归档的完整影响面：
   - `assets/workspace/.nbook/agent/skills/skill-creator-zh/` 移到 `docs/archived/skills/`
   - `assets/workspace/.nbook/agent/profiles/builtin/leader.assets.profile.tsx:65` 的 `skills.include` 白名单要摘掉它，`:211` 的提示词也提到它
   - **改了 builtin profile 就要重新编译 artifact**，不是纯文本改动
   - `server/agent/skills/skill-catalog.test.ts:175` 断言它在 catalog 里
   - `docs/agent/skills.md:42` 与英文镜像的表格把它和 `skill-creator` 并列
   - `novel-workspace.ts` 需加墓碑 `agent/skills/skill-creator-zh/`

   `RP模式` 改名的完整影响面：
   - 目录改 `rp-mode`，`SKILL.md` 的 `name` 改 `rp-mode` 并加 `metadata.displayName: RP 模式`
   - `server/agent/skills/skill-catalog.test.ts:173` 断言旧名
   - `docs/agent/skills.md:46` 与英文镜像的「历史」段
   - `novel-workspace.ts` 需加墓碑 `agent/skills/RP模式/`
   - 归档文档与历史任务记录里的引用是历史叙述，不改
5. **迁移的执行时机。** 存量墓碑名单必须一次性执行完才能从代码删除，需要确定这个迁移挂在哪个 Application State catalog 版本上。

## References

- [Agent Asset Install Protocol](../../../reference/agent/agent-asset-install.md)
- [Skill package contract](../../../reference/agent/skill-package.md)
- [Agent Asset Package Protocol](../../../reference/agent/agent-asset-package.md)
- [Profile compiled artifacts](../../../reference/agent/profile-compiled-artifacts.md)
- [Workspace terms](../../../reference/workspace/TERMS.md)
- [ADR 0011：Agent 资产安装身份](../../adr/0011-agent-asset-install-identity.md)
- [Task 120 Agent Skill Package Contract](../120-agent-skill-package-contract/README.md)
- [Task 88 Workshop Platform](../88-workshop-platform/README.md)
- [Agent Skills 规范](https://agentskills.io/specification)
