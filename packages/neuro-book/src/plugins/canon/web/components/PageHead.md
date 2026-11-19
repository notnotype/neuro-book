---
标签: [state:inject]
别名: ["页头", "Page Head"]
---

# PageHead

别的浏览器入口的页面用的页头（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 35）：剧情侧的表格页经 `canonReadsKey` 拿到它（服务把窗口的读取层与线绑好，页面只给标题与受控的值）。与条目页的页头同一套控件与文字。

## 布局与交互

- 最上面是世界横幅（`WorldBanners`）：断开时“世界已断开”与“重试”，世界只读时写原因。
- 左边是标题，下面是默认插槽（一行说明）；右边依次是线选择（`LineSelect`，只有主线时不画）、位置选择（“初值”、各章的开头与末尾）与“按计划”开关。宽度不够时右边整组换到下一行。
- 内容列封顶 760 像素，`wide` 时 1100 像素。
- 位置的值空串是缺省位置（最新一章末尾）；选着的那一章不在章表里时按缺省位置显示。

事件：选位置发 `update:position`（值的写法同条目页），拨开关发 `update:planned`；线选择直接改窗口在看的线，不发事件。

## 数据

```ts
type PageHeadProps = {
    title: string;
    /** 位置选择的值；空串是缺省位置。 */
    position?: string;
    planned?: boolean;
    wide?: boolean;
};
```

经服务拿到的组件已经绑好读取层与窗口的线；组件文件本身另收 `world` 与 `windowLine` 两个属性（canon 内部用）。
