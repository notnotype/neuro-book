# 后续消费者接线入口

2026-09-16 Leader只读源码取证；供切片3收口后定位切片4/5，不代表已迁移或新增行为合同。

## 首批旧状态的实际入口

| 入口 | 当前职责 | 接线时需核对 |
|---|---|---|
| `packages/neuro-book/app/stores/novel-ide.ts` | 三字段默认值、对外ref、`novel.ide.local`持久化pick | 暂存门禁早于旧writer；迁移字段退出writer，未迁字段继续存 |
| `packages/neuro-book/app/components/workbench/WorkbenchShell.vue` | 从Pinia读左右尺寸；拖动写ref；外部ref变化重算 | 接新authority与主动手势，不能逐面板layout写盘 |
| `packages/neuro-book/app/pages/index.vue` | 旧右侧resize的onResize写agentPanelWidth；左栏style读leftPanelWidth | 与Shell同批切换，删除第二writer来源 |
| `packages/neuro-book/app/components/novel-ide/ProjectPickerScreen.vue` | 书架layout-mode读ref，update事件直接赋值 | 接user/local书架模式，保留加载/失败反馈 |
| `packages/neuro-book/app/utils/workbench/layout.ts` | 产品默认尺寸与几何分配入口 | 使用唯一产品常量；几何由t37改动，切片4前重读 |

`app/component-lab`中的同名leftPanelWidth是Lab私有偏好，不属于本次产品迁移。
`nuxt.config.ts`使用`pinia-plugin-persistedstate/nuxt`；当前app/plugins只有i18n与theme初始化。
新迁移暂存门禁应以实际Nuxt/Pinia插件启动顺序验证，不只按文件名字排序推断。

## 生命周期与标题栏

- `app/composables/useProjectSession.ts`已发布精确ready的`projectRoot/publicId/revision`。state在ready以外不提供ready；Storage不得用残留路径替代它。
- `app/pages/index.vue`创建ProjectSession，并通过`WorkbenchShell.setLeafVisible`将titlebar显隐绑定到bridge。
- 主页面titlebar槽使用`app/components/common/DesktopTitleBar.vue`；切片5需一起检查该组件自身bridge条件，不能只改页面。
- 新Project URL、本页切换和现有未保存领域内容守卫在实施前重新读对应事件路径，不能用Storage释放代替领域守卫。

## 验收宿主

- `scripts/smoke/storage-value-adapter.ts`已有真实Chrome的user链路：隔离root下`data`、`site`，动态导入Storage前设置`NEURO_BOOK_STATE_ROOT`，HTTP监听`127.0.0.1:0`。
- 该脚本当前只装user context/action；不能拿已有结果声称Project真实浏览器链路已验证。
- `http://localhost:3001/`是开发者已有后台服务，全部后续验收另建隔离宿主；不访问、不复用、不停它。

### 完整Source Dev验收的启动前检查

源码入口为 `packages/neuro-book/scripts/cli/source-dev.ts`，不是直接裸启Nuxt。
未显式设置State/Cache时，它会使用用户级 `LocalAppData/NeuroBook`；验收必须在调用前设置 `NEURO_BOOK_STATE_ROOT` 与 `NEURO_BOOK_CACHE_ROOT` 为本次系统Temp根。
Workspace Root由RuntimePaths固定为State Root下的workspace，不能假设另一个未登记的环境键生效。
Source Dev端口解析顺序是 `NUXT_PORT`、`PORT`、3000；启动时两者都显式设置为已核空闲的独立端口，避免继承用户环境中的3001。
完整Source Dev的Application Root继续指向当前worktree主应用源码，最小HTTP smoke可使用临时Application Root；二者不能混用。
启动后核实际解析的根、端口、数据库目标与子进程归属，再打开浏览器；停止只用本次宿主的关停/进程句柄。
