# 审查对象：NeuroBook 消息视图停靠在侧栏时的版式，与“两个侧栏共用侧轨”的设计草案

仓库：`/home/notnotype/CodeRepository/neuro-book`（主工作区，master，只读）。图在本目录（`/tmp/review-t19-rail/`），都是真实页面的截图或在真实页面上用样式摆出来的稿。

## 产品背景

- NeuroBook 是本地优先的长篇写作工作台（Vue，类 VS Code 的布局）。工作台骨架固定是 `活动栏 | 侧栏 | 编辑区 | 右栏`，底部面板在编辑区下面；布局是一棵树，工作台是唯一写者，插件只提交意图。合同：`docs/specs/ui/workbench-layout.md`（输出 1 骨架、20 面板头、22 活动栏、47 右栏与底部面板的入口条）、`docs/specs/workbench/views.md` 输出 19（视图接管标题区、浮动窗自绘头）、`docs/adr/0044-workbench-single-layout-tree.md`、`docs/adr/0046-workbench-view-containers.md`。
- 活动栏是侧栏的“入口条”：上段列侧栏里的容器（一个容器一项，点了切换侧栏内容），下段是全局项（账号、设置）。右栏、底部面板的入口条是横着的，容器只有一节时并进面板头那一行。
- 消息视图（`packages/nb-agent-ui/src/vue/messages/AgentMessages.vue` 与同名 `.md`，宿主在 `packages/neuro-book/src/plugins/agent/web/`；行为合同 `docs/specs/agent/conversation.md` 输出 51）是 IM 式的：bot 联系人、会话列表、聊天区。右栏默认约 400 像素宽。宽度不到 600 时是窄版：左边 52 像素的头像列（“≡”开列表、bot 头像与未读点、最近 5 个会话），右边聊天区，完整列表在抽屉里（`now.webp`、`now-open.webp`）。宽版是常驻列表栏加聊天区。浮动成窗口时视图自绘整个头。

## 开发者的原话（需求来源，按时间）

1. 看停靠窄版（`now.webp`）：“单看标题头很好看，单看视图内容也不错，但是他们两个地方的连接很突兀。”
2. “整个的设计就有点怪怪的。点击‘打开列表’这个三横线这个设计感觉有点怪，但是我挺喜欢这个对话条的。把这个会话条放到右边去，变成和左侧边栏这种设计会不会好一些？整体的 UI 可以来优化一轮。”
3. 看第 1 轮稿（`l-foot`、`r1-foot`、`r2-foot` 三种位置；`r2-foot`/`r2-groups`/`r2-expand` 三种列表入口）后选了“右边缘、通到顶”和“底部两个按钮”，并说：“就是你这个竖线太生硬了。我推荐可以和左侧边栏共用一个做法，设置左侧边栏和右侧边栏还可以直接交换为止。是否要为这种模式提供支持而不是给左侧边栏（ActivityBar）和这个消息视图特例呢？这里你觉得提供什么 API 比较好？”；“我感觉竖屏下对话条的展开不是一种更好的交互？有没有更好的交互方法？列出目前 IM 的做法有哪些？”
4. 看第 2 轮稿（`rail-default`、`rail-swapped`、`rail-history-drawer`、`rail-history-page`）后：“整页切换我感觉也不太好。”另指出两处稿面问题：聊天区右边空出一条、右边的轨和右栏卡片的圆角断开（这两处是摆稿时的样式问题，不是方案本身）。

## 当前草案（作者的方案，可以质疑）

**侧轨**：侧轨归侧栏区域所有。骨架变成 `轨 | 侧区域 | 编辑区 | 侧区域 | 轨`，轨总贴窗口外缘；设置 `nbook.workbench/primarySide: left | right` 对调两个侧区域。底部面板保持横的入口条。一条轨从上到下三段：这个区域的容器入口；当前视图自己的项（消息视图：新对话、bot 头像、最近会话；只在区域此刻只显示一节、视图就绪时给）；底段（视图的固定按钮“全部 bot”“会话历史”，主侧那条再加全局项）。右栏原来横在头里的入口搬进轨。

**给视图的接口**（照现有 `ViewHead` 接管标题区的做法，`packages/neuro-book/src/plugins/workbench/shared/contracts.ts`）：

```ts
export const VIEW_RAIL: unique symbol; // 内置视图声明要用侧轨，先不进插件 SDK
export interface ViewRail {
    /** 轨此刻给视图的两段；null 时视图在自己的内容里画头像列（浮动窗、底部面板、区域里不只一节）。 */
    readonly slots: Readonly<Ref<{readonly main: object; readonly foot: object} | null>>;
}
```

视图用 `Teleport` 把活的头像、未读点送进轨；工作台管轨的宽度（48）、分隔线、F6 停靠站、容器入口的拖动。

**窄版里打开完整列表**：候选是抽屉（现状，盖掉聊天区大半）与整页切换（聊天区整块换成列表，再点一次或选中一项换回）；开发者两个都不满意。
