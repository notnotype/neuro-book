# user HTTP 值操作与受管句柄

2026-09-16，基于 `3b8d87fb`，本 Work worktree。原有两个 descriptors dirty 文件未动。
omp 两轮实现后，主 Agent 在同一 Task 切 tasker 补已复现边界，再恢复 Leader 验证与编排独立审查。
下面是源码和主 Agent 实跑证据，不以子代理的退出状态证明交付。

## 当前实现

- `POST /api/storage/user/action`，严格有界 DTO：read/save/remove/migrate/repair/reclaim。
  HTTP 不接受根、主体、scope/locality、校验或注册策略；只能消费受信模块登记的 owner/key。
- 宿主持有 `StorageStateRegistry`、`StorageService` 与 `StorageHandlePool`，并发的同 context/owner 复用句柄。
  最后使用者结束即释放，不保留空闲句柄；打开、使用、释放都受容量限制，关闭排空在途打开和释放。
- 每次请求重验访问，慢 open 后也再次验证；guard 注入核心，在等锁、异步路径检查和替换重试后检验存活。
  已签发访问携带预期根身份，打开时仅检查已有根，不创建消失的目录。路径仍规范化以统一短路径别名。
- 保存、删除和修复沿用核心 CAS/原件保护/容量。回收先写新代次再清墓碑；之后授权失败也保留 committed。
  成功读取中的坏值诊断经 HTTP 固定文案投影；回收只公开原因分类，不公开内部文件路径。
- 当前宿主全局形状使用 V3 槽，发现旧 V2 owner 时设置其关闭标记并排空身份初始化；
  新 owner 的接纳和关闭都等待该排空。独立追加复核确认无死锁或漏排空路径。

## 已实跑

| 命令 | 当前结果 |
| --- | --- |
| `bun run --cwd packages/neuro-book test shared/storage server/storage server/api/storage app/utils/storage server/utils/auth.test.ts server/api/auth/login.post.test.ts server/runtime/shutdown/product-shutdown.test.ts` | 最终 exit 0，24 文件、191 用例通过，包含全部 t23 基线和新增 HTTP/磁盘/生命周期/HMR 回归 |
| `bun run --cwd packages/neuro-book typecheck` | exit 0 |
| `bun run --cwd packages/neuro-book smoke:storage-host-identity --browser-executable 'C:/Program Files/Google/Chrome/Application/chrome.exe'` | exit 0，passed、findings=[]；独立浏览器与普通 HTTP，临时根 finally 清理 |
| `bun run docs:check` | 最终 exit 0，5635 文件、failures=[] |
| `bun run governance:context --work w00003-neurobook-ui-foundation-migration --task t24-storage-user-http --role tasker` | exit 0，failures=[] |
| `git diff --check` | exit 0 |

两项独立探针先失败后补生产修复和回归：根被移走后 read 拒绝但曾重建空目录；慢释放曾不计容量。
故障注入测试曾把 replace adapter 写成函数，已改成真实 adapter，替换重试撤销用例现在实际执行。
回收撤销接缝统一真实路径后通过，未用放宽断言掩盖 Windows 路径差异。

未跑其它 OS、整套产品、真实用户迁移或 Project 接线；scripts 全集 typecheck 仍有 t23 已登记的既有主题 fixture 错误，
本轮未更改该脚本，也不声称脚本全集通过。旧浏览器探针目录清理曾被自动审批拒绝，继续保留、不绕过重试。

## 继续条件

独立审查为 [t25](../../t25-storage-http-review/README.md)，初审及 HMR 追加复核均给出无阻断项。
主 Agent 修正其报告中三处相对链接，未改审查结论；unsupported-version 诊断断言和 ready 接纳顺序的加强用例留给下一增量。
本增量仅本地提交，不 push/PR/部署。
前端长期句柄、订阅和网络中断语义见 [接续边界](adapter-next-boundaries.md)；它们尚未实现，切片 1 仍未全部完成。
之后才进入 Project 生命周期与文件/备份集成；六切片 goal 保持 active。
