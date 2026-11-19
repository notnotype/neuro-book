---
标签: [state:local, state:inject, env:global]
---

# StickerPacksPage

设置窗口里的“表情包”分区（[`agent/stickers.md`](../../../../../../../docs/specs/agent/stickers.md) 输出 25 到 38）：左边 [`StickerPackRail`](StickerPackRail.md)，右边是选中的表情包——头部、表情网格 [`StickerGrid`](StickerGrid.md)、属性栏（[`StickerFields`](StickerFields.md) 或 [`PackFields`](PackFields.md)）。用户在这里新建、编辑、导入、导出自己的表情包，插件带来的与内置的包只能看、导出、复制到我的。页面只管选中、对话框与布局；取数、写入、上传队列在包装 `packs-page.ts`（`createPacksModel`）。

## 布局

撑满分区。加载中、读失败（图标、原因、“重试”，`role="alert"`）占满内容区居中；没有任何表情包时居中写“还没有表情包”，下面是“新建表情包”与“导入 zip”。

- 就绪时左栏 168px，右边自己滚动，两侧留内边距让焦点环不被裁。右边头部：显示名与说明；右侧“导出”与“更多”菜单（在文件夹中显示、改包名、删除表情包；插件的包只有“在文件夹中显示”），插件与内置的包另有“复制到我的”；被我的同名包盖住的（`summary.shadowed`）在说明下面写一句“被我的同名包盖住”与它要写的包段。无效的表情包右边写“这个表情包无效”和按原因写的该怎么办（清单读不了、清单不合规则、文件夹名不合规、是链接、读不了），只有“在文件夹中显示”、删除（“更多”菜单），文件夹名不合规的右边另有“改包名”按钮，没有“导出”、没有插件包的“只能看”。
- 头部下面是网格与属性栏并排（属性栏 232px，左边一条分割线，滚动时贴顶）。选中的包详情还没到时网格区写读取中。
- 页面窄于 600px（容器查询）：左栏收成顶上的下拉加“新建”“导入”两个图标按钮，属性栏排到网格下面（上边一条分割线），选中格子时把属性栏滚进可见区。

## 交互

- 选中：第一次打开选中“我的”里的第一个；自己新建、改包名、复制、导入之后选中结果那个包；只有选中的包被别处删掉才回到第一项。切换包时清掉格子的选中。
- 选中一个格子显示它的属性栏；属性栏顶上的“返回表情包”、网格里按 Esc 取消选中。提交名字之后格子的键会变：页面在新目录到了时按文件找回它（同一个文件有两项时比对新名字），选中、属性栏与输入框的焦点都保持，不弹回表情包。
- 删除表情或删除表情包先用确认框（写名字与个数）；确认后先关框再做，失败由模型发通知。删掉表情后焦点到下一格，没有则上一格，再没有到“添加”格；删掉表情包后焦点到新选中的左栏项（窄布局里左栏只是隐藏，焦点逐个选择器判可见，落到顶上的下拉）；取消确认框或删除失败时焦点回到打开确认框前所在的位置（确认框没有触发器，组件库不自动归还）。
- 改包名与删除表情包用的文件夹令牌，取自打开对话框、确认框那一刻页面手里的详情，提交时交给回调：之后文件夹被别处换掉，服务端按令牌拒绝（Spec 33、34），不是按提交时的新详情。
- 写入失败：原因交回给还在屏幕上的字段与对话框；同时模型发一条通知，字段所在的组件可能已被换掉。
- 拖放：页面挂载期间在窗口上接管含文件的拖动：一律 `preventDefault`（落在没人接的地方浏览器会把图片当文档打开、整页导航走），拖动经过设置窗口时网格亮起落点提示，只有落在网格上才收（只读的包、没选中包时 `dropEffect` 为 `none`），拖到别处时不收。离开窗口或松手收起提示。松手时在事件的同步段里按 `readDrop` 把文件夹分出来，只把文件交上去，文件夹名单独交出（汇总里写“文件夹不收”）：浏览器交给的 `File` 对文件夹的大小与类型各平台不同，不能猜。
- 导入 zip：“导入 zip”选一个文件；同名冲突时开 [`ImportConflictDialog`](ImportConflictDialog.md)，要导入那一侧的缩略图由本地的 zip 读出（`previewZip`，读不出就只写名字与个数）；选了“另存”或“替换”后用同一个文件再传一次。第一次选的 zip 就失败（不合格、太大、忙、断线、文件读不到）时由模型发通知；选了处理方式之后的失败写在对话框里。预览图的对象地址在预览换掉、对话框关掉、页面卸载时释放。已有的包拿不到令牌时“替换”停用；选择期间已有的包又被别处改过，对话框写“请重新选择”并换成新的信息。
- 复制到我的：复制期间按钮停用，失败由模型通知。
- 改包名对话框打开时去查用到这个包的 Profile（`allowlistUsage`），不挡提交。
- 没选表情时属性栏（[`PackFields`](PackFields.md)）的“按贴纸显示”开关读写 `display`：所有来源的包都能设，开关随偏好变化（别的窗口改了也跟着变）。

## 数据

```ts
import type {StickerPackDetail, StickerPackSummary} from "../../shared/contracts";
import type {UploadItem} from "../upload-queue";

type PageState = "loading" | "ready" | {failed: string};
type Failure = {reason: string};

type StickerPacksPageProps = {
    state: PageState;
    packs: readonly StickerPackSummary[];
    /** 选中的表情包 id；没有为 null */
    selected: string | null;
    /** 选中包的详情；还没到，或与选中的不是同一个包，为 null */
    detail: StickerPackDetail | null;
    /** 进行中的上传，各包的混在一起 */
    uploads?: readonly UploadItem[];
    // 下面都是写入：交回 null（或结果）表示成功，交回 {reason} 是失败原因，页面写进对话框或属性栏的状态行
    createPack?: (folder: string, title: string) => Promise<{id: string} | Failure>;
    /** `token` 是打开对话框那一刻详情里的文件夹令牌；没有为 null（当作已失效） */
    renamePack?: (id: string, folder: string, token: string | null) => Promise<{id: string} | Failure>;
    copyPack?: (id: string) => Promise<{id: string} | Failure>;
    importZip?: (file: File, choice?: {mode: "copy"} | {mode: "replace"; token: string}) => Promise<{id: string} | {conflict: ImportConflict} | Failure>;
    updatePack?: (id: string, change: {title?: string | null; description?: string | null}) => Promise<Failure | null>;
    updateSticker?: (id: string, target: {file: string; name: string | null}, change: {name?: string | null; description?: string | null; common?: boolean}) => Promise<Failure | null>;
    /** `token` 是打开确认框那一刻的文件夹令牌 */
    deletePack?: (id: string, token: string | null) => Promise<Failure | null>;
    deleteSticker?: (id: string, target: {file: string; name: string | null}) => Promise<Failure | null>;
    deleteFile?: (id: string, file: string) => Promise<Failure | null>;
    listFiles?: (id: string, files: readonly string[] | "all") => Promise<Failure | null>;
    /** 用到这个包的 Profile 的显示名；null 查不到 */
    allowlistUsage?: (id: string) => Promise<readonly string[] | null>;
    /** 读本地 zip 的前几个表情画预览 */
    previewZip?: (file: File) => Promise<{title: string | null; count: number | null; items: {url: string; label: string}[]; dispose?: () => void}>;
    /** 按贴纸显示的偏好（agent/stickers.md 输出 47，`picker` 入口交出的服务）；缺省 null，属性栏不画那个开关。 */
    display?: StickerDisplayService | null;
    /** 一开始选中的格子（键见 `pack-view` 的 `stickerKey`、`extraKey`）；给 Lab 场景摆出选中的样子，产品里不传 */
    initialSticker?: string | null;
};

type StickerPacksPageEmits = {
    (e: "select", id: string): void;
    /** `folders` 是拖进来的文件夹名（不传输，汇总里写出） */
    (e: "add-images", id: string, files: File[], folders: string[]): void;
    (e: "export", id: string): void;
    (e: "reveal", id: string): void;
    (e: "retry"): void;
};
```

不看设置窗口的 `writable`：页面写的是 `user://stickers/` 里的文件，不是设置。没有插槽与 `expose`，属性不透传。

## 隐藏通道理由

- `state:local`：格子的选中、各对话框的开关与忙碌状态、拖放的提示状态。
- `state:inject`：文字经表情包插件的翻译端口取（`useStickersPageText`）。
- `env:global`：窗口上的拖放监听，原因见交互的“拖放”：落在页面外的含文件拖动浏览器会把整页导航走，只能在窗口上拦。挂载时加、卸载时移除。

## 不支持

- 拖动排序、多选、裁剪或编辑图片、撤销。
