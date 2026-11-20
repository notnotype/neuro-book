---
标签: [state:inject, env:timer]
别名: ["案头"]
---

# ShelfDesk

书架页上半的案头（[书架页](../../../../../../../docs/specs/workbench/bookshelf.md) 输出 2、3）：三栏，不给面、直接压在窗体底纹上。

- 左栏统计：大字是今天写的字（没有一部作品给出今天的数字时是总字数），下面一行总字数、篇数、作品数；有继续写作的目标时一个“继续写作《书名》”按钮。
- 中栏“最近写到”：各作品最近编辑的那个文件，按时间取前三条，每条书名、片段名、时间和一行摘录；点一条在那个文件末尾接着写。都没有编辑记录时写一句提示。
- 右栏看板娘（`NeuroBookMood`，眼睛跟鼠标），150px，带 `data-shelf-mascot` 的一格。这一格可以叠一个贡献的组件（`companion`，来自 `projects.desk`，[bookshelf.md](../../../../../../../docs/specs/workbench/bookshelf.md) 输出 22）：猫始终由这里画，贡献的组件放在同一格上（单格网格，`grid-area: 1 / 1`，不加定位），贡献晚到、换掉或拿掉都不重挂猫。猫的心情跟贡献组件发的 `update:mood`，没有贡献时 `idle`。
- 给贡献组件的约束：单个根元素，宽铺满格子、圆角取 `inherit`（格子的圆角宽时 34px、窄时 22px），里面要跟着圆角的元素再取 `inherit`；宽窄按案头根上的容器查询 `@container (max-width: 720px)`，不另设容器；超出格子的部分（气泡）自己绝对定位、不推动布局。

空书架时左边换成问候：标题“书架还是空的”与一句解释作品是文件夹；中栏不显示。

容器窄于 720px 时统计与看板娘一行，“最近写到”另起一行，看板娘 96px。

## 数据

```ts
type Props = {
    items: ReadonlyArray<ShelfItem>;
    /** 相对时间按它算（ISO）。 */
    now: string;
    /** 叠在看板娘那一格上的贡献组件；缺省 null。 */
    companion?: Component | null;
};
type Emits = {
    /** 继续写作：某部作品最近编辑的文件末尾。 */
    continue: [id: string];
};
```

根节点带 `data-shelf-desk`；统计 `data-shelf-stats`，“继续写作”按钮 `data-continue`，最近写到的每条 `data-recent-piece="<id>"`。没有插槽与 expose。

## 隐藏通道理由

`env:timer`：看板娘的循环动画与跟随鼠标由品牌成品的脚本驱动（见 `NeuroBookMood`）。

`state:inject`：经 `useText()` 取宿主注入的翻译端口，界面文字都在本插件的目录（命名空间 `nbook.projects`，`../../locales/`）；语言随端口切换，不重新挂载。没有宿主注入时得到 nb-ui 的缺省端口，那里没有本插件的目录，只显示键名，所以测试与 Lab 场景要注入登记了本插件目录的宿主引擎端口。
