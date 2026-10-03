# Settings

Settings live behind the **account avatar → Settings** at the far right of the top bar.

The settings page has two dimensions: **scope** decides who a setting affects, **section** decides what you are configuring.

## Four Scopes

| Scope | Stored in | Affects | Restart needed |
| --- | --- | --- | --- |
| **Boot Config** | `config.yaml` in the State Root | Startup parameters such as port and auth | **Yes** |
| **Global Config** | `<State Root>/workspace/.nbook/config.json` | All projects | No |
| **Project Config** | `<project>/.nbook/config.json` | Only the current project; overrides global | No |
| **Browser State** | Local to the browser | Only this browser on this machine | No |

The priority order is **project overrides global**. Preferences like font size usually belong in browser scope, models and API keys in global scope, and anything specific to one book in project scope.

::: warning Boot Config is read-only here
Settings only shows the boot state of the current process; it does not hot-write it. To change the port or auth, edit `config.yaml` and restart the service.
:::

## Sections at a Glance

| Section | What it configures |
| --- | --- |
| **Password Protection** | Login and auth status |
| **Frontend** | Theme, interface language (Chinese / English), default editor view mode |
| **Editor** | Prose font (including Chinese serif / sans / kai faces), size, line height, prose width, first-line indent, Monaco editor preferences |
| **Models** | Provider, base URL, API key, default model, model library |
| **Embedding** | Endpoint of the vector retrieval service |
| **Cost Display** | Token pricing and currency conversion |
| **Web Tools** | Configuration for `web_search` / `web_fetch` |
| **Agent Profile Models** | Assign a separate model per Agent |
| **Novel Data** | Endpoint of the rankings research service |
| **Observability** | Request trace recording switch and how many records to keep |
| **NeuroBook Account** | Account linking and cloud backup, see [Account and Cloud Backup](/en/guide/account) |

## Models and Cost

The **Models** section is mandatory — without it the Agent cannot work. A provider is whoever serves the model API; you get an API key from them and paste it in here. Entries that share an endpoint can reuse a key you already saved.

**Agent Profile Models** lets you spend compute by role: `writer`, which writes the prose, gets your strongest model, while `summarizer`, which grinds out titles and summaries in the background, gets a cheap one. Over months of use this is the most practical way to cut cost.

The **Cost Display** section handles pricing. Tokens are metered separately as **input / output / cache write / cache read** — the unit prices for those four usually differ a lot, and lumping them together distorts the total badly. Once prices are set, the interface converts usage straight into USD and CNY.

## Observability (Request Traces)

Turn it on and every model call is recorded end to end: the normalized context, the raw request body, HTTP status, token usage, time to first token and total duration. The **Trace** button in the top bar opens the viewer, where you can filter by session, group by invocation, read the details across six tabs, and jump between a trace and its session in either direction.

When you are tuning a prompt or working out "why did the AI answer like that", this is the only place that shows you the truth.

::: danger Traces contain your full prose
A trace holds the complete prompt and the novel text inside it. The default is the most recent 100 per session, stored under `<State Root>/workspace/.nbook/agent/traces/`. **Clear them before you share the machine or the directory.** They never enter the shareable log bundle, but they do stay on disk. See [Privacy Boundaries](/en/operations#privacy-boundaries).
:::

## Interface Language

The Frontend section switches between **简体中文** and **English**. This only changes the interface text; it does not change which language the Agent speaks to you in — that comes from the model and the prompt.

## Keep Reading

- [Themes and Colors](/en/guide/theme)
- [Account and Cloud Backup](/en/guide/account)
- [Running, Data and Privacy](/en/operations)
