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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiRequest } from "@/lib/queryClient";
import { wsService } from "@/lib/ws";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import type { Request, Table as RestaurantTable, Restaurant } from "@db/schema";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LogOut } from "lucide-react";
import { ProfileMenu } from "@/components/profile-menu";
import { FloorPlanEditor } from "@/components/floor-plan-editor";
import { AnimatedBackground } from "@/components/animated-background";

interface CreateRestaurantForm {
  name: string;
  address?: string;
  phone?: string;
}

export default function AdminPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const form = useForm<CreateRestaurantForm>();

  // First query to get restaurants
  const { data: restaurants = [] } = useQuery<Restaurant[]>({
    queryKey: ["/api/restaurants"],
  });

  // Get current restaurant early
  const currentRestaurant = restaurants[0];

  // Query tables after we have the restaurant
  const { data: tables = [] } = useQuery<RestaurantTable[]>({
    queryKey: ["/api/restaurants", currentRestaurant?.id, "tables"],
    enabled: !!currentRestaurant?.id,
  });

  // Query requests after we have tables
  const { data: requests = [] } = useQuery<Request[]>({
    queryKey: ["/api/requests", currentRestaurant?.id],
    queryFn: async () => {
      if (!currentRestaurant?.id) return [];
      const response = await fetch("/api/requests");
      if (!response.ok) throw new Error('Failed to fetch requests');
      const allRequests = await response.json();
      // Filter requests for current restaurant's tables
      return allRequests.filter((request: Request) => {
        const table = tables.find(t => t.id === request.tableId);
        return table && table.restaurantId === currentRestaurant.id;
      });
    },
    enabled: !!currentRestaurant?.id && tables.length > 0,
  });

  // Connect to WebSocket and handle updates
  useEffect(() => {
    wsService.connect();
    const unsubscribe = wsService.subscribe((data) => {
      if (data.type === "new_request" || data.type === "update_request") {
        // Only invalidate if the request belongs to current restaurant
        if (data.restaurantId === currentRestaurant?.id) {
          queryClient.invalidateQueries({ queryKey: ["/api/requests", currentRestaurant.id] });
        }
      }
    });
    return () => unsubscribe();
  }, [currentRestaurant?.id, queryClient]);

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
  });

  const { mutate: updateRequest } = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      return apiRequest("PATCH", `/api/requests/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests", currentRestaurant?.id] });
      toast({
        title: "Request updated",
        description: "The request status has been updated.",
      });
    },
  });

  const onSubmit = (data: CreateRestaurantForm) => {
    createRestaurant(data);
  };

  // Filter requests for each table, only showing active ones
  const activeRequestsByTable = tables.reduce((acc, table) => {
    // Only include requests for this restaurant's tables
    const tableRequests = requests.filter(r => 
      r.tableId === table.id && 
      (r.status === "pending" || r.status === "in_progress")
    );

    if (tableRequests.length > 0) {
      acc[table.id] = {
        tableName: table.name,
        requests: tableRequests.sort((a, b) => 
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        )
      };
    }
    return acc;
  }, {} as Record<number, { tableName: string, requests: Request[] }>);

  return (
    <div className="min-h-screen">
      <div className="relative z-0">
        <AnimatedBackground />
      </div>
      <div className="relative z-10 max-w-[1600px] mx-auto space-y-4 p-4">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">
            {currentRestaurant
              ? `${currentRestaurant.name} Dashboard`
              : "Restaurant Admin Dashboard"}
          </h1>
          <div className="flex gap-2 items-center">
            <Link href="/qr">
              <Button variant="outline">View QR Codes</Button>
            </Link>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline">
                  <LogOut className="h-4 w-4 mr-2" />
                  Logout
                </Button>
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
            {currentRestaurant && (
              <ProfileMenu restaurantName={currentRestaurant.name} />
            )}
          </div>
        </div>

        {currentRestaurant ? (
          <>
            <FloorPlanEditor restaurantId={currentRestaurant.id} />

            {/* Active Requests Table */}
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Active Requests by Table</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[300px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Table</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Notes</TableHead>
                        <TableHead>Time</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(activeRequestsByTable).map(([tableId, { tableName, requests }]) => (
                        requests.map((request) => (
                          <TableRow key={request.id}>
                            <TableCell className="font-medium">Table {tableName}</TableCell>
                            <TableCell className="capitalize">{request.type}</TableCell>
                            <TableCell>{request.notes || "-"}</TableCell>
                            <TableCell>{new Date(request.createdAt).toLocaleTimeString()}</TableCell>
                            <TableCell className="capitalize">{request.status}</TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                onClick={() =>
                                  updateRequest({
                                    id: request.id,
                                    status: request.status === "pending" ? "in_progress" : "completed",
                                  })
                                }
                              >
                                {request.status === "pending" ? "Start" : "Complete"}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      ))}
                      {Object.keys(activeRequestsByTable).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground">
                            No active requests
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          </>
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
      </div>
    </div>
  );
}