---
标签: [io:remote, state:external, env:global, env:portal]
别名: ["书架页宿主"]
---

# BookshelfHost

书架页在产品里的宿主（[书架页](../../../../../../../docs/specs/workbench/bookshelf.md)）：把页面模型（`shelf-page.ts` 的 `ShelfPage`）的状态交给 `BookshelfPage`，把界面动作交回模型；自己只管三件需要界面的事：作品信息对话框（新建、编辑）、移出书架的确认框、页面可见性与窗口焦点带来的刷新。模型由 `bookshelf-home.ts` 按挂载创建、按卸载释放。模型经远程服务取数与写入，所以只在正式界面（e2e）验证，Lab 不给它造场景；纯呈现的部分在 `BookshelfPage` 等组件的场景里。

## 交互

- 新建：先经模型取放置位置（作品目录设置，或命令面板的路径输入），取消就不开对话框；提交成功关闭对话框，失败把原因留在对话框里。
- 编辑信息：以当前作品的书名、简介、主题色为初值。
- 移出书架：`AlertDialog` 确认后调模型；成功后焦点回到书架（`BookshelfPage.focusShelf()`），被拒时原因显示在页面顶部的提示里。
- 挂载时按 `document.visibilityState` 告诉模型是否可见，之后跟随 `visibilitychange`；窗口 `focus` 触发一次刷新。卸载时停止。

## 数据

```ts
type Props = {
    page: ShelfPage;
    locale: DisplayLocale;
};
```

没有事件：导航、取数与写操作都在模型里完成。

## 不支持

不读 Storage 与设置（模型经宿主能力做）；不处理继续写作的定位（编辑器插件按地址参数做）。
