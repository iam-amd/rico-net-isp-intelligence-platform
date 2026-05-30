import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export const haptic = {
    light: () => {
        if (Platform.OS === 'web') return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    medium: () => {
        if (Platform.OS === 'web') return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    },
    heavy: () => {
        if (Platform.OS === 'web') return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    },
    success: () => {
        if (Platform.OS === 'web') return;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    error: () => {
        if (Platform.OS === 'web') return;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
    selection: () => {
        if (Platform.OS === 'web') return;
        Haptics.selectionAsync();
    },
};
