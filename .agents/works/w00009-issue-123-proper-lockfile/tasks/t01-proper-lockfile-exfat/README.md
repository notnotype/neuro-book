---
schema: nbook.task/v2
taskId: t01-proper-lockfile-exfat
---

# 修复 proper-lockfile Windows exFAT 租约误失效

## 目标

为根 workspace 固定 `proper-lockfile@4.1.2` 的精确 Bun patch：按每把锁实际可往返的 mtime 精度生成心跳，避免 Windows exFAT 正常续期被误报 `ECOMPROMISED`；不放宽所有权检查，不改变应用层 `stale=30000` / `update=15000`。

## 修改范围

1. 新增 `patches/proper-lockfile@4.1.2.patch`，登记根 `package.json` 的 `patchedDependencies`，使 `lib/mtime-precision.js` 不再在 fs 对象间共享精度缓存，并使 `lib/lockfile.js` 仅对精度探测耗尽产生的、带 `precisionUnsupported` 标记的 `ENOTSUP` 跳过 retries；普通 I/O `ENOTSUP` 保持原有重试。
2. 新增 `scripts/build/proper-lockfile-patch.test.ts`：用受控时间和局部 fs adapter 覆盖 1ms、1000ms、2000ms 量化；覆盖 async、sync、跨精度缓存、失败终止、真实 mtime 变化触发 `ECOMPROMISED`。
3. 新增 `scripts/ci/validate-proper-lockfile-patch.ts`，校验精确依赖登记、Bun lock 映射、补丁上游坐标、补丁关键载荷和安装后的补丁内容；聚焦 Vitest 同时调用该校验入口。
4. 新增 `docs/specs/agent/session-store-lease.md` 并登记 capability `agent.session-store-lease`；实现闭合且真实 exFAT 证据可用前保持 `planned`。
5. 保持已有 Session Store、Project Lock、Manager 和 Product shutdown 公共接口及 fail-closed 语义；不改 `stale/update` 参数，不吞掉 `ECOMPROMISED`，不修 #225 或 Manager 外部依赖。

## 验证

- 红灯：未打补丁的 `proper-lockfile@4.1.2` 在固定非秒时间与 2 秒量化 adapter 下触发续期失败。
- 绿灯：`bun x vitest run --config scripts/vitest.config.ts scripts/build/proper-lockfile-patch.test.ts`。
- 补丁校验：`bun scripts/ci/validate-proper-lockfile-patch.ts`。
- 现有租约与竞争回归：
  - `bun run --cwd packages/neuro-book test -- server/agent/session/agent-session-store-lease.test.ts server/agent/session/agent-session-store-lease-compromise.test.ts server/agent/session/agent-session-store-release.test.ts`
  - `bun run --cwd packages/neuro-book test -- server/workspace-files/project-lock.test.ts`
- 干净安装后重复补丁测试，确认不是手改 `node_modules`。
- `bun x tsc --noEmit -p scripts/tsconfig.json`。
- Windows Product/Portable 载荷重建后，在真实 NTFS 与可用 exFAT 卷分别观察租约至少 120 秒、竞争进程必须得到 `ELOCKED`、释放后可重取；无 exFAT 卷时不得宣布 Issue 已修复。

## 边界

不新增锁协议、不改变锁目录格式、不手工删除锁、不延长 stale、不忽略 `ECOMPROMISED`，不运行真实 Provider/Model，不写远端 Issue/PR，不 push、合并、发布或部署。

## 当前收尾状态（2026-09-08）

- 本地 Product/Portable、NTFS 120 秒租约、Product stage 竞争 `ELOCKED`、lease release/reacquire 和 Workbench World Engine API 回归已完成；结构化证据见 `evidences/review-2026-09-07-final.json`。
- 公开载荷为 `0.10.2-canary.20260908.091411Z.2e86c254`；本地 Product stage 和历史 acceptance stage 已通过 `scripts/deploy/product-runtime.mjs cleanup` 清理。
- 真实 exFAT 卷仍不可用，不能把 Issue 标记为已完成；Spec 保持 `planned`。
- Issue #123 已在 GitHub 留言请求报告者使用 `0.10.2-canary` 在真实 exFAT 机器上复测；当前等待提出者提供 120 秒租约、竞争和 release/reacquire 结果。不要手工删除 lock 文件。
- Product Runtime stdout/stderr 断管问题已另开 Issue #228，不并入本 Task。
