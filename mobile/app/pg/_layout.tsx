import { Stack } from 'expo-router';

export default function PGLayout() {
    return (
        <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="new" />
            <Stack.Screen name="[id]" />
            <Stack.Screen name="room" />
            <Stack.Screen name="router-group" />
        </Stack>
    );
}
