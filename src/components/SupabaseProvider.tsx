import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { getUser } from '@/lib/supabase-auth';
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
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchUser = async () => {
    try {
      const userData = await getUser();
      setUser(userData);
    } catch (error) {
      console.error('Error fetching user:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async () => {
      await fetchUser();
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithEmail = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await fetchUser();
      return { success: true };
    } catch (error) {
      return { success: false, error: error as Error };
    }
  };

  const signUpWithEmail = async (email: string, password: string, name?: string) => {
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name } },
      });
      if (error) throw error;
      await fetchUser();
      return { success: true };
    } catch (error) {
      return { success: false, error: error as Error };
    }
  };

  const signInWithOtp = async (email: string) => {
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth` },
      });
      if (error) throw error;
      return { success: true };
    } catch (error) {
      return { success: false, error: error as Error };
    }
  };

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setUser(null);
      return { success: true };
    } catch (error) {
      return { success: false, error: error as Error };
    }
  };

  return (
    <SupabaseAuthContext.Provider
      value={{
        user,
        isLoading,
        signInWithEmail,
        signUpWithEmail,
        signInWithOtp,
        signOut,
        refetchUser: fetchUser,
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

// Compat export for useAuth hook
export const useAuth = useSupabaseAuth;
