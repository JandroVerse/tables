import { useCallback, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
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
import { useForm } from "react-hook-form";
import { apiRequest } from "@/lib/queryClient";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, ArrowRight, ArrowLeft } from "lucide-react";

const steps = [
  {
    id: "welcome",
    title: "Welcome to Restaurant Manager",
    description: "Let's set up your restaurant in just a few steps.",
  },
  {
    id: "restaurant-info",
    title: "Restaurant Information",
    description: "Tell us about your restaurant.",
  },
  {
    id: "table-setup",
    title: "Table Setup",
    description: "Configure your restaurant's table layout.",
  },
  {
    id: "staff-roles",
    title: "Staff Roles",
    description: "Set up roles for your staff members.",
  },
  {
    id: "review",
    title: "Review & Complete",
    description: "Review your setup before finishing.",
  },
];

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    restaurantInfo: {
      name: "",
      address: "",
      phone: "",
    },
    tables: [],
    staffRoles: [],
  });

  const { mutate: createRestaurant, isPending } = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("POST", "/api/restaurants", data);
      return response.json();
    },
    onSuccess: () => {
      setLocation("/admin");
    },
  });

  const nextStep = useCallback(() => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    }
  }, [step]);

  const prevStep = useCallback(() => {
    if (step > 0) {
      setStep(step - 1);
    }
  }, [step]);

  const handleSubmit = (data: any) => {
    if (step === steps.length - 1) {
      createRestaurant({
        ...formData.restaurantInfo,
        ownerId: user?.id,
      });
    } else {
      nextStep();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 p-4 flex items-center justify-center">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <div className="space-y-2">
            <CardTitle className="text-2xl font-bold">
              {steps[step].title}
            </CardTitle>
            <CardDescription>{steps[step].description}</CardDescription>
          </div>
          <div className="flex gap-2 mt-4">
            {steps.map((s, i) => (
              <div
                key={s.id}
                className={`h-2 flex-1 rounded-full transition-colors ${
                  i <= step ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {step === 0 && (
                <div className="space-y-4">
                  <p className="text-muted-foreground">
                    Welcome to your restaurant management journey! This quick setup
                    will help you:
                  </p>
                  <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                    <li>Configure your restaurant's basic information</li>
                    <li>Set up your table layout</li>
                    <li>Define staff roles and permissions</li>
                    <li>Get ready to manage orders efficiently</li>
                  </ul>
                </div>
              )}

              {step === 1 && (
                <form className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="restaurant-name">Restaurant Name</Label>
                    <Input
                      id="restaurant-name"
                      value={formData.restaurantInfo.name}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          restaurantInfo: {
                            ...formData.restaurantInfo,
                            name: e.target.value,
                          },
                        })
                      }
                      placeholder="Enter your restaurant's name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="address">Address</Label>
                    <Input
                      id="address"
                      value={formData.restaurantInfo.address}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          restaurantInfo: {
                            ...formData.restaurantInfo,
                            address: e.target.value,
                          },
                        })
                      }
                      placeholder="Enter your restaurant's address"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone Number</Label>
                    <Input
                      id="phone"
                      value={formData.restaurantInfo.phone}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          restaurantInfo: {
                            ...formData.restaurantInfo,
                            phone: e.target.value,
                          },
                        })
                      }
                      placeholder="Enter your restaurant's phone number"
                    />
                  </div>
                </form>
              )}

              {step === 2 && (
                <div className="space-y-4">
                  <p className="text-muted-foreground">
                    Table setup will be available in the admin dashboard after completing
                    the initial setup. You'll be able to:
                  </p>
                  <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                    <li>Create and arrange tables visually</li>
                    <li>Generate QR codes for each table</li>
                    <li>Manage table sections and zones</li>
                  </ul>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4">
                  <p className="text-muted-foreground">
                    Staff management will be available in the admin dashboard after setup. 
                    You can:
                  </p>
                  <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                    <li>Add staff members with specific roles</li>
                    <li>Set permissions for different roles</li>
                    <li>Manage staff schedules and assignments</li>
                  </ul>
                </div>
              )}

              {step === 4 && (
                <div className="space-y-4">
                  <h3 className="font-semibold">Review Your Information</h3>
                  <div className="space-y-2">
                    <p>
                      <span className="font-medium">Restaurant Name:</span>{" "}
                      {formData.restaurantInfo.name}
                    </p>
                    <p>
                      <span className="font-medium">Address:</span>{" "}
                      {formData.restaurantInfo.address}
                    </p>
                    <p>
                      <span className="font-medium">Phone:</span>{" "}
                      {formData.restaurantInfo.phone}
                    </p>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button
            variant="outline"
            onClick={prevStep}
            disabled={step === 0 || isPending}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : null}
            {step === steps.length - 1 ? (
              "Complete Setup"
            ) : (
              <>
                Next
                <ArrowRight className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
