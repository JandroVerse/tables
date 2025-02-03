import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { LogOut, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { Restaurant } from "@db/schema";

export function Navbar() {
  const { logoutMutation } = useAuth();
  const { data: restaurants = [] } = useQuery<Restaurant[]>({
    queryKey: ["/api/restaurants"],
  });

  const currentRestaurant = restaurants[0];

  return (
    <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center justify-between px-8">
        <div className="font-semibold text-lg">
          {currentRestaurant 
            ? `${currentRestaurant.name} Dashboard`
            : "Dashboard"}
        </div>
        <Button 
          variant="ghost" 
          size="sm"
          onClick={() => logoutMutation.mutate()}
          className="hover:bg-destructive/10"
        >
          {logoutMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <LogOut className="h-4 w-4 mr-2" />
          )}
          {logoutMutation.isPending ? "Logging out..." : "Logout"}
        </Button>
      </div>
    </nav>
  );
}