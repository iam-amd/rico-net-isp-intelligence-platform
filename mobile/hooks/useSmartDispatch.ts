import { useState, useEffect, useCallback } from 'react';
import { FieldIntelService } from '../services/fieldIntelService';
import { SmartDispatchItem, TicketStatus } from '../types';
import { useAuth } from '../context/AuthContext';
import { usePolling } from './usePolling';
import { useTicketList } from './useTicketList';

interface UseSmartDispatchResult {
    items: SmartDispatchItem[];
    loading: boolean;
    refreshing: boolean;
    onRefresh: () => void;
    isSmartMode: boolean;
    error: boolean;
}

const STATUS_FILTER: TicketStatus[] = ['Assigned', 'Open'];

export function useSmartDispatch(): UseSmartDispatchResult {
    const [items, setItems] = useState<SmartDispatchItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState(false);
    const { user } = useAuth();

    // Fallback to classic ticket list on error
    const fallback = useTicketList({ statusFilter: STATUS_FILTER, pollingInterval: 0 });

    const fetchQueue = useCallback(async () => {
        try {
            const queue = await FieldIntelService.getSmartDispatchQueue();
            setItems(queue);
            setError(false);
        } catch {
            setError(true);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [user?.id]);

    useEffect(() => {
        fetchQueue();
    }, [fetchQueue]);

    usePolling({ callback: fetchQueue, interval: 30000, enabled: !error });

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        fetchQueue();
    }, [fetchQueue]);

    // If smart queue fails, return false for isSmartMode
    // so the UI can fall back to classic tickets
    return {
        items,
        loading: error ? fallback.loading : loading,
        refreshing: error ? fallback.refreshing : refreshing,
        onRefresh: error ? fallback.onRefresh : onRefresh,
        isSmartMode: !error,
        error,
    };
}
