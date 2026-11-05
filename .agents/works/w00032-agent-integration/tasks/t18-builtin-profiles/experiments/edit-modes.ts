/**
 * t18 决定 10 的一次性实验：主创的 `edit` 缺省用 hashline 还是 replace。真实内核、真实工具、真实模型。
 *
 * 运行：拷到 worktree 的 `packages/neuro-book/src/plugins/agent/edit-modes.experiment.ts`（不提交），在 `packages/neuro-book` 下
 *   bun --env-file=<仓库根>/.env run src/plugins/agent/edit-modes.experiment.ts <preflight|run> <输出 JSON> [模型…]
 * 模型写 deepseek、luna。预检通过的组合才跑。判据与定缺省的规则见 ../plan.md 的“edit 模式实验”。
 */

import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {defineProfile} from "@notnotype/nb-harness/kernel";

import {agentProfile} from "./shared/points";
import {agentWorld} from "./testing/world";
import type {AgentWorld} from "./testing/world";

type Mode = "hashline" | "replace";
const MODES: readonly Mode[] = ["hashline", "replace"];
const TOOL: Record<Mode, string> = {hashline: "nbook.agent.edit", replace: "nbook.agent.edit-replace"};
const profileKey = (mode: Mode) => `test.exp.${mode}`;

/** 一段是一串句子；每句以句号、问号或叹号结尾，所以“第几句”数得清。 */
const PARAGRAPHS: readonly (readonly string[])[] = [
    ["陈砚推开药铺的后门时，天刚擦黑，巷子里只剩下卖炭人的独轮车还在吱呀作响。", "他把那包从城外带回来的干草放在门槛上，先听了听屋里的动静。", "柜台后面没有人，算盘却摆在正中，珠子停在一个他看不懂的数上。", "他记得师父从不把算盘摊开过夜，这是铺子里三十年没变过的规矩。", "炉子已经冷了，药罐底下结着一层黑褐色的渣，闻起来像是当归又不全是。", "窗棂上挂着一串铜铃，风从河边吹过来，它却一声也不响，因为铃舌被人用棉线细细地缠住了。", "陈砚伸手碰了碰那段棉线，线头还是新的，打结的手法也不是师父惯用的那种。", "他把线头凑到灯下看了看，断口整齐，是用小剪子剪的，不是用牙咬的。", "师父的牙早就不好了，可师父也从来不用剪子，他嫌剪子碍事，向来是用切药的刀顺手一划。", "屋后的水缸盖子歪着，缸里的水却是满的，水面上浮着两片没有沉下去的柳叶。"],
    ["第二天一早，他去城南找沈知秋打听消息。", "沈知秋在码头替人记账，手上总沾着洗不掉的墨，见了谁都先笑，笑完才想起要问人家是谁。", "陈砚把棉线递给她看，她捏在指间转了两圈，说这种线只有东市的绣坊在卖，一捆要比别处贵上一倍。", "她又说，前天夜里有条没挂灯的船靠过岸，卸的不是货，是两口空箱子。", "陈砚问她有没有看清船上的人，她摇头，只说领头的那个走路时左脚有点拖。", "码头上的铜铃这时响了起来，是盐船到了，她把账本往腋下一夹，让他晚上再来。", "他站在原地，看着她挤进扛包的人群里，忽然想起师父的左脚也受过伤。", "那是很多年前的事了，师父从来不提，只在阴雨天把脚搁在炉边的小凳上，一声不吭地烤上半天。", "有一回他问起来，师父只说是自己不小心，然后让他去把那筐刚晒好的陈皮再翻一遍。", "码头的风把咸味一阵一阵地送过来，他在风里站到盐船卸完第一舱，才转身往东市的方向走。"],
    ["东市的绣坊开在一条窄街的尽头，门脸不大，后院却连着三进屋子。", "老板娘姓贺，四十来岁，说话慢条斯理，手里的针却快得看不清。", "陈砚谎称替药铺买线扎药包，贺娘子抬眼看了看他的鞋，问他是不是从城外走来的。", "他说是，她便不再问，只从柜子底层拿出一捆线，说这一捆是上个月剩下的，买主后来没再来过。", "他付了钱，接过线的时候，闻到上面有一股很淡的艾草味。", "走出巷口，他才发觉自己一直攥着袖子里的那段旧线，掌心全是汗。", "巷口有个卖糖人的老头，正把一勺糖稀吹成一只鼓着肚子的鸟，几个孩子围着他，谁也不说话。", "陈砚在摊子前站了片刻，把新买的那捆线换到另一边的袖子里，免得两段线缠到一起分不清。", "他回头望了一眼，绣坊的门已经关上了，门上的铜环还在轻轻地晃，好像刚刚有人从里面拉过一下。", "他没有走原路回去，而是绕到河边，沿着晒网的木架子走了很长一段。"],
    ["回到铺子已是午后，他把两段线并排放在桌上比了很久。", "粗细一样，颜色也一样，只是旧的那段多捻了一股。", "他想起师父教他认药时说过，同样的东西要看它多出来的那一点，多出来的才是人留下的。", "门外有人敲了三下，停一停，又敲了两下，是周掌柜常用的敲法。", "周掌柜进门便说，官府今早封了西门，说是查私盐，可城里的盐价一文也没涨。", "陈砚给他倒了茶，没有提棉线的事，只问他最近有没有见过师父。", "周掌柜端着茶碗想了半天，说五天前见过一回，师父在买纸，买的还是最差的那种草纸。", "陈砚听了没有作声，师父写方子一向只用铺子里那种厚实的皮纸，说是草纸存不住字。", "周掌柜喝完茶，把碗放下，又把碗往里推了推，这是他要走的意思，可他坐着没有动。", "过了一会儿他才说，西门那边查得很怪，只查进城的，不查出城的，你要是有什么要往外送，这两天正好。"],
    ["入夜以后，陈砚照着沈知秋说的去了码头。", "潮水正在退，石阶上露出一层滑腻的青苔，他走得很慢，每一步都先用脚尖试过。", "账房的灯还亮着，沈知秋却不在里面，桌上压着一张字条，只写了一个时辰和一个地名。", "他把字条揣进怀里，吹灭了灯，又在黑暗里站了一会儿，等眼睛适应过来。", "远处有桨声，很轻，像是怕惊动什么，他顺着声音看过去，只看见一道比夜色更深的影子。", "那影子靠岸之后就不动了，既没有人下船，也没有人上船。", "他在石阶上蹲到腿发麻，才听见有人压低了嗓子喊了一声师父的名字。", "喊的不是师父如今用的名字，是他只在一张旧方子的落款上见过一次的那个名字。", "船上没有人应声，岸上也没有，那一声喊就那样落进了水里，连个响动也没有留下。", "过了很久，桨声又响起来，这一回是往下游去的，他一直等到再也听不见，才慢慢站起身，活动了一下僵硬的膝盖。"],
    ["第三天，城里开始传药铺的闲话，说陈砚的师父卷了钱跑了。", "隔壁卖豆腐的刘婶特意端了一碗豆浆过来，放下就走，走到门口又回头叹了口气。", "陈砚没有解释，他把铺门打开，照常抓药、称药、包药，手底下一点也没有乱。", "到了晌午，来抓药的人比平日还多，有一半只是想看看他的脸色。", "他在账本上记下每一笔，记到第七笔的时候，发现这一页的纸比别的页薄。", "他把那一页对着光举起来，看见背面透出几行极淡的字，是师父的笔迹。", "他没有立刻去读，而是合上账本，把最后两个等着抓药的客人打发走，又把门板一块一块地装了回去。", "刘婶在隔壁喊他吃饭，他应了一声，没有过去，只把那碗已经凉透的豆浆端起来喝了。", "等到屋里只剩他一个人，他才把灯点上，把灯芯捻到最小，重新翻开了那一页。", "灯光很暗，他不得不把脸凑得很近，近到能闻见纸上那股陈年的樟脑气味。"],
    ["那几行字说的是一桩十二年前的旧事，陈砚读了三遍才读明白。", "十二年前的冬天，河上封了冻，城里缺药，师父带着两个伙计从北边运回来一批当归。", "药到城门口的时候被扣下了，说是其中夹带了违禁的东西，两个伙计当场被带走，从此再没有人见过他们。", "师父在牢里关了四十天，出来时左脚已经废了一半，再也走不了远路。", "那批当归后来出现在贺家的库房里，账上写的却是收购，价钱只有市价的三成。", "贺家当时还只是一个做小生意的人家，靠着这批药熬过了那个冬天，第二年就在东市盘下了铺面。", "师父没有告过状，也没有上过门，他只是把这件事一笔一笔地记了下来，记了十二年。", "他记下了当年经手的每一个人，记下了他们后来搬去了哪里、做了什么营生、娶了谁家的女儿。", "他记得那个扣药的小吏后来升了官，又因为一桩亏空被贬回来，如今在西门守城，每天都要喝半斤烧酒。", "他记得那个写假账的先生早就死了，死前把账本的副本交给了自己的侄女，那个侄女如今在码头替人记账。", "陈砚读到这里停了下来，把灯芯挑亮了一点，又把这句话看了一遍。", "他想起沈知秋捏着棉线的样子，想起她说东市的绣坊时那种不紧不慢的语气，想起她让他晚上再来的时候并没有看他。", "他不知道她知道多少，也不知道她是在帮他，还是在替她叔父把这笔账收回来。", "字条的后半截写得很急，有几个字连笔连得几乎认不出，他对着光辨认了很久才认全。", "师父写道，那两口空箱子是他让人运的，箱子本身没有用处，有用的是谁会来看它们。", "他要等的人左脚不拖，拖着左脚的那个是他自己雇来的船夫，专门走给想看的人看。", "最后一行只有九个字，叫他不要找，把铺子开下去，账照常记，算盘不要收。", "陈砚把那一页重新夹回账本，起身走到柜台后面，看着那架摊开的算盘，这才明白珠子停着的那个数是一个日子。", "他拨了拨最上面的一颗珠子，又拨了回去，珠子碰在一起的声音在空屋子里显得很响。", "那个日子是四天以后，四天以后是立冬，也是十二年前那批当归被扣下的同一天。", "他算了算自己这些年在铺子里的日子，刚好也是十二年，师父收他那年，正是出狱后的第二个春天。", "他一直以为师父收留他是因为缺一个抓药的伙计，如今才想到，一个瘸了腿的人要走远路办事，总得有个人替他守着铺子，替他把门开着。", "他想起这些年师父让他去送过的药，送到西门的烧酒铺，送到码头的账房，送到东市的绣坊，每一回都不收钱，每一回都要他亲手交到本人手上。", "他那时只当是老主顾的交情，从来没有多问，现在一家一家地想过去，才发觉那张单子和背面的名字一个也不差。", "原来他自己也是账上的一笔，是师父记下来的那些数目里，唯一一笔算不清该记在哪一边的。", "灯油快烧完了，火苗缩成豆子大小，他没有去添，就那样坐着，听外面的更夫敲过了三更。", "他想了很多种走法，每一种都走不远，因为不管走到哪一步，那四个字都摆在前面，算盘不要收。", "到了后半夜，他起身把炉子重新生起来，舀了水，抓了一副最寻常的安神汤，放在炉上慢慢地煎。", "药香渐渐地散开来，盖住了屋里那股说不清的陈味，也盖住了他自己身上的雨水和汗气。", "天快亮的时候，他把煎好的药倒进碗里，端到师父常坐的那张椅子前面，放下，又站了一会儿，才转身去卸门板。", "第一个来抓药的是卖炭的老孙，他咳了半个冬天，每回都只抓三服，每回都说下次再多抓些。", "陈砚像平常一样给他称了药，包好，在账本上记下一笔，字写得和昨天一样，一笔也没有抖。", "老孙走到门口又回过头来，问他师父什么时候回来，他说快了，再有四天，话出口才觉得自己答得太快了。", "老孙没有听出什么，只点点头，推着他那辆吱呀作响的独轮车，慢慢地拐进了巷子。"],
    ["雨还在下。", "陈砚在贺家后门的屋檐下站了快一个时辰，蓑衣早就湿透了，贴在背上又冷又沉。", "门缝里透出一点灯光，灯光时明时暗，大概是有人端着灯在院子里来回走动。", "他数着巡夜的梆子，数到第三遍的时候，门轻轻开了一条缝，又轻轻合上了。", "没有人出来，也没有人说话，只有一片叶子被风卷着贴到了他的鞋面上。", "雨还在下。", "他把叶子拿起来看了看，是艾叶，叶背用很细的针脚绣了一个字，绣的是他师父的姓。", "针脚很新，线是那种多捻了一股的线，他不用比也知道。", "他忽然觉得这一整件事就像一张绷在架子上的绣面，有人一针一针地绣了十二年，他直到今天才看见背面的线头。", "巷子那头有人提着灯笼走过来，步子不紧不慢，左脚一点也不拖。", "那人走到离他十来步的地方停住了，把灯笼举高了一些，灯光刚好照不到他的脸。", "雨还在下。", "那人开口时声音很平，说算盘上的日子还有四天，让他回去把铺子开好，别让人看出他已经读过那一页。", "陈砚没有答话，那人也不等他答，转身就走，灯笼的光一晃一晃地消失在巷子的拐角。", "他又站了一会儿，才发现手里的艾叶已经被自己捏碎了，满手都是苦味，那苦味怎么也搓不掉，一直跟着他走回了药铺。", "铺子里的灯还是他走时留的那一盏，灯芯已经结了花，他用剪子剪掉，屋里亮了一些。", "他脱下蓑衣挂在门后，水顺着草茎一滴一滴地落在地上，很快就在门槛边积了一小片。", "柜台上多了一样东西，是一只没有盖子的小木盒，盒子里铺着一层干净的草纸，纸上放着半截用过的棉线。", "他走的时候门是从外面锁上的，钥匙一直在他身上，窗子也都从里面插好了，他挨个看过去，一扇也没有动过。", "他把木盒端到灯下，棉线的颜色比他手里的两段都要旧一些，线头却剪得一模一样，也多捻了一股。", "草纸的背面有几个字，写字的人用的是最差的那种墨，字迹已经开始洇开，他得赶紧读，不然再过一会儿就看不清了。", "上面写着四个字，叫他明日照常，落款处什么也没有，只按了一个很小的指印，指印的纹路里还嵌着一点没洗干净的墨。", "他盯着那个指印看了很久，想起码头账房里那双总也洗不干净的手，又不愿意就这样认定。", "他把草纸凑到灯上烧了，纸灰落进那只木盒，他端起盒子走到后门，把灰倒进了水缸旁边的阴沟里。", "水缸的盖子不知什么时候被人扶正了，他掀开来看，水面上那两片柳叶已经不见了，水却还是满的。", "他在后门站了片刻，巷子里黑得什么也看不见，只有远处的河面上还漂着一两点不知道是谁家的灯火。", "他把门闩好，回到屋里，从柜子里取出账本，翻到今天的那一页，提起笔，想了想，又把笔放下了。", "这一天他没有记账，这是他进铺子以来的头一回，他想师父如果知道，大概也不会说什么。", "他吹了灯，和衣躺在柜台后面的窄床上，听着外面的雨声渐渐地稀了，一直到再也分不清那是雨声还是自己的呼吸。"],
];

const render = (paragraphs: readonly (readonly string[])[]): string => `${paragraphs.map((sentences) => sentences.join("")).join("\n\n")}\n`;
const ORIGINAL = render(PARAGRAPHS);

interface Task {
    readonly id: string;
    /** 目标段（从 0 数），判误改用；空表示全文。 */
    readonly targets: readonly number[];
    readonly prompt: string;
    readonly apply: (draft: string[][]) => void;
}

const COUNT_RULE = "段落之间有一个空行，一段就是一行；以句号、问号或叹号结尾算一句。除了要求的改动，其余文字一个字也不要动，也不要加减空行。";
const TASKS: readonly Task[] = [
    {id: "word", targets: [0], prompt: "把第 1 段里的“铜铃”改成“铁铃”（第 1 段只有一处）。", apply: (d) => {
        d[0]![5] = d[0]![5]!.replace("铜铃", "铁铃");
    }},
    {id: "sentence", targets: [1], prompt: "把第 2 段的第 4 句整句改成：她又说，前天夜里有条没挂灯的船靠过岸，上面下来的人一句话也没说。", apply: (d) => {
        d[1]![3] = "她又说，前天夜里有条没挂灯的船靠过岸，上面下来的人一句话也没说。";
    }},
    {id: "insert", targets: [2], prompt: "在第 3 段的第 2 句之后插入一句：她的绣架上绷着一幅没绣完的山水，山只有轮廓，水却已经绣满了。", apply: (d) => {
        d[2]!.splice(2, 0, "她的绣架上绷着一幅没绣完的山水，山只有轮廓，水却已经绣满了。");
    }},
    {id: "delete", targets: [3], prompt: "删掉第 4 段的第 3 句，前后的句子直接接上。", apply: (d) => {
        d[3]!.splice(2, 1);
    }},
    {id: "two-spots", targets: [4, 5], prompt: "做两处改动：第 5 段的第 2 句改成：潮水正在退，石阶上全是青苔，他每一步都走得很慢。第 6 段的第 2 句改成：隔壁卖豆腐的刘婶端了一碗豆浆过来，放下就走。", apply: (d) => {
        d[4]![1] = "潮水正在退，石阶上全是青苔，他每一步都走得很慢。";
        d[5]![1] = "隔壁卖豆腐的刘婶端了一碗豆浆过来，放下就走。";
    }},
    {id: "rename", targets: [], prompt: "把全文所有的“沈知秋”改成“沈知夏”，别的不改。", apply: (d) => {
        for (const paragraph of d) for (let i = 0; i < paragraph.length; i += 1) paragraph[i] = paragraph[i]!.replaceAll("沈知秋", "沈知夏");
    }},
    {id: "long-sentence", targets: [6], prompt: "第 7 段很长。把它的第 13 句整句改成：他不知道她知道多少，只知道从今晚起，这笔账已经不只是师父一个人的了。", apply: (d) => {
        d[6]![12] = "他不知道她知道多少，只知道从今晚起，这笔账已经不只是师父一个人的了。";
    }},
    {id: "repeated", targets: [7], prompt: "第 8 段里“雨还在下。”这句出现了三次，把第 2 次出现的那一处改成“雨小了一些。”，第 1、3 次不动。", apply: (d) => {
        d[7]![5] = "雨小了一些。";
    }},
];

const expected = (task: Task): string => {
    const draft = PARAGRAPHS.map((sentences) => [...sentences]);
    task.apply(draft);
    return render(draft);
};

interface ModelSpec {
    readonly name: string;
    readonly reference: string;
    readonly settings: Record<string, unknown>;
    readonly env: Record<string, string>;
}

function spec(name: string): ModelSpec {
    const env = process.env as Record<string, string>;
    const roles = (model: string) => ({items: ["tiny", "fast", "main", "deep"].map((id) => ({id, axis: "gradient", name: "", description: "", model: id === "main" ? model : null}))});
    if (name === "deepseek") {
        const reference = "deepseek/deepseek-flash";
        return {name, reference, env: {DEEPSEEK_API_KEY: env.DEEPSEEK_API_KEY!}, settings: {
            "nbook.models/providers": [{id: "deepseek", kind: "catalog", name: "deepseek", ...(env.DEEPSEEK_API_BASE ? {baseUrl: env.DEEPSEEK_API_BASE} : {}), apiKeyEnv: "DEEPSEEK_API_KEY", auth: "default", models: [{id: "deepseek-flash", enabled: true}]}],
            "nbook.models/roles": roles(reference),
        }};
    }
    if (name === "luna") {
        const reference = "luna/gpt-6-luna";
        return {name, reference, env: {JIJI_LUNA_API_KEY: env.JIJI_LUNA_API_KEY!}, settings: {
            "nbook.models/providers": [{id: "luna", kind: "custom", name: "luna", baseUrl: env.JIJI_LUNA_BASE_URL, api: "openai-responses", apiKeyEnv: "JIJI_LUNA_API_KEY", auth: "bearer", models: [{id: "gpt-6-luna", enabled: true, contextWindow: 200_000}]}],
            "nbook.models/roles": roles(reference),
        }};
    }
    throw new Error(`unknown model ${name}`);
}

const plugin: PluginDefinition = (() => {
    const profiles = MODES.map((mode) => ({mode, ...agentProfile(profileKey(mode), {name: mode, description: "实验", tools: {required: ["nbook.agent.read", TOOL[mode]], optional: []}})}));
    return {id: "test.exp", entries: [defineEntry({
        id: "server",
        location: "server",
        activationEvents: profiles.map((item) => item.activationEvent),
        contributions: profiles.map((item) => item.contribution),
        activate: () => ({contributions: {"agent.profiles": Object.fromEntries(MODES.map((mode) => [profileKey(mode), defineProfile({id: profileKey(mode), version: "1", name: mode, description: "实验", system: "你按要求修改文件。改完用一句话说明结果。", tools: {required: ["nbook.agent.read", TOOL[mode]]}})]))}}),
    })]};
})();

interface Outcome {
    readonly model: string;
    readonly mode: Mode;
    readonly task: string;
    readonly rep: number;
    readonly success: boolean;
    /** 目标段之外有改动的段数。 */
    readonly strayParagraphs: number;
    readonly reason: string;
    readonly error: string | null;
    readonly toolCalls: number;
    readonly editCalls: number;
    readonly failedEdits: number;
    readonly failedCodes: readonly string[];
    readonly noEditCall: boolean;
    readonly input: number;
    readonly output: number;
    readonly ms: number;
}

async function once(world: AgentWorld, model: string, mode: Mode, task: Task, rep: number, file: string, text: string, want: string, targets: readonly number[], prompt: string): Promise<Outcome> {
    const started = Date.now();
    const created = await world.service.create({profile: profileKey(mode)});
    if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created)}`);
    const session = created.value;
    const home = join(world.stateRoot, "agent", "sessions", session.id, "home");
    await mkdir(home, {recursive: true});
    await writeFile(join(home, file), text);
    const sent = await session.send({commandId: `exp-${model}-${mode}-${task.id}-${String(rep)}`, input: {text: `文件是 session://${file}。${COUNT_RULE}\n\n${prompt}`}});
    if (!sent.ok || sent.value.runId === null) throw new Error(`send failed: ${JSON.stringify(sent)}`);
    const runId = sent.value.runId;
    const deadline = Date.now() + 600_000;
    let result = await session.runResult({runId});
    while (result === null && Date.now() < deadline) {
        await Bun.sleep(100);
        world.settings.clock.advance(100);
        result = await session.runResult({runId});
    }
    if (result === null) await session.abort({commandId: `abort-${runId}`});
    const events = await session.path();
    const results = events.filter((event) => event.type === "toolResult").map((event) => event.data as unknown as {tool: string; status: string; code?: string});
    const edits = results.filter((item) => item.tool === TOOL[mode]);
    const failed = edits.filter((item) => item.status !== "ok");
    const final = await readFile(join(home, file), "utf8");
    const finalParagraphs = final.split("\n\n");
    const originalParagraphs = text.split("\n\n");
    const stray = originalParagraphs.filter((paragraph, index) => targets.length > 0 && !targets.includes(index) && finalParagraphs[index] !== paragraph).length;
    return {
        model,
        mode,
        task: task.id,
        rep,
        success: final === want,
        strayParagraphs: stray,
        reason: result?.reason ?? "timeout",
        error: result?.error === null || result?.error === undefined ? null : `${result.error.kind}:${result.error.code ?? ""}:${(result.error.message ?? "").slice(0, 160)}`,
        toolCalls: results.length,
        editCalls: edits.length,
        failedEdits: failed.length,
        failedCodes: failed.map((item) => item.code ?? item.status),
        noEditCall: edits.length === 0,
        input: result?.usage.input ?? 0,
        output: result?.usage.output ?? 0,
        ms: Date.now() - started,
    };
}

const [command, outPath, ...names] = process.argv.slice(2);
if ((command !== "preflight" && command !== "run") || outPath === undefined || names.length === 0) throw new Error("usage: <preflight|run> <out.json> <model…>");

const lengths = PARAGRAPHS.map((sentences) => sentences.join("").length);
console.log(`material chars per paragraph: ${lengths.join(" ")} total ${String(ORIGINAL.length)}`);
for (const task of TASKS) if (expected(task) === ORIGINAL) throw new Error(`task ${task.id} changes nothing`);

const root = join(tmpdir(), `t18-edit-modes-${String(process.pid)}`);
const outcomes: Outcome[] = [];
try {
    for (const name of names) {
        const model = spec(name);
        const world = await agentWorld(join(root, name), {plugins: [plugin], env: model.env, userSettings: {...model.settings, "nbook.agent/profileSettings": Object.fromEntries(MODES.map((mode) => [profileKey(mode), {approvalMode: "yolo"}]))}});
        try {
            if (command === "preflight") {
                for (const mode of MODES) {
                    const text = "第一行。\n\n第二行。\n";
                    const outcome = await once(world, name, mode, TASKS[0]!, 0, "小样.md", text, "第一行。\n\n第二行，改过了。\n", [], "把第 2 段改成：第二行，改过了。");
                    console.log(JSON.stringify(outcome));
                    outcomes.push(outcome);
                }
            } else {
                const jobs = TASKS.flatMap((task) => MODES.flatMap((mode) => [0, 1, 2].map((rep) => ({task, mode, rep}))));
                let next = 0;
                await Promise.all(Array.from({length: 4}, async () => {
                    while (next < jobs.length) {
                        const job = jobs[next]!;
                        next += 1;
                        const outcome = await once(world, name, job.mode, job.task, job.rep, "素材.md", ORIGINAL, expected(job.task), job.task.targets, job.task.prompt);
                        outcomes.push(outcome);
                        console.log(`${name} ${job.mode} ${job.task.id}#${String(job.rep)} ${outcome.success ? "ok" : `FAIL(${outcome.reason},edits=${String(outcome.editCalls)},failed=${String(outcome.failedEdits)})`} out=${String(outcome.output)} ${String(Math.round(outcome.ms / 1000))}s`);
                        await writeFile(outPath, JSON.stringify(outcomes, null, 1));
                    }
                }));
            }
        } finally {
            await world.close();
        }
    }
    await writeFile(outPath, JSON.stringify(outcomes, null, 1));
} finally {
    await rm(root, {recursive: true, force: true});
}
