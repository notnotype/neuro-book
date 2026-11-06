---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: workbench.bookshelf
owners:
  - nbook.projects
---

# 书架页

## 目标与非目标

没有绑定项目的窗口打开 `/` 时看到书架页（书房）：上半是案头（写作统计、最近写到、看板娘），一步回到上次写到的地方；下半是全部作品，卡片与列表两种视图，能新建作品、打开已有作品、修改作品信息与封面、移出书架。作品目录在设置窗口的“作品”分区里改，这个分区也由 `nbook.projects` 贡献（输出 21）。数据来自 `nbook.projects` 的远程服务（[`runtime.projects`](../runtime/projects.md)），统计只读缓存与运行中项目的实时状态，不为显示统计而打开项目。

不承诺：

- 按天的写作量细条、云同步、个人资料（标题栏的头像只预留位置）。
- 删除作品目录：“移出书架”只取消登记，删除文件留给文件管理器。
- 书名同步到已打开窗口的标题栏：窗口打开时从引导取一次显示名（[`runtime.browser-host`](../runtime/browser-host.md) 启动序列第 2 步），之后改书名要刷新才更新。
- 按统计状态筛选；封面裁剪。

## 术语与参与者

- **作品**：一个已登记的项目（[`runtime.projects`](../runtime/projects.md)）。
- **显示名**：书名，没有书名时用目录原名（[`runtime.projects`](../runtime/projects.md) 术语）；短名只用在地址栏。
- **新鲜度**：书架上一部作品的统计是不是最新的。
  - `fresh`：作品正在运行，统计完整；
  - `counting`：作品正在运行，还在统计，先显示上次的快照；
  - `stale`：作品没在运行，或在关闭后的宽限期里，显示的是某时刻的快照；宽限期里的快照最多比实际旧 30 秒；
  - `none`：从没统计过。
- **继续写作的目标**：所有作品里最近编辑时间最晚的那个文件。
- **作品目录**：新作品缺省放在哪（[`runtime.projects`](../runtime/projects.md) 第 19 条）。
- **三个去处**：提示放在哪（[`workbench.notifications`](notifications.md) 输出 1）。

## 输入与前置条件

- 页面：`nbook.projects` 的浏览器入口向工作台的 `workbench.home`（[`ui.workbench-shell`](../ui/workbench-shell.md) 外壳四之后的“无项目首页”）贡献书架页；只在没有绑定项目的窗口出现。同一个入口向设置窗口的 `settings.pages`（[`settings.window`](../settings/settings-window.md)）贡献“作品”分区。
- 数据：远程服务 `nbook.projects/projects` 的 `shelf()`，返回每部作品的登记项、作品信息、封面与统计摘要（形状见 [`runtime.projects`](../runtime/projects.md)）；`library()` 给出作品目录；`browse()` 列目录。
- 设置：作品目录 `nbook.projects/library`（user 层字符串，缺省空）；书架的视图与排序记在 user 分区的 `nbook.projects` / `shelf-preferences`（`locality: local`）。
- 通知经工作台的通知服务；命令经命令服务。
- 显示语言跟随配置（中英）。

## 输出与可观察行为

**页面**

1. 页面直接压在窗体底纹上，内容列至多 1120px 宽、居中；页面自身纵向滚动，没有横向滚动。顶部左边是品牌的标志 + 字标（跟随文字颜色）后接“· 书房”，右边一个齿轮按钮紧挨在一个头像位左边。齿轮经命令服务执行 `nbook.settings.toggle`，打开或关闭本页的设置窗口（[`settings.window`](../settings/settings-window.md)）；设置窗口开着时（公开状态 `nbook.settings/windowOpen`）画成按下：灰底、图标正文色，不用强调色。头像位只预留，不可点，提示“个人资料尚未开放”。切换主题、明暗与界面语言在命令面板、工作台的“视图”菜单与设置窗口里，作品目录在设置窗口的“作品”分区里改（输出 18）。
2. 案头（不给面）：
   - 统计：大字是今天写的字（所有给出今天数字的作品之和，减少时带负号），没有一部作品给出今天的数字时大字是总字数；下面一行总字数（大字是今天时）、篇数、作品数；有继续写作的目标时一个“继续写作《书名》”按钮。
   - 最近写到：各作品最近编辑的那个文件按时间取前三条，每条书名、片段名、时间与一行摘录；点一条按第 10 条继续写作。都没有编辑记录时写一句提示。
   - 看板娘：品牌成品的心情组件，`idle`（眼睛跟着鼠标）；系统设了减少动画时不动。
   - 书架为空时案头左边换成问候：“书架还是空的”与一句解释作品是一个文件夹。
3. 书架：标题行“书架 N 部”，右侧视图切换（卡片、列表）、排序（最近编辑、书名、字数）、“打开已有作品…”与“新建作品”。视图与排序记住，跨刷新保留。
4. 页面宽度不足 720px 时只用列表视图，视图切换不显示。

**卡片视图**

5. 每部作品一张卡：左边封面（84px 宽，2:3；有封面图用图，没有或图加载失败时按书名与作品色排一张：作品色作底、金色细线、书名居中），右边书名、两行简介（没有写“还没有简介”）、底部字数与篇数、最近编辑时间与新鲜度说明；正在打开的作品一个绿点加“已打开”；悬停或选中时出现“更多”（在新窗口打开、编辑信息、从书架移除）。作品色：作者指定了主题色就用它，没有时按 id 在作品色板的八色里取一色（与新建对话框的色板是同一组八色，不随主题与配色变化）。颜色只落在封面上，卡片不带色条。
6. 网格的列数随宽度（每列至少 300px）。网格是一个列表框：左右方向键移动选中，上下按列数跳一行，Home、End 到两端，Enter 打开选中的作品，Delete 请求移出书架；点卡片选中并打开；聚焦时没有选中就选第一部。有作品时网格的最后一格是一张“新建作品”占位（样式同第 7 条的那张），最后一行没排满时补在空位里；它是列表框的最后一个选项但不是作品：方向键或 End 走到它时不改选中，Enter 或点它开始新建，Delete 不起作用。
7. 书架为空时网格里是两张和书卡同样大小的“待写的书”：“新建作品”（封面位是加号，底行写新作品会放在哪个作品目录）与“打开已有作品”（封面位是文件夹）；不论视图都显示它们。

**列表视图**

8. 每部作品一行：30px 的封面、书名、一行简介、字数与篇数、最近编辑时间与新鲜度说明（`stale` 写“统计于某时”，`counting` 写“正在统计”，`none` 写“尚未统计”，正在打开的加“已打开”）；点行打开作品，行尾“更多”同第 5 条。列表的最后一行是“新建作品”，点它开始新建。

**动作**

9. 打开：整页导航到 `/?project=<短名>`。在新窗口打开：经宿主在新标签页打开同一地址；被浏览器拦截时发通知。
10. 继续写作：整页导航到 `/?project=<短名>&open=<地址>&at=end`，编辑器在那个文件的末尾放下光标（[`workbench.editor`](editor.md) 的“继续写作”）。
11. 新建作品：居中的模态对话框，打开时焦点在书名。左边封面位（没图时按当前书名与主题色实时排一张；“上传封面…”选 PNG、JPEG 或 WebP，至多 5 MB，本地先拒绝不合规的），封面下面是主题色（“自动”加八档色板加“自定义…”，改了封面立刻跟着变）；右边书名（必填）、简介、“保存位置”（目录输入框，初值是作品目录；由书名生成的文件夹名作为后缀实时显示；“浏览…”与输入框同高，开目录选择器）。提示都在标签旁的说明图标里。
    - 关闭：取消与 Esc 总是关闭；点对话框外的遮罩，没改过任何输入时关闭，改过之后不关（免得误点丢掉输入）。
    - 校验不在字段下插字（表单不重排）：书名空着或新建时没有保存位置，“新建”不可用；封面文件不合规时，原因写在对话框底部按钮左边的状态行。
    - 提交：先新建（`create`，带用户给的父目录）；成功后按对话框里的封面上传；用户改过位置时把它写进设置（写失败发通知，作品照常建成）；这两步都成功之后打开新作品（与点卡片打开相同，整页进入它的工作台）；有一步失败时留在书架上、新作品被选中，失败通知看得见。
    - 失败：服务端针对字段的拒绝（书名不合规、同名目录已存在、父目录不可用）把对应字段标红并把焦点移过去，原因写在状态行，对话框留着；别的失败（登记失败、结果未知）发通知。结果未知时按“写操作的结果未知”核对。
12. 打开已有作品：目录选择器（居中的模态对话框，打开时焦点在目录列表）从作品目录开始列子目录，标出作品（有身份文件，带书名）与已在书架上的（不能选）；输入路径（认 `~`）回车进入；选中一个目录后“加入书架”登记它，登记失败的原因写在选择器底部的状态行（替下“已选 …”）、输入保留；成功后出现在书架上并被选中。同一个选择器还有选目录模式（没选条目时就是当前目录），给新建对话框的“浏览…”与设置窗口“作品”分区的“更改…”（输出 18）用。从新建对话框的“浏览…”打开时选择器叠在新建对话框上面，Esc 与点遮罩只关选择器，焦点回到“浏览…”。
13. 编辑信息：同一个对话框（没有保存位置），关闭规则同第 11 条，改书名、简介、主题色与封面（换、移除）；保存后书架立即显示新值。失败同第 11 条。
14. 从书架移除：先确认（说明只取消登记、不删目录）；作品正在打开或在关闭宽限期内时发通知说明原因并不移除。移除后选中下一部（没有时上一部），焦点回到书架；书架空了时焦点到“新建作品”。

**取数与刷新**

15. 第一次取数期间显示骨架，骨架所在的区域带 `aria-busy="true"`；第一次取数失败显示原因与“重试”。
16. 页面可见时每 30 秒刷新一次，窗口重新获得焦点时也刷新，两者合并；同一时间至多一个请求在途，迟到的旧响应丢弃；页面隐藏或离开时停止。
17. 刷新失败保留上次的数据，发一条常驻通知“书架没有更新”（带原因与“重试”），再失败只换内容不堆第二条，刷新成功后收回；某部作品的统计取不到时只影响那一部，按 `stale` 或 `none` 显示。

**欢迎页**（作品打开之后的那一页，贡献到编辑器的页面贡献点 `editor.pages`，[workbench.editor](editor.md) 输出 33）

18. 内容：书名（显示名）、简介（没有时写“还没有简介”）与统计（字数 · 篇数，过时的带“统计于…”，还没统计写“尚未统计”，与书卡同一写法）；“开始”里是主按钮“新建章节”、快捷入口与“回到书架”；“最近打开”是编辑器的最近打开（[workbench.editor](editor.md) 输出 31）的前 5 个，写出所在目录，没有时一句“还没有打开过文件”；“入门”是三条固定提示，第二条带命令面板的快捷键。没有绑定项目的窗口只显示“没有打开作品”与“回到书架”。
19. 动作：“新建章节”在项目根建一个空的 Markdown 文件（`新章节.md`，同名已在时依次加 2、3）并以正式标签打开，失败时按钮下写出原因（文件建好了但打不开时写“建好了 X，但打不开”与原因）；快捷入口是项目根下名字以“大纲”“设定”开头的文件与文件夹（大纲在前，同类按名字），文件点了打开，文件夹点了在资源管理器里展开并选中（`nbook.files.reveal`）；最近打开点了打开；“回到书架”整页导航到 `/`。
20. 打开：作品第一次在本窗口打开时自动打开（声明 `openOnFirstVisit`）；之后经“帮助 > 欢迎”（命令 `nbook.help.welcome`，命令面板里同名）打开，窗口里只有一个欢迎页；刷新后不恢复。每次成为活动标签时重新取一次作品信息与项目根的列出；取完之前（成功或失败）欢迎页根上带 `aria-busy="true"`，这时的“还没有简介”只是缺省，不是结果。

**设置窗口的“作品”分区**

21. `nbook.projects` 向设置窗口贡献 page 分区 `nbook.works`：标题“作品”、图标 `i-lucide-library`、应用组、`order: 30`、column 页面、只在“用户”标签下可用（`layers: ["user"]`，“本作品”标签下左栏停用）。页面一行“作品目录”（`SettingsRow`）：控件是路径文字加“更改…”；没设时路径的位置是 `library()` 给出的缺省作品目录，后面标“（缺省）”（例如 `/home/writer/Documents/NeuroBook（缺省）`），恢复默认之后同样；`library()` 失败时写一句淡色的“取不到缺省目录”，“更改…”照常可用。
    - “更改…”打开输出 12 的目录选择器（选目录模式），起点是现在的作品目录，没设时是缺省的作品目录。选择器是模态对话框，叠在设置窗口上面；Esc 与取消只关选择器，焦点回到“更改…”。
    - 选定后经本插件的配置服务写进用户层（`update(librarySetting, 路径, {layer: "user"})`），写入结算之前显示这次选的目录；写不进去时发通知（标题同“作品目录没写进设置”），路径回到设置里的实际值。
    - 已修改、“恢复默认”、设置文件有错误或连不上时停用，同设置窗口的其它项（[`settings.window`](../settings/settings-window.md) 输出 10、13、18）。

## 状态与转换

| 当前 | 事件 | 下一状态 |
|---|---|---|
| 首次加载 | 取到 | 显示书架 |
| 首次加载 | 失败 | 整页出错，带重试 |
| 显示书架 | 刷新失败 | 保留数据，常驻通知“书架没有更新” |
| 显示书架 | 刷新成功 | 更新数据，通知收回 |
| 显示书架 | 选中的作品被移出或不在了 | 选中相邻的一部；没有作品时不选中 |

时序与寿命：

- 页面卸载或隐藏后不再发出刷新；卸载前在途的响应回来时不改变任何状态；卸载时收回自己发的常驻通知。
- 新建、修改信息、封面、移出书架、打开已有作品成功后立刻刷新一次；它们的结果以服务端为准，界面不先行修改数据。
- 写操作的结果未知（请求发出后连接中断或超时）时不盲目重试：重新取书架，按本次的目标核对——新建看本次父目录下由书名生成的目录（别的目录下的同名作品不算），修改信息看这部作品是否已是提交的值，移出看它是否已不在，打开已有作品看给的目录是否已在书架上；核对上按成功处理（移出仍选中相邻的一部），核对不上才提示结果未知。

## 副作用与数据

- 视图与排序写在 `shelf-preferences`（`{view, sort}`），每个客户端一份。`view` 的取值是 `cards`、`list`。
- 作品目录写在用户层配置 `nbook.projects/library`。
- 页面本身不写作品目录里的文件；新建、修改信息、封面、移出书架由服务端执行（[`runtime.projects`](../runtime/projects.md)）。

## 失败与恢复

| 情形 | 去处 |
|---|---|
| 首次取数失败 | 原位：整页显示原因与重试 |
| 刷新失败 | 通知（常驻，带重试） |
| 新建、修改信息：字段不合规、同名目录、父目录不可用 | 字段标红，原因在对话框底部的状态行 |
| 新建、修改信息：登记失败、结果未知 | 通知，对话框留着 |
| 封面上传或移除失败 | 通知（作品本身已建成或已保存） |
| 作品目录没写进设置（新建时，或设置窗口“作品”分区里） | 通知 |
| 打开已有作品：登记失败 | 选择器底部的状态行，输入保留 |
| 移出书架被拒（`project-running`） | 通知 |
| 新标签被拦截 | 通知 |
| 齿轮的命令执行失败 | 通知 |
| 继续写作的文件不在 | 项目照常打开，编辑器提示（[`workbench.editor`](editor.md)） |

## 边界与兼容

- 书架页只经 `nbook.projects/projects` 的远程服务取数与操作（封面经它的 HTTP 路由）；合同升级时旧页面得到 `version-changed`，按浏览器宿主的规则提示刷新。
- `/workbench` 与 `workbench.home` 由工作台定义（[`ui.workbench-shell`](../ui/workbench-shell.md)）；本页不放进入工作台的入口。

## 验收与 Smoke

1. Given 两部登记的作品，其中一部打开过并写过字，When 关闭全部窗口、等那部作品停止后打开 `/`，Then 书架显示两部作品，写过的那部有字数、片段与“统计于某时”，没打开过的写“尚未统计”；案头显示那部的最近写到与总字数。
2. Given 书架，When 点“继续写作”，Then 打开那部作品并在那个文件的末尾可以接着输入；刷新页面不再重新定位。
3. Given 作品目录没设，When 新建作品（不改位置）并上传封面，Then 封面传好后打开新作品（整页进入它的工作台），目录建在缺省作品目录下，回到书架时它的卡片显示封面；封面没传上时留在书架上、作品被选中、失败通知可见；同名目录已存在时书名字段标红、对话框底部提示改书名或打开已有作品，表单不重排。
4. Given 一部正在打开的作品，When 从书架移除，Then 被拒并发通知；关闭并等宽限期结束后移除成功，选中相邻的作品，目录还在。
5. Given 390 × 844 的窗口，When 打开书架，Then 只有列表视图，新鲜度说明可见，没有横向滚动。
6. Given 书架已显示，When 服务端暂时不可用导致刷新失败，Then 数据保留、右下角常驻通知并可重试，恢复后通知收回。
7. Given 一个已有的作品文件夹，When 经“打开已有作品”的选择器选中它并加入，Then 它出现在书架上并被选中；不存在的路径在选择器里提示原因。
8. Given 书架上有作品，When 点网格末尾或列表末行的“新建作品”，Then 打开新建作品的对话框；键盘在网格里按 End 再按 Enter 同样打开，选中的作品不变。
9. Given 新建作品的对话框，When 什么都没改就点遮罩，Then 对话框关闭；When 填了书名再点遮罩，Then 对话框不关；When 点“浏览…”，Then 目录选择器叠在新建对话框上面，按 Esc 只关选择器、焦点回到“浏览…”；When 打开主题色的“自定义…”，Then 取色面板显示在对话框之上、色相条可以拖动。

10. Given 带书名与简介、根下有 `大纲.md` 与 `设定/` 的作品，When 新客户端打开它，Then 欢迎页自动打开、是唯一的标签，书名、简介、统计行、“打开大纲”“打开设定”与入门都在，最近打开写“还没有打开过文件”；When 刷新，Then 欢迎页不恢复。
11. Given 欢迎页，When 点“新建章节”两次（中间切回欢迎页），Then 项目根先后多出 `新章节.md`、`新章节 2.md`，都以正式标签打开。
12. Given 欢迎页，When 点“打开大纲”，Then 大纲以标签打开、之后出现在最近打开里；When 点“打开设定”，Then 资源管理器里 `设定` 展开并选中；When 从“帮助”菜单点“欢迎”，Then 切回同一个欢迎页、标签不多出一个；When 点“回到书架”，Then 整页导航到书架页。
13. Given 书架，When 点右上角的齿轮，Then 打开设置窗口、齿轮按下；When 在“作品”分区点“更改…”，Then 目录选择器叠在设置窗口上面，按 Esc 只关选择器、焦点回到“更改…”；When 选定一个目录，Then 它写进用户层设置、分区显示这个路径；When 恢复默认，Then 键从设置里删掉、回到显示缺省作品目录并标“（缺省）”。

Smoke：`e2e/bookshelf.e2e.ts`（生产构建、真实服务端与项目子进程、本机 Chrome）；Lab 场景 `BookshelfPage`、`ShelfDesk`、`ShelfCards`、`BookCard`、`BookCover`、`ShelfList`、`ProjectInfoDialog`、`PathPickerDialog`、`WelcomePage`、`WorksSettingsPage`；欢迎页 `e2e/welcome.e2e.ts`。

## 实现合同

- **公开入口**：`nbook/plugins/projects/shared/contracts`（远程合同与 `ShelfItemSchema`、`librarySetting`）、`nbook/plugins/projects/shared/cover`（封面规则与地址）、`nbook/plugins/projects/shared/shelf`（界面类型与 `projectDisplayName`）、`nbook/plugins/projects/shared/project-url`（打开某个项目的地址 `projectUrl`，开发模式的样例作品也用它）；页面模型 `createShelfPage`（`web/shelf-page.ts`）与组件是 `nbook.projects` 的内部实现。
- **owner 与依赖方向**：书架页只经 `nbook.projects/projects` 的远程服务与封面路由取数与写入（[`runtime.projects`](../runtime/projects.md) 输出 17 到 21），用工作台的通知服务、首页贡献点 `workbench.home`、命令服务、公开状态（齿轮的按下态）与宿主的整页导航、新标签页、设置与 Storage（偏好记录）；“作品”分区经设置的贡献点 `settings.pages` 交给设置窗口，写作品目录用本插件自己的配置服务；书架页不引用编辑器，继续写作只经地址参数（[`workbench.editor`](editor.md) 输出 29）；欢迎页贡献到编辑器的页面贡献点 `editor.pages`，经命令打开文件（`nbook.editor.open`）、揭示文件夹（`nbook.files.reveal`）与打开页面（`nbook.editor.open-page`），只引用编辑器的共享合同。目录选择器用本插件的 `FileBrowser`（`web/components/FileBrowser.vue`），数据来源只有 `browse`（书架与“作品”分区共用 `web/browse.ts`）。
- **关键不变量**：
  - 同一时间至多一个书架请求在途，页面隐藏时不刷新，卸载后迟到的响应不改状态（验收 6 与状态表）。
  - 新建、修改信息、移出成功后以服务端的结果刷新，界面不先行改数据；移出后选中相邻的一部、焦点回到书架（验收 4）。
  - 首页贡献的组件不取布局 store；没有贡献或贡献多于一个时回到空工作台（[`ui.workbench-shell`](../ui/workbench-shell.md) 输出 36）。

## 证据

- 批准依据：齿轮代替设置菜单与“作品”分区（输出 1、12、21，验收 13）为 t80 计划（记录在主工作区 master 的 `.agents/works/w00017-application-runtime-architecture/tasks/t80-settings-ui/plan.md`）第 6 节，开发者 2026-10-12 批准；欢迎页（输出 18–20、验收 10–12）为 [t79 计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t79-workbench-polish/plan.md) 第 6 节，开发者 2026-10-12 确认；提案 [书架页](../../proposals/bookshelf.md)（开发者 2026-10-10 同意全部推荐；2026-10-11 改为卡片与列表、加封面与案头，见决策记录）；取舍见 [w00017 待确认清单](../../../.agents/works/w00017-application-runtime-architecture/pending-confirmations.md) 2026-10-10 的 t75 条目（按推荐先做，开发者 2026-10-14 整体追认）。
- 实现入口：[`web/shelf-page.ts`](../../../packages/neuro-book/src/plugins/projects/web/shelf-page.ts)（取数、刷新与动作）、[`web/bookshelf-home.ts`](../../../packages/neuro-book/src/plugins/projects/web/bookshelf-home.ts)、[`web/components/BookshelfHost.vue`](../../../packages/neuro-book/src/plugins/projects/web/components/BookshelfHost.vue)、[`web/components/BookshelfPage.vue`](../../../packages/neuro-book/src/plugins/projects/web/components/BookshelfPage.vue) 及同目录的案头、卡片、封面、列表、作品信息对话框与目录选择器组件、[`web/shelf-preferences.ts`](../../../packages/neuro-book/src/plugins/projects/web/shelf-preferences.ts)；“作品”分区 [`web/works-section.ts`](../../../packages/neuro-book/src/plugins/projects/web/works-section.ts)、[`web/components/WorksSettingsPage.vue`](../../../packages/neuro-book/src/plugins/projects/web/components/WorksSettingsPage.vue)、共用的列目录 [`web/browse.ts`](../../../packages/neuro-book/src/plugins/projects/web/browse.ts)；首页贡献点在工作台（[ui.workbench-shell](../ui/workbench-shell.md) 输出 36）
- 合同测试：欢迎页（输出 18–20）为 [`welcome-chapter.test.ts`](../../../packages/neuro-book/src/plugins/projects/welcome-chapter.test.ts)（新建章节：内存文件适配器与真实命令服务，名字避让、正式标签、打开失败的原因）、[`web/welcome.test.ts`](../../../packages/neuro-book/src/plugins/projects/web/welcome.test.ts)（快捷入口的筛选与次序、新章节的名字）、组件测试 `WelcomePage.dom.test.ts`、[`projects.test.ts`](../../../packages/neuro-book/src/plugins/projects/projects.test.ts) 的命令登记（`nbook.help.welcome`）；[`shelf-page.test.ts`](../../../packages/neuro-book/src/plugins/projects/shelf-page.test.ts)（输出 9 到 17 与状态表：真实服务端与浏览器实例、真实通知队列、注入时钟）、[`shelf-format.test.ts`](../../../packages/neuro-book/src/plugins/projects/web/shelf-format.test.ts)、组件测试 `BookshelfPage.dom.test.ts`（焦点交回书架）、`ShelfCards.dom.test.ts`、`ShelfDesk.dom.test.ts`、`ShelfList.dom.test.ts`、`ProjectInfoDialog.dom.test.ts`、`PathPickerDialog.dom.test.ts`、`WorksSettingsPage.dom.test.ts`（输出 21：没设时的缺省目录与取不到时的说明、选定后写进用户层、写不进去发通知并回到实际值、层不可写时停用）
- Smoke：欢迎页为 [`welcome.e2e.ts`](../../../packages/neuro-book/e2e/welcome.e2e.ts)（验收 10–12）；[`bookshelf.e2e.ts`](../../../packages/neuro-book/e2e/bookshelf.e2e.ts)（验收 1 的无统计部分、3、4、5、7、8、9、13）、[`bookshelf-stats.e2e.ts`](../../../packages/neuro-book/e2e/bookshelf-stats.e2e.ts)（验收 1、2）；验收 6 由 `shelf-page.test.ts` 的刷新失败一组覆盖；Lab 场景 `BookshelfPage` 等（[`lab:shot` 截图](../../../.agents/works/w00017-application-runtime-architecture/tasks/t76-bookshelf-polish/evidences/)）
