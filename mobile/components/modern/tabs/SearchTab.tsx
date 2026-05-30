import React, { useState, useCallback } from 'react';
import {
    View, Text, TextInput, FlatList, TouchableOpacity,
    StyleSheet, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CustomerService } from '../../../services/customerService';
import { Customer } from '../../../types';
import { formatName } from '../../../utils/format';

const BG     = '#fff8f6';
const BDR    = '#271812';
const ORANGE = '#ff5a00';
const TEXT   = '#271812';
const MUTED  = '#5b4137';
const CREAM  = '#fadcd2';
const INPUT_BG = '#fff1ec';

export default function SearchTab() {
    const router = useRouter();
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
        try {
            const data = await CustomerService.search(text.trim());
            setResults(data);
        } catch {
            setResults([]);
        } finally {
            setLoading(false);
        }
    }, []);

    const onChangeText = (text: string) => {
        setQuery(text);
        if (timer) clearTimeout(timer);
        setTimer(setTimeout(() => doSearch(text), 400));
    };

    return (
        <View style={styles.root}>
            {/* Header */}
            <View style={styles.header}>
                <Text style={styles.headerLabel}>SYSTEM_STATUS: ONLINE</Text>
                <Text style={styles.headerTitle}>CUSTOMER SEARCH</Text>
            </View>

            {/* Search bar */}
            <View style={styles.searchRow}>
                <View style={styles.searchBar}>
                    <Ionicons name="search-outline" size={18} color={MUTED} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="ENTER_NAME_OR_PHONE..."
                        placeholderTextColor={MUTED}
                        value={query}
                        onChangeText={onChangeText}
                        autoCorrect={false}
                        autoCapitalize="none"
                        returnKeyType="search"
                    />
                    {query.length > 0 && (
                        <TouchableOpacity onPress={() => { setQuery(''); setResults([]); setSearched(false); }}>
                            <Ionicons name="close-outline" size={18} color={MUTED} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            {/* Results */}
            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator size="large" color={ORANGE} />
                </View>
            ) : (
                <FlatList
                    data={results}
                    keyExtractor={item => item.username}
                    contentContainerStyle={styles.listPad}
                    renderItem={({ item }) => (
                        <TouchableOpacity
                            style={styles.resultCard}
                            onPress={() => router.push({ pathname: '/customer/[id]' as any, params: { id: item.username } })}
                            activeOpacity={0.85}
                        >
                            <View style={styles.resultLeft}>
                                <View style={styles.avatarBox}>
                                    <Text style={styles.avatarText}>
                                        {(item.first_name || item.username || '?')[0].toUpperCase()}
                                    </Text>
                                </View>
                                <View style={styles.resultInfo}>
                                    <Text style={styles.resultName}>{formatName(item.first_name, item.last_name)}</Text>
                                    <Text style={styles.resultSub}>{item.username}</Text>
                                    {item.phone && (
                                        <Text style={styles.resultPhone}>{item.phone}</Text>
                                    )}
                                </View>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color={MUTED} />
                        </TouchableOpacity>
                    )}
                    ListEmptyComponent={
                        searched ? (
                            <View style={styles.emptyBox}>
                                <Ionicons name="person-outline" size={48} color={MUTED} />
                                <Text style={styles.emptyTitle}>NO RESULTS</Text>
                                <Text style={styles.emptySub}>Try a different name or phone number</Text>
                            </View>
                        ) : (
                            <View style={styles.emptyBox}>
                                <View style={styles.searchHintIcon}>
                                    <Ionicons name="person-add-outline" size={40} color={TEXT} />
                                </View>
                                <Text style={styles.emptyTitle}>SEARCH CUSTOMERS</Text>
                                <Text style={styles.emptySub}>Enter at least 2 characters to search</Text>
                            </View>
                        )
                    }
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: BG },
    header: {
        backgroundColor: CREAM, borderBottomWidth: 2, borderBottomColor: BDR,
        paddingHorizontal: 16, paddingVertical: 12,
    },
    headerLabel: { color: MUTED, fontSize: 9, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },
    headerTitle: { color: TEXT, fontSize: 24, fontWeight: '900', textTransform: 'uppercase', letterSpacing: -0.3 },
    searchRow: { padding: 12, borderBottomWidth: 2, borderBottomColor: BDR, backgroundColor: BG },
    searchBar: {
        backgroundColor: INPUT_BG, borderWidth: 2, borderColor: BDR,
        flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 10,
    },
    searchInput: { flex: 1, color: TEXT, fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
    listPad: { padding: 12, gap: 8 },
    resultCard: {
        backgroundColor: BG, borderWidth: 2, borderColor: BDR,
        padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        shadowColor: BDR, shadowOffset: { width: 3, height: 3 }, shadowOpacity: 1, shadowRadius: 0,
        marginBottom: 8,
    },
    resultLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
    avatarBox: {
        width: 40, height: 40, backgroundColor: ORANGE, borderWidth: 2, borderColor: BDR,
        alignItems: 'center', justifyContent: 'center',
    },
    avatarText: { color: '#ffffff', fontSize: 16, fontWeight: '900' },
    resultInfo: { flex: 1, gap: 1 },
    resultName: { color: TEXT, fontSize: 14, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.3 },
    resultSub: { color: MUTED, fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
    resultPhone: { color: TEXT, fontSize: 12, fontWeight: '700', letterSpacing: 0.3, marginTop: 2 },
    emptyBox: { alignItems: 'center', paddingTop: 60, gap: 10 },
    searchHintIcon: {
        width: 72, height: 72, borderWidth: 2, borderColor: BDR, backgroundColor: CREAM,
        alignItems: 'center', justifyContent: 'center', marginBottom: 6,
    },
    emptyTitle: { color: TEXT, fontSize: 16, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' },
    emptySub: { color: MUTED, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center', paddingHorizontal: 30 },
});
