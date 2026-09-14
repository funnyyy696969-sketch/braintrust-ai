// Supabase auth hook removed - using Convex auth instead
// Use @/hooks/use-auth for authentication
import type { User } from "@/lib/supabase-auth";

export function useSupabaseAuth() {
  return {
    user: null as User | null,
    isLoading: false,
    error: null as string | null,
    signInWithEmail: async () => ({ success: false, error: new Error('Not implemented') }),
    signUpWithEmail: async () => ({ success: false, error: new Error('Not implemented') }),
    signInWithOtp: async () => ({ success: false, error: new Error('Not implemented') }),
    signOut: async () => ({ success: true }),
    refetchUser: async () => {},
  };
}

export const useAuth = useSupabaseAuth;
