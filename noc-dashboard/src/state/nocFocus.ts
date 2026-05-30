import { useEffect, useState } from 'react';
import type { GlobalSearchItem } from '../types/noc';

const STORAGE_KEY = 'rico_noc_focus';
const EVENT_NAME = 'rico:noc-focus';

export type NocFocusKind = 'customer' | 'onu' | 'search';

export interface NocFocus {
  kind: NocFocusKind;
  label: string;
  subtitle?: string | null;
  customerUsername?: string | null;
  macAddress?: string | null;
  status?: string | null;
  targetUrl?: string | null;
  source?: string | null;
  updatedAt: string;
}

function readFocus(): NocFocus | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as NocFocus;
  } catch {
    return null;
  }
}

function emitFocusChange(focus: NocFocus | null) {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: focus }));
}

export function setNocFocus(input: Omit<NocFocus, 'updatedAt'>) {
  const focus: NocFocus = {
    ...input,
    updatedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(focus));
  emitFocusChange(focus);
}

export function clearNocFocus() {
  window.localStorage.removeItem(STORAGE_KEY);
  emitFocusChange(null);
}

export function focusFromGlobalResult(item: GlobalSearchItem): Omit<NocFocus, 'updatedAt'> {
  return {
    kind: item.mac_address ? 'onu' : item.customer_username ? 'customer' : 'search',
    label: item.label,
    subtitle: item.subtitle,
    customerUsername: item.customer_username,
    macAddress: item.mac_address,
    status: item.status,
    targetUrl: item.target_url,
    source: item.match_source,
  };
}

export function useNocFocus() {
  const [focus, setFocusState] = useState<NocFocus | null>(() => readFocus());

  useEffect(() => {
    const onFocusChange = (event: Event) => {
      const custom = event as CustomEvent<NocFocus | null>;
      setFocusState(custom.detail ?? readFocus());
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setFocusState(readFocus());
    };
    window.addEventListener(EVENT_NAME, onFocusChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EVENT_NAME, onFocusChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return {
    focus,
    setFocus: setNocFocus,
    clearFocus: clearNocFocus,
  };
}
