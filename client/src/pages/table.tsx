import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Minus, GlassWater, Bell, Receipt, Clock, Copy } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { wsService } from "@/lib/ws";
import { useEffect, useState } from "react";
import type { Request, Table } from "@db/schema";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { motion, AnimatePresence } from "framer-motion";
import { useParams, useLocation } from "wouter";

const cardVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, x: -20 },
};

const buttonVariants = {
  idle: { scale: 1 },
  hover: { scale: 1.05 },
  tap: { scale: 0.95 },
};

const statusVariants = {
  pending: { color: "#71717a" },
  in_progress: { color: "#059669" },
  completed: { color: "#0284c7" },
  cleared: { color: "#71717a" },
};

export default function TablePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const params = useParams();
  const [, setLocation] = useLocation();

  const restaurantId = Number(params.restaurantId);
  const tableId = Number(params.tableId);

  const [otherRequestNote, setOtherRequestNote] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [feedbackRequest, setFeedbackRequest] = useState<Request | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(() => {
    const savedSession = localStorage.getItem(`table_session_${tableId}`);
    if (savedSession) {
      try {
        const { sessionId, startedAt, isCreator } = JSON.parse(savedSession);
        return sessionId;
      } catch (e) {
        localStorage.removeItem(`table_session_${tableId}`);
      }
    }
    return null;
  });

  const [isSessionCreator, setIsSessionCreator] = useState<boolean>(() => {
    const savedSession = localStorage.getItem(`table_session_${tableId}`);
    if (savedSession) {
      try {
        const { isCreator } = JSON.parse(savedSession);
        return !!isCreator;
      } catch (e) {
        return false;
      }
    }
    return false;
  });

  const [isWaterDialogOpen, setIsWaterDialogOpen] = useState(false);
  const [waterCount, setWaterCount] = useState(1);
  const [isValidating, setIsValidating] = useState(true);
  const [isValid, setIsValid] = useState(false);
  const [isSessionPromptOpen, setIsSessionPromptOpen] = useState(false);
  const [sessionInputValue, setSessionInputValue] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isSessionEnded, setIsSessionEnded] = useState(false);
  const [currentRestaurant, setCurrentRestaurant] = useState<any | null>(null);


  const handleSessionSubmit = () => {
    if (!sessionInputValue) {
      setSessionError("Please enter a session ID");
      return;
    }

    if (sessionInputValue !== currentSessionId) {
      setSessionError("Invalid session ID");
      return;
    }

    const sessionData = {
      sessionId: sessionInputValue,
      startedAt: new Date().toISOString(),
      isCreator: false
    };
    localStorage.setItem(
      `table_session_${tableId}`,
      JSON.stringify(sessionData)
    );
    setSessionId(sessionInputValue);
    setIsSessionPromptOpen(false);
    queryClient.invalidateQueries({ queryKey: ["/api/requests", tableId] });
  };

  // Verify table and manage session
  useEffect(() => {
    if (restaurantId && tableId && !isNaN(restaurantId) && !isNaN(tableId)) {
      fetch(`/api/restaurants/${restaurantId}/tables/${tableId}/verify`)
        .then((res) => res.json())
        .then((data) => {
          if (data.valid) {
            setIsValid(true);
            if (data.activeSession) {
              if (!sessionId || (data.activeSession.id !== sessionId && !isSessionCreator)) {
                setCurrentSessionId(data.activeSession.id);
                setIsSessionPromptOpen(true);
              }
              // Update localStorage with server's session start time
              const savedSession = localStorage.getItem(`table_session_${tableId}`);
              if (savedSession) {
                const sessionData = JSON.parse(savedSession);
                sessionData.startedAt = data.activeSession.startedAt;
                localStorage.setItem(
                  `table_session_${tableId}`,
                  JSON.stringify(sessionData)
                );
              }
            } else if (data.shouldClearSession) {
              // Clear session and redirect if server indicates session is invalid
              localStorage.removeItem(`table_session_${tableId}`);
              setLocation('/session-ended');
            } else if (data.requiresNewSession && !sessionId) {
              return apiRequest("POST", `/api/restaurants/${restaurantId}/tables/${tableId}/sessions`);
            }
            return null;
          }
          throw new Error("Invalid table");
        })
        .then((res) => {
          if (res) return res.json();
          return null;
        })
        .then((session) => {
          if (session) {
            const sessionData = {
              sessionId: session.sessionId,
              startedAt: session.startedAt,
              isCreator: true
            };
            localStorage.setItem(
              `table_session_${tableId}`,
              JSON.stringify(sessionData)
            );
            setCurrentSessionId(session.sessionId);
            setSessionId(session.sessionId);
            setIsSessionCreator(true);
            queryClient.invalidateQueries({ queryKey: ["/api/requests", tableId] });
            toast({
              title: "Session Created",
              description: `Your session ID is: ${session.sessionId}. Share this with others who want to join this table.`,
            });
          }
        })
        .catch((error) => {
          console.error("Failed to verify table or create session:", error);
          toast({
            title: "Error",
            description: "This table appears to be invalid or no longer exists. Please refresh the page.",
            variant: "destructive",
          });
        })
        .finally(() => {
          setIsValidating(false);
        });
    }
  }, [restaurantId, tableId]);

  useEffect(() => {
    if (!restaurantId || !tableId || !sessionId) return;

    const validateSession = async () => {
      try {
        const response = await fetch(`/api/restaurants/${restaurantId}/tables/${tableId}/verify`);
        const data = await response.json();

        // Handle different session states
        if (data.shouldClearSession) {
          // Session is explicitly ended or expired
          localStorage.removeItem(`table_session_${tableId}`);
          setSessionId(null); // Clear session ID to stop further validation
          setLocation('/session-ended');
          return false; // Return false to indicate session is invalid
        } else if (data.activeSession) {
          if (data.activeSession.id !== sessionId) {
            // Different active session exists
            setCurrentSessionId(data.activeSession.id);
            setIsSessionPromptOpen(true);
          }
        } else if (data.requiresNewSession && !sessionId) {
          // No active session exists, and we don't have a session
          return apiRequest("POST", `/api/restaurants/${restaurantId}/tables/${tableId}/sessions`);
        }
        return true; // Session is still valid
      } catch (error) {
        console.error('Error validating session:', error);
        toast({
          title: "Error",
          description: "Your session has expired. Please scan the QR code again to start a new session.",
          variant: "destructive",
        });
        return false; // Return false to indicate session is invalid
      }
    };

    // Initial validation
    validateSession();

    // Set up periodic validation only if we have a valid session
    const interval = setInterval(async () => {
      const isValid = await validateSession();
      if (!isValid) {
        // If session becomes invalid, clear the interval
        clearInterval(interval);
      }
    }, 10000); // Check every 10 seconds

    // Cleanup function
    return () => {
      clearInterval(interval);
    };
  }, [restaurantId, tableId, sessionId, setLocation, toast]);

  // Update the useEffect for WebSocket handling
  useEffect(() => {
    wsService.connect();

    const unsubscribe = wsService.subscribe((data) => {
      console.log('Received WebSocket message in table component:', data);

      // Handle different types of WebSocket messages
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
            wsService.disconnect(); // Disconnect WebSocket when session ends
          }
          break;
      }
    });

    // Reconnection logic
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('Page became visible, reconnecting WebSocket');
        wsService.connect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      unsubscribe();
      wsService.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [tableId, queryClient, setLocation]);

  const { data: requests = [], refetch: refetchRequests } = useQuery<RequestWithTable[]>({
    queryKey: ["/api/requests", tableId],
    queryFn: async () => {
      if (!sessionId) return [];
      const res = await fetch(`/api/requests?tableId=${tableId}&sessionId=${sessionId}`);
      if (!res.ok) throw new Error("Failed to fetch requests");
      return res.json();
    },
    enabled: !!tableId && !isNaN(tableId) && !!sessionId,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    staleTime: 0,
    refetchInterval: 5000
  });

  const hasActiveRequest = (type: string) => {
    return requests.some(
      (request) =>
        request.type === type &&
        request.status !== "completed" &&
        request.status !== "cleared"
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

  const { mutate: createRequest } = useMutation({
    mutationFn: async ({ type, notes }: { type: string; notes?: string }) => {
      if (!sessionId) throw new Error("No active session");
      const response = await apiRequest("POST", "/api/requests", {
        tableId,
        type,
        notes,
        sessionId,
      });

      if (response.status === 403) {
        const data = await response.json();
        if (data.shouldClearSession) {
          localStorage.removeItem(`table_session_${tableId}`);
          setLocation('/session-ended');
          throw new Error("Your session has expired. Please refresh the page to start a new session.");
        }
        throw new Error(data.message);
      }

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
        description: error.message,
        variant: "destructive",
      });
      console.error("Failed to create request:", error);
    },
  });

  const { mutate: cancelRequest } = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("PATCH", `/api/requests/${id}`, { status: "cleared" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests", tableId] });
      toast({
        title: "Request cancelled",
        description: "Your request has been cancelled successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to cancel request. Please try again.",
        variant: "destructive",
      });
      console.error("Failed to cancel request:", error);
    },
  });

  const copySessionId = () => {
    if (sessionId) {
      navigator.clipboard.writeText(sessionId);
      toast({
        title: "Copied!",
        description: "Session ID copied to clipboard",
      });
    }
  };

  // Update the session end mutation
  const { mutate: endSession } = useMutation({
    mutationFn: async () => {
      if (!sessionId) throw new Error("No active session");
      const response = await apiRequest(
        "POST",
        `/api/restaurants/${restaurantId}/tables/${tableId}/sessions/end`,
        { sessionId }
      );
      return response.json();
    },
    onSuccess: () => {
      localStorage.removeItem(`table_session_${tableId}`);
      setSessionId(null); // Clear session ID immediately
      toast({
        title: "Session Ended",
        description: "Table session has been closed successfully.",
      });
      setLocation('/session-ended');
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to end session. Please try again.",
        variant: "destructive",
      });
      console.error("Failed to end session:", error);
    },
  });

  useEffect(() => {
    if (isSessionEnded) {
      // First clear all table session data
      const currentKey = `table_session_${tableId}`;
      localStorage.removeItem(currentKey);
      setSessionId(null); // Ensure session ID is cleared

      // Then redirect to session-ended
      setLocation('/session-ended');
    }
  }, [isSessionEnded, tableId, setLocation]);


  if (isSessionEnded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
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

  if (!restaurantId || !tableId || isNaN(restaurantId) || isNaN(tableId)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card>
          <CardHeader>
            <CardTitle>Invalid Table</CardTitle>
          </CardHeader>
          <CardContent>
            <p>This table appears to be invalid. Please scan a valid QR code.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isValidating) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card>
          <CardHeader>
            <CardTitle>Loading...</CardTitle>
          </CardHeader>
          <CardContent>
            <p>Verifying table information...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isValid) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card>
          <CardHeader>
            <CardTitle>Invalid Table</CardTitle>
          </CardHeader>
          <CardContent>
            <p>This table appears to be invalid or no longer exists. Please scan a valid QR code.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isSessionPromptOpen) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-[90%] max-w-md">
          <CardHeader>
            <CardTitle>Enter Session ID</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="sessionId">Session ID</Label>
                <Input
                  id="sessionId"
                  value={sessionInputValue}
                  onChange={(e) => {
                    setSessionInputValue(e.target.value);
                    setSessionError("");
                  }}
                  placeholder="Enter the session ID shared with you"
                />
                {sessionError && (
                  <p className="text-sm text-red-500">{sessionError}</p>
                )}
              </div>
              <Button
                className="w-full"
                onClick={handleSessionSubmit}
              >
                Join Session
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!sessionId) return <div>Initializing table session...</div>;

  const renderRequests = (requestsToRender: RequestWithTable[]) => {
    // Group similar requests by type, notes, and status
    const activeStatuses = ["pending", "in_progress"];
    const groupedRequests = requestsToRender.reduce((acc, request) => {
      // Only group active requests (pending or in_progress)
      if (!activeStatuses.includes(request.status)) {
        // For completed or cleared requests, create individual entries
        acc[`single-${request.id}`] = {
          request,
          count: 1,
          ids: [request.id]
        };
        return acc;
      }

      // For active requests, group by type and notes
      const key = `${request.type}-${request.notes || ''}-${request.status}`;
      if (!acc[key]) {
        acc[key] = {
          request,
          count: 1,
          ids: [request.id]
        };
      } else {
        acc[key].count++;
        acc[key].ids.push(request.id);
      }
      return acc;
    }, {} as Record<string, { request: RequestWithTable; count: number; ids: number[] }>);

    return (
      <AnimatePresence mode="popLayout">
        <div className="space-y-3">
          {Object.values(groupedRequests).map(({ request, count, ids }) => (
            <motion.div
              key={ids.join('-')}
              layout
              variants={cardVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{
                layout: { duration: 0.3 },
                opacity: { duration: 0.2 },
              }}
            >
              <Card
                className={`overflow-hidden transition-colors ${
                  request.type === "waiter"
                    ? "hover:bg-purple-300 bg-purple-200"
                    : request.type === "water"
                    ? "hover:bg-blue-200 bg-blue-100"
                    : request.type === "check"
                    ? "hover:bg-emerald-300 bg-emerald-200"
                    : "hover:bg-green-50/50"
                }`}
              >
                <CardContent className="p-4">
                  <div className="font-medium text-primary relative">
                    {request.type === "water" ? `Table ${request.table?.name} - Water Refill` :
                      request.type === "waiter" ? `Table ${request.table?.name} - Call Waiter` :
                        request.type === "check" ? `Table ${request.table?.name} - Get Check` :
                          `Table ${request.table?.name} - ${request.type}`}
                    {count > 1 && (
                      <span className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">
                        {count}
                      </span>
                    )}
                  </div>
                  {request.notes && (
                    <div className="text-sm text-gray-600 mt-2">
                      {request.notes}
                    </div>
                  )}
                  <div className="flex justify-between items-center mt-2">
                    <motion.div
                      className="text-sm"
                      variants={statusVariants}
                      animate={request.status as keyof typeof statusVariants}
                      transition={{ duration: 0.3 }}
                    >
                      Status:{" "}
                      <span className="capitalize">
                        {request.status === "in_progress" ? "In Progress" :
                          request.status === "pending" ? "Pending" :
                            request.status === "completed" ? "Completed" :
                              request.status === "cleared" ? "Cancelled" :
                                request.status}
                      </span>
                    </motion.div>
                    {request.status === "pending" && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <motion.div
                            variants={buttonVariants}
                            initial="idle"
                            whileHover="hover"
                            whileTap="tap"
                          >
                            <Button variant="outline" size="sm">
                              Cancel Request{count > 1 ? 's' : ''}
                            </Button>
                          </motion.div>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Cancel Request{count > 1 ? 's' : ''}?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to cancel {count > 1 ? 'these' : 'this'}{' '}
                              request{count > 1 ? 's' : ''}? This action cannot be
                              undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>
                              No, keep {count > 1 ? 'them' : 'it'}
                            </AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() =>
                                ids.forEach(id => cancelRequest(id))
                              }
                            >
                              Yes, cancel {count > 1 ? 'them' : 'it'}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </AnimatePresence>
    );
  };

  useEffect(() => {
    const fetchRestaurant = async () => {
      try {
        const response = await fetch(`/api/restaurants/${restaurantId}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch restaurant: ${response.status}`);
        }
        const data = await response.json();
        setCurrentRestaurant(data);
      } catch (error) {
        console.error("Error fetching restaurant:", error);
        // Handle error appropriately, perhaps display a message
      }
    };

    if (restaurantId) {
      fetchRestaurant();
    }
  }, [restaurantId]);

  return (
    <div className="min-h-screen bg-background">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative container mx-auto max-w-4xl p-4"
      >
        <Card className="mb-4">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Share this session ID with your table:</p>
                <p className="text-lg font-mono font-bold text-foreground">{sessionId}</p>
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={copySessionId}
                className="h-8 w-8"
                title="Copy session ID"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-lg">
          <CardHeader className="pb-4">
            <CardTitle className="text-2xl font-bold text-center">
              How can we help you?
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <motion.div
                variants={buttonVariants}
                initial="idle"
                whileHover="hover"
                whileTap="tap"
              >
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="lg"
                      className="h-28 w-full flex flex-col items-center justify-center space-y-3 bg-primary hover:bg-primary/90"
                      disabled={hasActiveRequest("waiter")}
                      title={
                        hasActiveRequest("waiter")
                          ? "Waiter request is being processed"
                          : ""
                      }
                    >
                      <Bell className="h-8 w-8" />
                      <span className="font-medium">Call Waiter</span>
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-white dark:bg-slate-900">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Call Waiter</AlertDialogTitle>
                      <AlertDialogDescription>
                        Would you like to call a waiter to your table?
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => createRequest({ type: "waiter" })}
                      >
                        Yes, Call Waiter
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </motion.div>

              <Dialog open={isWaterDialogOpen} onOpenChange={setIsWaterDialogOpen}>
                <motion.div
                  variants={buttonVariants}
                  initial="idle"
                  whileHover="hover"
                  whileTap="tap"
                >
                  <Button
                    size="lg"
                    className="h-28 w-full flex flex-col items-center justify-center space-y-3 bg-blue-500 hover:bg-blue-600"
                    onClick={() => setIsWaterDialogOpen(true)}
                    disabled={hasActiveRequest("water")}
                    title={
                      hasActiveRequest("water")
                        ? "Water refill request is being processed"
                        : ""
                    }
                  >
                    <GlassWater className="h-8 w-8" />
                    <span className="font-medium">Water Refill</span>
                  </Button>
                </motion.div>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>How many waters would you like?</DialogTitle>
                  </DialogHeader>
                  <div className="py-6">
                    <div className="flex items-center justify-center gap-4">
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setWaterCount(Math.max(1, waterCount - 1))}
                        className="h-8 w-8"
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <span className="text-2xl font-semibold w-12 text-center">
                        {waterCount}
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setWaterCount(Math.min(10, waterCount + 1))}
                        className="h-8 w-8"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      onClick={() => {
                        createRequest({
                          type: "water",
                          notes: `${waterCount} water${
                            waterCount > 1 ? "s" : ""
                          }`,
                        });
                        setIsWaterDialogOpen(false);
                        setWaterCount(1);
                      }}
                    >
                      Confirm
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <motion.div
                variants={buttonVariants}
                initial="idle"
                whileHover="hover"
                whileTap="tap"
              >
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="lg"
                      className="h-28 w-full flex flex-col items-center justify-center space-y-3 bg-green-500 hover:bg-green-600"
                      disabled={hasActiveRequest("check")}
                      title={
                        hasActiveRequest("check")
                          ? "Check request is being processed"
                          : ""
                      }
                    >
                      <Receipt className="h-8 w-8" />
                      <span className="font-medium">Get Check</span>
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-white dark:bg-slate-900">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Request Check</AlertDialogTitle>
                      <AlertDialogDescription>
                        Would you like to request the check for your table?
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => createRequest({ type: "check" })}
                      >
                        Yes, Get Check
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </motion.div>

              <div className="space-y-4">
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                  <DialogTrigger asChild>
                    <Button
                      size="lg"
                      className="h-28 w-full flex flex-col items-center justify-center space-y-3 bg-gray-500 hover:bg-gray-600"
                    >
                      <Plus className="h-8 w-8" />
                      <span className="font-medium">Other Request</span>
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="bg-white dark:bg-slate-900">
                    <DialogHeader>
                      <DialogTitle>Other Request</DialogTitle>
                    </DialogHeader>
                    <div className="p-6 pt-2">
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="notes">Message</Label>
                          <Input
                            id="notes"
                            value={otherRequestNote}
                            onChange={(e) => setOtherRequestNote(e.target.value)}
                            placeholder="Enter your request..."
                          />
                        </div>
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
            </div>

            {requests.length > 0 && (
              <Tabs defaultValue="active" className="w-full mt-8">
                <TabsList className="w-full">
                  <TabsTrigger value="active" className="flex-1">
                    Active Requests
                  </TabsTrigger>
                  <TabsTrigger value="completed" className="flex-1">
                    Completed
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="active" className="mt-4">
                  {renderRequests(
                    requests.filter(
                      (r) => !["completed", "cleared"].includes(r.status)
                    )
                  )}
                </TabsContent>
                <TabsContent value="completed" className="mt-4">
                  {renderRequests(
                    requests.filter((r) =>
                      ["completed", "cleared"].includes(r.status)
                    )
                  )}
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

        {isSessionCreator && (
          <div className="mt-6">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  className="w-full"
                >
                  End Table Session
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>End Table Session?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will end the current session for all users at this table.
                    Any active requests will be cancelled.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => endSession()}>
                    End Session
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </motion.div>
    </div>
  );
}

interface RequestWithTable extends Request {
  table?: Table;
}