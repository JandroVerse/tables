import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

const registerSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  email: z.string().email("Invalid email"),
  restaurantName: z.string().min(1, "Restaurant name is required"),
  restaurantAddress: z.string().optional(),
  restaurantPhone: z.string().optional(),
});

type AuthForm = z.infer<typeof registerSchema>;

export default function AuthPage() {
  const [_, setLocation] = useLocation();
  const { loginMutation, registerMutation, user } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [shake, setShake] = useState(false);

  const form = useForm<AuthForm>({
    resolver: isLogin ? undefined : zodResolver(registerSchema),
    defaultValues: {
      username: "",
      password: "",
      email: "",
      restaurantName: "",
      restaurantAddress: "",
      restaurantPhone: "",
    }
  });

  // If already logged in, redirect to admin
  useEffect(() => {
    if (user) {
      setLocation("/admin");
    }
  }, [user, setLocation]);

  const onSubmit = async (data: AuthForm) => {
    try {
      if (isLogin) {
        await loginMutation.mutateAsync({
          username: data.username,
          password: data.password
        });
      } else {
        await registerMutation.mutateAsync({
          username: data.username,
          password: data.password,
          email: data.email,
          role: "owner",
          restaurantDetails: {
            name: data.restaurantName,
            address: data.restaurantAddress || null,
            phone: data.restaurantPhone || null,
          }
        });
      }
    } catch (error) {
      // Trigger shake animation
      setShake(true);
      setTimeout(() => setShake(false), 500);

      // Set form error
      form.setError("password", {
        type: "manual",
        message: isLogin ? "Incorrect username or password" : "Registration failed"
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <motion.div
        animate={shake ? {
          x: [-10, 10, -10, 10, 0],
          transition: { duration: 0.5 }
        } : {}}
      >
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>{isLogin ? "Login" : "Register Restaurant"}</CardTitle>
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
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {!isLogin && (
                  <>
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input type="email" placeholder="Enter email" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="restaurantName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Restaurant Name</FormLabel>
                          <FormControl>
                            <Input placeholder="Enter restaurant name" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="restaurantAddress"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Restaurant Address (Optional)</FormLabel>
                          <FormControl>
                            <Input placeholder="Enter restaurant address" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="restaurantPhone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Restaurant Phone (Optional)</FormLabel>
                          <FormControl>
                            <Input placeholder="Enter restaurant phone" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-foreground">Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Enter password" {...field} />
                      </FormControl>
                      <FormMessage className="text-sm text-red-500" />
                    </FormItem>
                  )}
                />
                <Button 
                  type="submit" 
                  className="w-full"
                  disabled={loginMutation.isPending || registerMutation.isPending}
                >
                  {isLogin ? "Login" : "Register"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => {
                    setIsLogin(!isLogin);
                    form.clearErrors();
                    form.reset();
                  }}
                >
                  {isLogin ? "Need an account? Register" : "Already have an account? Login"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}