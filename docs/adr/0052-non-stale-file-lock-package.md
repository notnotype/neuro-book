---
schema: nbook.adr/v1
status: accepted
decided: 2026-11-13
superseded-by: null
---

# ADR 0052：不判旧的文件锁单独成包 nb-flock，随 nb-story 发布

- 日期：2026-11-13
- 决策者：开发者
- 关联工作：[w00043 t12](../../.agents/works/w00043-neurobot/tasks/t12-flock-into-file-lock/README.md)
- 补充：[ADR 0029](0029-workspace-packages-publish-source-to-npm.md) 决策 6 的“其它工作区包需要发布时另作决定”：以源码发布的工作区包加上 `nb-flock`，从 9 个变成 10 个；0029 的其余决定不变

## 背景

工作区里有两种跨进程的文件锁，语义相反：

- **按过期判旧**：`nb-file-lock` 的 `holdLock`，建在 `proper-lockfile` 的锁目录上，持有者定时刷新，超过期限没刷新就被别人当作死掉、接管。适合短时间的临界区：可以排队等，持有者死了别人能接着干。它靠仓库根的补丁（`patches/proper-lockfile@4.1.2.patch`），补丁只在本仓库生效；`nb-file-lock` 不发 npm（[ADR 0045](0045-shared-host-packages-for-second-app.md) 决策 4）。
- **不判旧**：`tryLock`，经 `bun:ffi` 调 `flock` 或 `LockFileEx`，持有到 `release` 或进程退出，进程怎样结束锁都由系统放掉，不会因为持有者暂停太久被接管。适合一直持有到进程结束的单一所有者。nb-story 的书库锁先有一份（[ADR 0031](0031-nb-story-supports-windows.md) 加了 Windows），nb-harness 的会话日志照它写了第二份，w00032 t15 又把 nb-harness 那份开成 `@notnotype/nb-harness/file-lock` 给应用的 Skill 安装用。两份副本只差报错文字与一处 `release` 的写法，Windows 段要各自在 Windows 上实测。

nb-story 与 nb-harness 都随 nb-story 发布到 npm（ADR 0029），合成一份之后放的地方也要能发布。

## 决策

1. 不判旧的锁合成一份，单独做成工作区包 `@notnotype/nb-flock`：只有入口 `.`，导出 `tryLock` 与 `FileLock`；只导入 `bun:ffi` 与 `node:` 内置模块，没有运行时依赖。代码以在 Windows 上实测过的 nb-story 那份为底，只把报错文字换成中性英文。nb-harness、nb-story 与应用都从这里取，两份副本和 nb-harness 的 `./file-lock`（从没发布过）删掉。
2. `nb-flock` 随 nb-story 发布到 npm，发布方式同 ADR 0029（源码、只承诺 Bun、内部依赖 `workspace:^`、`files` 白名单、带 `LICENSE`），首发 `0.1.0`。`nb-file-lock` 不变：仍是 private，只有 `.`。
3. 选哪种锁：

   | 场景 | 用哪个 |
   |---|---|
   | 短时间的临界区，要排队等，持有者死了别人可以接管（加锁替换、设置与插件登记的写入） | `nb-file-lock` 的 `holdLock` |
   | 一直持有到进程结束的单一所有者，不许被接管（单实例服务、一个会话只有一个写者、一次安装只有一个人在做） | `nb-flock` 的 `tryLock` |

## 备选方案

- **放进 `nb-file-lock` 的子路径 `./flock`，`nb-file-lock` 随 nb-story 发布**：开发者先选了它，计划审查后改选本决策。它要把 `nb-file-lock` 整包公开：17 个导出成为要守版本的公开接口；`proper-lockfile` 与它的 3 个依赖随 nb-story 装到用户那里，运行时一个都用不到；`.` 入口在 npm 上没有仓库补丁，Windows 的 exFAT 一类卷上续期会被误报 `ECOMPROMISED`，要在包说明里写成已知缺陷。
- **留在 nb-harness 的 `./file-lock`，nb-story 也改用它**：不新增包，但 nb-story 的书库锁要依赖 Agent harness 的日志模块，`nb-file-lock` 与 nb-harness 各有一种锁的重叠还在。
- **维持两份副本**：零改动，但 Windows 段要测两遍，两份迟早分叉。
- **放进 nb-runtime 或 nb-host**：nb-runtime 的运行时依赖只有 TypeBox、前后端共用，放 `bun:ffi` 会破坏它的边界；nb-host 是 private 的宿主，nb-harness 依赖它方向反了。

## 后果

- 从 npm 装 nb-story 或 nb-harness 的人多装一个零依赖的小包。
- `bun:ffi` 被 Bun 标为实验性接口；已发布的 nb-story 0.2.x 一直在用它，这次只是换个包名公开，没有新增风险。Linux 只按 glibc 的库名 `libc.so.6` 加载，musl 上按推断会加载失败、抛错（没有实测）；不支持 `flock` 的文件系统（例如部分 NFS）上会一直拿不到锁。这些写在包说明里。
- Windows 段没有自动测试守着（ADR 0031 决策 3），改到它要在 Windows 上重测；现在只有一份要测。
- `nb-flock` 从没发布过。npm 要包已经存在才能配置信任发布，所以它的首发由开发者在本机手工完成（`release:publish`），之后才能给打标签自动发布的 CI 流水线（[w00046 t11](../../.agents/works/w00046-desktop-release/tasks/t11-release-pipeline/README.md)）配信任；流水线要发的包从 11 个变成 12 个。
- 合入时没有改 nb-harness 与 nb-story 的版本号。下次发布必须同时提它们的版本号：`release:publish` 跳过已发布的同号版本，只提 `nb-flock` 会发出一个没有任何已发布的包依赖它的孤包。
