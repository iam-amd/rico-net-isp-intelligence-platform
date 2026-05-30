import { Stack, useRouter, useSegments } from 'expo-router';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { SettingsProvider } from '../context/SettingsContext';
import { NetworkProvider } from '../context/NetworkContext';
import { PGProvider } from '../context/PGContext';
import ErrorBoundary from '../components/ErrorBoundary';
import { useEffect, useRef } from 'react';
import { View, ActivityIndicator, Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { NotificationService } from '../services/notificationService';
import { crashReporting } from '../services/crashReporting';

crashReporting.init();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
    priority: Notifications.AndroidNotificationPriority.MAX,
  }),
});

const StackLayout = () => {
  const { user, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const inTabsGroup = segments[0] === '(tabs)';
    const protectedRoots = [
      'ticket',
      'profile',
      'customer-search',
      'customer',
      'inventory',
      'pg',
      'scan-onu',
      'survey-form',
      'signal-history',
    ];
    const inProtectedRoute = protectedRoots.includes(segments[0] as string);

    if (!user && (inTabsGroup || inProtectedRoute)) {
      router.replace('/login');
    } else if (user && segments[0] === 'login') {
      router.replace('/(tabs)');
    }
  }, [user, segments, isLoading]);

  // Register push token with backend (skip on web — no VAPID key)
  useEffect(() => {
    if (!user || Platform.OS === 'web') return;
    registerForPushNotificationsAsync().then(token => {
      if (token) {
        NotificationService.registerToken(user.id, token);
      }
    });
  }, [user]);

  // Handle notification taps — navigate to ticket
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data;
      if (data?.ticket_id) {
        router.push({ pathname: '/ticket/[id]', params: { id: String(data.ticket_id) } });
      }
    });
    return () => subscription.remove();
  }, []);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <Stack>
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="profile" options={{ headerShown: true, title: 'Profile' }} />
      <Stack.Screen name="ticket/[id]" options={{ headerShown: true, title: 'Ticket Details' }} />
      <Stack.Screen name="customer-search" options={{ headerShown: true, title: 'Search' }} />
      <Stack.Screen name="customer/[id]" options={{ headerShown: true, title: 'Customer' }} />
      <Stack.Screen name="inventory" options={{ headerShown: true, title: 'Inventory' }} />
      <Stack.Screen name="pg" options={{ headerShown: false }} />
    </Stack>
  );
};

async function registerForPushNotificationsAsync() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.log('Failed to get push token');
      return;
    }
    const token = (await Notifications.getExpoPushTokenAsync()).data;
    return token;
  } else {
    console.log('Must use physical device for Push Notifications');
  }
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <SettingsProvider>
          <NetworkProvider>
            <PGProvider>
              <StackLayout />
            </PGProvider>
          </NetworkProvider>
        </SettingsProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
