---
schema: nbook.task/v2
taskId: t48-workbench-layout-authority
role: tasker
---

# 主工作台布局接线与旧 writer 退役

**状态：待实现（依赖 t47 落地后派发）。** [实施计划](../../storage-implementation-plan.md) 切片 4 的第二增量：把三个旧字段的全部读取与提交入口切到新 authority，并让旧 `novel.ide.local` writer 退出这三个字段。

Work：[w00003](../../README.md)。依赖：[t47 迁移门禁](../t47-legacy-state-migration/README.md)（接口以该 Task 的 `walkthroughs/implementation.md` 为准）、t40 工作台 Storage 上下文（`7a5d04de`）、t44 grid 持久化宿主（`5fcdf8b8` + `1f1942c3`）、t37/t38 几何与手势（`da4c5aca`）。
合同：[storage.persistence](../../../../../docs/specs/storage/persistence.md)「布局投影与保存反馈」、[迁移合同](../../../../../packages/neuro-book/docs/migrations/storage-state.md) 第 5–6 条、[ui.workbench-shell](../../../../../docs/specs/ui/workbench-shell.md)、[grid API](../../../../../packages/nb-ui/src/components/layout/grid.md)。
入口取证：[source map](../../storage-consumer-source-map.md)。

## 结果

主工作台、主页面与书架模式的尺寸/模式读写全部经工作台 Storage 上下文与会话宿主：进入工作面后按记录恢复，用户手势结束提交一次，
`novel.ide.local` 不再接收这三个字段的写入；Project A/B、未开项目/用户资产与书架各自使用明确记录。

## 范围

- 新增主工作台布局会话模块（`app/utils/workbench/` 内，名字自定）：把 shell grid、t44 宿主、t47 迁移门禁与 Vue 消费接通，
  暴露已确认值/当前显示/本地意图与失败/重试/放弃入口。
- 切换消费入口：`app/components/workbench/WorkbenchShell.vue`、`app/pages/index.vue`、`app/components/novel-ide/ProjectPickerScreen.vue`。
- `app/stores/novel-ide.ts`：把 `leftPanelWidth`、`agentPanelWidth`、`projectPickerLayoutMode` 从 `novel.ide.local` 的 `pick` 移除（迁移全部目标处理完成后），保留其余字段原归属。
- 目标定义：主工作台左右尺寸 project/local（grid 布局记录，复用 t44 的 `defineGridLayoutState`）；未开项目/用户资产的尺寸与书架模式 user/local。
- **服务端定义注册（前置缺口）**：`server/storage/host.ts:486 registerStorageStateDefinitions` 目前无生产调用方，须建立单一定义清单模块 + Nitro 插件完成注册，
  与 t47 建立的注册入口保持同一处（t47 先建，本 Task 追加 grid 布局等定义，不新建第二个插件）。

## 排除

- 不改 `packages/nb-ui/**`、`app/utils/storage/**` 生产适配器、`shared/storage/**` 合同、t44 宿主与 t47 迁移模块内部。
- 不接浏览器标题栏与桌面 bridge（切片 5）；不实现命令系统；不迁 World Engine 整页。
- 不建立 user→project 运行期继承；不新增 Storage scope；不做旧版双写。
- 不触碰两个用户 dirty `app/utils/workbench/descriptors{,.test}.ts`；不联网、不提交/push；不访问/占用 3001。

## 实现要求

1. **首读门禁**：进入工作面（Project ready 或显式 user 工作面）后恢复记录；初始读取完成前不开放持久化提交，但允许呈现产品默认；
   读取失败可临时调整并明确显示未保存；`missing` 不写默认值记录。
2. **单写者**：三个字段退出旧 writer；旧入口只读新 authority 的投影，所有写经会话宿主提交；
   `app/pages/index.vue` 旧的右侧 resize 回调与 `WorkbenchShell` 的 store 回写必须同批切换，删除第二条写路径。
3. **手势语义**：拖动/键盘结束提交一次，只提交主动字段（消费 `gesture-end.active`，不用整份 sizes 覆盖偏好）；
   程序布局、挂载、测量、视口夹取、临时显隐不产生保存；窄视口夹取不改变保存值（呈现夹取与意图分离）。
4. **失败与冲突**：二次冲突或保存失败保留当前显示与未保存意图，暴露重试/放弃入口（绑定原工作面），不静默吞掉；
   消费方必须读 `state.blocked`（不能只看 `projection.status`，见 t46 观察 7a）。
5. **切换收口**：正常切项目先结束手势、提交已形成的旧目标意图并等待收口，再释放旧上下文；失败可重试或明确放弃后离开；
   Project 删除/断线不得延迟使用旧上下文；迟到失败不显示在新项目的「未保存」状态上。
6. **user 工作面**：未开项目/用户资产尺寸与书架模式用显式 user/local 记录，与 Project 尺寸独立；书架模式保留加载/失败反馈。
7. **迁移收尾**：与 t47 的门禁衔接——迁移未就绪时遵守加载与未保存反馈，不启用旧值写入；全部目标处理完成后才移除 `pick` 条目。
8. **注册与可达性**：主工作台的布局记录定义必须经服务端注册在真实应用可达；未注册时不得声称端到端可用（当前生产无注册调用方，见计划切片 4 的 Leader 取证）。

## 验证与交付

- 聚焦单测/组件测试覆盖：首读门禁、单写者（旧入口不再写）、手势单次提交、程序布局不保存、窄视口夹取不改保存值、
  二次冲突与重试/放弃、切换收口与迟到失败归属、A/B 与 user 工作面隔离、书架模式记录。
- 真实浏览器验收（本 Task 必须做）：用**完整 Source Dev**（`scripts/cli/source-dev.ts`）而不是裸启 Nuxt；
  启动前显式设置 `NEURO_BOOK_STATE_ROOT`、`NEURO_BOOK_CACHE_ROOT` 为本次系统 Temp 独立根，并把 `NUXT_PORT` 与 `PORT` 都设为已核空闲端口（避免继承 3001）；
  核对实际解析的根、端口、数据库目标与子进程归属后再打开浏览器；停止只用本次宿主的句柄。
  覆盖：书架、项目 A/B 各自尺寸、未开项目/用户资产、同项目双标签并发改左右栏、刷新两次只有一个 writer。
- 迁移相关验收（中断/重试/已有值/墓碑/高版本/旧桶其它字段保留）由 t47 的用例 + 本 Task 的端到端场景共同覆盖，逐条说明由哪条覆盖。
- 按 `packages/neuro-book/package.json` 跑聚焦测试并记录命令/退出码/用例数；全包 typecheck 与真实浏览器门禁由 Leader 复跑。
- 先写 `walkthroughs/implementation.md` 进行中；完成后列真实命令、cwd、退出码、隔离根与端口、用例数、未运行项与偏差。
- 最终回复具体结果，不返回空文本或句点。

## 继续条件

Leader 复核后按切片 5 继续（浏览器标题栏与真实主页面）；`ui.workbench-shell` 与 `storage.persistence` 保持 planned，逐 capability 核对成熟度。