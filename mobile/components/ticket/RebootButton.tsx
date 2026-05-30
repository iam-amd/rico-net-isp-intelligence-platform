import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FieldIntelService } from '../../services/fieldIntelService';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';

interface RebootButtonProps {
    customerUsername: string;
    userRole: string;
}

export default function RebootButton({ customerUsername, userRole }: RebootButtonProps) {
    const [loading, setLoading] = useState(false);

    const canReboot = userRole === 'Admin' || userRole === 'Senior Tech';
    if (!canReboot) return null;

    const handleReboot = () => {
        Alert.alert(
            'Reboot ONU',
            'This will remotely restart the customer\'s ONU device. The connection will drop for about 2 minutes. Continue?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Reboot',
                    style: 'destructive',
                    onPress: async () => {
                        setLoading(true);
                        try {
                            const result = await FieldIntelService.rebootONU(customerUsername);
                            if (result.status === 'success') {
                                Alert.alert('Reboot Sent', result.message);
                            } else {
                                Alert.alert('Reboot Failed', result.message);
                            }
                        } catch (e: any) {
                            Alert.alert('Error', e?.message || 'Failed to send reboot command');
                        } finally {
                            setLoading(false);
                        }
                    },
                },
            ]
        );
    };

    return (
        <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={handleReboot}
            disabled={loading}
            activeOpacity={0.7}
        >
            {loading ? (
                <ActivityIndicator size="small" color="#EF4444" />
            ) : (
                <Ionicons name="reload" size={16} color="#EF4444" />
            )}
            <Text style={styles.btnText}>{loading ? 'Rebooting...' : 'Reboot ONU'}</Text>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    btn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: RADIUS.sm,
        borderWidth: 1,
        borderColor: '#FCA5A5',
        backgroundColor: '#FEF2F2',
        gap: 6,
        marginTop: SPACING.xs,
    },
    btnDisabled: { opacity: 0.6 },
    btnText: { fontSize: 13, fontWeight: '600', color: '#EF4444' },
});
