---
标签: [state:local, env:global]
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
    /** 当前显示语言（产品页从配置读），响应式；面板文字随它即时换。 */
    locale: Readonly<Ref<DisplayLocale>>;
};
```

无 emits、slots、expose。

## 隐藏通道

- `env:global`：挂载时在 `window` 上以捕获阶段监听 `keydown`（页面里的控件先处理按键会让组合键漏掉）；卸载时移除监听、释放键位分发、断开面板槽位、释放面板宿主，四件都做。
- `state:local`：面板宿主（打开状态、查询、会话里用过的命令）随组件销毁。

## 失败

键位登记与执行的失败都交给 `report`，不抛出；`attach` 的断开函数在卸载时一定调用。
