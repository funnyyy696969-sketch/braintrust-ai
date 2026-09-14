// Supabase auth removed - using Convex auth instead
// Use @/hooks/use-auth for authentication
export interface User {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export async function getUser(): Promise<User | null> {
  return null;
}

export async function signInWithEmail(email: string, password: string) {
  return { data: null, error: new Error('Not implemented') };
}

export async function signUpWithEmail(email: string, password: string, name?: string) {
  return { data: null, error: new Error('Not implemented') };
}

export async function signInWithOtp(email: string) {
  return { data: null, error: new Error('Not implemented') };
}

export async function signOut() {
  return { error: null };
}

export async function updateUserProfile(userId: string, updates: {
  name?: string;
  avatarUrl?: string;
}) {
  return { data: null, error: new Error('Not implemented') };
}
