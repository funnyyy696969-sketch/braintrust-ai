// Simple auth placeholder (no Supabase)
import { createContext, useContext, ReactNode } from 'react';
import type { User } from '@/lib/supabase-auth';

interface SupabaseAuthContextType {
  user: User | null;
  isLoading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<{ success: boolean; error?: Error }>;
  signUpWithEmail: (email: string, password: string, name?: string) => Promise<{ success: boolean; error?: Error }>;
  signInWithOtp: (email: string) => Promise<{ success: boolean; error?: Error }>;
  signOut: () => Promise<{ success: boolean; error?: Error }>;
  refetchUser: () => Promise<void>;
}

const SupabaseAuthContext = createContext<SupabaseAuthContextType | null>(null);

export function SupabaseAuthProvider({ children }: { children: ReactNode }) {
  return (
    <SupabaseAuthContext.Provider
      value={{
        user: null,
        isLoading: false,
        signInWithEmail: async () => ({ success: false, error: new Error('Not configured') }),
        signUpWithEmail: async () => ({ success: false, error: new Error('Not configured') }),
        signInWithOtp: async () => ({ success: false, error: new Error('Not configured') }),
        signOut: async () => ({ success: true }),
        refetchUser: async () => {},
      }}
    >
      {children}
    </SupabaseAuthContext.Provider>
  );
}

export function useSupabaseAuth() {
  const context = useContext(SupabaseAuthContext);
  if (!context) {
    throw new Error('useSupabaseAuth must be used within a SupabaseAuthProvider');
  }
  return context;
}

export const useAuth = useSupabaseAuth;
