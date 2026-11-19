/*
 * 稿子用的数据：2026-10-12 13:40（BST）在本机现读的快照，首页、Task 页与命令行页共用这一份。
 * 来源：git worktree list、git rev-list --left-right --count、git status --porcelain、git log --all、
 * ps 与 /proc/<pid>/cwd、ss -ltnp、各 checkout 里 .agents/works 下的 README、.local/agent/、
 * t80 omp 审查的会话临时目录。凡是 demo:true 的条目是“示例”，本机没有对应的真实数据。
 */
window.PANEL = {
    snapshot: "2026-10-12 13:40",
    repoRoot: "/home/<user>/CodeRepository/neuro-book",

    /* 等你处理：按“要你做的事”排序，同类合并 */
    inbox: [
        {
            kind: "report",
            kindLabel: "审查报告",
            tone: "warning",
            icon: "clipboard-check",
            title: "t80 设置界面 · omp 实现审查",
            work: "w00017",
            task: "t80",
            summary: "1 条没处理：C1 窗口关闭后迟到的 page 加载结果仍被缓存并在重开时复用",
            meta: ["重要 1", "审查仍在跑 1:57 / 3h", "报告 13:18 更新"],
            note: "报告在会话临时目录 /tmp/claude-1000/…/scratchpad/t80-review/report.md，重启就丢",
            action: "逐条处理",
            href: "task.html#report",
        },
        {
            kind: "page",
            kindLabel: "讲解页",
            tone: "accent",
            icon: "presentation",
            title: "w00022 t03 · 面板与命令行第一轮静态稿",
            work: "w00022",
            task: "t03",
            summary: "5 个问题待定：首页版式、导航入口、Task 页的内容、讲解页组件、命令行输出",
            meta: ["没答复", "13:40 发布"],
            action: "打开",
            href: "../index.html",
        },
        {
            kind: "conflict",
            kindLabel: "编号",
            tone: "danger",
            icon: "hash",
            title: "w00017 的 t80、t81 只登记在分支上",
            work: "w00017",
            summary: "主线 refactor/w00017-runtime-foundation 的 Task 表到 t79 为止；t80 登记在 t80/settings-ui，t81 在 t81/nb-ui-fixes。主线上的会话再建 Task 会取到 t80",
            meta: ["领号前核对", "从三个分支的 .agents/works 扫出"],
            action: "查看",
            href: "#",
        },
        {
            kind: "suggestion",
            kindLabel: "回写建议",
            tone: "neutral",
            icon: "lightbulb",
            demo: true,
            title: "omp 审查的会话目录与报告改放 .local/agent",
            summary: "全局规则里的 omp 启动模板仍把 --session-dir 指向会话临时目录，和 t02 的本地目录规则不一致；建议改模板",
            meta: ["task-reflection", "目标：~/.agent/AGENTS.md"],
            action: "批准或驳回",
            href: "#",
        },
    ],

    /* 进行中的 Task：最近 7 天有提交、有未提交改动或有进程在跑的 checkout 所对应的 Task */
    tasks: [
        {
            work: "w00017", task: "t79-workbench-polish", short: "t79",
            title: "工作台打磨：打开项目之后的那一页",
            checkout: ".worktree/w00017-runtime-foundation", branch: "refactor/w00017-runtime-foundation", head: "929fcf9a",
            base: "master", ahead: 397, behind: 7, dirty: 0, untracked: 0,
            last: "13:36", lastRel: "4 分钟前", lastWhat: "feat(t79): S5 欢迎页——编辑器页面标签…",
            running: ["开发服务 :4217", "开发服务 :4317"],
            inferred: "Task 从最近提交标题的 (t79) 推断：这个 checkout 是 w00017 主线，t78、t79 都在这里做",
        },
        {
            work: "w00022", task: "t03-design", short: "t03",
            title: "面板与命令行的设计",
            checkout: "主工作区", branch: "master", head: "da4daefd",
            base: "origin/master", ahead: 0, behind: 0, dirty: null,
            last: "13:35", lastRel: "5 分钟前", lastWhat: "docs(w00022): t03 面板与命令行的设计开工…",
            running: [], pages: 1,
        },
        {
            work: "w00017", task: "t80-settings-ui", short: "t80",
            title: "设置界面：nbook.settings 的界面与贡献点",
            checkout: ".worktree/w00017-t80-settings-ui", branch: "t80/settings-ui", head: "4c7cf930",
            base: "w00017 主线", ahead: 12, behind: 4, dirty: 0, untracked: 0,
            last: "13:30", lastRel: "10 分钟前", lastWhat: "docs(t80): 评审板与截图改指 .local/agent 下的新位置",
            running: ["omp 审查 1:57"], extraCheckouts: 2, inbox: 1,
        },
        {
            work: "w00017", task: "t81-nb-ui-text-size-segmented", short: "t81",
            title: "nb-ui：字号写法被编译成颜色、分段控件截断长选项",
            checkout: ".worktree/w00017-t81-nb-ui", branch: "t81/nb-ui-fixes", head: "78cf9283",
            base: "w00017 主线", ahead: 5, behind: 2, dirty: 0, untracked: 0,
            last: "13:30", lastRel: "10 分钟前", lastWhat: "docs(t81): 截图改指 .local/agent 下的新位置",
            running: [],
        },
        {
            work: "w00005", task: "t34-v9-100ch", short: "t34",
            title: "V9 图在 100 章上和全读比",
            checkout: ".worktree/w00005-novel-understanding-spike", branch: "feat/w00005-v6-ingest-viewer", head: "ee7157c9",
            base: "master", ahead: 19, behind: 448, dirty: 68, untracked: 52,
            last: "09-11", lastRel: "提交 4 周前；运行产物 13:35", lastWhat: "context-after-ch035.md（运行产物，未提交）",
            running: ["抽取 35 / 100 章"],
        },
        {
            work: "w00002", task: "t20-harness-runtime-extension", short: "t20",
            title: "nb-harness 运行期更换、提问通道与插件扩展点",
            checkout: ".worktree/w00002-neuro-agent-harness-redesign", branch: "feat/w00002-harness-kernel", head: "5f8bf5e6",
            base: "master", ahead: 407, behind: 6, dirty: 0, untracked: 0,
            last: "昨天 18:58", lastRel: "19 小时前", lastWhat: "fix(nb-harness): t20 处理 omp 实现审查 6 条…",
            running: [],
        },
        {
            work: "w00021", task: "t01-design-and-research", short: "t01",
            title: "智能输入法 Spike：设计与调研（另有 t02 码字编辑器体验版）",
            checkout: ".worktree/w00021-smart-ime-spike", branch: "feat/w00021-smart-ime-spike", head: "2aaa69ed",
            base: "master", ahead: 30, behind: 6, dirty: 83, untracked: 35,
            last: "10-07", lastRel: "5 天前（文件）", lastWhat: "未提交的改动，最后改在 t01 README 与 packages/nb-ime",
            running: [],
        },
        {
            work: "w00019", task: "t07–t09", short: "t07–t09",
            title: "Agent 对话视图：提示词编辑器、Lab 治理、输入框",
            checkout: "主工作区", branch: "master", head: "da4daefd",
            base: "origin/master", ahead: 0, behind: 0, dirty: 121, untracked: 28,
            last: "10-02", lastRel: "10 天前（文件）", lastWhat: "未提交；96 个在 packages/neuro-book/app",
            running: [], warn: "代码改动在主工作区，未提交",
        },
    ],

    /* 正在跑的东西：ps、/proc/<pid>/cwd 与 ss -ltnp */
    running: [
        {
            kind: "omp", label: "omp 审查 · t80", pid: 1943024, elapsed: "1:57:01", limit: "3h",
            checkout: ".worktree/w00017-t80-review", task: "w00017 t80",
            log: "会话日志 13:34 仍在写", growing: true, out: "report.md 1 条",
        },
        {
            kind: "job", label: "抽取 · t34 V9 100 章", pid: 1991184, elapsed: "1:30:36",
            checkout: ".worktree/w00005-novel-understanding-spike", task: "w00005 t34",
            log: "run-med-100.log 13:35 仍在写", growing: true, out: "第 35 / 100 章",
        },
        {
            kind: "dev", label: "开发服务", pid: 2055067, elapsed: "36:18", port: 4317,
            checkout: ".worktree/w00017-runtime-foundation", task: "w00017 t79",
            log: "日志在 Claude 会话 c38df555 的临时目录 dev2/dev.log", growing: true, out: "Lab 127.0.0.1:4317/lab",
        },
        {
            kind: "dev", label: "开发服务", pid: 617900, elapsed: "1 天 0:33", port: 4217,
            checkout: ".worktree/w00017-runtime-foundation", task: "（归属不明）",
            log: "从终端 pts/8 起，输出没有落盘", growing: null, out: "Lab 127.0.0.1:4217/lab", stale: true,
        },
        {
            kind: "omp", label: "omp 交互会话", pid: 1274375, elapsed: "10:44:07",
            checkout: "/tmp（不在任何 checkout）", task: "（归属不明）",
            log: "—", growing: null, out: "",
        },
    ],

    /* 最近的变化：git log --all 与 .local/agent、报告文件的修改时间 */
    changes: [
        {t: "13:36", kind: "commit", ref: "refactor/w00017-runtime-foundation", hash: "929fcf9a", text: "feat(t79): S5 欢迎页——编辑器页面标签、新作品第一次打开时自动打开", task: "w00017 t79"},
        {t: "13:35", kind: "commit", ref: "master", hash: "da4daefd", text: "docs(w00022): t03 面板与命令行的设计开工", task: "w00022 t03"},
        {t: "13:35", kind: "file", ref: "w00005", text: "抽取产物 context-after-ch035.md", task: "w00005 t34"},
        {t: "13:30", kind: "commit", ref: "t80/settings-ui", hash: "4c7cf930", text: "docs(t80): 评审板与截图改指 .local/agent 下的新位置", task: "w00017 t80"},
        {t: "13:30", kind: "commit", ref: "t81/nb-ui-fixes", hash: "78cf9283", text: "docs(t81): 截图改指 .local/agent 下的新位置", task: "w00017 t81"},
        {t: "13:30", kind: "commit", ref: "master", hash: "46de8e82", text: "docs(w00022): t02 本地与入库的规则", task: "w00022 t02"},
        {t: "13:29", kind: "file", ref: ".local/agent", text: "t80、t81 的评审板与截图搬进 .local/agent/works/w00017…", task: "w00022 t02"},
        {t: "13:28", kind: "commit", ref: "master", hash: "9bf1364e", text: "docs(w00022): 需求分析与功能分析，开发者已确认", task: "w00022 t01"},
        {t: "13:18", kind: "report", ref: "t80-review", text: "审查报告新增 C1（重要）", task: "w00017 t80"},
        {t: "13:09", kind: "commit", ref: "t81/nb-ui-fixes", hash: "6ac0c7c0", text: "docs(t81): 记开发者接受 sm 档控件变小到设计值", task: "w00017 t81"},
        {t: "12:37", kind: "commit", ref: "refactor/w00017-runtime-foundation", hash: "029db4dc", text: "feat(t79): S4 视图标题动作、资源管理器根是书名", task: "w00017 t79"},
        {t: "12:21", kind: "commit", ref: "t81/nb-ui-fixes", hash: "db2d43a9", text: "fix(t81): nb-ui 字号类改为带类型提示的 text-[length:var(--text-*)]", task: "w00017 t81"},
    ],

    /* 所有 checkout：git worktree list 加上各自的状态 */
    checkouts: [
        {path: "主工作区", branch: "master", head: "da4daefd", base: "origin/master", ahead: 0, behind: 0, dirty: 121, untracked: 28, last: "13:35", work: "w00022、w00019", flag: "未提交改动 121"},
        {path: ".worktree/w00017-runtime-foundation", branch: "refactor/w00017-runtime-foundation", head: "929fcf9a", base: "master", ahead: 397, behind: 7, dirty: 0, last: "13:36", work: "w00017 主线（t78、t79）", procs: 2},
        {path: ".worktree/w00017-t80-settings-ui", branch: "t80/settings-ui", head: "4c7cf930", base: "w00017 主线", ahead: 12, behind: 4, dirty: 0, last: "13:30", work: "w00017 t80 · 代码"},
        {path: ".worktree/w00017-t80-review", branch: "（分离头）", head: "28d4e3de", base: "w00017 主线", ahead: 9, behind: 4, dirty: 0, last: "11:42", work: "w00017 t80 · 审查", procs: 1},
        {path: ".worktree/w00017-t80-drafts", branch: "t80/drafts", head: "fb6e94a2", base: "w00017 主线", ahead: 0, behind: 8, dirty: 3, untracked: 1, last: "06:45", work: "w00017 t80 · 草稿"},
        {path: ".worktree/w00017-t81-nb-ui", branch: "t81/nb-ui-fixes", head: "78cf9283", base: "w00017 主线", ahead: 5, behind: 2, dirty: 0, last: "13:30", work: "w00017 t81"},
        {path: ".worktree/w00002-neuro-agent-harness-redesign", branch: "feat/w00002-harness-kernel", head: "5f8bf5e6", base: "master", ahead: 407, behind: 6, dirty: 0, last: "昨天", work: "w00002"},
        {path: ".worktree/w00005-novel-understanding-spike", branch: "feat/w00005-v6-ingest-viewer", head: "ee7157c9", base: "master", ahead: 19, behind: 448, dirty: 68, untracked: 52, last: "09-11", work: "w00005", procs: 1},
        {path: ".worktree/w00021-smart-ime-spike", branch: "feat/w00021-smart-ime-spike", head: "2aaa69ed", base: "master", ahead: 30, behind: 6, dirty: 83, untracked: 35, last: "10-06", work: "w00021"},
        {path: ".worktree/w00020-startup-exit-api-auth", branch: "fix/w00020-startup-exit-api-auth", head: "b00f989d", base: "master", ahead: 0, behind: 47, dirty: 0, last: "09-30", work: "w00020", flag: "已全部在 master 里"},
        {path: ".worktree/w00018-pre-nb-ui-baseline", branch: "chore/w00018-pre-nb-ui-baseline", head: "67f809e9", base: "master", ahead: 0, behind: 378, dirty: 0, last: "09-22", work: "w00018", flag: "已全部在 master 里"},
    ],

    counts: {works: 22, worksLocal: 0, tasksActive: 8, checkouts: 11, running: 5, pages: 3, specs: null},
};
