# 390px失败的真实浏览器取证

Leader在独立纯nb-ui playground `localhost:3140` 上以Playwright Chromium、390×844验证；不启动产品后端，不读取State Root。未访问3001。

## 已确认

1. 首条sash的初始rect为x275.70/y994.47/width1/height377，中心y1182.97在844px视口外；`elementFromPoint`没有命中。
2. `scrollIntoViewIfNeeded()`后y233.47，真实拖动24px产生一次`commit`；outline宽237.70→261.47，editor441.45→417.69，inspector169.78不变，无pageerror。
3. 但这还不是合格的窄屏验收：`document.scrollWidth=390`只说明外层无溢出，**被测Splitter实际宽850.94px**。
   `.lab-canvas-scroll`宽358、scrollWidth895；内部`.lab-canvas[data-viewport=responsive]`被内容最小宽撑到894.94。
   因此不能只加scrollIntoView就把测试宣布通过，应同时断言目标实际宽度受当前可用宽约束。

## 修复入口

- e2e先滚动手柄到视口内再读boundingBox；浏览器鼠标操作不会自动滚动。
- `playground/app/assets/css/lab.css`的`.lab-canvas-scroll`是未指定轨道最小尺寸的grid，`.lab-canvas`/`.lab-canvas-window`未设min-width:0；
  `SplitterFixture.vue`底栏多处shrink-0长文案也撑大min-content。
- t38范围允许为这个已证实的测量台问题最小调整lab.css和fixture，保持phone/tablet固定画布的可滚动行为，不能让responsive用850px蒙混390px。
- 修复后覆盖真实目标宽度、滚动命中、拖动与page overflow；再检查四主题组合。不用任意等待代替条件断言。

这份报告只覆盖窄屏测试根因，不覆盖D1–D6手势修复。
