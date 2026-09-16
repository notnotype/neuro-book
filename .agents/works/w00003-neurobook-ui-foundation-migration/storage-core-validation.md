# Storage与grid核心收口验证

本轮按开发者最新要求完成核心，后续集成交接。服务/适配器既有提交链见Work README，新增Storage上下文为7a5d04de；本记录不晋升planned Spec，也不声明六切片全部完成。

## 可观察结果

- 工作台按user/Project管理访问生命周期，Project切换同步封锁旧引用，已接纳动作与迟到资源收口；一侧释放失败仍清理另一侧。插件内存选择只在当前Project代次共享，偏好样例保留未知字段。
- grid两轴意图与呈现分离，混合上下界与实际sash守恒；完整分支手势原子反解，失败不改树。对象ref使用稳定编码器；快照v2拒绝不兼容旧版，未知引用原件合成仍由后续宿主负责。
- Branch/Shell/Spike消费原语的实际尺寸、降级约束和sash；右侧栏提交不回弹，被动补偿不写成主动偏好，达到max后保留留白。
- Splitter提供开始/更新/结束/取消边界，鼠标与键盘每次只提交一次；禁用/零宽、等值重渲染、Enter与取消行为经真实Reka及浏览器验证。

## Leader独立验证

所有命令在本worktree对应包的绝对cwd运行。原始输出与截图位于系统Temp的neuro-book/acceptance/storage-core-final-20260916，不使用用户3001服务。

| 检查 | 结果 |
|---|---|
| 主应用Storage上下文+适配器聚焦 | 6文件94用例，exit0 |
| 主应用workbench/Spike/Storage聚焦 | 最终11文件142用例，exit0；含新增留白与类型修复后的全部相关用例 |
| 主应用 `bun run typecheck` | 探针归档后正式重跑exit0 |
| nb-ui `bun run test` | 18文件350用例，exit0 |
| nb-ui `bun run typecheck` | exit0；Vue ref方法守卫修复后正式重跑通过 |
| nb-ui Splitter最终聚焦 | 2文件32用例，exit0 |
| 两次 `bun run build:css` | 字节一致；SHA256 8C805962377DED5D0EC8AE35525398E049E9F777934D6F273CF0D89209E2CED9 |
| nb-ui `bun run test:e2e` | 最终48/48，exit0，独立端口3149，浏览器profile和输出在系统Temp；含桌面/390px及nbook/macos浅深色 |
| grid数值探针 | 10000确定性可满足布局+3000合法分支手势全部通过，代码和证据见t41 |

首次E2E为47/48，唯一差异是Lab画布修复后switch-field从右侧裁切变为正确收窄居中。Leader直接检查expected/actual/diff后更新一张基线，连续生成字节一致，SHA256 EE93AF0CF9A57BE50FA44E7152741C4D172665BD307E613C8228D293AFE02546。没有降低截图断言阈值。
主应用正式typecheck首轮只命中两组新增测试类型错误，修复后第二轮仅命中Reviewer临时探针；探针归档后的最终正式检查exit0。Storage测试的vi.fn改为明确Promise<never>拒绝委派，测试意图和产品代码未变。

## 审查与限制

- t42最终独立审查建议合并，另有9探针；t39最终独立审查建议合并，另有11探针。Leader的后续改动只补消费文档与Splitters ref类型守卫，并重跑受影响测试/正式typecheck。
- t41最终复核结论在该Task walkthroughs/review-final.md，数值探针及消费者证据固定到所审文件hash。
- t41最终建议合并，原五项和消费者留白均闭合。非阻断O1：公开API隐藏editor时模型保持侧栏偏好、原语却将空余量分给侧栏；当前主页仅切换titlebar/left/right，不触发此路径。后续扩展隐藏editor或复用该Shell API前修正并测试，不作为已支持产品行为宣传。旧单节点resize对越界意图归一的边界已补充grid API文档。
- 没有完整NeuroBook主页面、标题栏、插件grid持久化宿主或Windows整Project根替换的端到端证据。t43最小HTTP脚本仍是未提交稿，缺口见其leader-handoff-status.md。
- scripts:typecheck旧基线错误与Project Windows alias锁超时见交接；未修改无关文件来隐藏这些问题。
- 用户两个descriptors文件hash不变，未纳入提交。3001未访问、复用、重启或关闭，无真实用户数据或远端操作。

## 后续执行入口

用户要求的系统Temp HANDOFF.md引用本Work的storage-implementation-plan.md和storage-consumer-source-map.md。下一受限增量是插件grid宿主的原件合成、订阅/手势投影与冲突处理，然后按计划迁移旧键、接主页面/标题栏并盘点未迁视图。命令系统仍需另行讨论。
