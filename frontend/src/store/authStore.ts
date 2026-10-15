import { create } from 'zustand';
import { authLogin, authGoogle, authRegister, authMe, setStoredToken, getStoredToken } from '../services/api';

export interface AuthUser {
  sub: string;
  email: string;
  name: string;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;

  login: (email: string, password: string) => Promise<void>;
  googleLogin: (credential: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => void;
  loadMe: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  // Rehydrate token from localStorage on load.
  token: getStoredToken(),
  user: null,
  isAuthenticated: !!getStoredToken(),

  login: async (email, password) => {
    const res = await authLogin(email, password);
    setStoredToken(res.access_token);
    set({
      token: res.access_token,
      user: { sub: email, email, name: res.display_name },
      isAuthenticated: true,
    });
    // Refresh with canonical identity from the token (sub/name/email).
    try {
      const me = await authMe();
      set({ user: { sub: me.sub, email: me.email, name: me.name } });
    } catch {
      /* keep optimistic user if /me is briefly unavailable */
    }
  },

  googleLogin: async (credential) => {
    const res = await authGoogle(credential);
    setStoredToken(res.access_token);
    set({
      token: res.access_token,
      user: { sub: '', email: '', name: res.display_name },
      isAuthenticated: true,
    });
    // Refresh with canonical identity from the token (sub/name/email).
    try {
      const me = await authMe();
      set({ user: { sub: me.sub, email: me.email, name: me.name } });
    } catch {
      /* keep optimistic user if /me is briefly unavailable */
    }
  },

  register: async (email, password, displayName) => {
    await authRegister(email, password, displayName);
    // Backend register returns the profile (no token) — log in to get a token.
    const res = await authLogin(email, password);
    setStoredToken(res.access_token);
    set({
      token: res.access_token,
      user: { sub: email, email, name: res.display_name },
      isAuthenticated: true,
    });
    try {
      const me = await authMe();
      set({ user: { sub: me.sub, email: me.email, name: me.name } });
    } catch {
      /* keep optimistic user */
    }
  },

  logout: () => {
    setStoredToken(null);
    set({ token: null, user: null, isAuthenticated: false });
  },

  loadMe: async () => {
    if (!getStoredToken()) return;
    try {
      const me = await authMe();
      set({ user: { sub: me.sub, email: me.email, name: me.name }, isAuthenticated: true });
    } catch {
      // Token invalid/expired — clear it (api layer also redirects on 401).
      setStoredToken(null);
      set({ token: null, user: null, isAuthenticated: false });
    }
  },
}));
