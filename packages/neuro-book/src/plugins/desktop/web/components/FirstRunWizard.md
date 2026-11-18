---
标签: [state:local, state:inject, env:portal]
别名: ["首次启动向导", "欢迎向导", "First-run Wizard"]
---

# FirstRunWizard

桌面版第一次打开时的四步向导（[`runtime.desktop-shell`](../../../../../../../docs/specs/runtime/desktop-shell.md) 输出 34）：欢迎、外观、桌面、准备好了。顶上四段进度，看板娘与内容居中，每步一种心情；第一步到第二步时看板娘从中间缩到进度条下方。它是受控零件：当前步、各项的值、哪几行出现、两处位置与错误文字都经 props 进来，用户的每个动作经事件交给宿主（`web/first-run.ts`），宿主写配置、写记录、打开文件夹；组件不读配置、不发请求。

## 布局

nb-ui `Dialog`（`size="md"`，宽 640、高 540，不显示标题区，可访问名称是 `title`），正文不要 Dialog 的内边距，自己排三块：

- **进度**：顶上四段等宽的细条，走过与当前的一段用强调色；旁边一段视觉隐藏、礼貌播报的文字“第 N 步，共 4 步：<步名>”。
- **看板娘**：[`NeuroBookMood`](../../../../ui/brand/NeuroBookMood.md)，放在进度条下居中的固定位置，128px 见方。第一步放大居中（`transform` 下移、原尺寸），其余步缩到 48px（`scale(0.375)`，原点在顶边中点）；只改 `transform`，不改布局。心情：欢迎 `idle`、外观 `idea`、桌面 `focus`、准备好了 `done`。
- **内容**：每步一块，居中排；第一步在看板娘下方留出放大时占的位置。标题用展示字体（第一步 30px，其余 24px）。
  - 欢迎：标题、一句说明。
  - 外观：主题卡片（每张一张书架缩略图，没有缩略图的只写名字），一行四张，窄于 560px 时两列；下面一行左边三张明暗卡片（亮色、暗色、跟随系统，跟随系统的一半亮一半暗），右边语言的分段控件。
  - 桌面：一块圆角面上的几行开关，每行图标、名字、一句说明、`Switch`；行数随 `shownOptions`。
  - 准备好了：一句说明；两行位置，每行图标、名字、路径（等宽、可选中复制、任意处折行）、“打开”按钮；作品目录还不存在时路径下一行中性提示。

页脚是 Dialog 的页脚：左边状态行平时显示“以后都能在设置里改”（第一步空着），有 `error` 时换成它；右边两个按钮：第一步“跳过”“开始”，第二、三步“上一步”“下一步”，第四步“上一步”“开始写作”。按钮是同一组元素、只换文字，换步后焦点留在主按钮上。视口矮于对话框时正文滚动（Dialog 的最大高度 85cqh）。

## 交互

- 打开时焦点在主按钮。主按钮发 `next`（第四步发 `finish`），第一步的“跳过”发 `skip`，“上一步”发 `back`。
- Esc 发 `skip`（Dialog 的 `request-close("escape")`，组件不自己关）；点遮罩不关，没有关闭按钮。
- 回车：焦点在按钮上时照常按下那个按钮；在卡片、开关、分段控件上不前进。
- 主题与明暗卡片各是一组 `role="radiogroup"`，卡片是 `role="radio"`、`aria-checked`；方向键（左右上下）在组内移动并选中，Home、End 到头尾；Tab 只停在选中的那张（都没选中时停在第一张）。选中发 `change`。
- 语言分段控件、开关改了发 `change`。“打开”发 `open-place`。
- 换步：内容用 nb-ui 的 `.nb-ui-switch`（`out-in`，淡入加 6px 横移，方向固定）；看板娘的 `transform` 取 `--motion-move` 与 `--ease-layout`。系统要求减少动态效果时没有位移与缩放的过渡。

## 数据

```ts
type FirstRunStep = 1 | 2 | 3 | 4;
type Appearance = "light" | "dark" | "system";
type DesktopOption = "desktopShortcut" | "openAtLogin" | "tray";

type FirstRunChange =
    | {key: "theme"; value: string}
    | {key: "appearance"; value: Appearance}
    | {key: "locale"; value: string}
    | {key: DesktopOption; value: boolean};

type Props = {
    /** 打开；受控，组件不关自己。 */
    open: boolean;
    step: FirstRunStep;
    /** 主题卡片，按显示顺序；`thumbnails` 为 null 时只写名字。 */
    themes: ReadonlyArray<{id: string; name: string; thumbnails: {light: string; dark: string} | null}>;
    /** 所选主题；不在 `themes` 里时没有卡片被选中。 */
    theme: string;
    appearance: Appearance;
    /** 缩略图取暗的那张：明暗的有效值是暗色时为 true（跟随系统时由宿主按系统算）。 */
    dark: boolean;
    locales: ReadonlyArray<{value: string; label: string}>;
    locale: string;
    options: Readonly<Record<DesktopOption, boolean>>;
    /** 第三步出现哪几行，按这个顺序。 */
    shownOptions: ReadonlyArray<DesktopOption>;
    /** 两处位置的路径；还不知道时为 null（行照画，路径处空着）。 */
    places: {stateRoot: string | null; library: string | null};
    /** 作品目录还不存在：路径下面的中性提示。 */
    libraryMissing: boolean;
    /** 状态行的错误文字（宿主已按码取好）；没有为 null。 */
    error: string | null;
};

type Emits = {
    (event: "change", change: FirstRunChange): void;
    (event: "open-place", place: "state-root" | "library"): void;
    (event: "next"): void;
    (event: "back"): void;
    (event: "skip"): void;
    (event: "finish"): void;
};
```

没有 slots、没有 expose；attrs 落在 Dialog 的面板上，面板带 `data-first-run-wizard` 与 `data-step`。

## 状态

- 第三步 `shownOptions` 为空时只有标题（不会发生：关窗去向总在）。
- 位置路径为 null 时那一行的路径处空着，“打开”照常可点。
- 有 `error` 时状态行是危险色加图标、礼貌播报；按钮与内容不动。
- 没有加载中、禁用、只读：值的读写都在宿主，写入中照常可操作（宿主显示在途值）。

## 不支持

- 不支持自己决定下一步：步数、跳过与完成都由宿主推进。
- 不支持预览主题不提交：点了即发 `change`，由宿主写入。
- 插件主题没有缩略图，只写名字。

## 隐藏通道理由

- `state:inject`：经 `useDesktopText()` 取宿主注入的翻译端口，文字都在 `nbook.desktop` 的目录里，语言换了当场换；没有宿主注入时只显示键名，测试与 Lab 场景要注入登记了本插件目录的端口。
- `env:portal`：外框是 nb-ui `Dialog`，渲染到宿主提供的传送目标（缺省 `body`），目标规则见 Dialog 的文档。
- `state:local`：组件自己记住每组卡片里键盘焦点所在的那张（换步后丢弃）。
