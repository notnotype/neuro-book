---
schema: nbook.walkthrough/v1
taskId: t01-proper-lockfile-exfat
sequence: 4
role: reviewer
status: completed
createdAt: 2026-09-07T15:45:00Z
---

# 审查整改后的验证结论

## 结论

**部分完成；真实 exFAT 验收仍未完成。** 审查整改已合入 `master`，最终 Product/Portable 载荷、Product Runtime、Profile Import、Windows 浏览器 smoke、公开 0.10.2-canary 资产和 NTFS 120 秒租约采样均已完成；当前主机没有可用 exFAT 卷，因此不能把 Issue #123 写成 exFAT 实机已验收。

## 已验证命令

- `bun scripts/ci/validate-proper-lockfile-patch.ts`：通过；精确依赖登记、Bun lock 映射、补丁载荷和安装产物通过。
- `bun x vitest run --config scripts/vitest.config.ts scripts/build/proper-lockfile-patch.test.ts`：通过；1 file / 13 tests。
- `bun x tsc --noEmit -p scripts/tsconfig.json`：通过。
- Session Store lease、compromise、release 聚焦回归：3 files / 14 tests passed；Project Lock：1 file / 9 tests passed。
- `bun run --cwd packages/neuro-book nuxt:build`：通过；Product Runtime Image version `0.10.2-canary.20260908.091411Z.2e86c254`，revision `34210f891357c1c316d0868397a133c5d9eb70ec`，imageId `sha256:3b2091a5035d2abe27761a94d18aaeec7053ce2001d51af5d5c7f3d865f21d55`。
- `bun run product:stage`：通过；受控系统 Temp stage 完成并由 Builder 复验 copied image。
- 最终隔离 Product migration：catalogVersion 3；app-sqlite、agent-attachment-v1、agent-session-v2 applied；review-repair skipped。
- `bun run product:start`：通过；最终服务 `http://127.0.0.1:43124/`，版本接口返回 `v0.10.2-canary.20260908.091411Z.2e86c254`。
- Node 浏览器 smoke：通过；首页 Vue mount、关键资源、`/api/app/version` 和版本身份通过；截图为 `C:/Users/NOTNOT~1/AppData/Local/Temp/omp-sshots-15777a2ed3284dd5.webp`。
- Product Profile Import：`check profile-compile` 通过，`typeboxVersion: 1.3.6`；`profile preview leader.default --input-json '{}'` 返回 `preview ok: yes`，实际加载 `AGENTS.md`、`reference/**` 和 Profile DSL 资产。
- Product NTFS lease：9 次采样、15 秒间隔、耗时 120.0 秒；`runtime.lease.lock` 的 9 个 `mtimeMs` 均不同，未观察到 `ECOMPROMISED`。
- 公开资产：workflow `34208897904` 成功；Release `v0.10.2-canary.20260908.091411Z.2e86c254` 为非 Draft prerelease，公开资产完整；`verify-windows-portable.ts`、`verify-windows-portable-restart.ts` 和 `bun run manager:verify-public` 均通过。

## 未完成门禁

- 当前主机无可用 exFAT 卷，真实 exFAT 120 秒观察、竞争和 release/reacquire 未执行，不能宣称已通过。
- Spec 保持 `status: planned`。

## 证据索引

- 结构化证据：`evidences/review-2026-09-07-final.json`。
- 公开 Release：`https://github.com/notnotype/neuro-book/releases/tag/v0.10.2-canary.20260908.091411Z.2e86c254`。
- 最终人工验收 Product URL：`http://127.0.0.1:43124/`。
- Windows Portable restart smoke URL：`http://127.0.0.1:39123/`（verifier 生命周期结束后不作为常驻服务）。

## World Engine EPIPE 复核

- 旧 Product 服务在 `2026-09-08T11:55:39.447Z` 先记录 `process.uncaughtException`：`EPIPE: broken pipe, write`；栈位于 bundle `.output/server/index.mjs:80:907` 的 `_log` 输出路径。随后 esbuild channel 进入 `didClose`，World Engine `schema`/`slices` 被包装为 `The service is no longer running: EPIPE: broken pipe, write`。
- Product stage 内的 `esbuild.exe`、真实 `xin-xiao-shuo/world-engine/schema/index.ts` 与 `calendar.ts` 独立编译均通过；因此没有把 binary、schema 或 World Engine 业务逻辑认定为根因。
- 使用正确 `NBOOK_AGENT_TEMP_ROOT`、绝对 `NEURO_BOOK_STATE_ROOT`/`NEURO_BOOK_CACHE_ROOT` 和受管长驻进程重新启动后，`POST /api/projects/open`、`GET /api/app/version`、`GET schema`、`GET subjects`、`GET slices` 全部 HTTP 200；schema 返回 5 个 subject types，slices 返回空数组。
- Node/Chrome 点击真实活动栏 `data-activity-id=world` 后，Workbench 显示 `已同步`、`5 个类型`、`world-engine/schema/index.ts` 与 `world-engine/calendar.ts`；浏览器实际请求 schema、subjects、slices，页面无控制台错误。最终截图：`C:/Users/NOTNOT~1/AppData/Local/Temp/omp-sshots-15779277f3d2dfa1.webp`。
- 同一 Product stage 的第二个启动进程得到 `ELOCKED`；SIGINT 后 `43124` 无监听、lease lock 释放，随后同一绝对路径环境重新启动并再次通过 API smoke。wrapper 的 exit code `1` 是信号转发语义，不是 Product 子进程残留。

## 边界与残余风险

- 本轮没有修改 World Engine、esbuild 或 logger 源码；可重复通过依赖稳定的受管 Product stdout/stderr 生命周期。短生命周期 shell 关闭继承输出管道仍可能重新制造历史 `EPIPE`，因此必须使用稳定的长驻/受管进程。
- 当前主机仍无可用 exFAT 卷；NTFS 120 秒采样、公开 Portable restart 和本地 Product stage 竞争/release/reacquire 不能替代真实 exFAT 证据。Spec 继续保持 `planned`。
- H3 独立审批记录仍不可用；workflow、公开 Release、npm provenance 与 GHCR 可见性不等同于 H3 批准。
