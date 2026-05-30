import React, { useState } from 'react';
import {
    StyleSheet, View, Text, TextInput, TouchableOpacity,
    ActivityIndicator, StatusBar, KeyboardAvoidingView, Platform, Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { SPACING, RADIUS } from '../constants/theme';
import { haptic } from '../utils/haptics';
import { ApiError } from '../types';
import { CONFIG } from '../constants/config';

export default function LoginScreen() {
    const { signIn } = useAuth();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleLogin = async () => {
        if (!username.trim() || !password.trim()) {
            setError('Please enter both username and password.');
            return;
        }

        setLoading(true);
        setError('');

        try {
            const formData = new URLSearchParams();
            formData.append('username', username.trim());
            formData.append('password', password);

            const response = await api.post('/auth/login', formData.toString(), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            });

            await signIn(response.data.access_token);
            haptic.success();
        } catch (e: any) {
            let msg: string;
            if (e instanceof ApiError) {
                if (e.isNetworkError) {
                    msg = `Cannot reach server at ${CONFIG.API_BASE_URL}\nMake sure the backend is running (port 8000).`;
                } else if (e.statusCode === 401) {
                    msg = 'Wrong username or password.';
                } else if (e.statusCode >= 500) {
                    msg = `Server error (HTTP ${e.statusCode}). Contact admin.`;
                } else if (e.statusCode === 0) {
                    msg = `Connection timed out. Server at ${CONFIG.API_BASE_URL} did not respond.`;
                } else {
                    msg = e.message || 'Login failed.';
                }
            } else {
                msg = e?.message || 'Login failed. Please check your credentials.';
            }
            setError(msg);
            haptic.error();
        } finally {
            setLoading(false);
        }
    };

    return (
        <LinearGradient colors={['#09090b', '#18181b']} style={styles.container}>
            <StatusBar barStyle="light-content" />
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={styles.keyboardView}
            >
                {/* Branding */}
                <View style={styles.brandContainer}>
                    <View style={styles.logoCircle}>
                        <Ionicons name="wifi" size={34} color="#ea580c" />
                    </View>
                    <Text style={styles.brandTitle}>RICO NET FIELD</Text>
                    <Text style={styles.brandSubtitle}>Technician mobile console</Text>
                </View>

                {/* Login Card */}
                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Sign In</Text>
                    <Text style={styles.cardSubtitle}>Enter your technician credentials</Text>

                    {error ? (
                        <View style={[
                            styles.errorBanner,
                            error.includes('Cannot reach') || error.includes('timed out')
                                ? styles.errorBannerNetwork
                                : null,
                        ]}>
                            <Ionicons
                                name={error.includes('Cannot reach') || error.includes('timed out') ? 'wifi-outline' : 'alert-circle'}
                                size={16}
                                color={error.includes('Cannot reach') || error.includes('timed out') ? '#B45309' : '#DC2626'}
                            />
                            <Text style={[
                                styles.errorText,
                                error.includes('Cannot reach') || error.includes('timed out')
                                    ? styles.errorTextNetwork
                                    : null,
                            ]}>{error}</Text>
                        </View>
                    ) : null}

                    {/* Username */}
                    <View style={styles.inputContainer}>
                        <Ionicons name="person-outline" size={18} color="#94A3B8" style={styles.inputIcon} />
                        <TextInput
                            style={styles.input}
                            placeholder="Username"
                            placeholderTextColor="#94A3B8"
                            autoCapitalize="none"
                            autoCorrect={false}
                            value={username}
                            onChangeText={(t) => { setUsername(t); setError(''); }}
                            accessibilityLabel="Username"
                            accessibilityHint="Enter your technician username"
                        />
                    </View>

                    {/* Password */}
                    <View style={styles.inputContainer}>
                        <Ionicons name="lock-closed-outline" size={18} color="#94A3B8" style={styles.inputIcon} />
                        <TextInput
                            style={[styles.input, { flex: 1 }]}
                            placeholder="Password"
                            placeholderTextColor="#94A3B8"
                            secureTextEntry={!showPassword}
                            value={password}
                            onChangeText={(t) => { setPassword(t); setError(''); }}
                            onSubmitEditing={handleLogin}
                            accessibilityLabel="Password"
                            accessibilityHint="Enter your password"
                        />
                        <TouchableOpacity
                            onPress={() => setShowPassword(!showPassword)}
                            style={styles.eyeBtn}
                            accessibilityRole="button"
                            accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                        >
                            <Ionicons
                                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                                size={20}
                                color="#94A3B8"
                            />
                        </TouchableOpacity>
                    </View>

                    {/* Login Button */}
                    <TouchableOpacity
                        onPress={handleLogin}
                        disabled={loading}
                        activeOpacity={0.85}
                        style={styles.loginBtnWrapper}
                        accessibilityRole="button"
                        accessibilityLabel="Sign in"
                    >
                        <LinearGradient
                            colors={['#ea580c', '#ff7a1a']}
                            style={styles.loginBtn}
                        >
                            {loading ? (
                                <ActivityIndicator color="#FFFFFF" />
                            ) : (
                                <Text style={styles.loginBtnText}>Sign In</Text>
                            )}
                        </LinearGradient>
                    </TouchableOpacity>
                </View>

                {/* Footer */}
                <Text style={styles.footer}>Rico Net technician app v4.2.0</Text>
            </KeyboardAvoidingView>
        </LinearGradient>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    keyboardView: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: SPACING.lg,
    },
    brandContainer: {
        alignItems: 'center',
        marginBottom: 40,
    },
    logoCircle: {
        width: 72,
        height: 72,
        borderRadius: 36,
        backgroundColor: '#fff8f6',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: SPACING.md,
        borderWidth: 2,
        borderColor: '#ffffff',
    },
    brandTitle: {
        fontSize: 26,
        fontWeight: '900',
        color: '#ea580c',
        letterSpacing: 0,
    },
    brandSubtitle: {
        fontSize: 14,
        color: '#d4d4d8',
        fontWeight: '700',
        marginTop: 4,
        letterSpacing: 0,
    },
    card: {
        backgroundColor: '#fff8f6',
        borderRadius: 8,
        padding: 28,
        width: '100%',
        maxWidth: 400,
        borderWidth: 2,
        borderColor: '#271812',
    },
    cardTitle: {
        fontSize: 22,
        fontWeight: '800',
        color: '#271812',
        marginBottom: 4,
    },
    cardSubtitle: {
        fontSize: 13,
        color: '#5b4137',
        marginBottom: SPACING.lg,
    },
    errorBanner: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        backgroundColor: '#FEF2F2',
        borderWidth: 1,
        borderColor: '#FEE2E2',
        borderRadius: RADIUS.sm,
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginBottom: SPACING.md,
    },
    errorBannerNetwork: {
        backgroundColor: '#FFFBEB',
        borderColor: '#FDE68A',
    },
    errorText: {
        color: '#DC2626',
        fontSize: 13,
        fontWeight: '500',
        marginLeft: 8,
        flex: 1,
    },
    errorTextNetwork: {
        color: '#92400E',
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff1ec',
        borderRadius: RADIUS.sm,
        borderWidth: 2,
        borderColor: '#271812',
        paddingHorizontal: 14,
        marginBottom: 14,
    },
    inputIcon: {
        marginRight: 10,
    },
    input: {
        flex: 1,
        height: 52,
        fontSize: 15,
        color: '#271812',
    },
    eyeBtn: {
        padding: 8,
    },
    loginBtnWrapper: {
        borderRadius: RADIUS.md,
        overflow: 'hidden',
        marginTop: 8,
        borderWidth: 2,
        borderColor: '#271812',
    },
    loginBtn: {
        height: 52,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: RADIUS.md,
    },
    loginBtnText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '800',
        letterSpacing: 0.5,
    },
    footer: {
        color: '#a1a1aa',
        fontSize: 12,
        marginTop: 32,
    },
});
