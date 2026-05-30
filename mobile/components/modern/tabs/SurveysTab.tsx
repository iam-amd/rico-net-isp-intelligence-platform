import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import ModernSurveyHub from '../SurveyHub';

export default function SurveysTab() {
    const router = useRouter();

    return (
        <View style={styles.root}>
            <ModernSurveyHub
                hideHeader
                onSelectModule={(m) => {
                    if (m === 'pg') {
                        router.push('/pg' as any);
                    } else {
                        // Navigate to survey tab with params so it starts in normal
                        // (list) mode immediately instead of showing the hub again.
                        // fromShell=1 tells survey.tsx to call router.back() on "Back".
                        router.push({
                            pathname: '/(tabs)/survey' as any,
                            params: { startNormal: '1', fromShell: '1' },
                        });
                    }
                }}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
});
