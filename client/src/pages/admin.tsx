import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { wsService } from "@/lib/ws";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import type { Request, Table } from "@db/schema";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function AdminPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newTableName, setNewTableName] = useState("");

  useEffect(() => {
    wsService.connect();
    const unsubscribe = wsService.subscribe((data) => {
      if (data.type === "new_request" || data.type === "update_request") {
        refetch();
      }
    });
    return () => unsubscribe();
  }, []);

  const { data: requests = [], refetch } = useQuery<Request[]>({
    queryKey: ["/api/requests"],
  });

  const { data: tables = [] } = useQuery<Table[]>({
    queryKey: ["/api/tables"],
  });

  const { mutate: createTable } = useMutation({
    mutationFn: async (name: string) => {
      return apiRequest("POST", "/api/tables", { name });
    },
    onSuccess: () => {
      toast({
        title: "Table created",
        description: "The table has been created successfully.",
      });
      setNewTableName("");
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

  // Helper function to get table name
  const getTableName = (tableId: number) => {
    const table = tables.find(t => t.id === tableId);
    return table ? table.name : `Table ${tableId}`;
  };

  const statuses = ["pending", "in_progress", "completed"] as const;
  const statusTitles = {
    pending: "Pending Requests",
    in_progress: "In Progress",
    completed: "Completed",
  };

  const getSortedRequests = (status: string) => {
    return requests
      .filter((r) => r.status === status)
      .sort((a, b) => {
        if (status === "completed") {
          // For completed requests, sort by completedAt in descending order (newest first)
          return new Date(b.completedAt || 0).getTime() - new Date(a.completedAt || 0).getTime();
        } else {
          // For other statuses, sort by createdAt in ascending order (oldest first)
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        }
      });
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-[1600px] mx-auto space-y-4">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">Restaurant Admin Dashboard</h1>
          <Link href="/qr">
            <Button variant="outline">View QR Codes</Button>
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Create New Table</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-4">
            <Input
              placeholder="Table name (e.g., Table 1)"
              value={newTableName}
              onChange={(e) => setNewTableName(e.target.value)}
            />
            <Button onClick={() => newTableName && createTable(newTableName)}>
              Create Table
            </Button>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {statuses.map((status) => (
            <Card key={status} className="h-[calc(100vh-300px)]">
              <CardHeader>
                <CardTitle>{statusTitles[status]}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[calc(100vh-400px)]">
                  <div className="space-y-2 p-4">
                    {getSortedRequests(status).map((request) => (
                      <Card key={request.id}>
                        <CardContent className="flex items-center justify-between p-4">
                          <div>
                            <h3 className="font-medium">
                              {getTableName(request.tableId)} - {request.type}
                            </h3>
                            {request.notes && (
                              <p className="text-sm text-gray-600 mt-1">
                                Request: {request.notes}
                              </p>
                            )}
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
                </ScrollArea>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}