# @notnotype/nb-canon

作者视角的世界引擎内核（w00039）：在任意一章的开头或末尾算出每个设定当时的样子，每一处变化都有描述和出处。

- 行为合同：[`docs/specs/canon/`](../../docs/specs/canon/)（components、model、revisions、rendering、project 五份）。
- 取舍：[ADR 0037](../../docs/adr/0037-world-engine-story-change-log.md)（剧情变更日志与修订）、[ADR 0038](../../docs/adr/0038-world-engine-entry-text-is-whitelisted-mdx.md)（白名单 MDX）、[ADR 0039](../../docs/adr/0039-world-engine-segmented-revision-log.md)（分段的只追加日志）。
- 验证：在本目录 `bun test` 与 `bun run typecheck`。

## 入口

| 入口 | 给谁 | 有什么 |
|---|---|---|
| `.` | 前后端都能用 | 全部模型与计算：schema、引擎、世界（发布、还原）、渲染与回写 |
| `./schema` | 浏览器里只做合同与校验的代码 | schema 与类型、Component 声明的登记校验、`valueAt`；只依赖 TypeBox |
| `./node` | 项目进程（Bun） | 分段日志的存储、归纳缓存文件、世界服务 `WorldService`（宿主注入文件、锁、时钟、定时、摘要、小模型） |

## 模块

| 目录 | 管什么 |
|---|---|
| `core/` | 对象与修订的 schema、id 与临时 id、地址与修订路径、位置与先后、精确档的数、中文数字、稳定序列化、从读取结果取地址的值 |
| `components/` | 插件声明的登记：Component 类型（撞名、版本）与字段值的校验，标注种类（`marks.ts`，载荷 schema 的白名单、引用路径），诊断（`diagnostics-registry.ts`）；后两者共用前缀与重复的两步判定（`declarations.ts`） |
| `model/` | 一条剧情变更套到条目上的规则（补丁、整条套上、不完整、语义档的起点）；两个引擎共用 |
| `engine/` | 读取：`reference.ts` 整本重算（只作对照），`incremental.ts` 按条目时间线增量计算（产品用），`views.ts` 把折叠结果做成读取结果 |
| `world/` | 世界：重放、发布（校验、带来的变化、冲突）、还原与依赖、就地改与记一笔；引用与临时 id 的替换（`references.ts`）；讲述的定位、失联与先后（`tellings.ts`） |
| `render/` | 白名单 MDX 的解析、给作者与给 Agent 的渲染、回写 |
| `node/` | 只在 Bun 里：日志分段、写一半与坏行、尾部核对、归纳缓存文件 |
| `service/` | 世界服务：单写者队列、独占租约、事件、补归纳、游标；经 `./node` 导出 |

## 扩展时改哪里

- **加一种补丁**：`core/schema.ts` 的 `PatchOpSchema`；`model/apply.ts` 的套用；就地改的路由（`world/edits.ts`）、发布时的依据核验与带来的变化（`world/world.ts`）、嫌疑区间里“最后一次赋值”的判定（两个引擎各一处）按需改；`tests/differential.test.ts` 的生成器加上它。改完跑差分测试。
- **加一个世界服务的方法并交给浏览器**：`service/service.ts` 加方法；应用的 `plugins/canon/shared/contracts.ts` 加合同方法与 `CanonOutputs` 的结果类型；`backend/remote.ts` 加实现（结果按预算判、列表走分页）；Spec project 的方法表。
- **改一条引擎规则**：先改 `model/` 里共用的部分；只涉及先后与缓存的，两个引擎各改一处，跑差分测试（`CANON_DIFF_SEEDS`、`CANON_DIFF_STEPS` 可以加大）。

已知的整理项（同一规则写了几份、失败的返回形状不一）记在 w00039 t29 的 Task 记录 `evidences/api-review-resolution.txt`（主工作区）。
