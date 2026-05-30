import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const BIOMETRIC_ENABLED_KEY = 'biometric_auth_enabled';

export const BiometricService = {
    isAvailable: async (): Promise<boolean> => {
        if (Platform.OS === 'web') return false;
        try {
            const compatible = await LocalAuthentication.hasHardwareAsync();
            const enrolled = await LocalAuthentication.isEnrolledAsync();
            return compatible && enrolled;
        } catch {
            return false;
        }
    },

    getSupportedTypes: async (): Promise<string[]> => {
        if (Platform.OS === 'web') return [];
        try {
            const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
            return types.map(t => {
                switch (t) {
                    case LocalAuthentication.AuthenticationType.FINGERPRINT: return 'Fingerprint';
                    case LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION: return 'Face ID';
                    case LocalAuthentication.AuthenticationType.IRIS: return 'Iris';
                    default: return 'Biometric';
                }
            });
        } catch {
            return [];
        }
    },

    authenticate: async (promptMessage?: string): Promise<boolean> => {
        if (Platform.OS === 'web') return true;
        try {
            const result = await LocalAuthentication.authenticateAsync({
                promptMessage: promptMessage || 'Verify your identity',
                cancelLabel: 'Cancel',
                disableDeviceFallback: false,
                fallbackLabel: 'Use Passcode',
            });
            return result.success;
        } catch {
            return false;
        }
    },

    isEnabled: async (): Promise<boolean> => {
        try {
            const value = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);
            return value === 'true';
        } catch {
            return false;
        }
    },

    setEnabled: async (enabled: boolean): Promise<void> => {
        await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, enabled ? 'true' : 'false');
    },
};
