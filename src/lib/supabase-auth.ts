import { supabase } from './supabase';

export interface User {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export async function getUser(): Promise<User | null> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;

  return {
    id: user.id,
    email: user.email ?? null,
    name: user.user_metadata?.name ?? null,
    avatarUrl: user.user_metadata?.avatar_url ?? null,
    createdAt: user.created_at,
  };
}

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  return { data, error };
}

export async function signUpWithEmail(email: string, password: string, name?: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name },
    },
  });
  return { data, error };
}

export async function signInWithOtp(email: string) {
  const { data, error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${window.location.origin}/auth`,
    },
  });
  return { data, error };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  return { error };
}

export async function updateUserProfile(userId: string, updates: {
  name?: string;
  avatarUrl?: string;
}) {
  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();
  return { data, error };
}
