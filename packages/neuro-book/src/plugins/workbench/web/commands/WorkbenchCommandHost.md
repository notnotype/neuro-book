---
标签: [state:local, state:inject, env:global]
别名: ["命令宿主", "Command Host"]
---

# WorkbenchCommandHost

产品页上的命令宿主：建面板宿主、接入工作台的面板槽位、在 `window` 上挂快捷键分发、渲染 [`WorkbenchCommandPalette`](../components/WorkbenchCommandPalette.md)。随页面挂载与卸载；Lab 不挂它，所以快捷键在 Lab 里不响应（[`ui/component-lab.md`](../../../../../../../docs/specs/ui/component-lab.md) 场景 16）。

## 数据

```ts
type Props = {
    /** 命令服务：面板执行命令、快捷键分发都经它。 */
    commands: CommandService;
    /** 把面板宿主接入工作台的面板槽位（打开面板、选择请求由此进来），返回断开函数。 */
    attach: (host: PaletteHost) => Release;
    /** 键位不合法、冲突与快捷键执行失败的去处。 */
    report: (error: Error) => void;
    /** 面板或快捷键执行的命令失败时弹通知（产品页接工作台的通知服务）；不给时失败只进 `report`。 */
    notify?: (input: NotificationInput) => void;
};
```

无 emits、slots、expose。

## 隐藏通道

- `env:global`：挂载时在 `window` 上以捕获阶段监听 `keydown`（页面里的控件先处理按键会让组合键漏掉）；卸载时移除监听、释放键位分发、断开面板槽位、释放面板宿主，四件都做。
- `state:local`：面板宿主（打开状态、查询、会话里用过的命令）随组件销毁。
- `state:inject`：经 `useText()` 取宿主注入的翻译端口，执行失败通知的标题等界面文字都在本插件的目录（命名空间 `nbook.workbench`，`../../locales/`）；语言随端口切换，不重新挂载，组件没有语言属性。没有宿主注入时得到 nb-ui 的缺省端口，那里没有本插件的目录，只显示键名，所以测试与 Lab 场景要注入登记了本插件目录的宿主引擎端口。

## 失败

键位登记与执行的失败都交给 `report`，不抛出。面板与快捷键执行失败时另经 `notify` 弹一条警告级通知，标题是命令名、正文是原因；失败带诊断原文（`detail`，命令抛异常时一定有）时通知带“详情”、不自动消失，诊断里记码、原文与原因（原文在前，原因很长被截断时原文还在）；`stale-target` 不弹（用户入口里它只由命令自己返回，意思是用户自己换了目标，再弹是噪声）；快捷键的失败由分发器记进 `report`，面板的由本组件补记，两个入口都留诊断；`attach` 的断开函数在卸载时一定调用。
