/* 第二轮的数据：2026-10-12 16:01（BST）现读。来源见评审板“数据与样式从哪来”；herdr 只用了 agent list、agent get、agent read 与 pane list。 */
window.PANEL2 = {
 "snapshot": "2026-10-12 16:01",
 "sessions": [
  {
   "pane": "w1:p16",
   "kind": "claude",
   "sid": "d02974de",
   "status": "working",
   "title": "W00017 Workbench 组件重构",
   "titleStale": true,
   "work": "w00022",
   "task": "t03",
   "taskTitle": "面板与命令行的设计",
   "assocFrom": "终端内容：正在派第二轮静态稿与会话托管调研",
   "cwd": "neuro-book · master",
   "last": "在等 2 个后台子代理",
   "also": "t80 的日志、报告也出自这个会话（路径里有 d02974de）"
  },
  {
   "pane": "w1:p2",
   "kind": "claude",
   "sid": "c38df555",
   "status": "working",
   "title": "k1-kernel-multi-instance-runtime",
   "titleStale": true,
   "work": "w00017",
   "task": "t79",
   "taskTitle": "工作台打磨",
   "assocFrom": "状态行 .worktree/…/ui/brand；omp 审查 t79 与开发服务 :4317 由它起",
   "cwd": "neuro-book · master",
   "last": "Brewing 25 分钟（横排标志定了 L1 墨色）",
   "procs": [
    "omp 审查 t79",
    "开发服务 :4317"
   ]
  },
  {
   "pane": "w1:pB",
   "kind": "claude",
   "sid": "8ddbcd3d",
   "status": "idle",
   "title": "prompt-editor-implementation",
   "work": "w00019",
   "task": "t09",
   "taskTitle": "输入框",
   "assocFrom": "状态行 .agents/…/tasks/t09-composer",
   "cwd": "neuro-book · master",
   "last": "“确认后做第 3 步：历史消息就地编辑。”",
   "waiting": true,
   "draft": "没做好，这个 AgentConversationComposer 不好看，好像功能也不太行。参考 AgentComposer 这个组件重构……"
  },
  {
   "pane": "w1:pC",
   "kind": "claude",
   "sid": "b5f1bc8a",
   "status": "idle",
   "title": "NeuroBook logo 设计",
   "work": null,
   "task": null,
   "assocFrom": "状态行 .local/agent-thinking/motion（用户区，不属于任何 Work）",
   "cwd": "neuro-book · master",
   "last": "“接入时还要定的：何时切、放在哪、文案里的对象”",
   "waiting": true
  },
  {
   "pane": "w1:pK",
   "kind": "claude",
   "sid": "568d0811",
   "status": "idle",
   "title": "w00015 status check",
   "titleStale": true,
   "work": "w00005",
   "task": "t34",
   "taskTitle": "V9 图在 100 章上和全读比",
   "assocFrom": "状态行 .worktree/…/t34-v9-100ch/evidences",
   "cwd": "neuro-book · master",
   "last": "新建 t34 并起跑，“都没有提交”",
   "procs": [
    "抽取 71 / 100 章"
   ]
  },
  {
   "pane": "w1:pQ",
   "kind": "claude",
   "sid": "2b946ee3",
   "status": "idle",
   "title": "NeuroBook 定制输入法 spike",
   "work": "w00021",
   "task": "t01",
   "taskTitle": "设计与调研",
   "assocFrom": "状态行 .worktree/w00021-smart-ime-spike",
   "cwd": "neuro-book · master",
   "last": "压缩上下文后停着",
   "draft": "下一步是什么"
  },
  {
   "pane": "w1:pR",
   "kind": "claude",
   "sid": "d8e1586d",
   "status": "idle",
   "title": "harness-ergonomics-examples",
   "work": "w00002",
   "task": "t19",
   "taskTitle": "nb-harness 易用性与渐进式示例",
   "assocFrom": "状态行 .worktree/w00002-neuro-agent-harness-redesign；标题对应 t19",
   "cwd": "neuro-book · master",
   "last": "空闲时压缩了上下文"
  },
  {
   "pane": "w1:pV",
   "kind": "omp",
   "sid": "01a12dd3",
   "status": "idle",
   "title": "系统依赖升级（π）",
   "work": null,
   "task": null,
   "assocFrom": "工作目录 /tmp，不属于本仓库",
   "cwd": "/tmp",
   "last": "“升完叫我，我把 rea doctor 跑一遍”",
   "waiting": true,
   "outside": true
  },
  {
   "pane": "w1:pY",
   "kind": "claude",
   "sid": "7bcd5bef",
   "status": "idle",
   "title": "项目状态分析",
   "work": null,
   "task": null,
   "assocFrom": "别的仓库 stellaris-mcp",
   "cwd": "stellaris-mcp",
   "last": "",
   "otherRepo": true
  }
 ],
 "panes": [
  {
   "pane": "w1:pJ",
   "title": "bun run --cwd=packages/neuro-book dev",
   "cwd": ".worktree/w00017-runtime-foundation",
   "note": "开发服务 :4217（PID 2118675）的终端"
  },
  {
   "pane": "w1:pN",
   "title": "zsh",
   "cwd": "neuro-book",
   "note": "普通终端"
  },
  {
   "pane": "w1:pZ",
   "title": "zsh",
   "cwd": "~",
   "note": "普通终端"
  }
 ],
 "reads": {
  "w1:p16": [
   "  - 内容分类与导航：按我上一条的提议来，左栏分成首页与收件箱、工作（Work › Task）、产物、文档、现场五组。",
   "  - 补充分析里的待定项：按推荐确认。",
   "",
   "  有三条要等调研回来再定，因为它们和“会话怎么接”直接相关：",
   "",
   "  - 面板直接通知会话的具体做法；",
   "  - 面板要不要常驻；",
   "  - 产物页要不要放到第二个端口。",
   "",
   "  现在后台在跑的",
   "",
   "  1. 调研：已经通知子代理收窄到“面板只做 herdr 前端”这个前提。重点查清三件事：只靠 herdr 现有接口能做到哪一步、哪里要等 herdr 加能力、局域网访问怎么保护。另外比较两种在网页里显示终端的办法：一种经 herdr 接口读输出、发输入；另一种是面板后端在",
   "     pty 里 attach 到会话。",
   "  2. 第二轮静态稿：由画第一轮的同一个子代理来画，新稿放在 r2/，用本机刷新后的真实数据。一共五页：",
   "     - 首页 B：左栏按新导航分组，“工作”下面能展开 Work › Task 的树。",
   "     - 会话页：左边是会话列表，右边是终端输出和发消息框；另有一个“收件箱里回复后通知会话”的确认小窗。",
   "     - 产物页：按设计稿、报告、审查、证据四类列出，问题挂在产物旁边。",
   "     - 文档页：默认看 master，可以切到别的 checkout。",
   "     - GitHub 页：Issue 和 PR 列表。",
   "",
   "  已登记、还没开工的 t04：把这次确认的三条改成规则。",
   "",
   "  - worktree 一个 Task 一个。",
   "  - Task 号允许三位，要改治理检查的正则。",
   "  - omp 会话目录改放 .local/agent，要改你的全局规则 ~/.agent/AGENTS.md 里那句。",
   "",
   "  t04 等面板设计定稿后再做，或者你想现在就先做也行。",
   "",
   "  两边交回后，我先看稿子、补上推荐，再把调研结论落盘，然后一起给你。",
   "",
   "✻ Waiting for 2 background agents to finish",
   "",
   "──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
   "❯",
   "──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
   "  Opus 5.5 · effort xhigh · ~/CodeRepository/neuro-book · ⎇ master · cost $44.99 │ in $0.0025 · out $7.86 · cw $6.67 · cr $30.45",
   "  ctx ▓▓░░░░░░░░░░░░ 12% (883k) · cache 99% │ ttl 59m · 5h ▓▓░░░░░░░░░░░░ 12% │ reset 59m · 7d ▓▓▓▓▓▓▓▓▓▓▓░░░ 79% │ reset 7h59m",
   "  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents",
   "",
   "  ● main",
   "  ◯ general-purpose  Reading persistence-remote.mdx terminal attach docs                                                                              ",
   "  ◯ general-purpose  Listing herdr agent sessions                                                                                                     "
  ],
  "w1:p2": [
   "  Ran 1 shell command",
   "",
   "● 现成的横排标志组件 NeuroBookLockup 正合用于标题栏，宽高比约5.7:1，可按文字色或品牌色上色。我会出两版：墨色（随文字色）和品牌色（浅色赤红、深色金），布局顺序统一为标志、项目切换、菜单。",
   "",
   "● Bash(S=/tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t79; python3 - $S/round9.mjs $S/ro",
   "  ⎿  settings-restored",
   "     ok",
   "  ⎿  1 file changed (binary, mode only or too large to show)",
   "  ⎿  (timeout 6m 40s)",
   "  ⎿  Allowed by auto mode classifier",
   "",
   "  Read 1 file",
   "",
   "● 横排标志两版已出图（evidences/draft10-lockup.png）：L1墨色方案更贴合界面，L2品牌色方案（赤红/金色）更有品牌感；底部还附了L1套入浅色、深色整页的效果，已叠加之前确定的P1暖色、卡片、4px缝、暖色控件和M1菜单改动。",
   "",
   "● User answered Claude's questions:",
   "  ⎿  · 横排标志用哪种颜色？（draft10-lockup.png） → L1 墨色",
   "",
   "✢ Brewing… (25m 16s · ↓ 81.1k tokens · deep in thought with xhigh effort)",
   "                                                                                                                                                      ",
   "──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
   "❯",
   "──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
   "  Opus 5.5 · effort xhigh · advisor ×1 · ~/CodeRepository/neuro-book · ⎇ master · .worktree/…/ui/brand · cost $1806.82 │ in $0.146 · out $309.85 · cw ",
   "  ctx ▓▓▓▓▓▓▓▓▓░░░░░ 62% (376k) · cache 99% │ ttl 58m · 5h ▓▓░░░░░░░░░░░░ 11% │ reset 59m · 7d ▓▓▓▓▓▓▓▓▓▓▓░░░ 79% │ reset 7h59m",
   "  ⏵⏵ auto mode on · 2 shells, 1 monitor · ← for agents"
  ],
  "w1:pB": [
   "  验证",
   "  - 全量类型检查和脚本类型检查都是 0 错误。单测失败的仍只有 WorkbenchShellLayoutFixture 那 9 条老问题；新增的 12 条都过了。",
   "  - agent-conversation 这套 smoke 新增了输入框的一组检查，覆盖上面列的全部行为。我故意把 steer 和 followup 对调、去掉“没传完不能发送”这条规则，两处都被报了出来。",
   "  - prompt-editor smoke 也通过了。截图检查：输入框、两个零件和对话视图的全部场景，在手机和 1400×900、明暗两种配色下都没有溢出。",
   "",
   "  确认后做第 3 步：历史消息就地编辑。",
   "",
   "✻ Worked for 34m 12s · done Thursday 16:32",
   "",
   "❯ /compact",
   "  ⎿  Compacted (ctrl+o to see full summary)",
   "  ⎿  Read ../../../../../packages/neuro-book/app/components/agent/README.md (25 lines)",
   "",
   "  ⎿  Referenced file ../../../../../packages/neuro-book/scripts/smoke/agent-conversation-view.ts",
   "",
   "  ⎿  Referenced file ../../../../../packages/neuro-book/scripts/smoke/agent-composer.ts",
   "",
   "  ⎿  Referenced file ../../../../../packages/neuro-book/app/components/agent/composer/AgentConversationComposer.vue",
   "",
   "  ⎿  Read ../../../../../packages/neuro-book/app/component-lab/fixtures/AgentConversationComposer.scenes.ts (63 lines)",
   "",
   "  ⎿  Plan file referenced (~/.claude/plans/steady-knitting-hickey.md)",
   "  ⎿  Skills restored (playwright-cli)",
   "                                                                                                                                                      ",
   "──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
   "❯ 没做好，这个 AgentConversationComposer 不好看，好像功能也不太行。参考 AgentComposer 这个组件重构，这个是我之前调好了的组件",
   "──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
   "  Opus 5.5 · effort xhigh · ~/CodeRepository/neuro-book · ⎇ master · .agents/…/tasks/t09-composer · cost $200.22 │ in $0.014 · out $43.15 · cw $51.49 ",
   "  ctx ▓▓▓▓▓▓▓▓▓▓▓▓▓▓ 100% · cache 99% │ cold",
   "  ⏵⏵ auto mode on (shift+tab to cycle)"
  ],
  "w1:pC": [
   "  这次的服务是会话内的后台任务，会话关掉后页面就打不开了。之后要再看，在 .local/agent-thinking 目录下运行 bun rating/serve.ts，再打开上面的地址。",
   "",
   "  接入时还要定的",
   "",
   "  1. 何时切：思考一圈要 8 秒，等它放完再切，状态会显得滞后；立即切又可能在半路打断。需要定一个最长等待时间。一次性的完成、出错、重试、已停止都要放完。",
   "  2. 放在哪：32px 放不进思维链摘要行开头那个 14px 的图标位，多半要单独做一行状态行。",
   "  3. 文案里的对象：要填人能读懂的名字，比如章节标题，而不是目录名。",
   "",
   "✻ Cogitated for 11m 25s · done 14:17",
   "",
   "❯ /compact",
   "  ⎿  Compacted (ctrl+o to see full summary)",
   "  ⎿  Read final.js (17 lines)",
   "  ⎿  Referenced file final.html",
   "  ⎿  Read r9.js (104 lines)",
   "  ⎿  Read r8.js (89 lines)",
   "  ⎿  Read r7.js (70 lines)",
   "                                                                                                                                                      ",
   "──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
   "❯",
   "──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
   "  Opus 5.5 · effort xhigh · ~/CodeRepository/neuro-book · ⎇ master · .local/agent-thinking/motion · cost $157.86 │ in $0.013 · out $49.11 · cw $42.90 ",
   "  ctx ▓▓▓▓▓▓▓▓▓▓▓▓▓▓ 100% · cache 98% │ cold · 7d ▓▓▓▓▓▓▓▓░░░░░░ 57% │ reset 7h59m",
   "  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents"
  ],
  "w1:pV": [
   "",
   " - 磁盘：/ 剩 254 G，够；pacman 缓存已 9.3 G，升级完可以 sudo paccache -rk1（装了 pacman-contrib 的话）清一清。",
   " - 内核会从 7.2.7 升到 7.2.9，systemd/glibc 也会动，升完重启一次；重启前先停掉你自己那些常驻服务（这台机器上还有",
   "   frpc、Chrome 等）。",
   " - 你有 34 个 AUR 包（rea-agents 也在其中），仓库升级不会碰它们；想一起更新再跑 yay -Sua。若 rea 被升到新版，它 pin",
   "   的 Hopper build 可能变化，届时重跑一次 rea doctor --provider hopper 即可。",
   " - 709 个包的下载量 pacman 会在 Proceed with installation? 那一步直接给出（我没有",
   "   root，无法预先取文件大小）。国内镜像慢的话，/etc/pacman.d/mirrorlist 里已经有官方 geo.mirror.pkgbuild.com 兜底。",
   "",
   " 升级后验收",
   "",
   " ```bash",
   "sudo pacman -S --needed xorg-server-xvfb    # 若上面 -Syu 已带上就跳过",
   "rea doctor --provider hopper                # 期望 hopper-demo-runtime 从 missing_xvfb 变 ok",
   " ```",
   "",
   " 升完叫我，我把 rea doctor --provider hopper 跑一遍，并复核 /opt/hopper/bin/Hopper 的 ldd（Qt 从 6.11 跳到",
   " 6.12，值得确认一次链接是否仍然干净）。",
   "",
   "                                          这是系统在安装依赖时要求管理员认证，但输入的密码没有通过，所以安装被中止了。",
   " π > ⬢ DeepSeek V4.1 Flash · ◒ high > 🗑 /tmp > $0.22 ↓ ───────────19%───────────────────────────────────╎─┃────────1M─",
   "╰─"
  ],
  "w1:pK": [
   "",
   "  - 新建了 Task t34：.agents/works/w00005-novel-understanding-spike/tasks/t34-v9-100ch/。README 里有目的、做法、费用估计和边界，脚本在 scripts/ 下。",
   "  - Work README 加了 t34 一行。",
   "  - 提案第十三节加了今天“在 100 章上和全读比”的决策。",
   "  - t22 报告、t24 二审的组名表各加了 V9 100 章这一组。",
   "  - 文档检查 0 失败。治理检查只有 w00003 那条原有的失败，和本次无关。",
   "  - 都没有提交。",
   "",
   "✻ Cogitated for 4m 28s · done 12:11 · 2 shells still running",
   "                                                                                                                                                      ",
   "──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
   "❯",
   "──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
   "  Opus 5.5 · effort xhigh · ~/CodeRepository/neuro-book · ⎇ master · .worktree/…/t34-v9-100ch/evidences · cost $144.90 │ in $0.032 · out $32.23 · cw $",
   "  ctx ▓▓▓▓▓▓░░░░░░░░ 45% (550k) · cache 98% │ cold · 5h ▓░░░░░░░░░░░░░ 1% │ reset 59m · 7d ▓▓▓▓▓▓▓▓▓▓▓░░░ 75% │ reset 7h59m",
   "  ⏵⏵ auto mode on · ← for agents · 2 shells"
  ],
  "w1:pQ": [
   "  ⎿  Compacted (ctrl+o to see full summary)",
   "  ⎿  Read .agents/works/w00021-smart-ime-spike/tasks/t01-design-and-research/evidences/decode-v2/README.md (121 lines)",
   "",
   "  ⎿  Read packages/nb-ime/python/nbime_lab/fusion_eval.py (205 lines)",
   "  ⎿  Read packages/nb-writer/AGENTS.md (28 lines)",
   "  ⎿  Read .agents/works/w00021-smart-ime-spike/README.md (42 lines)",
   "  ⎿  Read packages/nb-ime/python/pyproject.toml (33 lines)",
   "                                                                                                                                                      ",
   "──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
   "❯ 下一步是什么",
   "──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
   "  Opus 5.5 · effort xhigh · ~/CodeRepository/neuro-book · ⎇ master · .worktree/w00021-smart-ime-spike · cost $180.52 │ in $0.011 · out $42.70 · cw $53",
   "  ctx ▓▓▓▓▓▓▓▓▓▓▓▓▓▓ 100% · cache 99% │ cold · 7d ▓▓▓▓▓░░░░░░░░░ 33% │ reset 7h59m",
   "  ⏵⏵ auto mode on (shift+tab to cycle)"
  ],
  "w1:pR": [
   "  ⎿  Read packages/nb-harness/src/tools/adapter.ts (201 lines)",
   "  ⎿  Referenced file packages/nb-harness/README.md",
   "  ⎿  Plan file referenced (~/.claude/plans/sharded-percolating-puddle.md)",
   "",
   "● Compacted while idle, before the prompt cache expired",
   "                                                                                                                                                      ",
   "──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
   "❯",
   "──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
   "  Opus 5.5 · effort high · ~/CodeRepository/neuro-book · ⎇ master · .worktree/w00002-neuro-agent-harness-redesign · cost $227.00 │ in $0.092 · out $49",
   "  ctx ▓▓▓▓▓▓▓▓▓▓▓▓▓▓ 100% · cache 99% │ cold · 7d ▓▓▓▓▓▓▓▓▓░░░░░ 61% │ reset 8h0m",
   "  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents"
  ]
 },
 "prs": [
  {
   "n": 245,
   "title": "fix(runtime): 启动失败有序退出，API 路径不按扩展名放行认证",
   "state": "OPEN",
   "draft": false,
   "head": "fix/w00020-startup-exit-api-auth",
   "base": "master",
   "updated": "2026-09-30",
   "checks": {
    "ok": 3,
    "fail": 4,
    "total": 7
   },
   "add": 165,
   "del": 8,
   "comments": 0,
   "work": "w00020"
  },
  {
   "n": 237,
   "title": "fix(agent): 为工具结果建立统一上下文预算并调小工具结果上限",
   "state": "OPEN",
   "draft": false,
   "head": "fix/i236-tool-result-context-budget",
   "base": "master",
   "updated": "2026-09-17",
   "checks": {
    "ok": 7,
    "fail": 0,
    "total": 7
   },
   "add": 2758,
   "del": 207,
   "comments": 0,
   "work": "Issue #236"
  },
  {
   "n": 235,
   "title": "fix(agent): Inline AI 发送与 Session 聊天不再依赖面板挂载（Issue #227）",
   "state": "MERGED",
   "draft": false,
   "head": "fix/w00014-inline-ai-send-owner",
   "base": "master",
   "updated": "2026-09-14",
   "checks": {
    "ok": 5,
    "fail": 2,
    "total": 7
   },
   "add": 208,
   "del": 45,
   "comments": 1,
   "work": "w00014"
  },
  {
   "n": 234,
   "title": "Fix/dev icons",
   "state": "CLOSED",
   "draft": false,
   "head": "fix/dev-icons",
   "base": "master",
   "updated": "2026-09-14",
   "checks": {
    "ok": 0,
    "fail": 0,
    "total": 0
   },
   "add": 9,
   "del": 3,
   "comments": 0,
   "work": null
  },
  {
   "n": 232,
   "title": "docs(manager): record Issue 229 remote merge closure",
   "state": "MERGED",
   "draft": false,
   "head": "fix/i229-manager-installation-entry-load",
   "base": "master",
   "updated": "2026-09-09",
   "checks": {
    "ok": 2,
    "fail": 1,
    "total": 5
   },
   "add": 5,
   "del": 8,
   "comments": 0,
   "work": "Issue #229"
  },
  {
   "n": 231,
   "title": "fix(manager): load clean installation entry bundle",
   "state": "MERGED",
   "draft": false,
   "head": "fix/i229-manager-installation-entry-load",
   "base": "master",
   "updated": "2026-09-09",
   "checks": {
    "ok": 7,
    "fail": 1,
    "total": 10
   },
   "add": 172,
   "del": 2,
   "comments": 0,
   "work": "Issue #229"
  },
  {
   "n": 230,
   "title": "fix: isolate Product Runtime from broken stdio",
   "state": "MERGED",
   "draft": false,
   "head": "fix/w00012-issue-228-product-runtime-stdio-epipe",
   "base": "master",
   "updated": "2026-09-09",
   "checks": {
    "ok": 8,
    "fail": 2,
    "total": 10
   },
   "add": 303,
   "del": 36,
   "comments": 0,
   "work": "w00012"
  },
  {
   "n": 224,
   "title": "Fix/tui blessed runtime assets",
   "state": "MERGED",
   "draft": false,
   "head": "fix/tui-blessed-runtime-assets",
   "base": "master",
   "updated": "2026-09-04",
   "checks": {
    "ok": 0,
    "fail": 0,
    "total": 0
   },
   "add": 230,
   "del": 33,
   "comments": 0,
   "work": null
  },
  {
   "n": 222,
   "title": "fix(agent): bound context compaction requests",
   "state": "OPEN",
   "draft": false,
   "head": "fix/t147-context-compaction-rebase",
   "base": "master",
   "updated": "2026-09-02",
   "checks": {
    "ok": 7,
    "fail": 0,
    "total": 7
   },
   "add": 1648,
   "del": 69,
   "comments": 0,
   "work": "旧 Task t147"
  },
  {
   "n": 218,
   "title": "fix(governance): reject linked work paths",
   "state": "MERGED",
   "draft": false,
   "head": "fix/w00001-work-task-path-containment",
   "base": "master",
   "updated": "2026-08-28",
   "checks": {
    "ok": 5,
    "fail": 0,
    "total": 7
   },
   "add": 138,
   "del": 11,
   "comments": 0,
   "work": "w00001"
  },
  {
   "n": 217,
   "title": "refactor(governance): adopt leader-driven task workflow",
   "state": "MERGED",
   "draft": false,
   "head": "refactor/t160-leader-driven-workflow",
   "base": "master",
   "updated": "2026-08-27",
   "checks": {
    "ok": 13,
    "fail": 0,
    "total": 15
   },
   "add": 4700,
   "del": 1022,
   "comments": 0,
   "work": "旧 Task t160"
  },
  {
   "n": 216,
   "title": "feat: close agent session abort contract",
   "state": "CLOSED",
   "draft": false,
   "head": "feat/t159-agent-abort-contract",
   "base": "master",
   "updated": "2026-09-01",
   "checks": {
    "ok": 7,
    "fail": 0,
    "total": 7
   },
   "add": 10179,
   "del": 8298,
   "comments": 1,
   "work": "旧 Task t159"
  }
 ],
 "issues": [
  {
   "n": 251,
   "title": "[Feature] Session Tree的分支展示能否让样式的层级显示得更清晰一些？",
   "updated": "2026-10-05",
   "labels": [
    "type: feature",
    "status: needs-triage"
   ],
   "comments": 0
  },
  {
   "n": 250,
   "title": "[Feature] 能否让Session的编辑功能，可以修改该请求使用的API供应商和模型，而不是只能修改文字内容？",
   "updated": "2026-10-05",
   "labels": [
    "type: feature",
    "status: needs-triage"
   ],
   "comments": 0
  },
  {
   "n": 247,
   "title": "[Bug] 配置中心左侧区段说明被单行截断，1280 窗口下三条说明读不完整句",
   "updated": "2026-10-03",
   "labels": [],
   "comments": 0
  },
  {
   "n": 246,
   "title": "多窗口时页面启动阶段批量出现 403 STORAGE_CONTEXT_INVALID",
   "updated": "2026-10-02",
   "labels": [
    "type: bug",
    "status: needs-design",
    "area: workspace"
   ],
   "comments": 0
  },
  {
   "n": 244,
   "title": "开发模式：热重载实例重叠后持续 500，且无法有序停止",
   "updated": "2026-09-30",
   "labels": [
    "type: bug",
    "status: needs-design"
   ],
   "comments": 0
  },
  {
   "n": 243,
   "title": "[Bug] 紧凑呈现的退化判定按外壳容器宽，1280 窗口下正文编辑列被编辑列内侧栏挤到约 126px",
   "updated": "2026-10-03",
   "labels": [],
   "comments": 1
  },
  {
   "n": 242,
   "title": "[Bug] Lab 的 model 层用 Required<Pick<…>> 强制可选 v-model 登记初值，与上游自身的侧栏场景和 style.width 断言互斥，master 上 nuxt typecheck 报 5 个错",
   "updated": "2026-09-29",
   "labels": [],
   "comments": 0
  },
  {
   "n": 241,
   "title": "[Bug] 记录读取在原子替换竞态下抛 StorageIoError，而不是返回完整旧记录或完整新记录",
   "updated": "2026-09-29",
   "labels": [],
   "comments": 0
  },
  {
   "n": 240,
   "title": "[Bug] test:desktop-contract 的两条标题栏断言仍指向重构前的 DesktopTitleBarChrome.vue，master 自身红",
   "updated": "2026-09-29",
   "labels": [],
   "comments": 0
  },
  {
   "n": 239,
   "title": "[Bug] packages/neuro-book 的 build 末步用裸 tsc 检查含 .vue 导入的文件，master 上本地构建必然失败",
   "updated": "2026-09-29",
   "labels": [],
   "comments": 0
  },
  {
   "n": 238,
   "title": "[Bug] 局域网 HTTP 访问下 crypto.randomUUID 不可用，Agent 发送消息中断",
   "updated": "2026-09-28",
   "labels": [
    "type: bug",
    "status: ready",
    "area: editor",
    "source: agent",
    "priority: normal"
   ],
   "comments": 0
  },
  {
   "n": 236,
   "title": "为 Agent 工具结果建立统一上下文预算：plot 工具全量返回可致请求超窗",
   "updated": "2026-09-16",
   "labels": [
    "type: bug",
    "status: needs-design",
    "area: agent",
    "source: agent",
    "priority: high"
   ],
   "comments": 0
  },
  {
   "n": 233,
   "title": "拆分 packages/neuro-book 测试分层并治理全量回归缓慢问题",
   "updated": "2026-09-11",
   "labels": [
    "type: maintenance",
    "status: ready",
    "source: agent",
    "priority: normal"
   ],
   "comments": 0
  },
  {
   "n": 221,
   "title": "[Bug] 默认视图设置项，切换到源码一会就会回到富文本",
   "updated": "2026-08-30",
   "labels": [
    "type: bug",
    "status: needs-triage"
   ],
   "comments": 0
  },
  {
   "n": 220,
   "title": "[Bug] bug-report-gemini-uniqueitems",
   "updated": "2026-08-29",
   "labels": [
    "type: bug",
    "status: needs-triage",
    "area: agent",
    "priority: high"
   ],
   "comments": 0
  },
  {
   "n": 195,
   "title": "UI 重构后适配 Desktop Workbench 与 Title Bar",
   "updated": "2026-08-25",
   "labels": [
    "type: feature",
    "status: needs-design",
    "area: editor",
    "area: install-release",
    "source: agent",
    "priority: low"
   ],
   "comments": 0
  },
  {
   "n": 194,
   "title": "设计 NeuroBook 插件与扩展控制面",
   "updated": "2026-08-25",
   "labels": [
    "type: feature",
    "status: needs-design",
    "area: agent",
    "area: editor",
    "source: agent",
    "priority: normal"
   ],
   "comments": 0
  },
  {
   "n": 193,
   "title": "研究并重新设计独立 neuro-agent-harness",
   "updated": "2026-10-10",
   "labels": [
    "type: maintenance",
    "status: needs-design",
    "area: agent",
    "source: agent",
    "priority: normal"
   ],
   "comments": 0
  },
  {
   "n": 192,
   "title": "建立类 VS Code 的 Workbench 与 View Host 抽象",
   "updated": "2026-08-25",
   "labels": [
    "type: feature",
    "status: needs-design",
    "area: editor",
    "source: agent",
    "priority: normal"
   ],
   "comments": 0
  },
  {
   "n": 191,
   "title": "将 NeuroBook 主应用 UI 底座迁移到 nb-ui",
   "updated": "2026-08-25",
   "labels": [
    "type: maintenance",
    "status: needs-design",
    "area: editor",
    "source: agent",
    "priority: normal"
   ],
   "comments": 0
  },
  {
   "n": 177,
   "title": "通知卡片在主题下对比度不足且对齐不一致",
   "updated": "2026-08-25",
   "labels": [],
   "comments": 0
  },
  {
   "n": 175,
   "title": "Agent 会话头部按钮缺少悬停提示（Tooltip）",
   "updated": "2026-08-25",
   "labels": [],
   "comments": 0
  },
  {
   "n": 170,
   "title": "同一 Installation Root 跨 Podman/Docker Compose provider 混用导致容器清理不净",
   "updated": "2026-08-25",
   "labels": [
    "type: bug",
    "area: install-release",
    "priority: low"
   ],
   "comments": 0
  },
  {
   "n": 169,
   "title": "Container Profile 每次安装残留 <operation-uuid>_default 一次性 Compose 网络",
   "updated": "2026-08-25",
   "labels": [
    "type: bug",
    "area: install-release",
    "priority: low"
   ],
   "comments": 0
  },
  {
   "n": 162,
   "title": "定义 NeuroBook 通知事件、级别与通知中心边界",
   "updated": "2026-08-24",
   "labels": [
    "type: feature",
    "status: needs-design",
    "area: editor",
    "source: agent",
    "priority: low"
   ],
   "comments": 0
  },
  {
   "n": 161,
   "title": "决定用户资产页面的保留、合并或移除方案",
   "updated": "2026-08-24",
   "labels": [
    "type: feature",
    "status: needs-design",
    "area: editor",
    "area: workspace",
    "source: agent",
    "priority: low"
   ],
   "comments": 0
  },
  {
   "n": 160,
   "title": "重构 Markdown 解析、扩展与渲染架构",
   "updated": "2026-08-24",
   "labels": [
    "type: maintenance",
    "status: needs-design",
    "area: editor",
    "source: agent",
    "priority: high"
   ],
   "comments": 0
  },
  {
   "n": 159,
   "title": "定义 Agent Home 身份、存储和授权协议",
   "updated": "2026-08-24",
   "labels": [
    "type: maintenance",
    "status: needs-design",
    "area: agent",
    "area: workspace",
    "source: agent",
    "priority: high"
   ],
   "comments": 0
  },
  {
   "n": 158,
   "title": "拆解 UI 层阻塞并建立可独立演进的边界",
   "updated": "2026-08-24",
   "labels": [
    "type: maintenance",
    "status: needs-design",
    "area: editor",
    "source: agent",
    "priority: low"
   ],
   "comments": 0
  },
  {
   "n": 157,
   "title": "设计文件协议与历史扩展的长期兼容合同",
   "updated": "2026-08-24",
   "labels": [
    "type: maintenance",
    "status: needs-design",
    "area: workspace",
    "source: agent",
    "priority: normal"
   ],
   "comments": 0
  }
 ],
 "issueTotal": 82,
 "prOpen": 6
};
