import { ApiError } from '../../types';

describe('ApiError', () => {
    it('should create error with correct properties', () => {
        const error = new ApiError('Test error', 400, 'field', false);
        expect(error.message).toBe('Test error');
        expect(error.statusCode).toBe(400);
        expect(error.field).toBe('field');
        expect(error.isNetworkError).toBe(false);
        expect(error.name).toBe('ApiError');
    });

    it('should default statusCode to 0', () => {
        const error = new ApiError('Test error');
        expect(error.statusCode).toBe(0);
    });

    it('should be instance of Error', () => {
        const error = new ApiError('Test');
        expect(error).toBeInstanceOf(Error);
    });

    it('should identify network errors', () => {
        const error = new ApiError('Network failed', 0, undefined, true);
        expect(error.isNetworkError).toBe(true);
    });
});
