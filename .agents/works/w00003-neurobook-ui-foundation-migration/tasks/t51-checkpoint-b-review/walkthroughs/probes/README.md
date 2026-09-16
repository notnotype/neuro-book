# t51 对抗探针（只读，不启动任何产品服务）

审查对象：切片 5 `a74c7fb8`（worktree `.worktree/w00003-neurobook-ui-foundation-migration`）。
四个探针都在本目录，全部**离线**：不启动 dev server、不访问 3001、不改产品代码或测试、不写产品目录。
唯一写盘位置是 t50 隔离根里的截图（只读打开）。

| 探针 | 试图证伪的声明 | 手段 | 结果 |
|---|---|---|---|
| `p1-execCommand-undo.mjs` | `NATIVE_EDIT_COMMANDS["edit.undo"] = "undo"` 这条去处真的能撤销；t50 §4.0「点撤销把输入框改回（原生撤销）」 | 真机 Chromium（playwright-core + ms-playwright chromium-1228）里键入两段文本，比较 `document.execCommand("undo")` 与 `Ctrl+Z` | **声明未被证伪**：`queryCommandSupported("undo")=true`，`execCommand("undo")` 返回 `true` 且值真的回退 |
| `p2-edit-focus-gating.probe.test.ts` | 实现要求 2 / §六「键盘与焦点行为可用」＋「编辑动作按真实焦点判断」 | jsdom + 产品纯函数，逐元素类别复刻 `index.vue:282-284` 的口径；分别走「鼠标路径（焦点仍在输入框）」与「键盘路径（焦点在触发按钮）」 | **声明被证伪（部分）**：键盘路径下 Edit 六条全部禁用、可点项 0 → 键盘用户拿不到任何编辑动作 |
| `p3-host-driven-panel-position.probe.test.ts` | `DesktopTitleBarChrome.md`「下拉层自带 `position: fixed` 坐标（贴着触发按钮下沿）」 | jsdom 挂真组件：A 点击开（有锚点）对照 B 宿主预置 `openMenu`（无锚点，= Lab 场景路径） | **声明被证伪（宿主驱动路径）**：预置展开态面板内联 `style=""`、父节点 BODY、样式表也不提供定位 → static 块 |
| `p4-screenshot-reading.py` | t50 §4.1 四主题色值表与「combo2/combo4 提示条是拦截器残留」 | 只读重测 t50 隔离根里的 7 张截图：标题栏带主色、底边分隔线、声称文字色像素数、顶部高饱和红块外接框 | **色值表未被证伪**（四组底色全吻合）；**诚实性备注部分不准**：红块只在 combo2 两张出现（combo4 两张没有），且实测与标题栏重叠 y=16..83 vs 0..35 |

## 精确复现命令（cwd 一律 = worktree 根）

```
# P1（真机 Chromium，约 4s，exit 0）
node .agents/works/w00003-neurobook-ui-foundation-migration/tasks/t51-checkpoint-b-review/walkthroughs/probes/p1-execCommand-undo.mjs

# P2 + P3（jsdom，无 Nuxt；exit 0，2 files / 6 tests passed）
bunx vitest run --reporter=verbose --silent false \
  --config .agents/works/w00003-neurobook-ui-foundation-migration/tasks/t51-checkpoint-b-review/walkthroughs/probes/vitest.probe.config.ts

# P4（只读截图取数，exit 0）
python .agents/works/w00003-neurobook-ui-foundation-migration/tasks/t51-checkpoint-b-review/walkthroughs/probes/p4-screenshot-reading.py
```

P1 可用 `PROBE_BROWSER=<chrome.exe>` 指定其它浏览器；P4 可传截图目录参数（默认 t50 隔离根 `%LOCALAPPDATA%\Temp\nbook-t50-accept\shots`）。

### P1 原始输出（exit 0）

```
[input] 键入完成，当前值="新小长名字XYXYZ"
[input/execCommand] queryCommandSupported("undo")=true queryCommandEnabled("undo")=true
[input/execCommand] execCommand("undo") 返回=true；撤销后="新小长名字"
[input] Ctrl+Z 之后的值="新小长名字"
[contenteditable/execCommand] execCommand("undo") 返回=true；撤销后="新小长名字"
```

### P2 关键原始输出（exit 0）

```
[P2/A] <input> → native；<textarea> → native；<select> → native
[P2/A] <button>（标题栏触发按钮就是这一类） → none；<div> → none；document.body → none；null → none
[P2/A] null + Studio 编辑器持有焦点 → editor；<input> + Studio 编辑器持有焦点 → editor
[P2/A] jsdom 对 contenteditable 的读数：undefined（jsdom 不实现该属性，本探针对此不作真机结论）
[P2/B] 鼠标打开菜单（焦点仍在输入框）：editTarget=native；撤销=可用 重做=可用 剪切=可用 复制=可用 粘贴=禁用 全选=可用；可点项=5
[P2/B] 键盘打开菜单（焦点在触发按钮）：editTarget=none；撤销=禁用 … 全选=禁用；可点项=0
[P2/C] Studio 持焦点（浏览器）：edit.undo=studio edit.redo=studio edit.cut=native edit.copy=native edit.paste=unavailable edit.select-all=native
```

### P3 关键原始输出（exit 0）

```
[P3/CSS] .desktop-title-bar__dropdown { z-index: 1001; display: grid; min-width: 168px; padding: var(--nb-popover-pad); … overflow-y: auto; overscroll-behavior: contain; -webkit-app-region: no-drag; }
[P3/click] openMenu=View；面板内联 style="position: fixed; top: 6px; left: 8px; max-height: 320px;"
[P3/host] openMenu=View；面板内联 style=""（空 = 没有任何定位）；面板父节点=BODY；样式表是否提供定位=false
```

> `[P3/click]` 的 `top: 6px / left: 8px` 是 jsdom 无布局（`getBoundingClientRect()` 全 0）的产物，只用来证明「点击路径会写内联定位」；真机坐标见 t50 §4.1。

### P4 原始输出摘要（exit 0）

| 截图 | 量出底色 | §4.1 声称底色 | 声称文字色在标题栏带内的匹配像素 | 顶部红色通知块 |
|---|---|---|---|---|
| combo1-nbook-light-1440 | (255,252,245) | (255,252,245) ✓ | 49 px（声称 (87,83,75)） | 无 |
| combo2-nbook-dark-1440 | (45,41,37) | (45,41,37) ✓ | 26 px（声称 (195,188,176)） | x=1145..1407, y=16..83（标题栏 y 0..34 → 重叠） |
| combo2-nbook-dark-390 | (43,40,36) | — | — | x=95..357, y=16..83（同上） |
| combo3-macos-light-1440 | (255,255,255) | (255,255,255) ✓ | 48 px（声称 (75,85,99)） | 无 |
| combo3-macos-light-390 | (255,255,255) | — | — | 无 |
| combo4-macos-dark-1440 | (44,44,46) | (44,44,46) ✓ | 55 px（声称 (212,212,216)） | 无 |
| combo4-macos-dark-390 | (44,44,46) | — | — | 无 |

判断阈值：底色 ±2 视为吻合；文字色因抗锯齿只统计 ±2 邻域像素数（标题栏里的菜单文字本来就只有几十个纯色像素），26–55 px 与「File/Edit/View/Help + Project 标题」的字量同量级，故判定 §4.1 的色值读数**与截图一致**。
