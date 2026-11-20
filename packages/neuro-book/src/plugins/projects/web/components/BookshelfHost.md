---
标签: [io:remote, state:external, state:inject, env:global, env:portal]
别名: ["书架页宿主"]
---

# BookshelfHost

书架页在产品里的宿主（[书架页](../../../../../../../docs/specs/workbench/bookshelf.md)）：把页面模型（`shelf-page.ts` 的 `ShelfPage`）的状态交给 [`BookshelfPage`](BookshelfPage.md)，把界面动作交回模型；自己只管需要界面的事：作品信息窗口（新建、编辑）、目录选择器（打开已有作品、新建时换位置）、移出书架的确认框、页面可见性与窗口焦点带来的刷新。模型由 `bookshelf-home.ts` 按挂载创建、按卸载释放。模型经远程服务取数与写入，所以只在正式界面（e2e）验证，Lab 不给它造场景；纯呈现的部分在 `BookshelfPage` 等组件的场景里。

## 交互

- 挂载时取一次作品目录（空书架的卡上写它）；新建窗口从它开始，用户改了位置且新建成功后把新位置写进设置。
- 新建、编辑：提交成功关窗口，然后按窗口交出的封面变化上传或移除封面（失败发通知，作品本身已建成）；新建时封面与作品目录都写成之后打开新作品（整页进入工作台），有一步没写成就留在书架上，让失败通知看得见；服务端针对字段的拒绝交回窗口（字段标为无效、原因写在窗口的状态行），别的失败由模型发通知、窗口留着。
- 打开已有作品：选择器选一个目录后登记；登记失败的原因显示在选择器里，输入保留。
- 移出书架：`AlertDialog` 确认后调模型；成功后焦点回到书架（`BookshelfPage.focusShelf()`），被拒时模型发通知。
- 右上角的齿轮：经模型执行 `nbook.settings.open`（失败由模型发通知）；作品目录在设置窗口的“作品”分区里改，书架上没有入口。
- 挂载时按 `document.visibilityState` 告诉模型是否可见，之后跟随 `visibilitychange`；窗口 `focus` 触发一次刷新。卸载时停止。

## 数据

```ts
type Props = {
    page: ShelfPage;
    /** 本页的设置窗口开着（公开状态 `nbook.settings/windowOpen`，由 `bookshelf-home.ts` 读好传入）：齿轮画成按下。 */
    settingsOpen: boolean;
    /** 叠在案头看板娘上的贡献组件（`projects.desk`，由 `bookshelf-home.ts` 接收并加载后传入）；缺省 null。 */
    companion?: Component | null;
};
```

没有事件：导航、取数与写操作都在模型里完成。

## 隐藏通道理由

`state:inject`：经 `useText()` 取宿主注入的翻译端口，界面文字都在本插件的目录（命名空间 `nbook.projects`，`../../locales/`）；语言随端口切换，不重新挂载。没有宿主注入时得到 nb-ui 的缺省端口，那里没有本插件的目录，只显示键名，所以测试与 Lab 场景要注入登记了本插件目录的宿主引擎端口。

## 不支持

不读 Storage 与设置（模型经宿主能力做）；不处理继续写作的定位（编辑器插件按地址参数做）。
