# 本地资产目录

`.local/` 放不进仓库的本地东西：除本文件外全部被 Git 忽略，不属于产品源码、发布输入，也不作为 CI、发布与测试的默认输入。什么进 Git、什么留在这里，判据见 [Work 规则的“本地与入库”](../.agents/works/README.md#本地与入库)。

目录分两块：Agent 管的 `agent/`，与用户管的其余目录。

## Agent 区：`agent/`

Agent 可以读写。除 nbdev 的登记表外只放能重新生成的原始输出，按 Work 与 Task 组织；Work 与 Task 的记录、产物与答复都在仓库的 `.agents/works/`（见 [Work 规则](../.agents/works/README.md#编号分配与记录位置)）：

```text
.local/agent/
├── registry.json              # nbdev 的编号登记表（不可重新生成，见下）
├── registry.json.lock/        # nbdev 写事务的锁，里面的 owner.json 记持锁进程（事务进行中才有）
├── run/
│   ├── leases/                # nbdev 的租约（哪个会话在动哪个 Task），失效与释放的不删
│   ├── procs/                 # 经 nbdev 起的进程（t14 起写）
│   ├── provenance/            # 入库的发布记录、代录答复与确认是哪个会话写的（提问者）；删了只是找不到提问者
│   └── tmp/                   # nbdev 写事务的临时目录
└── works/<workId>/tasks/<taskId>/
    ├── reports/               # 子代理、omp 的会话目录与原始输出；要给开发者看的报告作为产物入库
    ├── shots/                 # 完整截图集与原图；精选的转小后作为产物或证据入库
    └── logs/                  # 测试与检查的原始输出、开发服务日志
```

- 登记表 `registry.json` 只记领号的事实，格式见 [nbdev 文件格式](../packages/dev-panel/docs/file-formats.md)。它不是能重新生成的原始输出：`nbdev registry import` 只能从扫描重建 `imported` 条目，`claimed`（经 nbdev 领的号）、`abandoned`、执行位置提示 `home` 会丢；丢了以后，同步过 `master` 的分支上经 nbdev 建的 Task 会被当成分支上的记录、拒绝写入。不要随手删。
- `run/tmp/` 里的目录来自中断的写事务，确认没有 nbdev 在跑后可以删。
- 这些东西放这里，不放会话临时目录：`/tmp` 下的会话目录在重启或清理后就没了。会话临时目录只放用完即弃的脚本。
- 不放密钥与个人数据。
- 用不到的子目录不建。

## 用户区：其余目录

用户管理的本地素材。Agent 只在用户明确要求时读取、写入、移动或删除；来源、更新、备份、授权与清理由用户负责，仓库治理不替用户管理。需要进入仓库的脱敏结果放进对应 Task。

- `github/`：外部第三方调研仓库。默认只作人工调研参考，不自动拉取、更新或改写。
- `datasets/`：本地数据集和评测语料。
- `drafts/`：从仓库 `docs/drafts/` 移出的用户草案、原始提示词和个人 TODO。它们不是当前规范、Proposal 或 Task；需要恢复开发时先提炼为仓库内的规范、Proposal 或 Issue。
- `brand/`：本地品牌母题草稿、Logo 早期探索归档与迭代中的看板娘设计资产（定稿 Logo 已入库至仓库根 `brand/logo/`）。
- 其他目录：用户自行管理的本地素材，例如书籍资料和角色草稿。
