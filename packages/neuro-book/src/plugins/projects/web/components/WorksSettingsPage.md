---
标签: [state:local, state:inject, env:portal]
别名: ["作品分区", "作品设置", "Library Settings"]
---

# WorksSettingsPage

设置窗口里“作品”分区的页面（[`settings/settings-window.md`](../../../../../../../docs/specs/settings/settings-window.md) 的 page 分区，[书架页](../../../../../../../docs/specs/workbench/bookshelf.md) 输出 21）：`nbook.projects` 贡献的 column 页面，只在“用户”标签下可用。两行：“作品目录”（新作品缺省放在哪）与“启动时打开”（桌面版启动、托盘或 Dock 开窗、`nbook` 打开浏览器时进上次的作品还是书架，[`runtime/projects.md`](../../../../../../../docs/specs/runtime/projects.md) 的“启动时打开”）。作品目录是路径，通用列表画不了“选一个服务端上的目录”，所以由书架所在的插件自己画，选目录用书架同一个目录选择器 [`PathPickerDialog`](PathPickerDialog.md)（选目录模式）。设置窗口画分区的标题与说明，这里从第一行开始画。

## 布局

两行 [`SettingsRow`](../../../../../ui/settings/SettingsRow.md)（标签列加控件列）。第一行标题“作品目录”与说明；控件是路径文字（至多 320px 宽，长路径在任意处折行）加“更改…”按钮；没设时路径的位置是服务端实际会用的缺省目录，后面跟淡色的“（缺省）”（例如 `/home/writer/Documents/NeuroBook（缺省）`），取不到时写一句淡色的“取不到缺省目录”。已修改（用户层写了这个键）时有竖线与“恢复默认”，由 `SettingsRow` 画。第二行标题“启动时打开”与说明，控件是两段的 nb-ui `SegmentedControl`（“上次的作品”“书架”，`size="sm"`），没写过时选中缺省的“上次的作品”。窄于约 450px 时控件换到标题下面。

## 交互

- “更改…”打开目录选择器（选目录模式），起点是现在的作品目录；没设时是缺省的作品目录。选择器是模态对话框，叠在设置窗口上面；`Esc` 与取消只关选择器，焦点回到“更改…”。
- 在选择器里选定一个目录：关掉选择器，经 `settings.update(librarySetting, 路径, {layer: "user"})` 写进用户层；写入结算之前路径文字显示这次选的目录，写成功后就是层里的值；写不进去时发 `write-failed`，路径文字回到层里的实际值。
- 写入进行中“更改…”停用，不发起第二次。层文件无效或连不上时（`SettingsRow` 交来 `disabled`）“更改…”停用。
- 点“启动时打开”的一段：经 `settings.update(startupOpenSetting, 值, {layer: "user"})` 写进用户层；写入进行中控件停用，不并发写第二次；写不进去时发 `write-failed`，控件回到层里的值。层文件无效或连不上时控件停用。
- “恢复默认”由 `SettingsRow` 删掉用户层的键，回到没设、重新显示缺省目录；它没写成时同样发 `write-failed`。
- 缺省目录经 `readLibrary` 取：每次进入没设（第一次显示、恢复默认之后）取一次，取到之前不显示路径，再取时保留上一次的结果。结果的 `source` 是 `setting` 时（服务端已读到一个设置值、本页还没收到）不显示它，等设置值到了就不再是没设。取不到不影响“更改…”。

文字选择：作品库路径可选（见 nb-ui 开发规范的“文字能否选中”）。

## 数据

```ts
import type {SettingLayer, SettingsService} from "nbook/shared/settings";
import type {WorksWriteFailure} from "../works-section";
import type {PathPickerSource} from "./PathPickerDialog.vue";
import type {LibraryInfo} from "../shelf-page";

type Props = {
    /** 设置窗口当前的标签（页面上下文的 `context.layer`，由插件交给设置窗口的包装组件读出）；这个分区只在“用户”标签下可用。必填、受控。 */
    layer: SettingLayer;
    /** `nbook.projects` 自己的配置服务：读写作品目录与启动时打开（只能写本插件声明的项）。必填。 */
    settings: SettingsService;
    /** 目录选择器的数据来源（产品里是 `nbook.projects/projects` 的 `browse`）。必填。 */
    source: PathPickerSource;
    /** 当前有效的作品目录（产品里是 `nbook.projects/projects` 的 `library()`，`{path, source: "setting" | "default"}`）；取不到为 null，诊断由提供方记。必填。 */
    readLibrary: () => Promise<LibraryInfo | null>;
};

type Emits = {
    /** 作品目录或启动时打开没写进设置（这里的写入，或 SettingsRow 的“恢复默认”），`setting` 说是哪一项；宿主按它发通知。 */
    (event: "write-failed", failure: WorksWriteFailure): void;
};
```

没有 slots、expose；attrs 落在根上。根带 `data-works-settings`，路径文字带 `data-works-library`（没设、显示缺省目录时另带 `data-works-library-default`，取不到缺省目录时另带 `data-works-library-default-unknown`），“更改…”带 `data-works-library-change`，“启动时打开”的分段控件带 `data-works-startup`。

## 状态

- 没设：路径位置是缺省目录加淡色的“（缺省）”，没有已修改竖线；缺省目录取到之前路径位置空着，取不到时是淡色的“取不到缺省目录”。
- 设了：路径文字、已修改竖线与“恢复默认”。
- 写入中：路径文字是这次选的目录，“更改…”停用。
- 层不可写（文件有错、连不上）：“更改…”停用；分区顶部的说明由设置窗口画。
- 加载、空数据：配置服务的读取是同步的；缺省目录的加载与失败见“没设”；目录列表的加载与失败在选择器里。

## 隐藏通道理由

- `env:portal`：来自 `PathPickerDialog`（模态对话框传送到 body 或宿主给的传送目标）。
- `state:local`：选择器开着与否、这次写入中的路径、没设时取到的缺省目录。
- `state:inject`：经 `useText()` 取宿主注入的翻译端口，界面文字都在本插件的目录（命名空间 `nbook.projects`，`../../locales/`）；语言随端口切换，不重新挂载。没有宿主注入时得到 nb-ui 的缺省端口，那里没有本插件的目录，只显示键名，所以测试与 Lab 场景要注入登记了本插件目录的宿主引擎端口。

## 注意事项

- 写入经属性传入的 `settings` 发出（同 `SettingsRow`），缺省目录经属性传入的 `readLibrary` 读：它们是调用方给的、可替换的入口，不是组件自己伸出去的通道。page 分区就是这样写自己插件的项（[`settings/settings-window.md`](../../../../../../../docs/specs/settings/settings-window.md) 输出 6），设置窗口不认识这个插件的项。

## 不支持

不新建、不检查目录：目录在新建作品时才建出来；路径的合法性由新建时的服务端校验负责。不写本作品层（作品目录只允许用户层）。
