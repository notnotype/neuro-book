# Round 01 - 缓存爆炸诊断与推荐架构

> 日期：2026-07-26  
> 范围：只读诊断与设计；没有修改业务代码，没有删除 Temp/Profile orphan，没有运行浏览器验证。

## 1. 用户看到的现象

- `.agent` 占用快速增长。
- 每次测试都会新增 `nbook-workspace-assets-*` 临时目录，失败后经常不消失。
- 测试看似消耗了远超代码与 fixture 正文大小的磁盘空间。

## 2. 反馈回路

本轮使用三个可重复信号定位问题：

1. 统计 `.compiled` 中 current manifest 引用与未引用文件的数量/字节。
2. 对最小 Profile 编译产物测量输入字节、输出字节、SHA 稳定性和 esbuild metafile inputs。
3. 对 `importRuntimeArtifact()` 连续使用相同/不同 key，观察物理 cache 文件数。

测试 fixture 的放大关系用 `系统 .nbook 大小 × fixture 创建次数` 与 `%TEMP%` 残留总量交叉验证。

## 3. 当前空间快照

| 路径/集合 | 数量 | 逻辑大小 | 判断 |
| --- | ---: | ---: | --- |
| `.agent` 清理前 | - | 约 39.10 GB | 多种可重建缓存混合 |
| `.agent` 清理后 | - | 约 11.353 GB | 已释放约 27.76 GB |
| `%TEMP%/nbook-workspace-assets-*` | 295 dirs | 约 119.994 GB | 无 Vitest 进程时的残留候选 |
| system Profile `.compiled` | - | 约 4.752 GB | current + orphan 混合 |
| current manifest refs | 28 files | 约 0.372 GB | 14 artifact + 14 types，不可直接删除 |
| Profile orphan | 456 files | 约 4.369 GB | 未引用、可重建，仍需在锁/活跃状态下复核 |

逻辑大小不必然等于文件系统实际占用；Phase 0 要同时记录 logical bytes 与 allocated bytes。上述数据只代表本机采样时刻。

## 4. 假设与验证

### H1：Vitest 自身 cache 是主要来源

预测：最大文件应集中在 Vitest/Vite cache，删除测试 fixture 不会显著改变空间。

结果：不成立。最大集合是 `%TEMP%/nbook-workspace-assets-*`，每个目录包含复制的系统 `.nbook`；其体积与 `.compiled` 膨胀一致。Vitest 只是触发 fixture，并不是主要字节来源。

### H2：只有测试 cleanup 漏掉了 `rm()`

预测：源系统 `.nbook` 保持小，修复 `afterEach` 后问题完全消失。

结果：只解释“为什么残留”，不能解释“为什么单个残留这么大”。源 `.compiled` 已达 4.752 GB，且一次完整 Profile build 仍可增加约 381 MiB；即使 cleanup 正常，测试过程峰值也会被测试数放大。

### H3：Profile 内容差异很大，所以 artifact 大属于正常成本

预测：不同内置 Profile bundle 的大部分字节应不同，metafile 主要由 Profile 自身逻辑构成。

结果：不成立。任意两个内置 Profile artifact 约 99.898% 内容相同；metafile 可含约 3,942 inputs，主要是 Harness、Provider、Prisma WASM、jsdom、Google SDK 等宿主实现。

### H4：Runtime import cache 会自行复用并回收

预测：不同 key 超过一定数量后文件数会稳定，或旧 key 会被替换。

结果：不成立。同 key 5 次只有 1 个文件；再写 10 个不同 key 后稳定得到 11 个文件。当前 Interface 和 Implementation 都没有 TTL、容量、条目数或可达性回收。

### H5：Profile GC 已经足够，只是还没等到 7 天

预测：7 天内产生的 orphan 不会超过可接受容量，时间到后可自然收敛。

结果：不成立。全量编译约 381 MiB/次，频繁测试与编译能在一天内产生数 GB；TTL 只能限制年龄，不能限制容量。7 天窗口在当前写入速率下没有安全上界。

## 5. 最小实验

### Runtime import cache

- 同 key 导入 5 次：1 个 cache 文件。
- 新增 10 个不同 key：总计 11 个 cache 文件。
- 结论：单 key 幂等有效，但 key 空间无界。

### Profile 编译放大

- 源码：455 bytes。
- artifact：6,971,024 bytes。
- 放大：约 15,321 倍。
- 同一路径重复编译：SHA 稳定。
- 相同源码放到不同临时 root：SHA 改变。
- 已观察差异：esbuild 输出中的源码路径注释。

这说明测试用随机 temp root 编译相同源码时，内容寻址不会天然去重；路径进入输出也是 Phase 3 应处理的确定性问题。

### Profile 依赖图

- 当前内置 Profile artifact：约 27.2 MiB/个。
- 一次 14 Profile 全量发布：约 381 MiB 新 artifact。
- `defineAgentProfile` 最小导入：约 6.58 MiB / 2,478 inputs。
- `profile-dsl` 最小导入：约 6.52 MiB / 2,470 inputs。
- `profile-tools`：约 11 KiB，不是主因。

从源码定点读取可见 `define-agent-profile.ts` 对 `profile-dsl`、low-code form 和 runtime settings 存在 value import；`types.ts` 对 Harness 等主要是 type import。Phase 0 必须继续通过 metafile 的 import chain 找到实际 value edge，不能仅凭文件名移动代码。

## 6. 失败路径分析

当前 `createIsolatedWorkspaceAssets()` 的顺序是：

1. `mkdtemp()` 创建 root。
2. 完整复制 system `.nbook`。
3. 可选再复制为 user assets。
4. 可选建立 junction/symlink、切换 cwd。
5. 修改全局测试 context。
6. 返回带 `dispose()` 的对象。

存在三个所有权缺口：

- 第 2-5 步任一步抛错时，函数尚未返回，调用方拿不到 `dispose()`。
- `dispose()` 顺序执行恢复 context、unlink、`rm(root)`；前一步抛错会跳过最终删除。
- 进程强杀不会运行 `finally`，下一进程没有 marker/lease 判断残留是否属于死亡测试。

因此“调用方记得 finally”不是完整 Interface。fixture Module 自己必须保证初始化回滚和跨运行 orphan recovery。

## 7. 放大链

```text
Profile SDK 带入宿主实现
        ↓
单 Profile artifact 约 27.2 MiB
        ↓
14 Profile 全量编译约新增 381 MiB
        ↓
GC 只有 7 天 grace，没有硬容量
        ↓
system .compiled 增长到 4.75 GiB
        ↓
Test Workspace Fixture 每测试复制完整 system .nbook
        ↓
workspace-files.test.ts 等大量用例重复放大
        ↓
初始化失败 / cleanup 短路 / 进程强杀
        ↓
%TEMP% 累积 295 个目录、约 120 GB
```

任一单点修复都不完整：只减 bundle 仍会有无界 cache；只加 cache GC 仍会复制 current artifact；只修 fixture cleanup 仍会产生很高峰值。

## 8. 推荐的三个深层 Module

### Published Profile Artifact Module

Interface 继续是 Task 79 的 staging release + Publisher + current manifest。生命周期 Implementation 增加：

- manifest refs 计算；
- current 永久保护；
- orphan grace；
- orphan hard byte budget；
- publish lock 内 GC；
- 可观察统计。

删除这个 Module，发布/回收竞态、可达性判断和容量统计会重新散落到 compiler、sync、boot 与测试中，因此它具有真正的深度和 locality。

### Runtime Import Cache Module

Interface 负责“按内容 key 准备并 native import，受 retention policy 约束”。调用方不再学习文件命名、复制、校验和回收顺序。World Engine 与 Variable 是两个真实 Adapter，因此该 seam 有实际变化点，不是假想抽象。

### Test Workspace Fixture Module

Interface 负责“创建隔离测试环境并保证最终收口”。共享 snapshot 与 isolated projection 是两个 Adapter；调用方不再知道 cp 过滤、context 恢复、marker/lease 和 stale recovery 的实现细节。

## 9. Profile artifact 减重取舍

### 推荐：artifact-safe Profile SDK/DSL

这是根因级修复。Profile artifact 应描述 Profile，而不是携带整个 NeuroBook 宿主。宿主能力通过运行时 context、tool binding 或稳定数据结构提供，Profile SDK 的 value import 图必须保持纯净。

### 暂不采用：共享 chunks

共享 chunk 会把一个 artifact 的原子性升级成 release graph 原子性，还需要 chunk refs、GC 与 Product 打包规则。当前 99.898% 重复主要是不该进入 artifact 的宿主实现；先共享它们会把错误依赖固化成新协议。

### 暂不采用：全面 external

Product artifact 从 State Root 导入时无法依靠源码根 `node_modules`；`.output/server/node_modules` 也不在普通 ESM 裸包解析祖先路径上。除非建立独立的 Product Profile Runtime SDK 包与 resolver 合同，否则全面 external 会破坏部署。

## 10. 推荐实施顺序

1. 先修 Test Workspace Fixture，立即消除乘法放大和残留所有权缺口。
2. 再补 Published Profile Artifact / Runtime Import Cache 的硬预算，保证磁盘上界。
3. 最后拆 Profile SDK 宿主依赖图，降低正常 current release 的基线。

顺序不等于重要性：Phase 1 最快降低开发风险；Phase 2 建立长期上界；Phase 3 解决正常成本过高。三者都属于完成条件。

## 11. 本轮验证边界

- 已做：目录与文件计数、manifest 可达性统计、最小 Profile 编译、metafile 统计、runtime cache key 实验、源码定点读取。
- 未做：实现后的回归测试、跨环境 Product smoke、浏览器验证。
- 未删除：295 个 Temp fixture 和 456 个 Profile orphan；需要在执行时重新确认 owner/manifest 后单独清理。
- 独立 Explore 子任务调度在本轮参数校验阶段失败，未启动 Agent；最终结论来自主线程的只读检查。后续 Phase 0 可再做一次独立 import-chain review。

## 12. 结论

根因不是单一缓存，也不是 Vitest 的内部行为，而是缺少统一的资源所有权合同：写入者知道如何创建 artifact，却没有人必须证明它仍可达、限制它最多占多少、并在异常后回收它。推荐方案通过三个领域 owner 分别补齐生命周期，再用共享的预算/统计类型建立一致规则；既系统性，也避免大一统框架的过度设计。
