// Supabase provider removed - using Convex auth instead
// Use ConvexAuthProvider from @convex-dev/auth/react
import React from "react";

interface SupabaseAuthContextType {
  user: any | null;
  isLoading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<{ success: boolean; error?: Error }>;
  signUpWithEmail: (email: string, password: string, name?: string) => Promise<{ success: boolean; error?: Error }>;
  signInWithOtp: (email: string) => Promise<{ success: boolean; error?: Error }>;
  signOut: () => Promise<{ success: boolean; error?: Error }>;
  refetchUser: () => Promise<void>;
}

// Stub context - not actually used
const SupabaseAuthContext = React.createContext<SupabaseAuthContextType | null>(null);

export function SupabaseAuthProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function useSupabaseAuth() {
  return {
    user: null,
    isLoading: false,
    signInWithEmail: async () => ({ success: false, error: new Error('Not implemented') }),
    signUpWithEmail: async () => ({ success: false, error: new Error('Not implemented') }),
    signInWithOtp: async () => ({ success: false, error: new Error('Not implemented') }),
    signOut: async () => ({ success: true }),
    refetchUser: async () => {},
  };
}

export const useAuth = useSupabaseAuth;
