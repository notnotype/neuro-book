---
schema: nbook.task/v2
taskId: t26-resume-last-project
status: done
updated: 2026-11-25
---

# 打开 NeuroBook 时回到上次的作品

## 目标与范围

桌面版启动、托盘或 Dock 开窗、nbook 命令打开浏览器时，直接进最近打开的那部作品；手动打开地址、回到书架、出错页的链接仍是书架；设置里加“启动时打开：上次的作品 / 书架”，缺省上次的作品。

合同：改 runtime.projects、workbench.bookshelf、runtime.desktop-shell、runtime.cli（见 plan.md 的“Spec 与文档改动”）。

## 当前状态

2026-11-25 计划第 1 稿写好（[plan.md](plan.md)），开发者 2026-11-25 回“可以”，计划要点全部按推荐：设置放“作品”分区；已有窗口时再开是书架；上次的作品打不开时停在出错页；冒烟改完要演练（推 master）。此前已定：开发者已定：只在启动类入口恢复、只恢复最近一部、加“启动时打开”设置且缺省上次的作品。

## 计划的设计审查（2026-11-25）

Claude Sonnet 一份，11 条（阻断 1、重要 5、建议 5），全部成立，已改进 [plan.md](plan.md)：拼地址用 `new URL`（字符串相加会成 `//api/…`、静默进书架，阻断）；路由任何失败都 302 到 `/`；“作品”分区是手写页面，要改 `WorksSettingsPage`；开窗规则只落在 `windows.ts`、关闭中的窗口不算、启动期间只第一个启动窗口 resume；记录照 `projects.stats` 自愈、先核对登记表、不存时间；查询串丢弃；路径常量放无导入的小文件；Spec 补齐要同步改的原句；`smoke-windows` 加一次重启覆盖真实壳的 302，`smoke-update` 在它备份的 `settings.json` 里设 `startupOpen: shelf`；目标地址用 `projectUrl`。报告：[evidences/design-review.txt](evidences/design-review.txt)。

## 实现与实现审查（2026-11-25）

切片 1 `cb19db2e2`（作品插件：记录、设置、路由；服务端入口改为启动时激活：不改的话桌面版一启动请求路由就是 404，合同测试先撞到）、切片 2 `1869eb47f`（桌面壳开窗规则、`nbook` 打开的地址、两份发布冒烟），Spec 在 master 上（`79a3245b2`）。

实现审查（Claude Sonnet）7 条：重要 2、建议 5，全部成立，已修（`143c7c928`）：Lab 场景登记新设置；浏览器入口调 `opened` 的那段补了经真实浏览器入口的测试（变异检查：去掉调用，用例失败）；书架 e2e 查到这一行；写入改用 `update`、坏记录才 `reset`；写入中停用控件、失败回到层里的值；诊断事件按设置分开；开窗规则用例改名对上断言。“关闭中的窗口不算”这条判据在现有流程里到不了（最后一个窗口在关时托盘与转交都不开窗），保留写法、不另造用例。报告：[evidences/impl-review.txt](evidences/impl-review.txt)。

## 下一步

已完成。2026-11-25 推 master 后演练（[运行 45638084691](https://github.com/notnotype/neuro-book/actions/runs/45638084691)）：桌面包与 Windows 冒烟（含安装版“再启动直接进上次的作品”）、更新冒烟 A′、B′、macOS 的壳与桌面包都过；演练整体判失败是因为 CI 的两条与本 Task 无关的测试（一条已修，一条原有偶发，见 [t25](../t25-release-0-16-0-17/README.md) 的“下一步”）。macOS 的 Dock 重开在 t23 的真机验收里一起看。
