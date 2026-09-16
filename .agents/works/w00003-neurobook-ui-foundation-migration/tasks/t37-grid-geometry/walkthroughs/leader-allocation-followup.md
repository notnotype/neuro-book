# 新分配器中间稿的确定反例

Leader于2026-09-16 12:30检查新shareAxis（先fix全部below，否则fix above），直接调用真实geometry导出，得到[20,30,10]、total60，exit1。

三叶意图/min/max：a=80/0/20，b=15/30/100，c=5/0/10。available100，sash0。
合法解是[20,70,10]。先固定b的min30，之后a与c到max后无法把40再分回b；所以先min后max仍然错误。
应同时求解有界比例分配，例如求单调的sum(clamp(lambda*weight,min,max))=available；或在每轮按夹取候选总量相对remaining的方向选择真正必定触界的一侧。不能永久固定一个后来应解除的边界。

同时检查新的resizeBranch：用intentTotal/presentedTotal乘delta后再按意图bounds夹取，在意图因当前容器而触界时未必还原手势目标。请加入有触界兄弟、非1缩放、无操作target=baseline的回归，不能只测未触界的线性比例场景。
此文件为同Task确定缺陷反馈，完成前必须复核。无产品服务、无3001、无文件副作用。

## 原子手势的实际反例

三叶a/b/c意图各100；min0；max为100/1000/1000；容器宽600、sash0。
layout基线为[100,250,250]，resizeBranch target=[100,270,230]。
当前delta * intentTotal / baselineTotal得到意图[100,110,90]，再layout实际[100,275,225]，与目标不同（独立bun探针exit1）。
这不是非法手势：a已到max，b/c同sash合法增减20。固定全局比例不是受约束分配的逆映射，需按实际可伸缩集合/原子完整目标解算；同时覆盖原件无变化的no-op。
