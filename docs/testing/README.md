# NeuroBook 测试规范

本文件是仓库测试、临时根、环境和验收约定的真相源。测试编写、运行器配置、fixture 和验收脚本遵守这里；规则冲突时先更新本文件。`AGENTS.md` 的“测试”一节只摘要最核心的几条，正文以本文件为准。

## 测试写法

**测行为，不测实现。** 断言调用方或用户能观察到的结果：重复下单不重复扣款，而不是某个方法被调用了几次。行为没变的重构让测试失败，说明测试写错了。以下两类测试有害：

- **同义反复**：期望值由被测代码本身或同一份逻辑算出，替身返回什么就断言什么。
- **变更探测**：断言内部调用顺序、私有状态、措辞、快照或偶然的默认值，任何重构都会让它失败。

**先列场景与失败方式，再写实现。** 有 Spec 时，验收场景与“失败与恢复”逐条就是测试清单；没有 Spec 的模块先写出它会怎样失败。测试名写可观察的行为，能对应 Spec 场景时标出场景编号。写完实现再照着实现补测试，容易只证明“代码做了它做的事”，漏掉没想到的失败路径。从提案、Spec 到验收的整体顺序见 [开发方式：规格驱动、验收先行](../specs/README.md#开发方式规格驱动验收先行)。

**bug 修复的测试。** 先确认 bug 暴露的是哪条行为的覆盖缺口：有缺口就在那条行为的测试里补用例（修复前失败、修复后通过）；没有缺口（已有测试本该抓到却写错了）就改那条测试，不另加只针对这个 bug 的测试。

**撤掉测试里的绕法之前，先列出它的全部作用。** 用例里为躲开一个产品问题加的步骤（例如先收起旁边的面板），产品问题修好后要撤时，先找出这一步还承担什么（给被测元素留出高度、让要点的行都在视口里），再跑用到它的整份文件，不只跑暴露问题的那一条（w00026 t24：撤掉“收起会话”时只想到它在躲错行，忘了资源树是虚拟列表，半高时下面的行不在页面上，7 条用例失败）。

**依赖用真的。** 文件系统、子进程、端口、SQLite 能用真的就用真的。外部系统不便接入时注入替身（fake），并且要有一条测试证明替身与真实系统的行为一致，否则替身会掩盖真实行为（例如同步触发运行时只会异步派发的事件）。真实模型的调用不伪造，见[真实模型测试](#真实模型测试)。一个文件里几个测试共用的替身（本机的假端点、脚本化的回复队列）在每个测试之后复位，不靠测试的先后：上一个测试没用完的回复会串到下一个，单独跑能过、整文件跑才失败。测试要给插件补宿主能力（时钟、状态根、当前项目）时写进应用清单的 `capabilities`，不另写一个测试插件去提供：插件只能提供自己命名空间里的服务键，提供别人的键被内核以 `foreign-service-id` 拒绝。

要断言某件事没有发生时，先排一个走同一条队列、结果看得见的动作，等它完成再断言，不按固定时长等。

**断线、丢回复这类时序，故障点放在输入输出的边界上。** 测“请求发出去了、结果不明”的协议（幂等重发、冻结的请求、条件写）时，只在调用方外面包一层（发之前丢掉，或做完以后把结果换成失败）造得出“根本没发”与“做完了才丢”，造不出“请求过了检查、还没落盘”与“写进去了、回执没到”，而出错的正是这两种。把故障点放在真实的边界上：文件或日志写入之前停住、扣住或丢掉链路上的回复帧、断开再重连，其余都用真的（例：`packages/neuro-book/src/plugins/canon/testing/text-scene.ts`）。（w00039 t28：主文字稿的提交协议第一轮只用包装层测，实现审查用在途的请求造出了发布两次与放弃以后又被发出去。）

**经用户输入的入口测输入行为。** 测编辑器的输入行为时，经它接收用户输入的入口（打字、按键），不只经命令或直接改文档：后者跳过光标处的格式、输入规则与按键处理。

**近似实现标准格式时以真实库为准。** 手写一个标准格式（Markdown、CSV、shell 引号）的轻量近似时，测试的期望值取真实库对同一输入的输出；有意保留的差异写进实现的注释。凭直觉写的期望值会把近似实现自己的错误固化成合同。

**交出的组件经真实的服务测。** 组件经服务或注册表交给别的插件时，至少有一条测试经真实的服务取组件来挂，不只在 Lab 里直接挂源组件：交出时加的包装（注入、按需加载、外露方法的转发）只在这条路径上。

**窗口级的能力用 `createApplication` 的 `capabilities` 交给被测插件。** 窗口的翻译引擎、项目绑定、时钟这类能力在真实窗口里是宿主能力（`packages/neuro-book/src/web/host/window.ts` 的 `manifest.capabilities`），不是插件提供的服务：测试里写成一个提供同一服务键的测试插件，被测插件的 `windowTextKey` 这类可选依赖取不到它，用例照样通过，却走了没有引擎的退路（w00025 t25：语言切换的用例先这样写，等英文显示名等到超时才发现）。测切语言时用 `createHostTextEngine` 建真实的引擎、作为能力传入，再调它的 `setLocale`。

**用 Storage 场地测本机记录，同一台机器的窗口用同一个客户端 id。** 本机记录（`locality: "local"`）按客户端分：测几个窗口同时改同一条本机记录时，`storageWorld` 的 `window(id, client, …)` 给它们同一个 `client`；给了不同的 `client`，等于两台机器各写各的记录，其中一个窗口的写入在另一个窗口里看不到，像是丢了写入（w00025 t10：`markdown.properties-open` 的两窗口用例，先用了两个客户端，排查了一轮才发现是用例写错）。已开着的窗口不承诺即时看到别的窗口的改动：断言落在存储里的记录，或新开一个窗口去读。

**不按固定时长等待。** 等一个可观察的状态成立（`@notnotype/neuro-book-test-support/wait` 的 `waitUntil`），或让被测代码接受注入的时钟、由测试推进时间。让出一轮事件循环（延迟为 0）不算等待。`waitUntil` 的检查函数一抛错，等待就随之失败、不再重试：检查里读可能还没出现的东西用不抛的写法（Vue Test Utils 写 `find(选择器).exists() && …`，不用找不到就抛的 `get`），否则报的是“找不到元素”而不是等待超时，看起来像产品没画出来（w00039 t37）。`bun test` 的用例默认上限也是 5 秒：造大量文件、依赖 inotify 事件的用例在 CI 上比本地慢得多，显式给用例和 `waitUntil` 放宽上限，不把本地耗时当上限。DOM 用例第一次挂载异步组件时要等 Vitest 转换模块，别的进程占着 CPU 时能到十几秒：`vitest.config.ts` 的用例上限已放宽，等首次挂载的 `waitUntil` 另传 `timeoutMs`（它的缺省是 5 秒）。被测操作本身在等注入的时钟（宽限期、合并窗口、空闲计时）时，先发起它，在等它的同时推进时钟；先 `await` 它再推时钟会互相等死，超时还常常报在收尾的钩子上。计时是在某个异步的状态变化之后才排上的（例如会话在运行结束、状态变成空闲之后才排关闭），推一次就等会赶在它排上之前：在 `waitUntil` 的检查里边推边等。断言某个时间字段取自哪件事时，先在前后两件事之间推进注入的时钟：时钟不走时所有事件同一时刻，取错了字段也通过（w00032 t21）。Vitest 里等动态 import 的组件（`defineAsyncComponent`、懒加载路由）首次出现时，`vi.waitFor` 显式给足超时：首次导入要经 Vite 转换，实测超过默认的 1 s。被测对象本身带真实时长（通知几十毫秒后消失、回执到时复原）、用例又要先断言“它还在”时，时长留足（至少 1 秒量级），等它到时的 `waitFor` 另给几秒上限：20 到 40 毫秒的时长在机器忙时会在第一次断言之前就到，用例偶发失败（w00028 t04 合入后实测，负载 22 时四次失败一次）。

**手动时钟与真实的外部事件同时用时，先等事件到齐再推进时钟。** 被测代码按时钟切批（例如文件监视器按延迟聚成一批），而事件是真实文件系统陆续投递的：在轮询里推进时钟，批会在事件还没收齐时被切走，用例在慢机器上才失败（`markdown/asset-urls.test.ts` 的“失同步”用例，本机 CPU 压满时 15 遍失败 5 遍）。做法是在这些写入之后再写一个场景之外的屏障文件，等测试自己的监视器看到它（`files/changes.test.ts` 的 `writeAndSee`），之后才推进时钟。

e2e 打开文件时等到活动标签真是这个文件，不凭一次 `aria-expanded` 决定点不点：恢复会话时文件夹的展开状态还在变，读到“收起”再点，可能正好把刚展开的收起来。

**e2e 里操作 Monaco。** 点正文按编辑器的外框（`.monaco-editor`）定位，不按 `.view-lines`：它随滚动整体平移，按它的位置点会点到可见区外面，Playwright 报 `html intercepts pointer events`。Monaco 把空格画成不换行空格（`\u00a0`），按文字找 token 或读一行的文字时两种空格都要认（w00025 t05）。

**第三方库处理点击、选区、剪贴板的行为，在真实浏览器里验证。** 组件测试里手工调库的处理函数（`handleClick`、`handlePaste`）时，选区、事件目标都是测试自己摆的，看不出库在真实事件顺序里读到什么。Tiptap 的 Link 自带“单击选中整条链接”（`enableClickSelection`）在点击处理时读的是点击之前的选区：DOM 用例先把光标放进链接再调处理函数，一直通过；真实 Chrome 里点一条链接，选中的是之前光标所在的那条（w00025 t09，写 e2e 时才发现）。接入这类库的交互时，e2e 里用真实的点击、按键与系统剪贴板接口走一遍，并从页面读编辑器的状态（`[data-editor-prose]` 元素上的 `editor.state.selection`）；光标先放在别处，再点目标。

**审查里“从代码推断、未验证”的结论，先写一条能失败的 e2e。** 审查者读 Tiptap 源码推断“只读文档里 Ctrl 点链接会被浏览器跟随、叠成两次打开”；第一版 e2e 只点了一次 Ctrl，改坏修复后仍然通过，等于没证明。把用例加强到能区分（先单击、再 Ctrl 点，数新开的页：不修时 3 个，修后 1 个），再对修复做变异检查（去掉修复、重建、用例失败，恢复后再通过），才算核实（w00025 t09）。结论成立与否都以这一步为准，不凭推断改，也不凭推断驳回。

**组件测试经 `@vue/test-utils` 的 `mount` 传入的属性会被深度代理。** 控件把编辑器实例这类带原生对象（`MutationObserver`、DOM 节点）的东西存进属性里的槽（`props.host.state`），重挂载时从代理里读出的实例会让原生方法报 `Cannot read private member`，生产里槽不是响应式的所以没事。存进这类槽的对象用 `markRaw` 标记，实例不被代理（w00025 t09，`MarkdownControl.vue` 的实例槽）。

**测“换文档”的组件测试，由父组件持有当前绑定。** 组件的属性里带 `ref`（例如编辑器区交给控件的文档绑定）时，`@vue/test-utils` 把这个属性另存，`setProps` 改不到，测试会一直停在第一份文档上、断言照样跑完。像真实的父组件（`EditorGroup`）那样，用一个渲染函数组件持有当前绑定的 `shallowRef`，改它再等 `nextTick`（w00025 t20）。

**组件测试经用户操作触发子组件的事件。** 测父组件怎样处理子组件的事件（菜单项、确认框的确认）时，像用户一样打开菜单、点那一项，不对子组件 `vm.$emit`：直接发事件绕过了子组件真实的事件先后，界面坏着测试也照样过（w00032 t30：AlertDialog 先发 `update:open(false)` 再发 `confirm`，清空从没发出去）。happy-dom 里打开 nb-ui 的 DropdownMenu：聚焦触发器、发 ArrowDown、等几轮 `nextTick`，再到 `document.body` 里找 `[role=menuitem]`。

**等一步的结果时，等这一步特有的值。** 前一步留下的同类状态（说明、提示、计数）还在时，只等“有值”会在这一步还在途时就放行，下一步的操作被拦下或读到旧值；负载低时碰巧来得及，负载高时才失败。等这一步才会产生的码或键（w00032 t21：会话宿主的用例等 `notice !== undefined`，上一步被拒的说明还在；改成等 `conversation.history.unknown`）。

**e2e 量几何先等它稳定，判断消失不等元素出现。** 有过渡动画的布局（收起、展开、拖放收尾）在动画中途量到的矩形会把指针放到别处：先等可观察的终态（例如收起的分节缩到 32px）再取矩形。判断元素消失用 `toHaveCount(0)` 或在页面里直接读，不用 `locator.boundingBox()`：它会一直等元素出现，元素不在时等到超时。

**e2e 按坐标操作前先把目标滚进视口。** 用 `boundingBox` 算出坐标、再派发指针或触摸事件之前，先 `scrollIntoViewIfNeeded`，再断言 `toBeInViewport()`：`toBeVisible` 不管滚动容器的裁切，虚拟列表在视口外多渲染的行它也算看得见，坐标却落在列表外面。同一个文件里前面的用例往同一个目录写过文件时，行会往下移，单独跑能过，整份文件跑才失败（w00026 t24：触摸拖动的用例整份文件跑了三次，三次都失败）。

**e2e 用例写的文件用完就删，不往共用的文件里打字。** 一份 e2e 文件里每个用例往作品的同一个目录写自己的文件时，在 `afterEach` 里删掉这一例写的文件（经辅助打开的与直接写盘的都算）：资源树是虚拟列表，文件越积越多，靠后的用例要打开的那一行排到渲染范围外面，找不到行直到超时（w00025 t17：`markdown-editing` 跑到“拆分后”一例时，`notes/` 里它前面排着 37 个文件）。往前面用例也在用的共用文件里打字同样会串：缺省的失焦时自动保存会把打的字写进磁盘，后面读这个文件的用例拿到的不是初始内容（同一 Task：“离开页面”一例读到前面一例打进 `b.md` 的字）。要编辑就写自己的文件。

**e2e 判断“没被裁掉”不靠 `click`。** 要证明一块伸出去的内容（抽屉、压在相邻面板上的层）没被祖先的 `overflow: hidden` 裁掉时，`click()` 成功、`boundingBox`、`toBeVisible` 都不算数：被裁切时三样照过，`click` 会先把目标滚进那个裁切的容器（`overflow: hidden` 的盒子可以被程序滚动）再点。在页面里取目标的矩形，断言 `document.elementFromPoint(中心)` 是目标或它的后代，再点；写完做变异检查（w00043 t18：把 nb-layout 的“面板不裁切”改回裁切，窄版抽屉的用例照样通过，在开发服务上截图才看到抽屉整块不见）。

**e2e 默认减少动态效果。** 应用的 `playwright.config.ts` 设了 `reducedMotion: "reduce"`：约 113 个用例在程序开关后马上量几何，470ms 的外框过渡会让它们量到中间值。测动画，或测动画窗口里的竞态（退场中点击、关闭动画结束后的焦点）的用例，开头写 `page.emulateMedia({reducedMotion: "no-preference"})` 开回来，否则时长令牌是 0，用例还是绿的，但不再覆盖要防的东西。

**e2e 测失去指针捕获要先让捕获生效。** `setPointerCapture` 与 `releasePointerCapture` 都在下一个指针事件时才生效：过了起拖门槛不再动就释放，捕获根本没到位，浏览器不派发 `lostpointercapture`；用例只靠 Chrome 在布局变化后补发的移动碰巧通过，负载高时才失败。先移动一下再释放，释放之后再移动一下让事件派发出来。

**e2e 里用键盘选字之后，先等选区同步再按快捷键、粘贴或打字。** ProseMirror 经 `selectionchange` 异步同步选区，机器忙时它还停在上一个字：粘贴只换掉前四个字，快捷键对着只选了一个字的选区，用例偶发失败。先等 `window.getSelection().toString().length` 等于要选的字数，再等两帧（w00025 t22，`markdown-comments.e2e.ts` 的 `syncedSelection`）。

**e2e 里的输入法。** CDP 的 `Input.imeSetComposition` 不替换选区：有选区时组字文字插在选区前面，选区原样还在；带 `replacementStart`、`replacementEnd` 时它们是相对光标的字符偏移，会把选区之外的字一起换掉。它能验证“组字不弹别的东西”，`Input.insertText` 能验证“一次提交一段字会替换选区”；选中一段文字后直接用输入法替换，要真人用系统输入法试，证据记为“未验证”，不拿 CDP 的组字冒充（w00025 t22）。

**测试起的资源要收口。** 测试起的资源（子进程、应用实例、数据库连接）在用例失败时也要收口，在 `afterEach` 里停止并核对正常关闭；用标准输入作为停止通道的子进程，测试进程退出时会自动停止。删掉临时目录不等于关闭了其中的文件。

**异步建立的订阅测两种顺序。** 订阅或监听的建立是异步的，测试要覆盖两种顺序：第一个事件先于建立返回到达，以及订阅在建立返回前就结束（例如在第一个回调里停掉提供方）；并核对结束只通知一次、之后不再收到事件。

**测量不改变被测结果。** 性能测量在页面里汇总，只把结果传回测试进程，不反复序列化不断增长的记录；读内存前清掉测量代码自己的缓冲。观察器有上报阈值时（如 Event Timing 的 `durationThreshold`），另行统计事件发生的次数，“没有超阈值的条目”才能作为达标的证据，而不是事件根本没发生。

**测量的样本与声称的场景一致。** 测量证据写明样本的实际内容；要报数的每个场景（例如崩溃后恢复、带工具的历史）各有对应的样本，不拿一个场景的数字代表没测到的场景。

**种子网每轮多跑一次。** 按种子随机造数据的测试（种子网）提交时只固定少量种子；每轮审查前与收口时，临时把种子数放大十倍跑一次（不进提交）。新出的失败先分清是产品的问题，还是生成器的真值与它造出的数据对不上：生成器的真值依赖“写入真的生效”时（例如一条计划套上了），在生成器里用真实实现核对一遍，对不上就报错，不让真值悄悄错。（w00039 t35：40 个种子都过，400 个找出两类真问题；还有一次是生成器造的计划因重复的一行没套上。）

**变异检查。** 核心逻辑在交付前，对验收映射里每条判据做一次变异检查：改坏实现，确认对应测试失败后恢复；验收映射里列出的测试文件和用例与实际不符时，先补测试或改计划。改坏之前先提交，或备份要改的文件、用备份还原；不用 `git checkout` 还原，它会把同一文件里没提交的修改一起丢掉。

**构建会改写素材，校验要用构建产物走一遍。** 素材（SVG、小图）经打包器内联或转码后，到浏览器的内容可能与源文件不同（例如 vite 把小 SVG 内联成 data 地址，属性引号由双引号变成单引号）。对这类素材的校验器，单元测试读源文件不够，要有一条 e2e 让真实构建产物里的素材走一遍整条路径（取回、校验、写入）。

**e2e 里拦请求与量布局。** `page.route` 的通配符以 `*` 结尾才匹配带查询串的地址，否则请求没被拦住，看起来像产品行为异常；已拦住的请求在同页导航时不会重新触发，要重走就在同一个上下文开新页。元素带动画时，外接框（`boundingBox`、`getBoundingClientRect`）随缩放与翻转变化，量布局尺寸用 `offsetWidth`、`offsetHeight`，居中看外接框中心（缩放与旋转绕中心）。

**覆盖率用来找缺口，不设门槛。** 看哪些失败路径没测、为什么没测。Bun 只报函数与行覆盖率，子进程里执行的代码也不计入，数字会低估进程级测试。

**机检规则。** `governance:check` 检查测试文件（`*.test.ts` 与浏览器 e2e 的 `*.e2e.ts`，`scripts/ci/test-conventions.ts`）：`packages/neuro-book` 与 `packages/nb-runtime` 违反即失败，其它包给警告。

| 规则 | 拦截 | 代替做法 |
| --- | --- | --- |
| `module-mock` | `mock.module`、`vi.mock`、`jest.mock`，以及替换全局的 `vi.stubGlobal`、`vi.stubEnv` | 真实实现，或对过契约的替身 |
| `spy` | `spyOn` | 断言可观察结果 |
| `fixed-wait` | 非零延迟的 `Bun.sleep`、`setTimeout`，Playwright 的 `waitForTimeout` | `waitUntil` 或注入时钟；e2e 用 Playwright 的自动等待与 `expect.poll` |
| `fake-timer` | `vi.useFakeTimers`、`vi.advanceTimers*`、`vi.runAllTimers`、`setSystemTime` 等改写全局时间的假计时器 | 把时钟作为参数注入 |
| `focus-or-skip` | `it/test/describe` 的 `.only`、`.skip`、`.todo` | 按条件跳过用 `skipIf`、`runIf` |
| `snapshot` | 快照断言 | 断言具体字段 |
| `llm-credential` | `*.llm.test.ts` 以外读取模型凭据 | 放进 `*.llm.test.ts` |

确有理由的例外在同一行或上一行写 `// test-lint-allow <规则>: <理由>`；整个文件都是规则样例时在文件开头写 `// test-lint-allow-file: <理由>`。理由不能为空。

**什么时候写测试。** Spec 的验收场景与失败方式、公开合同、边界与上限、并发与顺序、资源释放必须有测试；低风险、可逆的小改动不为“有测试”而新增测试。

## 测试分类与运行

按成本与外部依赖分类，而不是按“单元 / 集成”分：

| 类别 | 内容 | 包脚本 | 什么时候跑 |
| --- | --- | --- | --- |
| 快速 | 同进程测试与几十毫秒级的子进程测试；可以用真文件、真端口 | `test` | 每次改动，按受影响范围 |
| 服务进程 | 每个测试文件起被测的服务进程，只经 HTTP 与命令行；真端口、真 SQLite 文件（官方站的 `nb-site-contract-tests`） | `test` | 同快速类，按受影响范围；CI 的 `check` 作业经依赖图选中，`site-image` 作业对着打好的产物再跑一遍 |
| 浏览器 E2E | 真浏览器，从用户入口到可见结果 | `test:e2e` | Task 验收，本地跑（CI 不跑） |
| 真实模型 | 调用真实模型，见下一节 | `test:llm` | 显式运行，按受影响范围增量 |
| 评测实机 | 开发用评测（`packages/neuro-book/evals/`）里要真 Chrome、真 bwrap、另起进程控制环境或要等真实时长的用例：文件命名 `*.live.test.ts`，用 `describe.skipIf(process.env.NBOOK_EVAL_LIVE !== "1")` 包住 | `eval:live` | 改到评测的运行器时显式运行；默认的 `test` 与 CI 里显示为跳过 |
| 全量 | 以上全部 | — | 手动；CI 手动触发时跑全部包的快速类 |

浏览器 E2E 由 Playwright 在 Node 中运行（Bun 下启动浏览器时 CDP 握手会超时），用本机安装的 Chrome（`channel: "chrome"`），不下载 Playwright 自带的浏览器；文件命名 `*.e2e.ts`，与 `bun test` 的 `*.test.ts` 分开。被测服务由用例自己启动与停止，以便断言停止顺序与退出码。包脚本 `test:e2e` 自己构建；直接跑单个文件（`npx playwright test -c e2e/playwright.config.ts <文件>`，不带 `-c` 会报 “No tests found”）时不构建，改过前端或插件源码后要先把 `build:server`、`build:web`、`build:e2e` 三份产物都重建（带探针的宿主服务的是 `dist/e2e/web`，只重建前两份时它仍是旧页面，几十个用例一起失败、看起来像产品缺陷）。

官方站的浏览器 E2E 在 `packages/nb-site-web/e2e/`，配置与假接口也在那里，与应用的那份互不引用；包脚本 `test:e2e` 先构建再跑，端口用 `NB_SITE_WEB_E2E_PORT` 改（几个检出同时跑时各给一个）。多数场景对着构建产物与假接口（`e2e/fake-api.ts`，回答按合同的 schema 写）。真实冒烟在 `e2e/real/` 下，起真实的 `nb-site-server`，要求本机已能构建服务端与前端的产物；服务端只认 https 的站点地址与带 `Secure` 的 Cookie，冒烟用测试里的转发让浏览器看到 https 地址，做法写在那份 e2e 的文件头；只跑一种用 `--project fake` 或 `--project real`。

快速类单个测试的预算是 200 毫秒。`test:affected` 运行结束时列出超出预算的测试；超出的原则上改快（多半是固定等待或不必要的大数据），确实需要慢的（如性能基准）写明原因。

`bun run test:affected` 的选择方式：

- 缺省按改动：改动所在的包，加上直接或间接依赖它的包；根 `scripts/` 或根 `package.json` 有改动时加上根脚本测试（`.github/` 的 Issue 表单与标签由 `governance:check` 检查）；`bun.lock`、`bunfig.toml` 或 `patches/` 有改动时选中全部。`--since <rev>` 再算上与 `<rev>` 分叉以来的提交，`--all` 选中全部。
- `--package <名>`（可重复）：不看改动，只测指定的包，`scripts` 指根脚本测试；加 `--with-consumers` 连同依赖它的包。新增 workspace 包会改 `bun.lock`，缺省方式因此选中全部；这时改用 `--package <新包> --with-consumers`，每个包各写一次 `--package`（不收逗号分隔）。
- `--tier fast|e2e|llm`：运行哪一类，缺省 `fast`。
- `--files`：改动所在的包只跑受影响的测试文件（测试脚本是单条 `bun test` 时追加 Bun 的 `--changed`；写成 `bun run a && bun run b` 时逐步运行，其中单条 `bun test` 或 `vitest run` 的一步各自追加 `--changed`）。Bun 按导入关系选文件，不跨包追踪，依赖方的包仍整包运行；只经路径启动的文件（例如子进程入口）改了也选不到，扫描源码而不导入它的检查（例如 `packages/neuro-book/src/architecture.test.ts` 的依赖方向）也选不到，提交前去掉 `--files` 再跑一次（w00032 t22：类型从 `backend` 挪进 `shared` 时手挑测试文件，漏了这条检查）。
- `--typecheck` 同时跑类型检查，`--dry-run` 只列出选中项和原因。
- 旧应用不参加；准备退役的 `llmlint` 选中了也不跑，在跳过里写明理由。

包内再缩小到文件时，在包目录把测试文件路径传给 `bun run test <路径>`。在命令行给 `bun test` 传 `--path-ignore-patterns` 会盖掉 bunfig 里的同名设置（例如排除 DOM 测试的那条）；只想缩小范围时直接传测试路径。

### 服务进程测试

起被测服务进程、只经 HTTP 与命令行断言的测试（官方站的合同测试，底座是 `packages/nb-site-contract-tests/src/testing/site.ts`）：

- 起进程、跑命令放在 `beforeAll` 里，用例本身只发请求、读结果：Bun 的 junit 报告不把钩子的耗时算进用例，单个用例仍守 200 毫秒的预算。用例里非起进程不可、或要等被测程序自己的时限（例如就绪结果的复用窗口）的，在用例旁写明原因。
- 每个测试文件一个 `createTestTmpRoot`，各用例在根下建自己的数据目录；文件结束时先停进程再删根。
- 端口给 0，从被测程序的监听日志读实际地址，不先探一个空端口再交给子进程；就绪按 `/health/ready` 等到 200（`waitUntil`）。例外是断言“始终没监听”的负向用例（配置不合格的几条）：它们先让系统挑一个空闲端口再放掉、交给子进程，退出后核对那个端口连不上。局限：放掉之后到子进程启动之间别的进程可能占去这个端口，概率很小；子进程短暂监听又关掉也查不出来，要证明“从没监听过”得跟踪系统调用。
- 停止发 `SIGTERM` 并核对退出码；用例里起、没停的进程在 `afterEach` 里停掉，`beforeAll` 里起的在 `afterAll` 里停掉，`process.on("exit")` 对还活着的 `SIGKILL` 兜底；测试进程被 `SIGTERM`、`SIGINT` 取消时，底座先 `SIGKILL` 还活着的子进程，再按原信号结束自己。测试进程自己被 `SIGKILL` 时子进程会留下，按进程号结束。
- 子进程的环境只给明确列出的变量（`PATH`、`HOME` 与 `TMPDIR` 指向临时根下的空目录，加被测程序的配置），不继承测试进程的环境；工作目录是临时根。Bun 进程带 `--no-env-file`，否则它会读工作目录的 `.env`。
- 被测程序经路径启动，`--files` 选不到它：改了入口或模块后去掉 `--files` 再跑一次（见上面 `--files` 一条）。

## 真实模型测试

- **命名与开关**：会调用真实模型的测试放在 `*.llm.test.ts`，用 `@notnotype/neuro-book-test-support/llm` 的 `llmTestConfig()` 取配置，并以 `describe.skipIf(config === null)` 包住。只有显式设置 `NBOOK_LLM_TESTS=1` 才运行，是否调用模型由运行者的意图决定，不由环境里碰巧有没有凭据决定。包脚本 `test:llm` 设置开关并只运行这些文件；默认的 `test` 里它们显示为跳过。
- **凭据**：先看进程环境，没有时只从仓库根 `.env` 读 `DEEPSEEK_API_KEY`、`DEEPSEEK_API_BASE`、`REAL_MODEL_SMOKE_MODEL` 三个键；`REAL_MODEL_SMOKE_MODEL` 可覆盖模型（缺省 `deepseek/deepseek-flash`）。凭据不落盘、不打印、不进用例名。开关打开却缺凭据时用例跳过，证据记为“未验证”，不写成通过。
- **断言**：断言结构化结果（状态、字段形状、工具调用、落盘内容），不断言措辞。
- **何时运行**：真实模型调用会产生费用，运行前取得开发者授权（见 [`.omp/RULES.md`](../../.omp/RULES.md)）。改到模型相关代码的 Task 验收时，用 `bun run test:affected --tier llm`（加 `--files` 只跑受影响的文件）；CI 不运行（没有外部凭据）。
- **隔离**：测试使用独立的临时根；写入的配置只落在本次运行的隔离根内，结束时删除。

## 临时目录与环境键

1. **测试临时根统一在 `<系统Temp>/neuro-book/vitest/<runId>/`**：
   - 由 `@notnotype/neuro-book-test-support/vitest` 在每个 Vitest worker 启动时把
     `TMPDIR`/`TEMP`/`TMP` 指向该目录；测试里 `os.tmpdir()` / `mkdtemp(tmpdir()...)`
     运行期自动收敛；
   - 受控根不放在仓库 `.agent/tmp`：worktree 深路径叠加测试内部 UUID 目录名会超过
     Windows MAX_PATH（git 对象与 release staging 报 "Filename too long" /
     ENAMETOOLONG），系统 Temp 路径最短且 OS 会定期清理；
   - 每次 run 结束由 `@notnotype/neuro-book-test-support/vitest` 的 teardown 删除
     本 run 目录；并行 run 因 runId（8 位 hex）互不干扰；进程被强杀时由下一次 run 的
     setup 按 24 小时超窗兜底回收；
   - 所有 Vitest 配置的 `setupFiles` 第一项必须是该 setup 文件、`globalSetup` 必须包含
     该 globalSetup（含独立包配置）。
2. **测试自身必须清理自己创建的目录**：`afterEach` 收集并 `rm`。清理失败视为测试问题，
   不依赖全局清理兜底。
3. **进程被强杀等异常残留**由 `@notnotype/neuro-book-test-support/tmp` 的
   `sweepStaleTmpRoots()` 在每次 run 起点回收：只删除带合法 owner marker、超过 24 小时且
   owner 进程已死的真实目录；无 marker、symlink/reparse point、普通文件、窗口内目录和活跃
   owner 一律保留并报告。新增测试根使用 `createTestTmpRoot(name, purpose)`。
4. **禁止在仓库根、`.worktree/`、快照目录或系统 Temp 根直接创建业务临时数据**；仓库根下的
   `cache/`、`workspace/`、`logs/` 等业务目录不能被测试写入。
5. **脚本（非测试）的临时数据**使用 `@notnotype/neuro-book-test-support/paths` 分配的系统 Temp
   子目录，并且必须在 `finally` 中清理。
6. **验收/沙盒脚本**默认输出到 `<系统Temp>/neuro-book/acceptance/` 或 task/run 专用子目录，
   禁止把用户公共目录写为默认值；需要仓库外路径时通过参数显式传入，并打印实际路径。
7. **公开环境键由测试支持包拥有**；被测程序的命令这类只属于某个测试包的键由那个包拥有，Owner 一列写明：

   | 环境键 | Owner 与约束 |
   | --- | --- |
   | `NBOOK_HOST_SYSTEM_TEMP_ROOT` | `neuro-book-test-support` 的宿主 Temp locator；只供隔离测试或验收宿主注入绝对路径 |
   | `NBOOK_AGENT_TEMP_ROOT` | Agent 测试、fixture、cache、scratch 与 acceptance 的共同父根；必须是宿主 Temp 内的绝对真实路径 |
   | `NBOOK_AGENT_WORKTREE_ROOT` | governance/worktree 工具的 repo-relative locator；默认 `.worktree`，不得指向包源码或运行数据根 |
   | `NBOOK_TEST_TMPDIR` | Vitest global setup 为单次 run 写入；必须包含在 `NBOOK_AGENT_TEMP_ROOT` 内，普通测试不得长期覆盖 |
   | `NB_SITE_SERVER_COMMAND` | `nb-site-contract-tests`：被测的官方站程序，JSON 数组形式的 argv（例如 `["bun","--no-env-file","/abs/server.js"]`）；没设时用本仓库 `nb-site-server` 的源码入口，设错时测试报错、不退回缺省 |
   | `NB_SITE_PREVIOUS_SERVER_COMMAND` | `nb-site-contract-tests`：上一个发布版本的程序，形式同上；只给相邻版本测试用，没设时那一组跳过并在组名里写明 |
   | `NB_SITE_PREVIOUS_WITHOUT_INGEST`、`NB_SITE_PREVIOUS_WITHOUT_TELEMETRY_JOBS` | `nb-site-contract-tests`：上一个版本还没有统计的写入口、还没有统计的两个定时任务；`1` 时相邻版本测试跳过那一项并在用例名里写明，没设、空或 `0` 时照测，别的值报错。由 `nb-site-server` 的 `build:previous` 按基准提交的源码给出 |

## 测试文件组织

- 测试文件与被测源码同目录，命名 `<module>.test.ts`；服务端需要 JSX 时用 `.test.tsx`；真实模型测试用 `<module>.llm.test.ts`；新应用的 Vue 组件测试用 `<module>.dom.test.ts`。
- **`testing/` 目录**放测试支持代码：测试工具、测试插件与测试入口、多个测试共用的场地（例如 `packages/neuro-book/src/plugins/storage/testing/world.ts`）、e2e 外壳。它可以带参数，但不含断言：断言写在测试文件里。产品代码不引用 `testing/`，也不引用内核的 `*/testing` 入口（`@notnotype/nb-runtime/lifecycle/testing`、`@notnotype/nb-runtime/remote/testing`）；唯一的例外是 e2e 构建配置（`vite.e2e.config.ts`）引用 e2e 外壳。`packages/neuro-book` 由 `src/architecture.test.ts` 检查。
- 新应用与新包用 Bun 自带测试器（`bun test`）。例外是新应用的 Vue 组件测试：Bun 不能加载 `.vue`，`*.dom.test.ts` 由 Vitest 在 happy-dom 里运行（`packages/neuro-book/vitest.config.ts` 沿用前端的 Vite 配置），包内 `bunfig.toml` 让 `bun test` 跳过它们，包脚本 `test` 依次运行两者；需要真实布局的交互走 Playwright；读样式表（`document.styleSheets`、`cssRules`）的行为也走真实浏览器：happy-dom 解析样式表时整块丢掉 `@layer`，而 Tailwind 生成的图标与工具类规则都在 `@layer` 里，在它里面测出来是空的。以下 Vitest 条目适用于这部分组件测试与仍用 Vitest 的既有包。
- 新应用里 `src/plugins/*/web/**/*.test.ts` 与 `*.dom.test.ts` 一样按浏览器类型配置检查（`tsconfig.browser-test.json`，带 DOM 库、没有 Bun 类型）；要导入服务端代码或 Bun API 的测试放在插件根目录（`src/plugins/<插件>/<module>.test.ts`），不放 `web/` 下。
- 每个 Vitest 配置显式声明 `root`（仓库根或包根），不依赖 `process.cwd()`；include 覆盖
  该作用域内全部测试文件。
- Vitest 包的全量测试统一用包脚本 `bun run --cwd packages/<pkg> test`（node 运行时）。`bun --bun` 直接运行 vitest 时部分依赖
  （如 zod）的 CJS/ESM interop 与 node 不同，过滤单文件可能误报
  `zod does not provide an export named 'z'`；以 node 运行时为准。Vitest 的用例（含 `scripts/` 的测试）跑在 Node 上，
  不用 Bun 专有的 `import.meta.dir`、`Bun.file` 这类接口，路径用 `fileURLToPath(import.meta.url)` 求：在 Node 下
  `import.meta.dir` 是 undefined，拼路径时抛 `ERR_INVALID_ARG_TYPE`（w00043 t18 的发布包用例，2026-11-25 演练的 CI 挂在这里）。
- 测试含宿主专有模块的入口时，在对应宿主的真实子进程中验证行为；不要直接导入另一宿主的测试运行器，以免模块加载失败替代业务回归。
- 新增测试目录（如新 `scripts/<area>/`）必须同步加入对应配置的 `include`，否则测试
  永远不运行——「写了但从不跑」比没有测试更危险。
- 测试导入使用与源码一致的 `nbook/*` / `#manager/*` 别名，不使用跨项目相对路径。

## 平台与 CI

- 依赖 Windows 路径语义的测试用 `it.runIf(process.platform === "win32")`，其余平台跳过；
  POSIX 独有的信号语义测试用 `it.skipIf(process.platform === "win32")`。
- 测试不得依赖本机用户目录、`Program Files`、`C:\t145-*` 等机器特定路径；需要真实目录
  时全部使用 `mkdtemp(tmpdir()...)`（受控根）。
- CI（`.github/workflows/ci.yml`）在推 master 与 PR 上把下一节的验证门禁在干净机器上再跑一遍：`governance:check`、`docs:check`、
  `test:affected --typecheck`（基准是 PR 的 base 或推送前的 master，取不到共同祖先时跑全部），另一个 job 打应用包与 SDK
  并跑 `smoke:server`。e2e 与真实模型测试不在 CI 里跑。
- 改了 `.github/workflows/` 就跑 actionlint：`actionlint .github/workflows/*.yml`（没装时 `go install github.com/rhysd/actionlint/cmd/actionlint@latest`，直连慢加 `prox`，不进仓库依赖）。它认不得的新写法先对照 GitHub 文档确认，再用 `-ignore` 放过那一条并在工作流里注明（`release.yml` 的 `concurrency.queue`）。
- 干净机器上没有 `.nuxt/tsconfig.json` 这类生成物：相关测试配置使用独立的 esbuild transform（`oxc: false`），不依赖
  Nuxt prepare 的产物。

## 验证门禁

- 实施前确定当前目标的可观察行为、直接受影响边界与完成证据；有 Task 时写入快照，否则使用会话计划，不强制创建额外文件。
- 纯文档修改检查链接、结构与语义，不运行产品测试、typecheck、构建或浏览器；治理脚本变化仅运行直接相关脚本测试与类型检查。
- 实现变化运行受影响既有测试；类型表面改变才运行对应 typecheck。工具只支持全应用检查时运行一次，区分本次诊断与已有基线，不借失败扩大修复范围。CSS 生成物按包合同构建。
- 受影响的测试用 `bun run test:affected` 选出并运行，选择方式见[测试分类与运行](#测试分类与运行)；不默认跑全量。它缺省只看还没提交的改动：在分支上收口、合入前验证时改动都已提交，不加 `--since master` 就一条也选不到（w00026 t25）。
- 改了 `packages/nb-layout/src` 就在 nb-layout 下跑 `bun run api:check`：它先构建，再与入库的 `api/*.api.txt` 比，公开面变了照提示用 `api:report` 更新、与改动同一个提交（包的 `AGENTS.md` 的“稳定性标注与 API 报告”）。插件 SDK 转出的 nb-layout 名字变了，应用的 `src/sdk/sdk.test.ts` 会失败，照提示判断要不要提兼容起点（w00026 t48）。
- 浏览器 e2e 由 `test:affected` 选不到文件（`--tier e2e` 是整包），靠人挑：改了什么就跑覆盖它的文件。合入前的清单只跑一次，之后只重跑覆盖改动的文件和失败项；开第二轮大范围前先说清哪条证据失效了，说不出就不跑。已知会因别的 Work 失败的文件不跑了再读结果。大范围 e2e 跑着的时候不改清单里的测试文件、不重新构建：一个 worker 时测试文件是跑到它才加载的，构建产物也是边跑边读，中途改了，后面跑的已经不是开始时那份代码（w00025 t04）。
- `packages/neuro-book` 的 Playwright 配置替这条把关：一次选中超过 8 个文件时拒绝运行（`e2e/wide-run-guard.ts`，整包也算；`--last-failed`、`--list`、`-g` 放行），确实要大范围跑时命令前加 `NB_E2E_WIDE="这轮要消除什么不确定性"`，理由打印在日志里。写理由时写具体的不确定性，“最后验证”不算。
- Playwright 的输出目录（失败用例的 trace 与错误现场、`--last-failed` 读的 `.last-run.json`）按检出分开，在 `<系统Temp>/neuro-book/playwright/<套件>/<检出名>/` 下，检出名是检出目录名（截到 24 个字符）加整条路径的哈希前 8 位（`@notnotype/neuro-book-test-support/paths` 的 `resolveAgentPlaywrightRoot`，`neuro-book` 与 `nb-story` 两份配置都用它）。几个 worktree 同时跑 e2e 不会互相清掉失败现场，`--last-failed` 只读本检出上一次的失败。同一个检出里每次开跑仍会清空自己的目录：要留的失败现场先拷走，或先看完再开跑（w00025 t24；此前各检出共用 `playwright/neuro-book`，t17 收口时失败现场被别的会话清掉）。
- 新增默认显示的视图、活动条目或设置项时，受影响范围要包括假定初始布局的外壳 e2e（`workbench-*`、`plugins`）；新增或改动 Lab 场景的组件，还要跑 `lab-scenes`。
- lab-scenes 被与本 Task 无关的既有失败（加载失败、页面错误）挡在版面检查之前时，新增或改过的场景用 `nbdev shot` 截图，报告里的 `measure`（越界、光晕与外扩环被裁）与 lab-scenes 是同一套测量，可代替重跑。
- 提交前先看到验证结果：测试与提交不写在同一条命令里。
- 改了 e2e 或测试文件，也要在最后一次改动之后重跑类型检查：`tsconfig.browser-test.json` 覆盖 `e2e/` 与 `*.dom.test.ts`，Playwright 与 Vitest 的转译不查类型，用例跑得过不等于类型检查过（w00025 t22：最后一轮改 e2e 之后没有重跑 `typecheck`，实现审查才发现 `offsetWidth` 在 `HTMLElement | SVGElement` 上报错）。
- `docs:check` 与 `governance:check` 的失败始终检查全仓；警告默认只逐条列出未提交改动涉及的文件，其余合成一行计数。上面三个命令都按同一改动范围工作：默认是未提交的改动（含未跟踪文件），`--since <rev>` 再算上与 `<rev>` 分叉以来的提交，`--all` 不按改动裁剪。
- 局部 UI 按 [UI 验收分档](#ui-验收分档) 取证，不为超出该档的覆盖额外加测；改动面更广或存在具体未解风险时，说明要消除的不确定性再扩大；不因“最后验证”默认跑全主题、全库测试或生产构建。UI、迁移、集成和发布的既有授权边界不变。
- 长期测试按[测试写法](#测试写法)保护可观察合同、边界与时序。用户报告的现象作为事实处理；bug 修复的测试按该节“bug 修复的测试”判断加在哪里，没有合适切入点时以聚焦 smoke 说明缺口。
- 打包、发布和 CI 相关的验证在主工作区或干净克隆里跑：`.worktree/<名>` 往上两层就是主工作区，按错误基准解析的相对路径会碰巧落到主工作区的文件上，在 worktree 里看不出来（w00027 t15 应用包打包的教训）。
- 失败先区分产品、测试模型和环境，修直接根因后只重跑失效项。后续代码／环境变化使证据失效、真实失败或新增具体风险才重跑或扩大；叙事更新与新 revision 本身不使有效证据失效。
- 性能断言失败或用例等待超时时，先在同一负载下做对照（拿掉本次改动再跑，或在分支基点上跑），再判断是不是本次改动造成的；不要只凭重跑一次过了、或基线在另一种负载下过了，就下结论。
- 证据文件里记录的命令要能原样重跑出其中的结果；用了过滤或统计的，把完整命令写进去，不用占位说明代替。
- 当前目标的所需证据齐全且无范围内未解决缺陷即交付，不为更多截图、报告格式或各 Skill 清单继续检查。命令结果与覆盖边界以文字摘要写进 Task 一次；完整截图集与原始输出按复现或交接需要保留在本地 `.local/agent/works/<workId>/tasks/<taskId>/`，少量精选截图与不可重现的测量数值作为证据入库，体积上限见 [本地与入库](../../.agents/works/README.md#本地与入库)；必要但不可恢复的工具输出保留最小持久副本，不默认新建证据包。
- 验收脚本在构建失败等原因导致检查没有执行时，必须以非零退出；调用方除了看退出码，还要核对报告里没有未判定的项。
- 用验证结果决定后续步骤（提交、合入）时，按验证命令自己的退出码判断，不经管道截取输出后再接 `&&`。
- `git rebase`、`git merge` 之后先确认成功再构建和测试：串在一条命令里时，冲突的工作树照样往下跑，构建失败或测试结果都作废（2026-11-06 一个下午发生两次）。
- 提交前单独运行 `git diff --cached --check`，不用 `&&` 接提交：它报错时提交静默不跑，容易以为已经提交。既有失败与本次失败分开报告，不能把“focused 通过”写成“全量通过”；远端登记 Issue 仍需授权。

## 浏览器工具

- 优先使用宿主内置、运行在隔离浏览器配置中的浏览器自动化（如 OMP 的 `browser.open`、`tab.observe`、`tab.run`）。宿主没有这类能力、内置能力存在具体缺口或用户指定 CLI 时，使用 `playwright-cli`。
- 页面业务失败不构成换工具的理由；先区分产品、环境和工具问题。任何浏览器工具都不自动授权安装依赖、修改全局配置、接入用户日常浏览器及其登录态或迁移数据；直接驱动用户浏览器的集成（如 Claude Code 的 Claude in Chrome）只在用户明确要求时使用。
- 普通 UI 运行验证不自动升级为完整人工评测：Agent 用上述工具自检属日常验证，不需要额外授权；用真实数据跑完整用户旅程的人工评测需单独取得授权，不得用 focused 测试冒充未执行的浏览器场景。

### UI 验收分档

浏览器取证按改动面分档，做到本档要求即可，不默认扩到全主题、全视口：

| 改动面 | 必备取证 |
| --- | --- |
| 普通 UI 改动 | 走实际交互路径（点击、输入、跳转等），核对一个代表状态 |
| 主题变量或窄屏布局 | 追加受影响的主题组合或 390px 视口 |
| nb-ui 共享基础组件 | 主题轴 × 配色轴四组合（nbook/macos × light/dark），外加 390px 视口；新组件另在减弱动效与减弱透明度下各截一次（`lab:shot --media`，设计语言“六、无障碍”） |

- 每项给出实测结果（元素计算样式 ↔ 同名变量解析值、几何、交互前后差异），不用静态推断或截图观感冒充实测；所用工具做不到时按本节首条改用备用工具，仍做不到的如实说明未做。
- 会自己消失的界面（一次性通知缺省 3.2 秒后消失）不靠 UI 自动化或截图去赶：验收以产品留下的可持久信号为准（页面交回宿主后写的诊断、状态文件），读到文字只作补充证据；产品没有这种信号时，在被测代码里加一条 info 诊断（w00046 t11 的更新冒烟：每次起 PowerShell 读窗口，240 秒没赶上“已更新到”）。
- 有过渡的切换（出现与消失、换内容，尤其放在 `Transition` 里的）在开发服务的真实页面上点一遍，浏览器不减弱动效：e2e 跑的是生产构建、并且减弱动效（`reducedMotion: "reduce"`），dom 测试里 `@vue/test-utils` 缺省把 `Transition` 换成直接画出子节点的替身，这两层都看不到开发构建里过渡收不了尾的问题（w00039 t40：组件模板根上多了一条注释，开发构建里“阅读 → 编辑”的先出后进过渡卡住、内容一直空着；生产构建剥掉注释，e2e 全过，开发者试用时才发现）。要长期看住的切换，dom 测试挂载时写 `global: {stubs: {transition: false}}` 用真实的过渡。
- 分档只决定取证范围；人工评测的授权要求见本节「普通 UI 运行验证不自动升级为完整人工评测」一条。

## 通用包测试合同（2026-09-11）

适用于 `packages/agent-*` 这类领域无关通用包；由 Issue #193 的 `D-TEST-01` 决定（记录见 `.agents/works/w00002-neuro-agent-harness-redesign/tasks/t01-product-host-success-research/walkthroughs/006-decision-record.md`）。与本文其余规则叠加；2026-10-03 起测试写法以[测试写法](#测试写法)为准。

2026-09-22 修订：运行器统一为 Bun 自带测试器，原“每包一份 `vitest.config.ts`、`setupFiles` 指向测试支持包”的要求作废；`nb-session`/`nb-profile`/`nb-harness` 已按 `bun test` 实现并发运。

- **先写测试**：新行为先写失败测试再实现；场景、失败方式与 bug 修复按[测试写法](#测试写法)。
- **只测关键**：覆盖公共合同、边界与上限、失败与恢复、并发与顺序、资源释放；不写镜像实现、措辞或框架行为的测试；不为可逆小改动强制测试。
- **Smoke 必测**：每个包至少一条 smoke（包入口可导入 + 一条最小真实路径）。
- **分层**：L1 纯函数单元 / L2 公共合同 / L3 组件集成（替身须与真实实现对过契约）/ L4 真实进程与 IO——包内必须有 L1–L3，L4 至少覆盖一条真实边界；L5 宿主验收不属于包。
- **放置与运行**：测试放在包内（`src/**` 或 `tests/**`，与被测源码同包）；运行器用 Bun 自带测试器 `bun test`，不引入 vitest 配置；包脚本 `test`/`typecheck` 可独立执行（`bun run --cwd packages/<pkg> test`）；导入使用包内相对路径或包名，禁止 `nbook/*` 等产品别名；不得依赖产品 workspace、Prisma 或 `@earendil-works/pi-*`。
- **真实 LLM 不 mock**：需要模型响应的测试调用真实模型，不伪造 API 数据；命名、开关与凭据见[真实模型测试](#真实模型测试)。
- **测试支持**：`@notnotype/neuro-book-test-support` 仅作 devDependency；包若离开本仓需自带等价物。

## Component Lab 夹具规范

1. **舞台画布（Stage Box）纯净性准则**：
   - 夹具在画布区使用 `data-lab-subject` 标记被测零件，Lab 据此画高亮描边。
   - **画布区严禁拼接非本组件自有的辅助 Chrome**：例如切换语言、外部更新、触发重做/撤销等测试辅助按钮，必须统一部署到 `<LabFixtureControls>` 中，由 Lab 底部抽屉面板通过 Teleport 承载，保持舞台画布（`data-lab-subject` 所在区域）仅呈现目标组件自身真实像素。
   - **单零件检视原则**：单个原子零件夹具（如 `EditorTabItem`）画布内仅呈现单一被测原子，严禁在原子夹具内私自拼接多项列表；细分状态一律通过数据属性、场景切换及 `<LabFixtureControls>` 交互开关表达。
2. **夹具定宽**：夹具给组件定宽时写 `min(<宽>, 100%)`，不写死像素：lab-scenes 在 390 宽的手机画布上挂每个场景，写死的宽度会溢出舞台。

## 用户视角人工评测

旧产品的人工评测体系（判定与证据合同、用户旅程、执行步骤与报告格式）已归档到 [`../archived/testing/manual-eval/`](../archived/testing/manual-eval/README.md)，只作参照；新应用的人工评测在功能足够后另行建立。
