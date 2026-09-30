---
schema: nbook.task/v2
taskId: t01-baseline-startup
---

# 基线启动验证

## 目标

在 `67f809e9`（nb-ui 底座迁移合并 `bb688931` 之前的 master）上把 NeuroBook Source Dev 主应用真实启动起来，确认该基线可运行，并给出可观察证据（监听端口、页面可达、关键 UI 表现）。

## 修改范围

1. 在 `.worktree/w00018-pre-nb-ui-baseline` 内按该 revision 的 `bun.lock` 执行依赖安装。
2. 按 `packages/neuro-book` 的 Source Dev 入口启动应用；记录启动命令、监听地址与 State/Cache 根。
3. 用浏览器打开实际页面，确认主界面加载与本次要观察的 UI 形态。

## 验证

- 启动进程真实存活且监听预期端口。
- 浏览器实际打开并渲染页面，不以满足「命令退出码 0」代替。
- 观察结论区分：已验证（实际看到）、从代码推断、未验证。

## 边界

- 该 checkout 为历史 revision，仅供运行观察；不提交、不 push、不合并。
- 不修改源码来迁就环境；若基线确实无法启动，如实记录失败点与原因，不伪造可运行结论。
- 不调用真实 Provider/Model（可用时不触发真实模型调用）。

## 结果（2026-09-28）

- worktree `.worktree/w00018-pre-nb-ui-baseline` @ `67f809e9`，分支 `chore/w00018-pre-nb-ui-baseline`；`bun install --frozen-lockfile` 成功（1561 包 / 35.3s）。
- 独立 State/Cache Root：`~/.local/share/NeuroBook-w00018/data`、`~/.cache/NeuroBook-w00018`；`migrate:deploy` 应用 4 个 App SQLite migration，`migrate:application-state -- --apply` 完成初始化。
- Source Dev 启动成功，监听 `0.0.0.0:3010`；局域网入口 `http://192.168.1.18:3010/`，`curl` 返回 200 / 5,121 字节 HTML，内置 Chromium 实测渲染出「我的书架」空态页面（`body` 15,342 字节 DOM，无 console 错误）。
- 启动参数：`PORT=3010 HOST=0.0.0.0 NITRO_HOST=0.0.0.0 NUXT_HOST=0.0.0.0`。基线 `source-dev` 只在未显式给出 host 时强制 `127.0.0.1`，因此必须显式设置才可局域网访问。
- 该基线在开发环境默认关闭鉴权，局域网内无需登录即可访问；仅限受信网络使用。

## 数据来源（2026-09-28 追加）

- 初始为隔离空 State Root；为查看原有作品，停止服务后把默认 root `~/.local/share/NeuroBook/data` 整体复制为 `~/.local/share/NeuroBook-w00018/data`（651 M，`workspace/` 下 10 个目录），基线随即指向该副本，书架显示 7 部作品。
- 复制是快照：原 root 之后的新改动不会同步到副本，副本上的写入也不回原 root。
- 未直接使用原 root：基线代码 `67f809e9` 旧于现有数据，启动时会 `--force-sync-user-assets` 并对库做迁移检查，且原 root 当时正被其它实例并发写。

## 未验证

- 未在第二台机器上从局域网实际打开页面（本机以局域网地址自测）。
- 未触发真实 Provider 调用；书架可见 7 部作品，未逐个打开验证正文读写。
