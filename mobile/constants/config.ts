import { Platform } from 'react-native';

// ------------------------------------------------------------------
// CONFIGURATION CENTER
// ------------------------------------------------------------------

type ApiEnv = 'localhost' | 'lan' | 'production';
const DEFAULT_ENV: ApiEnv = 'localhost';

// Select API target using Expo public env vars:
// EXPO_PUBLIC_API_ENV=localhost|lan|production
// EXPO_PUBLIC_LAN_API_URL=http://192.168.x.x:8000
// EXPO_PUBLIC_PRODUCTION_API_URL=https://api.example.com
const rawEnv = (process.env.EXPO_PUBLIC_API_ENV || DEFAULT_ENV).toLowerCase();
const ENV: ApiEnv =
    rawEnv === 'lan' || rawEnv === 'production' || rawEnv === 'localhost'
        ? rawEnv
        : DEFAULT_ENV;

// Hardcoded fallbacks are dev-only conveniences. Production / LAN values must
// come from EXPO_PUBLIC_* so a server-IP change never requires a code change.
function _resolveApiUrl(env: ApiEnv): string {
    if (env === 'localhost') {
        return Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';
    }
    if (env === 'lan') {
        const url = process.env.EXPO_PUBLIC_LAN_API_URL;
        if (!url) {
            const msg =
                '[Config] EXPO_PUBLIC_API_ENV=lan but EXPO_PUBLIC_LAN_API_URL is unset. ' +
                'Set it in app.json extra.eas or your .env to your LAN backend (e.g. http://192.168.x.x:8000).';
            if (__DEV__) console.error(msg);
            throw new Error(msg);
        }
        return url;
    }
    // production
    const url = process.env.EXPO_PUBLIC_PRODUCTION_API_URL;
    if (!url) {
        const msg =
            '[Config] EXPO_PUBLIC_API_ENV=production but EXPO_PUBLIC_PRODUCTION_API_URL is unset. ' +
            'Set it (Tailscale or domain) before building a production APK — refusing to start with stale defaults.';
        if (__DEV__) console.error(msg);
        throw new Error(msg);
    }
    return url;
}

export const CONFIG = {
    API_BASE_URL: _resolveApiUrl(ENV),
    IS_DEBUG: __DEV__,
    APP_VERSION: '4.2.0',
};

if (__DEV__) {
    console.log('[Config] API ENV:', ENV, '| URL:', CONFIG.API_BASE_URL);
}
