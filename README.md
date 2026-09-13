# KanbanFlow MCP Server (multi-board)

A Model Context Protocol (MCP) server for [KanbanFlow](https://kanbanflow.com) that lets Claude read and manage tasks, boards, subtasks, labels, dates, comments, time tracking, and more — across **multiple KanbanFlow boards** in a single server, since KanbanFlow issues one API token per board.

There are other MCPs out there, but this one takes a `board_name` parameter and resolves the right API token from a small config file instead of a single token baked into the environment, plus full coverage of KanbanFlow's REST API rather than a subset.

## Highlights

- **Multi-board.** A `boards.json` config file lists `{ name, token, boardId }` per board. Every tool takes `board_name` to say which board it should act on.
- **Bearer auth**, matching KanbanFlow's current API docs.
- **Full tool coverage** — 32 tools total (see below): board management (`list_boards`, `add_board`, `remove_board`, `sync_board_ids`), full task/subtask/label/comment CRUD, moving tasks between boards, dates, collaborators, attachments, relations, custom fields, users, board events, and time entries (manual, Pomodoro/Stopwatch, per-task and per-board).
- **`groupingDate`** support on `create_task`, `update_task`, and `move_task_to_board` — lets you set which day a task is grouped under on a column configured to display tasks grouped by date (see below).
- Verified end-to-end against the live KanbanFlow API before packaging (board fetch, task CRUD, subtasks, labels, comments, manual time entries, users, and custom fields all tested against real boards).

## Installation

### Option A: Claude Desktop Extension (`.mcpb`)

Install the packaged `.mcpb` bundle through Claude Desktop's extension settings. It bundles the compiled server and its dependencies, so no separate `npm install` is needed. On first run it reads `~/.kanbanflow/boards.json` automatically (see Configuration below) — the optional "Boards config file path" setting in the extension's config only needs to be filled in if you keep that file somewhere else.

### Option B: From source

```bash
git clone <this-repo-url>
cd kanbanflow-mcp-server
npm install
npm run build
```

Then point an MCP client at it directly:

```json
{
  "mcpServers": {
    "kanban-flow": {
      "command": "node",
      "args": ["/path/to/kanbanflow-mcp-server/build/index.js"]
    }
  }
}
```

No API token goes in the MCP config itself — see Configuration below.

## Configuration: `boards.json`

Because KanbanFlow issues a separate API token per board, this server keeps a small JSON file listing every board you want it to manage:

```json
{
  "boards": [
    { "name": "Marketing", "token": "xxxxxxxxxxxxxxxxxxxx", "boardId": "abc123" },
    { "name": "Engineering", "token": "yyyyyyyyyyyyyyyyyyyy", "boardId": "def456" },
    { "name": "Client Projects", "token": "zzzzzzzzzzzzzzzzzzzz", "boardId": "ghi789" }
  ]
}
```

- **Default location:** `~/.kanbanflow/boards.json`
- **Override:** set the `KANBANFLOW_BOARDS_CONFIG` environment variable to point at a different file.
- **`name`** is whatever short label you want to use to refer to the board in conversation and tool calls (it doesn't need to match KanbanFlow's own board name).
- **`token`** is that board's API token, from KanbanFlow's Settings → API & Webhooks page for that board.
- **`boardId`** is captured automatically when you use `add_board` (see below); you don't need to look it up yourself.

You don't have to hand-edit this file — use the tools:

- **`list_boards`** — see what's configured (tokens are never shown back).
- **`add_board`** — give it a name and a token; it calls KanbanFlow to confirm the token works and records the board's ID for you.
- **`remove_board`** — drop a board from the config.
- **`sync_board_ids`** — re-fetch a board (or all of them) and update the stored board ID if KanbanFlow's changed it.

If the config file doesn't exist yet, the server just reports zero boards configured rather than erroring — run `add_board` to create it.

## What "groupingDate" means

Some KanbanFlow columns can be configured to display their cards grouped by day ("date grouped" columns) instead of as a flat list. `groupingDate` is the field that controls which day's group a task lands in on such a column:

- Format: `YYYY-MM-DD` (e.g. `2026-09-15`)
- `null` or `""` puts the task in the "unknown date" bucket
- It's rejected by KanbanFlow's API (403 error) if you try to set it on a column that **isn't** configured as date grouped — that's a real API restriction, not a bug in this server.

It's available as an optional parameter on `create_task`, `update_task`, and `move_task_to_board`.

## Tools

32 tools in total. `board_name` is required on every tool except `list_boards`, `add_board`, and (optionally) `sync_board_ids`.

### Board & config management
| Tool | Description |
|---|---|
| `list_boards` | List configured board names and their KanbanFlow board IDs. |
| `add_board` | Add a board to the config by name + API token; verifies the token and captures the board ID. |
| `remove_board` | Remove a board from the config. |
| `sync_board_ids` | Re-fetch one or all configured boards and update stored board IDs if changed. |
| `get_board` | Get a board's full structure: columns, swimlanes, colors. |
| `get_board_custom_fields` | List the custom field definitions defined on a board. |
| `get_board_events` | Get the board's audit log (events) within an optional time window. |
| `get_users` | List users with access to a board. |

### Tasks
| Tool | Description |
|---|---|
| `create_task` | Create a task (name, column, swimlane, description, color, position, time/points estimate, groupingDate). |
| `get_task` | Get full details for a task by ID. |
| `get_tasks_by_column` | List tasks in a specific column (optionally filtered to a swimlane). |
| `get_all_tasks` | List every task on a board, grouped by column. |
| `update_task` | Update any of a task's fields, including moving it to another column. |
| `delete_task` | Permanently delete a task. |
| `move_task_to_board` | Move a task from one configured board to another (optionally to a specific column/swimlane/groupingDate). |

### Subtasks
| Tool | Description |
|---|---|
| `create_subtask` | Add a subtask to a task. |
| `get_subtasks` | List a task's subtasks. |

### Labels
| Tool | Description |
|---|---|
| `create_label` | Add a label to a task. |
| `get_labels` | List a task's labels. |

### Dates
| Tool | Description |
|---|---|
| `set_date` | Set/update a task's due date and target column. |
| `get_dates` | Get a task's date information. |

### Collaborators & comments
| Tool | Description |
|---|---|
| `get_collaborators` | List a task's collaborators. |
| `add_comment` | Add a comment to a task. |
| `get_comments` | List a task's comments. |

### Attachments & relations
| Tool | Description |
|---|---|
| `get_attachments` | List a task's attachments (read-only — KanbanFlow's API doesn't expose attachment upload). |
| `get_relations` | List a task's relations (`relatesTo` / `dependsOn` / `requiredBy`). |

### Custom fields
| Tool | Description |
|---|---|
| `get_task_custom_fields` | Get custom field values set on a task. |

### Time tracking
| Tool | Description |
|---|---|
| `add_manual_time_entry` | Log a manual time entry (start/end timestamp) on a task. |
| `get_manual_time_entries_for_task` | List manual time entries logged on a task. |
| `get_time_entries_for_task` | List all time entries (manual + Pomodoro + Stopwatch) for a task in a time window. |
| `get_time_entries_for_board` | List all time entries for a board in a time window (optionally filtered by user). |

### Bulk import
| Tool | Description |
|---|---|
| `import_csv` | Bulk-create tasks on a board from CSV text (required column: `name`; optional: `description`, `color`, `swimlaneId`, `position`). This is a convenience feature of this server, not a native KanbanFlow endpoint. |

Note: `list_boards`/`add_board`/`remove_board`/`sync_board_ids` and `import_csv` are additions specific to this server, not part of KanbanFlow's own REST API — everything else maps directly to a documented KanbanFlow endpoint.

## Usage examples

- *"List my configured boards"*
- *"Show me the board structure for Client Projects"*
- *"Create a task called 'Fix auth bug' in the To-Do column on Engineering"*
- *"What's in the Backlog column on Marketing?"*
- *"Move task T123 from Engineering to Client Projects"*
- *"Add a comment to task T456 saying the client approved the scope"*
- *"Log 2 hours of manual time on task T789 from 9am to 11am today"*

## Development

```bash
npm install       # installs devDependencies too (needed to build)
npm run build     # compiles TypeScript to build/
npm start          # runs the compiled server (build/index.js)
```

To test locally without an MCP client, point `KANBANFLOW_BOARDS_CONFIG` at a test `boards.json` and run the server; it communicates over stdio per the MCP spec.

### Packaging as a Claude Desktop Extension

This repo includes a `manifest.json` for the [MCPB](https://github.com/anthropics/mcpb) format:

```bash
npm install -g @anthropic-ai/mcpb
npm install && npm run build
npm install --omit=dev   # trim devDependencies before packaging
mcpb pack . kanbanflow-mcp-server.mcpb
```

## License

MIT — see [LICENSE](LICENSE).
