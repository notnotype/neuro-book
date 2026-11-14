---
schema: nbook.task/v2
taskId: t10-auto-update
status: active
updated: 2026-11-14
---

# 桌面版自动更新

## 目标与范围

Electrobun Updater 接 GitHub Releases：后台检查与提示、下载前核对版本只升不降、下次启动时换上、安装级排他、目标移动后重新检查；便携版只提示。依据提案 4.6、ADR 0051 决定 6。

合同：[`runtime/desktop-update`](../../../../../docs/specs/runtime/desktop-update.md)；[`runtime/browser-host`](../../../../../docs/specs/runtime/browser-host.md) 输出 11；[`runtime/desktop-shell`](../../../../../docs/specs/runtime/desktop-shell.md) 输出 13。计划见 [plan.md](plan.md)，更新器调研见 [evidences/electrobun-updater-research.txt](evidences/electrobun-updater-research.txt)。

## 当前状态

2026-11-13：
- 页面一侧的设计审查（Sonnet）8 条，均改（[报告](evidences/design-review-r1-sonnet.txt)、[处理](evidences/design-review-r1-sonnet-disposition.txt)）。
- 壳与更新器的设计审查（omp）17 条，阻断 3 条（[报告](evidences/design-review-r1-omp.txt)、[处理](evidences/design-review-r1-omp-disposition.txt)）。阻断三条指向同一个上游问题：Spec 要求的“安装独占保持到新版本接手”，Electrobun 2.0.6 的原生 helper 做不到。停下交开发者定方向。

2026-11-14：开发者选方向 A，即改 Spec，靠更新器的 helper 与 Windows 的文件占用：
- 壳只在没有别的壳在用时才发起换上；
- 换上期间又有人打开旧程序时，这次换上失败、还原，通知“更新没有完成”，下次再试。

Spec desktop-update 已随之修改（术语“安装的使用与换上”、输出 4、7、8，时序、失败表与场景 4）。计划按这个方向与 omp 的另外 14 条修订后，交第二轮设计审查。

2026-11-14：第二轮设计审查（omp）10 条，阻断 3 条，全部成立、均改进计划（[报告](evidences/design-review-r2-omp.txt)、[处理](evidences/design-review-r2-omp-disposition.txt)）：状态文件改单写者、换上终态读更新器的结果文件、拿不到共享锁不启动、下载结果按 `updateInfo` 判断、版本来源改为 `PRODUCT_VERSION`。交第三轮（最后一轮）设计审查。

2026-11-14：第三轮设计审查（omp）3 条重要、没有阻断，均成立、已改进计划（[报告](evidences/design-review-r3-omp.txt)、[处理](evidences/design-review-r3-omp-disposition.txt)）：未对账时运行中每 30 秒重判，进行中与否看换上程序的进程而不是 10 分钟墙钟，验收前确认缺省状态根不存在。满三轮仍有实质问题，停下问开发者；开发者 2026-11-14 定：按修订后的计划直接实施，修订部分（运行中重判、按进程判进行中）在实现审查里重点看。

切片 1 `4bc20008f`：nb-flock 的共享锁。本包测试 6 条、类型检查，使用方的锁测试（nb-harness 日志 32 条、nb-story 669 条、Skill 安装 8 条）通过；Windows 上用真实子进程核对了四种关系（两个共享共存、共享挡独占、独占挡共享、持有者退出后可拿）。随 t08、t09 一起合入 master（`fe4560370`）。

2026-11-14：开发者定 Windows 验收直接用 pc-notype 上已有的 `%LOCALAPPDATA%\NeuroBook`（里面没有要保护的真实数据），计划“验证”一节已改。

切片 2 `0d28ccb62`：
- 核心分两个文件：`src/desktop/update.ts` 是运行中的控制器（检查、只升不降、下载绑定目标、页面选择的判定）；`src/desktop/update-install.ts` 是安装级的状态文件、安装锁、启动时换上与对账。
- 结果文件的校验（照 Electrobun 2.0.6 的 `scanNativeUpdateResults` 与 `validateNativeUpdateResult`）放在核心的 `scanApplyResults`，适配层只调用它。这样能在 Linux 上测，与计划“适配层自己读”的写法不同，规则不变。
- 壳：取桌面锁之前换上并登记在用（共享锁）；拿不到共享锁时启动页报“另一个 NeuroBook 正在更新”；取锁后对账；进入运行中启动控制器，停止中封住它，放锁前关掉它。退出请求只在取锁之前放行（`acceptsQuit`，适配层在切片 4 接）。
- 窗口协调器：按焦点与就绪交付提示，持有窗口关掉、刷新、离开就绪时转交。
- 验证：`bun test src/desktop` 81 条通过；类型检查与 `governance:check` 通过。7 处关键规则做了变异核对：6 处被测试抓到；1 处没被抓到，是因为“正在关的窗口不选”被另一处判断重复保证，这处多余的判断已删掉。
- 2 条新的产品取舍记进了待确认清单：“打开下载页”后不再提示同一版本；一次性通知优先。

切片 3 `330938c7f`：桥加更新提示、选择、已显示、页面就绪与离开的消息；窗口经非必需的启动门禁取工作台通知服务（`notifications()`，离开 ready 即为 null）；页面一侧 `src/web/host/desktop-updates.ts` 按提示种类发通知；宿主文案 `update.*` 中英两份。验证：桥、窗口、关闭前询问、`desktop-updates` 等单测 67 条，`mount.dom.test.ts` 7 条，e2e `desktop-update`（新增 4 条）与 `desktop-close`（3 条，旧断言改为只看关窗的消息）通过。

切片 4 `8472400a5`：适配层接 Electrobun 2.0.6 的 `Updater`。
- 检查只取版本、哈希与错误。
- 下载、换上都按调用之后的状态判断：下载看 `updateInfo`，换上看新增的状态记录里有没有“正在启动新版本”。
- 结果文件交给核心的 `scanApplyResults`；换上程序的进程用 `tasklist` 的 CSV 查。
- 页面的就绪与选择消息、窗口焦点接进协调器与控制器；取桌面锁之前放行退出请求。
- `electrobun.config.ts` 加 `release.baseUrl`、`generatePatch`，以及验收用的 `NBOOK_UPDATE_BASE_URL`、`NBOOK_DESKTOP_IDENTIFIER`。
- 验证：主进程能打包。适配层不在类型检查范围内，用到的接口逐个对过 2.0.6 源码，行为留给切片 5 在 Windows 上实测。
- 核对源码时发现计划里 t11 门禁的查询串写错了：更新器取清单用的是 `stable-win-x64-update-v2.json?<16 位十六进制>`，不是 `?cache=<32 位>`。计划已改。

切片 2 的 omp 实现审查 5 条（阻断 1、重要 4），均成立、已改（[报告](evidences/impl-review-s2-omp.txt)、[处理](evidences/impl-review-s2-omp-disposition.txt)），修正 `2e0fae272`。

切片 5（2026-11-14）：pc-notype 上的 Windows 验收，第 1 轮 [windows-update-r1.txt](evidences/windows-update-r1.txt)。本地更新源，A、B、C 三个版本，desktop-update 场景 1 到 7 都通过。
- Spec 按实测改了四处写法：
  - 选“下载”时先重新检查（场景 3）；
  - 换上程序遇到文件占用会等约 5 分钟，期间旧程序关掉就照常换上；占用 420 秒时约 290 秒失败、还原，旧版本通知“更新没有完成”（场景 4）；
  - 启动页的“正在更新”来不及显示；
  - 场景 6 改用绝对路径。
- 发现一个缺陷：相对路径的 `NBOOK_STATE_ROOT` 解析进了安装里的 `app\bin`（启动器的工作目录），换上后数据会丢。修正是壳拒绝相对路径、启动页要求改成完整路径（`d45edcb84`，`bun test src/desktop` 89 条、类型检查通过）。desktop-shell Spec 跟着改，记进待确认清单。修正后的包没有在 Windows 上重跑。
- 缺省状态根对照验收前的清单：没有新增顶层条目，`projects.json` 未变。
- 构建测试版本时改了 package.json 的版本还要 `bun install` 刷新 `bun.lock`，计划与 t11 门禁的查询串已补。

## 下一步

收口：
- 对切片 3 到 5 的提交启动实现审查：页面一侧派 Sonnet，壳与适配层开 omp；
- 处理审查结论后合入 master；
- 删掉构建用的 worktree `w00046-t10-build`；
- 停掉 pc-notype 上的本地更新源。
