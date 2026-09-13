import fs from 'fs/promises';
import path from 'path';
import { KanbanClient } from './kanban-client.js';
import { BOARDS_CONFIG_PATH } from './config.js';
import { Board, BoardEntry, BoardsConfig } from './types.js';

/**
 * Manages the multi-board config file (boards.json): a list of
 * { name, token, boardId } entries, one per KanbanFlow board, since
 * KanbanFlow API tokens are issued per-board. Every tool call names a
 * board by `board_name` and this registry resolves it to a client.
 */
export class BoardRegistry {
    private clientCache = new Map<string, KanbanClient>();

    private async load(): Promise<BoardsConfig> {
        try {
            const raw = await fs.readFile(BOARDS_CONFIG_PATH, 'utf-8');
            const parsed = JSON.parse(raw);
            if (!parsed || !Array.isArray(parsed.boards)) {
                return { boards: [] };
            }
            return parsed;
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                return { boards: [] };
            }
            throw new Error(`Failed to read boards config at ${BOARDS_CONFIG_PATH}: ${error.message}`);
        }
    }

    private async save(config: BoardsConfig): Promise<void> {
        await fs.mkdir(path.dirname(BOARDS_CONFIG_PATH), { recursive: true });
        await fs.writeFile(BOARDS_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    }

    async listBoards(): Promise<BoardEntry[]> {
        const config = await this.load();
        return config.boards;
    }

    private async findEntry(boardName: string): Promise<BoardEntry> {
        const config = await this.load();
        const entry = config.boards.find(b => b.name === boardName);
        if (!entry) {
            const known = config.boards.map(b => b.name).join(', ') || '(none configured)';
            throw new Error(`Unknown board_name "${boardName}". Configured boards: ${known}`);
        }
        return entry;
    }

    async getBoardEntry(boardName: string): Promise<BoardEntry> {
        return this.findEntry(boardName);
    }

    async getClient(boardName: string): Promise<KanbanClient> {
        const cached = this.clientCache.get(boardName);
        if (cached) return cached;
        const entry = await this.findEntry(boardName);
        const client = new KanbanClient(entry.token);
        this.clientCache.set(boardName, client);
        return client;
    }

    /** Add a new board by name + API token. Fetches the board to confirm the token works and to capture boardId. */
    async addBoard(name: string, token: string): Promise<BoardEntry> {
        const config = await this.load();
        if (config.boards.some(b => b.name === name)) {
            throw new Error(`A board named "${name}" is already configured. Remove it first if you want to replace it.`);
        }
        const client = new KanbanClient(token);
        const board = await client.get<Board>('/board');
        const entry: BoardEntry = { name, token, boardId: board._id };
        config.boards.push(entry);
        await this.save(config);
        this.clientCache.set(name, client);
        return entry;
    }

    /** Remove a configured board by name. */
    async removeBoard(name: string): Promise<void> {
        const config = await this.load();
        const before = config.boards.length;
        config.boards = config.boards.filter(b => b.name !== name);
        if (config.boards.length === before) {
            throw new Error(`No configured board named "${name}".`);
        }
        await this.save(config);
        this.clientCache.delete(name);
    }

    /**
     * Re-fetch each configured board (or just one, if boardName is given) and
     * update the stored boardId if it changed. Returns a summary per board.
     */
    async syncBoardIds(boardName?: string): Promise<{ name: string; oldBoardId: string; newBoardId: string; changed: boolean; error?: string }[]> {
        const config = await this.load();
        const targets = boardName ? config.boards.filter(b => b.name === boardName) : config.boards;
        if (boardName && targets.length === 0) {
            throw new Error(`No configured board named "${boardName}".`);
        }

        const results: { name: string; oldBoardId: string; newBoardId: string; changed: boolean; error?: string }[] = [];
        for (const entry of targets) {
            try {
                const client = new KanbanClient(entry.token);
                const board = await client.get<Board>('/board');
                const changed = board._id !== entry.boardId;
                results.push({ name: entry.name, oldBoardId: entry.boardId, newBoardId: board._id, changed });
                entry.boardId = board._id;
            } catch (error: any) {
                results.push({ name: entry.name, oldBoardId: entry.boardId, newBoardId: entry.boardId, changed: false, error: error.message });
            }
        }
        await this.save(config);
        return results;
    }
}
