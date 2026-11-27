---
标签: []
别名: ["标题动作", "视图标题动作", "编辑区标题动作", "Title Actions"]
---

# TitleActions

标题行的动作：一排 24px 的图标按钮（`IconButton` 的 `xs`）加末尾的“⋯”下拉，放在 32px 的标题行里。两处使用：视图标题（[`workbench/views.md`](../../../../../docs/specs/workbench/views.md) 输出 10、11，由工作台的外壳放进视图或容器的标题行、排在“移动到”之前）与编辑区标题（[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md) 输出 34，放在活动编辑组的标签条右侧）。按钮与“⋯”里有什么、怎样排由拥有者算好交来：自己的在前、别的插件贡献的在后，按钮有上限、多出的收进“⋯”（`title-actions.ts` 的 `assembleTitleActions`）。

## 数据

```ts
type Props = {
    /** 外壳算好的动作：按钮一排，“⋯”里按节分好；每项有稳定的 key、标题、图标、不可用的原因与按下态。 */
    model: TitleActionsModel;
    /** 菜单身份（拥有者定，例如视图标题是视图、所在容器与模式、交付状态、代际）：变了就关掉打开着的“⋯”。 */
    identity: string;
    /** “⋯”的可访问名称，例如“更多操作”。 */
    moreLabel: string;
};

type Emits = {
    /** 点了哪个动作：它的 key（拥有者自己的动作用它自己的写法，贡献来的是贡献 id），由宿主按 key 找回动作执行。 */
    run: [key: string];
};
```

无 slots、无 expose；attrs 落在根 `span`。

## 交互

- 按钮的可访问名称是动作标题；悬停提示是标题，不可用时是命令给出的原因，按钮禁用。声明了 `toggled` 的动作是开关：`aria-pressed` 跟着公开状态。
- “⋯”是 nb-ui `DropdownMenu`（紧凑档）：节之间一条分隔线；有按下态的项画成勾选项，不可用的项禁用、`title` 是原因。`model.menu` 为空时不画“⋯”。
- “⋯”打开时记下 `identity`；之后 `identity` 变了（例如视图切换了容器或换代、活动编辑组或活动标签变了），菜单关闭，之前的选择不发 `run`。这与工作台“移动到”菜单同一规则。
- 点击发 `run`，由宿主执行命令；组件不认识命令，也不记状态。

有 `badge` 的按钮在图标后面画这段数字（例如批注的条数），按钮比 24px 宽，宽度的预算由拥有者用 `title-actions.ts` 的 `titleModelFor` 扣掉；收进“⋯”的项不画数字。

每个按钮带 `data-title-action="<命令 id>"` 与 `data-title-action-key="<key>"`，“⋯”带 `data-title-actions-more`。按钮另带稳定名 `command` 加命令 id（`data-nb-target`、`data-nb-key`，[`agent/page-agent.md`](../../../../../docs/specs/agent/page-agent.md) 输出 6）：Agent 的引导按它找控件，不随语言与顺序变，不改名。
