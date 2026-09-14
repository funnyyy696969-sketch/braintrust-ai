// Simple auth placeholder - no Supabase
// This is a stub that returns null user (no auth in this version)
export function useSupabaseAuth() {
  return {
    user: null,
    isLoading: false,
    error: null,
    signInWithEmail: async () => ({ success: false, error: new Error('Not configured') }),
    signUpWithEmail: async () => ({ success: false, error: new Error('Not configured') }),
    signInWithOtp: async () => ({ success: false, error: new Error('Not configured') }),
    signOut: async () => ({ success: true }),
    refetchUser: async () => {},
  };
}

export const useAuth = useSupabaseAuth;
