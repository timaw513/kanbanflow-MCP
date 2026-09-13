export interface Column {
    name: string;
    uniqueId: string;
    description?: string;
}

export interface Swimlane {
    name: string;
    uniqueId: string;
    description?: string;
}

export interface ColorConfig {
    name: string;
    value: string;
    description?: string;
}

export interface Board {
    _id: string;
    name: string;
    columns: Column[];
    swimlanes?: Swimlane[];
    colors?: ColorConfig[];
}

// --- Multi-board config (boards.json) ---

export interface BoardEntry {
    name: string;
    token: string;
    boardId: string;
}

export interface BoardsConfig {
    boards: BoardEntry[];
}

// --- Tasks ---

export type TaskColor = 'yellow' | 'white' | 'red' | 'green' | 'blue' | 'purple' | 'orange' | 'cyan' | 'brown' | 'magenta';

/** The task number consists of an integer value and an optional prefix. Pass null to clear the field. */
export interface TaskNumber {
    prefix?: string;
    value: number;
}

/** Inline subtask as accepted by Create/Update Task (a subset of the full Subtask shape). */
export interface InlineSubtask {
    name: string;
    finished?: boolean;
}

/** A collaborator reference as accepted by Create/Update Task. */
export interface InlineCollaborator {
    userId: string;
}

/** A task's timeline: a start and end date, format YYYY-MM-DD. Pass null to clear it. */
export interface TaskTimeline {
    start: string;
    end: string;
}

export interface CreateTaskRequest {
    name: string;
    columnId: string;
    swimlaneId?: string;
    position?: string | number;
    color?: TaskColor;
    description?: string;
    number?: TaskNumber | null;
    totalSecondsEstimate?: number;
    pointsEstimate?: number;
    /** Only used if the target column is date grouped. Format YYYY-MM-DD, or null/"" for unknown date. */
    groupingDate?: string | null;
    timeline?: TaskTimeline | null;
    subTasks?: InlineSubtask[];
    collaborators?: InlineCollaborator[];
}

export interface CreateTaskResponse {
    taskId: string;
}

export interface UpdateTaskRequest {
    name?: string;
    columnId?: string;
    swimlaneId?: string;
    description?: string;
    color?: TaskColor;
    position?: string | number;
    responsibleUserId?: string;
    number?: TaskNumber | null;
    totalSecondsEstimate?: number;
    pointsEstimate?: number;
    /** Only used if the target column is date grouped. Format YYYY-MM-DD, or null/"" for unknown date. */
    groupingDate?: string | null;
    timeline?: TaskTimeline | null;
    subTasks?: InlineSubtask[];
    collaborators?: InlineCollaborator[];
}

export interface KanbanTask {
    _id: string;
    name: string;
    columnId: string;
    swimlaneId?: string;
    position?: number;
    description?: string;
    color?: string;
    number?: {
        prefix?: string;
        value: number;
    };
    responsibleUserId?: string;
    totalSecondsSpent?: number;
    totalSecondsEstimate?: number;
    pointsEstimate?: number;
    groupingDate?: string;
    timeline?: TaskTimeline;
    dates?: any[];
    subTasks?: any[];
    labels?: any[];
    collaborators?: any[];
    customFields?: any[];
}

export interface KanbanColumnTasksResponse {
    columnId: string;
    columnName: string;
    tasksLimited: boolean;
    tasks: KanbanTask[];
}

export interface KanbanAllTasksResponse {
    columnId: string;
    columnName: string;
    tasksLimited: boolean;
    tasks: KanbanTask[];
}

// --- Subtasks ---

export interface Subtask {
    name: string;
    finished?: boolean;
    userId?: string;
    dueDateTimestamp?: string;
    dueDateTimestampLocal?: string;
}

export interface CreateSubtaskRequest {
    name: string;
    finished?: boolean;
    userId?: string;
    dueDateTimestamp?: string;
    dueDateTimestampLocal?: string;
}

export interface CreateSubtaskResponse {
    insertIndex: number;
}

// --- Labels ---

export interface Label {
    name: string;
    pinned?: boolean;
}

export interface CreateLabelRequest {
    name: string;
    pinned?: boolean;
}

export interface CreateLabelResponse {
    insertIndex: number;
}

// --- Dates ---

export interface TaskDate {
    status?: string;
    dateType?: string;
    dueTimestamp?: string;
    dueTimestampLocal?: string;
    targetColumnId?: string;
}

export interface SetTaskDateRequest {
    dueTimestamp: string;
    targetColumnId: string;
    dueTimestampLocal?: string;
    dateType?: string;
    status?: string;
}

// --- Collaborators ---

export interface Collaborator {
    userId: string;
}

// --- Comments ---

export interface TaskComment {
    _id: string;
    text: string;
    createdTimestamp?: string;
    authorUserId?: string;
}

export interface AddCommentRequest {
    text: string;
    authorUserId?: string;
    createdTimestamp?: string;
}

export interface AddCommentResponse {
    taskCommentId: string;
}

// --- Attachments ---

export interface Attachment {
    _id: string;
    provider: string;
    name: string;
    size: number;
    mimeType: string;
    link: string;
    linkExpiresTimestamp?: string;
    createdTimestamp?: string;
    createdByFullName?: string;
}

// --- Relations ---

export interface TaskRelation {
    relationType: 'relatesTo' | 'dependsOn' | 'requiredBy';
    relatedTaskId: string;
    relatedTaskName: string;
    relatedTaskBoardId?: string;
}

// --- Custom fields ---

export interface BoardCustomField {
    _id: string;
    name: string;
    fieldType: string;
    numberSettings?: { prefix?: string; suffix?: string };
    dropdownOptions?: { text: string }[];
}

export interface TaskCustomFieldValue {
    customFieldId: string;
    value: { text?: string; number?: number };
}

// --- Users ---

export interface KanbanUser {
    _id: string;
    fullName: string;
    email: string;
}

// --- Events ---

export interface KanbanEvent {
    _id: string;
    timestamp: string;
    userId?: string;
    eventType: string;
    taskId?: string;
    detailedEvents?: any[];
    changedProperties?: any;
}

// --- Time entries ---

export interface TimeEntry {
    entryId?: string;
    type?: 'pomodoro' | 'stopwatch' | 'manual';
    userId?: string;
    taskId?: string;
    startTimestamp: string;
    endTimestamp?: string;
    comment?: string;
    labelNames?: string[];
}

export interface AddManualTimeEntryRequest {
    userId?: string;
    startTimestamp: string;
    endTimestamp: string;
    comment?: string;
    labelNames?: string[];
}

export interface ManualTimeEntry {
    _id: string;
    startTimestamp: string;
    endTimestamp: string;
    userId?: string;
    taskId?: string;
    comment?: string;
    labelNames?: string[];
    createdTimestamp?: string;
}

// --- Move task to another board ---

export interface MoveTaskToBoardRequest {
    columnId?: string;
    swimlaneId?: string;
    groupingDate?: string | null;
}

export interface KanbanError {
    message: string;
    status?: number;
    details?: unknown;
}
