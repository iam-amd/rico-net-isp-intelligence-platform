import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS } from '../constants/theme';
import { crashReporting } from '../services/crashReporting';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

/**
 * Production-grade Error Boundary.
 * Catches unhandled React render errors and shows a recoverable fallback UI.
 * 
 * Usage: Wrap your root layout or any critical section.
 *   <ErrorBoundary>
 *     <App />
 *   </ErrorBoundary>
 */
export default class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        this.setState({ errorInfo });
        crashReporting.captureException(error, { componentStack: errorInfo?.componentStack });
        console.error('[ErrorBoundary] Uncaught error:', error);
        console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: null, errorInfo: null });
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <View style={styles.container}>
                    <View style={styles.card}>
                        <View style={styles.iconContainer}>
                            <Ionicons name="warning-outline" size={48} color={COLORS.state.danger} />
                        </View>

                        <Text style={styles.title}>Something went wrong</Text>
                        <Text style={styles.subtitle}>
                            The app encountered an unexpected error. This has been logged for review.
                        </Text>

                        {__DEV__ && this.state.error && (
                            <ScrollView style={styles.errorBox} nestedScrollEnabled>
                                <Text style={styles.errorText}>
                                    {this.state.error.toString()}
                                </Text>
                                {this.state.errorInfo?.componentStack && (
                                    <Text style={styles.stackText}>
                                        {this.state.errorInfo.componentStack.substring(0, 500)}
                                    </Text>
                                )}
                            </ScrollView>
                        )}

                        <TouchableOpacity style={styles.retryButton} onPress={this.handleRetry} activeOpacity={0.8}>
                            <Ionicons name="refresh" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
                            <Text style={styles.retryText}>Try Again</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            );
        }

        return this.props.children;
    }
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: COLORS.background,
        justifyContent: 'center',
        alignItems: 'center',
        padding: SPACING.lg,
    },
    card: {
        backgroundColor: COLORS.card,
        borderRadius: RADIUS.lg,
        padding: SPACING.xl,
        alignItems: 'center',
        width: '100%',
        maxWidth: 400,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.1,
        shadowRadius: 24,
        elevation: 8,
    },
    iconContainer: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: '#FEF2F2',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: SPACING.lg,
    },
    title: {
        fontSize: 20,
        fontWeight: '800',
        color: COLORS.text.primary,
        marginBottom: SPACING.sm,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 14,
        color: COLORS.text.secondary,
        textAlign: 'center',
        lineHeight: 20,
        marginBottom: SPACING.lg,
    },
    errorBox: {
        backgroundColor: '#FEF2F2',
        borderRadius: RADIUS.sm,
        padding: SPACING.md,
        maxHeight: 150,
        width: '100%',
        marginBottom: SPACING.lg,
        borderWidth: 1,
        borderColor: '#FEE2E2',
    },
    errorText: {
        fontSize: 12,
        color: COLORS.state.danger,
        fontFamily: 'monospace',
        fontWeight: '600',
    },
    stackText: {
        fontSize: 10,
        color: COLORS.text.light,
        fontFamily: 'monospace',
        marginTop: SPACING.sm,
    },
    retryButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: COLORS.primary,
        paddingVertical: 14,
        paddingHorizontal: 32,
        borderRadius: RADIUS.md,
        shadowColor: COLORS.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    retryText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '700',
    },
});
