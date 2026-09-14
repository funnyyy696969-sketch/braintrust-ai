import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { getUser, signOut as supabaseSignOut } from '@/lib/supabase-auth';
import type { User } from '@/lib/supabase-auth';

interface UseSupabaseAuthOptions {
  redirectAfterAuth?: string;
}

export function useSupabaseAuth(options: UseSupabaseAuthOptions = {}) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUser = useCallback(async () => {
    try {
      const userData = await getUser();
      setUser(userData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch user');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        const userData = await getUser();
        setUser(userData);
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
      } else if (event === 'TOKEN_REFRESHED') {
        const userData = await getUser();
        setUser(userData);
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchUser]);

  const signInWithEmail = async (email: string, password: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      const userData = await getUser();
      setUser(userData);
      return { success: true, data };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
      return { success: false, error: err };
    } finally {
      setIsLoading(false);
    }
  };

  const signUpWithEmail = async (email: string, password: string, name?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name },
        },
      });
      if (error) throw error;
      return { success: true, data };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
      return { success: false, error: err };
    } finally {
      setIsLoading(false);
    }
  };

  const signInWithOtp = async (email: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth`,
        },
      });
      if (error) throw error;
      return { success: true, data };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send verification code');
      return { success: false, error: err };
    } finally {
      setIsLoading(false);
    }
  };

  const signOut = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { error } = await supabaseSignOut();
      if (error) throw error;
      setUser(null);
      return { success: true };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign out failed');
      return { success: false, error: err };
    } finally {
      setIsLoading(false);
    }
  };

  return {
    user,
    isLoading,
    error,
    signInWithEmail,
    signUpWithEmail,
    signInWithOtp,
    signOut,
    refetchUser: fetchUser,
  };
}
