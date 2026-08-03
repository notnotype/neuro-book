# Agent Asset Install Protocol

本文是 NeuroBook 客户端**本地安装、更新、卸载和来源记账**的唯一协议真相源。它取代原先「Bundled Workspace Template 逐文件投影进 Workspace Root `.nbook`」的同步模型。

发布侧（Workshop ZIP 外壳、静态校验、版本递增）仍由 [Agent Asset Package Protocol](agent-asset-package.md) 定义。任务过程记录见 [Task 135](../../docs/tasks/135-agent-asset-install-protocol/README.md)。

## Core Model

一个 Agent 资产是一个**包**：带固定入口的可寻址单元，有稳定 id。版本是可选的——现存内置包大多没有声明版本，外部导入的标准 Skill 也可能没有。包是安装、升级、卸载和记账的最小单位；系统不再以文件为单位比较和合并。

内置资产不是模板层，而是**随程序附带、已经下载好的包**。它和 Workshop、git 装来的包走同一条安装代码路径，唯一区别是来源不需要联网。

| 类型 | 固定入口 | 元数据真相源 | id |
| --- | --- | --- | --- |
| Skill | `SKILL.md` | YAML frontmatter | 目录名 |
| Workflow | `workflow.ts` | default export 对象 | 目录名 |
| Profile | `<name>.profile.tsx` | 编译后 `profileManifest` | `profileKey` |

## Roots

```text
Application Root/assets/workspace/.nbook/agent/{skills,workflows,profiles}/   Seed Root（只读）
State Root/workspace/.nbook/agent/{skills,workflows,profiles}/                Install Root（可写）
State Root/workspace/{project}/.nbook/agent/{skills,workflows,profiles}/      Project Root（可写）
```

- **Seed Root 不是 catalog 层。** 它只是随程序发布的包仓库，仅供安装器读取。catalog 不从这里加载任何资产。
- catalog 层级固定为 **Install Root → Project Root**，同 id 时 Project Root 胜出。三类资产使用同一套层级。
- 安装落点永远在 State Root 之下。Windows Portable 整体搬移 `data/` 后，已安装资产随之迁移；升级 NeuroBook 程序不触碰 Install Root。
- Project Root 的包不参与安装事务与账本，视为项目内容，随 Project 备份和下载走。**不支持把包安装到 Project Root**；项目级资产只能由用户或 Agent 手工创建。需要跨项目复用时装到 Install Root。

## Provenance Ledger

Install Root 下的 `agent/installed.json` 是已安装资产的账本。它取代 `.system-assets-sync-state.json` 对这三类资产的记账。

```json
{
    "schemaVersion": 1,
    "assets": [
        {
            "type": "skill",
            "id": "llmlint",
            "version": "3.0.0",
            "state": "installed",
            "origin": {"kind": "bundled"},
            "installedAt": "2026-08-01T00:00:00.000Z",
            "contentHash": "9f2c...",
            "dependencies": {"state": "installed", "lockHash": "4ab1..."}
        },
        {
            "type": "skill",
            "id": "novel-guide",
            "version": "1.1.0",
            "state": "removed",
            "origin": {"kind": "bundled"},
            "removedAt": "2026-08-02T10:00:00.000Z"
        },
        {
            "type": "workflow",
            "id": "book-deconstruct",
            "version": "2.0.0",
            "state": "installed",
            "origin": {"kind": "workshop", "slug": "book-deconstruct", "itemId": "itm_..."},
            "installedAt": "2026-08-01T00:00:00.000Z",
            "contentHash": "1d70..."
        }
    ]
}
```

### origin

| kind | 含义 | 升级源 |
| --- | --- | --- |
| `bundled` | 随程序附带的种子包 | 新版程序的 Seed Root |
| `workshop` | 从创意工坊安装 | Workshop API 同 `itemId` 的更高版本 |
| `git` | 从 git remote 安装，额外记 `remote` / `ref` / `commit` | 同 remote 重新拉取 |
| `local` | 用户自己在目录里手写 | 无 |

**账本里没有记录的包一律视为 `local`。** 它对 catalog 完全可见，但不参与任何自动升级，也不产生冲突提示。

### state

- `installed`：正常可用。
- `removed`：**仅对 `bundled` 有意义的墓碑**。用户删掉内置包后写入，用于阻止下次启动重新种回。工坊和 git 包被删除时直接移除账本条目，不留墓碑。

`removed` 条目不会因为新版程序带来更高版本而复活。清除墓碑只有两条路径：用户在设置页显式「恢复内置资产」（`restore`），或用户显式从另一来源安装同 id 包（`takeover`）。**任何显式安装动作都会清除墓碑**；只有自动种子投放会被墓碑拦住。

### 跨来源同 id

Install Root 每个 id 只有一个槽位。用户显式安装的包与已装同 id 包来源不同时（例如工坊的 `novel-guide` 覆盖内置的 `novel-guide`），走 `takeover`：需要用户确认，成功后账本 `origin` 改写为新来源，该 id 从此跟随新来源升级，不再被种子投放接管。

后续用户可以卸载它并执行 `restore` 回到内置版本。跨来源冲突**不静默解决**，也不并存两份同 id 包。

### contentHash

安装完成时对整包内容计算的稳定指纹，排除 `node_modules`、`.compiled/` 和其它本地派生物。因为包是被逐字安装的，账本里的 `contentHash` 同时代表**安装时的上游内容**和**安装后的本地内容**，两个比较方向都靠它：

- 重算磁盘当前内容，与账本不一致 → **本地已手改**（dirty）。
- 计算上游候选内容，与账本不一致 → **上游有变化**（有更新可用）。

## Version And Change Detection

**版本是可选的。** 当前 17 个内置 Skill 中有 15 个、7 个内置 Workflow 全部没有声明任何版本；符合 Agent Skills 开放标准的外部 Skill 也可以没有 `metadata.version`。因此升级判定**不能只依赖版本比较**，否则这些包在首次安装后将永远不再更新。

升级触发规则，按顺序判定：

1. **双方都有版本**：上游版本按 SemVer precedence 严格大于账本版本 → 有更新。版本相等或更低 → 无更新（除非是显式 repair/restore，见事务 Resolve）。
2. **任一方没有版本**：改用 `contentHash` 比较。上游 `contentHash` 与账本不一致 → 有更新。
3. 两种情况下都要再过一次 dirty 判定：磁盘当前 `contentHash` 与账本不一致时，**跳过升级并产生一条冲突提示**，不覆盖用户改动。

无版本包因此仍然能跟随程序更新，代价是无法表达「内容变了但不算升级」，也无法在界面上展示版本号。**内置包应当逐步补齐 `metadata.version`**；补齐后自动从规则 2 切到规则 1，不需要迁移。

dirty 包的处置出口只有两个：用户接受上游版本（覆盖，旧内容进回收区），或用户保留本地版本（origin 降级为 `local`，从此不再跟随上游）。这一整包判定取代了原来 per-file 的 `lastSyncedUserHash` 三方比较。

## Install Transaction

### Intent

事务先确定意图，不同意图的前置条件不同。**版本比较只约束 `upgrade`**，其余意图不受「版本必须更高」限制：

| intent | 触发 | 前置条件 |
| --- | --- | --- |
| `install` | 目标 id 未安装 | 账本无 `installed` 条目 |
| `upgrade` | 检测到上游更新 | 通过 Version And Change Detection 判定，且未 dirty |
| `repair` | 用户或启动对账发现安装损坏 | 允许同版本重装，覆盖磁盘内容 |
| `restore` | 用户在设置页恢复已删除的内置包 | 账本条目为 `removed`；**允许同版本安装** |
| `takeover` | 用户显式从另一来源安装同 id 包 | 需用户确认，成功后 `origin` 改写为新来源 |

`restore` 与 `repair` 若受「版本不高于当前版本就结束」约束会直接失效，因此该约束只写在 `upgrade` 分支里。

### Concurrency

**整个事务在 Install Root 级别的排他锁内执行**，锁与 Profile 的 `.publish.lock` 独立且不得互相嵌套等待。账本是单文件共享可变状态，读—改—写必须在同一次持锁窗口内完成，否则并发安装会互相丢写。

多标签页、Manager、CLI 与后台种子投放都必须走这把锁。拿不到锁时排队或返回「安装进行中」，不得跳过锁直接写盘。

### Stages

七个阶段：

1. **Resolve**：确定 type、id、intent、来源与落点。按上表校验意图前置条件，不满足即结束。
2. **Fetch**：`bundled` 从 Seed Root 读；`workshop` 经 official-site transport 下载 ZIP；`git` 执行浅克隆。
3. **Validate**：路径安全规则继承 [Agent Asset Package Protocol](agent-asset-package.md)；校验固定入口存在、id 合法且等于目录名、版本（若声明）是 canonical SemVer、`minAppVersion` 满足当前程序版本。任何一项失败即终止，不产生半安装状态。
4. **Stage**：写入 `agent/.staging/<type>/<id>-<nonce>/`。staging 与目标同盘，保证后续 rename 是原子的。
5. **Commit**：把旧的 commit unit 移进 `agent/.trash/<type>/<id>-<timestamp>/`，再把 staging 内容移到目标位。两次移动都在同盘完成。
6. **Record**：账本在锁内读取、合并本次条目，经临时文件 + 原子 rename 写回。**账本写入是事务提交点。**
7. **Post-install**：依赖安装与 Profile 发布（见下），失败不回滚已提交的安装，只把状态标为待修复。

### Commit Unit

阶段 5 移动的单元按类型不同：

- **Skill / Workflow**：包目录 `<install-root>/<type>s/<id>/`，整目录 rename。
- **Profile**：**不是一个自包含目录**。固定入口是 profiles root 下的 `<name>.profile.tsx` 文件，可能另带一个同名资料目录，而 `.compiled/` 与 `manifest.json` 是**整个 root 共享**的。因此 Profile 的 commit unit 是「入口文件 + 同名资料目录」这一组条目，逐条移动；共享的 `.compiled/` 与 `manifest.json` **不属于 commit unit**，只能由 Publisher 在阶段 7 修改。

### Failure Handling

- 阶段 1–4 失败 → 删除 staging，目标位未被触碰。
- 阶段 5 中途失败 → 从 `.trash` 把旧 commit unit 移回原位。Profile 的多条目移动必须逐条可逆。
- 阶段 6 失败 → 磁盘已换但账本未更新。**启动对账以磁盘为准回填账本**，不以账本为准回滚磁盘。
- `.trash` 与 `.staging` 是可重建的运行产物：不进 user-assets Studio、不进文件历史、不进备份与下载包，由启动时的保守清理回收，保留期内可用于人工恢复。

### Ledger Recovery

账本位于用户可编辑的 Workspace Root `.nbook` 之下，必须假设它会被误删或损坏。**不能把「账本无条目」直接解释成 `local`**，否则一次误删会让全部内置包永久停止更新且无任何提示。

- 账本文件缺失或解析失败 → 从磁盘重建：扫描 Install Root 列出所有包，逐个与 Seed Root 同 id 包比对 `contentHash`。命中且一致的重建为 `origin: bundled` 并回填版本；命中但不一致的重建为 `bundled` 且立即标记 dirty；未命中的才记为 `local`。
- 重建无法恢复 `removed` 墓碑（信息已丢失），因此重建后被删除过的内置包会重新出现。这一点必须在重建时明确告知用户，不能静默发生。
- 重建是 best-effort 自愈，不阻塞启动。

## Seeding

内置包的投放规则：

- 启动时遍历 Seed Root。对每个种子包，按 id 查账本：
  - 账本无条目且 Install Root 无同 id 目录 → 安装（`install`）。
  - 账本 `state: "removed"` → **跳过**，不重装。
  - 账本 `state: "installed"` 且 `origin.kind` 不是 `bundled` → **跳过**。该 id 已被 `takeover`，种子不再接管。
  - 账本 `state: "installed"` 且 `origin.kind` 是 `bundled` → 按 Version And Change Detection 判定是否 `upgrade`。**无版本包走 `contentHash` 比较，不会因为缺版本而永远停更。**
  - Install Root 有同 id 目录但账本无条目 → 先走 Ledger Recovery 的比对逻辑，不要直接判成 `local`。
- 种子投放不阻塞启动，且必须在 Install Root 排他锁内执行。失败只影响对应包，不拖垮其它包，也不阻止服务起来。

## Dependencies

只有 Skill 可以声明 Bun 安装输入。依赖安装是安装事务的**可延迟阶段**，账本记录其状态：

- `dependencies.state`：`pending` / `installed` / `failed`。
- `dependencies.lockHash`：`bun.lock` 与 `package.json` 中影响 Bun 安装结果的字段的联合指纹。

规则：

- 安装或升级后，若包声明了 Bun 安装输入且 `lockHash` 与账本不同，状态置 `pending`。
- 版本号、`SKILL.md`、`references/`、规则文件等变化**不改变** `lockHash`，因此不重装依赖。
- `pending` 状态下执行 `bun install --cwd "<install-root>" --frozen-lockfile`；成功置 `installed`，失败置 `failed` 并保留可读诊断。不绕过 frozen lockfile。
- `node_modules` 是本地派生物，不进包内容指纹、不进包分发、不随 `.trash` 保留。

**不再从文件路径反推包身份。** 包已经是一等单位，`skillDependencyKey` 这类按 `agent/skills/<key>/package.json` 猜测归属的逻辑退役。

## Compatibility

`minAppVersion` 的声明位置按类型不同，**Skill 必须能在没有 `package.json` 的情况下声明它**，否则 frontmatter-only 的 Skill 无法表达兼容性要求：

| 类型 | 声明位置 | 回退 |
| --- | --- | --- |
| Skill | `metadata.minAppVersion`（frontmatter） | 存在 `package.json` 时回退到 `neurobook.minAppVersion` |
| Workflow / Profile | `neurobook.minAppVersion`（`package.json`） | 无 |

规则：

- 未声明即无兼容性约束。声明时必须是 canonical SemVer。
- 安装前检查，不满足则拒绝安装并报告所需版本。
- 已安装包在程序**降级**后可能不再满足要求：catalog 将其标记为不兼容且**不加载**，不静默运行。
- Skill 的 `compatibility` 字段（自然语言环境要求）只做展示，不参与门禁。

## Trust

当前阶段：`bundled`、`workshop`、`git` 三种来源**全部信任放行**，安装后可执行其携带的脚本与依赖。

这是明确的阶段性决定，不是遗漏。前提是当前为 owner-only 私有内测。账本保留 `origin.kind` 正是为了在引入信任分级时有据可依。以下事实同时成立，写入协议以免被当作已解决：

- Workshop 站点的 TypeScript AST 门禁是发布质量检查，**不是安全沙箱**。
- Workflow 源码在受限求值壳中执行，无 `require`、无 `fs`/`process` 注入，但这不构成对第三方代码的隔离保证。
- Skill 可携带 `bin`、`scripts` 与依赖，安装即等于允许在用户机器上执行第三方代码。

第三方资产的执行隔离威胁模型仍未完成。公开邀请之前必须重新处理本节。

## Per-type Notes

### Skill

id、展示名与版本的真相源全部在 `SKILL.md` frontmatter，详见 [skill-package.md](skill-package.md)。`package.json` 对本地安装是可选的。

### Workflow

`workflow.ts` 的 default export 提供 `title` / `description` / `whenToUse` / `argsHint`；`key` 以目录名为准，文件内声明不一致时被目录名覆盖。这套形态已经满足「id 与展示名分离」，不需要引入 frontmatter。

版本可选，从同目录 `package.json.version` 读取。当前 7 个内置 Workflow 全部没有 `package.json`，因此都是无版本包，升级判定走 `contentHash` 比较。

### Profile

Profile 的安装比另外两类多一层：源码 `.profile.tsx` 需要编译成内容寻址 artifact 才能运行。

- 包内容同时包含源码与随程序预编译的 artifact。安装时两者一起落地。
- **Profile 的 commit unit 不是自包含目录**，详见 Install Transaction 的 Commit Unit 小节：入口文件与同名资料目录逐条移动，共享的 `.compiled/` 与 `manifest.json` 不参与阶段 5。
- 安装事务的 **Post-install** 阶段把 artifact 送进 staging，经 `ProfileReleasePublisher` 在 per-root publish lock 内合并进当前 manifest 并翻转 Registry。安装器**不直接写 `manifest.json`**，也不在锁外删除或覆盖 `.compiled/artifacts/**`。
- Install Root 排他锁与 Profile 的 `.publish.lock` 是两把独立的锁。事务持有前者进入阶段 7，Publisher 在内部获取后者；**不得反向嵌套**，否则会与后台编译 Coordinator 死锁。
- 一次安装只发布一个 batch patch release，不得用安装开始时的旧 full manifest 覆盖并发发布。
- Publisher 提交磁盘 release 之后是不可回滚边界：后续 Registry 翻转失败或账本写入失败都不能回滚 profile source，否则 manifest 会指向不存在的 source hash。这条边界优先于本文的事务回滚规则。
- 卸载 Profile 包时只删源码与账本条目；`.compiled/artifacts/` 中失去引用的 artifact 由既有 GC 按 orphan 预算回收，安装器不直接删除。

其余编译、artifact、manifest、GC 与依赖门禁契约不变，见 [profile-compiled-artifacts.md](profile-compiled-artifacts.md)。

## Migration

从旧投影模型切到本协议需要一次性迁移：

1. `agent/skills/**`、`agent/workflows/**`、`agent/profiles/**` 整体退出 user-assets 同步协议。`templates/` 与 `variables/` 仍留在旧协议中，**两套机制并存是本次切换的既定代价**。
2. 首次以新协议启动时，把 `.system-assets-sync-state.json` 中属于这三类的条目转换为账本条目：版本从磁盘包读取，内容指纹重算；与上游不一致的包标记 dirty 并保留用户改动。
3. 存量用户机器上由旧墓碑名单负责清理的残留文件，必须在迁移中一次性执行完毕，之后从代码中删除对应名单条目。迁移未完成的实例不能删除名单。
4. 迁移必须可 preflight、幂等，且失败时保持旧状态可用。

## Review Checklist

新增或修改安装链路时检查：

1. 包是最小单位，没有任何按文件比较、合并或投放的新逻辑。
2. 安装落点在 State Root 之下，Seed Root 保持只读且不作为 catalog 层。
3. **无版本包能正常收到更新**：升级判定在版本缺失时回退到 `contentHash`，不会静默停更。
4. 事务在 Install Root 排他锁内执行；账本的读—改—写在同一持锁窗口内完成。
5. 意图分开：版本必须更高的约束只作用于 `upgrade`，`repair` / `restore` / `takeover` 不受它拦截。
6. Commit Unit 按类型正确：Profile 不当作自包含目录处理，共享 `.compiled/` 与 `manifest.json` 不进阶段 5。
7. 事务七阶段完整，失败路径不留半安装状态；账本写入是唯一提交点。
8. 账本缺失或损坏时走重建比对，**不把「无条目」直接判成 `local`**。
9. dirty 包不被静默覆盖，冲突有明确出口；跨来源同 id 走 `takeover` 且需用户确认。
10. `bundled` 删除后不复活，但任何显式安装动作都清除墓碑。
11. 依赖状态记在账本，不从路径反推包身份。
12. `minAppVersion` 在安装前和加载前都生效，且 Skill 可在无 `package.json` 时声明它。
13. Profile 走 Publisher，安装器不直接写 manifest、不锁外动 artifact，两把锁不反向嵌套。
14. `.staging` 与 `.trash` 不进 Studio、文件历史、备份与下载包。
