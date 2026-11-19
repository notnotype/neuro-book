---
标签: [state:inject]
别名: ["剧情读取失败", "Plot Read Failure"]
---

# ReadFailure

剧情的读取失败时的那一条（[`plot/author-ui.md`](../../../../../../../docs/specs/plot/author-ui.md) 输出 4、失败与恢复）：危险色的横幅，写“剧情的数据读不出来”与说明，右边“重试”。三张表与四个分页共用。

## 布局与交互

- 说明：线读不到写“这条线读不到”；`not-found` 写“找不到这个条目”；服务给了文字说明（例如取数抛错的消息）就写它，否则写失败码。
- 点“重试”发 `retry`；页面接到后调读取服务的 `retry()`（在线时把读失败了的读取再读一次）。
- 放在哪由页面定：没读到过时页面只有它，读到过的页面留着旧内容、它放在内容上面。

## 数据

```ts
type ReadFailureProps = {
    failure: CanonFailure;
};
type ReadFailureEmits = {retry: []};
```

没有插槽与 expose。

## 隐藏通道理由

`state:inject`：界面文字经注入的文字端口取（剧情的目录）。
