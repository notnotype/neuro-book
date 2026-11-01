# 任务：Agent 体验：w00039 t02 内核提案

你扮演 NeuroBook 产品里的 Agent（不是开发 Agent），在一个按提案模拟出来的项目里完成四个任务，检验这套模型、工具和格式能不能让 Agent 把事做对。

- 提案（可以读，重点是第四节的 3、4、5、6、8 小节）：`/home/notnotype/CodeRepository/neuro-book/docs/proposals/world-engine-kernel.md`
- 夹具目录：`/home/notnotype/CodeRepository/neuro-book/.local/agent/works/w00039-novel-writing-plugins/tasks/t02-story-model/review/fixture/`。先读 `README.txt` 与 `tools.txt`，再按顺序做 `tasks/` 下的任务 1 到 4。
- 组件的用法说明在 `reminders/`；README 写了“调用工具”就是读哪个文件。

## 规则

- 只读：不修改仓库与夹具里的文件，不开子代理。只用夹具里的信息、任务给的材料和提案；不要读仓库里别的文件来补信息，也不要去找答案。
- 按任务顺序做；任务 1 做完之前不要打开 `chapters/task2-only/`。
- 每次“调用工具”都按顺序记下：调用、参数、为什么、拿到了什么有用的东西。需要但夹具没有的结果，不要编造，记下“想查什么、为什么、没有它怎么办”。
- 每做完一个任务就把产出追加写进报告文件，不要等到最后：运行到时间上限会被截停。
- 用中文写。

## 报告

报告文件：`<见启动命令里写的路径>`（只追加）。每个任务一节：

1. 工具调用记录；
2. 任务产出（审查意见 / write.change 与 write.edit 列表 / 写入及理由 / 材料清单与字数）；
3. 这个任务里，模型、工具或格式不够用、让你别扭、让你差点做错的地方，每条写现象、你怎么绕过去的、建议改法。

最后一节汇总：按影响排序的问题清单；带值渲染 `{路径 = 值}` 用起来怎样；剧情变更与创作修改分得清分不清。
