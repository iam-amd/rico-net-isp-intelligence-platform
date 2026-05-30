import React, { useState, useCallback } from 'react';
import {
    View, Text, TextInput, FlatList, TouchableOpacity,
    StyleSheet, ActivityIndicator,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CustomerService } from '../services/customerService';
import { Customer } from '../types';
import { useSettings } from '../context/SettingsContext';
import { COLORS, DARK_COLORS, SPACING, RADIUS } from '../constants/theme';
import { formatName } from '../utils/format';

export default function CustomerSearchScreen() {
    const router = useRouter();
    const { isDarkMode } = useSettings();
    const C = isDarkMode ? DARK_COLORS : COLORS;

    const [query, setQuery] = useState('');
    const [results, setResults] = useState<Customer[]>([]);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);
    const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

    const doSearch = useCallback(async (text: string) => {
        if (text.trim().length < 2) {
            setResults([]);
            setSearched(false);
            return;
        }
        setLoading(true);
        setSearched(true);
        const data = await CustomerService.search(text.trim());
        setResults(data);
        setLoading(false);
    }, []);

    const onChangeText = (text: string) => {
        setQuery(text);
        if (timer) clearTimeout(timer);
        setTimer(setTimeout(() => doSearch(text), 400));
    };

    return (
        <View style={[styles.container, { backgroundColor: C.background }]}>
            <Stack.Screen options={{
                title: 'Customer Search',
                headerStyle: { backgroundColor: C.card },
                headerTitleStyle: { color: C.text.primary },
                headerShadowVisible: false,
            }} />

            <View style={[styles.searchBar, { backgroundColor: C.card, borderColor: C.border }]}>
                <Ionicons name="search" size={18} color={C.text.light} />
                <TextInput
                    style={[styles.searchInput, { color: C.text.primary }]}
                    placeholder="Search by name, phone, or username..."
                    placeholderTextColor={C.text.light}
                    value={query}
                    onChangeText={onChangeText}
                    autoFocus
                    autoCapitalize="none"
                    autoCorrect={false}
                />
                {query.length > 0 && (
                    <TouchableOpacity onPress={() => { setQuery(''); setResults([]); setSearched(false); }}>
                        <Ionicons name="close-circle" size={18} color={C.text.light} />
                    </TouchableOpacity>
                )}
            </View>

            {loading ? (
                <ActivityIndicator size="large" color={C.primary} style={{ marginTop: 40 }} />
            ) : (
                <FlatList
                    data={results}
                    keyExtractor={item => (item.username || '').toString()}
                    contentContainerStyle={styles.listContent}
                    renderItem={({ item }) => (
                        <TouchableOpacity
                            style={[styles.customerCard, { backgroundColor: C.card, borderColor: C.border }]}
                            onPress={() => router.push({ pathname: '/customer/[id]' as any, params: { id: item.username } })}
                        >
                            <View style={[styles.avatar, { backgroundColor: C.primary + '15' }]}>
                                <Text style={[styles.avatarText, { color: C.primary }]}>
                                    {item.first_name?.charAt(0)?.toUpperCase() || '?'}
                                </Text>
                            </View>
                            <View style={styles.cardContent}>
                                <Text style={[styles.customerName, { color: C.text.primary }]}>
                                    {formatName(item.first_name, item.last_name)}
                                </Text>
                                <Text style={[styles.customerPhone, { color: C.text.secondary }]}>
                                    {item.phone}
                                </Text>
                                {item.railwire_address && (
                                    <Text style={[styles.customerAddress, { color: C.text.light }]} numberOfLines={1}>
                                        {item.railwire_address}
                                    </Text>
                                )}
                            </View>
                            <Ionicons name="chevron-forward" size={18} color={C.text.light} />
                        </TouchableOpacity>
                    )}
                    ListEmptyComponent={searched && !loading ? (
                        <View style={styles.emptyContainer}>
                            <Ionicons name="people-outline" size={48} color={C.text.light} />
                            <Text style={[styles.emptyTitle, { color: C.text.primary }]}>No Results</Text>
                            <Text style={[styles.emptySubtitle, { color: C.text.secondary }]}>
                                Try a different search term
                            </Text>
                        </View>
                    ) : null}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        margin: SPACING.md,
        paddingHorizontal: SPACING.md,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        gap: 8,
    },
    searchInput: { flex: 1, height: 44, fontSize: 15 },
    listContent: { paddingHorizontal: SPACING.md },
    customerCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: SPACING.md,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        marginBottom: SPACING.sm,
    },
    avatar: {
        width: 40, height: 40, borderRadius: 20,
        justifyContent: 'center', alignItems: 'center', marginRight: SPACING.md,
    },
    avatarText: { fontSize: 16, fontWeight: '700' },
    cardContent: { flex: 1 },
    customerName: { fontSize: 15, fontWeight: '700' },
    customerPhone: { fontSize: 13, marginTop: 2 },
    customerAddress: { fontSize: 12, marginTop: 2 },
    emptyContainer: { alignItems: 'center', paddingTop: 60 },
    emptyTitle: { fontSize: 18, fontWeight: '700', marginTop: SPACING.md },
    emptySubtitle: { fontSize: 13, marginTop: SPACING.xs },
});
