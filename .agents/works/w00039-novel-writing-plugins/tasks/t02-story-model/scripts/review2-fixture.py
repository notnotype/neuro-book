# 生成 w00039 t02 第二轮审查用的可执行夹具数据：world.json 加第 1 到 4 章正文。工具是同目录的 wetool.py。
# 用法：python3 review2-fixture.py <第一轮的 review 目录> <输出目录>
# 条目与第 1 到 3 章的变更沿用第一轮（review-fixture.py），按提案第二版的形状改写；另外：
# - 第 4 章的三条计划（c14 到 c16）与一条未排章的计划（c17）；
# - 一条故意记错的变更 c07b：第 2 章“序章奖励 +10 神典石”，正文没写，来源是 Agent 估计。它让第 4 章“200 启动资金”的核对点对不上；
# - 第 4 章正文用第一轮任务 2 的版本（4.119 写成了“碧色的狐眸”，与设定的金色眼眸冲突）。
import json, os, re, shutil, sys

R1, OUT = sys.argv[1], sys.argv[2]
os.makedirs(f"{OUT}/chapters", exist_ok=True)
SRC = {1: "fixture/chapters/chapter-01.txt", 2: "fixture/chapters/chapter-02.txt", 3: "fixture/chapters/chapter-03.txt",
       4: "fixture/chapters/task2-only/chapter-04.txt"}
lines = {}
for n, p in SRC.items():
    shutil.copy(f"{R1}/{p}", f"{OUT}/chapters/chapter-0{n}.txt")
    lines[n] = {int(m.group(1)): m.group(2) for m in (re.match(r"\[\d+\.(\d+)\] (.*)", l) for l in open(f"{R1}/{p}", encoding="utf-8")) if m}


def q(n, para, k=16):
    """取第 n 章第 para 段开头的一句作讲述的原句。"""
    t = lines[n][para].strip()
    return t[:k]


def told(n, para):
    return {"出处": "正文", "章": n, "原句": q(n, para)}


PANEL_FIELDS = {
    "神典石": {"type": "number", "min": 0},
    "关注者": {"type": "number", "min": 0},
    "任务": {"type": "list", "item": {"名称": {"type": "text"}, "状态": {"type": "enum", "values": ["进行中", "已完成"]}, "奖励": {"type": "text"}}},
    "道具": {"type": "list", "item": {"名称": {"type": "text"}, "数量": {"type": "number"}}},
}
CHARACTER_FIELDS = {k: {"type": "text"} for k in ["本名", "代号", "种族", "外貌", "性格", "说话方式", "能力", "所属", "住处", "变身形态", "财务"]}
CHARACTER_FIELDS["立绘"] = {"type": "image"}


def entry(eid, name, aliases, tree, summary, comps, blocks, character=None, panel=None):
    init = {"entry": {"name": name, "aliases": aliases, "summary": summary}}
    if character is not None:
        init["character"] = character
    if panel is not None:
        init["panel"] = panel
    return {"id": eid, "tree": tree, "components": comps, "panel_fields": PANEL_FIELDS if panel is not None else {},
            "出场": None, "initial": init,
            "blocks": [{"id": f"{eid.replace('e-', 'b-')}-{i}", "title": t, "text": x} for i, (t, x) in enumerate(blocks, 1)]}


E = [
    entry("e-sutianqing", "苏天晴", ["狐狐", "小狐狸", "金毛狐女"], "人物/主角", "重生成金毛狐女、与墨丘利秘典签约的反派魔法少女", ["人物", "面板", "情节"],
          [("", "# {entry.name}\n\n前世是连上三个夜班后倒在面摊上的社畜，重生成了一只金毛狐女，接手了同名原主人的身体与生活（见 <Ref to=\"e-yuanzhu\"/>）。"),
           ("外貌与性格", "外貌：{character.外貌}\n性格：{character.性格}\n说话方式：{character.说话方式}\n变身后：{character.变身形态}\n立绘：{character.立绘}"),
           ("处境", "住在{character.住处}。与 <Ref to=\"e-midian\"/> 签了契约，要当王道系故事里的反派魔法少女。目前有 {panel.神典石} 神典石，{panel.神典石 >= 100 ? \"够买一瓶强化药\" : \"买不起强化药\"}；关注者 {panel.关注者} 人。")],
          character={"本名": "苏天晴", "种族": "狐兽人", "外貌": "娇小的金毛狐女：金色长发垂到后背，头顶一对狐耳，背后一条毛茸茸的大尾巴，金色眼眸",
                     "性格": "嘴上贫，爱发癫，对可爱的东西毫无抵抗力；人前装作游刃有余的反派，心里容易慌", "说话方式": "自称“爷”“狐狐”，叫墨丘利秘典“小破书”",
                     "变身形态": "金色短款洋装，过膝白袜，缎带装饰，胸前一枚金色十字星", "住处": "蓉城东部",
                     "立绘": {"图片": "assets/苏天晴/日常.png", "说明": "金色长发，穿睡衣"}},
          panel={"神典石": 200, "关注者": 0, "任务": [], "道具": []}),
    entry("e-yuanzhu", "苏天晴（原主人）", ["原主人", "苏天晴小姐"], "人物/配角", "这副身体原来的主人，与主角同名，已因暴发性心肌炎去世", ["人物", "情节"],
          [("", "# {entry.name}\n\n性格：{character.性格}\n财务：{character.财务}\n\n从小独自长大，靠兽人互助协会资助考上蓉城医学院；在网上写小说挣饭钱。她的夙愿写在秘典的任务里：“成为闪耀的魔法少女，让所有人记住你的名字。”")],
          character={"本名": "苏天晴", "种族": "狐兽人", "性格": "社恐孤僻，极少出门", "财务": "存款捉襟见肘，背着学费贷款"}),
    entry("e-midian", "墨丘利秘典", ["黑色古书", "秘典", "古书", "小破书"], "道具", "自称星界使者的会说话的黑色古书，与苏天晴签了反派魔法少女契约", ["情节"],
          [("", "# {entry.name}\n\n一本飘在半空、会说话的黑色古书，自称来自星空彼岸的星界使者，在寻找“最优秀的适格者”。与苏天晴签约后就不再开口，改为在书页上浮现文字：任务、情报，以及对手的行踪预测。"),
           ("商店", "秘典有一个商店，可以用神典石买道具。商店只收神典石，余额不够就买不了，不能赊账。契约成立时，秘典给苏天晴准备了 200 神典石的启动资金。")]),
    entry("e-shouhuzhixing", "守护之星", ["金色十字星", "十字星"], "道具", "魔法少女的变身道具，金色十字星", ["情节"],
          [("", "# {entry.name}\n\n魔法少女必备的变身道具。苏天晴的这一枚是从秘典里掉出来的金色十字星，沾上她的鼻血后激活。按住十字星中央的凹陷就能变身；喊口号没有用。")]),
    entry("e-fengxinzi", "风信子", ["魔法少女风信子", "南小风"], "人物/魔法少女", "在蓉城活跃的天蓝色魔法少女，擅长近战肉搏", ["人物", "情节"],
          [("", "# {entry.name}\n\n{character.外貌}，代号{character.代号}，本名{character.本名}。\n能力：{character.能力}\n所属：{character.所属}")],
          character={"代号": "风信子", "本名": "南小风", "外貌": "天蓝色的魔法少女", "能力": "魔杖化作大剑，擅长近战压制与肉搏，对魔法尚不熟练", "所属": "接受英雄协会的管辖委派"}),
    entry("e-yingxiongxiehui", "英雄协会", ["协会"], "组织", "管辖并委派魔法少女的组织", ["情节"],
          [("", "# {entry.name}\n\n管辖和委派魔法少女。魔法少女一边与怪人战斗，一边作为偶像出镜；真实身份保密，变身后的样子广为人知。")]),
    entry("e-mofashaonv", "魔法少女", [], "世界观", "与怪人怪兽战斗的超凡者，接受英雄协会管辖", [],
          [("", "# 魔法少女\n\n客观存在。与怪人、怪兽战斗，接受 <Ref to=\"e-yingxiongxiehui\"/> 的管辖委派，同时作为偶像出镜。真实身份保密。")]),
    entry("e-guairen", "怪人与怪兽", ["怪人", "怪兽"], "世界观", "与魔法少女战斗的敌对存在", [],
          [("", "# 怪人与怪兽\n\n客观存在，会袭击城市，由魔法少女迎击。秘典能预测它们在哪里出现。")]),
    entry("e-shouren", "兽人", ["猫娘", "狐娘"], "世界观", "与人类共存但数量远少于人类的种族", [],
          [("", "# 兽人\n\n这个世界人类与兽人共存。兽人指猫娘、狐娘这类。数量远远不及人类，有兽人互助协会。在蓉城并不少见。")]),
    entry("e-rongcheng", "蓉城", [], "地点", "故事所在的城市", [],
          [("", "# 蓉城\n\n故事所在的城市。苏天晴住在东部；中心城区有天府广场与 <Ref to=\"e-lvxingongyuan\"/>，坐地铁从东部过去要两个小时。目前只有风信子一名活跃的魔法少女。")]),
    entry("e-lvxingongyuan", "绿心公园", ["蓉城市绿心公园"], "地点", "蓉城中心城区最大的湿地公园", [],
          [("", "# 绿心公园\n\n蓉城最大的湿地公园，在中心城区，是地标。")]),
]

S, Y, MD, FX, XH, LX, GR = "e-sutianqing", "e-yuanzhu", "e-midian", "e-fengxinzi", "e-yingxiongxiehui", "e-lvxingongyuan", "e-guairen"


def rec(rid, eff, desc, narr, inv, lines_=(), patches=(), kind="已写", conf="确定", src="Agent"):
    r = {"id": rid, "描述": desc, "种类": kind, "生效位置": eff, "讲述": list(narr), "涉及": list(inv), "剧情线": list(lines_),
         "连接": [], "补丁": list(patches), "核对点": [], "生效状态": "生效", "把握": conf, "来源": src}
    if kind == "计划":
        r["进展"] = "未兑现"
    return r


def task(tid, name, state, reward=None):
    v = {"id": tid, "名称": name, "状态": state}
    if reward:
        v["奖励"] = reward
    return {"条目": S, "字段": "panel.任务", "操作": "增加", "值": v}


def ch(n, order):
    return {"章": f"ch{n}", "序": order}


R = [
    rec("c01", {"前史": 1}, "前世：连上三个夜班后，在街边面摊吃面时胸口一疼眼前一黑，失去意识（急性心肌梗死）", [told(1, 15)], [S], ["重生"]),
    rec("c02", {"前史": 2}, "原主人苏天晴临开学前染上兽人流感，熬夜时突发暴发性心肌炎去世", [told(2, 20)], [Y]),
    rec("c03", ch(1, 4), "苏天晴醒来，发现自己重生成金毛狐女，遇见飘浮的黑色古书", [told(1, 4)], [S, MD], ["重生"]),
    rec("c04", ch(1, 41), "古书自称墨丘利秘典、星界使者，提出签约；苏天晴不加犹豫答应", [told(1, 41)], [S, MD], ["当反派魔法少女"]),
    rec("c05", ch(1, 60), "苏天晴得知要当王道系故事里的反派魔法少女，秘典宣布契约成立", [told(1, 60)], [S, MD], ["当反派魔法少女"],
        [task("t1", "走上反派魔法少女的道路", "进行中")]),
    rec("c06", ch(2, 17), "苏天晴从身体残留的记忆里得知原主人的经历：同名，社恐孤僻，考上蓉城医学院，死于暴发性心肌炎", [told(2, 17)], [S, Y], ["重生"]),
    rec("c07", ch(2, 30), "翻开秘典时金色十字星掉出砸脸，沾上鼻血后激活为守护之星；秘典序章完成，开启每日任务", [told(2, 33)], [S, MD, "e-shouhuzhixing"], ["当反派魔法少女"],
        [task("t2", "秘典序章", "已完成")]),
    rec("c07b", ch(2, 39.5), "秘典序章完成，苏天晴得到 10 神典石的序章奖励", [told(2, 39)], [S, MD], ["当反派魔法少女"],
        [{"条目": S, "字段": "panel.神典石", "操作": "+=", "值": 10}], conf="估计"),
    rec("c08", ch(2, 48), "按住十字星中央凹陷后完成初次变身；看到变身后的样子，接受了反派魔法少女的身份", [told(2, 48)], [S, "e-shouhuzhixing"], ["当反派魔法少女"]),
    rec("c09", ch(2, 78), "秘典第一页显示每日任务1：找茬正牌魔法少女，奖励 100 神典石", [told(2, 78)], [S, MD], ["找茬风信子"],
        [task("t3", "每日任务1：找茬魔法少女", "进行中", "100 神典石")]),
    rec("c10", ch(3, 4), "早餐时查资料，了解魔法少女与英雄协会，看了风信子的战斗视频，担心打不过肉搏型的她", [told(3, 4)], [S, FX, XH], ["找茬风信子"]),
    rec("c11", ch(3, 20), "秘典第二页显示任务“夙愿”：获得 200 名关注者，奖励 500 神典石；第三页给出风信子的情报和今晚绿心公园出现怪人的预测", [told(3, 20)], [S, MD, FX, LX], ["找茬风信子"],
        [task("t4", "夙愿：获得200名关注者", "进行中", "500 神典石")]),
    rec("c12", ch(3, 35), "中午坐两个小时地铁到市中心，进绿心公园，在长椅上看秘典、查手机，了解原主人的处境，决心让她过上更好的生活", [told(3, 35)], [S, LX, Y], ["找茬风信子"]),
    rec("c13", ch(3, 73), "入夜，怪人袭击绿心公园，居民逃散；苏天晴等风信子到来，说准备了一份“见面礼”", [told(3, 73)], [S, LX, GR], ["找茬风信子"]),
    rec("c14", {"章": "ch4"}, "风信子接到英雄协会通讯赶到绿心公园，击倒黑狼怪人", [{"出处": "细纲", "原话": "风信子赶到公园，大剑击倒黑狼"}], [FX, LX, GR], ["找茬风信子"], kind="计划", src="作者"),
    rec("c15", {"章": "ch4"}, "苏天晴在秘典商店花 100 神典石买强化药，灌给黑狼", [{"出处": "细纲", "原话": "狐狐花 100 神典石买药给黑狼灌下去"}], [S, MD, GR], ["找茬风信子"],
        [{"条目": S, "字段": "panel.神典石", "操作": "-=", "值": 100}], kind="计划", src="作者"),
    rec("c16", {"章": "ch4"}, "黑狼倒下后苏天晴现身自称反派，与风信子交手并赢下，完成每日任务1（奖励 100 神典石）", [{"出处": "细纲", "原话": "狐狐现身，赢下第一次找茬，每日任务完成"}], [S, FX], ["找茬风信子"],
        [{"条目": S, "字段": "panel.任务[t3].状态", "操作": "=", "值": "已完成"}, {"条目": S, "字段": "panel.神典石", "操作": "+=", "值": 100}], kind="计划", src="作者"),
    rec("c17", "未排章", "苏天晴在网上发视频，关注者开始增长", [{"出处": "手记", "原话": "以后靠发视频涨关注"}], [S], ["夙愿"], kind="计划", src="作者"),
]

world = {
    "revision": 1,
    "chapters": [{"id": f"ch{n}", "title": lines[n][1], "file": f"chapters/chapter-0{n}.txt"} for n in (1, 2, 3, 4)],
    "progress": "ch4",
    "component_types": {"人物": {"ns": "character", "fields": CHARACTER_FIELDS}, "面板": {"ns": "panel"}, "情节": {"ns": None}},
    "entries": {e["id"]: e for e in E},
    "records": {r["id"]: r for r in R},
    "pending": [], "questions": [], "modified": {}, "next_record": 18,
    "revisions": [{"版本": 1, "谁": "作者", "描述": "初始数据：第 1 到 3 章已记账，第 4 章有作者的计划", "操作": []}],
    "trap": {"entry": S, "block": "b-sutianqing-3", "key": f"{S}:mdx[b-sutianqing-3]", "find": "签了契约", "with": "签下了契约"},
}
json.dump(world, open(f"{OUT}/world.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("entries", len(E), "records", len(R))
