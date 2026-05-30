import AsyncStorage from '@react-native-async-storage/async-storage';
import { offlineQueue } from '../../services/offlineQueue';

// Mock the api module
jest.mock('../../services/api', () => ({
    __esModule: true,
    default: {
        put: jest.fn(),
        post: jest.fn(),
        delete: jest.fn(),
    },
}));

const api = require('../../services/api').default;

describe('OfflineQueue', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
        (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    });

    describe('enqueue', () => {
        it('should add an operation to the queue', async () => {
            const op = await offlineQueue.enqueue({
                type: 'updateTicket',
                endpoint: '/tickets/1',
                method: 'PUT',
                payload: { status: 'Ongoing' },
                ticketId: 1,
            });

            expect(op.id).toBeDefined();
            expect(op.retryCount).toBe(0);
            expect(op.type).toBe('updateTicket');
            expect(AsyncStorage.setItem).toHaveBeenCalled();
        });

        it('should generate unique IDs', async () => {
            const op1 = await offlineQueue.enqueue({
                type: 'updateTicket', endpoint: '/tickets/1', method: 'PUT', ticketId: 1,
            });
            const op2 = await offlineQueue.enqueue({
                type: 'updateTicket', endpoint: '/tickets/2', method: 'PUT', ticketId: 2,
            });

            expect(op1.id).not.toBe(op2.id);
        });
    });

    describe('getQueueStatus', () => {
        it('should return empty status when queue is empty', async () => {
            const status = await offlineQueue.getQueueStatus();
            expect(status.pending).toBe(0);
            expect(status.failed).toBe(0);
            expect(status.isProcessing).toBe(false);
        });
    });

    describe('processQueue', () => {
        it('should process queued PUT operations', async () => {
            const items = [{
                id: 'test-1',
                type: 'updateTicket',
                endpoint: '/tickets/1',
                method: 'PUT',
                payload: { status: 'Ongoing' },
                ticketId: 1,
                retryCount: 0,
                createdAt: new Date().toISOString(),
            }];
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(items));
            (api.put as jest.Mock).mockResolvedValue({ data: {} });

            const result = await offlineQueue.processQueue();

            expect(api.put).toHaveBeenCalledWith('/tickets/1', { status: 'Ongoing' });
            expect(result.processed).toBe(1);
        });

        it('should process queued POST operations', async () => {
            const items = [{
                id: 'test-2',
                type: 'completeTicket',
                endpoint: '/tickets/1/complete',
                method: 'POST',
                payload: { resolution_remarks: 'Fixed' },
                ticketId: 1,
                retryCount: 0,
                createdAt: new Date().toISOString(),
            }];
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(items));
            (api.post as jest.Mock).mockResolvedValue({ data: {} });

            const result = await offlineQueue.processQueue();

            expect(api.post).toHaveBeenCalledWith('/tickets/1/complete', { resolution_remarks: 'Fixed' });
            expect(result.processed).toBe(1);
        });

        it('should increment retryCount on failure', async () => {
            const items = [{
                id: 'test-3',
                type: 'updateTicket',
                endpoint: '/tickets/1',
                method: 'PUT',
                payload: {},
                ticketId: 1,
                retryCount: 0,
                createdAt: new Date().toISOString(),
            }];
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(items));
            (api.put as jest.Mock).mockRejectedValue(new Error('Network error'));

            const result = await offlineQueue.processQueue();

            expect(result.failed).toBe(1);
        });
    });
});
