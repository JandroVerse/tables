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
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Create a new session when the component mounts
  useEffect(() => {
    if (tableId && !isNaN(tableId)) {
      apiRequest("POST", `/api/tables/${tableId}/sessions`)
        .then((res) => res.json())
        .then((session) => {
          setSessionId(session.sessionId);
          // Invalidate requests query to refresh with new session
          queryClient.invalidateQueries({ queryKey: ["/api/requests", tableId] });
        })
        .catch((error) => {
          console.error("Failed to create session:", error);
          toast({
            title: "Error",
            description: "Failed to initialize table session.",
            variant: "destructive",
          });
        });
    }
  }, [tableId]);

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
    queryFn: async () => {
      if (!sessionId) return [];
      const res = await fetch(`/api/requests?tableId=${tableId}&sessionId=${sessionId}`);
      if (!res.ok) throw new Error('Failed to fetch requests');
      return res.json();
    },
    enabled: !!tableId && !isNaN(tableId) && !!sessionId,
  });

  const { mutate: createRequest } = useMutation({
    mutationFn: async ({ type, notes }: { type: string; notes?: string }) => {
      if (!sessionId) throw new Error('No active session');
      const response = await apiRequest("POST", "/api/requests", { 
        tableId, 
        type, 
        notes,
        sessionId 
      });
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
  if (!sessionId) return <div>Initializing table session...</div>;

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
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white p-4">
      <Card className="max-w-md mx-auto shadow-lg border-0">
        <CardHeader className="pb-4">
          <CardTitle className="text-2xl font-bold text-center bg-gradient-to-r from-primary/90 to-primary bg-clip-text text-transparent">
            How can we help you?
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <Button
              size="lg"
              className="h-28 flex flex-col items-center justify-center space-y-3 transition-all hover:scale-105 active:scale-95"
              onClick={() => createRequest({ type: "waiter" })}
              disabled={hasActiveRequest("waiter")}
              title={hasActiveRequest("waiter") ? "A waiter is already on their way" : ""}
            >
              <Bell className="h-8 w-8" />
              <span className="font-medium">Call Waiter</span>
            </Button>
            <Button
              size="lg"
              className="h-28 flex flex-col items-center justify-center space-y-3 transition-all hover:scale-105 active:scale-95"
              onClick={() => createRequest({ type: "water" })}
              disabled={hasActiveRequest("water")}
              title={hasActiveRequest("water") ? "Water refill request is being processed" : ""}
            >
              <GlassWater className="h-8 w-8" />
              <span className="font-medium">Water Refill</span>
            </Button>
            <Button
              size="lg"
              className="h-28 flex flex-col items-center justify-center space-y-3 transition-all hover:scale-105 active:scale-95"
              onClick={() => createRequest({ type: "check" })}
              disabled={hasActiveRequest("check")}
              title={hasActiveRequest("check") ? "Check request is being processed" : ""}
            >
              <Receipt className="h-8 w-8" />
              <span className="font-medium">Get Check</span>
            </Button>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen} preventScroll={true}>
              <Button
                size="lg"
                variant="outline"
                className="h-28 flex flex-col items-center justify-center space-y-3 transition-all hover:scale-105 active:scale-95 hover:border-primary/50"
                onClick={() => setIsDialogOpen(true)}
              >
                <Clock className="h-8 w-8" />
                <span className="font-medium">Other Request</span>
              </Button>
              <DialogContent>
                <DialogHeader className="p-6 pb-0">
                  <DialogTitle className="text-xl font-semibold">Other Request</DialogTitle>
                </DialogHeader>
                <div className="px-6 py-4">
                  <div className="space-y-3">
                    <Label htmlFor="message" className="text-sm font-medium">
                      Your Request
                    </Label>
                    <Input
                      id="message"
                      placeholder="Type your request here..."
                      value={otherRequestNote}
                      onChange={(e) => setOtherRequestNote(e.target.value)}
                      className="min-h-[40px]"
                      autoFocus={false}
                      tabIndex={-1}
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
              <TabsList className="w-full grid grid-cols-2">
                <TabsTrigger value="active">Active Requests</TabsTrigger>
                <TabsTrigger value="completed">Completed</TabsTrigger>
              </TabsList>
              <TabsContent value="active" className="mt-4">
                <div className="space-y-3">
                  {requests
                    .filter((r) => r.status !== "completed")
                    .map((request) => (
                      <Card key={request.id} className="overflow-hidden transition-colors hover:bg-green-50/50">
                        <CardContent className="p-4">
                          <div className="font-medium text-primary">{request.type}</div>
                          {request.notes && (
                            <div className="text-sm text-gray-600 mt-2">{request.notes}</div>
                          )}
                          <div className="text-sm text-gray-500 mt-2">
                            Status: <span className="capitalize">{request.status.replace('_', ' ')}</span>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                </div>
              </TabsContent>
              <TabsContent value="completed" className="mt-4">
                <div className="space-y-3">
                  {requests
                    .filter((r) => r.status === "completed")
                    .map((request) => (
                      <Card key={request.id} className="overflow-hidden transition-colors hover:bg-green-50/50">
                        <CardContent className="p-4">
                          <div className="font-medium text-primary">{request.type}</div>
                          {request.notes && (
                            <div className="text-sm text-gray-600 mt-2">{request.notes}</div>
                          )}
                          <div className="flex justify-between items-center mt-3">
                            <div className="text-sm text-gray-500">Completed</div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setFeedbackRequest(request)}
                              className="hover:border-primary/50"
                            >
                              Rate Service
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
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