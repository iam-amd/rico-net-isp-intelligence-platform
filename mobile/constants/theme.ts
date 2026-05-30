import { DefaultTheme } from '@react-navigation/native';

// ------------------------------------------------------------------
// DESIGN TOKENS — RICO Net Technician App
// ------------------------------------------------------------------

export const COLORS = {
    primary: '#2563EB',    // Bright Blue
    secondary: '#0F172A',  // Slate 900
    background: '#F8FAFC', // Slate 50
    card: '#FFFFFF',

    text: {
        primary: '#0F172A',
        secondary: '#64748B', // Slate 500
        light: '#94A3B8',     // Slate 400
        white: '#FFFFFF',
    },

    state: {
        success: '#10B981', // Emerald 500
        warning: '#F59E0B', // Amber 500
        danger: '#EF4444',  // Red 500
        info: '#3B82F6',    // Blue 500
        pending: '#F97316', // Orange 500
    },

    border: '#E2E8F0',    // Slate 200
    overlay: 'rgba(15, 23, 42, 0.5)',
};

// Dark mode overrides
export const DARK_COLORS = {
    primary: '#3B82F6',
    secondary: '#E2E8F0',
    background: '#0F172A',  // Slate 900
    card: '#1E293B',        // Slate 800

    text: {
        primary: '#F1F5F9',   // Slate 100
        secondary: '#94A3B8', // Slate 400
        light: '#64748B',     // Slate 500
        white: '#FFFFFF',
    },

    state: {
        success: '#34D399', // Emerald 400
        warning: '#FBBF24', // Amber 400
        danger: '#F87171',  // Red 400
        info: '#60A5FA',    // Blue 400
        pending: '#FB923C', // Orange 400
    },

    border: '#334155',      // Slate 700
    overlay: 'rgba(0, 0, 0, 0.7)',
};

export const GRADIENTS = {
    primary: ['#2563EB', '#1D4ED8'] as const,
    success: ['#10B981', '#059669'] as const,
    danger: ['#EF4444', '#DC2626'] as const,
    cardHeader: ['#F8FAFC', '#F1F5F9'] as const,
    orange: ['#FF8C42', '#FF5F6D'] as const,
    brand: ['#1E3A8A', '#2563EB', '#3B82F6'] as const, // Login gradient
};

export const SPACING = {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
};

export const RADIUS = {
    sm: 8,
    md: 16,
    lg: 24,
    full: 9999,
};

export const FONTS = {
    regular: 'System',
    bold: 'System',
};

export const SHADOWS = {
    light: {
        shadowColor: '#64748B',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
        elevation: 3,
    },
    medium: {
        shadowColor: '#1E293B',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 20,
        elevation: 8,
    },
};

/**
 * Helper: get colors based on dark mode flag
 */
export function getColors(isDark: boolean) {
    return isDark ? DARK_COLORS : COLORS;
}

export default {
    COLORS,
    DARK_COLORS,
    GRADIENTS,
    SPACING,
    RADIUS,
    FONTS,
    SHADOWS,
    getColors,
};
