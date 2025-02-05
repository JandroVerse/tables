import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
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
import { Trash2 } from "lucide-react";

interface Restaurant {
  id: number;
  name: string;
  address?: string;
  phone?: string;
}

interface User {
  id: number;
  username: string;
  email: string;
  password: string;
  role: "owner" | "staff";
  restaurants?: Restaurant[];
}

export default function UsersPage() {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();

  const { data: users = [], refetch } = useQuery<User[]>({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/users");
      if (!res.ok) throw new Error("Failed to fetch users");
      const users = await res.json();

      // Fetch restaurants for each user
      const usersWithRestaurants = await Promise.all(
        users.map(async (user) => {
          if (user.role === "owner") {
            const restaurantsRes = await apiRequest(
              "GET",
              `/api/restaurants?userId=${user.id}`
            );
            if (restaurantsRes.ok) {
              const restaurants = await restaurantsRes.json();
              return { ...user, restaurants };
            }
          }
          return { ...user, restaurants: [] };
        })
      );

      return usersWithRestaurants;
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: number) => {
      const res = await apiRequest("DELETE", `/api/users/${userId}`);
      if (!res.ok) throw new Error("Failed to delete user");
      return res.json();
    },
    onSuccess: () => {
      refetch();
      toast({
        title: "Success",
        description: "User has been deleted successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (!currentUser || currentUser.role !== "owner") {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              You do not have permission to view this page.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Function to truncate password
  const formatPassword = (password: string) => {
    if (password.length > 12) {
      return `${password.substring(0, 12)}...`;
    }
    return password;
  };

  return (
    <div className="container mx-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">User Management</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {users.map((user) => (
              <Card key={user.id}>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-2 flex-grow">
                      <p className="font-medium">{user.username}</p>
                      <p className="text-sm text-muted-foreground">{user.email}</p>
                      <p className="text-sm text-muted-foreground">
                        Password: {formatPassword(user.password)}
                      </p>
                      <p className="text-sm text-muted-foreground capitalize">
                        Role: {user.role}
                      </p>
                      {user.role === "owner" && user.restaurants && user.restaurants.length > 0 && (
                        <div className="mt-2">
                          <p className="text-sm font-medium">Restaurants:</p>
                          <ul className="list-disc list-inside">
                            {user.restaurants.map((restaurant) => (
                              <li key={restaurant.id} className="text-sm text-muted-foreground">
                                {restaurant.name}
                                {restaurant.address && ` - ${restaurant.address}`}
                                {restaurant.phone && ` - ${restaurant.phone}`}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                    {user.id !== currentUser.id && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="icon">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete User</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete this user? This action
                              cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteUserMutation.mutate(user.id)}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}