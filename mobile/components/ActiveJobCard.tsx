import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Dimensions, Linking } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { FontAwesome5 } from '@expo/vector-icons';

interface Ticket {
    id: number;
    ticket_number?: string;
    created_at?: string;
    customer_name: string;
    address: string;
    description?: string;
    [key: string]: any;
}

interface ActiveJobCardProps {
    ticket: Ticket;
    onViewDetails: () => void;
    onCall?: () => void;
    onNavigate?: () => void;
}

const { width } = Dimensions.get('window');

export default function ActiveJobCard({ ticket, onViewDetails, onCall, onNavigate }: ActiveJobCardProps) {
    // Mock distance
    const distance = "1.2 km";
    const timeAgo = "10 mins ago";

    return (
        <View style={styles.cardContainer}>
            <View style={styles.headerRow}>
                <Text style={styles.ticketId}>Ticket #{ticket.ticket_number || `TKT-${ticket.id}`}</Text>
                <Text style={styles.timeAgo}>{timeAgo}</Text>
            </View>

            <Text style={styles.customerLabel}>Customer: <Text style={styles.customerValue}>{ticket.customer?.first_name} {ticket.customer?.last_name || ''}</Text></Text>
            <Text style={styles.address}>{ticket.customer?.railwire_address || ticket.customer?.rico_address || 'No Address'}</Text>
            <Text style={styles.distance}>Distance: {distance}</Text>

            <View style={styles.actionsRow}>
                <TouchableOpacity style={styles.iconBtn} onPress={onCall}>
                    <LinearGradient
                        colors={['#60A5FA', '#3B82F6']}
                        style={styles.iconGradient}
                    >
                        <FontAwesome5 name="phone-alt" size={18} color="#FFF" />
                    </LinearGradient>
                    <Text style={styles.iconText}>Call</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.iconBtn} onPress={onNavigate}>
                    <LinearGradient
                        colors={['#60A5FA', '#3B82F6']}
                        style={styles.iconGradient}
                    >
                        <FontAwesome5 name="map" size={18} color="#FFF" />
                    </LinearGradient>
                    <Text style={styles.iconText}>Navigate</Text>
                </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={onViewDetails} activeOpacity={0.8}>
                <LinearGradient
                    colors={['#60A5FA', '#3B82F6']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.button}
                >
                    <Text style={styles.buttonText}>View Details</Text>
                </LinearGradient>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    cardContainer: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 20,
        marginBottom: 20,
        shadowColor: '#94A3B8',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 4,
        width: width - 40,
        alignSelf: 'center',
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    ticketId: {
        fontSize: 13,
        color: '#94A3B8',
        fontWeight: '600',
    },
    timeAgo: {
        fontSize: 13,
        color: '#94A3B8',
    },
    customerLabel: {
        fontSize: 18,
        color: '#0F172A',
        fontWeight: '700',
        marginBottom: 4,
    },
    customerValue: {
        // inherits
    },
    address: {
        fontSize: 14,
        color: '#334155',
        marginBottom: 2,
    },
    distance: {
        fontSize: 14,
        color: '#334155',
        marginBottom: 20,
    },
    actionsRow: {
        flexDirection: 'row',
        justifyContent: 'flex-start',
        gap: 30, // gap not always supported in older RN, but OK in newer Expo
        marginBottom: 25,
    },
    iconBtn: {
        alignItems: 'center',
        marginRight: 20,
    },
    iconGradient: {
        width: 50,
        height: 50,
        borderRadius: 25,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 8,
        shadowColor: '#3B82F6',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
        elevation: 4,
    },
    iconText: {
        fontSize: 12,
        color: '#0F172A',
        fontWeight: '600',
    },
    button: {
        paddingVertical: 14,
        borderRadius: 30,
        alignItems: 'center',
        shadowColor: '#3B82F6',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    buttonText: {
        color: '#FFFFFF',
        fontWeight: '700',
        fontSize: 16,
    },
});
