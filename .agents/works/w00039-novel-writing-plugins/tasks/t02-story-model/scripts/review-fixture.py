# 生成 w00039 t02 审查用的 Agent 夹具：条目源文、带值渲染、组件视图、变更日志、查名表、任务说明。
import json, os, re, sys
R = sys.argv[1]; A = sys.argv[2]
F = f"{R}/fixture"
for d in ["read", "reminders", "chapters", "tasks"]:
    os.makedirs(f"{F}/{d}", exist_ok=True)
os.makedirs(f"{A}/sources", exist_ok=True)

ENTRIES = [
 dict(id="e-sutianqing", name="苏天晴", aliases=["狐狐", "小狐狸", "金毛狐女"], path="人物/主角", summary="重生成金毛狐女、与墨丘利秘典签约的反派魔法少女", comps=["人物", "面板", "情节"],
  state={"character": {"本名": "苏天晴", "种族": "狐兽人", "外貌": "娇小的金毛狐女：金色长发垂到后背，头顶一对狐耳，背后一条毛茸茸的大尾巴，金色眼眸", "性格": "嘴上贫，爱发癫，对可爱的东西毫无抵抗力；人前装作游刃有余的反派，心里容易慌", "说话方式": "自称“爷”“狐狐”，叫墨丘利秘典“小破书”", "变身形态": "金色短款洋装，过膝白袜，缎带装饰，胸前一枚金色十字星", "住处": "蓉城东部", "立绘": "assets/苏天晴/日常.png"},
         "panel": {"神典石": 200, "关注者": 0, "任务": [{"名称": "走上反派魔法少女的道路", "状态": "进行中"}, {"名称": "秘典序章", "状态": "已完成"}, {"名称": "每日任务1：找茬魔法少女", "状态": "进行中", "奖励": "100 神典石"}, {"名称": "夙愿：获得200名关注者", "状态": "进行中", "奖励": "500 神典石"}]}},
  mdx="""# {entry.name}

前世是连上三个夜班后倒在面摊上的社畜，重生成了一只金毛狐女，接手了同名原主人的身体与生活（见 <Ref to="苏天晴（原主人）"/>）。

外貌：{character.外貌}
性格：{character.性格}
说话方式：{character.说话方式}
变身后：{character.变身形态}
住处：{character.住处}

与 <Ref to="墨丘利秘典"/> 签了契约，要当王道系故事里的反派魔法少女。目前有 {panel.神典石} 神典石。

![日常立绘]({character.立绘})
"""),
 dict(id="e-yuanzhu", name="苏天晴（原主人）", aliases=["原主人", "苏天晴小姐"], path="人物/配角", summary="这副身体原来的主人，与主角同名，已因暴发性心肌炎去世", comps=["人物", "情节"],
  state={"character": {"本名": "苏天晴", "种族": "狐兽人", "性格": "社恐孤僻，极少出门", "经历": "从小独自长大，靠兽人互助协会资助考上蓉城医学院；在网上写小说挣饭钱，靠全勤混饭吃；临开学前染上兽人流感，熬夜时突发暴发性心肌炎去世", "财务": "存款捉襟见肘，背着学费贷款"}},
  mdx="""# {entry.name}

性格：{character.性格}
经历：{character.经历}
财务：{character.财务}

她的夙愿写在秘典的任务里：“成为闪耀的魔法少女，让所有人记住你的名字。”
"""),
 dict(id="e-midian", name="墨丘利秘典", aliases=["黑色古书", "秘典", "古书", "小破书"], path="道具", summary="自称星界使者的会说话的黑色古书，与苏天晴签了反派魔法少女契约", comps=["情节"], state={},
  mdx="""# {entry.name}

一本飘在半空、会说话的黑色古书，自称来自星空彼岸的星界使者，在寻找“最优秀的适格者”。与苏天晴签约后就不再开口，改为在书页上浮现文字：任务、情报，以及对手的行踪预测。

作者设定（正文还没写）：秘典有一个商店，可以用神典石买道具。商店只收神典石，余额不够就买不了，不能赊账。契约成立时，秘典给苏天晴准备了 200 神典石的启动资金，打算第 4 章交代。
"""),
 dict(id="e-shouhuzhixing", name="守护之星", aliases=["金色十字星", "十字星"], path="道具", summary="魔法少女的变身道具，金色十字星", comps=["情节"], state={},
  mdx="""# {entry.name}

魔法少女必备的变身道具。苏天晴的这一枚是从秘典里掉出来的金色十字星，沾上她的鼻血后激活。按住十字星中央的凹陷就能变身；喊口号没有用。
"""),
 dict(id="e-fengxinzi", name="风信子", aliases=["魔法少女风信子"], path="人物/魔法少女", summary="在蓉城活跃的天蓝色魔法少女，擅长近战肉搏", comps=["人物", "情节"],
  state={"character": {"代号": "风信子", "真名": "南小风（第 4 章揭晓）", "外貌": "天蓝色的魔法少女", "能力": "魔杖化作大剑，擅长近战压制与肉搏，对魔法尚不熟练", "所属": "接受英雄协会的管辖委派"}},
  mdx="""# {entry.name}

{character.外貌}，代号{character.代号}。
能力：{character.能力}
所属：{character.所属}
真名：{character.真名}
"""),
 dict(id="e-yingxiongxiehui", name="英雄协会", aliases=["协会"], path="组织", summary="管辖并委派魔法少女的组织", comps=["情节"], state={},
  mdx="""# {entry.name}

管辖和委派魔法少女。魔法少女一边与怪人战斗，一边作为偶像出镜；真实身份保密，变身后的样子广为人知。
"""),
 dict(id="e-mofashaonv", name="魔法少女", aliases=[], path="世界观", summary="与怪人怪兽战斗的超凡者，接受英雄协会管辖", comps=[], state={},
  mdx="""# 魔法少女

客观存在。与怪人、怪兽战斗，接受 <Ref to="英雄协会"/> 的管辖委派，同时作为偶像出镜。真实身份保密。苏天晴担心这是“死亡率高达 90% 的高危职业”，秘典说是王道系的那种。
"""),
 dict(id="e-guairen", name="怪人与怪兽", aliases=["怪人", "怪兽"], path="世界观", summary="与魔法少女战斗的敌对存在", comps=[], state={},
  mdx="""# 怪人与怪兽

客观存在，会袭击城市，由魔法少女迎击。秘典能预测它们在哪里出现。
"""),
 dict(id="e-shouren", name="兽人", aliases=["猫娘", "狐娘"], path="世界观", summary="与人类共存但数量远少于人类的种族", comps=[], state={},
  mdx="""# 兽人

这个世界人类与兽人共存。兽人指猫娘、狐娘这类，不是“从地里长出来的大菌子绿皮”。数量远远不及人类，有兽人互助协会。在蓉城并不少见。
"""),
 dict(id="e-rongcheng", name="蓉城", aliases=[], path="地点", summary="故事所在的城市", comps=[], state={},
  mdx="""# 蓉城

故事所在的城市。苏天晴住在东部；中心城区有天府广场与 <Ref to="绿心公园"/>，坐地铁从东部过去要两个小时。目前只有风信子一名活跃的魔法少女。
"""),
 dict(id="e-lvxingongyuan", name="绿心公园", aliases=["蓉城市绿心公园"], path="地点", summary="蓉城中心城区最大的湿地公园", comps=[], state={},
  mdx="""# 绿心公园

蓉城最大的湿地公园，在中心城区，是地标。第 3 章的夜里有怪人袭击这里。
"""),
]
BY = {e["name"]: e for e in ENTRIES}

def get(state, path):
    cur = state
    for k in path.split("."):
        cur = cur[k]
    return cur

def fmt(v):
    if isinstance(v, str): return '"' + v + '"' if len(v) > 12 or "，" in v else v
    if isinstance(v, list): return json.dumps(v, ensure_ascii=False)
    return str(v)

def render(e):
    def rep(m):
        expr = m.group(1).strip()
        if expr == "entry.name": return "{entry.name = " + e["name"] + "}"
        v = get(e["state"], expr)
        if expr.endswith("立绘"): return "{" + expr + " = 图片 " + v + "}"
        return "{" + expr + " = " + fmt(v) + "}"
    body = re.sub(r"\{([^{}]+)\}", rep, e["mdx"])
    body = re.sub(r'<Ref to="([^"]+)"/>', lambda m: f'<Ref to="{m.group(1)}"/>', body)
    return body

CHANGES = [
 ("c01", "前史", "已写", "前世：连上三个夜班后，在街边面摊吃面时恍惚听见太奶说话，随后胸口一疼眼前一黑，失去意识（急性心肌梗死）", "正文 1.15", ["苏天晴"], ["重生"], ""),
 ("c02", "前史", "已写", "原主人苏天晴临开学前染上兽人流感，熬夜时突发暴发性心肌炎去世", "正文 2.20", ["苏天晴（原主人）"], [], ""),
 ("c03", "第 1 章", "已写", "苏天晴醒来，发现自己重生成金毛狐女，遇见飘浮的黑色古书", "正文 1.4–1.30", ["苏天晴", "墨丘利秘典"], ["重生"], "在其后 c01"),
 ("c04", "第 1 章", "已写", "古书自称墨丘利秘典、星界使者，提出签约；苏天晴不加犹豫答应，理由是财富和变成萝莉是最通用的两个愿望，自己已经是萝莉了", "正文 1.41–1.59", ["苏天晴", "墨丘利秘典"], ["当反派魔法少女"], "接续 c03"),
 ("c05", "第 1 章", "已写", "苏天晴问契约内容，得知要当王道系故事里的反派魔法少女，后悔也来不及，秘典宣布绑定成功、契约成立", "正文 1.60–1.76", ["苏天晴", "墨丘利秘典"], ["当反派魔法少女"], "接续 c04", "补丁 苏天晴.panel.任务 增加 {名称: 走上反派魔法少女的道路, 状态: 进行中}"),
 ("c06", "第 2 章", "已写", "苏天晴从身体残留的记忆里得知原主人的经历：同名，社恐孤僻，受兽人互助协会资助考上蓉城医学院，死于暴发性心肌炎", "正文 2.17–2.21", ["苏天晴", "苏天晴（原主人）"], ["重生"], ""),
 ("c07", "第 2 章", "已写", "翻开秘典时金色十字星掉出砸脸，沾上鼻血后激活为守护之星；秘典序章完成，开启每日任务", "正文 2.30–2.39", ["苏天晴", "墨丘利秘典", "守护之星"], ["当反派魔法少女"], "", "补丁 苏天晴.panel.任务 增加 {名称: 秘典序章, 状态: 已完成}"),
 ("c08", "第 2 章", "已写", "喊口号变身无效，按住十字星中央凹陷后完成初次变身；看到变身后的样子，接受了反派魔法少女的身份", "正文 2.48–2.76", ["苏天晴", "守护之星"], ["当反派魔法少女"], "接续 c07"),
 ("c09", "第 2 章", "已写", "秘典第一页显示每日任务1：找茬正牌魔法少女，奖励 100 神典石", "正文 2.78–2.87", ["苏天晴", "墨丘利秘典"], ["找茬风信子"], "", "补丁 苏天晴.panel.任务 增加 {名称: 每日任务1：找茬魔法少女, 状态: 进行中, 奖励: 100 神典石}"),
 ("c10", "第 3 章", "已写", "早餐时查资料，了解魔法少女与英雄协会，看了风信子的战斗视频，担心自己打不过肉搏型的她", "正文 3.4–3.19", ["苏天晴", "风信子", "英雄协会"], ["找茬风信子"], ""),
 ("c11", "第 3 章", "已写", "秘典第二页显示任务“夙愿”：获得 200 名关注者，奖励 500 神典石；第三页给出风信子的情报和今晚绿心公园出现怪人的预测", "正文 3.20–3.34", ["苏天晴", "墨丘利秘典", "风信子", "绿心公园"], ["找茬风信子"], "", "补丁 苏天晴.panel.任务 增加 {名称: 夙愿：获得200名关注者, 状态: 进行中, 奖励: 500 神典石}"),
 ("c12", "第 3 章", "已写", "中午坐两个小时地铁到市中心，进绿心公园，在长椅上看秘典、查手机，了解原主人的处境（存款捉襟见肘、学费贷款），决心让她过上更好的生活", "正文 3.35–3.71", ["苏天晴", "绿心公园", "苏天晴（原主人）"], ["找茬风信子"], "动机 c11"),
 ("c13", "第 3 章", "已写", "入夜，怪人袭击绿心公园，居民逃散；苏天晴确认秘典预测应验，等风信子到来，说准备了一份“见面礼”", "正文 3.73–3.87", ["苏天晴", "绿心公园", "怪人与怪兽"], ["找茬风信子"], "在其后 c12"),
]

def change_line(c):
    cid, told, st, desc, src, who, threads, link = c[:8]
    patch = c[8] if len(c) > 8 else ""
    s = f"{cid}  讲于 {told}  {st}  {desc}\n    出处 {src} · 涉及 {'、'.join(who)}"
    if threads: s += " · 剧情线 " + "、".join(threads)
    if link: s += " · 连接 " + link
    if patch: s += "\n    " + patch
    return s

AT = "第 4 章开头"
for e in ENTRIES:
    base = f"{F}/read/{e['name']}@{AT}"
    head = f"read({e['name']}, at: {AT})\n条目 {e['name']} · 位置 {e['path']} · 别名 {'、'.join(e['aliases']) or '无'} · 组件 {'、'.join(e['comps']) or '无'}\n\n"
    open(base + ".txt", "w").write(head + render(e))
    open(f"{A}/sources/{e['name']}.mdx", "w").write(e["mdx"])
    open(f"{A}/sources/{e['name']}.state.json", "w").write(json.dumps(e["state"], ensure_ascii=False, indent=2))
    if "人物" in e["comps"]:
        lines = [f"read({e['name']}, view: 人物, at: {AT})"] + [f"{{character.{k} = {fmt(v)}}}" for k, v in e["state"]["character"].items()]
        open(base + ".人物.txt", "w").write("\n".join(lines) + "\n")
    if "面板" in e["comps"]:
        p = e["state"]["panel"]
        lines = [f"read({e['name']}, view: 面板, at: {AT})", f"神典石 {{panel.神典石 = {p['神典石']}}} · 关注者 {{panel.关注者 = {p['关注者']}}}", "任务："]
        for i, t in enumerate(p["任务"]):
            lines.append(f"  {{panel.任务[{i}] = {json.dumps(t, ensure_ascii=False)}}}")
        lines += ["", "流水：", "  初值  神典石 = 200（创作修改：作者设定契约时的启动资金，第 4 章才在正文交代）", "  初值  关注者 = 0", "  c05   任务 增加 走上反派魔法少女的道路", "  c07   任务 增加 秘典序章（已完成）", "  c09   任务 增加 每日任务1：找茬魔法少女", "  c11   任务 增加 夙愿：获得200名关注者"]
        open(base + ".面板.txt", "w").write("\n".join(lines) + "\n")
    if "情节" in e["comps"]:
        rel = [c for c in CHANGES if e["name"] in c[5]]
        rel = list(reversed(rel))
        lines = [f"read({e['name']}, view: 情节, at: {AT}, page: 1)  共 {len(rel)} 条，按讲于从近到远"] + [change_line(c) for c in rel]
        open(base + ".情节.txt", "w").write("\n\n".join(lines) + "\n")

# 查名表：lookup 的全部结果
rows = ["lookup 的结果表：lookup(词) 返回名字或别名与这个词完全相同的行（第一版只做精确匹配）。", "", "名字 | 别名 | 位置 | 一句话描述 | 组件"]
for e in ENTRIES:
    rows.append(f"{e['name']} | {'、'.join(e['aliases']) or '—'} | {e['path']} | {e['summary']} | {'、'.join(e['comps']) or '—'}")
open(f"{F}/lookup-table.txt", "w").write("\n".join(rows) + "\n")

# 变更日志全量：search 在它上面检索
open(f"{F}/changes-log.txt", "w").write("剧情变更日志（截至第 3 章末尾，已写）。search(查询, 过滤) 只在这份日志和条目文字里找；你可以自己在这份文件里查，但每查一次算一次 search 调用，报告里列出你实际想发的查询。\n\n" + "\n\n".join(change_line(c) for c in CHANGES) + "\n")

# 条目树
tree = {}
for e in ENTRIES: tree.setdefault(e["path"], []).append(e["name"])
open(f"{F}/tree.txt", "w").write("tree()\n" + "\n".join(f"{p}/\n  " + "\n  ".join(ns) for p, ns in tree.items()) + "\n")
print("entries", len(ENTRIES), "changes", len(CHANGES))
