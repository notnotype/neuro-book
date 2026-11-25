/**
 * `nbook.projects` 的消息目录（docs/specs/ui/i18n.md 的“目录与键”）。
 *
 * 第一条防止迁移改错文字：`LEGACY` 是迁移前（提交 d2adbdd8e）代码里的双语字面量，按迁移后的键原样抄下，占位符还是旧的
 * `{name}` 写法。目录里的每个键都要在表里、表里的每个键都要在目录里，值换成 `{{name}}` 后逐字相同。有三处按设计偏离，
 * 各在下面单独列出并核对：数字参数改写成 `{{count, number}}`、两个拼好的数字串改名为 `amount`、登记失败的标题按失败码拆成整句
 * （旧代码是模板加原因两段拼的）；数量键英文的单数形另列在 `ENGLISH_ONE`。以后有意改文字时，同一次改动里同步改这张表。
 */

import {describe, expect, it} from "bun:test";

import {flattenCatalog} from "@notnotype/nb-ui/text";

import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";
import {projectsRemoteContract} from "./shared/contracts";
import {BUSINESS_FAILURE_KEYS, REGISTER_FAILURE_KEYS} from "./web/failure-text";
import {projectsCatalogs} from "./web/text";
import {descriptor} from "./plugin";

const LEGACY: Readonly<Record<string, {readonly "zh-CN": string; readonly "en-US": string}>> = {
    "settings.library.title": {"zh-CN": "作品目录", "en-US": "Library Folder"},
    "settings.library.description": {"zh-CN": "新建作品时默认放在这里", "en-US": "New works are created here by default"},
    "settings.startupOpen.title": {"zh-CN": "启动时打开", "en-US": "On Startup, Open"},
    "settings.startupOpen.description": {"zh-CN": "打开 NeuroBook 时直接进入的页面", "en-US": "What NeuroBook shows when it starts"},
    "settings.startupOpen.choices.last-work.title": {"zh-CN": "上次的作品", "en-US": "Last work"},
    "settings.startupOpen.choices.shelf.title": {"zh-CN": "书架", "en-US": "Bookshelf"},
    "commands.nbook.project.open.title": {"zh-CN": "打开项目", "en-US": "Open Project"},
    "commands.nbook.project.open.category": {"zh-CN": "项目", "en-US": "Project"},
    "commands.nbook.project.back-to-shelf.title": {"zh-CN": "回到书架", "en-US": "Back to Bookshelf"},
    "commands.nbook.project.back-to-shelf.category": {"zh-CN": "项目", "en-US": "Project"},
    "commands.nbook.help.welcome.title": {"zh-CN": "欢迎", "en-US": "Welcome"},
    "commands.nbook.help.welcome.category": {"zh-CN": "帮助", "en-US": "Help"},
    "home.bookshelf.title": {"zh-CN": "书架", "en-US": "Bookshelf"},
    "editorPages.welcome.title": {"zh-CN": "欢迎", "en-US": "Welcome"},
    "settingsPages.nbook.works.title": {"zh-CN": "作品", "en-US": "Books"},
    "open.title": {"zh-CN": "打开项目", "en-US": "Open Project"},
    "open.placeholder": {"zh-CN": "选择项目，或输入项目目录的路径", "en-US": "Pick a project, or type a project directory path"},
    "open.empty": {"zh-CN": "还没有登记的项目：输入目录路径来登记", "en-US": "No registered projects yet: type a directory path to register one"},
    "open.running": {"zh-CN": "{path} · 运行中", "en-US": "{path} · running"},
    "open.registerAndOpen": {"zh-CN": "登记并打开 {path}", "en-US": "Register and open {path}"},
    "open.listFailed": {"zh-CN": "列不出已登记的项目：{code}", "en-US": "Could not list registered projects: {code}"},
    "open.unknownOutcome": {"zh-CN": "登记结果未知，再试一次即可：{cause}", "en-US": "The registration outcome is unknown; try again: {cause}"},
    "open.notCompleted": {"zh-CN": "登记没有完成：{code}", "en-US": "The registration did not complete: {code}"},
    "registerFailures.invalid-path": {"zh-CN": "路径无效或不存在", "en-US": "the path is invalid or does not exist"},
    "registerFailures.not-directory": {"zh-CN": "不是目录", "en-US": "not a directory"},
    "registerFailures.not-accessible": {"zh-CN": "目录不可读写", "en-US": "the directory is not readable and writable"},
    "registerFailures.inside-state-root": {"zh-CN": "目录在应用的状态目录里", "en-US": "the directory is inside the application's state directory"},
    "registerFailures.identity-invalid": {"zh-CN": "目录里的项目身份文件无法读取", "en-US": "the project identity file in the directory cannot be read"},
    "registerFailures.identity-conflict": {"zh-CN": "与已登记的另一个项目冲突", "en-US": "conflicts with another registered project"},
    "registerFailures.registry-invalid": {"zh-CN": "项目登记表无法读取", "en-US": "the project registry cannot be read"},
    "registerFailures.write-failed": {"zh-CN": "写入失败", "en-US": "writing failed"},
    "shelf.shelfFailed": {"zh-CN": "书架没取到：{reason}", "en-US": "Could not load the shelf: {reason}"},
    "shelf.refreshFailedTitle": {"zh-CN": "书架没有更新", "en-US": "The shelf was not refreshed"},
    "shelf.refreshFailed": {"zh-CN": "取不到作品列表：{reason}。显示的是上次的数据。", "en-US": "Could not fetch the books: {reason}. Showing the last data."},
    "shelf.retry": {"zh-CN": "重试", "en-US": "Retry"},
    "shelf.libraryUnavailable": {"zh-CN": "取不到作品目录：{reason}", "en-US": "Could not read the library folder: {reason}"},
    "shelf.browseFailed": {"zh-CN": "列不出目录：{reason}", "en-US": "Could not list the folder: {reason}"},
    "shelf.registerFailed": {"zh-CN": "没有加入书架：{reason}", "en-US": "Not added to the shelf: {reason}"},
    "shelf.coverFailed": {"zh-CN": "封面没有保存：{reason}", "en-US": "The cover was not saved: {reason}"},
    "shelf.coverRemoveFailed": {"zh-CN": "封面没有移除：{reason}", "en-US": "The cover was not removed: {reason}"},
    "shelf.commandFailed": {"zh-CN": "没有执行：{reason}", "en-US": "Not executed: {reason}"},
    "shelf.popupBlockedTitle": {"zh-CN": "新标签页被拦截", "en-US": "New tab blocked"},
    "shelf.libraryNotSavedTitle": {"zh-CN": "作品目录没有记住", "en-US": "Library folder not saved"},
    "shelf.popupBlocked": {"zh-CN": "浏览器拦截了新标签页，请允许本站打开弹出窗口", "en-US": "The browser blocked the new tab; allow pop-ups for this site"},
    "shelf.libraryNotSaved": {"zh-CN": "作品已建成，但作品目录没有写进设置：{reason}", "en-US": "The book was created, but the library folder was not written to settings: {reason}"},
    "shelf.libraryChangeNotSaved": {"zh-CN": "作品目录没有写进设置：{reason}", "en-US": "The library folder was not written to settings: {reason}"},
    "shelf.createInvalid": {"zh-CN": "{field}不合规：{reason}", "en-US": "{field} is invalid: {reason}"},
    "shelf.createInvalidParent": {"zh-CN": "作品目录不可用：{reason}", "en-US": "The library folder cannot be used: {reason}"},
    "shelf.createExists": {"zh-CN": "同名目录已存在（{path}）：改个书名，或用“打开已有作品”", "en-US": "A folder with this name already exists ({path}): change the title, or use “Open an Existing Book”"},
    "shelf.createWriteFailed": {"zh-CN": "写不进作品目录：{reason}", "en-US": "Could not write into the library folder: {reason}"},
    "shelf.createRegisterFailed": {"zh-CN": "目录已建好（{path}），但登记失败：{reason}。可以用“打开已有作品”接着完成", "en-US": "The folder was created ({path}) but registration failed: {reason}. Use “Open an Existing Book” to finish"},
    "shelf.createUnknown": {"zh-CN": "新建的结果未知，书架已重新读取；没看到它就再试一次", "en-US": "The outcome is unknown; the shelf was reloaded. Try again if the book is missing"},
    "shelf.updateFailed": {"zh-CN": "没有保存：{reason}", "en-US": "Not saved: {reason}"},
    "shelf.updateUnknown": {"zh-CN": "保存的结果未知，书架已重新读取；显示的还是旧值就再试一次", "en-US": "The outcome is unknown; the shelf was reloaded. Try again if the old values are still shown"},
    "shelf.removeRunning": {"zh-CN": "这部作品正在打开，或在关闭后的宽限期里；关闭它的全部窗口、等几分钟后再移除", "en-US": "This book is open, or still within the grace period after closing; close all its windows and try again in a few minutes"},
    "shelf.removeFailed": {"zh-CN": "没有移出书架：{reason}", "en-US": "Not removed from the shelf: {reason}"},
    "shelf.fields.title": {"zh-CN": "书名", "en-US": "The title"},
    "shelf.fields.description": {"zh-CN": "简介", "en-US": "The description"},
    "shelf.fields.color": {"zh-CN": "主题色", "en-US": "The color"},
    "shelf.fields.cover": {"zh-CN": "封面", "en-US": "The cover"},
    "errors.unknown-project": {"zh-CN": "作品已不在书架上", "en-US": "the book is no longer on the shelf"},
    "errors.read-only": {"zh-CN": "作品的身份文件只读", "en-US": "the book's identity file is read-only"},
    "errors.identity-invalid": {"zh-CN": "作品的身份文件无法读取", "en-US": "the book's identity file cannot be read"},
    "errors.identity-conflict": {"zh-CN": "作品目录里的身份与登记不一致", "en-US": "the identity in the folder does not match the registry"},
    "format.words": {"zh-CN": "{count} 字", "en-US": "{count} words"},
    "format.wordsTenThousand": {"zh-CN": "{count} 万字", "en-US": "{count}k words"},
    "format.files": {"zh-CN": "{count} 篇", "en-US": "{count} files"},
    "format.books": {"zh-CN": "{count} 部作品", "en-US": "{count} books"},
    "format.today": {"zh-CN": "今天 {count} 字", "en-US": "{count} today"},
    "format.todayAt": {"zh-CN": "今天 {time}", "en-US": "Today {time}"},
    "format.yesterdayAt": {"zh-CN": "昨天 {time}", "en-US": "Yesterday {time}"},
    "welcome.chapterName": {"zh-CN": "新章节", "en-US": "New Chapter"},
    "welcome.createFailed": {"zh-CN": "新建章节失败：{reason}", "en-US": "Could not create a chapter: {reason}"},
    "welcome.openFailed": {"zh-CN": "建好了 {name}，但打不开：{reason}", "en-US": "Created {name}, but could not open it: {reason}"},
    "bookCard.more": {"zh-CN": "更多操作", "en-US": "More Actions"},
    "bookCard.openNewWindow": {"zh-CN": "在新窗口打开", "en-US": "Open in New Window"},
    "bookCard.edit": {"zh-CN": "编辑信息", "en-US": "Edit Info"},
    "bookCard.remove": {"zh-CN": "从书架移除", "en-US": "Remove from Shelf"},
    "bookCard.running": {"zh-CN": "已打开", "en-US": "Open"},
    "bookCard.none": {"zh-CN": "尚未统计", "en-US": "Not counted yet"},
    "bookCard.noDescription": {"zh-CN": "还没有简介", "en-US": "No description yet"},
    "bookCard.stale": {"zh-CN": "统计于{when}", "en-US": "Counted {when}"},
    "bookCard.counting": {"zh-CN": "正在统计", "en-US": "Counting"},
    "bookshelfHost.removeTitle": {"zh-CN": "从书架移除《{title}》？", "en-US": "Remove “{title}” from the shelf?"},
    "bookshelfHost.removeDescription": {"zh-CN": "只取消登记，不删除作品目录与其中的文件；以后可以再加入书架。", "en-US": "Only the registration is removed; the folder and its files stay. You can add it back later."},
    "bookshelfHost.remove": {"zh-CN": "移除", "en-US": "Remove"},
    "bookshelfHost.cancel": {"zh-CN": "取消", "en-US": "Cancel"},
    "bookshelfPage.brand": {"zh-CN": "书房", "en-US": "Study"},
    "bookshelfPage.settings": {"zh-CN": "设置", "en-US": "Settings"},
    "bookshelfPage.profile": {"zh-CN": "个人资料尚未开放", "en-US": "Profile is not available yet"},
    "bookshelfPage.shelf": {"zh-CN": "书架", "en-US": "Bookshelf"},
    "bookshelfPage.count": {"zh-CN": "{count} 部", "en-US": "{count} books"},
    "bookshelfPage.view": {"zh-CN": "视图", "en-US": "View"},
    "bookshelfPage.cards": {"zh-CN": "卡片", "en-US": "Cards"},
    "bookshelfPage.list": {"zh-CN": "列表", "en-US": "List"},
    "bookshelfPage.sort": {"zh-CN": "排序", "en-US": "Sort"},
    "bookshelfPage.recent": {"zh-CN": "最近编辑", "en-US": "Recently Edited"},
    "bookshelfPage.title": {"zh-CN": "书名", "en-US": "Title"},
    "bookshelfPage.words": {"zh-CN": "字数", "en-US": "Word Count"},
    "bookshelfPage.create": {"zh-CN": "新建作品", "en-US": "New Book"},
    "bookshelfPage.addExisting": {"zh-CN": "打开已有作品…", "en-US": "Open Existing…"},
    "bookshelfPage.retry": {"zh-CN": "重试", "en-US": "Retry"},
    "bookshelfPage.loading": {"zh-CN": "正在读取书架…", "en-US": "Loading the bookshelf…"},
    "pathPicker.projectTitle": {"zh-CN": "打开已有作品", "en-US": "Open an Existing Book"},
    "pathPicker.projectHint": {"zh-CN": "作品文件夹里有 .nbook 目录；选别的文件夹也可以，会作为新作品登记。", "en-US": "A book folder has a .nbook directory inside; any other folder can be registered as a new book."},
    "pathPicker.directoryTitle": {"zh-CN": "选择作品目录", "en-US": "Choose the Library Folder"},
    "pathPicker.directoryHint": {"zh-CN": "新建的作品都放在这个目录下；不存在的目录会在新建时建出来。", "en-US": "New books are created inside this folder; it is created on first use if missing."},
    "pathPicker.typePath": {"zh-CN": "输入路径", "en-US": "Type a path"},
    "pathPicker.pathPlaceholder": {"zh-CN": "目录路径，回车进入；认 ~", "en-US": "Directory path, Enter to go; ~ is accepted"},
    "pathPicker.registered": {"zh-CN": "已在书架上", "en-US": "Already on the shelf"},
    "pathPicker.project": {"zh-CN": "作品", "en-US": "Book"},
    "pathPicker.projectTitled": {"zh-CN": "作品 · {title}", "en-US": "Book · {title}"},
    "pathPicker.empty": {"zh-CN": "这里没有子目录", "en-US": "No subfolders here"},
    "pathPicker.up": {"zh-CN": "上一级", "en-US": "Up"},
    "pathPicker.selectedProject": {"zh-CN": "已选 {name} · {title}", "en-US": "Selected {name} · {title}"},
    "pathPicker.selected": {"zh-CN": "已选 {name}", "en-US": "Selected {name}"},
    "pathPicker.current": {"zh-CN": "用这个目录：{path}", "en-US": "Use this folder: {path}"},
    "pathPicker.none": {"zh-CN": "选一个文件夹", "en-US": "Choose a folder"},
    "pathPicker.cancel": {"zh-CN": "取消", "en-US": "Cancel"},
    "pathPicker.add": {"zh-CN": "加入书架", "en-US": "Add to Shelf"},
    "pathPicker.choose": {"zh-CN": "选定", "en-US": "Choose"},
    "pathPicker.info": {"zh-CN": "说明", "en-US": "About"},
    "projectInfo.createTitle": {"zh-CN": "新建作品", "en-US": "New Book"},
    "projectInfo.editTitle": {"zh-CN": "编辑作品信息", "en-US": "Edit Book Info"},
    "projectInfo.title": {"zh-CN": "书名", "en-US": "Title"},
    "projectInfo.description": {"zh-CN": "简介", "en-US": "Description"},
    "projectInfo.descriptionPlaceholder": {"zh-CN": "一两句话，显示在卡片与列表里", "en-US": "A sentence or two, shown on the shelf"},
    "projectInfo.color": {"zh-CN": "主题色", "en-US": "Color"},
    "projectInfo.colorHint": {"zh-CN": "没有封面时用它排一张封面；有封面时用于列表里的小标记。", "en-US": "Used for the typeset cover when there is no image, and as the color mark in lists."},
    "projectInfo.auto": {"zh-CN": "自动", "en-US": "Auto"},
    "projectInfo.custom": {"zh-CN": "自定义", "en-US": "Custom"},
    "projectInfo.location": {"zh-CN": "保存位置", "en-US": "Save to"},
    "projectInfo.locationHint": {"zh-CN": "作品是一个文件夹，建在这个目录下，文件夹名由书名生成；目录不存在会一并创建。", "en-US": "A book is a folder created inside this directory and named after the title; the directory is created if missing."},
    "projectInfo.browse": {"zh-CN": "浏览…", "en-US": "Browse…"},
    "projectInfo.uploadCover": {"zh-CN": "上传封面…", "en-US": "Upload cover…"},
    "projectInfo.replaceCover": {"zh-CN": "换封面…", "en-US": "Replace cover…"},
    "projectInfo.removeCover": {"zh-CN": "移除封面", "en-US": "Remove cover"},
    "projectInfo.coverHint": {"zh-CN": "PNG、JPEG 或 WebP，至多 5 MB；没有封面时用书名和主题色排一张，以后随时能换。", "en-US": "PNG, JPEG or WebP up to 5 MB; without one, a cover is typeset from the title and color."},
    "projectInfo.coverTooLarge": {"zh-CN": "封面至多 5 MB", "en-US": "The cover must be at most 5 MB"},
    "projectInfo.coverType": {"zh-CN": "只收 PNG、JPEG 或 WebP", "en-US": "Only PNG, JPEG or WebP"},
    "projectInfo.create": {"zh-CN": "新建", "en-US": "Create"},
    "projectInfo.save": {"zh-CN": "保存", "en-US": "Save"},
    "projectInfo.cancel": {"zh-CN": "取消", "en-US": "Cancel"},
    "projectInfo.coverInfo": {"zh-CN": "封面说明", "en-US": "About covers"},
    "projectInfo.colorInfo": {"zh-CN": "主题色说明", "en-US": "About the color"},
    "projectInfo.locationInfo": {"zh-CN": "保存位置说明", "en-US": "About the location"},
    "shelfCards.label": {"zh-CN": "书架", "en-US": "Bookshelf"},
    "shelfCards.create": {"zh-CN": "新建作品", "en-US": "New Book"},
    "shelfCards.createText": {"zh-CN": "起一个书名，NeuroBook 会在作品目录里为它建一个文件夹。", "en-US": "Give it a title and NeuroBook creates a folder for it in your library."},
    "shelfCards.createWhere": {"zh-CN": "放在 {library}", "en-US": "In {library}"},
    "shelfCards.open": {"zh-CN": "打开已有作品", "en-US": "Open an Existing Book"},
    "shelfCards.openText": {"zh-CN": "把已经写了一些的作品文件夹（例如从别的电脑同步来的）加到书架上。", "en-US": "Add a book folder you already have, for example one synced from another computer."},
    "shelfCards.openWhere": {"zh-CN": "选一个文件夹", "en-US": "Choose a folder"},
    "shelfDesk.label": {"zh-CN": "案头", "en-US": "Desk"},
    "shelfDesk.todayLabel": {"zh-CN": "今天写了字", "en-US": "words today"},
    "shelfDesk.totalLabel": {"zh-CN": "共写了字", "en-US": "words in all"},
    "shelfDesk.total": {"zh-CN": "共 {words}", "en-US": "{words} in total"},
    "shelfDesk.continueBook": {"zh-CN": "继续写作《{title}》", "en-US": "Continue “{title}”"},
    "shelfDesk.recent": {"zh-CN": "最近写到", "en-US": "Recently Written"},
    "shelfDesk.noRecord": {"zh-CN": "打开一部作品写几个字，这里会记下你写到哪了。", "en-US": "Open a book and write a little; what you wrote last shows up here."},
    "shelfDesk.emptyTitle": {"zh-CN": "书架还是空的", "en-US": "The shelf is empty"},
    "shelfDesk.emptyLead": {"zh-CN": "在 NeuroBook 里，一部作品就是你电脑上的一个文件夹：章节、设定都是里面的 Markdown 文件，随时可以备份、同步，或者用别的编辑器打开。", "en-US": "In NeuroBook a book is a folder on your computer: chapters and notes are Markdown files inside it, so you can back it up, sync it, or open it in any editor."},
    "shelfList.label": {"zh-CN": "作品列表", "en-US": "Books"},
    "shelfList.create": {"zh-CN": "新建作品", "en-US": "New Book"},
    "shelfList.more": {"zh-CN": "更多操作", "en-US": "More Actions"},
    "shelfList.openNewWindow": {"zh-CN": "在新窗口打开", "en-US": "Open in New Window"},
    "shelfList.edit": {"zh-CN": "编辑信息", "en-US": "Edit Info"},
    "shelfList.remove": {"zh-CN": "从书架移除", "en-US": "Remove from Shelf"},
    "shelfList.running": {"zh-CN": "已打开", "en-US": "Open"},
    "shelfList.none": {"zh-CN": "尚未统计", "en-US": "Not counted yet"},
    "shelfList.stale": {"zh-CN": "统计于{when}", "en-US": "Counted {when}"},
    "shelfList.counting": {"zh-CN": "正在统计", "en-US": "Counting"},
    "welcomePage.noProject": {"zh-CN": "没有打开作品", "en-US": "No work is open"},
    "welcomePage.noDescription": {"zh-CN": "还没有简介", "en-US": "No description yet"},
    "welcomePage.none": {"zh-CN": "尚未统计", "en-US": "Not counted yet"},
    "welcomePage.stale": {"zh-CN": "统计于{when}", "en-US": "Counted {when}"},
    "welcomePage.start": {"zh-CN": "开始", "en-US": "Start"},
    "welcomePage.newChapter": {"zh-CN": "新建章节", "en-US": "New Chapter"},
    "welcomePage.open": {"zh-CN": "打开{name}", "en-US": "Open {name}"},
    "welcomePage.shelf": {"zh-CN": "回到书架", "en-US": "Back to Bookshelf"},
    "welcomePage.recent": {"zh-CN": "最近打开", "en-US": "Recent"},
    "welcomePage.noRecent": {"zh-CN": "还没有打开过文件", "en-US": "No files opened yet"},
    "welcomePage.intro": {"zh-CN": "入门", "en-US": "Getting Started"},
    "welcomePage.tipFiles": {"zh-CN": "章节就是作品目录里的 Markdown 文件，在左边的资源管理器里新建、改名、拖动。", "en-US": "Chapters are Markdown files in the work's folder; create, rename and drag them in the explorer on the left."},
    "welcomePage.tipCommands": {"zh-CN": "打开命令面板，所有操作都能在这里搜到。", "en-US": "opens the command palette, where every action can be found."},
    "welcomePage.tipCommandsPlain": {"zh-CN": "命令面板里能搜到所有操作。", "en-US": "Every action can be found in the command palette."},
    "welcomePage.tipLayout": {"zh-CN": "右上角的三个开关打开侧栏、底部面板与右侧栏，插件的视图会出现在那里。", "en-US": "The three switches at the top right open the sidebar, the bottom panel and the right sidebar, where plugin views appear."},
    "worksSettings.change": {"zh-CN": "更改…", "en-US": "Change…"},
    "worksSettings.defaultMark": {"zh-CN": "（缺省）", "en-US": " (default)"},
    "worksSettings.defaultUnknown": {"zh-CN": "取不到缺省目录", "en-US": "Could not read the default folder"},
    "worksSettings.startupNotSavedTitle": {"zh-CN": "启动时打开没有记住", "en-US": "Startup choice not saved"},
    "worksSettings.startupNotSaved": {"zh-CN": "启动时打开没有写进设置：{reason}", "en-US": "The startup choice was not written to settings: {reason}"},
};

/** 迁移前的登记失败标题模板（`MESSAGES.retryTitle`），`{reason}` 是按失败码取的原因。 */
const LEGACY_RETRY_TITLE = {"zh-CN": "打开项目：登记失败（{reason}）", "en-US": "Open Project: registration failed ({reason})"} as const;

/**
 * 数量键英文的单数形（`_one`）：旧英文不分单复数（`{count} items`），迁移时两形抄成一样；w00028 t03 审查第 9 条改成正确的
 * 单数，这里逐字列出。单复数写法本来就相同的键英文只写不带后缀的键，不在这里。
 */
const ENGLISH_ONE: Readonly<Record<string, string>> = {
    "format.words_one": "{count} word",
    "format.files_one": "{count} file",
    "format.books_one": "{count} book",
    "bookshelfPage.count_one": "{count} book",
};

const CATALOGS = {"zh-CN": zhCN, "en-US": enUS} as const;

/** 数字参数：旧代码传格式化好的字符串，现在传数字、由目录里的 `{{count, number}}` 加千分位并取复数形。 */
const NUMBER_KEYS = new Set(["format.words", "format.files", "format.books"]);
/** 旧代码拼好数字串再代入 `{count}`；现在参数改名 `amount`，因为 `count` 必须是数字（会触发复数）。 */
const AMOUNT_KEYS = new Set(["format.wordsTenThousand", "format.today"]);
/** 登记失败标题：按失败码拆成整句，不在旧表里，由 `LEGACY_RETRY_TITLE` 与 `registerFailures` 组合核对。 */
const RETRY_PREFIX = "open.retryTitle.";

/** 复数形 `<键>_<类别>` 归到 `<键>`。 */
const baseKey = (key: string): string => key.replace(/_(?:zero|one|two|few|many|other)$/u, "");

/** 旧字面量在目录里应有的写法。 */
function expected(key: string, legacy: string): string {
    const converted = legacy.replace(/\{(\w+)\}/gu, "{{$1}}");
    if (NUMBER_KEYS.has(key)) return converted.replace("{{count}}", "{{count, number}}");
    if (AMOUNT_KEYS.has(key)) return converted.replace("{{count}}", "{{amount}}");
    return converted;
}

describe("nbook.projects 的目录", () => {
    it("命名空间是插件 id，目录登记的源语言是 zh-CN", () => {
        expect(descriptor.id).toBe("nbook.projects");
        expect(projectsCatalogs.source).toBe("zh-CN");
    });

    it("每个键的文字与迁移前的字面量逐字相同（占位符从 {name} 换成 {{name}}，数字与金额参数按设计改写），两边的键一一对应", () => {
        for (const [locale, catalog] of Object.entries(CATALOGS)) {
            const flat = flattenCatalog(catalog);
            const keys = [...new Set(Object.keys(flat).map(baseKey))].filter((key) => !key.startsWith(RETRY_PREFIX)).sort();
            expect({locale, keys}).toEqual({locale, keys: Object.keys(LEGACY).sort()});
            for (const [key, value] of Object.entries(flat)) {
                if (key.startsWith(RETRY_PREFIX)) continue;
                const legacy = (locale === "en-US" ? ENGLISH_ONE[key] : undefined) ?? LEGACY[baseKey(key)]![locale as keyof typeof CATALOGS];
                expect({locale, key, value}).toEqual({locale, key, value: expected(baseKey(key), legacy)});
            }
        }
    });

    it("登记失败的标题：每个失败码一句整句，等于旧模板代入该码的原因；不认识的码用 unknown 一句", () => {
        for (const [locale, catalog] of Object.entries(CATALOGS)) {
            const flat = flattenCatalog(catalog);
            const template = LEGACY_RETRY_TITLE[locale as keyof typeof CATALOGS];
            const codes = Object.keys(REGISTER_FAILURE_KEYS);
            expect({locale, titles: Object.keys(flat).filter((key) => key.startsWith(RETRY_PREFIX)).sort()}).toEqual({locale, titles: [...codes.map((code) => `${RETRY_PREFIX}${code}`), `${RETRY_PREFIX}unknown`].sort()});
            for (const code of codes) {
                const reason = LEGACY[`registerFailures.${code}`]![locale as keyof typeof CATALOGS];
                expect({locale, code, title: flat[`${RETRY_PREFIX}${code}`]}).toEqual({locale, code, title: template.replace("{reason}", reason)});
            }
            expect(flat[`${RETRY_PREFIX}unknown`]).toBe(template.replace("{reason}", "{{reason}}"));
        }
    });

    it("数量键：中文有 _other，英文有 _one 与 _other", () => {
        const flatZh = Object.keys(flattenCatalog(zhCN));
        const flatEn = Object.keys(flattenCatalog(enUS));
        for (const key of ["format.words", "format.files", "format.books", "bookshelfPage.count"]) {
            expect(flatZh.filter((candidate) => baseKey(candidate) === key)).toEqual([`${key}_other`]);
            expect(flatEn.filter((candidate) => baseKey(candidate) === key)).toEqual([`${key}_one`, `${key}_other`]);
        }
    });

    it("失败码表与目录对得上：表里的键都在目录里、目录里这几组恰好是表的键", () => {
        const flat = flattenCatalog(zhCN);
        const under = (group: string): string[] => Object.keys(flat).filter((key) => key.startsWith(`${group}.`)).map((key) => key.slice(group.length + 1)).sort();
        expect(under("registerFailures")).toEqual(Object.keys(REGISTER_FAILURE_KEYS).sort());
        expect(under("errors")).toEqual(Object.keys(BUSINESS_FAILURE_KEYS).sort());
        for (const key of [...Object.values(REGISTER_FAILURE_KEYS), ...Object.values(BUSINESS_FAILURE_KEYS)]) expect(Object.keys(flat)).toContain(key);
    });

    it("errors 下的每个码都是 nbook.projects/projects 合同里某个方法声明的业务失败码", () => {
        const declared = new Set(Object.values(projectsRemoteContract.methods).flatMap((method) => Object.keys((method as {readonly errors?: Readonly<Record<string, unknown>>}).errors ?? {})));
        for (const code of Object.keys(BUSINESS_FAILURE_KEYS)) expect(declared.has(code)).toBe(true);
    });
});
