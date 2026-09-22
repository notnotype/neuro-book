# 独立审查返工裁定

读取 [t42报告](../../t42-storage-context-review/walkthroughs/review.md) 与其中探针。当前89用例通过不代表下列失败边界闭合。

## 必须修复

1. P1：Project释放失败后user清理不能跳过。分别尝试全部清理，合并明确错误；重复release共同等待。正式测试同时打开user/project，令project释放或session关闭失败，断言两边都尝试收口。
2. P2：已借用facade在切换、abort、workbench.release同步入口之后就拒绝新操作。不能等其它owner初始化结束才关闭老句柄。测试必须用真实owner adapter+gate卡住第二个owner，证明新save未发transport、此前已接纳save仍正常排空。包括user关闭路径和已有订阅停止，不仅阻止再次borrow。
3. 样例必须由owner合成已知字段修改，保留原始projection.value的未知字段。t42探针5是调用方手工spread后传完整值，所以它没有证明savePreference(projection,{compact:true})/saveObjectMemory(...,{pinned:true})安全。Spec persistence“宿主保留完整已确认数据，保存已知字段时保留未涉及的未知引用与字段”已定；样例是未来插件参考，不让调用方默默承担未说明的合并责任。只合并本样例已知字段，不做通用JSON合并。
4. 内存selection的某个订阅者异常不得中断其它消费者，按owner-handle既有隔离方式实现并说明；不要引入新事件总线。set/get的状态语义保持清楚。

## 证据与边界

- t42的AbortSignal未处理拒绝探针通过，不要凭假设重写已经正确的Promise观察。
- 旧leader-storage-context-probe是修复前历史取证，当前正式测试已经按gate先放行后await修正，不能把旧证据的自锁当产品新缺陷。保留历史原件，并在报告明确当前回归入口。
- 对应上下文API返回值、文档错误语义、监听资源和测试统一维护。不要以双重类型断言绕过TS。
- 只跑聚焦test，所有cwd用当前worktree绝对路径；不跑全包typecheck/build（Leader统一），不启动服务、不访问3001。
- 临时数据用系统Temp；禁止递归删除任何目录。提交/push、业务UI、命令系统、grid与两个用户descriptors均排除。

完成后改写implementation报告，不声称整片完成。退出时提供真实命令/退出码/测试数和未运行项。
