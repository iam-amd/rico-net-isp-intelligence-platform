import React, { createContext, useState, useEffect, useContext } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { jwtDecode } from 'jwt-decode';
import api from '../services/api';
import { TechnicianUser } from '../types';
import { BiometricService } from '../services/biometricService';
import { startLocationTracking, stopLocationTracking } from '../services/locationService';
import { tokenStorage } from '../services/tokenStorage';

// ------------------------------------------------------------------
// AUTH CONTEXT — Production-grade authentication provider
// ------------------------------------------------------------------

interface AuthContextProps {
    user: TechnicianUser | null;
    isLoading: boolean;
    biometricLocked: boolean;
    signIn: (token: string) => Promise<void>;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextProps>({} as AuthContextProps);

export const useAuth = () => useContext(AuthContext);

// ------------------------------------------------------------------
// JWT expiry check
// ------------------------------------------------------------------

const isTokenExpired = (token: string): boolean => {
    try {
        const decoded = jwtDecode<{ exp?: number }>(token);
        if (!decoded.exp) return false;
        return decoded.exp * 1000 < Date.now();
    } catch {
        return true; // If we can't decode, treat as expired
    }
};

// ------------------------------------------------------------------
// Provider
// ------------------------------------------------------------------

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [user, setUser] = useState<TechnicianUser | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [biometricLocked, setBiometricLocked] = useState(false);

    useEffect(() => {
        checkLogin();
    }, []);

    // Biometric lock on app resume
    useEffect(() => {
        let appState = AppState.currentState;
        const handleAppStateChange = async (nextState: AppStateStatus) => {
            if (appState.match(/inactive|background/) && nextState === 'active' && user) {
                const enabled = await BiometricService.isEnabled();
                if (enabled) {
                    setBiometricLocked(true);
                    const success = await BiometricService.authenticate('Unlock Rico Net');
                    setBiometricLocked(!success);
                }
            }
            appState = nextState;
        };
        const subscription = AppState.addEventListener('change', handleAppStateChange);
        return () => subscription.remove();
    }, [user]);

    const checkLogin = async () => {
        try {
            const token = await tokenStorage.get();
            if (token) {
                if (isTokenExpired(token)) {
                    console.log('[Auth] Token expired — signing out');
                    await tokenStorage.remove();
                    setUser(null);
                    setIsLoading(false);
                    return;
                }
                const res = await api.get('/auth/me');
                const profile = res.data as { id: number; username: string; full_name: string; role: string };
                setUser({
                    token,
                    id: profile.id,
                    username: profile.username,
                    full_name: profile.full_name,
                    role: profile.role as TechnicianUser['role'],
                });
                // Resume GPS tracking if already logged in
                void startLocationTracking();
            }
        } catch (e) {
            console.log('[Auth] Login check failed / Token expired — auto signing out', e);
            await tokenStorage.remove();
            setUser(null);
        } finally {
            setIsLoading(false);
        }
    };

    const signIn = async (token: string) => {
        await tokenStorage.set(token);
        try {
            const res = await api.get('/auth/me');
            const profile = res.data as { id: number; username: string; full_name: string; role: string };
            setUser({
                token,
                id: profile.id,
                username: profile.username,
                full_name: profile.full_name,
                role: profile.role as TechnicianUser['role'],
            });
        } catch (e) {
            console.log('[Auth] Failed to load user profile after sign in', e);
            setUser({
                token,
                id: 0,
                username: 'unknown',
                full_name: 'Technician',
                role: 'Field Tech',
            });
        }
        // Start GPS tracking once authenticated
        void startLocationTracking();
    };

    const signOut = async () => {
        stopLocationTracking();
        await tokenStorage.remove();
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, isLoading, biometricLocked, signIn, signOut }}>
            {children}
        </AuthContext.Provider>
    );
};
