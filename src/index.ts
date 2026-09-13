#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs/promises";
import { BoardRegistry } from "./kanbanflow/board-registry.js";
import * as kanban from "./kanbanflow/kanban-service.js";
import { Board, Column, Swimlane, KanbanTask, TaskColor } from "./kanbanflow/types.js";
import { BOARDS_CONFIG_PATH } from "./kanbanflow/config.js";

const registry = new BoardRegistry();

const server = new McpServer({
    name: "kanban-flow",
    version: "2.1.0",
});

// ---------- helpers ----------

/**
 * Wraps a tool's parameter shape in a strict Zod object so unrecognized parameters are
 * rejected with a clear error instead of being silently dropped by the MCP SDK's default
 * (non-strict) object parsing.
 */
function strict<T extends z.ZodRawShape>(shape: T) {
    return z.object(shape).strict();
}

const boardNameParam = z.string().describe("Name of the configured board to operate on (see list_boards)");
const colorEnum = z.enum(['yellow', 'white', 'red', 'green', 'blue', 'purple', 'orange', 'cyan', 'brown', 'magenta']);
const groupingDateParam = z.string().nullable().optional().describe("Only used if the target column is date grouped. Format YYYY-MM-DD, e.g. 2023-12-31. Use null or empty string to group as unknown date.");
const numberParam = z.object({
    prefix: z.string().optional(),
    value: z.number(),
}).nullable().optional().describe("The task number: an integer value with an optional prefix, e.g. { value: 5 } or { prefix: 'BUG-', value: 5 }. Pass null to clear it.");
const subTasksParam = z.array(z.object({
    name: z.string(),
    finished: z.boolean().optional(),
})).optional().describe("Inline subtasks to set, e.g. [{ name: 'Write', finished: true }, { name: 'Proofread' }]. Overwrites any existing subtasks - use create_subtask to add one without replacing the rest.");
const collaboratorsParam = z.array(z.object({
    userId: z.string(),
})).optional().describe("Collaborators to set, as a list of { userId }. Overwrites the existing collaborator list.");
const timelineParam = z.object({
    start: z.string().describe("YYYY-MM-DD"),
    end: z.string().describe("YYYY-MM-DD"),
}).nullable().optional().describe("The task's timeline: a start and end date, e.g. { start: '2024-01-01', end: '2024-01-31' }. Pass null to clear it.");

function text(t: string) {
    return { content: [{ type: "text" as const, text: t }] };
}

function errorText(action: string, error: any) {
    return text(`Failed to ${action}: ${error.message || error}`);
}

function formatBoard(board: Board) {
    const lines: string[] = [];
    lines.push(`Board: ${board.name} [ID: ${board._id}]`);
    lines.push(`Columns:`);
    board.columns.forEach((col: Column) => lines.push(`  - ${col.name} [ID: ${col.uniqueId}]`));
    if (board.swimlanes && board.swimlanes.length > 0) {
        lines.push(`Swimlanes:`);
        board.swimlanes.forEach((sl: Swimlane) => lines.push(`  - ${sl.name} [ID: ${sl.uniqueId}]`));
    }
    if (board.colors && board.colors.length > 0) {
        lines.push(`Colors: ${board.colors.map(c => c.value).join(', ')}`);
    }
    return lines.join('\n');
}

function formatTaskLine(task: KanbanTask, index?: number): string {
    let line = index !== undefined ? `${index + 1}. ` : '- ';
    line += task.name;
    if (task.color) line += ` [${task.color.toUpperCase()}]`;
    if (task.number) line += ` (${task.number.prefix || ''}${task.number.value})`;
    if (task.description) line += ` - ${task.description.substring(0, 100)}${task.description.length > 100 ? '...' : ''}`;
    line += ` [ID: ${task._id}]`;
    return line;
}

function formatTaskDetails(task: KanbanTask): string {
    let out = `Task Details:\n`;
    out += `- ID: ${task._id}\n`;
    out += `- Name: ${task.name}\n`;
    out += `- Column ID: ${task.columnId}\n`;
    if (task.swimlaneId) out += `- Swimlane ID: ${task.swimlaneId}\n`;
    if (task.description) out += `- Description: ${task.description}\n`;
    if (task.color) out += `- Color: ${task.color}\n`;
    if (task.position !== undefined) out += `- Position: ${task.position}\n`;
    if (task.number) out += `- Number: ${task.number.prefix || ''}${task.number.value}\n`;
    if (task.responsibleUserId) out += `- Responsible User: ${task.responsibleUserId}\n`;
    if (task.totalSecondsSpent) out += `- Time Spent: ${task.totalSecondsSpent} seconds\n`;
    if (task.totalSecondsEstimate) out += `- Time Estimate: ${task.totalSecondsEstimate} seconds\n`;
    if (task.pointsEstimate) out += `- Points Estimate: ${task.pointsEstimate}\n`;
    if (task.groupingDate) out += `- Grouping Date: ${task.groupingDate}\n`;
    if (task.timeline) out += `- Timeline: ${task.timeline.start} -> ${task.timeline.end}\n`;
    if (task.subTasks && task.subTasks.length > 0) {
        out += `- Subtasks (${task.subTasks.length}):\n`;
        task.subTasks.forEach((s: any, i: number) => out += `  ${i + 1}. ${s.finished ? '✅' : '⬜'} ${s.name || 'Unnamed'}\n`);
    }
    if (task.labels && task.labels.length > 0) {
        out += `- Labels: ${task.labels.map((l: any) => l.name).join(', ')}\n`;
    }
    if (task.collaborators && task.collaborators.length > 0) {
        out += `- Collaborators: ${task.collaborators.map((c: any) => c.userId).join(', ')}\n`;
    }
    if (task.dates && task.dates.length > 0) {
        out += `- Dates: ${task.dates.length} date(s) set\n`;
    }
    return out;
}

/** Minimal CSV line parser supporting quoted fields with embedded commas/quotes. */
function parseCsv(content: string): Record<string, string>[] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < content.length; i++) {
        const c = content[i];
        if (inQuotes) {
            if (c === '"') {
                if (content[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else field += c;
        } else {
            if (c === '"') inQuotes = true;
            else if (c === ',') { row.push(field); field = ''; }
            else if (c === '\n' || c === '\r') {
                if (c === '\r' && content[i + 1] === '\n') i++;
                row.push(field); field = '';
                if (row.length > 1 || row[0] !== '') rows.push(row);
                row = [];
            } else field += c;
        }
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    if (rows.length === 0) return [];
    const header = rows[0].map(h => h.trim());
    return rows.slice(1).map(r => {
        const obj: Record<string, string> = {};
        header.forEach((h, i) => obj[h] = (r[i] ?? '').trim());
        return obj;
    });
}

// ---------- board / config management ----------

server.registerTool(
    "list_boards",
    {
        description: "List all configured KanbanFlow board names. API tokens are never exposed.",
        inputSchema: strict({}),
    },
    async () => {
        try {
            const boards = await registry.listBoards();
            if (boards.length === 0) {
                return text(`No boards configured yet. Config file: ${BOARDS_CONFIG_PATH}\nUse add_board to add one.`);
            }
            return text(`Configured boards:\n${boards.map(b => `- ${b.name} (boardId: ${b.boardId})`).join('\n')}`);
        } catch (error: any) {
            return errorText("list boards", error);
        }
    }
);

server.registerTool(
    "add_board",
    {
        description: "Add a new board to the config by name and API token. Fetches the board to confirm the token works and to capture its board ID.",
        inputSchema: strict({
        name: z.string().describe("A short name you'll use to refer to this board in other tool calls"),
        token: z.string().describe("KanbanFlow API token for this board (Settings > API & Webhooks)"),
    }),
    },
    async ({ name, token }) => {
        try {
            const entry = await registry.addBoard(name, token);
            return text(`Added board "${entry.name}" (boardId: ${entry.boardId}) to ${BOARDS_CONFIG_PATH}`);
        } catch (error: any) {
            return errorText("add board", error);
        }
    }
);

server.registerTool(
    "remove_board",
    {
        description: "Remove a configured board by name.",
        inputSchema: strict({ board_name: boardNameParam }),
    },
    async ({ board_name }) => {
        try {
            await registry.removeBoard(board_name);
            return text(`Removed board "${board_name}" from ${BOARDS_CONFIG_PATH}`);
        } catch (error: any) {
            return errorText("remove board", error);
        }
    }
);

server.registerTool(
    "sync_board_ids",
    {
        description: "Re-fetch one (or all, if board_name omitted) configured board(s) from KanbanFlow and update the stored board ID if it changed.",
        inputSchema: strict({ board_name: z.string().optional().describe("Board to sync; omit to sync all configured boards") }),
    },
    async ({ board_name }) => {
        try {
            const results = await registry.syncBoardIds(board_name);
            const lines = results.map(r =>
                r.error
                    ? `- ${r.name}: ERROR - ${r.error}`
                    : `- ${r.name}: ${r.changed ? `boardId changed ${r.oldBoardId} -> ${r.newBoardId}` : `unchanged (${r.newBoardId})`}`
            );
            return text(`Sync results:\n${lines.join('\n')}`);
        } catch (error: any) {
            return errorText("sync board ids", error);
        }
    }
);

// ---------- board ----------

server.registerTool(
    "get_board",
    {
        description: "Get full board details: columns, swimlanes, colors, settings.",
        inputSchema: strict({ board_name: boardNameParam }),
    },
    async ({ board_name }) => {
        try {
            const client = await registry.getClient(board_name);
            const board = await kanban.getBoard(client);
            return text(formatBoard(board));
        } catch (error: any) {
            return errorText("get board", error);
        }
    }
);

server.registerTool(
    "get_board_custom_fields",
    {
        description: "Get the custom field definitions available on the board.",
        inputSchema: strict({ board_name: boardNameParam }),
    },
    async ({ board_name }) => {
        try {
            const client = await registry.getClient(board_name);
            const fields = await kanban.getBoardCustomFields(client);
            if (fields.length === 0) return text("No custom fields defined on this board.");
            return text(fields.map(f => `- ${f.name} [ID: ${f._id}] (${f.fieldType})`).join('\n'));
        } catch (error: any) {
            return errorText("get board custom fields", error);
        }
    }
);

server.registerTool(
    "get_board_events",
    {
        description: "Get board-level events (audit log) within an optional time window.",
        inputSchema: strict({
        board_name: boardNameParam,
        from: z.string().optional().describe("Start timestamp, ISO 8601 or epoch ms"),
        to: z.string().optional().describe("End timestamp, ISO 8601 or epoch ms"),
        limit: z.number().optional().describe("Max events to return (default/max 100)"),
        order: z.enum(['ascending', 'descending']).optional(),
    }),
    },
    async ({ board_name, from, to, limit, order }) => {
        try {
            const client = await registry.getClient(board_name);
            const events = await kanban.getBoardEvents(client, from, to, limit, order);
            if (events.length === 0) return text("No events found in that window.");
            return text(events.map(e => `- ${e.timestamp}: ${e.eventType}${e.taskId ? ` (task ${e.taskId})` : ''}`).join('\n'));
        } catch (error: any) {
            return errorText("get board events", error);
        }
    }
);

server.registerTool(
    "get_users",
    {
        description: "Get all users who have access to the board.",
        inputSchema: strict({ board_name: boardNameParam }),
    },
    async ({ board_name }) => {
        try {
            const client = await registry.getClient(board_name);
            const users = await kanban.getUsers(client);
            return text(users.map(u => `- ${u.fullName} <${u.email}> [ID: ${u._id}]`).join('\n') || "No users found.");
        } catch (error: any) {
            return errorText("get users", error);
        }
    }
);

// ---------- tasks ----------

server.registerTool(
    "create_task",
    {
        description: "Create a new task on the board",
        inputSchema: strict({
        board_name: boardNameParam,
        name: z.string().describe("Name of the task"),
        column_id: z.string().describe("ID of the column to create the task in"),
        swimlane_id: z.string().optional().describe("ID of the swimlane (required if the board has swimlanes)"),
        description: z.string().optional(),
        color: colorEnum.optional(),
        position: z.union([z.string(), z.number()]).optional(),
        number: numberParam,
        totalSecondsEstimate: z.number().optional(),
        pointsEstimate: z.number().optional(),
        groupingDate: groupingDateParam,
        timeline: timelineParam,
        subTasks: subTasksParam,
        collaborators: collaboratorsParam,
    }),
    },
    async ({ board_name, name, column_id, swimlane_id, description, color, position, number, totalSecondsEstimate, pointsEstimate, groupingDate, timeline, subTasks, collaborators }) => {
        try {
            const client = await registry.getClient(board_name);
            const task = await kanban.createTask(client, {
                name,
                columnId: column_id,
                swimlaneId: swimlane_id,
                description,
                color,
                position,
                number,
                totalSecondsEstimate,
                pointsEstimate,
                groupingDate,
                timeline,
                subTasks,
                collaborators,
            });
            return text(`Successfully created task!\nTask ID: ${task.taskId}`);
        } catch (error: any) {
            return errorText("create task", error);
        }
    }
);

server.registerTool(
    "get_task",
    {
        description: "Get detailed information about a specific task by its ID",
        inputSchema: strict({
        board_name: boardNameParam,
        task_id: z.string(),
        includePosition: z.boolean().optional(),
    }),
    },
    async ({ board_name, task_id, includePosition }) => {
        try {
            const client = await registry.getClient(board_name);
            const task = await kanban.getTaskById(client, task_id, includePosition);
            return text(formatTaskDetails(task));
        } catch (error: any) {
            return errorText("get task", error);
        }
    }
);

server.registerTool(
    "get_tasks_by_column",
    {
        description: "Get tasks filtered by column ID. swimlane_id is optional.",
        inputSchema: strict({
        board_name: boardNameParam,
        column_id: z.string(),
        swimlane_id: z.string().optional(),
    }),
    },
    async ({ board_name, column_id, swimlane_id }) => {
        try {
            const client = await registry.getClient(board_name);
            const tasks = await kanban.getTasksByColumn(client, column_id, swimlane_id);
            return text(tasks.length > 0 ? tasks.map((t, i) => formatTaskLine(t, i)).join('\n') : "No tasks found in this column.");
        } catch (error: any) {
            return errorText("get tasks by column", error);
        }
    }
);

server.registerTool(
    "get_all_tasks",
    {
        description: "Get every task on a board.",
        inputSchema: strict({ board_name: boardNameParam }),
    },
    async ({ board_name }) => {
        try {
            const client = await registry.getClient(board_name);
            const columns = await kanban.getAllTasks(client);
            let out = "";
            for (const column of columns) {
                out += `📂 ${column.columnName} (${column.tasks.length} tasks):\n`;
                if (column.tasks.length === 0) out += "   (no tasks)\n";
                else column.tasks.forEach((t, i) => out += `   ${formatTaskLine(t, i)}\n`);
                if (column.tasksLimited) out += "   ⚠️ more tasks exist than shown (limited)\n";
                out += "\n";
            }
            return text(out.trim());
        } catch (error: any) {
            return errorText("get all tasks", error);
        }
    }
);

server.registerTool(
    "update_task",
    {
        description: "Update a task (name, description, color, column, swimlane, position, number, estimates, subtasks, collaborators, grouping date, timeline). Only supply the properties you want to change.",
        inputSchema: strict({
        board_name: boardNameParam,
        task_id: z.string(),
        name: z.string().optional(),
        column_id: z.string().optional().describe("Move task to this column ID"),
        swimlane_id: z.string().optional().describe("Move task to this swimlane ID"),
        description: z.string().optional(),
        color: colorEnum.optional(),
        position: z.union([z.string(), z.number()]).optional(),
        responsibleUserId: z.string().optional(),
        number: numberParam,
        totalSecondsEstimate: z.number().optional(),
        pointsEstimate: z.number().optional(),
        groupingDate: groupingDateParam,
        timeline: timelineParam,
        subTasks: subTasksParam,
        collaborators: collaboratorsParam,
    }),
    },
    async ({ board_name, task_id, name, column_id, swimlane_id, description, color, position, responsibleUserId, number, totalSecondsEstimate, pointsEstimate, groupingDate, timeline, subTasks, collaborators }) => {
        try {
            const client = await registry.getClient(board_name);
            const updates: any = {};
            if (name !== undefined) updates.name = name;
            if (column_id !== undefined) updates.columnId = column_id;
            if (swimlane_id !== undefined) updates.swimlaneId = swimlane_id;
            if (description !== undefined) updates.description = description;
            if (color !== undefined) updates.color = color;
            if (position !== undefined) updates.position = position;
            if (responsibleUserId !== undefined) updates.responsibleUserId = responsibleUserId;
            if (number !== undefined) updates.number = number;
            if (totalSecondsEstimate !== undefined) updates.totalSecondsEstimate = totalSecondsEstimate;
            if (pointsEstimate !== undefined) updates.pointsEstimate = pointsEstimate;
            if (groupingDate !== undefined) updates.groupingDate = groupingDate;
            if (timeline !== undefined) updates.timeline = timeline;
            if (subTasks !== undefined) updates.subTasks = subTasks;
            if (collaborators !== undefined) updates.collaborators = collaborators;

            await kanban.updateTask(client, task_id, updates);
            const updated = await kanban.getTaskById(client, task_id);
            return text(`Successfully updated task!\n${formatTaskDetails(updated)}`);
        } catch (error: any) {
            return errorText("update task", error);
        }
    }
);

server.registerTool(
    "delete_task",
    {
        description: "Permanently delete a task.",
        inputSchema: strict({ board_name: boardNameParam, task_id: z.string() }),
    },
    async ({ board_name, task_id }) => {
        try {
            const client = await registry.getClient(board_name);
            await kanban.deleteTask(client, task_id);
            return text(`Deleted task ${task_id}.`);
        } catch (error: any) {
            return errorText("delete task", error);
        }
    }
);

server.registerTool(
    "move_task_to_board",
    {
        description: "Move a task from one configured board to another (or another column/swimlane on a different board).",
        inputSchema: strict({
        board_name: boardNameParam.describe("The board the task currently lives on"),
        task_id: z.string(),
        target_board_name: z.string().describe("The configured board to move the task to"),
        column_id: z.string().optional().describe("Target column ID; defaults to the target board's first column"),
        swimlane_id: z.string().optional(),
        groupingDate: groupingDateParam,
    }),
    },
    async ({ board_name, task_id, target_board_name, column_id, swimlane_id, groupingDate }) => {
        try {
            const client = await registry.getClient(board_name);
            const targetEntry = await registry.getBoardEntry(target_board_name);
            await kanban.moveTaskToBoard(client, task_id, targetEntry.boardId, targetEntry.token, {
                columnId: column_id,
                swimlaneId: swimlane_id,
                groupingDate,
            });
            return text(`Moved task ${task_id} from "${board_name}" to "${target_board_name}".`);
        } catch (error: any) {
            return errorText("move task to another board", error);
        }
    }
);

// ---------- subtasks ----------

server.registerTool(
    "create_subtask",
    {
        description: "Add a subtask to an existing task.",
        inputSchema: strict({
        board_name: boardNameParam,
        task_id: z.string(),
        name: z.string(),
        finished: z.boolean().optional(),
        userId: z.string().optional(),
        dueDateTimestamp: z.string().optional(),
        dueDateTimestampLocal: z.string().optional(),
    }),
    },
    async ({ board_name, task_id, name, finished, userId, dueDateTimestamp, dueDateTimestampLocal }) => {
        try {
            const client = await registry.getClient(board_name);
            const result = await kanban.createSubtask(client, task_id, { name, finished, userId, dueDateTimestamp, dueDateTimestampLocal });
            return text(`Added subtask "${name}" at position ${result.insertIndex}.`);
        } catch (error: any) {
            return errorText("create subtask", error);
        }
    }
);

server.registerTool(
    "get_subtasks",
    {
        description: "Get all subtasks for a task.",
        inputSchema: strict({ board_name: boardNameParam, task_id: z.string() }),
    },
    async ({ board_name, task_id }) => {
        try {
            const client = await registry.getClient(board_name);
            const subtasks = await kanban.getSubtasks(client, task_id);
            if (subtasks.length === 0) return text("No subtasks.");
            return text(subtasks.map((s, i) => `${i + 1}. ${s.finished ? '✅' : '⬜'} ${s.name}${s.userId ? ` (assigned: ${s.userId})` : ''}`).join('\n'));
        } catch (error: any) {
            return errorText("get subtasks", error);
        }
    }
);

// ---------- labels ----------

server.registerTool(
    "create_label",
    {
        description: "Add a label to a task.",
        inputSchema: strict({ board_name: boardNameParam, task_id: z.string(), name: z.string(), pinned: z.boolean().optional() }),
    },
    async ({ board_name, task_id, name, pinned }) => {
        try {
            const client = await registry.getClient(board_name);
            const result = await kanban.createLabel(client, task_id, { name, pinned });
            return text(`Added label "${name}" at position ${result.insertIndex}.`);
        } catch (error: any) {
            return errorText("create label", error);
        }
    }
);

server.registerTool(
    "get_labels",
    {
        description: "Get all labels on a task.",
        inputSchema: strict({ board_name: boardNameParam, task_id: z.string() }),
    },
    async ({ board_name, task_id }) => {
        try {
            const client = await registry.getClient(board_name);
            const labels = await kanban.getLabels(client, task_id);
            if (labels.length === 0) return text("No labels.");
            return text(labels.map(l => `- ${l.pinned ? '📌' : '🏷️'} ${l.name}`).join('\n'));
        } catch (error: any) {
            return errorText("get labels", error);
        }
    }
);

// ---------- dates ----------

server.registerTool(
    "set_date",
    {
        description: "Set or update the due date on a task. due_timestamp required (ISO 8601 UTC). due_timestamp_local and target_column_id optional.",
        inputSchema: strict({
        board_name: boardNameParam,
        task_id: z.string(),
        due_timestamp: z.string().describe("ISO 8601 UTC e.g. 2024-03-01T12:00:00Z"),
        target_column_id: z.string(),
        due_timestamp_local: z.string().optional().describe("ISO 8601 with offset e.g. 2024-03-01T13:00:00+01:00"),
        dateType: z.string().optional(),
        status: z.enum(['active', 'done']).optional(),
    }),
    },
    async ({ board_name, task_id, due_timestamp, target_column_id, due_timestamp_local, dateType, status }) => {
        try {
            const client = await registry.getClient(board_name);
            await kanban.setDate(client, task_id, {
                dueTimestamp: due_timestamp,
                targetColumnId: target_column_id,
                dueTimestampLocal: due_timestamp_local,
                dateType,
                status,
            });
            return text(`Set date on task ${task_id}: due ${due_timestamp}, target column ${target_column_id}.`);
        } catch (error: any) {
            return errorText("set date", error);
        }
    }
);

server.registerTool(
    "get_dates",
    {
        description: "Get date/due-date information for a task.",
        inputSchema: strict({ board_name: boardNameParam, task_id: z.string() }),
    },
    async ({ board_name, task_id }) => {
        try {
            const client = await registry.getClient(board_name);
            const dates = await kanban.getDates(client, task_id);
            if (dates.length === 0) return text("No dates set.");
            return text(dates.map(d => `- ${d.dateType || 'date'}: due ${d.dueTimestamp} (target column ${d.targetColumnId}, status ${d.status})`).join('\n'));
        } catch (error: any) {
            return errorText("get dates", error);
        }
    }
);

// ---------- collaborators ----------

server.registerTool(
    "get_collaborators",
    {
        description: "Get collaborators on a task.",
        inputSchema: strict({ board_name: boardNameParam, task_id: z.string() }),
    },
    async ({ board_name, task_id }) => {
        try {
            const client = await registry.getClient(board_name);
            const collaborators = await kanban.getCollaborators(client, task_id);
            if (collaborators.length === 0) return text("No collaborators.");
            return text(collaborators.map(c => `- ${c.userId}`).join('\n'));
        } catch (error: any) {
            return errorText("get collaborators", error);
        }
    }
);

// ---------- comments ----------

server.registerTool(
    "add_comment",
    {
        description: "Add a comment to a task.",
        inputSchema: strict({
        board_name: boardNameParam,
        task_id: z.string(),
        text: z.string(),
        authorUserId: z.string().optional(),
        createdTimestamp: z.string().optional(),
    }),
    },
    async ({ board_name, task_id, text: commentText, authorUserId, createdTimestamp }) => {
        try {
            const client = await registry.getClient(board_name);
            const result = await kanban.addComment(client, task_id, { text: commentText, authorUserId, createdTimestamp });
            return text(`Added comment [ID: ${result.taskCommentId}].`);
        } catch (error: any) {
            return errorText("add comment", error);
        }
    }
);

server.registerTool(
    "get_comments",
    {
        description: "Get comments on a task.",
        inputSchema: strict({ board_name: boardNameParam, task_id: z.string() }),
    },
    async ({ board_name, task_id }) => {
        try {
            const client = await registry.getClient(board_name);
            const comments = await kanban.getComments(client, task_id);
            if (comments.length === 0) return text("No comments.");
            return text(comments.map(c => `- [${c.createdTimestamp || '?'}] ${c.authorUserId || 'unknown'}: ${c.text}`).join('\n'));
        } catch (error: any) {
            return errorText("get comments", error);
        }
    }
);

// ---------- attachments ----------

server.registerTool(
    "get_attachments",
    {
        description: "Get attachments on a task.",
        inputSchema: strict({ board_name: boardNameParam, task_id: z.string() }),
    },
    async ({ board_name, task_id }) => {
        try {
            const client = await registry.getClient(board_name);
            const attachments = await kanban.getAttachments(client, task_id);
            if (attachments.length === 0) return text("No attachments.");
            return text(attachments.map(a => `- ${a.name} (${a.provider}, ${a.mimeType}, ${a.size}b) [ID: ${a._id}]\n  ${a.link}`).join('\n'));
        } catch (error: any) {
            return errorText("get attachments", error);
        }
    }
);

// ---------- relations ----------

server.registerTool(
    "get_relations",
    {
        description: "Get task relations (relatesTo/dependsOn/requiredBy).",
        inputSchema: strict({ board_name: boardNameParam, task_id: z.string() }),
    },
    async ({ board_name, task_id }) => {
        try {
            const client = await registry.getClient(board_name);
            const relations = await kanban.getRelations(client, task_id);
            if (relations.length === 0) return text("No relations.");
            return text(relations.map(r => `- ${r.relationType}: ${r.relatedTaskName} [ID: ${r.relatedTaskId}]${r.relatedTaskBoardId ? ` (board ${r.relatedTaskBoardId})` : ''}`).join('\n'));
        } catch (error: any) {
            return errorText("get relations", error);
        }
    }
);

// ---------- custom fields ----------

server.registerTool(
    "get_task_custom_fields",
    {
        description: "Get custom field values set on a task.",
        inputSchema: strict({ board_name: boardNameParam, task_id: z.string() }),
    },
    async ({ board_name, task_id }) => {
        try {
            const client = await registry.getClient(board_name);
            const fields = await kanban.getTaskCustomFields(client, task_id);
            if (fields.length === 0) return text("No custom field values set.");
            return text(fields.map(f => `- ${f.customFieldId}: ${f.value.text ?? f.value.number ?? ''}`).join('\n'));
        } catch (error: any) {
            return errorText("get task custom fields", error);
        }
    }
);

// ---------- time tracking ----------

server.registerTool(
    "add_manual_time_entry",
    {
        description: "Add a manual time entry to a task using ISO 8601 start and end timestamps.",
        inputSchema: strict({
        board_name: boardNameParam,
        task_id: z.string(),
        start_timestamp: z.string().describe("ISO 8601 UTC e.g. 2024-01-02T08:30:00Z"),
        end_timestamp: z.string().describe("ISO 8601 UTC e.g. 2024-01-02T12:00:00Z"),
        userId: z.string().optional(),
        comment: z.string().optional().describe("Max 50 characters"),
        labelNames: z.array(z.string()).optional(),
    }),
    },
    async ({ board_name, task_id, start_timestamp, end_timestamp, userId, comment, labelNames }) => {
        try {
            const client = await registry.getClient(board_name);
            await kanban.addManualTimeEntry(client, task_id, {
                startTimestamp: start_timestamp,
                endTimestamp: end_timestamp,
                userId,
                comment,
                labelNames,
            });
            return text(`Added manual time entry to task ${task_id}: ${start_timestamp} -> ${end_timestamp}.`);
        } catch (error: any) {
            return errorText("add manual time entry", error);
        }
    }
);

server.registerTool(
    "get_manual_time_entries_for_task",
    {
        description: "Get manual time entries logged on a specific task.",
        inputSchema: strict({ board_name: boardNameParam, task_id: z.string() }),
    },
    async ({ board_name, task_id }) => {
        try {
            const client = await registry.getClient(board_name);
            const entries = await kanban.getManualTimeEntriesForTask(client, task_id);
            if (entries.length === 0) return text("No manual time entries on this task.");
            return text(entries.map(e => `- ${e.startTimestamp} -> ${e.endTimestamp}${e.comment ? ` (${e.comment})` : ''} [ID: ${e._id}]`).join('\n'));
        } catch (error: any) {
            return errorText("get manual time entries for task", error);
        }
    }
);

server.registerTool(
    "get_time_entries_for_task",
    {
        description: "Get all time entries (manual, Pomodoro, Stopwatch) for a specific task within a time window.",
        inputSchema: strict({
        board_name: boardNameParam,
        task_id: z.string(),
        from: z.string().optional().describe("Start timestamp, ISO 8601 or epoch ms (from or to required)"),
        to: z.string().optional().describe("End timestamp, ISO 8601 or epoch ms (from or to required)"),
    }),
    },
    async ({ board_name, task_id, from, to }) => {
        try {
            const client = await registry.getClient(board_name);
            const entries = await kanban.getTimeEntriesForTask(client, task_id, from, to);
            if (entries.length === 0) return text("No time entries found for this task in that window.");
            return text(entries.map(e => `- [${e.type}] ${e.startTimestamp} -> ${e.endTimestamp || '(ongoing)'}${e.comment ? ` (${e.comment})` : ''}`).join('\n'));
        } catch (error: any) {
            return errorText("get time entries for task", error);
        }
    }
);

server.registerTool(
    "get_time_entries_for_board",
    {
        description: "Get all time entries (manual, Pomodoro, Stopwatch) for the board within a time window.",
        inputSchema: strict({
        board_name: boardNameParam,
        from: z.string().optional().describe("Start timestamp, ISO 8601 or epoch ms (from or to required)"),
        to: z.string().optional().describe("End timestamp, ISO 8601 or epoch ms (from or to required)"),
        userId: z.string().optional(),
        limit: z.number().optional().describe("Max 1000, default 100"),
    }),
    },
    async ({ board_name, from, to, userId, limit }) => {
        try {
            const client = await registry.getClient(board_name);
            const entries = await kanban.getTimeEntriesForBoard(client, from, to, userId, limit);
            if (entries.length === 0) return text("No time entries found in that window.");
            return text(entries.map(e => `- [${e.type}] task ${e.taskId}: ${e.startTimestamp} -> ${e.endTimestamp || '(ongoing)'}`).join('\n'));
        } catch (error: any) {
            return errorText("get time entries for board", error);
        }
    }
);

// ---------- bulk import ----------

server.registerTool(
    "import_csv",
    {
        description: "Bulk-create tasks on a board from CSV content. Required column: name. Optional columns: description, color, swimlaneId, position.",
        inputSchema: strict({
        board_name: boardNameParam,
        column_id: z.string().describe("Column ID every row will be created in"),
        csv_content: z.string().describe("Raw CSV text, first row = headers"),
    }),
    },
    async ({ board_name, column_id, csv_content }) => {
        try {
            const client = await registry.getClient(board_name);
            const rows = parseCsv(csv_content);
            if (rows.length === 0) return text("No data rows found in CSV.");
            const created: string[] = [];
            const failed: string[] = [];
            for (const row of rows) {
                if (!row.name) { failed.push(`(missing name) ${JSON.stringify(row)}`); continue; }
                try {
                    const task = await kanban.createTask(client, {
                        name: row.name,
                        columnId: column_id,
                        description: row.description || undefined,
                        color: (row.color as TaskColor) || undefined,
                        swimlaneId: row.swimlaneId || undefined,
                        position: row.position || undefined,
                    });
                    created.push(`${row.name} [ID: ${task.taskId}]`);
                } catch (error: any) {
                    failed.push(`${row.name}: ${error.message}`);
                }
            }
            let out = `Created ${created.length}/${rows.length} tasks.\n`;
            if (created.length > 0) out += `\nCreated:\n${created.map(c => `- ${c}`).join('\n')}\n`;
            if (failed.length > 0) out += `\nFailed:\n${failed.map(f => `- ${f}`).join('\n')}\n`;
            return text(out.trim());
        } catch (error: any) {
            return errorText("import CSV", error);
        }
    }
);

// ---------- startup ----------

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("KanbanFlow MCP Server (multi-board) running on stdio");
}

main().catch((error) => {
    console.error("Fatal error running server:", error);
    process.exit(1);
});
