import React from 'react';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { TouchableOpacity, Platform, View } from 'react-native';
import { useSettings } from '../../context/SettingsContext';
import { COLORS, DARK_COLORS, SPACING } from '../../constants/theme';

const MODERN_BAR = {
  bg: '#020817',       // near-black
  active: '#FF5A00',   // orange
  inactive: '#475569', // slate-600
  border: '#1e293b',   // slate-800
};

export default function TabsLayout() {
  const router = useRouter();
  const { isDarkMode, isModernUI } = useSettings();
  const C = isDarkMode ? DARK_COLORS : COLORS;

  const tabBarStyle = isModernUI
    ? {
        backgroundColor: MODERN_BAR.bg,
        borderTopColor: MODERN_BAR.border,
        borderTopWidth: 2,
        height: Platform.OS === 'ios' ? 88 : 68,
        paddingBottom: Platform.OS === 'ios' ? 30 : 8,
        paddingTop: 6,
      }
    : {
        backgroundColor: C.card,
        borderTopColor: C.border,
        borderTopWidth: 1,
        height: Platform.OS === 'ios' ? 88 : 65,
        paddingBottom: Platform.OS === 'ios' ? 30 : 8,
        paddingTop: 6,
      };

  const tabBarLabelStyle = isModernUI
    ? { fontSize: 10, fontWeight: '700' as const, letterSpacing: 0.8, textTransform: 'uppercase' as const }
    : { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.3 };

  const headerStyle = isModernUI
    ? { backgroundColor: '#020817', borderBottomColor: MODERN_BAR.border, ...(Platform.OS === 'web' ? { borderBottomWidth: 2 } : {}) }
    : { backgroundColor: C.card, borderBottomColor: C.border, ...(Platform.OS === 'web' ? { borderBottomWidth: 1 } : {}) };

  // In modern mode, index.tsx renders the full AppShell with its own custom
  // header and bottom nav. We hide the Expo Router tab bar entirely.
  const modernTabBarStyle = { height: 0, overflow: 'hidden' as const, borderTopWidth: 0 };

  return (
    <Tabs
      screenOptions={{
        headerRight: () => (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity
              onPress={() => router.push('/customer-search' as any)}
              style={{ marginRight: SPACING.sm }}
            >
              <Ionicons name="search" size={22} color={C.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push('/profile')}
              style={{ marginRight: SPACING.md }}
            >
              <Ionicons name="person-circle" size={26} color={C.primary} />
            </TouchableOpacity>
          </View>
        ),
        headerStyle: { backgroundColor: C.card, borderBottomColor: C.border, ...(Platform.OS === 'web' ? { borderBottomWidth: 1 } : {}) },
        headerTitleStyle: { color: C.text.primary, fontWeight: '700', fontSize: 17 },
        headerShadowVisible: false,
        tabBarActiveTintColor: C.primary,
        tabBarInactiveTintColor: C.text.light,
        tabBarStyle: isModernUI ? modernTabBarStyle : tabBarStyle,
        tabBarLabelStyle,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Pending',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="time-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="ongoing"
        options={{
          title: 'Ongoing',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="construct-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'Completed',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="checkmark-done-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: 'Map',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="map-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="survey"
        options={{
          title: 'Survey',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="scan-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
