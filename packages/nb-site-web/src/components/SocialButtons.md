---
标签: ["state:inject"]
别名: ["社交图标", "Social Buttons"]
---

# SocialButtons

登录页与注册页表单下面的社交图标（t09 第 7、10 条；t10 计划 3.7；审定 D3）：一行“或”，下面 GitHub、Google 两枚图标，两页同一种画法。组件只画图标、发 `start`；发起请求、发起前的校验、跳去上游都是页面的事。

## 布局

“或”一行两侧各一条细线，下面两枚图标居中排成一行，间距 16px，GitHub 在左、Google 在右。每枚是 nb-ui `IconButton` 的 `lg`（38×38），里面的“按钮面”填满它的内容区（36×36）：

- 两枚同一种按钮面：Google 规范里的圆角、底与描边（亮色白底 `#747775` 描边，暗色 `#131314` 底 `#8E918F` 描边），由样式画（`assets/brands/README.md`）。
- Google：中间是标准的全彩“G”（纯路径的图），占按钮面一半高，亮暗共用一份。
- GitHub：中间是 Invertocat，亮色用黑、暗色用白，与“G”同高。

明暗跟着根元素的 `data-nb-appearance`，由样式换底与 Invertocat，不用脚本。

## 交互

- 点击发 `start(provider)`；不可点时不发。焦点环、按下缩放、不可点的淡化都是 `IconButton` 的。
- 悬停时在按钮面外加一圈淡色，按钮面本身不变（两家都不许改标志的颜色）。
- 读屏名字与悬停提示是“用 GitHub 登录”“用 Google 注册”这样的一句（按 `intent`）；图本身对读屏隐藏。

## 数据

```ts
defineProps<{
    /** 读屏名字与悬停提示写“用 … 登录”还是“用 … 注册”。 */
    intent: "login" | "register";
    /** 各上游是否开放（`meta` 的 `providers`）；还不知道（在取、取不到）时不给，整行不画。 */
    providers?: Readonly<Record<SocialProvider, boolean>>;
    /** 整行不可点（注册关闭、限流倒数、正在发起）。默认 false。 */
    disabled?: boolean;
}>();

defineEmits<{start: [provider: SocialProvider]}>();

// slots：没有。expose：没有。attrs：透传到根元素（一直在的外层，`data-site-social-row`）。
```

## 状态

- 还不知道开放情况（`providers` 没给，`meta` 在取或取不到）：整行不画，零高。先画再撤会让下面的东西先下后上。
- 知道了、有开放的上游：这一行从零高展开（`grid-template-rows` 0fr 到 1fr）并淡入，时长 `--motion-base`；减弱动效时直接出现。没开放的那枚不画。
- 两个都没开放：一直零高，下面的东西不动。
- `disabled`：画着的都不可点。

## 不支持

- 不支持别的上游，也不支持带文字的按钮；要加时连同 `assets/brands/` 与两家的规范一起改。
