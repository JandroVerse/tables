import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { apiRequest } from "@/lib/queryClient";
import { wsService } from "@/lib/ws";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import type { Request, Table, Restaurant } from "@db/schema";
import { ScrollArea } from "@/components/ui/scroll-area";
import { motion, AnimatePresence } from "framer-motion";
import { FloorPlanEditor } from "@/components/floor-plan-editor";
import { AnimatedBackground } from "@/components/animated-background";
import { LogOut } from "lucide-react";
import { ProfileMenu } from "@/components/profile-menu";

const cardVariants = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95, transition: { duration: 0.2 } }
};

const columnVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 }
};

interface CreateRestaurantForm {
  name: string;
  address?: string;
  phone?: string;
}

export default function AdminPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const form = useForm<CreateRestaurantForm>();

  useEffect(() => {
    wsService.connect();
    const unsubscribe = wsService.subscribe((data) => {
      if (data.type === "new_request" || data.type === "update_request") {
        refetch();
      }
    });
    return () => unsubscribe();
  }, []);

  const { data: restaurants = [], isLoading: isLoadingRestaurants } = useQuery<Restaurant[]>({
    queryKey: ["/api/restaurants"],
  });

  const { data: requests = [], refetch } = useQuery<Request[]>({
    queryKey: ["/api/requests"],
  });

  const { data: tables = [] } = useQuery<Table[]>({
    queryKey: ["/api/tables"],
  });

  const { mutate: createRestaurant } = useMutation({
    mutationFn: async (data: CreateRestaurantForm) => {
      return apiRequest("POST", "/api/restaurants", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/restaurants"] });
      toast({
        title: "Restaurant created",
        description: "Your restaurant has been created successfully.",
      });
      form.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: "Failed to create restaurant. Please try again.",
        variant: "destructive",
      });
      console.error("Restaurant creation failed:", error.message);
    },
  });

  const { mutate: updateRequest } = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      return apiRequest("PATCH", `/api/requests/${id}`, { status });
    },
    onSuccess: () => {
      refetch();
      toast({
        title: "Request updated",
        description: "The request status has been updated.",
      });
    },
  });

  const { mutate: clearRequest } = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("PATCH", `/api/requests/${id}`, { status: "cleared" });
    },
    onSuccess: () => {
      refetch();
      toast({
        title: "Request cleared",
        description: "The request has been cleared from the queue.",
      });
    },
  });

  const { mutate: clearCompleted } = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/requests/clear-completed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      toast({
        title: "Cleared completed requests",
        description: "All completed requests have been cleared.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to clear completed requests. Please try again.",
        variant: "destructive",
      });
      console.error("Failed to clear completed requests:", error);
    },
  });

  const getTableName = (tableId: number) => {
    const table = tables.find(t => t.id === tableId);
    return table ? `Table ${table.name}` : `Table ${tableId}`;
  };

  const statuses = ["pending", "in_progress", "completed"] as const;
  const statusTitles = {
    pending: "Pending Requests",
    in_progress: "In Progress",
    completed: "Completed",
  };

  const currentRestaurant = restaurants[0];

  const getSortedRequests = (status: string) => {
    return requests
      .filter((r) => r.status === status)
      .sort((a, b) => {
        if (status === "completed") {
          return new Date(b.completedAt || 0).getTime() - new Date(a.completedAt || 0).getTime();
        } else {
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        }
      });
  };

  const onSubmit = (data: CreateRestaurantForm) => {
    createRestaurant(data);
  };

  return (
    <div className="min-h-screen">
      <div className="relative z-0">
        <AnimatedBackground />
      </div>
      <motion.div
        className="relative z-10 max-w-[1600px] mx-auto space-y-4 p-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">
            {currentRestaurant
              ? `${currentRestaurant.name} Dashboard`
              : "Restaurant Admin Dashboard"}
          </h1>
          <div className="flex gap-2 items-center">
            {currentRestaurant && (
              <ProfileMenu restaurantName={currentRestaurant.name} />
            )}
            <Link href="/qr">
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <Button variant="outline">View QR Codes</Button>
              </motion.div>
            </Link>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                  <Button variant="outline">
                    <LogOut className="h-4 w-4 mr-2" />
                    Logout
                  </Button>
                </motion.div>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you sure you want to logout?</AlertDialogTitle>
                  <AlertDialogDescription>
                    You will need to login again to access the dashboard.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={async () => {
                    await apiRequest("POST", "/api/logout");
                    window.location.href = "/auth";
                  }}>
                    Logout
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {currentRestaurant ? (
          <FloorPlanEditor restaurantId={currentRestaurant.id} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Create Your Restaurant</CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Restaurant Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter restaurant name" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Address (Optional)</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter address" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone Number (Optional)</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter phone number" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <Button type="submit">Create Restaurant</Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {statuses.map((status) => (
            <motion.div
              key={status}
              variants={columnVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.5 }}
            >
              <Card className="h-[calc(100vh-300px)]">
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <CardTitle>{statusTitles[status]}</CardTitle>
                    {status === "completed" && getSortedRequests("completed").length > 0 && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                            <Button variant="outline" size="sm" className="text-sm">
                              Clear All
                            </Button>
                          </motion.div>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Clear All Completed Requests?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will remove all completed requests from the history.
                              This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => clearCompleted()}>
                              Yes, clear all
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="h-[calc(100vh-400px)]">
                    <div className="space-y-2 p-4">
                      <AnimatePresence mode="popLayout">
                        {getSortedRequests(status).map((request) => (
                          <motion.div
                            key={request.id}
                            layout
                            variants={cardVariants}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            layoutId={`request-${request.id}`}
                          >
                            <Card className={`${
                              request.type === "waiter"
                                ? "bg-purple-200"
                                : request.type === "water"
                                ? "bg-blue-100"
                                : request.type === "check"
                                ? "bg-emerald-200"
                                : ""
                            }`}>
                              <CardContent className="flex items-center justify-between p-4">
                                <div>
                                  <h3 className="font-medium">
                                    {getTableName(request.tableId)} - {
                                      request.type === "water" ? "Water Refill" :
                                        request.type === "waiter" ? "Call Waiter" :
                                          request.type === "check" ? "Get Check" :
                                            request.type
                                    }
                                  </h3>
                                  {request.notes && (
                                    <p className="text-sm text-gray-600 mt-1">
                                      {request.notes}
                                    </p>
                                  )}
                                  <p className="text-sm text-gray-500">
                                    {new Date(request.createdAt).toLocaleTimeString()}
                                  </p>
                                </div>
                                <div className="flex flex-row gap-2">
                                  {status !== "completed" && (
                                    <>
                                      {status === "pending" && (
                                        <AlertDialog>
                                          <AlertDialogTrigger asChild>
                                            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                                              <Button variant="outline">
                                                Clear
                                              </Button>
                                            </motion.div>
                                          </AlertDialogTrigger>
                                          <AlertDialogContent>
                                            <AlertDialogHeader>
                                              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                              <AlertDialogDescription>
                                                This will remove the request from the queue.
                                                This action cannot be undone.
                                              </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                                              <AlertDialogAction
                                                onClick={() => clearRequest(request.id)}
                                              >
                                                Clear Request
                                              </AlertDialogAction>
                                            </AlertDialogFooter>
                                          </AlertDialogContent>
                                        </AlertDialog>
                                      )}
                                      <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                                        <Button
                                          onClick={() =>
                                            updateRequest({
                                              id: request.id,
                                              status:
                                                status === "pending"
                                                  ? "in_progress"
                                                  : "completed",
                                            })
                                          }
                                        >
                                          {status === "pending" ? "Start" : "Complete"}
                                        </Button>
                                      </motion.div>
                                    </>
                                  )}
                                </div>
                              </CardContent>
                            </Card>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}