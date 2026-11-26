/**
 * 标签条的插入判定（docs/specs/ui/workbench-layout.md 输出 25）：指针在 `TabStrip` 里算插到哪。读 DOM，只认 `TabStrip` 写的 `data-tab-row`、`data-panel-tab`、`data-tab-partition`。
 *
 * 返回邻居的标签键，不返回下标：收进“更多”的标签不在 DOM 里，下标、分区要不要换、是不是原位，都要宿主按它的文档换算。
 *
 * 判定点缺省是指针。宿主在条里排序、被拖的标签自己沿条跟手时（输出 38“标签条上”），传 `held`：判定点换成那个标签的前缘，
 * 和摘掉来源、补上空位之后的邻居中线比，看到的就是“盖过邻居一半它就让开”，和抓在标签的哪一点无关。
 */

import {resolveListInsertion} from "@notnotype/nb-layout";
import type {GridDropPoint, GridDropRect} from "@notnotype/nb-layout";

const rectOf = (element: Element): GridDropRect => {
    const box = element.getBoundingClientRect();
    return {left: box.left, top: box.top, right: box.right, bottom: box.bottom};
};

interface Member {
    readonly id: string;
    /** 整个标签（含关闭按钮）的矩形。 */
    readonly rect: GridDropRect;
    readonly partition: string | null;
}

/** 看得见的一行：多行时一个分区会折成几条。 */
interface Line {
    readonly partition: string | null;
    readonly rect: GridDropRect;
    readonly members: ReadonlyArray<Member>;
    /** 这一行原来的最后一个是被摘掉的来源：行尾的空白是它的位置，单行时它前面可能是别的分区。 */
    readonly endedWithExcluded: boolean;
}

/** 一份量好的标签条：判定不再读 DOM。实时布局拿起时量一份，预览里标签在滑、来源也挪了，这时读 DOM 算不准。 */
export interface TabStripSnapshot {
    readonly view: GridDropRect;
    readonly lines: ReadonlyArray<Line>;
    /** 这个标签条按呈现顺序的全部标签（含滚出视口的、折到别的行的）。 */
    readonly members: ReadonlyArray<Member>;
    /** 被摘掉的来源原来在哪个分区；不在这条上是 undefined。 */
    readonly excludedPartition: string | null | undefined;
    /** 被摘掉的来源量到的矩形（含关闭按钮）；不在这条上是 undefined。宿主拿它的宽度和按下的点算 `TabStripHeld`。 */
    readonly excludedRect: GridDropRect | undefined;
}

/** 在条里跟手的那个标签：它的前缘是 `point.x - grab * width`，夹在指针所在那一行的两端之间（和它画出来的位置同一个算法）。 */
export interface TabStripHeld {
    /** 标签的宽度（含关闭按钮），CSS px。 */
    readonly width: number;
    /** 抓住的点占宽度的比例，0 到 1。 */
    readonly grab: number;
}

/**
 * 把量好的标签条挪到它所在面板的新位置：标签不重排，整条跟着面板的左上角走，右端跟着面板的右边伸缩（行尾的插入位在那里）。
 * 实时布局来源收起之后，判定按收起后的布局（docs/specs/ui/workbench-layout.md 输出 38），面板挪了位置，标签条也要跟着。
 */
export function translateTabStrip(snapshot: TabStripSnapshot, by: {readonly x: number; readonly y: number}, widen: number): TabStripSnapshot {
    const move = (rect: GridDropRect, extra = 0): GridDropRect => ({left: rect.left + by.x, right: rect.right + by.x + extra, top: rect.top + by.y, bottom: rect.bottom + by.y});
    const member = (item: Member): Member => ({...item, rect: move(item.rect)});
    return {
        ...snapshot,
        view: move(snapshot.view, widen),
        lines: snapshot.lines.map((line) => ({...line, rect: move(line.rect, widen), members: line.members.map(member)})),
        members: snapshot.members.map(member),
        excludedRect: snapshot.excludedRect === undefined ? undefined : move(snapshot.excludedRect),
    };
}

const memberOf = (tab: HTMLElement): Member => ({id: tab.dataset.panelTab as string, rect: rectOf(tab.parentElement as HTMLElement), partition: tab.dataset.tabPartition ?? null});

/**
 * 摘掉来源后补上它的空位：同一行（同一个 `data-tab-row`、同一条折行）里排在它后面的标签往前挪一格，一格是来源左缘到它后一个标签左缘的距离（含间距）。
 * 别的行不动：真摘掉时折行会重排，这里不模拟。来源是这一行最后一个时没有要挪的。
 */
function closeGap(row: ReadonlyArray<Member>, exclude: string | null): ReadonlyArray<Member> {
    const at = exclude === null ? -1 : row.findIndex((member) => member.id === exclude);
    const next = row[at + 1];
    if (at < 0 || next === undefined) return row;
    const step = next.rect.left - (row[at] as Member).rect.left;
    return row.map((member, index) => (index > at ? {...member, rect: {...member.rect, left: member.rect.left - step, right: member.rect.right - step}} : member));
}

/** 一个 `data-tab-row` 里的标签按折行分组，从上到下。 */
function wrappedLines(frames: ReadonlyArray<Member>): ReadonlyArray<ReadonlyArray<Member>> {
    const byTop = new Map<number, Member[]>();
    for (const frame of frames) {
        const key = Math.round(frame.rect.top);
        byTop.set(key, [...(byTop.get(key) ?? []), frame]);
    }
    return [...byTop].sort(([a], [b]) => a - b).map(([, line]) => line);
}

interface Row {
    readonly row: HTMLElement;
    /** 这一个 `data-tab-row` 里按折行分好、来源的空位已补上的标签（来源本身还在，调用方按需摘掉）。 */
    readonly lines: ReadonlyArray<ReadonlyArray<Member>>;
}

/**
 * 整条标签条只读一遍 DOM：每个标签的矩形量一次，`all` 是它们按 DOM 顺序的原始成员（含不在任何 `data-tab-row` 下的），每行再从同一批成员里分组、补位。
 * 不能从补位后的 `rows` 拼回 `all`：补位改了矩形，折行分组还改了顺序（标签高矮不一时同一行里 `top` 各不相同）。
 */
function measureRows(strip: Element, exclude: string | null): {readonly all: ReadonlyArray<Member>; readonly rows: ReadonlyArray<Row>} {
    const tabs = [...strip.querySelectorAll<HTMLElement>("[data-panel-tab]")];
    const all = tabs.map(memberOf);
    const memberAt = new Map(tabs.map((tab, at) => [tab, all[at] as Member] as const));
    const rows = [...strip.querySelectorAll<HTMLElement>("[data-tab-row]")].map((row) => ({
        row,
        lines: wrappedLines([...row.querySelectorAll<HTMLElement>("[data-panel-tab]")].map((tab) => memberAt.get(tab) as Member)).map((line) => closeGap(line, exclude)),
    }));
    return {all, rows};
}

function linesOf(stripRect: GridDropRect, rows: ReadonlyArray<Row>, exclude: string | null): Line[] {
    const lines: Line[] = [];
    for (const {row, lines: wrapped} of rows) {
        const frames = wrapped.flat();
        const rowPartition = row.dataset.tabRowPartition ?? null;
        const rowRect = rectOf(row);
        for (const line of wrapped) {
            const members = line.filter((member) => member.id !== exclude);
            if (members.length === 0) continue;
            const top = Math.min(...members.map((member) => member.rect.top));
            const bottom = Math.max(...members.map((member) => member.rect.bottom));
            lines.push({partition: rowPartition, rect: {left: Math.max(stripRect.left, rowRect.left), right: Math.min(stripRect.right, rowRect.right), top, bottom}, members, endedWithExcluded: line.at(-1)?.id === exclude});
        }
        // 空的行（多行时没有普通标签，或只有来源）：整行是一个插入位。
        if (frames.every((frame) => frame.id === exclude)) lines.push({partition: rowPartition, rect: rowRect, members: [], endedWithExcluded: frames.length > 0});
    }
    return lines;
}

export interface TabStripInsertion {
    /** 插到这个标签前面；分区末尾时是 null。 */
    readonly before: string | null;
    /** 插入位前面那个标签（分区里）；`before` 为 null 时插到它后面，它也没有时分区是空的。 */
    readonly after: string | null;
    /** 落到哪个分区；没有分区的标签条是 null。 */
    readonly partition: string | null;
    readonly indicator: GridDropRect;
}

/**
 * 量一份标签条。`exclude`：摘掉这个标签（被拖的来源），它那一行后面的标签补上它的空位，算出的插入位就是“摘掉来源之后”的；
 * 和预览里来源收起、邻居合拢的样子一致，在条里跟手排序时（`held`）原位也落在原处。
 */
export function measureTabStrip(strip: Element, exclude: string | null = null): TabStripSnapshot {
    const {all, rows} = measureRows(strip, exclude);
    const excluded = all.find((member) => member.id === exclude);
    const closed = new Map(rows.flatMap(({lines}) => lines.flat()).map((member) => [member.id, member.rect] as const));
    const members = all.filter((member) => member.id !== exclude).map((member) => ({...member, rect: closed.get(member.id) ?? member.rect}));
    const view = rectOf(strip);
    return {view, lines: linesOf(view, rows, exclude), members, excludedPartition: excluded?.partition, excludedRect: excluded?.rect};
}

/** 跟手的标签此刻的前缘：抓住的点在指针下，夹在这一行的两端之间；坏数字退回指针。 */
function heldEdge(x: number, held: TabStripHeld, line: GridDropRect): number {
    const {width, grab} = held;
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(grab)) return x;
    const edge = x - Math.min(1, Math.max(0, grab)) * width;
    return Math.min(Math.max(edge, line.left), Math.max(line.left, line.right - width));
}

/** 指针在标签条里的插入位：先按纵向距离选行（在行里的距离为 0），再在行里求。 */
export function resolveTabStripInsertion(strip: Element, point: GridDropPoint): TabStripInsertion | null {
    return tabStripInsertionIn(measureTabStrip(strip), point);
}

/**
 * 同上，用量好的那份。行按指针选；`held` 给了时，行里的判定点是跟手的那个标签的前缘（见模块头）。
 * 前缘过了左边邻居的中线就插到它前面；往右时邻居在预览里让出了一格，前缘过了它量到的中线，就是标签的右缘过了它画出来的中线。
 */
export function tabStripInsertionIn(snapshot: TabStripSnapshot, point: GridDropPoint, held: TabStripHeld | null = null): TabStripInsertion | null {
    const {lines} = snapshot;
    if (lines.length === 0) return null;
    const distance = (line: Line): number => (point.y < line.rect.top ? line.rect.top - point.y : point.y > line.rect.bottom ? point.y - line.rect.bottom : 0);
    const line = lines.reduce((best, candidate) => (distance(candidate) < distance(best) ? candidate : best));
    const x = held === null ? point.x : heldEdge(point.x, held, line.rect);
    const containerRect = {...line.rect, left: Math.min(line.rect.left, x), right: Math.max(line.rect.right, x)};
    // 滚过行尾的标签不交给共享算法：它会把行尾的插入位换成“插到第一个滚出去的前面”，那只看这一行的顺序；
    // 这里的后继要在分区里按完整顺序找（见下面行尾的换算），固定区的最后一个之后是固定区的末尾，不是普通区的第一个。
    // 这些标签与内容盒没有交集，算法本来就不拿它们定插入位，去掉它们不改别的结果。
    const reachable = line.members.filter((member) => member.rect.left < containerRect.right);
    // 整行都在行尾之外（宿主在行首留了白，标签还没滚进来）：有成员却一个都看不见，共享算法判不出插入位；去掉之后交给它的
    // 是空数组，会被当成空行、在行首画一条线。原行本来就空时才是空行的插入位。
    if (reachable.length === 0 && line.members.length > 0) return null;
    const insertion = resolveListInsertion({orientation: "horizontal", point: {x, y: (line.rect.top + line.rect.bottom) / 2}, containerRect, members: reachable.map(({id, rect}) => ({id, rect}))});
    if (insertion === null) return null;
    const all = snapshot.members;
    const samePartition = (partition: string | null): ReadonlyArray<Member> => all.filter((member) => member.partition === partition);
    if (insertion.beforeId !== null) {
        // 单行时几个分区同在一行：插在固定标签前面才算进固定区，所以分区看后面那个标签。
        const before = all.find((member) => member.id === insertion.beforeId);
        const partition = before?.partition ?? line.partition;
        const inPartition = samePartition(partition);
        const at = inPartition.findIndex((member) => member.id === insertion.beforeId);
        return {before: insertion.beforeId, after: inPartition[at - 1]?.id ?? null, partition, indicator: insertion.indicator};
    }
    // 行尾的插入位：共享算法只认这一行看得见的成员，`null` 只是“最后一个看得见的之后”。换算成完整顺序里它的后继（滚出视口的、折到下一行的都算），
    // 后继看得见时线画在它前面（换行处归一到下一行行首）；没有后继才是分区末尾。
    const visible = line.members.filter((member) => member.rect.right > containerRect.left && member.rect.left < containerRect.right);
    const last = visible.at(-1);
    const partition = line.endedWithExcluded && snapshot.excludedPartition !== undefined ? snapshot.excludedPartition : (last?.partition ?? line.partition);
    const inPartition = samePartition(partition);
    const successor = last === undefined ? undefined : inPartition[inPartition.findIndex((member) => member.id === last.id) + 1];
    if (successor === undefined) return {before: null, after: last?.id ?? null, partition, indicator: insertion.indicator};
    const {view} = snapshot;
    const seen = successor.rect.left >= view.left && successor.rect.right <= view.right && successor.rect.top >= view.top && successor.rect.bottom <= view.bottom;
    return {before: successor.id, after: last?.id ?? null, partition, indicator: seen ? {left: successor.rect.left - 1, right: successor.rect.left + 1, top: successor.rect.top, bottom: successor.rect.bottom} : insertion.indicator};
}

/** 停靠点：每一行每个标签的左缘，和每行最后一个的右缘；只留落在标签条看得见的范围里的。 */
function stopsIn(snapshot: TabStripSnapshot, strip: Element): ReadonlyArray<GridDropPoint> {
    const view = rectOf(strip.querySelector("[role='tablist']") ?? strip);
    const stops: GridDropPoint[] = [];
    for (const line of snapshot.lines) {
        const y = (line.rect.top + line.rect.bottom) / 2;
        if (y < view.top || y > view.bottom) continue;
        const seen = (x: number): boolean => x >= line.rect.left && x <= line.rect.right;
        for (const member of line.members) if (seen(member.rect.left + 1)) stops.push({x: member.rect.left + 1, y});
        const last = line.members.at(-1);
        if (last !== undefined && seen(last.rect.right - 1)) stops.push({x: last.rect.right - 1, y});
        if (line.members.length === 0) stops.push({x: line.rect.left + 1, y});
    }
    return stops;
}

/**
 * 键盘能停的位置：每个标签的左缘，和每行最后一个的右缘。放回 `resolveTabStripInsertion` 就是对应的插入位（要插入位用 `tabStripStopInsertions`，只量一次）。只留落在标签条看得见的范围里的点（横向滚走的、纵向收起来的行都不算）：
 * 指针也到不了那里，停靠点落在标签条外面就看不见了。比行还宽的标签只看它的边，不会让一整行都没有位置。
 */
export function tabStripStops(strip: Element): ReadonlyArray<GridDropPoint> {
    return stopsIn(measureTabStrip(strip), strip);
}

/**
 * 全部停靠点和各自的插入位：只量一份快照，每个点在这份上判定，结果与对每个点调 `resolveTabStripInsertion`（它每次重量）相同。
 * 判不出插入位的点（`tabStripInsertionIn` 给 null）不收，键盘用不上。
 */
export function tabStripStopInsertions(strip: Element): ReadonlyArray<{readonly point: GridDropPoint; readonly insertion: TabStripInsertion}> {
    const snapshot = measureTabStrip(strip);
    return stopsIn(snapshot, strip).flatMap((point) => {
        const insertion = tabStripInsertionIn(snapshot, point);
        return insertion === null ? [] : [{point, insertion}];
    });
}
