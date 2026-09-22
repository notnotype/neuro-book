# editor~right 手势（tracker active = [editor, right]，消费者取 active[0] = editor）
- grid.resize('editor','width',-100) = {"ok":true,"applied":-100}
- store = {"leftPanelWidth":340,"agentPanelWidth":400,"hidden":[]}（未写回）
- 模型拖前 = {"activity":60,"left":340,"right":400,"editor":478,"titlebar":36,"main":864}
- 模型拖后 = {"activity":60,"left":340,"right":400,"editor":478,"titlebar":36,"main":864}
- 重建后的树意图 = [60,340,478,400]
- 结论：模型与树都回到拖前，store 不变；reka 在 DOM 里保留已拖动的百分比，下一次重挂（显隐/视口/store 外部改写）回弹。