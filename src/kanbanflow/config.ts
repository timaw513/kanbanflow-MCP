import os from 'os';
import path from 'path';

export const KANBAN_CONFIG = {
    BASE_URL: 'https://kanbanflow.com/api/v1',
} as const;

export const DEFAULT_HEADERS = {
    'Content-Type': 'application/json'
} as const;

// Path to the multi-board config file. Defaults to ~/.kanbanflow/boards.json,
// matching the existing local setup; override with KANBANFLOW_BOARDS_CONFIG.
export const BOARDS_CONFIG_PATH =
    process.env.KANBANFLOW_BOARDS_CONFIG ||
    path.join(os.homedir(), '.kanbanflow', 'boards.json');
