import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest } from "@/lib/queryClient";
import { wsService } from "@/lib/ws";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import type { Request } from "@db/schema";

export default function AdminPage() {
  const { toast } = useToast();

  useEffect(() => {
    wsService.connect();
  }, []);

  const { data: requests = [], refetch } = useQuery<Request[]>({
    queryKey: ["/api/requests"],
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

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <Card className="max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">Service Requests</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="pending">
            <TabsList>
              <TabsTrigger value="pending">Pending</TabsTrigger>
              <TabsTrigger value="in_progress">In Progress</TabsTrigger>
              <TabsTrigger value="completed">Completed</TabsTrigger>
            </TabsList>
            {["pending", "in_progress", "completed"].map((status) => (
              <TabsContent key={status} value={status}>
                <div className="space-y-4">
                  {requests
                    .filter((r) => r.status === status)
                    .map((request) => (
                      <Card key={request.id}>
                        <CardContent className="flex items-center justify-between p-4">
                          <div>
                            <h3 className="font-medium">
                              Table {request.tableId} - {request.type}
                            </h3>
                            <p className="text-sm text-gray-500">
                              {new Date(request.createdAt).toLocaleTimeString()}
                            </p>
                          </div>
                          {status !== "completed" && (
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
                          )}
                        </CardContent>
                      </Card>
                    ))}
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}