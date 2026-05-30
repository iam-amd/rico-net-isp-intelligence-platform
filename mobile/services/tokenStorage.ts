import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const TOKEN_KEY = 'token';

const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
    keychainService: 'rico_net_auth',
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const tokenStorage = {
    async get(): Promise<string | null> {
        try {
            if (Platform.OS === 'web') {
                return typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
            }
            return await SecureStore.getItemAsync(TOKEN_KEY, SECURE_STORE_OPTIONS);
        } catch (error) {
            console.warn('[TokenStorage] Error reading token:', error);
            return null;
        }
    },

    async set(token: string): Promise<void> {
        if (Platform.OS === 'web') {
            localStorage.setItem(TOKEN_KEY, token);
            return;
        }
        await SecureStore.setItemAsync(TOKEN_KEY, token, SECURE_STORE_OPTIONS);
    },

    async remove(): Promise<void> {
        try {
            if (Platform.OS === 'web') {
                if (typeof localStorage !== 'undefined') localStorage.removeItem(TOKEN_KEY);
                return;
            }
            await SecureStore.deleteItemAsync(TOKEN_KEY, SECURE_STORE_OPTIONS);
        } catch (error) {
            console.warn('[TokenStorage] Error deleting token:', error);
        }
    },
};
