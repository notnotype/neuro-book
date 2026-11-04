/**
 * w00039 t32 时间原型：时间约束网络（Simple Temporal Network，Dechter、Meiri、Pearl 1991）。一次性原型。
 *
 * 每条约束是“lo ≤ t(b) − t(a) ≤ hi”，拆成两条边：a→b 权 hi，b→a 权 −lo。
 * - 一个点最早、最晚可能在什么时候：从历元（0 号点）出发的最短路与到历元的最短路。
 * - 两点相差多少：从 a 出发的最短路给 t(b) − t(a) 的上界，从 b 出发的给下界。
 * - 说法互相矛盾 = 图里有负环；把环上的约束列出来，就是“哪几条说法打架”。
 * 用队列版的 Bellman-Ford（SPFA），边是稀疏的（每件事几条说法）。
 */

export type Constraint = {readonly a: number; readonly b: number; readonly lo: number; readonly hi: number; readonly label: string};

type Edge = {readonly to: number; readonly w: number; readonly label: string};

export class TimeNetwork {
    private readonly names: string[] = ["历元"];
    private readonly out: Edge[][] = [[]];
    private readonly back: Edge[][] = [[]];

    node(name: string): number {
        this.names.push(name);
        this.out.push([]);
        this.back.push([]);
        return this.names.length - 1;
    }

    name(index: number): string {
        return this.names[index]!;
    }

    get size(): number {
        return this.names.length;
    }

    add(constraint: Constraint): void {
        const {a, b, lo, hi, label} = constraint;
        if (Number.isFinite(hi)) {
            this.out[a]!.push({to: b, w: hi, label});
            this.back[b]!.push({to: a, w: hi, label});
        }
        if (Number.isFinite(lo)) {
            this.out[b]!.push({to: a, w: -lo, label});
            this.back[a]!.push({to: b, w: -lo, label});
        }
    }

    /**
     * 从 source 出发（reverse 时是“到 source”）的最短路，带每个点的前驱（用来解释范围是哪几条说法定的）；
     * 有负环时返回环上的约束。source 为 null 时所有点从 0 出发，等于接一个连向所有点、权为 0 的虚拟源点（只用来查负环）。
     */
    private shortest(source: number | null, reverse: boolean): {dist: Float64Array; via: ReadonlyArray<{from: number; label: string} | undefined>} | {cycle: string[]} {
        const edges = reverse ? this.back : this.out;
        const n = this.names.length;
        const dist = new Float64Array(n).fill(source === null ? 0 : Number.POSITIVE_INFINITY);
        const count = new Int32Array(n);
        const via: Array<{from: number; label: string} | undefined> = new Array(n);
        const queued = new Uint8Array(n);
        const queue: number[] = source === null ? Array.from({length: n}, (_, index) => index) : [source];
        if (source !== null) dist[source] = 0;
        for (const index of queue) queued[index] = 1;
        for (let head = 0; head < queue.length; head += 1) {
            const u = queue[head]!;
            queued[u] = 0;
            for (const edge of edges[u]!) {
                const next = dist[u]! + edge.w;
                if (next >= dist[edge.to]!) continue;
                dist[edge.to] = next;
                via[edge.to] = {from: u, label: edge.label};
                count[edge.to]! += 1;
                if (count[edge.to]! >= n) return {cycle: this.cycleFrom(edge.to, via)};
                if (queued[edge.to] === 0) {
                    queued[edge.to] = 1;
                    queue.push(edge.to);
                }
            }
        }
        return {dist, via};
    }

    private cycleFrom(start: number, via: ReadonlyArray<{from: number; label: string} | undefined>): string[] {
        // 沿前驱走 n 步一定进到环里，再绕一圈收集约束。
        let node = start;
        for (let step = 0; step < this.names.length; step += 1) node = via[node]!.from;
        const labels: string[] = [];
        let current = node;
        do {
            labels.push(via[current]!.label);
            current = via[current]!.from;
        } while (current !== node && labels.length <= this.names.length);
        return [...new Set(labels)].reverse();
    }

    /** 一致性检查：没有矛盾时返回 null，有矛盾时返回打架的那几条说法。 */
    contradictions(): string[] | null {
        const result = this.shortest(null, false);
        return "cycle" in result ? result.cycle : null;
    }

    private solved: {forward: ReadonlyArray<{from: number; label: string} | undefined>; backward: ReadonlyArray<{from: number; label: string} | undefined>} | null = null;

    /** 每个点相对历元最早、最晚可能的时间。 */
    windows(): Array<[number, number]> {
        const forward = this.shortest(0, false);
        const backward = this.shortest(0, true);
        if ("cycle" in forward || "cycle" in backward) throw new Error("说法互相矛盾，先看 contradictions()");
        this.solved = {forward: forward.via, backward: backward.via};
        return Array.from({length: this.names.length}, (_, index) => [-backward.dist[index]!, forward.dist[index]!] as [number, number]);
    }

    /** 一个点的最早时间（lo）与最晚时间（hi）各是哪几条说法定的：沿最短路的前驱走回历元。 */
    explain(index: number): {lo: string[]; hi: string[]} {
        if (this.solved === null) this.windows();
        const walk = (via: ReadonlyArray<{from: number; label: string} | undefined>) => {
            const labels: string[] = [];
            for (let node = index, guard = 0; via[node] !== undefined && guard < this.names.length; node = via[node]!.from, guard += 1) labels.push(via[node]!.label);
            return [...new Set(labels)];
        };
        return {lo: walk(this.solved!.backward), hi: walk(this.solved!.forward)};
    }

    /** t(b) − t(a) 可能的范围。 */
    elapsed(a: number, b: number): [number, number] {
        const fromA = this.shortest(a, false);
        const fromB = this.shortest(b, false);
        if ("cycle" in fromA || "cycle" in fromB) throw new Error("说法互相矛盾");
        return [-fromB.dist[a]!, fromA.dist[b]!];
    }
}
