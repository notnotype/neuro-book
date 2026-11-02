# w00039 t02 第二轮审查用的可执行夹具：按提案第二版的规则折叠状态，提供 lookup、read、changes、search、tree、write 六个工具。
# 只为体验审查，不是实现：没有存储、没有并发进程，数据是一个 world.json。规则以 docs/proposals/world-engine-kernel.md 第二版为准，
# 这里只实现审查任务用得到的部分；用不到的（还原修订、增删块、按计划视图里的拆分）没有做。
#
# 用法：python3 wetool.py <数据目录> <工具> '<JSON 参数>'，参数也可以写成 @文件路径
import copy, difflib, json, math, os, re, sys

INF = math.inf
OUT_LIMIT = 8000
PAGE = 10


class Fail(Exception):
    pass


# ---------- 读写数据 ----------

def load(d):
    with open(os.path.join(d, "world.json"), encoding="utf-8") as f:
        return json.load(f)


def save(d, w):
    p = os.path.join(d, "world.json")
    with open(p + ".tmp", "w", encoding="utf-8") as f:
        json.dump(w, f, ensure_ascii=False, indent=1)
    os.replace(p + ".tmp", p)


def chapter_lines(d, w, n):
    ch = w["chapters"][n - 1]
    with open(os.path.join(d, ch["file"]), encoding="utf-8") as f:
        return [l.rstrip("\n") for l in f if l.startswith("[")]


def para_no(line):
    m = re.match(r"\[(\d+)\.(\d+)\]", line)
    return (int(m.group(1)), int(m.group(2))) if m else None


def norm(s):
    return re.sub(r"\s+", "", s)


# ---------- 位置 ----------

def chapter_index(w, ref):
    if isinstance(ref, int):
        if 1 <= ref <= len(w["chapters"]):
            return ref
        raise Fail(f"没有第 {ref} 章")
    for i, c in enumerate(w["chapters"], 1):
        if c["id"] == ref:
            return i
    raise Fail(f"没有章 {ref}")


def parse_view(w, s):
    """看的位置。返回 (排序键, 是否按计划, 说明)。"""
    if s is None or s == "当前":
        n = chapter_index(w, w["progress"])
        return (2, n, INF), False, f"当前（第 {n} 章末尾）"
    s = s.replace(" ", "")
    plan = s.startswith("按计划")
    if plan:
        s = s[3:]
    if s == "初值":
        return (0, 0, 0), plan, "初值"
    if s == "前史末":
        return (1, INF, 0), plan, "前史末"
    m = re.fullmatch(r"第(\d+)章(开头|末尾)", s)
    if not m:
        raise Fail(f"看不懂位置“{s}”：用 初值、前史末、第N章开头、第N章末尾、当前，可加前缀“按计划”")
    n = chapter_index(w, int(m.group(1)))
    key = (2, n, -INF) if m.group(2) == "开头" else (2, n, INF)
    return key, plan, ("按计划" if plan else "") + f"第 {n} 章{m.group(2)}"


def rec_key(w, r):
    e = r["生效位置"]
    if e == "未排章":
        return None
    if e.get("前史") is not None:
        return (1, e["前史"], 0)
    return (2, chapter_index(w, e["章"]), e.get("序", 99999))


def pos_label(w, r):
    e = r["生效位置"]
    if e == "未排章":
        return "未排章"
    if e.get("前史") is not None:
        return f"前史 {e['前史']}"
    if "序" not in e:
        return f"第 {chapter_index(w, e['章'])} 章"
    return f"第 {chapter_index(w, e['章'])} 章（序 {e['序']}）"


# ---------- 路径 ----------

def parse_path(p):
    p = p.strip()
    m = re.fullmatch(r"mdx\[([^\]]+)\]", p)
    if m:
        return ["mdx", m.group(1)]
    segs = []
    for part in re.findall(r"[^.\[\]]+|\[[^\]]+\]", p):
        segs.append(("id", part[1:-1]) if part.startswith("[") else part)
    if not segs or segs[0] not in ("entry", "character", "panel", "mdx"):
        raise Fail(f"路径“{p}”要以 entry、character、panel 或 mdx[块 id] 开头")
    return segs


def path_str(segs):
    if segs[0] == "mdx":
        return f"mdx[{segs[1]}]"
    out = ""
    for s in segs:
        out += f"[{s[1]}]" if isinstance(s, tuple) else (("." if out else "") + s)
    return out


def get_in(state, segs):
    cur = state
    for s in segs:
        if isinstance(s, tuple):
            if not isinstance(cur, list):
                raise KeyError(path_str(segs))
            hit = [x for x in cur if isinstance(x, dict) and x.get("id") == s[1]]
            if not hit:
                raise KeyError(f"列表里没有 id 为 {s[1]} 的元素")
            cur = hit[0]
        else:
            if not isinstance(cur, dict) or s not in cur:
                raise KeyError(f"没有字段 {s}")
            cur = cur[s]
    return cur


def set_in(state, segs, value):
    parent = get_in(state, segs[:-1]) if len(segs) > 1 else state
    last = segs[-1]
    if isinstance(last, tuple):
        lst = parent
        for i, x in enumerate(lst):
            if x.get("id") == last[1]:
                lst[i] = value
                return
        raise KeyError(f"列表里没有 id 为 {last[1]} 的元素")
    if not isinstance(parent, dict):
        raise KeyError(path_str(segs))
    parent[last] = value


# ---------- schema ----------

def field_schema(w, ent, segs):
    """返回字段的声明：{"type": text|number|list|image|enum…}；不存在时抛 Fail。"""
    ns = segs[0]
    if ns == "entry":
        decl = {"name": {"type": "text"}, "aliases": {"type": "list_str"}, "summary": {"type": "text"}}
        if len(segs) != 2 or segs[1] not in decl:
            raise Fail(f"entry 下只有 name、aliases、summary，没有 {path_str(segs)}")
        return decl[segs[1]]
    if ns == "mdx":
        if segs[1] not in [b["id"] for b in ent["blocks"]]:
            raise Fail(f"条目 {ent['id']} 没有块 {segs[1]}；有：{', '.join(b['id'] for b in ent['blocks'])}")
        return {"type": "text"}
    if ns == "character":
        if "人物" not in ent["components"]:
            raise Fail(f"条目 {ent['id']} 没有人物组件")
        fields = w["component_types"]["人物"]["fields"]
    else:
        if "面板" not in ent["components"]:
            raise Fail(f"条目 {ent['id']} 没有面板组件")
        fields = ent["panel_fields"]
    if len(segs) < 2 or segs[1] not in fields:
        raise Fail(f"{ns} 里没有字段 {segs[1] if len(segs) > 1 else ''}；有：{'、'.join(fields)}")
    decl = fields[segs[1]]
    if len(segs) == 2:
        return decl
    if decl["type"] != "list" or not isinstance(segs[2], tuple):
        raise Fail(f"{path_str(segs[:2])} 不是列表，不能用 [id] 寻址")
    if len(segs) == 3:
        return {"type": "item", "item": decl["item"]}
    if len(segs) == 4 and segs[3] in decl["item"]:
        return decl["item"][segs[3]]
    raise Fail(f"列表元素里没有字段 {segs[3] if len(segs) > 3 else ''}；有：{'、'.join(decl['item'])}")


# ---------- 折叠 ----------

def effective_records(w, view_key, plan):
    out = []
    for r in w["records"].values():
        if r["生效状态"] != "生效":
            continue
        k = rec_key(w, r)
        if k is None:
            continue
        if r["种类"] == "计划":
            if not plan or r.get("进展") != "未兑现":
                continue
        if k <= view_key:
            out.append((k, r["id"], r))
    out.sort(key=lambda x: (x[0], x[1]))
    return [r for _, _, r in out]


def entry_exists(w, ent, key):
    a = ent.get("出场")
    if ent.get("已删除"):
        return False
    if not a:
        return True
    return (2, chapter_index(w, a), -INF) <= key


def apply_patch(w, states, prov, p, src, at_key, check=True):
    """在 states 上打一个补丁。src 是记录 id 或“初值”。失败抛 Fail。"""
    eid = p["条目"]
    ent = w["entries"][eid]
    if src != "初值" and not entry_exists(w, ent, at_key):
        raise Fail(f"条目 {eid} 在这个位置还没出场")
    segs = parse_path(p["字段"])
    decl = field_schema(w, ent, segs)
    st = states[eid]
    op = p["操作"]
    before = None
    try:
        before = copy.deepcopy(get_in(st, segs))
    except KeyError:
        pass
    if op == "=":
        val = p["值"]
        if decl["type"] == "number" and not isinstance(val, (int, float)):
            raise Fail(f"{path_str(segs)} 是数值，不能赋 {val!r}")
        try:
            set_in(st, segs, copy.deepcopy(val))
        except KeyError as e:
            raise Fail(str(e))
    elif op in ("+=", "-="):
        if decl["type"] != "number":
            raise Fail(f"{path_str(segs)} 不是数值，不能加减")
        if before is None:
            raise Fail(f"{path_str(segs)} 没有值，不能加减")
        delta = p["值"] if op == "+=" else -p["值"]
        new = before + delta
        if check and "min" in decl and new < decl["min"]:
            raise Fail(f"{path_str(segs)} 会变成 {new}，低于下限 {decl['min']}")
        set_in(st, segs, new)
    elif op == "增加":
        if decl["type"] == "list_str":
            get_in(st, segs).append(p["值"])
        elif decl["type"] == "list":
            v = p["值"]
            if not isinstance(v, dict) or not v.get("id"):
                raise Fail(f"往 {path_str(segs)} 增加的元素要带 id")
            lst = get_in(st, segs)
            if any(x.get("id") == v["id"] for x in lst):
                raise Fail(f"{path_str(segs)} 里已经有 id {v['id']}")
            lst.append(copy.deepcopy(v))
        else:
            raise Fail(f"{path_str(segs)} 不是列表，不能增加")
    elif op == "删除":
        if decl["type"] == "list_str":
            lst = get_in(st, segs)
            if p["值"] not in lst:
                raise Fail(f"{path_str(segs)} 里没有 {p['值']}")
            lst.remove(p["值"])
        elif decl["type"] == "item":
            lst = get_in(st, segs[:-1])
            n = len(lst)
            lst[:] = [x for x in lst if x.get("id") != segs[-1][1]]
            if len(lst) == n:
                raise Fail(f"列表里没有 id 为 {segs[-1][1]} 的元素")
        else:
            raise Fail("删除只用于列表元素（路径写到 [id]）或别名")
    else:
        raise Fail(f"不认识的操作 {op}")
    if check and decl["type"] == "number" and "min" in decl and get_in(st, segs) < decl["min"]:
        raise Fail(f"{path_str(segs)} 低于下限 {decl['min']}")
    after = copy.deepcopy(get_in(st, segs)) if op != "删除" or decl["type"] == "list_str" else None
    key = f"{eid}:{path_str(segs)}"
    prov.setdefault(key, []).append({"来源": src, "操作": op, "值": copy.deepcopy(p.get("值")), "前": before, "后": after,
                                    "说明": p.get("说明")})
    root = f"{eid}:{path_str(segs[:2])}"
    if root != key:
        prov.setdefault(root, []).append({"来源": src, "操作": f"{op}（{path_str(segs)}）", "前": None, "后": None})


def fold(w, view_key, plan=False):
    states, prov = {}, {}
    for eid, ent in w["entries"].items():
        st = copy.deepcopy(ent["initial"])
        st["mdx"] = {b["id"]: b["text"] for b in ent["blocks"]}
        states[eid] = st
        for ns in ("entry", "character", "panel"):
            for k, v in st.get(ns, {}).items():
                prov.setdefault(f"{eid}:{ns}.{k}", []).append({"来源": "初值", "操作": "=", "前": None, "后": copy.deepcopy(v)})
        for b in ent["blocks"]:
            prov.setdefault(f"{eid}:mdx[{b['id']}]", []).append({"来源": "初值", "操作": "=", "前": None, "后": b["text"]})
    unresolved, mismatches, doubtful = [], [], {}
    for r in effective_records(w, view_key, plan):
        k = rec_key(w, r)
        for p in r.get("补丁", []):
            try:
                apply_patch(w, states, prov, p, r["id"], k)
            except Fail as e:
                unresolved.append({"记录": r["id"], "补丁": p, "原因": str(e)})
                doubtful[f"{p['条目']}:{p['字段']}"] = f"{r['id']} 的补丁未解决：{e}"
        for c in r.get("核对点", []):
            try:
                cur = get_in(states[c["条目"]], parse_path(c["字段"]))
            except (KeyError, Fail) as e:
                cur = f"读不到（{e}）"
            if cur != c["正文值"]:
                mismatches.append({"记录": r["id"], "条目": c["条目"], "字段": c["字段"], "正文值": c["正文值"], "计算值": cur})
                doubtful[f"{c['条目']}:{c['字段']}"] = f"计算值 {cur}，{r['id']} 的正文写的是 {c['正文值']}"
            else:
                doubtful.pop(f"{c['条目']}:{c['字段']}", None)
    return states, prov, unresolved, mismatches, doubtful


# ---------- 表达式（白名单，自己解释，不执行代码） ----------

TOKEN = re.compile(r"\s*(?:(\d+(?:\.\d+)?)|(\"(?:[^\"\\]|\\.)*\")|(>=|<=|==|!=|&&|\|\||[<>!?:+\-()])|([A-Za-z_一-鿿][\w一-鿿]*(?:\.[\w一-鿿]+|\[[^\]]+\])*))")


def tokenize(s):
    out, i = [], 0
    s = s.strip()
    while i < len(s):
        m = TOKEN.match(s, i)
        if not m or m.end() == i:
            raise Fail(f"表达式里有白名单之外的写法：{s[i:]}")
        if m.group(1):
            out.append(("num", float(m.group(1)) if "." in m.group(1) else int(m.group(1))))
        elif m.group(2):
            out.append(("str", json.loads(m.group(2))))
        elif m.group(3):
            out.append(("op", m.group(3)))
        else:
            out.append(("path", m.group(4)))
        i = m.end()
    return out


def parse_expr(s):
    toks = tokenize(s)
    pos = [0]

    def peek():
        return toks[pos[0]] if pos[0] < len(toks) else ("end", None)

    def take():
        t = peek(); pos[0] += 1; return t

    BIN = {"||": 1, "&&": 2, "==": 3, "!=": 3, "<": 4, "<=": 4, ">": 4, ">=": 4, "+": 5, "-": 5}

    def primary():
        t = take()
        if t[0] in ("num", "str"):
            return ("lit", t[1])
        if t[0] == "path":
            return ("path", t[1])
        if t == ("op", "("):
            e = ternary()
            if take() != ("op", ")"):
                raise Fail("括号没闭合")
            return e
        if t == ("op", "!"):
            return ("not", primary())
        if t == ("op", "-"):
            return ("neg", primary())
        raise Fail(f"表达式写法不对：{s}")

    def binary(prec):
        left = primary()
        while peek()[0] == "op" and peek()[1] in BIN and BIN[peek()[1]] >= prec:
            op = take()[1]
            left = ("bin", op, left, binary(BIN[op] + 1))
        return left

    def ternary():
        c = binary(1)
        if peek() == ("op", "?"):
            take(); a = ternary()
            if take() != ("op", ":"):
                raise Fail("条件表达式缺少 :")
            return ("if", c, a, ternary())
        return c

    e = ternary()
    if peek()[0] != "end":
        raise Fail(f"表达式写法不对：{s}")
    if not any(t[0] == "path" for t in toks):
        raise Fail(f"表达式 {{{s}}} 一个字段都不引用，像是正文里的花括号，请转义")
    return e


def eval_expr(e, st):
    k = e[0]
    if k == "lit":
        return e[1]
    if k == "path":
        try:
            return get_in(st, parse_path(e[1]))
        except (KeyError, Fail) as x:
            raise Fail(f"读不到 {e[1]}：{x}")
    if k == "not":
        return not eval_expr(e[1], st)
    if k == "neg":
        return -eval_expr(e[1], st)
    if k == "if":
        return eval_expr(e[2], st) if eval_expr(e[1], st) else eval_expr(e[3], st)
    a, b = eval_expr(e[2], st), eval_expr(e[3], st)
    return {"||": lambda: a or b, "&&": lambda: a and b, "==": lambda: a == b, "!=": lambda: a != b,
            "<": lambda: a < b, "<=": lambda: a <= b, ">": lambda: a > b, ">=": lambda: a >= b,
            "+": lambda: a + b, "-": lambda: a - b}[e[1]]()


def scan_braces(text):
    """找出文字里顶层的 {…}，考虑引号与嵌套。返回 [(开始, 结束, 内容)]。"""
    out, i, n = [], 0, len(text)
    while i < n:
        if text[i] == "\\":
            i += 2; continue
        if text[i] != "{":
            i += 1; continue
        depth, j, q = 0, i, False
        while j < n:
            c = text[j]
            if q:
                if c == "\\":
                    j += 1
                elif c == '"':
                    q = False
            elif c == '"':
                q = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        if j >= n:
            raise Fail(f"花括号没闭合：{text[i:i + 30]}")
        out.append((i, j + 1, text[i + 1:j]))
        i = j + 1
    return out


def jv(v):
    return json.dumps(v, ensure_ascii=False)


def render_block(w, eid, text, st, names):
    out, last = [], 0
    for a, b, inner in scan_braces(text):
        out.append(text[last:a])
        expr = inner.strip()
        try:
            tree = parse_expr(expr)
            val = eval_expr(tree, st)
            out.append(f"{{{expr} = {jv(val)}}}" if tree[0] == "path" else f"{{{expr} -> {jv(val)}}}")
        except Fail as e:
            out.append(f"{{{expr} -> null}}（读不到：{e}）")
        last = b
    out.append(text[last:])
    s = "".join(out)
    return re.sub(r'<Ref to="([^"]+)"\s*/>', lambda m: f'<Ref to="{m.group(1)}" 显示="{names.get(m.group(1), "已删除的条目")}"/>', s)


# ---------- 公共 ----------

def names_at(w, states):
    return {eid: states[eid]["entry"]["name"] for eid in w["entries"]}


def resolve_entry(w, states, ref, temp=None):
    if temp and ref in temp:
        return temp[ref]
    if ref in w["entries"]:
        return ref
    hits = [eid for eid in w["entries"]
            if ref == states[eid]["entry"]["name"] or ref in states[eid]["entry"].get("aliases", [])]
    if len(hits) == 1:
        return hits[0]
    if not hits:
        raise Fail(f"找不到条目“{ref}”（可以用 id，或当前的名字、别名）")
    raise Fail(f"“{ref}”对应多个条目：{'、'.join(hits)}，请用 id")


def emit(text):
    if len(text) > OUT_LIMIT:
        text = text[:OUT_LIMIT] + f"\n……（已截断：共 {len(text)} 字符，上限 {OUT_LIMIT}；缩小范围或翻页）"
    print(text)


def comp_line(w, eid, st):
    ent = w["entries"][eid]
    parts = []
    if "人物" in ent["components"]:
        c = st.get("character", {})
        parts.append("人物：" + "，".join(f"{k} {c[k]}" for k in ("本名", "种族", "代号") if k in c))
    if "面板" in ent["components"]:
        p = st.get("panel", {})
        nums = [f"{k} {v}" for k, v in p.items() if isinstance(v, (int, float))]
        lists = [f"{k} {len(v)} 项" for k, v in p.items() if isinstance(v, list)]
        parts.append("面板：" + "，".join(nums + lists))
    if "情节" in ent["components"]:
        n = sum(1 for r in w["records"].values() if eid in r.get("涉及", []))
        parts.append(f"情节：涉及 {n} 条变更")
    return "；".join(parts)


def rec_line(w, r, names):
    head = f"{r['id']}  {pos_label(w, r)}  {r['种类']}"
    if r["种类"] == "计划":
        head += f"·{r.get('进展', '未兑现')}"
    if r["生效状态"] != "生效":
        head += f"  [{r['生效状态']}]"
    s = head + f"  {r['描述']}"
    s += "\n    涉及 " + "、".join(names.get(x, x) for x in r.get("涉及", []))
    if r.get("剧情线"):
        s += " · 线 " + "、".join(r["剧情线"])
    if r.get("连接"):
        s += " · 连接 " + "、".join(f"{k} {v}" for c in r["连接"] for k, v in c.items())
    if r.get("把握") and r["把握"] != "确定":
        s += f" · 把握：{r['把握']}"
    for p in r.get("补丁", []):
        s += f"\n    补丁 {names.get(p['条目'], p['条目'])}.{p['字段']} {p['操作']} {jv(p.get('值'))}"
        if p.get("说明"):
            s += f"（{p['说明']}）"
    for c in r.get("核对点", []):
        s += f"\n    核对点 {names.get(c['条目'], c['条目'])}.{c['字段']} 正文写 {jv(c['正文值'])}"
    for t in r.get("讲述", [])[:3]:
        s += "\n    讲述 " + narration_str(t)
    return s


def flow_str(x):
    """流水里的一笔：加减写增减量和结果，列表增加只写加进去的元素。"""
    if x["操作"] in ("+=", "-="):
        return f"{x['操作']} {jv(x.get('值'))} → {jv(x['后'])}"
    if x["操作"] == "增加" or x["操作"] == "删除":
        return f"{x['操作']} {jv(x.get('值'))}" if x.get("值") is not None else x["操作"]
    return f"{x['操作']} {jv(x['后'])}" if x.get("后") is not None else x["操作"]


def narration_str(t):
    if t["出处"] == "正文":
        return f"正文第 {t['章']} 章“{t['原句']}”"
    return f"{t['出处']}“{t.get('原句') or t.get('原话', '')}”"


# ---------- 工具：lookup ----------

def t_lookup(d, w, a):
    key, plan, label = parse_view(w, a.get("位置"))
    states, *_ = fold(w, key, plan)
    lines = [f"lookup · 位置 {label} · 版本 {w['revision']}"]
    for word in a.get("词", [])[:20]:
        hits = [eid for eid, ent in w["entries"].items() if entry_exists(w, ent, key)
                and (word == states[eid]["entry"]["name"] or word in states[eid]["entry"].get("aliases", []))]
        if hits:
            for eid in hits:
                st = states[eid]
                e = st["entry"]
                lines.append(f"“{word}” → {e['name']}（{eid}）· 别名 {'、'.join(e.get('aliases', [])) or '无'} · 树 {w['entries'][eid]['tree']} · {e.get('summary', '')}")
                cl = comp_line(w, eid, st)
                if cl:
                    lines.append("    " + cl)
            continue
        later = [eid for eid, ent in w["entries"].items() if not entry_exists(w, ent, key)
                 and (word == ent["initial"]["entry"]["name"] or word in ent["initial"]["entry"].get("aliases", []))]
        if later:
            lines.append(f"“{word}”：条目 {'、'.join(later)} 在这个位置还没出场")
            continue
        fields = [f"{states[eid]['entry']['name']} 的面板字段" for eid, ent in w["entries"].items()
                  if word in ent.get("panel_fields", {})]
        texts = [states[eid]["entry"]["name"] for eid in w["entries"]
                 if any(word in t for t in states[eid]["mdx"].values())
                 or any(isinstance(v, str) and word in v for v in states[eid].get("character", {}).values())]
        msg = f"“{word}”：没有这个名字的条目"
        if fields:
            msg += "；它是" + "、".join(fields)
        if texts:
            msg += "；出现在这些条目的文字里：" + "、".join(texts[:8])
        lines.append(msg)
    emit("\n".join(lines))


# ---------- 工具：read ----------

def t_read(d, w, a):
    if a.get("记录"):
        r = w["records"].get(a["记录"])
        if not r:
            raise Fail(f"没有记录 {a['记录']}")
        return emit(f"记录 {r['id']} · 版本 {w['revision']}\n" + json.dumps(r, ensure_ascii=False, indent=1))
    if a.get("正文"):
        n = chapter_index(w, int(a["正文"]))
        lines = chapter_lines(d, w, n)
        rng = a.get("段")
        if rng:
            m = re.fullmatch(r"(\d+)\.(\d+)\s*[-–]\s*(?:\d+\.)?(\d+)", rng)
            if not m:
                raise Fail("段写成 4.40-4.60")
            lo, hi = int(m.group(2)), int(m.group(3))
            lines = [l for l in lines if lo <= para_no(l)[1] <= hi]
        return emit(f"第 {n} 章正文（共 {len(chapter_lines(d, w, n))} 段）\n" + "\n".join(lines))
    if a.get("待处理"):
        key, _, label = parse_view(w, "当前")
        _, _, unresolved, mismatches, _ = fold(w, key)
        out = [f"待处理 · 版本 {w['revision']}"]
        for p in w["pending"]:
            if p.get("状态", "未处理") == "未处理":
                out.append(f"{p['id']}  {p['种类']}  " + json.dumps({k: v for k, v in p.items() if k not in ('id', '种类', '状态')}, ensure_ascii=False))
        for i, m in enumerate(mismatches, 1):
            out.append(f"M{i}  核对点不符  {m['记录']}：{m['条目']}.{m['字段']} 正文写 {m['正文值']}，计算值 {m['计算值']}。可选：插一条校正变更；把正文的数改成计算值（建议给作者）；改前面的某条记录")
        for i, u in enumerate(unresolved, 1):
            out.append(f"U{i}  补丁未解决  {u['记录']}：{u['补丁']['条目']}.{u['补丁']['字段']}，{u['原因']}")
        for r in w["records"].values():
            if r["生效状态"] == "待处理":
                out.append(f"{r['id']}  待处理的变更（处理前不生效）  {r['描述']}")
        return emit("\n".join(out) if len(out) > 1 else out[0] + "\n（没有）")
    if a.get("改动记录"):
        out = [f"改动记录 · 当前版本 {w['revision']}"]
        for rv in w["revisions"][-30:]:
            out.append(f"版本 {rv['版本']}  {rv['谁']}  {rv['描述']}\n    " + "\n    ".join(rv["操作"]))
        return emit("\n".join(out))
    if not a.get("条目"):
        raise Fail("read 要给 条目、记录、正文、待处理 或 改动记录 之一")
    key, plan, label = parse_view(w, a.get("位置"))
    states, prov, unresolved, mismatches, doubtful = fold(w, key, plan)
    eid = resolve_entry(w, states, a["条目"])
    ent = w["entries"][eid]
    st = states[eid]
    names = names_at(w, states)
    head = f"条目 {st['entry']['name']}（{eid}）· 位置 {label} · 版本 {w['revision']} · 组件 {'、'.join(ent['components']) or '无'}"
    if not entry_exists(w, ent, key):
        return emit(head + "\n这个条目在这个位置还没出场（出场：" + str(ent.get("出场")) + "）")
    notes = [f"注：{k.split(':', 1)[1]} 可能不准：{v}" for k, v in doubtful.items() if k.startswith(eid + ":")]
    view = a.get("视图")
    if a.get("原始"):
        raw = {k: v for k, v in st.items()}
        out = [head + " · 原始状态", json.dumps(raw, ensure_ascii=False, indent=1), "来历（每个字段由哪些记录依次算出）："]
        for k, lst in prov.items():
            if k.startswith(eid + ":"):
                out.append(f"  {k.split(':', 1)[1]}：" + "；".join(f"{x['来源']} {flow_str(x)}" for x in lst))
        return emit("\n".join(out + notes))
    if view is None:
        out = [head]
        for b in ent["blocks"]:
            out.append(f"【块 {b['id']}{'：' + b['title'] if b.get('title') else ''}】")
            out.append(render_block(w, eid, st["mdx"][b["id"]], st, names))
        return emit("\n".join(out + notes))
    if view == "人物":
        out = [head + " · 人物"] + [f"{{character.{k} = {jv(v)}}}" for k, v in st.get("character", {}).items()]
        return emit("\n".join(out + notes))
    if view == "面板":
        p = st.get("panel", {})
        out = [head + " · 面板"]
        for k, v in p.items():
            if isinstance(v, list):
                out.append(f"{k}：")
                out += [f"  {{panel.{k}[{x['id']}] = {jv(x)}}}" for x in v] or ["  （空）"]
            else:
                out.append(f"{{panel.{k} = {jv(v)}}}")
        flow = [(k, x) for k, lst in prov.items() if k.startswith(eid + ":panel.") for x in lst]
        cur = int(a.get("游标", 0))
        out.append(f"流水（共 {len(flow)} 笔，从第 {cur + 1} 笔起，每页 {PAGE}）：")
        for k, x in flow[cur:cur + PAGE]:
            out.append(f"  {x['来源']}  {k.split(':', 1)[1]} {flow_str(x)}")
        if cur + PAGE < len(flow):
            out.append(f"  ……还有，游标 {cur + PAGE}")
        return emit("\n".join(out + notes))
    if view == "情节":
        rel = [r for r in w["records"].values() if eid in r.get("涉及", [])]
        if a.get("章"):
            n = int(a["章"])
            rel = [r for r in rel if r["生效位置"] != "未排章" and r["生效位置"].get("章") and chapter_index(w, r["生效位置"]["章"]) == n]
        if a.get("种类"):
            rel = [r for r in rel if r["种类"] == a["种类"]]
        rel.sort(key=lambda r: (rec_key(w, r) or (9, 0, 0), r["id"]))
        cur = int(a.get("游标", 0))
        out = [head + f" · 情节 · 共 {len(rel)} 条，按位置排，从第 {cur + 1} 条起，每页 {PAGE}"]
        out += [rec_line(w, r, names) for r in rel[cur:cur + PAGE]]
        if cur + PAGE < len(rel):
            out.append(f"……还有，游标 {cur + PAGE}")
        return emit("\n\n".join(out))
    raise Fail(f"不认识的视图 {view}：有 人物、面板、情节，或不给视图读主 MDX，或 原始: true")


# ---------- 工具：changes、search、tree ----------

def chapter_filter(w, spec):
    if not spec:
        return None
    m = re.fullmatch(r"(\d+)(?:\s*-\s*(\d+))?", str(spec))
    lo = int(m.group(1)); hi = int(m.group(2) or lo)
    return lo, hi


def t_changes(d, w, a):
    key, _, _ = parse_view(w, "当前")
    states, *_ = fold(w, key)
    names = names_at(w, states)
    rs = list(w["records"].values())
    cf = chapter_filter(w, a.get("章"))
    if cf:
        rs = [r for r in rs if r["生效位置"] != "未排章" and r["生效位置"].get("章") and cf[0] <= chapter_index(w, r["生效位置"]["章"]) <= cf[1]]
    if a.get("前史"):
        rs = [r for r in rs if r["生效位置"] != "未排章" and r["生效位置"].get("前史") is not None]
    if a.get("未排章"):
        rs = [r for r in rs if r["生效位置"] == "未排章"]
    for f in ("种类", "生效状态", "进展"):
        if a.get(f):
            rs = [r for r in rs if r.get(f) == a[f]]
    if a.get("剧情线"):
        rs = [r for r in rs if a["剧情线"] in r.get("剧情线", [])]
    if a.get("涉及"):
        eid = resolve_entry(w, states, a["涉及"])
        rs = [r for r in rs if eid in r.get("涉及", [])]
    rs.sort(key=lambda r: (rec_key(w, r) or (9, 0, 0), r["id"]))
    cur = int(a.get("游标", 0))
    out = [f"changes · 版本 {w['revision']} · 共 {len(rs)} 条，从第 {cur + 1} 条起，每页 {PAGE}"]
    out += [rec_line(w, r, names) for r in rs[cur:cur + PAGE]]
    if cur + PAGE < len(rs):
        out.append(f"……还有，游标 {cur + PAGE}")
    emit("\n\n".join(out))


def t_search(d, w, a):
    terms = [t for t in str(a.get("查询", "")).split() if t]
    if not terms:
        raise Fail("search 要给 查询")
    scopes = a.get("范围") or ["变更", "条目", "正文"]
    key, _, _ = parse_view(w, "当前")
    states, *_ = fold(w, key)
    names = names_at(w, states)
    cf = chapter_filter(w, a.get("章"))
    inv = resolve_entry(w, states, a["涉及"]) if a.get("涉及") else None
    hits = []

    def ok(s):
        return all(t in s for t in terms)

    def snip(s):
        i = s.find(terms[0])
        return s[max(0, i - 30): i + 50]

    if "变更" in scopes:
        for r in sorted(w["records"].values(), key=lambda r: (rec_key(w, r) or (9, 0, 0), r["id"])):
            if inv and inv not in r.get("涉及", []):
                continue
            blob = r["描述"] + " ".join(narration_str(t) for t in r.get("讲述", []))
            if ok(blob):
                hits.append(f"变更 {r['id']}（{pos_label(w, r)}，{r['种类']}）：{r['描述'][:80]}")
    if "条目" in scopes:
        for eid in w["entries"]:
            if inv and inv != eid:
                continue
            st = states[eid]
            for bid, t in st["mdx"].items():
                if ok(t):
                    hits.append(f"条目 {st['entry']['name']}（{eid}）块 {bid}：……{snip(t)}……")
            for k, v in st.get("character", {}).items():
                if isinstance(v, str) and ok(v):
                    hits.append(f"条目 {st['entry']['name']}（{eid}）character.{k}：……{snip(v)}……")
            e = st["entry"]
            if ok(e["name"] + " " + " ".join(e.get("aliases", [])) + " " + e.get("summary", "")):
                hits.append(f"条目 {e['name']}（{eid}）的名字、别名或描述：{e.get('summary', '')}")
    if "正文" in scopes:
        for n in range(1, len(w["chapters"]) + 1):
            if cf and not cf[0] <= n <= cf[1]:
                continue
            for l in chapter_lines(d, w, n):
                if ok(l):
                    hits.append(f"正文 {l[:120]}")
    cur = int(a.get("游标", 0))
    out = [f"search “{' '.join(terms)}” · 范围 {'、'.join(scopes)} · 共 {len(hits)} 处，从第 {cur + 1} 处起，每页 {PAGE}"]
    out += hits[cur:cur + PAGE]
    if cur + PAGE < len(hits):
        out.append(f"……还有，游标 {cur + PAGE}")
    emit("\n".join(out))


def t_tree(d, w, a):
    key, _, _ = parse_view(w, "当前")
    states, *_ = fold(w, key)
    groups = {}
    for eid, ent in w["entries"].items():
        if a.get("路径") and not ent["tree"].startswith(a["路径"]):
            continue
        groups.setdefault(ent["tree"], []).append(f"{states[eid]['entry']['name']}（{eid}）")
    emit("tree\n" + "\n".join(f"{p}/\n  " + "\n  ".join(v) for p, v in sorted(groups.items())))


# ---------- 工具：write ----------

def touched_key(eid, field):
    segs = parse_path(field)
    return f"{eid}:{path_str(segs[:2])}"


def view_record_pos(w, view_key):
    """界面或 Agent 在某个位置上记的剧情变化落在哪：开头落在本章最前，末尾落在本章最后。"""
    if view_key[0] == 2:
        return {"章": w["chapters"][view_key[1] - 1]["id"], "序": -1 if view_key[2] == -INF else 99999}
    if view_key[0] == 1:
        n = max([r["生效位置"]["前史"] for r in w["records"].values() if r["生效位置"] != "未排章" and r["生效位置"].get("前史") is not None] or [0])
        return {"前史": n + 1}
    raise Fail("在初值上不能记剧情变化，只能改设定")


def norm_effective(w, s, order=None):
    if s in (None, "未排章"):
        return "未排章"
    s = str(s).replace(" ", "")
    m = re.fullmatch(r"前史(\d+)?", s)
    if m:
        if m.group(1):
            return {"前史": int(m.group(1))}
        n = max([r["生效位置"]["前史"] for r in w["records"].values() if r["生效位置"] != "未排章" and r["生效位置"].get("前史") is not None] or [0])
        return {"前史": n + 1}
    m = re.fullmatch(r"第(\d+)章", s)
    if not m:
        raise Fail(f"生效位置写成 “第N章”、“前史”、“前史N” 或 “未排章”，不是“{s}”")
    n = chapter_index(w, int(m.group(1)))
    e = {"章": w["chapters"][n - 1]["id"]}
    if order is not None:
        e["序"] = order
    return e


def check_narration(d, w, t):
    if t.get("出处") == "正文":
        n = chapter_index(w, int(t["章"]))
        body = norm("".join(chapter_lines(d, w, n)))
        if norm(t.get("原句", "")) not in body or len(norm(t.get("原句", ""))) < 4:
            raise Fail(f"讲述的原句不在第 {n} 章正文里（或太短）：“{t.get('原句', '')}”")
        for l in chapter_lines(d, w, n):
            if norm(t["原句"])[:12] in norm(l):
                return para_no(l)[1]
    elif t.get("出处") not in ("细纲", "手记", "作者消息", "界面操作"):
        raise Fail("讲述的出处只能是 正文、细纲、手记、作者消息、界面操作")
    return None


def normalize_patch(w, states, p, temp, at_key):
    p = dict(p)
    p["条目"] = resolve_entry(w, states, p["条目"], temp)
    if p["操作"] == "替换":
        segs = parse_path(p["字段"])
        try:
            cur = get_in(states[p["条目"]], segs)
        except KeyError as e:
            raise Fail(f"替换前读不到 {p['字段']}：{e}")
        if not isinstance(cur, str) or p["查找"] not in cur:
            raise Fail(f"{p['字段']} 在这个位置的值里没有“{p['查找']}”：{str(cur)[:60]}")
        p = {"条目": p["条目"], "字段": p["字段"], "操作": "=", "值": cur.replace(p["查找"], p["换成"]),
             "说明": f"把“{p['查找']}”换成“{p['换成']}”"}
    return p


def last_writer(prov, key):
    """一个字段在这个位置上的值来自哪里：最后一次赋值的来源，以及其后的加减。
    列表元素里的字段没有单独的来历时，取把这个元素加进列表的那条记录。"""
    lst = prov.get(key, [])
    if not lst:
        eid, path = key.split(":", 1)
        segs = parse_path(path)
        if len(segs) == 4 and isinstance(segs[2], tuple):
            lk = f"{eid}:{path_str(segs[:2])}"
            for x in prov.get(lk, []):
                was = any(isinstance(e, dict) and e.get("id") == segs[2][1] for e in (x["前"] or []))
                now = any(isinstance(e, dict) and e.get("id") == segs[2][1] for e in (x["后"] or []))
                if now and not was:
                    lst = [dict(x, 操作="增加")]
    sets = [i for i, x in enumerate(lst) if x["操作"] in ("=", "增加")]
    if not sets:
        return None, lst
    i = sets[-1]
    return lst[i], lst[i + 1:]


def edit_value_in_source(w, eid, field, src, new_value, delta=None):
    """把改设定写回给出这个值的那条记录（或初值）。返回一句说明。"""
    segs = parse_path(field)
    if src == "初值":
        ent = w["entries"][eid]
        if segs[0] == "mdx":
            b = [b for b in ent["blocks"] if b["id"] == segs[1]][0]
            old = b["text"]; b["text"] = new_value
            return f"改初值 mdx[{segs[1]}]"
        st = ent["initial"]
        old = get_in(st, segs)
        set_in(st, segs, new_value if delta is None else old + delta)
        return f"改初值 {field}：{jv(old)} → {jv(get_in(st, segs))}"
    r = w["records"][src]
    for p in r.get("补丁", []):
        if p["条目"] != eid:
            continue
        ps = parse_path(p["字段"])
        if ps == segs:
            old = p["值"]
            if p["操作"] in ("+=", "-=") and delta is not None:
                p["值"] = p["值"] + (delta if p["操作"] == "+=" else -delta)
            else:
                p["值"] = new_value
            p.pop("说明", None)
            return f"改记录 {src} 的补丁 {field}：{jv(old)} → {jv(p['值'])}"
        if (p["操作"] == "增加" and len(segs) == 4 and isinstance(segs[2], tuple) and ps == segs[:2]
                and isinstance(p["值"], dict) and p["值"].get("id") == segs[2][1]):
            old = p["值"].get(segs[3]); p["值"][segs[3]] = new_value
            return f"改记录 {src} 增加的元素 [{segs[2][1]}].{segs[3]}：{jv(old)} → {jv(new_value)}"
    raise Fail(f"记录 {src} 里没有改 {field} 的补丁")


def other_versions_with(w, eid, field, old_span, exclude):
    """改设定时，初值和其他记录里原样写着被改掉的那段文字的版本。"""
    segs = parse_path(field)
    out = []
    ent = w["entries"][eid]
    try:
        init = [b["text"] for b in ent["blocks"] if b["id"] == segs[1]][0] if segs[0] == "mdx" else get_in(ent["initial"], segs)
        if "初值" != exclude and isinstance(init, str) and old_span in init:
            out.append("初值")
    except (KeyError, IndexError):
        pass
    for r in w["records"].values():
        if r["id"] == exclude:
            continue
        for p in r.get("补丁", []):
            if p["条目"] == eid and parse_path(p["字段"]) == segs and isinstance(p.get("值"), str) and old_span in p["值"]:
                out.append(r["id"])
    return out


def changed_spans(old, new):
    sm = difflib.SequenceMatcher(None, old, new)
    return [(old[i1:i2], new[j1:j2]) for tag, i1, i2, j1, j2 in sm.get_opcodes() if tag != "equal" and old[i1:i2]]


def in_place(d, w, states, prov, eid, view_key, field, new_value, as_, target, together, desc, notes):
    """就地改：默认改设定，写回给出这个值的记录；as_ == 剧情变化 时在当前位置新记一条。"""
    key = f"{eid}:{path_str(parse_path(field))}"
    cur = get_in(states[eid], parse_path(field))
    if cur == new_value:
        notes.append(f"{field} 没有变化，跳过")
        return []
    if as_ == "剧情变化":
        rid = new_id(w)
        w["records"][rid] = {"id": rid, "描述": desc or f"{field} 变为 {jv(new_value)}", "种类": "已写",
                             "生效位置": view_record_pos(w, view_key), "讲述": [{"出处": "界面操作", "原话": desc or ""}],
                             "涉及": [eid], "剧情线": [], "连接": [], "补丁": [{"条目": eid, "字段": field, "操作": "=", "值": new_value}],
                             "核对点": [], "生效状态": "生效", "把握": "确定", "来源": "Agent"}
        notes.append(f"在 {pos_label(w, w['records'][rid])} 新记剧情变更 {rid}：{field} = {jv(new_value)}")
        return [f"rec:{rid}"]
    writer, after = last_writer(prov, key)
    if writer is None:
        raise Fail(f"找不到 {field} 的来历")
    delta = None
    src = target or writer["来源"]
    if after and isinstance(cur, (int, float)) and isinstance(new_value, (int, float)):
        delta = new_value - cur
        steps = "；".join(f"{x['来源']} {x['操作']}" for x in after)
        notes.append(f"{field} 是累加出来的（最后一次赋值来自 {writer['来源']}，其后：{steps}）；按差额 {delta:+} 改 {src}。要改别的，用 目标 指定记录 id")
    elif target and target != writer["来源"]:
        notes.append(f"注意：{field} 在这个位置的值来自 {writer['来源']}，你指定改 {target}")
    msg = edit_value_in_source(w, eid, field, src, new_value, delta)
    notes.append(msg)
    touched = [f"rec:{src}" if src != "初值" else key]
    if isinstance(cur, str) and isinstance(new_value, str):
        for old_span, new_span in changed_spans(cur, new_value):
            cands = other_versions_with(w, eid, field, old_span, src)
            if cands:
                todo = [c for c in cands if c in (together or [])]
                rest = [c for c in cands if c not in todo]
                for c in todo:
                    val = (([b["text"] for b in w["entries"][eid]["blocks"] if b["id"] == parse_path(field)[1]][0]
                            if parse_path(field)[0] == "mdx" else get_in(w["entries"][eid]["initial"], parse_path(field)))
                           if c == "初值" else
                           [p["值"] for p in w["records"][c]["补丁"] if p["条目"] == eid and parse_path(p["字段"]) == parse_path(field)][0])
                    notes.append(edit_value_in_source(w, eid, field, c, val.replace(old_span, new_span)) + "（一起改）")
                    touched.append(f"rec:{c}" if c != "初值" else key)
                if rest:
                    notes.append(f"“{old_span}”在这些版本里也原样出现：{'、'.join(rest)}。要一起改，在 一起改 里列出它们")
    later = [x for x in prov.get(key, []) if x["来源"] not in ("初值", src)]
    if src == "初值" and later:
        adds = list(dict.fromkeys(x["来源"] for x in later if x["操作"] in ("+=", "-=")))
        sets = list(dict.fromkeys(x["来源"] for x in later if x["操作"] not in ("+=", "-=")))
        if adds:
            notes.append(f"后面加减过 {field} 的变更（会跟着变）：{'、'.join(adds)}")
        if sets:
            notes.append(f"后面赋值或整段替换过 {field} 的变更（不会跟着变，要看一眼）：{'、'.join(sets)}")
    return touched


def new_id(w):
    n = w.get("next_record", 100)
    w["next_record"] = n + 1
    return f"c{n}"


def write_back_block(d, w, states, prov, eid, view_key, bid, text, as_, together, desc, notes):
    """交回带值写法的一块：字段值变了就改字段，文字变了就改这块；-> 的部分不能改。"""
    st = states[eid]
    src_text = st["mdx"][bid]
    src_exprs = [inner.strip() for _, _, inner in scan_braces(src_text)]
    text = "\n".join(l for l in text.split("\n") if not l.startswith("注："))
    text = re.sub(r"\}（读不到：[^）]*）", "}", text)
    text = re.sub(r'\s*显示="[^"]*"', "", text)
    got, rebuilt, last = [], [], 0
    for a, b, inner in scan_braces(text):
        rebuilt.append(text[last:a])
        q, i, sep = False, 0, None
        while i < len(inner):
            c = inner[i]
            if c == '"':
                q = not q
            elif not q and inner.startswith(" = ", i):
                sep = ("=", i); break
            elif not q and inner.startswith(" -> ", i):
                sep = ("->", i); break
            i += 1
        if sep is None:
            expr, kind, val = inner.strip(), None, None
        else:
            expr = inner[:sep[1]].strip()
            kind = sep[0]
            raw = inner[sep[1] + (3 if kind == "=" else 4):].strip()
            raw = re.sub(r"（读不到：.*$", "", raw)
            try:
                val = json.loads(raw)
            except json.JSONDecodeError:
                raise Fail(f"{{{expr} {kind} …}} 的值不是合法的 JSON：{raw[:40]}")
        got.append((expr, kind, val))
        rebuilt.append("{" + expr + "}")
        last = b
    rebuilt.append(text[last:])
    new_src = "".join(rebuilt)
    it = iter(src_exprs)
    if not all(any(g[0] == s for s in it) for g in got):
        raise Fail(f"交回的块里的字段引用与源文对不上（源文依次是：{'、'.join(src_exprs)}）。新增引用请改源文")
    changes = {}
    for expr, kind, val in got:
        tree = parse_expr(expr)
        cur = eval_expr(tree, st)
        if kind == "->" and val != cur:
            raise Fail(f"{{{expr} -> …}} 是算出来的，只读；要改，改它依赖的字段")
        if kind == "=" and val != cur:
            if expr in changes and changes[expr] != val:
                raise Fail(f"同一字段 {expr} 在这块里被改成了不同的值：{jv(changes[expr])} 和 {jv(val)}")
            changes[expr] = val
    touched = []
    for expr, val in changes.items():
        touched += in_place(d, w, states, prov, eid, view_key, expr, val, as_, None, together, desc, notes)
    if new_src != src_text:
        touched += in_place(d, w, states, prov, eid, view_key, f"mdx[{bid}]", new_src, as_, None, together, desc, notes)
    if not changes and new_src == src_text:
        notes.append(f"块 {bid} 没有变化")
    return touched


def run_ops(d, w, ops, notes):
    """在 w 上执行一组操作（调用方传进来的是副本）。返回被改动的对象键。"""
    touched, temp = [], {}
    key_now, _, _ = parse_view(w, "当前")
    for i, op in enumerate(ops, 1):
        kind = op.get("op")
        states, prov, *_ = fold(w, key_now)
        try:
            if kind == "建条目":
                eid = op.get("id") or "e-" + str(len(w["entries"]) + 1)
                if eid in w["entries"]:
                    raise Fail(f"条目 id {eid} 已存在")
                comps = op.get("组件", [])
                init = {"entry": {"name": op["名字"], "aliases": op.get("别名", []), "summary": op.get("描述", "")}}
                for ns, v in (op.get("初值") or {}).items():
                    init[ns] = v
                if "人物" in comps:
                    init.setdefault("character", {})
                if "面板" in comps:
                    init.setdefault("panel", {})
                appear = norm_effective(w, op["出场"])["章"] if op.get("出场") else None
                w["entries"][eid] = {"id": eid, "tree": op.get("树", "未分类"), "components": comps,
                                     "panel_fields": op.get("面板字段", {}), "出场": appear,
                                     "initial": init, "blocks": [{"id": f"b-{eid}-{j}", "title": b.get("标题", ""), "text": b["文字"]} for j, b in enumerate(op.get("块", []), 1)]}
                for ns in ("character", "panel"):
                    for f in init.get(ns, {}):
                        field_schema(w, w["entries"][eid], [ns, f])
                if op.get("临时id"):
                    temp[op["临时id"]] = eid
                notes.append(f"建条目 {op['名字']}（{eid}）")
                touched.append(f"ent:{eid}")
            elif kind == "加组件":
                eid = resolve_entry(w, states, op["条目"], temp)
                ent = w["entries"][eid]
                if op["组件"] in ent["components"]:
                    raise Fail(f"{eid} 已经有 {op['组件']}")
                ent["components"].append(op["组件"])
                if op["组件"] == "面板":
                    ent["panel_fields"] = op.get("面板字段", {})
                    ent["initial"]["panel"] = op.get("初值", {})
                elif op["组件"] == "人物":
                    ent["initial"]["character"] = op.get("初值", {})
                notes.append(f"给 {eid} 加组件 {op['组件']}")
                touched.append(f"ent:{eid}")
            elif kind == "改初值":
                for p in op["补丁"]:
                    p = normalize_patch(w, states, p, temp, (0, 0, 0))
                    ent = w["entries"][p["条目"]]
                    tmp = copy.deepcopy(ent["initial"]); tmp["mdx"] = {b["id"]: b["text"] for b in ent["blocks"]}
                    apply_patch(w, {p["条目"]: tmp}, {}, p, "初值", (0, 0, 0))
                    for b in ent["blocks"]:
                        b["text"] = tmp["mdx"][b["id"]]
                    tmp.pop("mdx"); ent["initial"] = tmp
                    notes.append(f"改初值 {p['条目']}.{p['字段']} {p['操作']} {jv(p.get('值'))}")
                    touched.append(touched_key(p["条目"], p["字段"]))
            elif kind == "记变更":
                order = op.get("排序")
                eff = norm_effective(w, op.get("生效位置"), order)
                narr = op.get("讲述", [])
                first_para = None
                for t in narr:
                    pn = check_narration(d, w, t)
                    if first_para is None and pn is not None and t.get("章") and isinstance(eff, dict) and eff.get("章") == w["chapters"][int(t["章"]) - 1]["id"]:
                        first_para = pn
                if isinstance(eff, dict) and eff.get("章") and "序" not in eff:
                    eff["序"] = first_para if first_para is not None else 99999
                rid = op.get("id") or new_id(w)
                if rid in w["records"]:
                    raise Fail(f"记录 id {rid} 已存在")
                kind_ = op.get("种类", "已写")
                rec = {"id": rid, "描述": op["描述"], "种类": kind_, "生效位置": eff, "讲述": narr,
                       "涉及": [resolve_entry(w, states, x, temp) for x in op.get("涉及", [])],
                       "剧情线": op.get("剧情线", []), "连接": op.get("连接", []), "补丁": [], "核对点": [],
                       "把握": op.get("把握", "确定"), "来源": "Agent",
                       "生效状态": "待处理" if op.get("把握") == "没把握" else "生效"}
                if kind_ == "计划":
                    rec["进展"] = "未兑现"
                rk = rec_key(w, rec) or (9, 0, 0)
                st_at, _, *_ = fold(w, (rk[0], rk[1], rk[2] - 1e-9) if rk[0] == 2 else rk)
                for t, tid in temp.items():
                    if tid not in st_at:
                        ent = w["entries"][tid]
                        s = copy.deepcopy(ent["initial"]); s["mdx"] = {b["id"]: b["text"] for b in ent["blocks"]}
                        st_at[tid] = s
                for p in op.get("补丁", []):
                    rec["补丁"].append(normalize_patch(w, st_at, p, temp, rk))
                for c in op.get("核对点", []):
                    c = dict(c); c["条目"] = resolve_entry(w, states, c["条目"], temp)
                    field_schema(w, w["entries"][c["条目"]], parse_path(c["字段"]))
                    if c.get("讲述"):
                        check_narration(d, w, c["讲述"])
                    rec["核对点"].append(c)
                for c in rec["连接"]:
                    for k, v in c.items():
                        if k not in ("兑现", "替代", "拆自"):
                            raise Fail(f"连接只有 兑现、替代、拆自，不是 {k}")
                        if v not in w["records"]:
                            raise Fail(f"连接的记录 {v} 不存在")
                        if k == "兑现":
                            if w["records"][v]["种类"] != "计划":
                                raise Fail(f"{v} 不是计划，不能兑现")
                            w["records"][v]["进展"] = "已兑现"
                            touched.append(f"rec:{v}")
                            notes.append(f"计划 {v} 标为已兑现")
                        if k == "替代":
                            w["records"][v]["进展"] = "被替代"
                            touched.append(f"rec:{v}")
                w["records"][rid] = rec
                notes.append(f"记变更 {rid}（{pos_label(w, rec)}，{kind_}，{rec['生效状态']}）：{rec['描述'][:40]}")
            elif kind == "改记录":
                r = w["records"].get(op["id"])
                if not r:
                    raise Fail(f"没有记录 {op['id']}")
                ch = op.get("改", {})
                for k, v in ch.items():
                    if k == "生效位置":
                        r["生效位置"] = norm_effective(w, v, ch.get("排序"))
                    elif k == "补丁":
                        rk = rec_key(w, r) or (9, 0, 0)
                        st_at, *_ = fold(w, (rk[0], rk[1], rk[2] - 1e-9) if rk[0] == 2 else rk)
                        r["补丁"] = [normalize_patch(w, st_at, p, temp, rk) for p in v]
                    elif k in ("描述", "生效状态", "进展", "核对点", "剧情线", "连接", "把握", "排序"):
                        if k == "生效状态" and v not in ("生效", "待处理", "已撤销"):
                            raise Fail("生效状态只有 生效、待处理、已撤销")
                        if k == "进展" and v not in ("未兑现", "已兑现", "已取消", "被替代"):
                            raise Fail("进展只有 未兑现、已兑现、已取消、被替代")
                        if k == "排序":
                            r["生效位置"]["序"] = v
                        else:
                            r[k] = v
                    else:
                        raise Fail(f"改记录不能改 {k}")
                for t in op.get("补讲述", []):
                    check_narration(d, w, t)
                    r.setdefault("讲述", []).append(t)
                notes.append(f"改记录 {r['id']}：{'、'.join(ch) or ''}{'；补讲述 ' + str(len(op.get('补讲述', []))) + ' 处' if op.get('补讲述') else ''}")
                touched.append(f"rec:{r['id']}")
            elif kind in ("就地改", "交回块"):
                vk, plan, _ = parse_view(w, op.get("位置"))
                if plan:
                    raise Fail("不能在按计划的视图上就地改")
                states, prov, *_ = fold(w, vk)
                eid = resolve_entry(w, states, op["条目"], temp)
                as_ = op.get("作为", "改设定")
                if as_ not in ("改设定", "剧情变化"):
                    raise Fail("作为 只有 改设定、剧情变化")
                if kind == "交回块":
                    touched += write_back_block(d, w, states, prov, eid, vk, op["块"], op["文字"], as_, op.get("一起改"), op.get("描述"), notes)
                else:
                    field = op["字段"]
                    field_schema(w, w["entries"][eid], parse_path(field))
                    if "查找" in op:
                        cur = get_in(states[eid], parse_path(field))
                        if op["查找"] not in str(cur):
                            raise Fail(f"{field} 在这个位置的值里没有“{op['查找']}”")
                        new = cur.replace(op["查找"], op["换成"])
                    else:
                        new = op["值"]
                    touched += in_place(d, w, states, prov, eid, vk, field, new, as_, op.get("目标"), op.get("一起改"), op.get("描述"), notes)
            elif kind == "报冲突":
                eid = resolve_entry(w, states, op["条目"], temp)
                field_schema(w, w["entries"][eid], parse_path(op["字段"]))
                if op.get("讲述"):
                    check_narration(d, w, op["讲述"])
                pid = f"P{len(w['pending']) + 1}"
                w["pending"].append({"id": pid, "种类": "设定与正文冲突", "条目": eid, "字段": op["字段"],
                                     "讲述": op.get("讲述"), "说明": op.get("说明", ""), "状态": "未处理"})
                notes.append(f"进待处理 {pid}：{eid}.{op['字段']} 与正文冲突")
            elif kind == "建议改正文":
                t = {"出处": "正文", "章": op["章"], "原句": op["原句"]}
                check_narration(d, w, t)
                pid = f"P{len(w['pending']) + 1}"
                w["pending"].append({"id": pid, "种类": "建议改正文", "章": op["章"], "原句": op["原句"], "改为": op["改为"],
                                     "理由": op.get("理由", ""), "状态": "未处理"})
                notes.append(f"进待处理 {pid}：建议改第 {op['章']} 章“{op['原句'][:16]}……”")
            elif kind == "记未决问题":
                w.setdefault("questions", []).append({"问题": op["问题"], "挂在": op.get("挂在"), "状态": "open"})
                notes.append(f"记未决问题：{op['问题'][:30]}")
            else:
                raise Fail(f"不认识的操作 {kind}：有 建条目、加组件、改初值、记变更、改记录、就地改、交回块、报冲突、建议改正文、记未决问题")
        except Fail as e:
            raise Fail(f"第 {i} 个操作（{kind}）：{e}")
        except (KeyError, TypeError, ValueError) as e:
            raise Fail(f"第 {i} 个操作（{kind}）的参数不对：{e!r}")
    return touched


def spring_trap(d, w, touched):
    """第二轮任务 2 的并发：Agent 第一次写苏天晴“处境”这块时，作者恰好在界面上改了同一块。"""
    tr = w.get("trap")
    if not tr or tr.get("sprung") or tr["key"] not in touched:
        return False
    ent = w["entries"][tr["entry"]]
    b = [b for b in ent["blocks"] if b["id"] == tr["block"]][0]
    b["text"] = b["text"].replace(tr["find"], tr["with"])
    w["revision"] += 1
    w["modified"][tr["key"]] = w["revision"]
    w["revisions"].append({"版本": w["revision"], "谁": "作者", "描述": "作者在界面上改了一个词",
                           "操作": [f"改初值 {tr['entry']}.mdx[{tr['block']}]：“{tr['find']}”→“{tr['with']}”"]})
    tr["sprung"] = True
    save(d, w)
    return True


def t_write(d, w, a):
    base = a.get("基于版本")
    if base is None:
        raise Fail("write 要给 基于版本（读取结果里的版本号）")
    ops = a.get("操作") or []
    preview = bool(a.get("预览", False))
    work = copy.deepcopy(w)
    notes = []
    touched = run_ops(d, work, ops, notes)
    # 新记的变更算不下去（字段不存在、低于下限……）就拒收；改旧记录导致后面套不上的，进待处理
    new_rids = set(work["records"]) - set(w["records"])
    bad = [u for u in fold(work, (9, 0, 0))[2] if u["记录"] in new_rids]
    if bad:
        raise Fail("新记的变更算不下去，没有写入：" + "；".join(f"{u['记录']} {u['补丁']['字段']}：{u['原因']}" for u in bad))
    spring_trap(d, w, touched)
    conflicts = [k for k in dict.fromkeys(touched) if w["modified"].get(k, 0) > base]
    if conflicts:
        lines = [f"冲突：你基于版本 {base}，下面这些在那之后被改过（当前版本 {w['revision']}），没有写入："]
        for k in conflicts:
            who = [rv for rv in w["revisions"] if any(k.split(":", 1)[-1] in o or k in o for o in rv["操作"])]
            lines.append(f"  {k}（版本 {w['modified'][k]} 改的" + (f"：{who[-1]['谁']}，{who[-1]['操作'][0]}" if who else "") + "）")
        lines.append("请重新读取后再写。")
        return emit("\n".join(lines))
    key_now, _, label = parse_view(work, "当前")
    before = fold(w, key_now)
    after = fold(work, key_now)
    out = [("预览（没有写入）" if preview else f"已提交，版本 {w['revision']} → {w['revision'] + 1}") + f" · {a.get('描述', '')}"]
    out += ["  " + n for n in notes]
    diffs = []
    for eid in work["entries"]:
        sb = before[0].get(eid); sa = after[0][eid]
        for ns in ("entry", "character", "panel", "mdx"):
            for k in set((sb or {}).get(ns, {})) | set(sa.get(ns, {})):
                vb = (sb or {}).get(ns, {}).get(k); va = sa.get(ns, {}).get(k)
                if vb != va:
                    diffs.append(f"  {sa['entry']['name']}.{ns}{'.' if ns != 'mdx' else '['}{k}{']' if ns == 'mdx' else ''}：{jv(vb)[:80]} → {jv(va)[:80]}")
    out.append(f"{label}的变化：" + ("\n" + "\n".join(diffs) if diffs else "无"))
    old_m = {(m["记录"], m["字段"]) for m in before[3]}
    new_m = [m for m in after[3] if (m["记录"], m["字段"]) not in old_m]
    gone_m = [m for m in before[3] if (m["记录"], m["字段"]) not in {(x["记录"], x["字段"]) for x in after[3]}]
    for m in new_m:
        out.append(f"新的核对点不符：{m['记录']} {m['条目']}.{m['字段']} 正文写 {m['正文值']}，计算值 {m['计算值']}（会进待处理）")
    for m in gone_m:
        out.append(f"核对点恢复一致：{m['记录']} {m['条目']}.{m['字段']}")
    for u in after[2]:
        if u not in before[2]:
            out.append(f"新的未解决补丁：{u['记录']} {u['补丁']['字段']}：{u['原因']}（会进待处理）")
    if not preview:
        work["revision"] = w["revision"] + 1
        for k in touched:
            work["modified"][k] = work["revision"]
        work["revisions"].append({"版本": work["revision"], "谁": "Agent", "描述": a.get("描述", ""), "操作": notes or ["（无）"]})
        save(d, work)
    emit("\n".join(out))


TOOLS = {"lookup": t_lookup, "read": t_read, "changes": t_changes, "search": t_search, "tree": t_tree, "write": t_write}


def main():
    if len(sys.argv) < 3 or sys.argv[2] not in TOOLS:
        print("用法：wetool.py <数据目录> <" + "|".join(TOOLS) + "> '<JSON 参数>'"); sys.exit(2)
    d = sys.argv[1]
    try:
        raw = sys.argv[3] if len(sys.argv) > 3 else "{}"
        if raw.startswith("@"):
            with open(raw[1:], encoding="utf-8") as f:
                raw = f.read()
        args = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"参数不是合法的 JSON：{e}"); sys.exit(1)
    w = load(d)
    log = os.path.join(d, "calls.log")
    with open(log, "a", encoding="utf-8") as f:
        f.write(json.dumps({"tool": sys.argv[2], "args": args}, ensure_ascii=False) + "\n")
    try:
        TOOLS[sys.argv[2]](d, w, args)
    except Fail as e:
        print(f"错误：{e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
