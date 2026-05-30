import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Theme = 'light' | 'dark';
type ViewMode = 'List' | 'Map';
export type UITheme = 'simple' | 'modern';

interface SettingsContextType {
    theme: Theme;
    defaultViewMode: ViewMode;
    uiTheme: UITheme;
    toggleTheme: () => void;
    setDefaultViewMode: (mode: ViewMode) => void;
    setUiTheme: (t: UITheme) => void;
    isLoading: boolean;
    // Aliases for convenience
    isDarkMode: boolean;
    defaultView: ViewMode;
    setDefaultView: (mode: ViewMode) => void;
    isModernUI: boolean;
}

const SettingsContext = createContext<SettingsContextType>({
    theme: 'light',
    defaultViewMode: 'List',
    uiTheme: 'modern',
    toggleTheme: () => {},
    setDefaultViewMode: () => {},
    setUiTheme: () => {},
    isLoading: true,
    isDarkMode: false,
    defaultView: 'List',
    setDefaultView: () => {},
    isModernUI: true,
});

export const useSettings = () => useContext(SettingsContext);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
    const [theme, setTheme] = useState<Theme>('light');
    const [defaultViewMode, setViewModeState] = useState<ViewMode>('List');
    const [uiTheme, setUiThemeState] = useState<UITheme>('modern');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const savedTheme = await AsyncStorage.getItem('app_theme');
                const savedView = await AsyncStorage.getItem('app_default_view');
                const savedUiTheme = await AsyncStorage.getItem('app_ui_theme_v2');
                if (savedTheme) setTheme(savedTheme as Theme);
                if (savedView) setViewModeState(savedView as ViewMode);
                if (savedUiTheme) setUiThemeState(savedUiTheme as UITheme);
            } catch (e) {
                console.error('Failed to load settings', e);
            } finally {
                setIsLoading(false);
            }
        })();
    }, []);

    const toggleTheme = async () => {
        const newTheme = theme === 'light' ? 'dark' : 'light';
        setTheme(newTheme);
        await AsyncStorage.setItem('app_theme', newTheme);
    };

    const setDefaultViewMode = async (mode: ViewMode) => {
        setViewModeState(mode);
        await AsyncStorage.setItem('app_default_view', mode);
    };

    const setUiTheme = async (t: UITheme) => {
        setUiThemeState(t);
        await AsyncStorage.setItem('app_ui_theme_v2', t);
    };

    return (
        <SettingsContext.Provider value={{
            theme, defaultViewMode, uiTheme, toggleTheme, setDefaultViewMode, setUiTheme,
            isLoading,
            isDarkMode: theme === 'dark',
            defaultView: defaultViewMode,
            setDefaultView: setDefaultViewMode,
            isModernUI: uiTheme === 'modern',
        }}>
            {children}
        </SettingsContext.Provider>
    );
}
