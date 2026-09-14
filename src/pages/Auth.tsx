import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Brain, ArrowRight, Loader2, Mail, User, Shield, LogOut } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { supabase } from "@/lib/supabase";
import { getUser } from "@/lib/supabase-auth";

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirectAfterAuth(
  returnTo: string | null,
  fallback = "/dashboard",
) {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return fallback;
}

export default function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );

  const [step, setStep] = useState<"signIn" | "signUp" | { email: string }>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<{ email: string | null; name?: string | null } | null>(null);

  useEffect(() => {
    // Check if already signed in
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const userData = await getUser();
        setUser(userData);
        navigate(redirect);
      }
    };
    checkUser();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === "SIGNED_IN") {
        const userData = await getUser();
        setUser(userData);
        navigate(redirect);
      } else if (event === "SIGNED_OUT") {
        setUser(null);
        setStep("signIn");
        navigate("/");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate, redirect]);

  const handleEmailSignIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email || "",
        password: password || "",
      });
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sign in");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailSignUp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signUp({
        email: email || "",
        password: password || "",
        options: {
          data: { name },
        },
      });
      if (error) throw error;
      setStep({ email: email || "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sign up");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      if (typeof step === "object" && step !== null && "email" in step) {
        const { error } = await supabase.auth.verifyOtp({
          email: step.email,
          token: otp,
          type: "email",
        });
        if (error) throw error;
        navigate(redirect);
      }
    } catch (err) {
      setError("The verification code you entered is incorrect.");
      setOtp("");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGuestLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // For guest access, we'll just navigate without auth
      navigate("/dashboard");
    } catch (err) {
      setError(`Failed to continue as guest`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="border-b border-neutral-200">
        <div className="max-w-md mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-[#12355B] flex items-center justify-center">
              <Brain className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-[#12355B]">BrainTrust AI</span>
          </div>
          {user && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSignOut}
              className="text-neutral-600 gap-2"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </Button>
          )}
        </div>
      </header>

      {/* Auth Content */}
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-semibold text-[#12355B]">
              {user ? "Welcome back" : "Welcome to BrainTrust AI"}
            </h1>
            <p className="text-neutral-600 mt-2">
              {user
                ? "You are signed in to your workspace"
                : "Sign in to continue your analysis"}
            </p>
          </div>

          <Card className="border-neutral-200 shadow-none">
            {step === "signIn" && !user ? (
              <>
                <form onSubmit={handleEmailSignIn}>
                  <CardContent className="pt-6">
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="email" className="text-neutral-700">Email</Label>
                        <div className="relative mt-1.5">
                          <Mail className="absolute left-3 top-3 h-4 w-4 text-neutral-400" />
                          <Input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="name@example.com"
                            className="pl-9"
                            disabled={isLoading}
                            required
                          />
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="password" className="text-neutral-700">Password</Label>
                        <div className="relative mt-1.5">
                          <Input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter your password"
                            className="pl-3"
                            disabled={isLoading}
                            required
                          />
                        </div>
                      </div>
                    </div>
                    {error && (
                      <p className="mt-3 text-sm text-red-500">{error}</p>
                    )}
                    <div className="mt-6 flex gap-3">
                      <Button
                        type="submit"
                        className="flex-1 bg-[#12355B] hover:bg-[#1a4570]"
                        disabled={isLoading}
                      >
                        {isLoading ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            Signing in...
                          </>
                        ) : (
                          "Sign In"
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setStep("signUp")}
                        className="border-neutral-300"
                        disabled={isLoading}
                      >
                        Create account
                      </Button>
                    </div>
                    <div className="mt-4 text-center">
                      <Button
                        type="button"
                        variant="ghost"
                        className="text-neutral-600"
                        onClick={handleGuestLogin}
                        disabled={isLoading}
                      >
                        Continue as guest
                      </Button>
                    </div>
                  </CardContent>
                </form>
              </>
            ) : step === "signUp" && !user ? (
              <>
                <form onSubmit={handleEmailSignUp}>
                  <CardContent className="pt-6">
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="name" className="text-neutral-700">Name (optional)</Label>
                        <div className="relative mt-1.5">
                          <User className="absolute left-3 top-3 h-4 w-4 text-neutral-400" />
                          <Input
                            id="name"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Your name"
                            className="pl-9"
                            disabled={isLoading}
                          />
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="signup-email" className="text-neutral-700">Email</Label>
                        <div className="relative mt-1.5">
                          <Mail className="absolute left-3 top-3 h-4 w-4 text-neutral-400" />
                          <Input
                            id="signup-email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="name@example.com"
                            className="pl-9"
                            disabled={isLoading}
                            required
                          />
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="signup-password" className="text-neutral-700">Password</Label>
                        <div className="relative mt-1.5">
                          <Input
                            id="signup-password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Create a password"
                            className="pl-3"
                            disabled={isLoading}
                            required
                            minLength={6}
                          />
                        </div>
                      </div>
                    </div>
                    {error && (
                      <p className="mt-3 text-sm text-red-500">{error}</p>
                    )}
                    <div className="mt-6 flex gap-3">
                      <Button
                        type="submit"
                        className="flex-1 bg-[#12355B] hover:bg-[#1a4570]"
                        disabled={isLoading || password.length < 6}
                      >
                        {isLoading ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            Creating account...
                          </>
                        ) : (
                          "Create account"
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setStep("signIn")}
                        className="border-neutral-300"
                        disabled={isLoading}
                      >
                        Back to sign in
                      </Button>
                    </div>
                  </CardContent>
                </form>
              </>
            ) : step === "signIn" && user ? (
              <div className="py-8 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#12355B]/10 flex items-center justify-center">
                  <Shield className="w-8 h-8 text-[#12355B]" />
                </div>
                <p className="text-neutral-600">
                  You are signed in as <strong>{user?.email}</strong>
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4 border-neutral-300"
                  onClick={() => navigate(redirect)}
                >
                  Go to dashboard
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            ) : step === "signUp" && user ? (
              <div className="py-8 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#12355B]/10 flex items-center justify-center">
                  <Shield className="w-8 h-8 text-[#12355B]" />
                </div>
                <p className="text-neutral-600">
                  Account created for <strong>{user?.name || user?.email}</strong>
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4 border-neutral-300"
                  onClick={() => navigate(redirect)}
                >
                  Go to dashboard
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            ) : (
              <>
                <CardHeader className="text-center mt-4">
                  <CardTitle>Check your email</CardTitle>
                  <CardDescription>
                    We've sent a verification code to {(typeof step === "object" && step !== null && "email" in step) ? step.email : "your email"}
                  </CardDescription>
                </CardHeader>
                <form onSubmit={handleOtpSubmit}>
                  <CardContent className="pb-4">
                    <div className="flex justify-center">
                      <InputOTP
                        value={otp}
                        onChange={setOtp}
                        maxLength={6}
                        disabled={isLoading}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && otp.length === 6 && !isLoading) {
                            const form = (e.target as HTMLElement).closest("form");
                            if (form) {
                              form.requestSubmit();
                            }
                          }
                        }}
                      >
                        <InputOTPGroup>
                          {Array.from({ length: 6 }).map((_, index) => (
                            <InputOTPSlot key={index} index={index} />
                          ))}
                        </InputOTPGroup>
                      </InputOTP>
                    </div>
                    {error && (
                      <p className="mt-3 text-sm text-red-500 text-center">
                        {error}
                      </p>
                    )}
                    <p className="text-sm text-neutral-500 text-center mt-4">
                      Didn't receive a code?{" "}
                      <Button
                        variant="link"
                        className="p-0 h-auto text-neutral-600"
                        onClick={() => setStep("signIn")}
                      >
                        Try again
                      </Button>
                    </p>
                  </CardContent>
                  <CardFooter className="flex-col gap-2 pt-2">
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={isLoading || otp.length !== 6}
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Verifying...
                        </>
                      ) : (
                        <>
                          Verify code
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setStep("signIn")}
                      disabled={isLoading}
                      className="w-full text-neutral-600"
                    >
                      Use different email
                    </Button>
                  </CardFooter>
                </form>
              </>
            )}
          </Card>

          <p className="text-center text-xs text-neutral-400 mt-6">
            Built for understanding AI, not for diagnosis
          </p>
        </div>
      </div>
    </div>
  );
}

export function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
