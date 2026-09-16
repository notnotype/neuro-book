# t31 实现中独立核对

2026-09-16；源码尚在修改，以下供最终补核对。

1. 首次读源码时一级 Project 祖先未受保护；随后 Tasker 已补检查，09:36 受控 Temp 探针返回 `WorkspaceStorageBoundaryError`。
   最终仍应覆盖普通入口的真实文件不变证据。
2. `assertWorkspaceStorageBoundary` 对相对路径 `.` 提前 return；09:36 受控 Temp 探针 user-assets 根 mutation 返回 `allowed`。
   下层 delete 的 `assertRealParentContained(root, root)` 会拒绝根的外部父级，因此该 probe 只证明本 helper 放行，
   尚不能声称实际根可删除；应以真实入口验证结果决定是否需额外拒绝。
3. `relativeRealPathInside` 失败被全部 catch 后 return。核心 rename/delete 只核验真实父目录，不能保证稍后再拒绝原目标解析错误；
   当前注释称核心始终兜底并不成立。保护检查应显式失败，只有具体无副作用的缺失情况可沿既有语义处理。
4. plain tree 的 ignore 必须覆盖扫描/搜索与事件实际入口；请保留真实 fixture 证据，不只测字符串谓词。
5. Windows 上 Project path policy 的 `.nbook/storage` 判定仍区分大小写，和实际磁盘身份不一致。
   实际目录为 `.NBOOK/Storage` 时应保持 Storage 分类；归档根 `.nbook` 的穿透比较由 t32 同步修正。

主 Agent 的受控 Temp 只读 guard 探针（未执行任何文件 mutation）记录在后续统一报告。
