---
验证入口: SettingsWindow
标签: [state:local]
---

# BackgroundSettingsPage

设置窗口的“背景”页（[`ui/backgrounds.md`](../../../../../../docs/specs/ui/backgrounds.md) 输出 9）：正文与窗口各一块 [`BackgroundSettingsBlock`](BackgroundSettingsBlock.md)，已传过的图两块共用。只写用户层。

## 数据

```ts
type Props = {
    context: SettingsPageContext;
    settings: SettingsService;
    listImages: () => Promise<FilesResult<Listing> | null>;
};
```

上传走 `BACKGROUND_UPLOAD_URL`，失败码翻成文字交给块显示；设置写入失败交给窗口通知（`reportWriteFailure`）。

## 不支持

删除已传过的图：设置只记引用，图不随设置删除，也没有清理入口。
