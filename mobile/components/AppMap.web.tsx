import React from 'react';
import { StyleSheet, View, Text } from 'react-native';

import { Ticket } from '../types';
import { SurveyCustomerRow } from '../services/collectionService';

interface AppMapProps {
    tickets?: Ticket[];
    gpsCustomers?: SurveyCustomerRow[];
    surveyMode?: boolean;
    surveyLat?: number;
    surveyLng?: number;
}

export default function AppMap(_props: AppMapProps) {
    return (
        <View style={styles.container}>
            <Text style={styles.text}>Map View is optimized for Mobile App.</Text>
            <Text style={styles.subtext}>Switch to List View on Web.</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#F1F5F9'
    },
    text: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#64748B'
    },
    subtext: {
        fontSize: 14,
        color: '#94A3B8',
        marginTop: 8
    }
});
