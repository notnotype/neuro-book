# WorkbenchViewHostFixture

**Lab-only 探针，不接产品。** 目的：在写 Issue #192（类 VS Code 的 Workbench 与 View Host）的 Proposal 之前，
先把最有风险的几处设计放到能操作、能观察的地方试一遍。它是可丢弃的，代码不追求并入产品。

## 它证明了什么

- **descriptor 能驱动布局**：`id / titleKey / icon / container / layout / when / factoryKey` 七个字段足够让宿主
  渲染两个容器、排序、显隐、跨容器移动——不需要把 Vue 组件塞进 descriptor。
- **跨容器移动可行**：View 在容器间的归属与容器内顺序都由宿主的布局快照持有，移动后顺序压实、尺寸仍走 clamp。
- **布局快照可恢复**：模块级快照模拟「重挂后恢复」，带版本号；引用不存在的 View 或尺寸越界时**回默认并说明原因**，
  而不是静默加载出半个布局。
- **失败只坏一个 View**：空 registry、重复 id、context 不满足、factory 解析失败四种情况都能在界面上观察到，
  且其他 View 继续工作。
- **迟到结果可丢弃**：切换目标后再收到旧请求的结果，会被标记为「已丢弃」而不是写进当前 View。

## 它没有证明什么（刻意不覆盖）

- **View 内容是占位组件**：这里只验证布局合同（`scroll` 由外壳给内边距并拥有滚动，`fill` 自己占满），
  不验证任何真实 View 的功能、数据流或 authority。
- **factory 只有第一方映射**：`factoryKey → resolver` 这一层间接是为将来预留的缝，
  但本期**没有**实现第三方路径、动态 import、模块路径解析、安装账本或权限模型。
- **持久化是模块级内存快照**：不写 localStorage、不写配置文件、不跨标签页，也不覆盖真正的迁移/清理。
- **不含 Editor Group/Split、Dialog、Command 路由**：Issue #192 明确要求这几件事保持分开。
- **`when` 用的是结构化谓词而非表达式**：这里只演示「宿主可解释、可给出不可用原因」，
  没有实现任意表达式求值，也没有把它当权限系统用。

## 怎么操作

顶部按钮切换宿主 context（项目/选中项）与布局快照（保存/恢复/注入损坏）；每个 View 的行内有
上移/下移/移到另一个容器/隐藏；容器头部有尺寸增减。场景由 Lab 的场景选择器切换（见 `fixtures/index.ts` 的
`WorkbenchViewHost` 条目）：正常 / 空 registry / 重复 id / context 不可用 / factory 抛错 / 异步迟到 / 损坏布局。
