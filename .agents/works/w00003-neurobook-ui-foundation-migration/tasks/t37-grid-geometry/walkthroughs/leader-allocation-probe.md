# 可满足约束仍溢出的实测（2026-09-16）

在t37消费者返工期间，Leader用真实createGrid/layout运行纯内存探针，exit 1：

```ts
const leaf = (id, width, low, high) => ({
  kind: "leaf", id, ref: id,
  size: {width, height: 100},
  minimumSize: {width: low, height: 0},
  maximumSize: {width: high, height: Number.MAX_SAFE_INTEGER},
});
const grid = createGrid({
  kind: "branch", id: "root", orientation: "horizontal",
  children: [leaf("a",60,0,50), leaf("b",30,80,1000), leaf("c",10,0,1000)],
});
grid.layout({width:100,height:100});
```

实际：a=50、b=80、c=0，root.width=130，issues=[]。最小值合计仅80，约束完全可满足，例如a约17.14、b80、c约2.86。
这是shareAxis顺序夹取错误：先把a固定max50，随后b抬到min80后没有重新释放a，remaining变负。
不是不可满足降级场景，不能用强行按总和缩放输出修补；应求同时满足上下界的分配，并覆盖交换子节点顺序、左右/上下轴和sash后的可用空间。
修复同Task，并检查resize的shiftSiblings是否继承同一缺陷。具体回归应有实值断言与总量守恒。

本探针无文件/浏览器/产品服务副作用，未访问3001。
