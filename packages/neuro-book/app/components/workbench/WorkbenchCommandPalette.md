---
标签: [state:local]
---

# WorkbenchCommandPalette

Lab 的 S4 全局面板：把 `host` 里的命令注册表与面板状态渲染成 nb-ui QuickInput 浮层。`>` 按命令搜索、`:` 按行号跳转，两种模式共用同一个输入框与同一次打开的浮层。

它不是一个能独立摆出来的通用零件：宿主由 prop 传入（Lab 里是 LabShell 的唯一实例），候选从哪来、查询含义、执行时机都归宿主；组件自己不建注册表、不读 store、不碰 Storage、不读场景。

## 数据

```ts
type Props = {
    /** 注册表 + palette 状态 + activeEditor + 会话 MRU；面板只通过它调用命令 */
    host: WorkbenchCommandsHost;
    /** i18n 解析入口；带可选 params 以支持「跳转到第 {line} 行」这类参数化文案 */
    titleOf: (key: string, params?: Record<string, unknown>) => string;
};
```

无 emits：组件把 QuickInput 的请求翻译成 `host` 调用，宿主状态变化驱动回显。无 slots、无 expose；attrs 透传到 QuickInput（QuickInput 再把它们绑到 portal 出的浮层面板根上），Lab 因此能用 `data-lab-subject` 把打开中的面板标成受检零件。

## 命令契约

面板是命令系统**触发面本身**，不是「宿主发出、组件响应」的普通组件：调用确实发生在组件内，但唯一入口是 prop 传入的 `host`——没有模块级注册表，也没有第二条隐藏通道。它引用两个命令 id，且都属于面板合同的一部分：

- `:N` 合成 `nbook.editor.go-to-line` 的参数并在 accept 后执行；N 的合法性在这里求值（读 `getLineCount`），非法输入不产生候选项。
- `nbook.quick-open.open-line` 是同层模式切换：不关面板，执行后把查询原位改成 `:`，并保留打开时捕获的目标。

其余命令都按 id 交给注册表执行；结果是注册表的审计事件，成功与否都写在执行记录里。

## 交互与状态

- 打开/关闭由 `host.palette.open` 决定。accept 后先关闭面板，等 QuickInput 的 `closed`（焦点已归还）才执行；等待期间重复 accept 忽略；关闭期间文档/场景换代（目标不再匹配当前活动编辑器）则作废这次选择。
- Escape 由 QuickInput 关闭并把焦点还给打开前元素；确认框与面板不同层同时开。
- 候选＝`human !== false` 且当前 `when` 满足的 canonical 命令，在 host 的 revision/context 变化时重算，不轮询；行号模式在正文变更、上下文变化与每次查询输入时重读行数。
- 行号非法、没有活动编辑器或编辑器不支持行导航时，列表为空并把原因显示在空态里，Enter 不提交、不移动光标。
- 成功的面板选中命令写回 `host.recentCommandIds`（去重前插、上限 30）；行号动作与面板入口本身不记，失败与取消不记。
