import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GlassWater, Bell, Receipt, Clock } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { wsService } from "@/lib/ws";
import { useEffect, useState } from "react";
import type { Request } from "@db/schema";
import { FeedbackDialog } from "@/components/feedback-dialog";

export default function TablePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const tableId = Number(new URLSearchParams(window.location.search).get("id"));
  const [otherRequestNote, setOtherRequestNote] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [feedbackRequest, setFeedbackRequest] = useState<Request | null>(null);

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
      setOtherRequestNote("");
      setIsDialogOpen(false);
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

  // Check if there's an active request of a specific type
  const hasActiveRequest = (type: string) => {
    return requests.some(
      (request) => request.type === type && request.status !== "completed"
    );
  };

  const handleOtherRequest = () => {
    if (!otherRequestNote.trim()) {
      toast({
        title: "Error",
        description: "Please enter a message for your request.",
        variant: "destructive",
      });
      return;
    }
    // Check if there's already an active "other" request with the same note
    if (hasActiveRequest("other") && requests.some(
      (r) => r.type === "other" && 
            r.notes === otherRequestNote && 
            r.status !== "completed"
    )) {
      toast({
        title: "Request already exists",
        description: "This request is already being processed.",
        variant: "destructive",
      });
      return;
    }
    createRequest({ type: "other", notes: otherRequestNote });
  };

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
              disabled={hasActiveRequest("waiter")}
              title={hasActiveRequest("waiter") ? "A waiter is already on their way" : ""}
            >
              <Bell className="h-8 w-8" />
              <span>Call Waiter</span>
            </Button>
            <Button
              size="lg"
              className="h-24 flex flex-col items-center justify-center space-y-2"
              onClick={() => createRequest({ type: "water" })}
              disabled={hasActiveRequest("water")}
              title={hasActiveRequest("water") ? "Water refill request is being processed" : ""}
            >
              <GlassWater className="h-8 w-8" />
              <span>Water Refill</span>
            </Button>
            <Button
              size="lg"
              className="h-24 flex flex-col items-center justify-center space-y-2"
              onClick={() => createRequest({ type: "check" })}
              disabled={hasActiveRequest("check")}
              title={hasActiveRequest("check") ? "Check request is being processed" : ""}
            >
              <Receipt className="h-8 w-8" />
              <span>Get Check</span>
            </Button>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <Button
                size="lg"
                variant="outline"
                className="h-24 flex flex-col items-center justify-center space-y-2"
                onClick={() => setIsDialogOpen(true)}
              >
                <Clock className="h-8 w-8" />
                <span>Other Request</span>
              </Button>
              <DialogContent className="fixed p-0 bottom-0 left-0 right-0 sm:relative sm:rounded-lg">
                <DialogHeader className="p-6 pb-0">
                  <DialogTitle>Other Request</DialogTitle>
                </DialogHeader>
                <div className="px-6 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="message">Your Request</Label>
                    <Input
                      id="message"
                      placeholder="Type your request here..."
                      value={otherRequestNote}
                      onChange={(e) => setOtherRequestNote(e.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter className="p-6 pt-0">
                  <Button onClick={handleOtherRequest} className="w-full">
                    Send Request
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
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
                        {request.notes && (
                          <div className="text-sm text-gray-600 mt-1">{request.notes}</div>
                        )}
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
                        {request.notes && (
                          <div className="text-sm text-gray-600 mt-1">{request.notes}</div>
                        )}
                        <div className="flex justify-between items-center mt-2">
                          <div className="text-sm text-gray-500">Completed</div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setFeedbackRequest(request)}
                          >
                            Rate Service
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>
              </TabsContent>
            </Tabs>
          )}

          {feedbackRequest && (
            <FeedbackDialog
              request={feedbackRequest}
              open={true}
              onClose={() => setFeedbackRequest(null)}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}