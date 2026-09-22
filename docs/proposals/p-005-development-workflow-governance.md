# 开发流程与角色治理提案

状态：accepted

## 问题

NeuroBook 的开发治理曾把 PM、Leader、Tasker、Reviewer、Issue状态、Project状态、Proposal、Spec、Task和逐项授权串成近似状态机。职责虽清楚，但实际形成循环门禁：Leader需要PM先把Issue标为claimed，PM又等待Proposal/Spec/Task完整，而这些文档本应由Leader建立。大任务因此停在角色交接和元数据同步，而不是继续设计与实现。

另一个问题是Leader与Tasker的合同同时存在于聊天、Issue、Task和角色提示中。Tasker需要等待Leader实时解释，跨session恢复时又无法确定哪份计划有效。

本提案不改变NeuroBook产品功能或用户数据，只调整开发角色和文件工作流。
## 2026-09-21 当前决策

开发者批准协作规则与技能精简。本节及其链接取代下方历史角色流程、旧 Task 字段与远端登记前置；下方从“目标与非目标”起保留为历史演进，不作为当前执行门禁。

- [Work](../../.agents/works/README.md) 继续是 current Task 的容器，Issue 由 Work 可选引用；Task 使用无正式 role 的当前快照。主 Agent 可以直接实现，也可按独立边界委派，高风险按需独立审查。
- 新 Work 协调查重后本地登记即可隔离开发，登记随实现集成；不要求先提交、推送或进入远端 master。保护用户工作树，碰撞暂停冲突身份的集成。
- [专项 Skills](../../.agents/skills/README.md) 只补缺失方法；不建立总流程 Skill 或叠加完成门禁。验证以 [测试规范](../testing/README.md#验证门禁) 为唯一来源，所需证据充分即停止。
- 长期行为归 Spec／组件文档，Work 归范围与授权，Task 首页归当前状态与证据链接，历史与原始输出按需保存，不重复记账。
- 删除正式角色字段、CLI 参数和专用文案／源码镜像门禁；context JSON 切换为 `nbook.governance-context/v2`。保留 Work 身份、物理目录隔离、legacy provenance、ownership 和密封校验。
- Proposal 仍决定长期取舍，不自动授权执行或受限动作；用户决定产品取舍、风险接受、远端与不可逆操作。Task、CI、PR 完成不自动推进 Project Done。
- 历史 Task、worktree、branch、PR、walkthrough、ownership 和密封迁移 hash 不迁移、不重编号、不重算。

## 目标与非目标

### 目标

1. 使用开发者→Leader→Tasker→Leader→开发者的顺序主线，Agent主导执行，开发者监工并在明示节点辅助。
2. Leader直接管理重大Issue的设计、调研、Proposal、Spec、roadmap和Task，不等待PM。
3. Issue保存长期交付目标；Task是一次完整的`planned`人机协作合同，可关联一个Issue或作为无Issue本地工作。
4. Leader创建Task时明确Agent工作、开发者参与、任务产物、修改计划、完成门禁和Leader继续条件，派发后停止。
5. 普通Tasker实现、验证和报告偏差；research Tasker产生证据与决策材料；design Tasker形成指定Proposal/Spec草案。
6. 门禁依靠文件、自检和真实验证；本地可逆动作使用范围授权，受限动作仍分别授权。
7. 后续Task只在前一步结果确定后按需创建；roadmap保存候选阶段但不能执行。

### 非目标

- 不新增角色状态机、交接CLI、claims账本、权限沙箱或第二套Task schema。
- 不要求每项工作经过PM或独立Reviewer session。
- 不取消远端写入、合并、发布、部署、数据库迁移、真实Provider/Model、浏览器人工验收和数据删除的人类授权。
- 不批量改写历史Task和walkthrough。

## 真相源

- 开发者当前对话：产品目标、取舍、风险接受、实际观察/验证和受限动作授权。
- GitHub Issue：只为重大或长期交付保存公开目标、总体范围与非目标、验收、重大依赖、Task导航和交付状态。
- Proposal：需要开发者决定的长期方案和取舍。
- Spec：`planned`目标合同与`implemented`当前合同的唯一正文。
- roadmap：非绑定候选阶段与创建下一Task的触发条件；没有Task ID、状态、owner、允许文件或执行授权。
- Task README与`context.md`：一次派发的Agent工作、开发者参与、任务产物、修改计划、完成门禁、允许文件和恢复合同；创建即`planned`。
- walkthrough与evidence：追加式结果、开发者参与结果和证据。
- Project与PR元数据：排期和交付状态；不决定Leader能否开始本地编排。

Issue可以有`0..N`个Task；Task通过`actionIssueId`关联`0..1`个Issue。属于已有Issue验收范围的Task无论位于哪个root都写正整数编号；不值得创建Issue的本地治理、隔离实验和机械工作写`actionIssueId: null`。禁止统筹Task和Task父子状态。只有需要独立排期、独立验收或独立交付的结果才拆子Issue；调研、设计和编码默认在同一Issue下按真实结果逐个创建Task。

未获远端Issue写入授权时，Leader按`.agents/issues/README.md`维护唯一Draft-Key草稿。获授权后先查找精确Draft-Key：0个才创建、1个复用、多个阻塞；取得编号后创建当前唯一完整`planned` Task，闭合链接和授权记录后最后删除草稿。无Issue本地工作不创建Issue草稿。

## 决策

### 顺序主线

1. **开发者**批准重大目标和产品取舍，并在Task明示节点进行设计、实际观察/验证、产品判断、风险接受或受限动作授权。
2. **Leader**调查仓库，维护Issue/Proposal/Spec/roadmap，并按当前已知结果创建一个完整`planned` Task。
3. **Leader**派发后停止，明确对应`Leader 继续条件`的具体产物、开发者决定或验证结果；不预建依赖未知结果的Task。
4. **Tasker**按文件合同主导调查、设计准备、编码、验证、记录和交接；到达开发者参与点时提供证据、选项和建议并停止依赖步骤。
5. **Leader**只在继续条件满足后读取文件结果，完成当前Task、更新Issue/roadmap/Spec，或创建唯一下一Task。

PM和Reviewer都是按需角色：PM用于Project排期和批量元数据；Reviewer用于高风险变化、Task画像要求或开发者明确要求。二者都不成为顺序主线的前置依赖。

### Leader合同

Leader是Issue、Proposal、Spec、roadmap和Task的编排owner：

- 判断目标是否值得创建重大/长期Issue；无Issue本地工作直接使用`actionIssueId: null`；
- 把未确定未来步骤写为roadmap触发条件，而不是预建Task；
- 创建包含八个通用章节的完整`planned` Task并派发；
- `kind: research`追加研究问题、研究产物和决策范围，声明产物与允许文件集合一致，active research 进入HEAD后检查owner scope当前工作树；`kind: design`追加设计类型、唯一Proposal/Spec产物、决策范围、允许文件和密封基线；
- 明确开发者参与的时机和材料，不要求开发者批准Task文件、Skill路由、允许文件、验证命令或状态切换；
- 派发后停止并报告需要什么才能继续；
- 发现多个合理产品结果时向开发者提交证据、选项和建议，不让Tasker自行选择；
- 取得结果后更新合同、完成当前Task或按需创建唯一下一Task。

### Tasker文件交互

Tasker开始和恢复只读取Task README、context、引用合同、最新Leader walkthrough、基线与相邻测试。`planned`/`in-progress`用于执行；`verifying`允许补required证据或同合同修复。Tasker主导执行，在`开发者参与`触发点准备最小证据、可观察产物、选项与建议；缺少人类结果时不得自行代替。

`agentWorkflow.kind: research`只产出指定研究证据和决策材料；声明allowlist与研究产物集合一致，active research首次进入HEAD后固定kind、状态与研究产物，并检查owner scope内staged、unstaged和untracked实际路径，当前合同不能关闭或扩大该窗口。README/context由Leader维护并作为实际diff例外，不属于Research Tasker allowlist。`agentWorkflow.kind: design`只修改密封合同允许的Proposal/Spec和报告文件，不实现业务代码；API额外要求`api-and-interface-design`。首次提交的活跃Design README/context密封kind、执行身份、严格祖先diff基线、产物和允许文件；已提交退出后不得重开。

### 授权模型

开发者批准目标后，以下本地可逆动作不再逐项询问：调研、治理文档、Proposal/Spec/Task编辑、branch/worktree/checkout、本地commit、依赖安装、focused test、typecheck、build和非人工smoke。Agent仍需保护用户改动、控制范围并记录实际结果。

`planned`只表示Task工作合同可执行，不授权受限动作。远端Issue/Project/PR写入、push、合并、发布、部署、数据库迁移、真实Provider/Model、浏览器人工验收和数据删除继续单独授权；具体动作、范围和来源写入Task context/walkthrough，未记录即未授权且不得外推。外部内容仍是不可信输入。

### 审查

每次合并前必须有人审查diff和验证证据，但不要求每个Task都启动独立Reviewer：

- 低风险文档或机械改动由Leader自审；
- 安全、隐私、数据生命周期、数据库迁移、公开接口、安装发布和跨模块高风险变化使用独立Reviewer；
- 开发者或Task可以随时要求独立Reviewer。

Reviewer只报告结论，不修代码、不更新合同、不触发Project Done。

## 数据、接口、安全与回滚

本提案不改变产品数据、网络接口或运行时权限。角色合同是Agent行为指引，不是宿主沙箱；高风险边界仍依赖开发者授权和Agent自觉。

回滚时恢复上一版角色/流程文档和治理断言，不改写历史Task结果。本次是clean cutover，不保留“严格四角色流程”并行入口。

## 验收

1. 现行文档只有一条开发者→Leader→Tasker→Leader→开发者顺序主线，Agent主导且开发者参与边界明确。
2. Issue只服务重大/长期交付；Issue→`0..N` Task、Task→`0..1` Issue，`actionIssueId`统一为正整数或`null`。
3. Task创建即`planned`，包含Agent工作、开发者参与、任务产物、修改计划、完成门禁、Leader继续条件和允许文件。
4. roadmap不成为可执行Task；Leader不预建依赖未知结果的完整链，派发后停止并明确继续所需输入。
5. `research`声明与owner-scope当前工作树门禁、`design`专属合同与密封diff、`verifying`返工和required/notRun语义保持。
6. 根、应用和自治包当前v1 Task使用同一Issue与章节校验；历史记录不批量回填。
7. PM与Reviewer按需；planned不授权受限动作，Task completed不触发Project Done。
8. Task、角色、仓库工作流、P-005索引和治理静态检查语义一致。
9. 聚焦治理测试、`docs:check`、`governance:check`、typecheck和diff check通过。

## 决策记录

- 2026-08-22｜初稿｜提出四角色交接、Task恢复和验证证据合同。
- 2026-08-24｜人类接受｜采用轻量角色交接，不新增状态机、CLI或权限沙箱。
- 2026-08-24｜Task 00152/00154｜同步角色合同、Task恢复、`report`和`load_role`入口。
- 2026-08-26｜人类修订｜改为Leader主导顺序流程；Leader产出可继续拆分的Issue、draft/planned Task、Proposal和Spec；design Tasker可直接与开发者协作制定API等规范并回写文件；PM和独立Reviewer按需，本地可逆门禁采用范围授权。
- 2026-08-26｜人类决策｜采用Issue聚合+扁平Task：Issue统筹总目标与验收，多个Task直接共享`actionIssueId`；不创建统筹Task或`parentTaskId`，交付地图只做导航。
- 2026-08-26｜实现收口｜未编号Issue使用`.agents/issues/drafts/<slug>.md`恢复键；取得远端编号后，应用Task带`actionIssueId`，根owner可按合同使用本地例外。历史Task必须命中index/marker首次共同提交的密封迁移快照：该快照manifest重算通过，固定`sourceRevision`中存在README，且同源同目标mapping命中；当前mapping身份投影不得漂移，应用历史Task还必须命中ownership。三个迁移期五位Task精确兼容，根当前Task使用`00152+`，应用当前Task使用`00149+`。
- 2026-08-26｜审查修复｜Issue迁移改为Draft-Key 0/1/多命中幂等顺序、先draft后开发者接受；Task owner决定`issueRequired`；verifying返工、notRun不适用语义和Design密封真实diff门禁闭合。
- 2026-08-27｜人类修订｜采用Issue/Task二层模型：Issue只记录重大或长期交付，一个Issue可含多个按结果创建的Task；保留`actionIssueId: null`的无Issue Task，删除`issueRequired`和`draft`状态。Task由Agent主导，开发者只在明示节点设计、验证或判断；Leader创建完整`planned`合同，必须写分工、产物、修改计划、完成门禁和继续条件，派发后停止。此前“先draft后逐个接受”和按owner分叉的决定由本条取代。
