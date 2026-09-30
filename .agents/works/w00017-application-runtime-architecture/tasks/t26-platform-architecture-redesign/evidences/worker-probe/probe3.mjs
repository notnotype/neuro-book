import {Worker} from "node:worker_threads";
for (const f of ["throws.mjs", "exits.mjs"]) {
  const w = new Worker(new URL(`./${f}`, import.meta.url));
  let err = null;
  w.on("error", (e) => { err = e.message; });
  const code = await new Promise((r) => w.once("exit", r));
  console.log(`${f}: exit=${code} error=${err}，主进程继续运行`);
}
