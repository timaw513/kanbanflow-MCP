import { KanbanClient } from './kanban-client.js';
import {
    Board,
    CreateTaskRequest,
    CreateTaskResponse,
    KanbanTask,
    UpdateTaskRequest,
    KanbanAllTasksResponse,
    CreateSubtaskRequest,
    CreateSubtaskResponse,
    Subtask,
    CreateLabelRequest,
    CreateLabelResponse,
    Label,
    SetTaskDateRequest,
    TaskDate,
    Collaborator,
    AddCommentRequest,
    AddCommentResponse,
    TaskComment,
    Attachment,
    TaskRelation,
    BoardCustomField,
    TaskCustomFieldValue,
    KanbanUser,
    KanbanEvent,
    AddManualTimeEntryRequest,
    ManualTimeEntry,
    TimeEntry,
    MoveTaskToBoardRequest,
} from './types.js';

// --- Board ---

export async function getBoard(client: KanbanClient): Promise<Board> {
    return client.get<Board>('/board');
}

// --- Tasks ---

export async function createTask(client: KanbanClient, task: CreateTaskRequest): Promise<CreateTaskResponse> {
    return client.post<CreateTaskResponse>('/tasks', task);
}

export async function getTaskById(client: KanbanClient, taskId: string, includePosition?: boolean): Promise<KanbanTask> {
    return client.get<KanbanTask>(`/tasks/${taskId}`, includePosition ? { includePosition: true } : undefined);
}

export async function getTasksByColumn(client: KanbanClient, columnId: string, swimlaneId?: string): Promise<KanbanTask[]> {
    const params: Record<string, any> = { columnId };
    if (swimlaneId) params.swimlaneId = swimlaneId;
    const response = await client.get<KanbanAllTasksResponse[]>('/tasks', params);
    return response.length > 0 ? response[0].tasks : [];
}

export async function getAllTasks(client: KanbanClient): Promise<KanbanAllTasksResponse[]> {
    return client.get<KanbanAllTasksResponse[]>('/tasks');
}

export async function updateTask(client: KanbanClient, taskId: string, updates: UpdateTaskRequest): Promise<KanbanTask> {
    return client.post<KanbanTask>(`/tasks/${taskId}`, updates);
}

export async function deleteTask(client: KanbanClient, taskId: string): Promise<void> {
    await client.delete<void>(`/tasks/${taskId}`);
}

export async function moveTaskToBoard(
    client: KanbanClient,
    taskId: string,
    targetBoardId: string,
    targetToken: string,
    request: MoveTaskToBoardRequest
): Promise<void> {
    await client.post<void>(
        `/tasks/${taskId}/move-to-board/${targetBoardId}`,
        request,
        { 'X-Target-Authorization': `Bearer ${targetToken}` }
    );
}

// --- Subtasks ---

export async function createSubtask(client: KanbanClient, taskId: string, subtask: CreateSubtaskRequest): Promise<CreateSubtaskResponse> {
    return client.post<CreateSubtaskResponse>(`/tasks/${taskId}/subtasks`, subtask);
}

export async function getSubtasks(client: KanbanClient, taskId: string): Promise<Subtask[]> {
    return client.get<Subtask[]>(`/tasks/${taskId}/subtasks`);
}

// --- Labels ---

export async function createLabel(client: KanbanClient, taskId: string, label: CreateLabelRequest): Promise<CreateLabelResponse> {
    return client.post<CreateLabelResponse>(`/tasks/${taskId}/labels`, label);
}

export async function getLabels(client: KanbanClient, taskId: string): Promise<Label[]> {
    return client.get<Label[]>(`/tasks/${taskId}/labels`);
}

// --- Dates ---

export async function setDate(client: KanbanClient, taskId: string, date: SetTaskDateRequest): Promise<void> {
    await client.post<void>(`/tasks/${taskId}/dates`, date);
}

export async function getDates(client: KanbanClient, taskId: string): Promise<TaskDate[]> {
    return client.get<TaskDate[]>(`/tasks/${taskId}/dates`);
}

// --- Collaborators ---

export async function getCollaborators(client: KanbanClient, taskId: string): Promise<Collaborator[]> {
    return client.get<Collaborator[]>(`/tasks/${taskId}/collaborators`);
}

// --- Comments ---

export async function addComment(client: KanbanClient, taskId: string, comment: AddCommentRequest): Promise<AddCommentResponse> {
    return client.post<AddCommentResponse>(`/tasks/${taskId}/comments`, comment);
}

export async function getComments(client: KanbanClient, taskId: string): Promise<TaskComment[]> {
    return client.get<TaskComment[]>(`/tasks/${taskId}/comments`);
}

// --- Attachments ---

export async function getAttachments(client: KanbanClient, taskId: string): Promise<Attachment[]> {
    return client.get<Attachment[]>(`/tasks/${taskId}/attachments`);
}

// --- Relations ---

export async function getRelations(client: KanbanClient, taskId: string): Promise<TaskRelation[]> {
    return client.get<TaskRelation[]>(`/tasks/${taskId}/relations`);
}

// --- Custom fields ---

export async function getBoardCustomFields(client: KanbanClient): Promise<BoardCustomField[]> {
    return client.get<BoardCustomField[]>('/custom-fields');
}

export async function getTaskCustomFields(client: KanbanClient, taskId: string): Promise<TaskCustomFieldValue[]> {
    return client.get<TaskCustomFieldValue[]>(`/tasks/${taskId}/custom-fields`);
}

// --- Users ---

export async function getUsers(client: KanbanClient): Promise<KanbanUser[]> {
    return client.get<KanbanUser[]>('/users');
}

// --- Events ---

export async function getBoardEvents(
    client: KanbanClient,
    from?: string,
    to?: string,
    limit?: number,
    order?: 'ascending' | 'descending'
): Promise<KanbanEvent[]> {
    const params: Record<string, any> = {};
    if (from) params.from = from;
    if (to) params.to = to;
    if (limit) params.limit = limit;
    if (order) params.order = order;
    return client.get<KanbanEvent[]>('/board/events', params);
}

// --- Time entries ---

export async function addManualTimeEntry(client: KanbanClient, taskId: string, entry: AddManualTimeEntryRequest): Promise<ManualTimeEntry> {
    return client.post<ManualTimeEntry>(`/tasks/${taskId}/manual-time-entries`, entry);
}

export async function getManualTimeEntriesForTask(client: KanbanClient, taskId: string): Promise<ManualTimeEntry[]> {
    return client.get<ManualTimeEntry[]>(`/tasks/${taskId}/manual-time-entries`);
}

export async function getTimeEntriesForBoard(
    client: KanbanClient,
    from?: string,
    to?: string,
    userId?: string,
    limit?: number
): Promise<TimeEntry[]> {
    const params: Record<string, any> = {};
    if (from) params.from = from;
    if (to) params.to = to;
    if (userId) params.userId = userId;
    if (limit) params.limit = limit;
    return client.get<TimeEntry[]>('/time-entries', params);
}

/**
 * KanbanFlow's /time-entries endpoint is board-wide (filtered by from/to/userId,
 * not by task), so a per-task view is done by fetching the board-wide window and
 * filtering client-side by taskId. Callers should pass a from/to window that's
 * likely to contain the task's activity.
 */
export async function getTimeEntriesForTask(
    client: KanbanClient,
    taskId: string,
    from?: string,
    to?: string
): Promise<TimeEntry[]> {
    const entries = await getTimeEntriesForBoard(client, from, to, undefined, 1000);
    return entries.filter(e => e.taskId === taskId);
}
