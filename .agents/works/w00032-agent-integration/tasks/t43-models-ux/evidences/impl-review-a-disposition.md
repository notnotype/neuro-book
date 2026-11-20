# 阶段 A 实现审查的处理（2026-11-20）

被审提交 e5b2ca9ba（分支 feat/w00032-t43-a）。后端 omp 默认模型 8 条（重要 6、建议 2，[报告](impl-review-a-backend-omp.txt)）；前端 Claude Sonnet 15 条（重要 4、建议 11，[报告](impl-review-a-frontend-sonnet.txt)）。全部按原文核实后归类。

## 后端

| 条 | 处理 |
|---|---|
| 1 Anthropic 自适应模型的“关闭” | 成立，已改：`offOf` 按协议分类，自适应与 `between_tools` 判 `lowest`；补 `/v1/messages` 实收测试 |
| 2 `omit` 与不发推理参数的路由 | 成立，已改：`omit` 判 `lowest`，`supportsReasoningParams` 为假判 `fixed`；补实收测试。补充证据里“二值 Qwen 的 low 与 high 同一请求体”接受取舍：开关有效，档位在线上相同，只是多出几个没有区别的选项，不为它另加机制 |
| 3 Anthropic 与 Gemini 的缺省 | 成立，已改：关闭是真关的 Anthropic 与 Gemini 模型 `unset` 为 `off`；Gemini 分级不抑制的模型 `off` 为 `lowest` |
| 4 就地压缩与对话二次解析 | 成立，已改：`modelCaller` 在请求边界上收一份已解析的模型与档位（`PinnedSessionModel`），就地压缩沿用；补变异过的测试 |
| 5 “跟随”推错角色 | 成立，已改：解析带 `role`，快照带 `role`、`defaultEffort`；宿主按它们交 `follow`，只要模型能调档就能回到“由模型决定” |
| 6 换 Profile 后有效档过期 | 成立，已改：`profileChanged` 也触发重读解析。界面里目前没有换 Profile 的入口（宿主只在内核直调时触发），所以没有宿主层测试，只有处理这一事件的一行 |
| 7 `lowest` 的关闭用了 `unset` | 成立，已改：只有 `none` 才用 `unset`；补用例 |
| 8 测试缺口 | 部分接受：补了请求体（Anthropic、Gemini、`omit`、不发参数）与角色解析的用例。版本 1 调用被拒是 nb-runtime 远程合同的通用行为，由它自己的测试负责，不在 nb-models 再写一份；预览、`complete`、审批的档位沿用原有测试，A1 证据里按实际覆盖改写 |

## 前端

| 条 | 处理 |
|---|---|
| F1 删除按钮在 521 到 640px 错位 | 成立，已改：两个容器查询里给 tail 写位置；`RolesPage.md` 补一句 |
| F2 放手计时器竞态 | 成立，已改并补假时钟测试（变异过） |
| F3 “用默认”被窗口内的写入盖掉 | 成立，已改：点“用默认”取消还没发的选择；换角色或模型前先发出待写的档 |
| F4 触发器没有省略号 | 成立，已改：省略写在名字与模型两段自己身上；e2e 量了 `text-overflow` 与被裁 |
| F5 卸载丢掉窗口内的选择 | 成立，已改：卸载前先发出；补测试（变异过） |
| F6 Lab 与 dom 缺窄屏、英文、两列场景 | 成立，已改：Lab 夹具加 `labWidth`、`labLocale`，新增 narrow、narrow-long-names、wide、english、english-narrow-seven 五个场景；dom 测试给 anchor 宽度补全名用例；e2e 量面板溢出 |
| F7 变异检查空过 | 成立，已补：RolesPage（选档写 effort、选跟随写 null、选图标写 icon、“关闭”与“未验证”说明）与选择器（回写释放、放手、`describedby`、卸载冲刷、reset 取消）；逐条变异确认会失败。Tab 走出面板就关、再次打开重置展开状态两条没补，窄场景、有声明的行为，见 .md |
| F8 Lab 写回与 `thinking.reset` | 成立，已改：`thinking.reset` 回到 `follow` 的来源与档（`follow.value` 新增，可选），夹具框就地回写档位；补 reducer 测试 |
| F9 图标菜单显示英文 slug | 成立，已改：语言目录加 `roles.icons.*`，当前图标画勾（radio），键改成带类型的元组 |
| F10 全角括号写死、死键 | 成立，已改：括号进语言目录（`roles.effort.storedWhy`），删掉 `roles.effort.label`、`off` |
| F11 effortControl 每行算五遍 | 成立，已改为一次 computed |
| F12 两列时方向键 | 接受取舍：序列按文档顺序，在 .md 写明两列时按行主序；不加左右键（窄场景） |
| F13 注释被插到别的函数前 | 成立，已改 |
| F14 AgentIcon.md 缺验证入口 | 成立，已改 |
| F15 design-language 档位表 | 成立，已改，写明 nbook 亮色两档同值 |
