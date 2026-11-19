# t06 实现审查的处理（2026-11-19）

审查对象：`a36f27c01..14e0554ff`（内核、会话服务层、新插件 `nbook.bots` 三片）。审查者是一个 omp 会话（默认模型），在固定于被审提交的审查 worktree 里只读，探针放在仓库外。[报告](impl-review-omp.txt)共 9 条：重要 7、建议 2，没有阻断。

| 条 | 归类 | 处理 |
|---|---|---|
| 1 建会话在校验之后才读归属，等 Profile 解析时被改的值没经校验就写进会话头 | 成立，改 | `createSession` 第一个 `await` 之前复制一份选项，校验与会话头都用这份。用例：Profile 解析挂住时改调用方的参数，写下与重开都是校验过的值（变异抓到） |
| 2 发话结算的反应批写失败后，状态帧与快照把 `broken` 报成 `idle` | 成立，推迟到 t16 | `resolve` 在本分支之前就这样，`settlePending` 复用了同一条路径；与设计审查推迟的第 2 条同一个场景。写进 runtime.md 的已知限制，记进 [t16](../../t16-kernel-narrow-window-defects/README.md) 第 4 条 |
| 3 同 id 的建会话与持有重叠：打开晚到、成功时持有记在脱离表的旧表项上，30 秒后会话照样关闭 | 成立，改 | 会话表的打开发现表项已被建会话换掉时不接管句柄，交回 `superseded`，等它的调用改去取现行的表项（`opened` 为 null）。用例照审查者的时序（变异抓到） |
| 4 停服务端时 `nbook.agent` 先关掉了 bot 还持有的主对话 | 成立，改 Spec | `nbook.agent` 停止时按 sessions.md 输出 14 关闭会话、不等持有，`release()` 之后什么都不做，这是输出 24 已写的合同；bots.md 与 main-conversation.md 写的“先放掉持有、再关闭”与之矛盾，后果只是先后（都以 `interrupted` 关闭）。改 Spec 的措辞，不为先后另加停止阶段 |
| 5 记录里的 bot id 不合规则时被接受，还会从凭据恢复出第二个 bot | 成立，改 | 记录与创建凭据共用一个 schema，id 按 `[a-z0-9-]{1,40}` 核对；存储把不合的整条交回 `corrupt`，按读不懂处理。用例：只改 SQLite 里的 id，不登记、不建主对话、原数据不改写（变异抓到） |
| 6 受理批写下、同步失败（结果不确定）时，等待者被交还，接着往坏了的句柄上写而抛 `LogBrokenError` | 成立，改 | `releaseClaims` 在句柄已坏时一律以 `aborted` 叫醒。顺带：句柄坏了时关闭会话不等运行，运行之后的写入得 `SessionClosedError`，成了没人接的拒绝（服务端会按致命错误停下）；运行的收尾把它与 `LogBrokenError` 一样收掉。用例：真实 JSONL 注入一次同步失败（两处变异都抓到） |
| 7 岗位提示词把没有主项目的主对话引向 `project://` | 成立，改 | 改成 `projects://<短名>/…`，写明没有 `project://`；Profile 升到版本 2。用例断言模型请求里的系统提示词 |
| 8 岗位 Profile 公布了 `agent_spawn`，白名单却是空的 | 成立，改 | 声明 `agents` 同主创（允许并推荐 `nbook.agent.adhoc`）。用例在主对话里真派一个子代理（变异抓到） |
| 9 缺省预设的声明没交付时 `ensureMain` 一直等、已有 bot 也不恢复 | 成立，改平台（开发者 2026-11-19 选“改平台（推荐）”） | 根在平台的单条校验：同 id 先按重复两份全拒、后查 id 前缀，第三方插件声明一个它无权用的 id 就能挤掉内置的那一条（`nbook.bots.lyra`，也包括 `nbook.agent.main` 这类 Profile）。改成前缀不合的一条只拒它自己、不算重复者；runtime/plugins.md 输出 15、验收 16 改写。用例：两种登记顺序下合法的那条都被接受（变异抓到）。缺省声明被平台接受之后不会交付不到，`ensureMain` 的等待不另加超时 |

审查者另记的、不计为新问题的：只停 `nbook.bots` 时在途的 `ensureMain` 得 `provider-error`（Spec 里补了一句）；内核与 kit 合跑时两条用例超时或报 `FileHandle` 的 GC 错误，隔离后通过，与本次改动的因果没确认。

审查者的回写建议（审查模板要同时设 `NBOOK_HOST_SYSTEM_TEMP_ROOT` 与 `NBOOK_AGENT_TEMP_ROOT`）：已写进 reviewing Skill 的“规则”。
