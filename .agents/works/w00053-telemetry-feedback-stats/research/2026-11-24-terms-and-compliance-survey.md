# 条款与合规调研（联网，一手来源；非法律意见）
调研日期 2026-11-24

## 1 中国大陆：个人信息保护法（2021-08-20 通过，2021-11-01 施行）
来源（全国人大网）：http://www.npc.gov.cn/c2/c30834/202108/t20210820_313088.html ；同文本（网信办）：https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm
- 第四条：个人信息是以电子或者其他方式记录的与已识别或者可识别的自然人有关的各种信息，不包括匿名化处理后的信息。
- 第七十三条（三）去标识化：个人信息经过处理，使其在不借助额外信息的情况下无法识别特定自然人的过程；（四）匿名化：个人信息经过处理无法识别特定自然人且不能复原的过程。
- 第十三条：处理个人信息须符合（一）取得个人同意，（二）为订立、履行个人作为一方当事人的合同所必需，（三）法定职责，……（七）其他。第二项至第七项情形不需取得同意。注意：没有“正当利益”一项。
- 第十四条：基于同意处理的，同意应当由个人在充分知情的前提下自愿、明确作出；处理目的、处理方式和处理的个人信息种类发生变更的，应当重新取得个人同意。
- 第十五条：个人有权撤回同意，处理者应当提供便捷的撤回方式；撤回不影响此前处理的效力。
- 第十六条：不得以个人不同意或撤回同意为由拒绝提供产品或服务；处理属于提供产品或服务所必需的除外。
- 第十七条：处理前应以显著方式、清晰易懂的语言真实、准确、完整告知：（一）处理者名称/姓名和联系方式；（二）处理目的、处理方式，处理的个人信息种类、保存期限；（三）个人行使权利的方式和程序；（四）法律行政法规规定的其他事项。事项变更的，应将变更部分告知个人。以处理规则方式告知的，规则应当公开、便于查阅和保存。
- 第五条（合法正当必要诚信，不得通过误导欺诈胁迫处理）、第六条（目的明确合理、与目的直接相关、对个人权益影响最小）、第十九条（保存期限为实现目的所必要的最短时间）也与本场景相关。
- 未在本条文里找到“默认勾选”字样；同意须“明确作出”，具体解释见下一节标准。

## 2a 《App违法违规收集使用个人信息行为认定方法》（网信办秘书局、工信部办公厅、公安部办公厅、市场监管总局办公厅，2019-11-28 印发；国信办秘字〔2019〕191号，号码来自检索摘要，未在正文核到）
来源：https://www.cac.gov.cn/2019-12/27/c_1578986455686625.htm
性质：为监管认定提供参考、为运营者自查提供指引，不是独立的强制规章（页面写明“提供参考”）。
- 一“未公开收集使用规则”：App 中没有隐私政策或其中没有收集使用规则；首次运行未通过弹窗等明显方式提示阅读；进入主界面后需多于 4 次点击才能访问；文字过小过密、颜色过淡，或未提供简体中文版。
- 二“未明示目的方式范围”：未逐一列出 App（含委托的第三方或嵌入的第三方代码、插件）收集使用个人信息的目的、方式、范围；目的、方式、范围发生变化时未以适当方式通知用户（适当方式包括更新隐私政策并提醒用户阅读）；内容晦涩冗长、大量专业术语。
- 三“未经用户同意收集使用”：征得同意前就开始收集个人信息；用户明确不同意后仍收集，或频繁征求同意；实际收集超出授权范围；“以默认选择同意隐私政策等非明示方式征求用户同意”（第 4 项）；欺诈诱骗误导；未提供撤回同意的途径、方式；违反所声明的规则收集。
- 四“违反必要原则”：因用户不同意收集非必要个人信息而拒绝提供业务功能；新增业务功能申请的个人信息超出原同意范围，用户不同意则拒绝提供原有功能（新增功能取代原有功能的除外）；“仅以改善服务质量、提升用户体验、定向推送信息、研发新产品等为由，强制要求用户同意收集个人信息”（第 5 项）。
- 五“未经同意向他人提供”：既未经同意也未匿名化处理，直接向第三方提供（含客户端嵌入的第三方代码、插件）。
- 注意：该文件只写“默认选择同意隐私政策”，没有单独写“默认勾选某个统计开关”；对统计开关的默认勾选，可援引的是第三条第 4 项“非明示方式”的精神，属于推断，未见逐字规定。

## 2b GB/T 35273-2020《信息安全技术 个人信息安全规范》（2020-03-06 发布，2020-10-01 实施，推荐性标准）
来源：标准全文（高校网站托管的 PDF 副本，非 openstd.samr.gov.cn 官方页，条文来自该副本）https://www.cupk.edu.cn/xxglb/cl/2020-08-9/db2.0/01-GBT35273%E2%80%942020.pdf
- 3.6 明示同意：通过书面、口头等方式主动作出声明，或“自主作出肯定性动作”；注：肯定性动作包括“主动勾选、主动点击‘同意’‘注册’‘发送’‘拨打’、主动填写或提供”。
- 3.14 匿名化：使得个人信息主体无法被识别或者关联，且处理后的信息不能被复原；注：匿名化后所得信息不属于个人信息。3.15 去标识化：不借助额外信息无法识别或关联，保留个体颗粒度，采用假名、加密、哈希函数等替代标识。
- 5.3 多项业务功能的自主选择：b) 应把主体自主作出的肯定性动作（点击、勾选、填写）作为特定业务功能的开启条件，仅在开启后开始收集；c) 关闭或退出的途径应与开启同样方便，关闭后应停止收集；d) 不同意则不应频繁征求；f) 不得仅以改善服务质量、提升使用体验、研发新产品、增强安全性等为由强制要求同意收集。
- 5.4 授权同意：a) 收集前告知目的、方式和范围并获得授权同意（注1：多项功能时，除隐私政策外宜在实际开始收集特定信息时提供目的方式范围）。
- 5.5 隐私政策内容（a 的 1 到 8 项）：控制者身份与联系方式；各业务功能及其分别收集的信息类型；收集方式、存储期限、出境；共享转让公开披露；主体权利与实现机制（含撤回同意方法）；提供信息的安全风险及不提供的影响；安全措施；投诉渠道。另：d) 公开发布且易访问；f) 内容发生变化时应及时更新并重新告知；注3：首次打开时宜弹窗展示核心内容。附录 D 为政策模板。
- 附录 C.4 扩展业务功能：首次使用前逐项告知并允许逐项选择同意；不同意的 48 小时内征求不超过一次；不同意不应拒绝或降低基本业务功能。
- 在标准正文与附录 C 中检索“默认”，没有出现“默认勾选”字样；其对“默认勾选”的否定要从 3.6 与 5.3 b)“主动勾选/肯定性动作作为开启条件”反推（推断）。
- 修订状态：二手来源称 2026-06-17 全国网安标委发布了《数据安全技术 个人信息安全规范（征求意见稿）》，拟修订现行标准，尚未见正式发布公告（未在 tc260 官方页核实）：https://www.secrss.com/articles/93574 ；https://www.zhonglun.com/research/articles/56466.html

## 3 随机设备标识 / 安装标识是否属于个人信息（大陆）
- 没查到官方或标准层面专门针对“应用自己生成的随机安装 ID”的认定。
- 判定路径：GB/T 35273-2020 附录 A 写明判断是否属于个人信息有两条路径：“识别”（从信息到个人）与“关联”（已知特定自然人，其活动中产生的信息，如浏览记录）；符合其一即应判定为个人信息。来源同 2b 的 PDF。3.1 个人信息定义含“能够单独或者与其他信息结合识别特定自然人身份或者反映特定自然人活动情况”。
- 表 A.1“个人常用设备信息”示例明确列出：硬件序列号、设备 MAC 地址、软件列表、唯一设备识别码（如 IMEI/Android ID/IDFA/OpenUDID/GUID/SIM 卡 IMSI 信息等）；“个人上网记录”含软件使用记录、点击记录。即标准示例里把包括 GUID 在内的唯一设备标识和软件使用记录列为个人信息。该附录是资料性附录。
- 推论（从条文推断，非官方结论）：随机标识若与使用记录一起持续上报、可关联到同一用户，按“关联”路径可能被当作个人信息；PIPL 第四条、第七十三条的“匿名化”要求是“无法识别且不能复原”，持续存在的稳定安装 ID 通常不满足，会落在“去标识化”（仍是个人信息）一侧。该推论是我的解读，未见官方对随机安装 ID 的原话。
- 在途文件：TC260 秘书处 2025 年为《个人信息识别指南》《个人信息去标识化指南》《个人信息匿名化指南》三项网络安全标准实践指南征求意见（通知号网安秘字〔2025〕148 号，反馈截止 2025-12-07；二手转载），是否已正式发布未查到。转载页：https://www.chinalawandpractice.com/2025/09/15/secretariat-of-the-national-technical-committee-260-on-cybersecurity-of-standardization-administration-of-china-data-security-technology--guidelines-and-evaluation-methods-for-anonymization-of-personal-information-draft-for-comments/ ；未能在 tc260.org.cn 原页核实。

## 4 欧盟：同意的有效性与预先勾选
说明：EUR-Lex 对本机请求返回 WAF 挑战（202 空体），GDPR 与 ePrivacy 指令原文页取不到；下面改用 CJEU 官方新闻稿与 EDPB 指南（这两处原文可取）转述。Recital 32 的逐字原文未核实。
- CJEU 新闻稿 No 125/19（2019-10-01，Planet49，C-673/17）：法院判定用户对在其设备上存储和访问 cookie 所给的同意，“is not validly constituted by way of a pre-checked checkbox which that user must deselect to refuse”；无论所存取的信息是否个人数据都一样（保护用户免受隐藏标识符等进入终端的风险）；同意须具体；向用户提供的信息包括 cookie 的运行期限以及第三方能否访问。来源（新闻稿，非判决书本身，页脚注明“不具约束力的媒体文件”）：https://curia.europa.eu/jcms/upload/docs/application/pdf/2019-10/cp190125en.pdf 。判决全文在 curia 的页面是单页应用，本机抓不到正文。
- EDPB Guidelines 05/2020 on consent v1.1（2020-05-04）第 79 段：“The use of pre-ticked opt-in boxes is invalid under the GDPR. Silence or inactivity on the part of the data subject, as well as merely proceeding with a service cannot be regarded as an active indication of choice.”；第 81 段（行 901 附近）：GDPR 不允许提供预先勾选或需要数据主体干预才能阻止同意的 opt-out 构造；第 113 段：依 Art 7(3)，撤回同意须与给予同意一样容易、且随时可行；第 77 段引用 Recital 32 说明“清晰的肯定行为”。来源：https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_202005_consent_en.pdf
- 本项只讲“依赖同意”的路径；GDPR 还有 Art 6(1)(f) 等其他合法性基础（见第 6 项），预先勾选的禁止只针对“以同意为基础”的处理。

## 5 ePrivacy 指令 Art 5(3) 与 EDPB Guidelines 2/2023（v2.0，2024-10-07 通过）
来源：https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf
- 适用判据三项：A 涉及“信息”（不限于个人数据）；B 涉及用户的终端设备；C 构成“存储”或“获取访问”。（第 6 段）
- 把应用遥测明确纳入的条文：第 33 段——访问方向用户终端分发软件、软件随后主动调用网络 API 端点，属于 Art 5(3) 范围；第 34 段——通过 SDK 让终端主动发送已存储信息同样触发；第 63 段——网站或移动应用里收集“unique identifier”，因为收集方通过分发的客户端代码指示发送，属于“获取访问”，Art 5(3) 适用；第 61 段说明唯一标识符可来自持久的个人数据，也可是持久标识符。
- 本地不外发则不算：第 44 段——本地应用在终端内部使用系统 API（含 identifiers access）不构成“获取访问”，“as long as the information does not leave the device”；但该信息或其任何派生物被访问（外发）时 Art 5(3) 适用。
- 豁免：指南明确不分析豁免（第 4 段、第 56 段），只提醒适用 Art 5(3) 不等于必须取得同意。Art 5(3) 的豁免原文（EDPB 脚注 4 引用）：“any technical storage or access for the sole purpose of carrying out the transmission of a communication over an electronic communications network, or as strictly necessary in order for the provider of an information society service explicitly requested by the subscriber or user to provide the service.” 指南未说明匿名统计是否落入该豁免；该问题交成员国监管机构的意见（见第 6 项）。
- 指南没有用“遥测”一词（全文检索 telemetry 无结果），应用遥测是按第 33、34、63 段的一般规则被涵盖，属于从条文得出的适用，不是指南对“遥测”的明示表态。
- 另：ePrivacy 是指令，各国转化法不同；适用于欧盟用户设备上的存取，与数据是否个人数据无关。

## 6 欧盟：用“正当利益”或免同意路径做遥测（CNIL）
- CNIL“受众测量”页（2020-01-27 版，法文）：触发读写终端的追踪器可免同意，前提是“严格必要于按用户明确要求提供在线通信服务”（法国《信息与自由法》第 82 条）；该页要求：目的严格限于站点或应用自身的受众测量（含性能测量、发现导航问题、优化技术性能或人机工程、估算服务器容量、分析被浏览内容）且为发布者专有；不得跨应用或跨站点追踪个人整体浏览；只用于产出匿名统计数据；不与其他处理交叉比对，也不向第三方传输。建议：在站点或移动应用的隐私政策中告知用户；追踪器寿命限 13 个月且不因再次访问自动延长；采集信息保存最长 25 个月；定期复核。来源：https://www.cnil.fr/fr/mesurer-la-frequentation-de-vos-sites-web-et-de-vos-applications
- CNIL 开发者指南第 16 页（英文，2020-06-11）列出免同意条件：告知用户、给予反对能力、目的仅限受众测量与 A/B 测试、不与其他数据交叉、追踪器范围限于单一发布者、IP 截掉最后一个字节、寿命限 13 个月；满足条件则从 opt-in 变为 opt-out；“大多数大型受众测量产品无论如何配置都不在豁免范围内”。来源：https://www.cnil.fr/en/sheet-ndeg16-use-analytics-your-websites-and-applications 。页面自带提示：这部分涉及 ePrivacy，可能因国而异。
- CNIL 综合建议（2026-01-16 整合版，含 2020-092 号与 2025-131 号审议）第 5 节：对免同意的受众测量追踪器再次建议在隐私政策中告知、寿命 13 个月、保存期最长 25 个月、定期复核。来源：https://www.cnil.fr/sites/default/files/2026-01/recommandation_cookies_consolidee.pdf
- CNIL 开发者指南第 15 页（法律依据）：不属合同关系的处理，可援引同意或正当利益；若处理具有侵入性（画像、采集地理位置等）则同意更可能是合适基础；基础须写进告知，援引正当利益时须写明所追求的正当利益；同一目的只能选一种基础；依正当利益时用户有反对权、依同意时有撤回权。来源：https://www.cnil.fr/en/sheet-ndeg15-take-account-legal-basis-technical-implementation
- 解读（我的归纳，非 CNIL 原话）：对欧盟用户，CNIL 的路径是“读写终端部分免同意 + 之后的处理另需有 GDPR 基础（正当利益可行）”，而不是笼统的“遥测可凭正当利益”；EDPB 2/2023 说明外发式遥测与唯一标识落在 Art 5(3) 内（见第 5 项）。EDPB 对产品遥测是否落入“严格必要”没有表态；是否存在 EDPB 或别国机关（如德国、荷兰）对“产品遥测”的专门意见：本次没查到。

## 7 Google OAuth（以只做“用 Google 登录”、只请求 openid/email/profile 为前提）
- 审核范围：请求敏感或受限范围的应用必须完成 OAuth 应用验证；只用非敏感范围时“不强制”完成应用验证，但若想在同意屏幕显示应用名称和标志，要做较轻量的“品牌验证”。来源：https://support.google.com/cloud/answer/13463073?hl=en
- 品牌验证触发条件（须同时满足）：用户类型 External 且状态 Published（面向任何 Google 账号用户）；且想在同意屏幕显示 logo 或名称。自动验证通常几分钟，需人工时通常 2 到 3 个工作日。来源：https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification
- 同一页：“Google 登录所需的一组初始范围”被预填在 Non-sensitive scopes 里（据此推断 openid/email/profile 属非敏感；Google 范围总表页面文本里未直接标注敏感度，该项为推断）。
- 隐私政策与主页要求：主页须公开可访问（不能只给登录用户看）、与应用相关、须含应用功能说明及隐私政策与可选服务条款链接；隐私政策须对用户可见、托管在与主页同一域名下、在同意屏幕里给出链接，且须披露应用如何访问、使用、存储或共享 Google 用户数据；对 Google 用户数据的使用须限于已发布隐私政策披露的做法。同页要求核实“授权域名”的所有权（Search Console）。来源：同上品牌验证页；验证要求页 https://support.google.com/cloud/answer/13464321?hl=en 还写明主页与同意屏幕上的隐私政策链接应一致，并建议只请求 profile 或 email 的应用遵守登录品牌规范。
- 豁免：个人使用（只有你自己或少数你认识的用户）、开发测试环境的项目无需提交审核（未验证应用有用户数上限）。来源：品牌验证页“Exceptions to verification requirements”。
- API Services User Data Policy（2024-02-15 更新）：要求准确说明身份与意图；发布完整、准确、易访问的隐私政策并在 OAuth 同意屏幕列出；若以后使用最初未披露的数据类型，须更新隐私政策并提示用户同意后才能访问；对 Google 用户数据的使用限于隐私政策明示的做法。来源：https://developers.google.com/terms/api-services-user-data-policy
- “Limited Use”：该政策把 Limited Use 列在“Additional Requirements for Specific API Scopes”之下，写明适用于敏感与受限范围（Sensitive and Restricted Scopes）获取的数据。因此只请求 openid、email、profile 这类非敏感范围时，Limited Use 的字面适用范围看不到包含（据上文推断）；但验证要求页（第 2 条）写“应符合 Google 的 Limited Use 要求”。两处措辞不完全一致，是否对仅登录场景实际执行，本次没有官方明示：标为不明确。

## 8 GitHub OAuth App
- 注册 OAuth App 的步骤只要求：应用名、主页 URL、（可选）应用描述、回调 URL（最多 10 个）、是否启用设备流；没有隐私政策或服务条款的字段。页面提醒只使用你认为公开的信息。来源：https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app
- 在 GitHub 文档范围内检索（OAuth 创建页、最佳实践页、服务条款 H 节 API 条款、文档站搜索）没有搜到“OAuth App 必须有隐私政策”的规定；写成“在这些文档里没搜到”，不等于不存在。
- 相关的反面例子：GitHub 服务条款 H 节写“All use of the GitHub API is subject to these Terms of Service and the GitHub Privacy Statement”（使用 API 受 GitHub 条款和隐私声明约束）；GitHub 条款中的 API 条款还禁止用 API 下载数据做垃圾信息、出售用户个人信息给招聘者等。来源：https://docs.github.com/en/site-policy/github-terms/github-terms-of-service
- 只有上架 GitHub Marketplace 的开发者才有明确的隐私政策义务（搜索摘要称 Marketplace Developer Agreement 的数据保护附录要求向终端用户提供隐私政策），该条文本次未打开核对，标未核实：https://docs.github.com/en/site-policy/github-terms/github-marketplace-developer-agreement

## 9 别人怎么写（只摘结构与关键句）
### 9.1 VS Code 遥测文档 https://code.visualstudio.com/docs/configure/telemetry
- 结构：开头一段说明目的（调试慢启动、排优先级、灰度发布新功能）并立刻给出可关闭 + 链接隐私声明；然后“数据类型”三类（崩溃报告、错误遥测、使用数据）；“关闭方法”给出单一设置 telemetry.telemetryLevel 与取值表（all / error / crash / off 各发什么）；再写“关闭的代价”（A/B 实验依赖使用数据，关了就收不到灰度功能）；再写扩展不受该设置控制；再写“如何看自己发了什么”（Developer: Show Telemetry、--telemetry 命令导出全部事件）；事件元数据分类（classification、purpose、endpoint）；GDPR 一节；最后“在线服务”一节单列联网行为。
- 字段怎么列：不逐字段列在文档里，而是把事件清单放进可由命令生成的 JSON 报告，并给分类词表（SystemMetaData、EndUserPseudonymizedInformation 如哈希后的 MAC 等）。
- “不收什么”：没有集中的“不收”清单；用分类里的“不含可识别个人的系统元数据”“堆栈已清除用户路径”表达。其 GDPR 一节坦白：设备端用网卡哈希、网页端用随机 UUID 近似单个用户，“not guaranteed to be unique”，且因没有登录体验无法向用户出示其数据。
- 变更通知：该文档未写变更通知机制，只写了在产品里放通知让新老用户都能选择退出。
### 9.2 Homebrew Analytics https://docs.brew.sh/Analytics
- 结构：开头一句话定性（聚合、匿名）与“收集前先显示通知以便用户先退出”；目的；保留期（InfluxDB 365 天）；发送的数据（按事件类型逐项列）；怎么检查（HOMEBREW_ANALYTICS_DEBUG=1 打印请求）；报告查看；传输与失败行为（后台、短超时、失败静默）；关闭（brew analytics off 或环境变量 HOMEBREW_NO_ANALYTICS=1，brew analytics state 查看）。
- “不收什么”的写法：陈述句，贴在字段清单之后：“The analytics payload does not contain a user identifier or an IP-address field.”“Homebrew does not use the payload to build a history for an individual user.”；对命令只记选项名不记值、构建错误不含日志。并明说“事件计数是操作次数，不是独立用户数”。同页声明实现代码才是权威来源。
### 9.3 Mozilla Firefox Privacy Notice https://www.mozilla.org/en-US/privacy/firefox/
- 结构：按“数据用来做什么”分节（提供浏览器、搜索建议、新标签页、了解使用情况等），每节末尾固定一个“More details, including how to adjust your data settings”；其后“数据类型定义表”（技术数据、设置、位置、唯一标识符如 client_id/session_id、系统性能、交互数据，各配示例）；再有“目的 × 数据 × 法律基础”对照表；“Changes”一节。
- 关键处理：“了解使用情况”一节写明关闭项“Allow Firefox to send technical and interaction data to Mozilla”，并特别提示该项不影响“每日使用 ping”（只含去标识的“有人在用 Firefox”，可在设置里另行关闭）。
- 法律基础：对“了解使用情况”写“Legitimate interest in understanding how Firefox is used…”，并写明在适用法律要求时（如使用非必要 cookie）另取得同意。这是产品方自己的做法，不是监管机关的认可。
- 变更：“可能更改，更新会在线发布并更新生效日期；若变更实质，会通过博客、论坛等更显著渠道公布”（没有应用内强制重新同意）。
### 9.4 Syncthing（安全原则页的“Usage Reporting”一节与配置页）https://docs.syncthing.net/users/security.html ；https://docs.syncthing.net/users/config.html
- 结构极短：启用后启动时及之后每 24 小时发送；以 HTTPS POST 发到使用报告服务器；报告内容可在设置里的“Preview”链接看到；“默认关闭，但 GUI 在首次安装后不久会询问一次”；并写明一个不完美之处：连接服务器本身可能暴露客户端在运行 Syncthing。
- 开关机制写在配置项说明里：urAccepted（0 未选择、-1 拒绝、正数 = 已接受的报告版本号）；urUniqueID“启用使用报告时生成”；urSeen、urInitialDelayS 等。该页的逐字段列表不在文档里，靠预览与代码。
### 9.5 中文软件：Cherry Studio 隐私政策（更新日期 2026-08-20）https://docs.cherry-ai.com/about/privacypolicy
- 结构（中文，编号一到九）：一、收集的信息范围，分“（一）基础运行信息：软件版本信息、功能使用汇总信息”“（二）产品改进信息：功能使用活跃度与频次、错误日志与崩溃信息”，两类都标“默认收集”，并写关闭路径“【设置】-【数据设置】-【隐私设置】中的相应开关”，且说明关闭基础运行信息的代价（可能收不到版本兼容提示与安全更新通知）；“（三）我们的承诺”（全部匿名化、无法关联个人身份、不用于画像广告、不出售不提供第三方、不含对话内容和 API Key）；二、“我们明确不会收集的信息”独立成节（API Key、对话数据、个人身份信息与敏感个人信息）；三、本地存储；后面是第三方服务；八、政策更新（实质性变更包括信息收集范围调整，将通过软件内显著位置提示、版本更新说明提前告知，并标注更新与生效日期；继续使用视为接受）；九、联系我们。
- 启示点：两档“默认收集”并分别有开关；“不收什么”单独成节；承认“匿名”与关闭代价。注意它与上文大陆规则的差距：该政策是默认收集 + 事后开关，没有首次启动时的同意步骤，也没有按 PIPL 第十七条列保存期限的条目；是否合规本次不评价。

## 10 新增收集项时重新告知用户的明确机制（两例，均来自官方源码或文档）
- Syncthing：使用报告有版本号 Version（当前常量 3）；源码注释写明“if fields are added or changed this integer must be incremented so that users are prompted for acceptance of the new report”（新增或改动字段就必须把版本号加一，使用户被重新询问）。配置里 urAccepted 存“用户已接受的报告版本”（0 未选、-1 拒绝、正数为已接受版本），urSeen 存 GUI 已展示过的最高版本；GUI 判断“urAccepted 与 urSeen 均小于当前最大版本且未拒绝”才重新弹窗；拒绝（-1）的人不再被打扰。来源：https://github.com/syncthing/syncthing/blob/main/lib/ur/usage_report.go （文件内 Version 注释，经 raw 读取）；https://raw.githubusercontent.com/syncthing/syncthing/main/gui/default/syncthing/core/syncthingController.js （第 222 行判断）；配置项说明 https://docs.syncthing.net/users/config.html
- Firefox：遥测政策有版本号，源码注释写明“The current policy version number. If the version number stored in the prefs is smaller than this, data upload will be disabled until the user is re-notified about the policy changes.”（已存版本低于当前版本时，数据上传被禁用，直到用户被重新通知）。来源：https://hg.mozilla.org/mozilla-central/raw-file/tip/toolkit/components/telemetry/app/TelemetryReportingPolicy.sys.mjs （DEFAULT_DATAREPORTING_POLICY_VERSION 处）。注意：这是“通知”而非重新取得同意，且 Mozilla 近期把条款流程改到另一套 termsofuse.* 版本偏好上（同文件）。
- 其他可对照的明文要求（不是产品机制）：Google API Services User Data Policy 要求使用最初未披露的数据类型前须更新隐私政策并提示用户同意（见第 7 项）；PIPL 第十四条第二款、第十七条第二款（见第 1 项）；认定方法二.2（见 2a）。
- Homebrew 的机制是“首次启用前显示通知，用户可在发送第一个事件前退出”，页面没有写新增收集项时的再通知机制（未见）。

## 11 用户主动反馈通道的条款写法（两例）
- 微软 Developer Community 数据隐私页 https://learn.microsoft.com/en-us/visualstudio/ide/developer-community-privacy ：开头第一句就写默认公开（“By default, all information in problem reports ... including any comments and replies, is publicly visible”），随后给出缓解办法（用不披露身份的账号、初始报告内容永远公开所以细节放在“仅版主和原发帖人可见”的私密评论里）；“Data we collect”分“公开反馈（报告、评论、方案）”和“个人数据（资料、偏好、附件与系统日志、投票）”，并按入口列出自动附带的诊断类型（setup 日志、事件日志、屏幕截图、录制等），写明“日志、截图、录制只有在你提交报告时才发送，提交前可在‘摘要’步骤看到并取消‘附加系统日志’”；保留期：问题关闭后附件 90 天删除；另有“AI 处理”一节（可用自动系统与 AI 处理反馈用于调查、归类、改进工具，且不用于训练通用 AI 模型，需要时有保障）；“GDPR 数据主体请求”一节（查看、导出、删除，导出不含已公开的评论与报告）。
- GitHub 服务条款（Beta 预览条款的“Feedback”小节）https://docs.github.com/en/site-policy/github-terms/github-terms-of-service ：对用户提供的想法、建议、代码贡献等“Feedback”，用户同意 GitHub 获得免版税、全额付清、全球、可转让、可再许可、不可撤销、永久的许可，可用于实施、使用、修改、商业利用、并入产品与文档。这是“把反馈内容的使用权写清”的典型写法，限于 Beta 预览参与者场景。
- 补充对照（用途限定式）：Mozilla Firefox 隐私声明写“When you communicate with us via these methods ... we will only use the information you share for the purpose you provided it.”（例如在 Firefox 内报告损坏网站）。来源：https://www.mozilla.org/en-US/privacy/firefox/
- 没有在这几份里找到“反馈内容在多长时间后删除”的统一写法，只有微软例子的 90 天（针对附件、关闭后）；其余例子未写保留期。

## 12 登录后与账号关联的数据（设备、最后活跃、在线状态）在隐私政策里的写法（两例）
- Mozilla Accounts 隐私声明（更新于 2026-08-10）https://www.mozilla.org/en-US/privacy/mozilla-accounts/ ：放在“提供并改进 Mozilla 账号及关联服务”一节，作为“技术与交互数据”的一部分：写“你使用 Firefox 的情况（如使用频率与你上次同步数据的时间）、你用过哪些设备与我们交互”；该节另有“账号数据 / 联系数据 / 授权数据”的总述；法律基础按表格列（合同用于账号运行，正当利益用于了解使用与改进）；保留期写“账号数据在账号有效期间保留；超过两年未登录的账号会被定期删除（会尽力提前发提醒）”。没有单独写“在线状态”。
- Discord 隐私政策（有效日期 2026-12-15，更新于 2026-11-23）https://discord.com/privacy ：放在“我们收集的信息”下的“自动收集的信息”小节：“关于你的设备的信息”（IP、操作系统、浏览器、设备设置）、“关于你使用应用或网站的信息”（与何时、如何使用服务相关的日志与事件信息）、“你所采取操作的信息”；账号类内容在“你提供给我们的信息”。没有找到直接写“在线状态/最后活跃/设备列表”的字句（只检索了页面文字，未做到逐句核对）。
- GitHub 隐私声明 https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement ：“Service Usage Information”写“IP 地址、设备信息、会话详情、请求日期时间、设备类型与 ID、操作系统与应用版本……”；保留：“账号有效期间以及履行合同、法律义务等需要期间保留”。同样没有单列“在线状态”。
- 归纳（我的整理）：三份都把这类数据归入“自动收集/技术与交互数据”一节，而不是单独的“在线状态”条目；没有找到把“设备列表/最后活跃/在线状态”逐项写成独立字段的公开隐私政策例子，本次没查到。

## 汇总：没查到或没把握
- EUR-Lex 被 WAF 挡，GDPR Recital 32、Art 4(11)、Art 6(1)(f)、ePrivacy Art 5(3) 的逐字原文未直接读到，改用 CJEU 新闻稿、EDPB 指南引文；Planet49 判决书全文本机抓不到。
- GB/T 35273-2020 条文取自高校托管的 PDF 副本，不是 openstd.samr.gov.cn；2026-06 修订征求意见稿只见二手报道。
- 认定方法的文号“国信办秘字〔2019〕191号”只见检索摘要，未在正文核到。
- 随机安装 ID 是否属个人信息：没有官方明示；TC260 三项指南是否已定稿未查到。
- Google 对“仅登录范围”是否执行 Limited Use：官方文字两处不一致，未见明示。
- GitHub OAuth App 对隐私政策无要求仅为“文档范围内没搜到”；Marketplace Developer Agreement 未打开核对。
- “设备列表/最后活跃/在线状态”逐项写入隐私政策的公开例子：没查到；Discord、GitHub 的页面未做逐句核对。
- 非欧盟成员国（德国、荷兰等）监管机关对“产品遥测”的专门意见未查。
