import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GlassWater, Bell, Receipt, Clock } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { wsService } from "@/lib/ws";
import { useEffect } from "react";
import type { Request } from "@db/schema";

export default function TablePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const tableId = Number(new URLSearchParams(window.location.search).get("id"));

  useEffect(() => {
    wsService.connect();
    const unsubscribe = wsService.subscribe((data) => {
      if (data.type === "new_request" || data.type === "update_request") {
        queryClient.invalidateQueries({ queryKey: ["/api/requests", tableId] });
      }
    });
    return () => unsubscribe();
  }, [tableId, queryClient]);

  const { data: requests = [] } = useQuery<Request[]>({
    queryKey: ["/api/requests", tableId],
    enabled: !!tableId && !isNaN(tableId),
  });

  const { mutate: createRequest } = useMutation({
    mutationFn: async ({ type, notes }: { type: string; notes?: string }) => {
      const response = await apiRequest("POST", "/api/requests", { tableId, type, notes });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests", tableId] });
      toast({
        title: "Request sent",
        description: "Staff has been notified of your request.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to send request. Please try again.",
        variant: "destructive",
      });
      console.error("Failed to create request:", error);
    },
  });

  if (!tableId || isNaN(tableId)) return <div>Invalid table ID</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <Card className="max-w-md mx-auto">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-center">
            How can we help you?
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Button
              size="lg"
              className="h-24 flex flex-col items-center justify-center space-y-2"
              onClick={() => createRequest({ type: "waiter" })}
            >
              <Bell className="h-8 w-8" />
              <span>Call Waiter</span>
            </Button>
            <Button
              size="lg"
              className="h-24 flex flex-col items-center justify-center space-y-2"
              onClick={() => createRequest({ type: "water" })}
            >
              <GlassWater className="h-8 w-8" />
              <span>Water Refill</span>
            </Button>
            <Button
              size="lg"
              className="h-24 flex flex-col items-center justify-center space-y-2"
              onClick={() => createRequest({ type: "check" })}
            >
              <Receipt className="h-8 w-8" />
              <span>Get Check</span>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-24 flex flex-col items-center justify-center space-y-2"
              onClick={() => createRequest({ type: "other" })}
            >
              <Clock className="h-8 w-8" />
              <span>Other Request</span>
            </Button>
          </div>

          {requests.length > 0 && (
            <Tabs defaultValue="active" className="mt-8">
              <TabsList className="w-full">
                <TabsTrigger value="active" className="flex-1">Active Requests</TabsTrigger>
                <TabsTrigger value="completed" className="flex-1">Completed</TabsTrigger>
              </TabsList>
              <TabsContent value="active">
                <div className="space-y-2">
                  {requests
                    .filter((r) => r.status !== "completed")
                    .map((request) => (
                      <div key={request.id} className="p-4 bg-white rounded-lg shadow">
                        <div className="font-medium">{request.type}</div>
                        <div className="text-sm text-gray-500">Status: {request.status}</div>
                      </div>
                    ))}
                </div>
              </TabsContent>
              <TabsContent value="completed">
                <div className="space-y-2">
                  {requests
                    .filter((r) => r.status === "completed")
                    .map((request) => (
                      <div key={request.id} className="p-4 bg-white rounded-lg shadow">
                        <div className="font-medium">{request.type}</div>
                        <div className="text-sm text-gray-500">Completed</div>
                      </div>
                    ))}
                </div>
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}