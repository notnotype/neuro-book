# 审查意见 1

整体设计与实现正确：引导接口、挂载前建立窗口运行实例、失败页、命令表归 `nbook.workbench`、页面端口接入与释放、L9 只换拦截目标与失败页定位且三个子断言判据不变，都符合任务说明。先用 `git status` 与 `git diff` 核对现状，再处理下面三项。

关于你汇报的两条遗留问题，主 Agent 已核实，都不是本任务引入的，不用处理：
- `WorkbenchPartHost / 容器移动菜单` 失败属于分支已知的全量测试基线失败（基线 10 个文件之一）。
- L10 收尾时 `Product completion` 退出码 1（`Product Runtime command 被信号中断：SIGTERM`）在 t35、t37、t38 的 `L1.log` 中同样出现，来自 smoke 以进程组 SIGTERM 收尾；`STORAGE_CONTEXT_INVALID` 403 在 t38 的 `L10.log` 中同样存在。两者留到阶段 1 集成复核。

## 必须修改

1. **恢复贡献点的逐条校验。** 迁移前 `nbook.workbench` 的两个贡献点带 `validate`，与产品目录不一致的声明在校验阶段被拒绝（`rejected`，带原因）。现在 `validate` 被删掉了，格式错误或重复的声明要到 `commit` 时才抛错，变成交付失败。给两个贡献点恢复 `validate`：View 声明至少要能通过现有 workbench 描述符校验且不与已登记的重复，命令声明同理；或者照旧只接受产品目录中的 Files 条目。选哪种由你定并说明。补一个用例：不合格的声明被拒绝并带原因，不进入交付。

2. **共享清单与插件定义不能各写一份而不核对。** `shared/browser-bootstrap.ts` 的 `BUILTIN_BROWSER_PLUGINS` 手写了两个插件的 `provides`、`receives`、`contributionPoints`、`contributions`，`app/features/*/browser-plugin.ts` 的插件定义里又写了一遍，以后改一边就会漂移。补一个合同测试：逐个比较内置浏览器插件定义的浏览器入口与共享清单中对应条目的这几个字段，不一致即失败。

3. **恢复一句仍然成立的注释。** `app/composables/useWorkbenchCommands.ts` 文件头删掉了“这里只建立通道与状态，命令由各域自己注册——核心不内置任何业务命令。”这句话在改动后仍然成立，恢复它；其余改写保留。另外，`app/middleware/auth.global.ts` 新增分支后多出一个空行，删掉。

## 验证

命令从 worktree 根目录执行：
- `bun run --cwd packages/neuro-book test -- app/runtime app/features app/plugins app/middleware app/composables server/api/runtime shared scripts/smoke/product-lifecycle`：全部通过；
- `typecheck:runtime-foundation`、`typecheck`：0 错误；
- 生产 L1–L10 与全量测试由主 Agent 跑，你不用跑。

输出保存为证据目录下的 `rework-1-*.txt`，在 `delivery.md` 末尾加“返工 1”一节，逐条说明处理结果，并把第 7 节的遗留问题 1、2 改为“已由主 Agent 核实为既有问题”。

一次只跑一个重任务；禁止清单仍然有效，汇报前逐条自查。
