'use client';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Theme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';

export const THEME_MODES = ['system', 'light', 'dark'];
const ThemeModeContext = createContext({ mode: 'system', setMode() {} });
export const useThemeMode = () => useContext(ThemeModeContext);

/**
 * Mode tampilan (terang/gelap/sistem). Pilihan disimpan di cookie `theme` (bukan localStorage:
 * aplikasi ini sengaja tidak menyimpan apa pun di localStorage) sehingga server bisa
 * merender mode yang benar sejak awal tanpa kilatan tema.
 */
export default function Providers({ children, initialMode = 'system' }) {
  const [mode, setModeState] = useState(THEME_MODES.includes(initialMode) ? initialMode : 'system');
  const setMode = useCallback(next => {
    if (!THEME_MODES.includes(next)) return;
    setModeState(next);
    try { document.cookie = `theme=${next}; path=/; max-age=31536000; SameSite=Strict${location.protocol === 'https:' ? '; Secure' : ''}`; } catch {}
  }, []);
  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return <ThemeModeContext value={value}><Theme theme={neutralTheme} mode={mode}>{children}</Theme></ThemeModeContext>;
}
