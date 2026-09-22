# 被审 revision（sha1）
- ../../../../../packages/nb-ui/src/components/layout/grid.ts 33e8a2773497321e477398bbd7493f99cf93cf07
- ../../../../../packages/nb-ui/src/components/layout/grid-geometry.ts aeefb49b4e940dae0b0fff552c710c067c9212d1
- ../../../../../packages/nb-ui/src/components/layout/grid-types.ts e87f2a055d88fd36402b20fc7b4e3d0f393b7b5e
- ../../../../../packages/nb-ui/src/components/layout/grid-snapshot.ts 84c38943c79e09efcda55f119097734db2a15b12
- ../../../../../packages/neuro-book/app/utils/workbench/layout.ts 01275cb1bd42d7d86c9e70219e6afa189503b43e
- ../../../../../packages/neuro-book/app/components/workbench/WorkbenchBranch.vue 680d4b1c15eeb4ea425f9dc215336f6e53fbea19
- ../../../../../packages/neuro-book/app/components/workbench/WorkbenchShell.vue 27bcd974fae48a67d61a6303c41449ee298ef089

### 真实树 hidden=[]
- hidden = []
- 模型（recalcShellSizes/distributeShellHeights）= {"activity":60,"left":340,"right":400,"editor":478,"titlebar":36,"main":864}
- 树意图（createShellGrid）= [activity,left,editor,right]  [60,340,478,400]
- layout.sizes =  {"titlebar":0,"activity":60,"left":280,"editor":0,"right":320,"main":662,"root":662}
- root 约束 =  {"minimumSize":{"width":662,"height":36},"maximumSize":{"width":662,"height":36}}
- layout.sashSizes =  {"root":[0],"main":[0,1,1]}
- 渲染像素（归一化 × 容器）=  {"activity":116.1,"left":541.8,"editor":0,"right":619.2}
- issues =  ["节点 root 的 width 约束不相容：下限 662 高于上限 0，已以下限优先降级","分支 root 的可用空间 900 有 864 未被任何子节点吸收"]

### 真实树 hidden=["right"]
- hidden = ["right"]
- 模型（recalcShellSizes/distributeShellHeights）= {"activity":60,"left":340,"right":0,"editor":879,"titlebar":36,"main":864}
- 树意图（createShellGrid）= [activity,left,editor,right]  [60,340,879,320]
- layout.sizes =  {"titlebar":0,"activity":60,"left":280,"editor":0,"right":320,"main":662,"root":662}
- root 约束 =  {"minimumSize":{"width":662,"height":36},"maximumSize":{"width":662,"height":36}}
- layout.sashSizes =  {"root":[0],"main":[0,1,1]}
- 渲染像素（归一化 × 容器）=  {"activity":225.5,"left":1052.5,"editor":0}
- issues =  ["节点 root 的 width 约束不相容：下限 662 高于上限 0，已以下限优先降级","分支 root 的可用空间 900 有 864 未被任何子节点吸收"]

### 真实树 hidden=["left"]
- hidden = ["left"]
- 模型（recalcShellSizes/distributeShellHeights）= {"activity":60,"left":0,"right":400,"editor":819,"titlebar":36,"main":864}
- 树意图（createShellGrid）= [activity,left,editor,right]  [60,280,819,400]
- layout.sizes =  {"titlebar":0,"activity":60,"left":280,"editor":0,"right":320,"main":662,"root":662}
- root 约束 =  {"minimumSize":{"width":662,"height":36},"maximumSize":{"width":662,"height":36}}
- layout.sashSizes =  {"root":[0],"main":[0,1,1]}
- 渲染像素（归一化 × 容器）=  {"activity":201.8,"editor":0,"right":1076.2}
- issues =  ["节点 root 的 width 约束不相容：下限 662 高于上限 0，已以下限优先降级","分支 root 的可用空间 900 有 864 未被任何子节点吸收"]

### 真实树 hidden=["left","right"]
- hidden = ["left","right"]
- 模型（recalcShellSizes/distributeShellHeights）= {"activity":60,"left":0,"right":0,"editor":1220,"titlebar":36,"main":864}
- 树意图（createShellGrid）= [activity,left,editor,right]  [60,280,1220,320]
- layout.sizes =  {"titlebar":0,"activity":60,"left":280,"editor":0,"right":320,"main":662,"root":662}
- root 约束 =  {"minimumSize":{"width":662,"height":36},"maximumSize":{"width":662,"height":36}}
- layout.sashSizes =  {"root":[0],"main":[0,1,1]}
- 渲染像素（归一化 × 容器）=  {"activity":1279,"editor":0}
- issues =  ["节点 root 的 width 约束不相容：下限 662 高于上限 0，已以下限优先降级","分支 root 的可用空间 900 有 864 未被任何子节点吸收"]

### 对照树 hidden=[]
- hidden = [] （对照：交叉轴上限改为不限）
- 模型（recalcShellSizes/distributeShellHeights）= {"activity":60,"left":340,"right":400,"editor":478,"titlebar":36,"main":864}
- 树意图（createShellGrid）= [activity,left,editor,right]  [60,340,478,400]
- layout.sizes =  {"titlebar":1280,"activity":60,"left":340,"editor":478,"right":400,"main":1280,"root":1280}
- root 约束 =  {"minimumSize":{"width":662,"height":36},"maximumSize":{"width":662,"height":36}}
- layout.sashSizes =  {"root":[0],"main":[0,1,1]}
- 渲染像素（归一化 × 容器）=  {"activity":60,"left":339.7,"editor":477.6,"right":399.7}
- issues =  ["节点 root 的 width 约束不相容：下限 662 高于上限 0，已以下限优先降级","分支 root 的可用空间 900 有 864 未被任何子节点吸收"]

### 对照树 hidden=["right"]
- hidden = ["right"] （对照：交叉轴上限改为不限）
- 模型（recalcShellSizes/distributeShellHeights）= {"activity":60,"left":340,"right":0,"editor":879,"titlebar":36,"main":864}
- 树意图（createShellGrid）= [activity,left,editor,right]  [60,340,879,320]
- layout.sizes =  {"titlebar":1280,"activity":60,"left":280,"editor":618,"right":320,"main":1280,"root":1280}
- root 约束 =  {"minimumSize":{"width":662,"height":36},"maximumSize":{"width":662,"height":36}}
- layout.sashSizes =  {"root":[0],"main":[0,1,1]}
- 渲染像素（归一化 × 容器）=  {"activity":80,"left":373.5,"editor":824.4}
- issues =  ["节点 root 的 width 约束不相容：下限 662 高于上限 0，已以下限优先降级","分支 root 的可用空间 900 有 864 未被任何子节点吸收"]

### 对照树 hidden=["left","right"]
- hidden = ["left","right"] （对照：交叉轴上限改为不限）
- 模型（recalcShellSizes/distributeShellHeights）= {"activity":60,"left":0,"right":0,"editor":1220,"titlebar":36,"main":864}
- 树意图（createShellGrid）= [activity,left,editor,right]  [60,280,1220,320]
- layout.sizes =  {"titlebar":1280,"activity":60,"left":280,"editor":618,"right":320,"main":1280,"root":1280}
- root 约束 =  {"minimumSize":{"width":662,"height":36},"maximumSize":{"width":662,"height":36}}
- layout.sashSizes =  {"root":[0],"main":[0,1,1]}
- 渲染像素（归一化 × 容器）=  {"activity":113.2,"editor":1165.8}
- issues =  ["节点 root 的 width 约束不相容：下限 662 高于上限 0，已以下限优先降级","分支 root 的可用空间 900 有 864 未被任何子节点吸收"]
