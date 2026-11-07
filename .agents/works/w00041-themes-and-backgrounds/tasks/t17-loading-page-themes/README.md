---
schema: nbook.task/v2
taskId: t17-loading-page-themes
status: done
updated: 2026-11-07
---

# 加载页的主题：场景图背景与进度样式预设

## 目标与范围

从书架进入工作台时的加载页能由主题改外观：用主题的场景图当背景，并从几种内置进度样式里选一种；书房使用，主题编辑器同步

合同：[`theme/skins.md`](../../../../../docs/specs/theme/skins.md) 输出 19、验收 19；[`theme/editor.md`](../../../../../docs/specs/theme/editor.md) 输出 23、验收 23；[`runtime/browser-host.md`](../../../../../docs/specs/runtime/browser-host.md) 启动序列第 1 步与验收 12。计划：[plan.md](plan.md)（设计审查后的口径以 Spec 为准）。

## 决定

- 2026-11-07 开发者：做；范围选“场景图背景加进度样式预设”（不做自定义动画素材）；预设名字与长相（bar、dots、pulse、page）认可，书房用 `page`、示例暮色用 `dots`。

## 完成情况

- 声明与变量：`Look.loading`（`scene` 布尔、`indicator` 四选一，`additionalProperties:false`）；`themeVars` 只取静态 `scene` 写 `--skin-loading-scene`，样式写 `--skin-loading-indicator`（`bar` 不写）。
- 加载页：`appearance-hint.ts` 的提示多了可选的 `scene`（同源 `pathname`）与 `indicator`，各自独立判定；两份 `index.html` 的内联脚本一字不差，第一帧前读回；`host-loading.css` 画场景层（中间压淡的遮罩）与四种纯 CSS 进度样式，减弱动效静止、高对比度不画图、强制颜色下指示器改用系统色；`FailurePage.vue` 同一套类名。
- 编辑器：“场景与取景”分区的“加载页”小节（开关、四选一、一个预览框）；去掉场景图时一并去掉 `loading.scene`。书房两个明暗用场景图加书页，示例暮色用圆点。
- 测试：`themes.test.ts`、`theme-editor.test.ts`、`appearance-hint.dom.test.ts`（真实地址转换器、URL 绕过向量、两份脚本一致）、`FailurePage.dom.test.ts`；e2e：`browser-host`（四种样式乘动效、间距与居中、强制颜色、跨源场景图）、`themes`（首次打开、书房亮暗、对比度、404 退回）、`theme-editor`（开关与样式、开着时移除场景图）。变异检查：提示判定九个、CSS 四个（定位选择器、dots 几何、间距、强制颜色），都会失败。
- 验证：见 [处理](evidences/impl-review-disposition.txt) 末段；对比度实测亮色书名 13.38、提示 6.51，暗色书名 12.69、提示 7.69。
- 实现审查：安全与合同 omp（重要 1、建议 2，[报告](evidences/impl-review-security.txt)），前端 Sonnet（重要 1、建议 8，[报告](evidences/impl-review-frontend.txt)），[处理](evidences/impl-review-disposition.txt)：十一条都成立并已改（“第一帧”那条改了措辞与 Spec，没有加 preload）。设计审查见 [design-review.txt](evidences/design-review.txt)。
- 提交：代码 `f66baa504`、`b20a5582c`、`731fe0e31`、审查修正 `89b9c9db3`、`8db95b6e6`，合入 `3d2937674`；Spec `5548c29c0`、`5b97dce52`、`db3041bb5`。

## 下一步

无。已知边界（写进 Spec）：加载页取这个浏览器上一次应用的主题，改完主题要打开过一次；弱网下场景图取回前先是底色；旧版本读到带 `loading` 的记录会把那一条判为不合格（只保证新读旧）。
