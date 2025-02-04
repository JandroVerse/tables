import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

interface AuthForm {
  username: string;
  password: string;
  email?: string;
  role?: string;
}

export default function AuthPage() {
  const [_, setLocation] = useLocation();
  const { loginMutation, registerMutation, user } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const form = useForm<AuthForm>();

  // Query restaurants when user is logged in
  const { data: restaurants, isLoading: isLoadingRestaurants } = useQuery({
    queryKey: ["/api/restaurants"],
    enabled: !!user,
    staleTime: 0,
    cacheTime: 0
  });

  // If logged in, redirect to appropriate page
  useEffect(() => {
    if (user && !isLoadingRestaurants) {
      // If user has no restaurants, send them to onboarding
      if (!restaurants?.length) {
        setLocation("/onboarding");
      } else {
        setLocation("/admin");
      }
    }
  }, [user, restaurants, isLoadingRestaurants, setLocation]);

  const onSubmit = (data: AuthForm) => {
    if (isLogin) {
      loginMutation.mutate(data);
    } else {
      registerMutation.mutate({
        ...data,
        role: "owner",
        email: data.email || "",
      });
    }
  };

  if (loginMutation.isPending || registerMutation.isPending || isLoadingRestaurants) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/20">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-center">
            {isLogin ? "Welcome Back" : "Create Your Account"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter username" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              {!isLogin && (
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="Enter email" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              )}
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="Enter password" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <Button 
                type="submit" 
                className="w-full"
                disabled={loginMutation.isPending || registerMutation.isPending}
              >
                {loginMutation.isPending || registerMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                {isLogin ? "Login" : "Register"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => setIsLogin(!isLogin)}
              >
                {isLogin ? "Need an account? Register" : "Already have an account? Login"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}