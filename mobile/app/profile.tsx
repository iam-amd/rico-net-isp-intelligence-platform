import React, { useEffect, useState } from 'react';
import * as Updates from 'expo-updates';
import {
  StyleSheet, View, Text, TouchableOpacity, ScrollView, Switch, Platform, StatusBar
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, Stack } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { TicketService } from '../services/ticketService';
import { TechnicianService, TechnicianPerformance } from '../services/technicianService';
import { BiometricService } from '../services/biometricService';
import { COLORS, DARK_COLORS, SPACING, RADIUS, GRADIENTS } from '../constants/theme';
import { CONFIG } from '../constants/config';
import { TechnicianStats } from '../types';

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const { isDarkMode, toggleTheme, defaultView, setDefaultView, isModernUI, setUiTheme } = useSettings();
  const router = useRouter();
  const C = isDarkMode ? DARK_COLORS : COLORS;

  const [stats, setStats] = useState<TechnicianStats>({
    assigned_count: 0, ongoing_count: 0, resolved_count: 0, total_count: 0,
  });
  const [performance, setPerformance] = useState<TechnicianPerformance | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricTypes, setBiometricTypes] = useState<string[]>([]);

  useEffect(() => {
    loadStats();
    checkBiometrics();
  }, []);

  const checkBiometrics = async () => {
    const available = await BiometricService.isAvailable();
    setBiometricAvailable(available);
    if (available) {
      const enabled = await BiometricService.isEnabled();
      setBiometricEnabled(enabled);
      const types = await BiometricService.getSupportedTypes();
      setBiometricTypes(types);
    }
  };

  const toggleBiometric = async () => {
    if (!biometricEnabled) {
      const success = await BiometricService.authenticate('Verify to enable biometric lock');
      if (!success) return;
    }
    const newValue = !biometricEnabled;
    await BiometricService.setEnabled(newValue);
    setBiometricEnabled(newValue);
  };

  const loadStats = async () => {
    try {
      const all = await TicketService.getAllTickets('All');
      const myTickets = user?.username
        ? all.filter(t => t.assigned_tech === user.username)
        : all;
      setStats({
        assigned_count: myTickets.filter(t => t.status === 'Assigned' || t.status === 'Open').length,
        ongoing_count: myTickets.filter(t => t.status === 'Ongoing').length,
        resolved_count: myTickets.filter(t => t.status === 'Resolved' || t.status === 'Closed').length,
        total_count: myTickets.length,
      });
    } catch (e) {
      console.warn('[Profile] Failed to load stats');
    }

    // Load performance metrics from backend
    if (user?.id) {
      try {
        const perf = await TechnicianService.getPerformance(user.id);
        setPerformance(perf);
      } catch (e) {
        console.warn('[Profile] Failed to load performance');
      }
    }
  };

  const handleLogout = () => {
    signOut();
    router.replace('/login');
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: C.background }]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <Stack.Screen options={{
        headerStyle: { backgroundColor: C.card },
        headerTitleStyle: { color: C.text.primary },
        headerShadowVisible: false,
        title: 'Profile',
      }} />

      {/* Profile Header */}
      <LinearGradient colors={GRADIENTS.primary} style={styles.profileHeader}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarText}>
            {user?.full_name?.charAt(0)?.toUpperCase() || 'T'}
          </Text>
        </View>
        <Text style={styles.fullName}>{user?.full_name || 'Technician'}</Text>
        <Text style={styles.username}>@{user?.username || 'unknown'}</Text>
        <View style={styles.roleBadge}>
          <Ionicons name="shield-checkmark" size={12} color="#FCD34D" />
          <Text style={styles.roleText}>{user?.role || 'Field Tech'}</Text>
        </View>
      </LinearGradient>

      {/* Job Stats */}
      <View style={styles.statsContainer}>
        <StatCard label="Pending" value={stats.assigned_count} color={COLORS.state.pending} icon="time" theme={C} />
        <StatCard label="Active" value={stats.ongoing_count} color={COLORS.state.info} icon="construct" theme={C} />
        <StatCard label="Done" value={stats.resolved_count} color={COLORS.state.success} icon="checkmark-done" theme={C} />
      </View>

      {/* Performance Metrics */}
      {performance && (
        <View style={[styles.section, { backgroundColor: C.card, borderColor: C.border }]}>
          <Text style={[styles.sectionTitle, { color: C.text.light }]}>PERFORMANCE</Text>
          <InfoRow icon="speedometer" label="Avg Resolution" value={`${performance.avg_resolution_hours.toFixed(1)}h`} color={C} />
          <InfoRow icon="trending-up" label="Resolution Rate" value={`${performance.resolution_rate.toFixed(0)}%`} color={C} />
          <InfoRow icon="construct" label="Active Jobs" value={`${performance.active_count}`} color={C} />
          <InfoRow icon="trophy" label="Total Resolved" value={`${performance.total_resolved} / ${performance.total_assigned}`} color={C} />
        </View>
      )}

      {/* Settings */}
      <View style={[styles.section, { backgroundColor: C.card, borderColor: C.border }]}>
        <Text style={[styles.sectionTitle, { color: C.text.light }]}>SETTINGS</Text>

        <View style={[styles.settingRow, { borderBottomColor: C.border }]}>
          <View style={styles.settingLeft}>
            <Ionicons name="moon" size={18} color={C.primary} />
            <Text style={[styles.settingLabel, { color: C.text.primary }]}>Dark Mode</Text>
          </View>
          <Switch
            value={isDarkMode}
            onValueChange={toggleTheme}
            trackColor={{ false: '#E2E8F0', true: '#3B82F6' }}
            thumbColor="#FFFFFF"
          />
        </View>

        <View style={[styles.settingRow, { borderBottomColor: C.border }]}>
          <View style={styles.settingLeft}>
            <Ionicons name="layers-outline" size={18} color={C.primary} />
            <View>
              <Text style={[styles.settingLabel, { color: C.text.primary }]}>Modern UI</Text>
              <Text style={{ fontSize: 11, color: C.text.light, marginTop: 1 }}>
                {isModernUI ? 'Industrial design active' : 'Simple design active'}
              </Text>
            </View>
          </View>
          <Switch
            value={isModernUI}
            onValueChange={(v) => setUiTheme(v ? 'modern' : 'simple')}
            trackColor={{ false: '#E2E8F0', true: '#FF5A00' }}
            thumbColor="#FFFFFF"
          />
        </View>

        <View style={[styles.settingRow, { borderBottomColor: C.border }]}>
          <View style={styles.settingLeft}>
            <Ionicons name="list" size={18} color={C.primary} />
            <Text style={[styles.settingLabel, { color: C.text.primary }]}>Default View</Text>
          </View>
          <TouchableOpacity
            style={styles.viewToggle}
            onPress={() => setDefaultView(defaultView === 'List' ? 'Map' : 'List')}
          >
            <Text style={styles.viewToggleText}>
              {defaultView === 'List' ? '📋 List' : '🗺️ Map'}
            </Text>
          </TouchableOpacity>
        </View>

        {biometricAvailable && (
          <View style={styles.settingRow}>
            <View style={styles.settingLeft}>
              <Ionicons name="finger-print" size={18} color={C.primary} />
              <Text style={[styles.settingLabel, { color: C.text.primary }]}>
                {biometricTypes[0] || 'Biometric'} Lock
              </Text>
            </View>
            <Switch
              value={biometricEnabled}
              onValueChange={toggleBiometric}
              trackColor={{ false: '#E2E8F0', true: '#3B82F6' }}
              thumbColor="#FFFFFF"
            />
          </View>
        )}
      </View>

      {/* App Info */}
      <View style={[styles.section, { backgroundColor: C.card, borderColor: C.border }]}>
        <Text style={[styles.sectionTitle, { color: C.text.light }]}>APP INFO</Text>
        <InfoRow icon="information-circle" label="Version" value={CONFIG.APP_VERSION} color={C} />
        <InfoRow icon="server" label="API" value={CONFIG.API_BASE_URL.replace(/https?:\/\//, '')} color={C} />
        <InfoRow
          icon="cloud-done-outline"
          label="OTA Update"
          value={Updates.updateId ? Updates.updateId.slice(0, 8) + '…' : 'base build'}
          color={C}
        />
      </View>

      {/* Sign Out */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
        <Ionicons name="log-out-outline" size={20} color={COLORS.state.danger} />
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>

      <View style={{ height: 60 }} />
    </ScrollView>
  );
}

function StatCard({ label, value, color, icon, theme }: { label: string; value: number; color: string; icon: string; theme?: any }) {
  const C = theme || COLORS;
  return (
    <View style={[styles.statCard, { borderLeftColor: color, backgroundColor: C.card }]}>
      <Ionicons name={icon as any} size={20} color={color} />
      <Text style={[styles.statValue, { color: C.text.primary }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: C.text.light }]}>{label}</Text>
    </View>
  );
}

function InfoRow({ icon, label, value, color }: { icon: string; label: string; value: string; color: any }) {
  return (
    <View style={[styles.infoRow, { borderBottomColor: color.border }]}>
      <View style={styles.settingLeft}>
        <Ionicons name={icon as any} size={18} color={color.text.light} />
        <Text style={[styles.settingLabel, { color: color.text.primary }]}>{label}</Text>
      </View>
      <Text style={[styles.infoValue, { color: color.text.secondary }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  profileHeader: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: SPACING.lg,
  },
  avatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.4)',
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  fullName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  username: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    marginTop: 10,
    gap: 6,
  },
  roleText: {
    color: '#FCD34D',
    fontSize: 12,
    fontWeight: '700',
  },
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    gap: 10,
  },
  statCard: {
    flex: 1,
    borderRadius: RADIUS.md,
    padding: 14,
    alignItems: 'center',
    borderLeftWidth: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '900',
    marginTop: 6,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  section: {
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  viewToggle: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  viewToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2563EB',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '500',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: SPACING.md,
    backgroundColor: '#FEF2F2',
    borderRadius: RADIUS.md,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: '#FEE2E2',
    gap: 8,
  },
  logoutText: {
    color: COLORS.state.danger,
    fontSize: 15,
    fontWeight: '700',
  },
});
