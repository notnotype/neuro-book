# t02 首次启动向导与桌面快捷方式 计划

## Context

开发者 2026-11-13 要一个有界面的安装程序（为当前用户安装、选安装位置、选快捷方式）。2026-11-18 调研（[research-r1](evidences/research-r1.md)）：Electrobun 2.0.6 的安装、更新器、卸载都把位置写死在 `%LOCALAPPDATA%\<identifier>\<channel>`，每次更新重建桌面与开始菜单快捷方式，界面文字写死、没有配置项；“为当前用户安装、不要管理员权限”已经满足。开发者定：继续用 Electrobun 的安装程序，选择挪到第一次打开桌面版时的向导里（README 决定 1 到 6，评审板两轮）。

合同：[`runtime.desktop-shell`](../../../../../docs/specs/runtime/desktop-shell.md) 输出 33（桌面快捷方式）、34（首次启动向导）与验收场景 19，条目级 planned；“不承诺”里的安装程序一条改写；输出 13、25 各加一处。

定稿的样子见 [评审板](artifacts/review/index.html) 第 2 轮的 B（上方舞台）与开发者备注：第一屏居中、看板娘放大，切到第二屏时做过渡动画。

## 技术选型

无新依赖。快捷方式的读写照 Electrobun 自己的做法（PowerShell 的 `WScript.Shell` COM，`[Environment]::GetFolderPath('Desktop')` 取桌面目录），不引 `.lnk` 解析库；打开文件夹用已有的 `nbook/backend/open-folder`（`open` 包）。

## 关键设计

### 设置与桥（`src/shared/desktop-bridge.ts`、`src/plugins/desktop/shared/contracts.ts`、`src/desktop/desktop-settings.ts`）

- `DesktopSettingValuesSchema` 加 `desktopShortcut: boolean`；`nbook.desktop` 加配置项“在桌面放快捷方式”（缺省 true，只允许用户层，“桌面窗口”分区，说明“只对安装版、用缺省的数据目录时生效”）。壳的缓存逐项读，旧缓存缺这一项取缺省（现有规则）。
- 壳 → 页面新消息 `install-facts`：`{installed: boolean, defaultStateRoot: boolean}`。壳收到 `page-ready` 时发给那个窗口；页面一侧 `windowDesktopKey` 的端口加 `facts()`（拿到之前为 null）与变化通知。`installed` 的判据与开机自启的 `managed` 相同（更新器取得通道根），两处共用一个值，不各算一份。

### 快捷方式（核心 `src/desktop/desktop-shortcut.ts`，Windows 端口 `desktop/src/bun/desktop-shortcut.ts`）

- 核心纯函数 `desktopShortcutPlan({value, previous, first, installed, defaultStateRoot, existing})` → `"remove" | "create" | "none"`，带原因：不满足安装版与缺省状态根时 `none`；值为关、桌面上有指向本安装的快捷方式时 `remove`（第一次收到值与之后每次收到关都判）；值从关变开（`previous === false`）、桌面上没有时 `create`；其余 `none`。`existing` 是 `{kind: "ours" | "other" | "absent"}`：同名但目标不是本安装或不是快捷方式算 `other`，不动。
- Windows 端口：一次 PowerShell 读桌面目录与 `NeuroBook.lnk` 的目标（UTF-8 输出，同 Electrobun 的写法），删除、创建各一条命令；单引号转义照 Electrobun 的 `powershellSingleQuoted`。失败交回原因，壳记 `desktop.shortcut.*` 日志。文件名按频道：stable 是 `NeuroBook.lnk`，其它频道照 Electrobun 的 `windowsDisplayName` 规则（测试标识的验收用得到）。
- 壳的 `onDesktopSettings` 里与开机自启并列：第一次收到值、或 `desktopShortcut` 变了时同步；`previous` 取上一次页面交来的值（第一次为缓存值，缓存没有为 null）。

### 位置与打开（`nbook.desktop` 新增服务端入口）

- `src/plugins/desktop/backend/plugin.ts`：远程合同 `nbook.desktop/places`（provider server，callers browser）：`places()` → `{stateRoot: string}`；`open({place: "state-root" | "library"})` → `openExistingFolder` 的结果（`no-desktop`、`open-failed` 带原因）。`library` 的路径由页面经 `nbook.projects/projects` 的 `library` 取来显示，打开时服务端自己再取一次（不收页面给的路径，只开这两处）。描述的 `locations` 加 `server`。
- 作品目录还不存在时（新用户）“打开”得到“文件夹不在”：向导写“第一次新建作品时会建出这个文件夹”，不替用户建。

### 向导（`src/plugins/desktop/web/`）

- 组件 `components/FirstRunWizard.vue` 与 `.md`：受控零件，props 是四步要显示的值与可用项（主题列表与缩略图、明暗、语言、三项开关与哪些出现、两处位置、当前步、错误文字），事件交给宿主（`change(key, value)`、`open-place`、`next`、`back`、`skip`、`finish`）。外框用 nb-ui `Dialog`（`show-header=false`、`show-footer=false`、不点遮罩关、`initial-focus` 指主按钮），宽 640、高 540；Esc 经 `request-close("escape")` 交宿主当作跳过。
- 版式照定稿：四段进度条；看板娘第一步 128px 居中、其余 48px 在进度条下；内容居中。第一步到第二步的过渡：看板娘的尺寸与位置用 `--motion-base` 与 `--ease-layout` 过渡（同一个元素，只改宽度与外边距），内容用 Vue `Transition` 横向滑入（方向随前进、后退）；`prefers-reduced-motion` 时都不动。
- 主题卡片：内置四个主题各两张缩略图（亮、暗，WebP，宽 440，放 `web/assets/first-run/`，由 Lab 的书架场景截出；生成命令写进组件 `.md`）；主题选择项来自 `THEME_CHOICES_PROVIDER`，没有缩略图的（插件主题）画只写名字的卡片。明暗卡片取所选主题的亮、暗缩略图，“跟随系统”一半亮一半暗。语言用 `SegmentedControl`。
- 宿主 `web/first-run.ts`：在 `nbook.desktop` 的浏览器入口里，桌面里时贡献 `workbench.overlays` 浮层与命令 `nbook.help.desktop-welcome`（`when` 用 `inDesktop`）；激活后读用户层存储 `first-run` 键，没有记录就打开；值从配置服务读、写经配置服务（主题 `nbook.workbench/theme`、明暗 `nbook.workbench/appearance`、语言 `nbook.settings/locale`、桌面三项是本插件的），写失败时回到配置服务的值并显示原因；跳过、完成写记录 `{version: 1, at: <ISO 时间>}`，写失败记诊断。
- 界面文字进 `nbook.desktop` 的语言目录（中、英两份；本插件现在的文字是内联双语，按现有写法，向导的文字较多时新建 `locales/`，实施时看 i18n Spec 的要求定）。

### 不做

- 不改 Electrobun 的安装与卸载；不提上游 issue（决定 3）。
- 不做“只在开始菜单”的开关（开始菜单的快捷方式是更新器与卸载程序认的那一个）。
- 外部工具检测（t05）以后加成第五步，本 Task 不留位置。

## 切片

1. **Spec**（已写，在 master 上提交）。
2. **快捷方式与桥**：设置项、桥消息、核心 `desktop-shortcut.ts` 与测试、Windows 端口、壳接线；`bun test src/desktop`、`bun run typecheck`。
3. **服务端位置**：`nbook.desktop/places` 合同与服务端入口、测试（真实服务端起停，`open` 用替身只在“打开”这一步）。
4. **向导组件**：`FirstRunWizard` 与 `.md`、缩略图资产、Lab 场景（四步、便携版没有前两行、写入失败、位置打不开、英文、390 宽、暗色）、dom 测试（步进、跳过、Esc、退回保留值、各开关发出的事件、减少动态效果）。
5. **宿主接线**：浮层、命令、存储记录、配置读写、安装事实；e2e `desktop-first-run.e2e.ts`（照 `desktop-settings.e2e.ts` 的 `installFrame`）：桌面里第一次出现、走完四步写进用户层与存储、再开不出现、命令能再打开、浏览器里不出现、安装事实为便携时没有前两行、Esc 跳过写记录。
6. **Windows 验收**（pc-notype，测试标识）：验收场景 19 里能在测试标识下做的：向导出现、关掉快捷方式后桌面上的消失、打开后出现、开始菜单不受影响；更新换上后再删一次（用 t10 的更新验收脚本）。收尾把开发者的快捷方式指回正式安装（记忆里的做法）。

## 验收映射

| Spec | 覆盖 |
|---|---|
| 输出 33 规则 | 切片 2 的核心单测（每种 `existing`、第一次与变化、不满足安装条件） |
| 输出 33 真实读写 | 切片 6 Windows |
| 输出 34 出现、记录、再次打开、浏览器不出现 | 切片 5 e2e |
| 输出 34 四步、值、键盘、动效、减少动态效果 | 切片 4 dom 测试与 Lab 截图；切片 5 e2e 走一遍 |
| 输出 34 安装事实 | 切片 2 壳端测试（`page-ready` 后发出）、切片 5 e2e（便携没有前两行） |
| 输出 13、25 的补充 | 切片 2 桥的解析测试 |
| 场景 19 | 切片 5 e2e 与切片 6 Windows |

## 验证

- 每片：受影响的 bun、vitest 文件与 `bun run typecheck`；改了界面后 `bun run build`、`bun run build:e2e` 再跑 e2e。
- 合入前 e2e：`desktop-first-run`（新）、`desktop-settings`（桌面设置的值多了一项）、`desktop-frame`（浮层挂在根上）、`settings`（“桌面窗口”分区多一项）。
- 未验证：真实 Windows 上首次安装（Setup 装完自动打开）后向导的样子；OneDrive 重定向的桌面目录（按 `GetFolderPath` 推断）。

## 风险

- 用户层存储与配置在服务端，向导依赖连接就绪；页面重连期间写入失败会显示原因，不丢记录之外的东西。
- 多窗口同时首次就绪会各开一个向导（已知限制，写进 Spec）。
- 缩略图会随产品外观过时：`.md` 写明生成命令，改主题时一并重截。
