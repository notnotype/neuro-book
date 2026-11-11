---
schema: nbook.task/v2
taskId: t21-end-key-after-ruby
status: done
updated: 2026-11-11
---

# 一行里有注音时 End 键到不了行尾

## 目标与范围

一行里有注音时，按 End（以及 Shift+End）光标停在注音后面，到不了行尾；t20 取证时在 master 上复现，不是 t20 引入的。查根因，修到 Home、End、Shift+Home、Shift+End 在带注音的行里都停在行首、行尾。开发者 2026-11-11 要求修。

合同：[`workbench/markdown-editing.md`](../../../../../docs/specs/workbench/markdown-editing.md) 输出 27 与验收 10（新增）。

## 调查结果（2026-11-11）

- **根因在 Chrome，不在 ProseMirror 或我们的标记**：在没有任何编辑器库的普通 contenteditable 里，行内有 `<ruby>` 时 End 就停在这一行最后一个注音的后面；不论读音的 `rt` 是不是 `contenteditable="false"`、有没有 `user-select: none`。没有注音、或注音在行尾时正常。重复按 End 不前进，从注音后面的位置按 End 还会退回注音末尾。折行的段落里，没有注音的行也有错位（原生下 Home 之后 Shift+End 只选到 6 个字）。
- **用脚本算行尾不行**：折行处一个文档位置既是上一行行尾又是下一行行首，Chrome 里程序设置的光标画在下一行行首（原生 End 之后 Shift+Home 选 21 个字，程序设到同一位置选 0 个）。
- **样式能绕开**：`display: flex`、`grid`、读音绝对定位以外的写法都改变了排版（基底掉到读音下面、行距变大）。读音绝对定位在行内块的基底上方居中，End 正确，排版与原生相近。

## 做法

编辑器里的注音：`ruby` 画成行内块，`rt` 绝对定位在上方居中，基底顶上留 3px（`nb-markdown/src/display/markdown.css` 的 `.nb-markdown.ProseMirror ruby`）。只读显示不变。DOM 与标记不变，只有样式。

取舍：注音的基底很长（整句）时，整个注音块掉到下一行，不再跟着折行；注音通常只给词，Spec 输出 27 写明。

## 当前状态

**已完成，2026-11-11 合入 master**（`d02b19bad`，合并后快进到 `df63a2cbe`，不 push）。本 Task 的状态标为 done。

- 验证：新 e2e“含注音的行里 Home、End 与加 Shift 的选区到真正的行首行尾，折行的段落每一行都对”（一行的段落，加一个折成几行、第一行有注音的长段落，每一行都验 Home+Shift+End、End+Shift+Home）：不带样式修正时失败（Shift+End 只选到“前林汐”），带上通过。`markdown-editing`、`editor-area`、`markdown-input` 共 101 例，100 过；`editor-area` 的“有未保存的修改时离开页面先请求确认”在长跑里失败一次（打字时序，期望“第二章x”、得到“第二章改x”），单独重跑 3 次都过，与注音无关，记到 t17。
- UI 取证（Lab `EditorGroup/dialect`，nbook、macos × 亮、暗四种组合，旧 = master，新 = 本分支）：`ruby` 计算样式由 `ruby` 变 `inline-block`；读音字号相同（10.2px，基底 17px），居中偏移 0；段落高度 33px → 36px（多 3px）；读音底到基底顶的距离差 3px；`user-select` 仍是 none；Home 后 Shift+End 选中的由“她抬头看了他一眼，远处站着汉字”变成整行“她抬头看了他一眼，远处站着汉字先生，高亮、红字与 x2。”；四种组合都没有页面错误。亮色截图新旧肉眼几乎看不出差别（原始数据与截图在本地 `.local/agent/works/w00025-editor/tasks/t21-end-key-after-ruby/`）。
- 没有另派审查子代理：改动是一段样式加一条 e2e，影响面小。

## 下一步

无。
