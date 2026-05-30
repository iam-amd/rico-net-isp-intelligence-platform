import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { TicketService } from '../services/ticketService';
import { Ticket, TicketStatus } from '../types';
import { useAuth } from '../context/AuthContext';
import { usePolling } from './usePolling';

interface UseTicketListOptions {
    statusFilter: TicketStatus[];
    pollingInterval?: number; // ms, 0 = no polling
}

interface UseTicketListResult {
    tickets: Ticket[];
    loading: boolean;
    refreshing: boolean;
    onRefresh: () => void;
}

export function useTicketList({ statusFilter, pollingInterval }: UseTicketListOptions): UseTicketListResult {
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const { user } = useAuth();

    // Stabilize statusFilter reference to prevent infinite re-renders
    const filterKey = statusFilter.join(',');
    const stableFilter = useMemo(() => statusFilter, [filterKey]);

    const fetchTickets = useCallback(async () => {
        try {
            // Don't pass assignedTech — backend handles visibility per role
            const all = await TicketService.getAllTickets('All');
            const filtered = all.filter(t => stableFilter.includes(t.status));
            setTickets(filtered);
        } catch (e) {
            console.error('Error fetching tickets', e);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [user?.username, stableFilter]);

    useEffect(() => {
        fetchTickets();
    }, [fetchTickets]);

    usePolling({
        callback: fetchTickets,
        interval: pollingInterval || 0,
        enabled: (pollingInterval || 0) > 0,
    });

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        fetchTickets();
    }, [fetchTickets]);

    return { tickets, loading, refreshing, onRefresh };
}
