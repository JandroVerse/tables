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
import { Plus, Minus, GlassWater, Bell, Receipt, Clock } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { wsService } from "@/lib/ws";
import { useEffect, useState } from "react";
import type { Request } from "@db/schema";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { motion, AnimatePresence } from "framer-motion";
import { AnimatedBackground } from "@/components/animated-background";
import { useParams } from "wouter";
import { formatDistance } from "date-fns";

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
};

export default function TablePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const params = useParams();

  // Ensure we have valid IDs
  const restaurantId = Number(params.restaurantId);
  const tableId = Number(params.tableId);

  const [otherRequestNote, setOtherRequestNote] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [feedbackRequest, setFeedbackRequest] = useState<Request | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isWaterDialogOpen, setIsWaterDialogOpen] = useState(false);
  const [waterCount, setWaterCount] = useState(1);
  const [isValidating, setIsValidating] = useState(true);
  const [isValid, setIsValid] = useState(false);
  const [tableData, setTableData] = useState<any>(null);
  const [sessionExpiryTime, setSessionExpiryTime] = useState<Date | null>(null);
  const [remainingTime, setRemainingTime] = useState<string>("");

  // Initialize session and validate table
  useEffect(() => {
    if (!restaurantId || !tableId || isNaN(restaurantId) || isNaN(tableId)) {
      console.error('Invalid table or restaurant ID:', { restaurantId, tableId });
      setIsValid(false);
      setIsValidating(false);
      return;
    }

    const initializeSession = async () => {
      try {
        console.log(`Validating table ${tableId} for restaurant ${restaurantId}`);
        const tableResponse = await fetch(`/api/restaurants/${restaurantId}/tables/${tableId}`);

        if (!tableResponse.ok) {
          throw new Error(await tableResponse.text() || "Invalid table");
        }

        const tableInfo = await tableResponse.json();
        if (!tableInfo || tableInfo.restaurantId !== restaurantId) {
          throw new Error("Table does not belong to this restaurant");
        }

        setTableData(tableInfo);
        setIsValid(true);

        // Try to get existing session from localStorage first
        const storedSession = localStorage.getItem(`table_session_${tableId}`);
        let existingSession = null;

        if (storedSession) {
          try {
            const session = JSON.parse(storedSession);
            const expiryTime = new Date(session.expiry);

            if (expiryTime > new Date()) {
              console.log('Found valid stored session:', session);
              existingSession = session;
              setSessionId(session.id);
              setSessionExpiryTime(expiryTime);
              return;
            } else {
              console.log('Stored session has expired');
              localStorage.removeItem(`table_session_${tableId}`);
            }
          } catch (e) {
            console.error("Failed to parse stored session:", e);
          }
        }

        console.log('Creating new session');
        const sessionResponse = await fetch(
          `/api/restaurants/${restaurantId}/tables/${tableId}/sessions`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          }
        );

        const sessionData = await sessionResponse.json();
        console.log('New session data:', sessionData);

        const newSessionId = sessionData.sessionId;
        setSessionId(newSessionId);

        const expiryTime = new Date(new Date(sessionData.startedAt).getTime() + 3 * 60 * 60 * 1000);
        setSessionExpiryTime(expiryTime);

        localStorage.setItem(`table_session_${tableId}`, JSON.stringify({
          id: newSessionId,
          expiry: expiryTime.toISOString()
        }));

      } catch (error) {
        console.error("Failed to initialize session:", error);
        toast({
          title: "Error",
          description: error instanceof Error ? error.message : "Failed to initialize table session",
          variant: "destructive",
        });
        setIsValid(false);
      } finally {
        setIsValidating(false);
      }
    };

    initializeSession();
  }, [restaurantId, tableId, toast]);

  // WebSocket setup
  useEffect(() => {
    if (!sessionId || !tableId || !restaurantId) {
      console.log('Cannot setup WebSocket - missing required data:', { sessionId, tableId, restaurantId });
      return;
    }

    console.log('Setting up WebSocket with session:', sessionId);

    // Clean up any existing connection before establishing a new one
    wsService.disconnect();
    wsService.connect(sessionId, 'customer');

    // Subscribe to WebSocket events
    const unsubscribe = wsService.subscribe((data) => {
      console.log('Received WebSocket event:', data);

      if (data.type === 'new_request' || data.type === 'update_request') {
        console.log('Invalidating requests query due to:', data.type);
        queryClient.invalidateQueries({ queryKey: ["/api/requests", tableId, restaurantId] });
      } else if (data.type === 'connection_status') {
        console.log('WebSocket connection status:', data.status);
        if (data.status === 'connected') {
          queryClient.invalidateQueries({ queryKey: ["/api/requests", tableId, restaurantId] });
        }
      }
    });

    // Ping every 30 seconds to keep connection alive
    const pingInterval = setInterval(() => {
      if (wsService) {
        wsService.send({ type: 'ping', tableId, restaurantId });
      }
    }, 30000);

    return () => {
      console.log('Cleaning up WebSocket connection');
      clearInterval(pingInterval);
      unsubscribe();
      wsService.disconnect();
    };
  }, [sessionId, tableId, restaurantId, queryClient]);

  // Timer effect for session expiry
  useEffect(() => {
    const updateRemainingTime = () => {
      if (sessionExpiryTime) {
        const now = new Date();
        if (sessionExpiryTime > now) {
          const distance = sessionExpiryTime.getTime() - now.getTime();
          const hours = Math.floor(distance / (1000 * 60 * 60));
          const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
          setRemainingTime(`expires in ${hours}h ${minutes}m`);
        } else {
          setRemainingTime("Session expired");
        }
      }
    };

    updateRemainingTime();
    const interval = setInterval(updateRemainingTime, 30000);

    return () => clearInterval(interval);
  }, [sessionExpiryTime]);

  const { data: requests = [] } = useQuery<Request[]>({
    queryKey: ["/api/requests", tableId, restaurantId],
    queryFn: async () => {
      if (!sessionId || !tableId || !restaurantId) {
        console.log('Skipping request fetch - missing required parameters:', { tableId, restaurantId, sessionId });
        return [];
      }

      console.log('Fetching requests with:', { tableId, restaurantId, sessionId });

      try {
        const res = await fetch(`/api/requests?tableId=${tableId}&restaurantId=${restaurantId}&sessionId=${sessionId}`, {
          headers: {
            'X-Session-ID': sessionId
          }
        });

        if (!res.ok) {
          const errorText = await res.text();
          console.error('Failed to fetch requests:', errorText);
          throw new Error(errorText || "Failed to fetch requests");
        }

        const data = await res.json();
        console.log('Fetched requests:', data);

        // Add table name to each request
        return data.map((request: any) => ({
          ...request,
          tableName: tableData?.name
        }));
      } catch (error) {
        console.error('Error fetching requests:', error);
        throw error;
      }
    },
    enabled: !!tableId && !isNaN(tableId) && !!sessionId && !!tableData && !!restaurantId && !isNaN(restaurantId),
  });

  // The key mutation that creates requests
  const { mutate: createRequest } = useMutation({
    mutationFn: async ({ type, notes }: { type: string; notes?: string }) => {
      console.log('Creating request: Starting mutation', { type, notes, tableId, restaurantId, sessionId });

      if (!sessionId) {
        console.error('Creating request: No active session');
        throw new Error("No active session");
      }

      if (!restaurantId || !tableId || isNaN(restaurantId) || isNaN(tableId)) {
        console.error('Creating request: Invalid table or restaurant', { restaurantId, tableId });
        throw new Error("Invalid table or restaurant");
      }

      const requestData = {
        tableId: Number(tableId),
        restaurantId: Number(restaurantId),
        sessionId,
        type,
        notes,
      };

      console.log('Creating request: Sending request with data', requestData);

      try {
        const response = await apiRequest("POST", "/api/requests", requestData);

        if (!response.ok) {
          const errorText = await response.text();
          console.error('Creating request: Request failed', errorText);
          throw new Error(errorText || "Failed to create request");
        }

        const data = await response.json();
        console.log('Creating request: Request successful', data);
        return data;
      } catch (error) {
        console.error('Creating request: Request error', error);
        throw error;
      }
    },
    onSuccess: (data) => {
      console.log('Creating request: Mutation succeeded', data);
      queryClient.invalidateQueries({ queryKey: ["/api/requests", tableId, restaurantId] });
      setOtherRequestNote("");
      setIsDialogOpen(false);
      toast({
        title: "Request sent",
        description: "Staff has been notified of your request.",
      });

      // Send WebSocket notification
      console.log('Sending WebSocket notification for new request:', {
        type: "new_request",
        tableId,
        restaurantId,
        request: data,
        sessionId
      });

      wsService.send({
        type: "new_request",
        tableId,
        restaurantId,
        request: data
      });
    },
    onError: (error: Error) => {
      console.error('Creating request: Mutation failed', error);
      toast({
        title: "Error",
        description: error.message || "Failed to send request. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Example usage - Water Request
  const handleWaterRequest = () => {
    console.log('Water request initiated:', {
      waterCount,
      tableId,
      restaurantId,
      sessionId
    });

    createRequest({
      type: "water",
      notes: `${waterCount} water${waterCount > 1 ? "s" : ""}`,
    });
  };

  const handleWaiterRequest = () => {
    console.log('Waiter request initiated:', {
      tableId,
      restaurantId,
      sessionId
    });

    createRequest({ type: "waiter" });
  };

  const { mutate: cancelRequest } = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("PATCH", `/api/requests/${id}`, { 
        status: "cleared",
        sessionId  // Include sessionId in the request
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests", tableId, restaurantId] });
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

  useEffect(() => {
    const updateRemainingTime = () => {
      if (sessionExpiryTime) {
        const now = new Date();
        if (sessionExpiryTime > now) {
          const distance = sessionExpiryTime.getTime() - now.getTime();
          const hours = Math.floor(distance / (1000 * 60 * 60));
          const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
          setRemainingTime(`expires in ${hours}h ${minutes}m`);
        } else {
          setRemainingTime("Session expired");
          // Optionally redirect or show expired message
        }
      }
    };

    updateRemainingTime();
    // Update every 30 seconds instead of every minute
    const interval = setInterval(updateRemainingTime, 30000);

    return () => clearInterval(interval);
  }, [sessionExpiryTime, tableId]);



  return (
    <div className="min-h-screen relative">
      <div className="fixed inset-0 z-0">
        <AnimatedBackground />
      </div>
      <div className="relative z-10 p-4 min-h-screen flex items-center justify-center">
        {!restaurantId || !tableId || isNaN(restaurantId) || isNaN(tableId) ? (
          <Card>
            <CardHeader>
              <CardTitle>Invalid Table</CardTitle>
            </CardHeader>
            <CardContent>
              <p>This table appears to be invalid. Please scan a valid QR code.</p>
            </CardContent>
          </Card>
        ) : isValidating ? (
          <Card>
            <CardHeader>
              <CardTitle>Loading...</CardTitle>
            </CardHeader>
            <CardContent>
              <p>Verifying table information...</p>
            </CardContent>
          </Card>
        ) : !isValid ? (
          <Card>
            <CardHeader>
              <CardTitle>Invalid Table</CardTitle>
            </CardHeader>
            <CardContent>
              <p>This table appears to be invalid or no longer exists. Please scan a valid QR code.</p>
            </CardContent>
          </Card>
        ) : !sessionId ? (
          <Card>
            <CardHeader>
              <CardTitle>Initializing...</CardTitle>
            </CardHeader>
            <CardContent>
              <p>Initializing table session...</p>
            </CardContent>
          </Card>
        ) : (
          <Card className="max-w-md mx-auto shadow-lg border-0 bg-white/95">
            <CardHeader className="pb-4">
              <CardTitle className="text-2xl font-bold text-center bg-gradient-to-r from-primary/90 to-primary bg-clip-text text-transparent">
                {tableData ? tableData.name : 'Loading...'}
              </CardTitle>
              {remainingTime && (
                <div className="text-center text-sm text-muted-foreground">
                  Session {remainingTime}
                </div>
              )}
              <div className="text-center text-sm text-muted-foreground mt-2">
                How can we help you?
              </div>
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
                          onClick={handleWaiterRequest}
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
                          handleWaterRequest();
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
                    <AnimatePresence mode="popLayout">
                      <div className="space-y-3">
                        {requests
                          .filter(
                            (r) => r.status !== "completed" && r.status !== "cleared"
                          )
                          .map((request) => (
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
                                    {request.type}
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
                                      animate={request.status}
                                      transition={{ duration: 0.3 }}
                                    >
                                      Status:{" "}
                                      <span className="capitalize">
                                        {request.status.replace("_", " ")}
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
                  </TabsContent>
                  <TabsContent value="completed" className="mt-4">
                    <AnimatePresence mode="popLayout">
                      <div className="space-y-3">
                        {requests
                          .filter((r) => r.status === "completed")
                          .map((request) => (
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
                              <Card className="overflow-hidden transition-colors hover:bg-green-50/50">
                                <CardContent className="p-4">
                                  <div className="font-medium text-primary">
                                    {request.type}
                                  </div>
                                  {request.notes && (
                                    <div className="text-sm text-gray-600 mt-2">
                                      {request.notes}
                                    </div>
                                  )}
                                  <div className="flex justify-between items-center mt-3">
                                    <div className="text-sm text-gray-500">
                                      Completed
                                    </div>
                                    <motion.div
                                      variants={buttonVariants}
                                      initial="idle"
                                      whileHover="hover"
                                      whileTap="tap"
                                    >
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setFeedbackRequest(request)}
                                        className="hover:border-primary/50"
                                      >
                                        Rate Service
                                      </Button>
                                    </motion.div>
                                  </div>
                                </CardContent>
                              </Card>
                            </motion.div>
                          ))}
                      </div>
                    </AnimatePresence>
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
        )}
      </div>
    </div>
  );
}