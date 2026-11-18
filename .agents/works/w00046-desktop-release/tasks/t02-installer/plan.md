# t02 首次启动向导与桌面快捷方式 计划（第 2 稿）

## Context

开发者 2026-11-13 要一个有界面的安装程序（为当前用户安装、选安装位置、选快捷方式）。2026-11-18 调研（[research-r1](evidences/research-r1.md)）：Electrobun 2.0.6 的安装、更新器、卸载都把位置写死在 `%LOCALAPPDATA%\<identifier>\<channel>`，每次更新重建桌面与开始菜单快捷方式，界面文字写死、没有配置项；“为当前用户安装、不要管理员权限”已经满足。开发者定：继续用 Electrobun 的安装程序，选择挪到第一次打开桌面版时的向导里（README 决定 1 到 6，评审板两轮）。

合同：[`runtime.desktop-shell`](../../../../../docs/specs/runtime/desktop-shell.md) 输出 33（桌面快捷方式）、34（首次启动向导）与验收场景 19，条目级 planned；“不承诺”里的安装程序一条改写；输出 13、25 各加一处。

定稿的样子见 [评审板](artifacts/review/index.html) 第 2 轮的 B（上方舞台）与开发者备注：第一屏居中、看板娘放大，切到第二屏时做过渡动画。评审板上的主题卡片名取错了来源（Lab 的主题包），产品的内置主题是 NeuroBook、macOS、护眼绿、护眼米黄，实施按产品的来。

第 1 稿的设计审查（Sonnet 15 条、omp 12 条）与处理见 [design-review-r1-disposition](evidences/design-review-r1-disposition.md)。

## 技术选型

无新依赖。快捷方式照 Electrobun 的做法用 Windows PowerShell 的 `WScript.Shell` COM，脚本固定、路径经环境变量传入；打开文件夹用已有的 `nbook/backend/open-folder`；首次记录用已有的 `defineRecord` 与 `defineStore` 的 `persist`。

## 关键设计

### 安装事实（壳，`src/desktop/install-facts.ts` 与 `desktop/src/bun/index.ts`）

- 启动时算一次：`installed` = 频道不是 `dev`、没有便携标记、可执行文件在更新器给的通道根的 `app\bin` 下；`defaultStateRoot` = 状态根来自缺省位置。开机自启（现在的 `loginIdentity.managed`）与快捷方式都用这一份，不各算。判据写成核心纯函数，Linux 上测。
- 壳 → 页面新消息 `install-facts`：`{installed, defaultStateRoot, stateRoot}`（`stateRoot` 是这次运行的状态根，向导第四步显示它）。壳收到某个窗口的 `page-ready` 时发给那个窗口；页面一侧 `windowDesktopKey` 的端口加 `facts()`（拿到之前为 null）与变化通知。

### 设置（`src/shared/desktop-bridge.ts`、`src/plugins/desktop/shared/contracts.ts`）

- `DesktopSettingValuesSchema` 加 `desktopShortcut: boolean`；`nbook.desktop` 加配置项“在桌面放快捷方式”（缺省 true，只允许用户层，“桌面窗口”分区）。文字进新的语言目录（见下文“文字”）。
- 页面交值的修正（omp 5）：用户层由不可用或无效变为 ok 时，即使有效值没变也补交一次完整快照；开机自启同样受益。

### 快捷方式（核心 `src/desktop/desktop-shortcut.ts`，Windows 端口 `desktop/src/bun/desktop-shortcut.ts`）

- 核心纯函数 `desktopShortcutAction({value, previous, installed, defaultStateRoot})` → `"ensure-absent" | "ensure-present" | "none"`：不满足安装版与缺省状态根时 `none`；值为关时 `ensure-absent`（每次收到关都做，更新后重建的那个由第一次收到的值删掉）；值为开且 `previous === false` 时 `ensure-present`；其余 `none`。`previous` 是本进程里上一次收到的页面值，首次为 null，不取缓存（omp 3）。
- 单写者（omp 4、9）：动作进一个串行队列，只保留最新的一个待做动作；每个动作是一次 PowerShell，在同一条命令里取桌面目录、按字面量路径重查 `NeuroBook.lnk`（是不是快捷方式、目标是不是本安装的 `launcher.exe`，照 Electrobun `deleteWindowsShortcutIfTargets` 的展开与比较）再删或建；建时先写同目录的临时名再改名，同名文件已存在就不动。返回 `removed`、`created`、`kept-other`、`already` 或失败原因，壳记 `desktop.shortcut.*` 日志。壳进入停止中时不再接新动作，等在途那一次（截止 5 秒，到时结束那个 PowerShell 进程）再继续停止。
- PowerShell 调用（omp 7）：`%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -EncodedCommand <UTF-16LE 的固定脚本>`，路径与名字经环境变量传入，脚本里用 `-LiteralPath`，输出 UTF-8；桌面目录用 `[Environment]::GetFolderPath('DesktopDirectory')`，取空或不是绝对路径时诊断并停。文件名按频道（stable 是 `NeuroBook.lnk`，其它频道照 Electrobun 的 `windowsDisplayName`）。

### 位置与打开（实施时改，2026-11-18）

- 原计划在 `nbook.desktop` 加服务端入口与 `nbook.desktop/places` 合同。实施时发现跨插件的运行时导入只能指向对方的 `shared/contracts.ts`（`architecture.test`），`nbook.desktop` 取不到作品目录的规则，于是拆成两处、都不用新入口：
  - 作品目录：`nbook.projects/projects` 加 `revealLibrary`（合同版本 3 → 4，不在 SDK 里公开），服务端自己按设置取路径，交 `nbook/backend/open-folder` 新加的 `revealFolder`（先 `realpath`，区分 `missing`、`not-directory`、`not-accessible`、`no-desktop`、`open-failed`，原因原文只进诊断）。
  - 状态根：页面经桥发 `open-state-root`（不带路径），壳用 `Utils.openPath` 打开自己知道的状态根，打不开只记日志。壳就在用户的桌面会话里，也避开了服务端在 SSH 会话里起的情形（omp 11）。
- 状态根的路径由壳的 `install-facts` 给页面显示；作品目录的路径由页面经 `nbook.projects/projects` 的 `library` 取。

### 向导组件（`src/plugins/desktop/web/components/FirstRunWizard.vue` 与 `.md`）

- 受控零件。props：当前步、主题卡片（id、名字、亮暗两张缩略图或无）、所选主题、明暗、语言列表（取 `HOST_LOCALES`）与所选语言、三项开关的值与哪几项出现、两处位置的路径、每处位置的提示、状态行的中性文字与错误文字。事件：判别联合 `change`（`{key: "theme", value: string} | {key: "appearance", value: "light" | "dark" | "system"} | {key: "locale", value} | {key: "desktopShortcut" | "openAtLogin" | "tray", value: boolean}`）、`open-place`、`next`、`back`、`skip`、`finish`。
- 外框：nb-ui `Dialog`，`size="md"` 加 `width=640`、`height=540`，`show-header=false` 但给 `title`（“欢迎使用 NeuroBook”），`closable=false`、`close-on-overlay=false`、`close-on-request=false`（Esc 经 `request-close("escape")` 交宿主当跳过），`initial-focus` 指主按钮；按钮放 `footer` 插槽（跨步是同一组元素，换步后焦点留在主按钮上），中性提示“以后都能在设置里改”放 `status` 插槽，错误放 `status` 属性。视口高度不够时正文滚动、看板娘缩到 48px（Lab 加 533×373 的场景）。
- 版式照定稿：四段进度条，带读屏文字“第 2 步，共 4 步：外观”（`aria-live="polite"`）；看板娘与内容居中。主题、明暗卡片是 `role="radiogroup"` 与 `role="radio"`、`aria-checked`，方向键移动并选中，Tab 只停在选中项；缩略图 `alt=""`。路径 `select-text`、长路径任意处折行。
- 回车：焦点在按钮上时照常（主按钮就是下一步）；在卡片、开关、分段控件上不前进（Spec 写明）。
- 动效：看板娘放在固定大小的占位盒里，第一步到第二步用 `transform: scale()` 与位移，`--motion-move` 加 `--ease-layout`，心情在缩放开始时换；内容换步引 nb-ui 的 `.nb-ui-switch`（单方向，后退也同向，设计语言允许的简化）；时长取令牌，减少动态效果时自然为 0。

### 向导宿主（`src/plugins/desktop/web/first-run.ts`，`nbook.desktop` 新入口 `first-run`）

- 单开一个浏览器入口（失败不拖累缩放与壳同步），依赖配置、命令服务、存储、时钟、诊断与可选的 `windowDesktopKey`。贡献 `workbench.overlays` 浮层（`load()` 在没有壳时返回空组件、不导入向导）与命令 `nbook.help.desktop-welcome`（`when` 用 `inDesktop`，`expose.agent: never`，`effect: read`，向导已开着时什么也不做）。
- 首次记录：`defineRecord({key: "first-run", scope: "user", locality: "shared", version: 1, schema: {at: string}})`，经 `defineStore` 的 `persist` 订阅。出现条件：

  | 记录 | 用户层配置 | 结果 |
  |---|---|---|
  | 还没就绪、`error` | 任意 | 等，不开 |
  | `missing` | ok | 开（本页还没关过向导） |
  | `missing` | 不是 ok | 等 |
  | `ok` | 任意 | 不开；本页开着的向导关掉（别的窗口写了记录） |
  | `corrupt`、`unsupported-version` | 任意 | 不开，记诊断 |

  跳过、完成写 `{at: <时钟的 ISO 时间>}`，`expect: null`；`conflict` 当成功；其余失败记诊断（下次还会出现）。标题栏关窗不写记录。
- 值的读写：主题、明暗、语言经声明者的命令写（`nbook.settings.switch-theme {theme}`、`nbook.settings.switch-appearance {appearance}`、`nbook.settings.switch-locale {locale}`），按 `auto` 层，作品定了主题时改的是作品的设置，与命令面板相同；桌面三项是本插件的配置项，直接写用户层。点了就按所选显示（在途值），写完以配置服务为准；失败按码取文字放状态行，`unknown-outcome` 有自己的文字。跳过不撤销已改的值。
- 主题卡片：`context.declarations.list(WORKBENCH_THEMES_POINT)` 列出已接受的主题；内置四个（nbook、macos、eye-green、eye-sepia）各有亮、暗缩略图（WebP，宽 320，放 `web/assets/first-run/<id>-<light|dark>.webp`），别的只写名字；用户自建主题不列，当前主题不在列表里时不选中任何卡片。

### 缩略图

- 来源是产品页：脚本 `scripts/first-run-thumbnails.ts`（或 e2e 目录下的一个工具脚本）用 e2e 的产品服务端，预置固定的书架数据与 `theme`、`appearance` 设置，打开书架页截图、裁剪、转 WebP，8 张。命令写进组件 `.md`。
- 机检：dom 测试或 bun 测试断言 `BUILTIN_THEME_CONTRIBUTIONS` 的 id 与 `assets/first-run/` 下的文件一一对应（每个 id 两张）。

### 文字

- 新建 `src/plugins/desktop/locales/{zh-CN,en-US}.json`，按 ADR 0034 登记（`src/web/plugins.ts` 的目录表、消息目录检查、键表测试，照 `nbook.settings` 的写法）；向导与新配置项都用约定键，失败说明按码取。现有的内联双语配置项不在本 Task 迁移。

### 不做

- 不改 Electrobun 的安装与卸载；不提上游 issue（决定 3）。
- 不做“只在开始菜单”的开关；不做第一屏按系统语言、主题预览不提交（取舍）。
- `openExistingFolder` 不等启动器退出的问题（omp 11）是现有共同行为，不在本 Task 改。
- 外部工具检测（t05）以后加成第五步。

## 切片

1. **Spec**（第 2 稿在 master 上提交）。
2. **安装事实、设置与快捷方式**：核心 `install-facts.ts`、`desktop-shortcut.ts`（判定、单写者队列）与测试；桥消息与解析测试；配置项；页面交值的修正与测试；Windows 端口与壳接线。`bun test src/desktop`、相关 vitest、`bun run typecheck`。
3. **打开位置**：`revealFolder` 与测试（真实目录：存在、链接、不存在、文件、不可访问；没有桌面）、`revealLibrary`、桥消息 `open-state-root`。
4. **文字目录与缩略图**：语言目录与登记；缩略图脚本与 8 张图；机检。
5. **向导组件**：`FirstRunWizard` 与 `.md`、Lab 场景（四步、便携版没有前两行、写入失败、结果未知、位置不存在、英文、390 宽、英文加 390 宽、暗色、矮视口）、dom 测试（步进、跳过、Esc、退回保留值、各控件发出的事件、回车只在按钮上前进、卡片的方向键与 Tab、读屏文字随步变、换步后焦点在主按钮）。
6. **宿主接线与 e2e**：入口、浮层、命令、记录、命令写值、安装事实。e2e：先在 `e2e/fixtures` 做共用的模拟壳（发 `install-facts`、记下发给壳的消息）、`startProductServer` 加预置“已看过向导”的选项，六个模拟壳的 e2e 改用它；新 `desktop-first-run.e2e.ts`：第一次出现、走完四步写进用户层与记录、再开不出现、命令能再打开、浏览器里不出现也不加载向导的包、便携没有前两行、Esc 跳过写记录、升级用户（已有设置与作品、没有记录）出现一次、记录写不成时下次还出现、设置写失败时控件回到原值并有说明、动效的计算样式（`transition-duration` 与减少动态效果为 0）；`text-selection.e2e.ts` 加向导的路径。
7. **Windows 验收**（pc-notype，测试标识）：向导出现、关掉快捷方式后桌面上的消失、打开后出现、开始菜单不受影响、更新换上后再删一次；便携版第三步没有前两行。收尾把开发者的快捷方式指回正式安装（记忆里的做法）。

## 验收映射

| Spec | 覆盖 |
|---|---|
| 输出 33 判定与队列 | 切片 2 核心单测（每种值与 previous、不满足安装条件、快速反向切换收敛、停止时等在途） |
| 输出 33 真实读写 | 切片 7 Windows |
| 输出 34 出现条件、记录、再次打开、浏览器不出现 | 切片 6 e2e |
| 输出 34 四步、值、键盘、读屏 | 切片 5 dom 测试；切片 6 e2e 走一遍 |
| 输出 34 动效、减少动态效果 | 切片 6 e2e 读计算样式；Lab 截图 |
| 输出 34 安装事实 | 切片 2 核心判据测试与壳端发送；切片 6 e2e（便携没有前两行）；切片 7 真实便携 |
| 输出 13、25 的补充 | 切片 2 桥的解析测试 |
| 场景 19 | 切片 6 e2e 与切片 7 Windows |

## 验证

- 每片：受影响的 bun、vitest 文件与 `bun run typecheck`；改了界面后 `bun run build`、`bun run build:e2e` 再跑 e2e。
- 合入前 e2e：`desktop-first-run`（新）与六个模拟壳的文件（`desktop-close`、`desktop-update`、`desktop-settings`、`desktop-frame`、`text-selection`、`editor-font-size`），加 `settings`，共 8 个。
- 未验证：真实 Windows 上首次安装（Setup 装完自动打开）后向导的样子；OneDrive 重定向的桌面目录（按 `GetFolderPath` 推断）。

## 风险

- 多窗口同时首次就绪、记录还没写时各开一个（几百毫秒的窗口）；先完成的写了记录，其余的随订阅关掉。
- 缩略图会随产品外观过时：机检只保证文件齐全，外观变了要按 `.md` 的命令重截。
- Electrobun 更新会重建或改回同名快捷方式（omp 1），装后迁移桌面让 Electrobun 自己的卸载与更新拒绝旧清单（omp 2）：上游行为，写进已知限制与调研。
