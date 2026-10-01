# t32 第 1 轮审查意见

整体方向正确：代次作用域加内层 `entry-work`、用受管操作等待已交付服务关闭、发布资源依赖激活产出、`plugin-closeout` 依赖必需借用，满足目标 E；14 个场景的测试写得扎实。下面 7 项需要返工，改完后重跑完成标准 1、2、4（`smoke:runtime-foundation` 的 browser 模式 404 由主 Agent 处理，你不要改 `scripts/smoke/runtime-foundation.ts`）。

## 1. 启动期间宿主停止被改报为 failed（必改）

`bootstrap.ts` 中 `if (this.root.phase !== "creating" && !failures.some(...activation && required))` 让“必需入口启动激活期间宿主要求停止”结算为 `failed`，测试“必需启动激活中宿主停止时结果为 failed”把它固定了下来。现有合同是：宿主在启动完成前要求停止，结果为 `stopped`（`runtime.application` Spec 与原代码的 `stopped` 分支）。被停止导致的 `cancelled`/`stopped` 激活结果是停止的后果，不是激活失败，不应记为 activation 失败，也不应改变结果分类。这是禁止清单第 2 条“把一种失败改报成另一种”。

要求：
- 登记完成后若根作用域已不在 `creating`，不发起启动激活（与门禁在停止后跳过一致）；
- 启动激活期间宿主停止：结果为 `stopped`，不把因停止而得到的 `cancelled`/`stopped` 记为 activation 失败；迟到产出照常收口；
- 恢复原来的 `if (this.root.phase !== "creating")` 判断，不加例外；
- 改写该测试为期望 `stopped`，并保留“迟到资源释放、未选中入口不激活、接纳被拒绝”的断言（拒绝原因按现有规则为 `stopping` 或 `closed`）。

## 2. 必需插件登记被拒绝时重复报告（必改）

同一个登记拒绝现在产生一条 `manifest` 失败、每个入口一条 `activation` 失败，没有入口时再加一条。只保留 `manifest` 那一条（`required` 已经因 `requiredPlugins` 为 true）；被拒绝插件的入口不进入启动激活，也不再生成 activation 失败。非必需 `onStartup` 插件登记被拒绝同理，只有 `required: false` 的 `manifest` 失败。清单中不存在的必需插件属于清单错误：`category: "manifest"`、`stage: "register"`、`source` 为插件 id。同步修改相关测试与 `StartupFailure.reason` 的注释。

## 3. 同一服务 id 被提供多次未拒绝（必改）

`plugin-manifest` Spec 的“失败与恢复”把 `provides` 中服务 id 重复列为清单无效（整个插件不登记）。同一插件内同一个键出现在一个入口的 `provides` 中两次，或出现在两个入口中，都拒绝，原因 `duplicate-service`。加测试。

## 4. 目录排序依赖语言环境（必改）

`catalog()` 用 `localeCompare` 排序，结果随运行环境的 locale 变化，不满足“同一输入得到同一结果”。改为按码元比较（`a.id < b.id ? -1 : a.id > b.id ? 1 : 0`）。

## 5. `#releaseOutput` 的两条路径与漏释放（必改）

- 现在只在 `attempt.provided.size === 0` 时从 `output` 补建记录：产出校验中途失败（例如 `undeclared-service`）时 `attempt.provided` 只含失败点之前的服务，失败点及之后的服务实例永远不会被释放。
- 改成单一路径：按 `output.services` 逆序释放每个实际产出的实例；在 `attempt.provided` 中有同键同实例的记录时遵守其 `adopted`/`released`，没有记录的直接释放。删掉 `size === 0` 的特例。
- 加测试：`undeclared-service` 失败后，产出中的每个服务实例恰好释放一次；迟到产出的实例同样恰好释放一次。

## 6. 停止开始后仍可交付服务实例（必改）

关闭屏障在停止开始时对 `attempt.services` 取快照；`#provide` 只拒绝已 `closed` 的代次，停止开始后才完成的交付不会被屏障等待，提供方自己的资源可能先于这个服务实例释放。代次作用域不是 `available` 时拒绝交付（抛 `PluginStateError`），并加测试。

## 7. 注释（必改）

- `blocked.ts` 的注释是英文，`runtime/` 其它文件都用中文：改为中文，并补一个文件头注释，说明本模块的职责与输入快照的边界（只含存活登记、不产生诊断）。
- `blocked.ts` 用对象身份匹配插件提供的键、用名称匹配本地能力的键：在边界处用一句注释说明原因（`AssemblyReport` 只给出键名）。
- `host.ts` 中 `#releaseOutput` 的英文注释随第 5 项改写为中文。
- `runtime/application/contracts.ts` 中 `ApplicationManifest` 的注释删掉了原有的组成说明。恢复为同时说明组成与顺序，例如：“静态受信清单：键登记表、接收者、本地能力、插件定义、启动必需插件与门禁。登记后并发激活启动入口，再按定义顺序执行门禁；插件登记顺序没有语义。”

## 汇报

逐项说明改法与对应测试名；重跑完成标准 1、2、4 并覆盖保存 `evidences/` 中对应文件；禁止清单逐条自查。
