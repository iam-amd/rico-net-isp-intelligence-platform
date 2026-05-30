import React, { useEffect, useState } from 'react';
import {
    View, Text, StyleSheet,
    ActivityIndicator, SectionList,
} from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { InventoryService } from '../services/inventoryService';
import { InventoryItem } from '../types';
import { useSettings } from '../context/SettingsContext';
import { COLORS, DARK_COLORS, SPACING, RADIUS } from '../constants/theme';

interface InventorySection {
    title: string;
    data: InventoryItem[];
}

export default function InventoryScreen() {
    const { isDarkMode } = useSettings();
    const C = isDarkMode ? DARK_COLORS : COLORS;
    const [sections, setSections] = useState<InventorySection[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadInventory();
    }, []);

    const loadInventory = async () => {
        const items = await InventoryService.getAll();
        const categories = InventoryService.getCategories(items);
        const grouped = categories.map(cat => ({
            title: cat,
            data: items.filter(i => i.category === cat),
        }));
        setSections(grouped);
        setLoading(false);
    };

    const getStockColor = (qty: number) => {
        if (qty <= 0) return COLORS.state.danger;
        if (qty < 5) return COLORS.state.warning;
        return COLORS.state.success;
    };

    if (loading) {
        return (
            <View style={[styles.center, { backgroundColor: C.background }]}>
                <ActivityIndicator size="large" color={C.primary} />
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: C.background }]}>
            <Stack.Screen options={{
                title: 'Inventory',
                headerStyle: { backgroundColor: C.card },
                headerTitleStyle: { color: C.text.primary },
                headerShadowVisible: false,
            }} />

            <SectionList
                sections={sections}
                keyExtractor={item => item.id.toString()}
                contentContainerStyle={styles.listContent}
                renderSectionHeader={({ section: { title, data } }) => (
                    <View style={styles.sectionHeader}>
                        <Text style={[styles.sectionTitle, { color: C.text.light }]}>
                            {title.toUpperCase()}
                        </Text>
                        <Text style={[styles.sectionCount, { color: C.text.light }]}>
                            {data.length} items
                        </Text>
                    </View>
                )}
                renderItem={({ item }) => (
                    <View style={[styles.itemCard, { backgroundColor: C.card, borderColor: C.border }]}>
                        <View style={styles.itemInfo}>
                            <Text style={[styles.itemName, { color: C.text.primary }]}>{item.name}</Text>
                            {item.last_updated && (
                                <Text style={[styles.itemUpdated, { color: C.text.light }]}>
                                    Updated: {new Date(item.last_updated).toLocaleDateString('en-IN')}
                                </Text>
                            )}
                        </View>
                        <View style={styles.stockInfo}>
                            <Text style={[styles.stockQty, { color: getStockColor(item.quantity) }]}>
                                {item.quantity}
                            </Text>
                            <Text style={[styles.stockUnit, { color: C.text.light }]}>{item.unit}</Text>
                        </View>
                    </View>
                )}
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <Ionicons name="cube-outline" size={48} color={C.text.light} />
                        <Text style={[styles.emptyTitle, { color: C.text.primary }]}>No Inventory</Text>
                        <Text style={[styles.emptySubtitle, { color: C.text.secondary }]}>
                            Inventory items will appear here
                        </Text>
                    </View>
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    listContent: { padding: SPACING.md },
    sectionHeader: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingVertical: SPACING.sm, marginTop: SPACING.sm,
    },
    sectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 1 },
    sectionCount: { fontSize: 11 },
    itemCard: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, marginBottom: SPACING.sm,
    },
    itemInfo: { flex: 1 },
    itemName: { fontSize: 15, fontWeight: '600' },
    itemUpdated: { fontSize: 11, marginTop: 2 },
    stockInfo: { alignItems: 'center', marginLeft: SPACING.md },
    stockQty: { fontSize: 20, fontWeight: '800' },
    stockUnit: { fontSize: 10, fontWeight: '600', marginTop: 1 },
    emptyContainer: { alignItems: 'center', paddingTop: 60 },
    emptyTitle: { fontSize: 18, fontWeight: '700', marginTop: SPACING.md },
    emptySubtitle: { fontSize: 13, marginTop: SPACING.xs },
});
