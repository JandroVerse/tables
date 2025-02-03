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
        <button 
          onClick={(e) => {
            e.preventDefault();
            logoutMutation.mutate();
          }}
          disabled={logoutMutation.isPending}
          className={`inline-flex items-center justify-center text-sm font-medium transition-colors 
            focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring 
            disabled:pointer-events-none disabled:opacity-50
            hover:bg-destructive/10 px-4 py-2 h-9 rounded-md
            ${logoutMutation.isPending ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          {logoutMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <LogOut className="h-4 w-4 mr-2" />
          )}
          {logoutMutation.isPending ? "Logging out..." : "Logout"}
        </button>
      </div>
    </nav>
  );
}