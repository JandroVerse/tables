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
import { AnimatedBackground } from "@/components/animated-background";
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
  const [sessionTimeRemaining, setSessionTimeRemaining] = useState(60 * 60 * 1000);
  const [isSessionEnded, setIsSessionEnded] = useState(false);


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
              setSessionTimeRemaining(data.activeSession.expiresIn);

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
            setSessionTimeRemaining(60 * 60 * 1000);
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
            description: "This table appears to be invalid or no longer exists.",
            variant: "destructive",
          });
        })
        .finally(() => {
          setIsValidating(false);
        });
    }
  }, [restaurantId, tableId]);

  // Timer update effect
  useEffect(() => {
    if (!sessionId) return;

    const interval = setInterval(() => {
      const savedSession = localStorage.getItem(`table_session_${tableId}`);
      if (savedSession) {
        try {
          const { startedAt } = JSON.parse(savedSession);
          const sessionStartTime = new Date(startedAt).getTime();
          const elapsed = Date.now() - sessionStartTime;
          const remaining = Math.max(60 * 60 * 1000 - elapsed, 0);

          setSessionTimeRemaining(remaining);

          if (remaining === 0) {
            localStorage.removeItem(`table_session_${tableId}`);
            window.location.reload();
          }
        } catch (e) {
          console.error('Error calculating session time:', e);
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [sessionId, tableId]);

  useEffect(() => {
    wsService.connect();
    const unsubscribe = wsService.subscribe((data) => {
      if (data.type === "new_request" && data.tableId === tableId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/requests", tableId],
          exact: true
        });
      } else if (data.type === "update_request" && data.tableId === tableId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/requests", tableId],
          exact: true
        });
      } else if (data.type === "end_session" && data.tableId === tableId) {
        // Handle session end event
        localStorage.removeItem(`table_session_${tableId}`);
        setLocation('/session-ended');
      }
    });

    // Reconnection logic
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
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
      toast({
        title: "Session Ended",
        description: "Table session has been closed successfully.",
      });
      window.location.reload();
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

  if (isSessionEnded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-[90%] max-w-md">
          <CardHeader>
            <CardTitle>Session Ended</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-6">
              This table's session has been ended by staff. To start a new session, please scan the QR code again.
            </p>
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => window.location.reload()}
              >
                Scan New QR Code
              </Button>
            </div>
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
    return (
      <AnimatePresence mode="popLayout">
        <div className="space-y-3">
          {requestsToRender.map((request) => (
            <motion.div
              key={request.id}
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
                  <div className="font-medium text-primary">
                    {request.type === "water" ? "Water Refill" :
                      request.type === "waiter" ? "Call Waiter" :
                        request.type === "check" ? "Get Check" :
                          request.type}
                    {request.table && (
                      <span className="ml-2 text-sm text-muted-foreground">
                        {request.table.name}
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
                              Cancel Request
                            </Button>
                          </motion.div>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Cancel Request?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to cancel this
                              request? This action cannot be
                              undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>
                              No, keep it
                            </AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() =>
                                cancelRequest(request.id)
                              }
                            >
                              Yes, cancel it
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

  return (
    <div className="min-h-screen">
      <div className="relative z-0">
        <AnimatedBackground />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 p-4"
      >
        {sessionId && (
          <Card className="max-w-md mx-auto mb-4 bg-primary/5">
            <CardContent className="p-4">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Share this session ID with your table:</p>
                    <p className="text-lg font-mono font-bold">{sessionId}</p>
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
                <div className="text-sm text-muted-foreground">
                  <p>Session expires in: {Math.floor(sessionTimeRemaining / 60000)} minutes</p>
                  <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                    <div
                      className="bg-primary h-1.5 rounded-full transition-all duration-1000"
                      style={{
                        width: `${(sessionTimeRemaining / (60 * 60 * 1000)) * 100}%`
                      }}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        <Card className="max-w-md mx-auto shadow-lg border-0">
          <CardHeader className="pb-4">
            <CardTitle className="text-2xl font-bold text-center bg-gradient-to-r from-primary/90 to-primary bg-clip-text text-transparent">
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
                      className="h-28 w-full flex flex-col items-center justify-center space-y-3"
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
                  <AlertDialogContent>
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
                    className="h-28 w-full flex flex-col items-center justify-center space-y-3"
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
                      className="h-28 w-full flex flex-col items-center justify-center space-y-3"
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
                  <AlertDialogContent>
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

              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <motion.div
                  variants={buttonVariants}
                  initial="idle"
                  whileHover="hover"
                  whileTap="tap"
                >
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-28 w-full flex flex-col items-center justify-center space-y-3"
                    onClick={() => setIsDialogOpen(true)}
                  >
                    <Clock className="h-8 w-8" />
                    <span className="font-medium">Other Request</span>
                  </Button>
                </motion.div>
                <DialogContent>
                  <DialogHeader className="p-6 pb-0">
                    <DialogTitle className="text-xl font-semibold">
                      Other Request
                    </DialogTitle>
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
                  {renderRequests(requests.filter(
                    (r) => r.status !== "completed" && r.status !== "cleared"
                  ))}
                </TabsContent>
                <TabsContent value="completed" className="mt-4">
                  {renderRequests(requests.filter((r) => r.status === "completed"))}
                </TabsContent>
              </Tabs>
            )}

            {/* Add the Close Session button */}
            <div className="mt-8 flex justify-center">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    className="w-full max-w-sm"
                  >
                    Close Table Session
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Close Session?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will end the current table session. All members will be disconnected and a new session will be required for future requests.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => endSession()}
                    >
                      Yes, Close Session
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>

            {feedbackRequest && (
              <FeedbackDialog
                request={feedbackRequest}
                open={true}
                onClose={() => setFeedbackRequest(null)}
              />
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

interface RequestWithTable extends Request {
  table?: Table;
}