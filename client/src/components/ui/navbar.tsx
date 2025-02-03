import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { LogOut, Loader2 } from "lucide-react";

export function Navbar() {
  const { logoutMutation } = useAuth();

  return (
    <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center justify-between">
        <div className="font-semibold">Restaurant Manager</div>
        <Button 
          variant="ghost" 
          size="sm"
          onClick={() => logoutMutation.mutate()}
          disabled={logoutMutation.isPending}
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