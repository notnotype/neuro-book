# nb-history

`@notnotype/nb-history` provides an append-only operation log and content-addressed snapshots for file workspaces shared by people and Agents: file timelines, deleted-file recovery, a user review inbox and unseen changes per session.

## Quick Start

```ts
import {WorkspaceHistory} from "@notnotype/nb-history";

const history = await WorkspaceHistory.open({
  databasePath: "/path/to/.nbook/history.sqlite",
  resolvePath: (path) => `/path/to/workspace/${path}`,
});
await history.performWrite({kind: "agent", sessionId: "s1"}, "manuscript/ch1.md", "content");
const inbox = await history.inbox("u1");
await history.close();
```

The module owns its SQLite history database, while the host supplies path policy, watching, UI, notifications and retention policy. The database contains full-text snapshots and must not enter shared logs or diagnostics. See the [project README](https://github.com/notnotype/neuro-book/blob/master/packages/nb-history/README.md) for the API and limitations.
