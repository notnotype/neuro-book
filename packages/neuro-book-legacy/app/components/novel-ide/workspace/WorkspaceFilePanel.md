---
标签: [state:local, state:shared-read, state:shared-write, io:read, io:mutate, persist:local]
---

# WorkspaceFilePanel

`nbook.files` 工作台 View 的产品适配器（`factoryKey: nbook.view.files`）。与 [FilesExplorerView](FilesExplorerView.md) 的受控显示面不同：本组件读取现有 `useNovelIdeStore` 唯一文件/正文状态，绑定 `workbench.files` 的 `expanded-paths` 与 `view-mode` 两条 user/local 记录，并将打开、刷新、新建和菜单动作交给 store。无 props/slots/expose；`actions-change` 与 `action-handle-ready` 继续经 View Host 传给标题动作。卸载只交还标题句柄，不关闭共享 Project。

文件树与模式记录首读未分类时不挂树，也不把默认展开或模式提交覆盖持久偏好。展开记录仍按旧裸键迁入；模式缺失时显示普通模式。记录冲突或失败有可见诊断及重试/放弃。树读取错误单独呈现，不当成空目录；树、选中和正文的实际数据 owner 仍是 store。打开前由 store 结算当前组输入；返回 null、请求失败给予通知，不以旧正文冒充新文档。

菜单包含基础文件动作：新建文件/目录、内容模式下的空白 `index.md`、打开、展开、重命名、删除、拖动移动和复制/剪切/粘贴。多选删除冻结选中项并父子去重，一次确认展示受影响资源与不可撤销风险；dirty/待裁决输入默认取消。逐项删除展示结果，明确失败继续独立项，绑定/授权失败或结果未知停止后续，不自动重试。

窗口内剪贴板捕获来源路径、服务端 stat 身份与工作区 generation；切换工作区清空，未知结果期间旧意图锁定。未知项显示源/目标，可按「核对源和目标」只读查询两端当前存在性；存在不代表复制/移动完成，仍需自行检查实际内容。核对后明确「放弃旧意图」才可重新选择，未知不自动升级成功或重试。复制 dirty 文件由用户选择先保存、复制已保存磁盘版本或取消。粘贴和拖动多选按最外层来源逐项执行，同名（包含同目录复制）询问改名、跳过或取消后续；明确改名只接受单个 basename。每项提交前和服务端提交时核对源身份，替换后拒绝，已开始写入等待真实结果，项间可取消。剪切只移除成功项，复制可重复。

新建对话、菜单重命名、拖动与粘贴均在异步回调前捕获 Project 代次，换代不改投新 Project。Store 在变更前结算输入并等待在途保存，捕获原 FilesClient；成功移动迁移打开文档、缓冲和 dirty 状态，后续保存指向真实新路径。

隐藏通道：Store 读写可导致产品 `/api/workspace-files/*` 网络访问；两条记录会话通过 Storage 客户端读写；本组件不直接 fetch、不操作裸 `localStorage` 或系统剪贴板。受控视图本身没有这些通道，因此 Lab 场景应挂载 `FilesExplorerView` 并显式供给局部状态/操作，而不能挂本产品适配器。

验证入口：`WorkspaceFilePanel.test.ts`（产品动作和记录门禁）、`files-view-session.test.ts`（记录生命周期）、`workspace-file-tree.test.ts`（模式投影）；实际 Project/模式与文件正文需隔离主页面验收。此合同不包含第二版快速打开或删除恢复。