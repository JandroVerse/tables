import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Minus, GlassWater, Bell, Receipt, Copy } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { wsService } from "@/lib/ws";
import { useEffect, useState } from "react";
import type { Request, Table } from "@db/schema";
import { motion } from "framer-motion";
import { useParams, useLocation } from "wouter";

export default function TablePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const params = useParams();
  const [, setLocation] = useLocation();

  const restaurantId = Number(params.restaurantId);
  const tableId = Number(params.tableId);

  // Core state
  const [isValidating, setIsValidating] = useState(true);
  const [isValid, setIsValid] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(() => {
    const savedSession = localStorage.getItem(`table_session_${tableId}`);
    if (savedSession) {
      try {
        const { sessionId } = JSON.parse(savedSession);
        return sessionId;
      } catch (e) {
        localStorage.removeItem(`table_session_${tableId}`);
      }
    }
    return null;
  });

  // UI state
  const [otherRequestNote, setOtherRequestNote] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isWaterDialogOpen, setIsWaterDialogOpen] = useState(false);
  const [waterCount, setWaterCount] = useState(1);
  const [isSessionPromptOpen, setIsSessionPromptOpen] = useState(false);
  const [sessionInputValue, setSessionInputValue] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [isSessionEnded, setIsSessionEnded] = useState(false);

  // Get restaurant data
  const { data: currentRestaurant, isLoading: isRestaurantLoading } = useQuery({
    queryKey: [`/api/restaurants/${restaurantId}`],
    queryFn: async () => {
      const response = await fetch(`/api/restaurants/${restaurantId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch restaurant: ${response.status}`);
      }
      return response.json();
    },
    enabled: !!restaurantId && !isNaN(restaurantId),
  });

  // Get table requests
  const { data: requests = [] } = useQuery<Request[]>({
    queryKey: ["/api/requests", tableId],
    queryFn: async () => {
      if (!sessionId) return [];
      const res = await fetch(`/api/requests?tableId=${tableId}&sessionId=${sessionId}`);
      if (!res.ok) throw new Error("Failed to fetch requests");
      return res.json();
    },
    enabled: !!tableId && !isNaN(tableId) && !!sessionId,
    refetchInterval: 5000
  });

  // Handle websocket connections
  useEffect(() => {
    wsService.connect();

    const unsubscribe = wsService.subscribe((data) => {
      console.log('Received WebSocket message:', data);

      switch (data.type) {
        case "new_request":
        case "update_request":
          if (data.tableId === tableId) {
            queryClient.invalidateQueries({ queryKey: ["/api/requests", tableId] });
          }
          break;
        case "end_session":
          if (data.tableId === tableId) {
            localStorage.removeItem(`table_session_${tableId}`);
            setSessionId(null);
            setIsSessionEnded(true);
            setLocation('/session-ended');
          }
          break;
      }
    });

    return () => {
      unsubscribe();
      wsService.disconnect();
    };
  }, [tableId, queryClient, setLocation]);

  // Verify table and session
  useEffect(() => {
    if (!restaurantId || !tableId || isNaN(restaurantId) || isNaN(tableId)) {
      setIsValidating(false);
      setIsValid(false);
      return;
    }

    const verifyTable = async () => {
      try {
        const response = await fetch(`/api/restaurants/${restaurantId}/tables/${tableId}/verify`);
        if (!response.ok) {
          throw new Error(`Failed to verify table: ${response.status}`);
        }

        const data = await response.json();
        console.log('Table verification response:', data);

        if (data.valid) {
          setIsValid(true);
          if (data.activeSession) {
            if (!sessionId) {
              const sessionData = {
                sessionId: data.activeSession.id,
                startedAt: data.activeSession.startedAt,
              };
              localStorage.setItem(`table_session_${tableId}`, JSON.stringify(sessionData));
              setSessionId(data.activeSession.id);
            }
          } else if (!sessionId) {
            console.log('Creating new session...');
            const sessionResponse = await fetch(
              `/api/restaurants/${restaurantId}/tables/${tableId}/sessions`,
              { method: 'POST' }
            );

            if (!sessionResponse.ok) {
              throw new Error('Failed to create session');
            }

            const session = await sessionResponse.json();
            console.log('New session created:', session);

            const sessionData = {
              sessionId: session.sessionId,
              startedAt: session.startedAt,
            };
            localStorage.setItem(`table_session_${tableId}`, JSON.stringify(sessionData));
            setSessionId(session.sessionId);
          }
        } else {
          setIsValid(false);
        }
      } catch (error) {
        console.error('Table verification error:', error);
        toast({
          title: "Error",
          description: "Failed to verify table. Please try again.",
          variant: "destructive",
        });
        setIsValid(false);
      } finally {
        setIsValidating(false);
      }
    };

    verifyTable();
  }, [restaurantId, tableId, sessionId, toast]);

  // Loading state
  if (isValidating || isRestaurantLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-[90%] max-w-md">
          <CardHeader>
            <CardTitle>Loading...</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              {isValidating ? "Verifying table information..." : "Loading restaurant details..."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Invalid table state
  if (!isValid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-[90%] max-w-md">
          <CardHeader>
            <CardTitle>Invalid Table</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              This table appears to be invalid or no longer exists. Please scan a valid QR code.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Session ended state
  if (isSessionEnded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-[90%] max-w-md">
          <CardHeader>
            <CardTitle>Session Ended</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              This table's session has ended. Please scan the QR code again to start a new session.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="container mx-auto max-w-4xl p-4"
      >
        <Card className="mb-4">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Share this session ID:</p>
                <p className="text-lg font-mono font-bold">{sessionId}</p>
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  if (sessionId) {
                    navigator.clipboard.writeText(sessionId);
                    toast({
                      title: "Copied!",
                      description: "Session ID copied to clipboard",
                    });
                  }
                }}
                className="h-8 w-8"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Requests</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="active">
              <TabsList className="grid grid-cols-2">
                <TabsTrigger value="active">Active</TabsTrigger>
                <TabsTrigger value="completed">Completed</TabsTrigger>
              </TabsList>

              <TabsContent value="active" className="mt-4">
                {requests
                  .filter((r) => !["completed", "cleared"].includes(r.status))
                  .map((request) => (
                    <motion.div
                      key={request.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      className="mb-4"
                    >
                      <Card className={
                        request.type === "waiter" ? "bg-purple-50 hover:bg-purple-100" :
                        request.type === "water" ? "bg-blue-50 hover:bg-blue-100" :
                        request.type === "check" ? "bg-emerald-50 hover:bg-emerald-100" :
                        "bg-gray-50 hover:bg-gray-100"
                      }>
                        <CardContent className="p-4">
                          <div className="flex justify-between items-center">
                            <div>
                              <h3 className="font-medium">
                                {request.type === "water" ? "Water Refill" :
                                 request.type === "waiter" ? "Call Waiter" :
                                 request.type === "check" ? "Get Check" :
                                 request.type}
                                 {request.table?.name && ` - Table ${request.table.name}`}
                              </h3>
                              {request.notes && (
                                <p className="text-sm text-gray-600">{request.notes}</p>
                              )}
                            </div>
                            <div className="text-sm">
                              Status: <span className="capitalize">{request.status}</span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
              </TabsContent>

              <TabsContent value="completed" className="mt-4">
                {requests
                  .filter((r) => ["completed", "cleared"].includes(r.status))
                  .map((request) => (
                    <motion.div
                      key={request.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      className="mb-4"
                    >
                      <Card className="bg-gray-50">
                        <CardContent className="p-4">
                          <div className="flex justify-between items-center">
                            <div>
                              <h3 className="font-medium">
                                {request.type}
                                {request.table?.name && ` - Table ${request.table.name}`}
                              </h3>
                              {request.notes && (
                                <p className="text-sm text-gray-600">{request.notes}</p>
                              )}
                            </div>
                            <div className="text-sm">
                              Status: <span className="capitalize">{request.status}</span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}