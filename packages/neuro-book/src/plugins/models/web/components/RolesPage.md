---
标签: [state:local, state:inject, env:portal]
别名: ["模型角色", "Model Roles"]
---

# RolesPage

设置窗口 AI 分组下的“模型角色”页（[`models/settings-pages.md`](../../../../../../../docs/specs/models/settings-pages.md) 输出 13 到 17）：给角色绑模型。梯度四档（轻量、快速、主力、深度）与专精角色（内置的“压缩”和用户自建的）各一组，每行一个角色、一个可搜索的模型下拉（只列启用且可用的模型，第一项“不绑定”），选了立即写。未绑定的标红写“未绑定”，绑定的模型不可用时写原因。与 [`ProvidersPage`](ProvidersPage.md) 共用同一个数据模块；它也是页面，不是宿主。

## 布局

页面顶上一句说明解析规则；下面两组，每组一个标题行（组名与一句说明）和角色行。角色行三列：名字与说明（自建角色是两个输入框）、模型下拉（200 到 280px）、删除按钮（只有自建的有）。页面根是自己的容器（`container-type: inline-size`），不到 520px 时模型下拉换到名字下面一行。内容列封顶 760px。

## 交互

- 模型下拉选了即写（`setRole`），选回原值不写。绑着的模型现在不可用时，下拉里补一个停用的项写着它的引用，原因里也写出是哪个模型。
- 自建角色的名字与说明在失焦或回车时写（`updateRole`），名字清空时恢复原名、不写。
- “添加专精角色”加一个名为“新角色”的角色（`addRole`），它出现后焦点进它的名字框并全选。
- 别处改了角色时只换没在编辑的那几行的草稿，正在编辑的失焦后再以快照为准；回车之后紧接着失焦不重复写。
- 删除自建角色（`removeRole`）不确认：角色本身没有别的数据，绑定随之消失。
- 写失败交给窗口通知（`reportWriteFailure`），控件随快照回到实际值。

## 数据

```ts
defineProps<{
    store: ModelsStore;
    writable: boolean;
    reportWriteFailure: SettingsPageContext["reportWriteFailure"];
}>();
```

没有 emits、slots 与 expose；attrs 落在根元素上。

## 状态

- 读取中：第一份快照之前写“读取中”。
- 只读：同 `ProvidersPage`，写控件全部停用。
- 出错：未绑定标红；绑定的模型目录里没有了、没启用或没有密钥时写原因，下拉标出错。

## 不支持

- 内置角色改名与删除（服务端拒绝为 `builtin-role`）；梯度角色只有四档，不能加。
- 自动回退：角色未绑定时报错，不换用别的模型（模型角色合同）。

## 隐藏通道理由

- `state:local`：自建角色名字与说明的输入草稿。
- `state:inject`：文字经宿主注入的翻译端口取。
- `env:portal`：下拉与提示传送到 `body`。

数据模块、`writable` 与 `reportWriteFailure` 都经属性传入，读写走的是这条明面通道，所以页面没有 `io:*` 与 `state:shared-*` 标签，能在 Lab 里摆出来。
