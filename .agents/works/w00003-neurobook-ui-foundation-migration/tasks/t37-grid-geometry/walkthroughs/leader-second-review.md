# 第二轮复核与收口要求

前轮 omp 已退出（exit 1），implementation 仍是进行中。保留当前改动，在同一 Task 收口，不重置其它文件。
随后一次sol会话同样在20分钟限制到时退出，仅重复阅读与基线测试，没有改源码。当前恢复优先形成可验证增量：
先修结构操作原子性/特殊id/约束诊断与测试，再继续呈现API与消费者。不要重复完整diff和整目录源码阅读。
所有bash cwd使用当前worktree绝对路径。会话已改为可续跑；不要因未完工空返回，报告确切阶段与剩余项。

## 从当前源码确认的问题

1. `moveLeaf` 先从源分支删除并塌陷，再查询 destination；同一两叶分支内重排会使目标消失，返回失败却已丢叶。用回归测试证明并修复原子性。`removeLeaf` 先判断 root 再判断 leaf，会把根分支当叶删除；核对旧支持边界，不能意外放宽。
2. `constraintsOf` 用 `high = max(low,...)` 静默抬高不相容上限；分支显式 max 与后代 min 冲突时无诊断。单叶根绕过全部约束检查。需统一可诊断降级，保持有限非负与容器不溢出。
3. `layoutOf` 在容器比 sash 总量小的时候内部压缩 gap，但输出没有实际 sash 信息。renderer 若仍按1px画，总量不守恒。公开呈现结果应足以画出同一几何，不只满足数值测试。
4. `WorkbenchBranch` 仍按意图比例和原始节点约束配置 Splitter，没有消费 `grid.layout(container)`；程序布局仍可能逐面板触发 resize。当前任务先完整落几何API与消费，下一增量接手势；不能宣称实际呈现已使用原语。请让消费者确实读取原语计算的呈现/约束，而不是再复制分配逻辑。
5. `resize` 以意图数字为单位，renderer 从显示像素传 delta，容器与意图总量比例变化后可能不一致。明确这两者的合同，以缩小容器后拖动再恢复的测试证明；可以提供原子分支提交或显式呈现基线入口，但不得在 viewport layout 中回写意图。
6. WorkbenchShell 的 root/titlebar 与 activity sash 被 CSS display:none，几何却按统一1px计账。核对实际占用，给原语提供真实 sash 策略；不要继续用编辑器兜1px的补丁。
7. `shareAxis` 在同轮逐个夹取时变动 remaining/openWeight，需检查 mixed min/max、互换子顺序、过小/过大总量是否仍可用且守恒。外部输入解析和已有结构操作回归不能丢。
8. `sizes` 用普通 `{}` 并允许任意字符串id，`__proto__` 写入成为原型而非节点输出。使用安全字典或Map并覆盖合法特殊id，不能把JSON输出为空当有效布局。

## 主Agent实测（第二轮修复前）

`bun run test src/components/layout/grid.test.ts`：exit0，1文件32用例；主应用layout与临时spike测试exit0，2文件21用例。
这些既有用例没捕获以下独立内存探针：

- root包含a/b各100，`moveLeaf('a','root',1)` → `{ok:false, reason:'目标父节点已不存在：root'}`，树变成只剩b且宽200。
- 单叶 minWidth200/maxWidth300，`layout({width:50,height:100})` → 宽50但issues=[]。
- root显式maxWidth150，下含两个minWidth100的叶，容器宽500 → root宽500、两叶各250、issues=[]。
- id=`__proto__` 的叶 → `Object.hasOwn(sizes,'__proto__')`为false，序列化sizes为空对象。

探针通过 `bun -e` 导入真实grid执行，没有修改被测源码或生成scratch文件。需把缺陷变成稳定回归用例。

## 文件与并行边界

- Splitter / splitter-gesture / barrel / playground SplitterFixture / e2e splitter 由 t38 独占；不要改它们。如新 grid 类型需 barrel 重导出，在报告列出由Leader机械集成。
- 可改 Task 已列主应用消费者和相关测试。临时 `t37-spike-smoke.test.ts` 应成为有稳定名称的消费者回归测试，或将覆盖合入既有测试，不留临时命名产物。
- nb-ui vitest.config 已接统一Temp，保持它。不要运行全包typecheck/build，待并行结束由Leader统一跑。
- 只用read/grep/glob/edit/write/bash工具。单点改动用edit，批量先dry run；不使用未经预览的sed替换。
- 不联网，不占用/探访3001；本Task先纯测试，无产品宿主。若要浏览器验收，先在报告说明隔离策略再执行已授权的独立宿主。

## 收口

先建立上述关键失败用例，再修模型与直接消费者，聚焦测试通过后完成implementation报告：明确真实命令/退出码、测试数量、尚未做的手势和Storage接线。旧版v1拒绝保留原件，新版v2保存结构与尺寸意图；合同保持planned。
不把本Task扩成新布局编辑产品，不创建代理，不提交。最终回复必须是完成内容或具体未完成项，不能空字符串或句点。
