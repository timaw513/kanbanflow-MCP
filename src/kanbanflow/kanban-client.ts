import axios, {
    AxiosInstance,
    InternalAxiosRequestConfig,
    AxiosResponse,
    AxiosError
} from 'axios';
import { KANBAN_CONFIG, DEFAULT_HEADERS } from './config.js';
import { KanbanError } from './types.js';

/**
 * Thin HTTP wrapper around one board's KanbanFlow API token.
 * KanbanFlow tokens are per-board, so one KanbanClient == one board.
 */
export class KanbanClient {
    private client: AxiosInstance;
    public readonly apiToken: string;

    constructor(apiToken: string) {
        this.apiToken = apiToken;
        this.client = axios.create({
            baseURL: KANBAN_CONFIG.BASE_URL,
            headers: {
                ...DEFAULT_HEADERS,
                'Authorization': `Bearer ${this.apiToken}`
            }
        });

        this.setupLogging();
    }

    private setupLogging() {
        this.client.interceptors.request.use(
            (config: InternalAxiosRequestConfig) => config,
            (error: AxiosError) => Promise.reject(error)
        );

        this.client.interceptors.response.use(
            (response: AxiosResponse) => response,
            (error: AxiosError) => Promise.reject(this.formatError(error))
        );
    }

    private formatError(error: AxiosError): KanbanError {
        const errorData = error.response?.data as { message?: string } | undefined;
        return {
            message: errorData?.message || error.message || 'Unknown error occurred',
            status: error.response?.status,
            details: error.response?.data
        };
    }

    async get<T>(endpoint: string, params?: Record<string, any>): Promise<T> {
        const response = await this.client.get<T>(endpoint, { params });
        return response.data;
    }

    async post<T>(endpoint: string, data: any, extraHeaders?: Record<string, string>): Promise<T> {
        const response = await this.client.post<T>(endpoint, data, {
            headers: extraHeaders,
        });
        return response.data;
    }

    async delete<T>(endpoint: string): Promise<T> {
        const response = await this.client.delete<T>(endpoint);
        return response.data;
    }
}
