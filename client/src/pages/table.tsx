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
import type { Request, Table } from "@db/schema";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { motion, AnimatePresence } from "framer-motion";
import { AnimatedBackground } from "@/components/animated-background";
import { useParams } from "wouter";

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

  // Support both URL formats: /table/:token and /table/:restaurantId/:tableId
  const token = params.token;
  const restaurantId = params.restaurantId ? Number(params.restaurantId) : undefined;
  const tableId = params.tableId ? Number(params.tableId) : undefined;

  const [otherRequestNote, setOtherRequestNote] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [feedbackRequest, setFeedbackRequest] = useState<Request | null>(null);
  const [isWaterDialogOpen, setIsWaterDialogOpen] = useState(false);
  const [waterCount, setWaterCount] = useState(1);
  const [isValidating, setIsValidating] = useState(true);
  const [isValid, setIsValid] = useState(false);
  const [tableData, setTableData] = useState<Table | null>(null);

  // Initialize token/session and validate table
  useEffect(() => {
    if (!token && (!restaurantId || !tableId || isNaN(restaurantId) || isNaN(tableId))) {
      console.error('Invalid table parameters:', { token, restaurantId, tableId });
      setIsValid(false);
      setIsValidating(false);
      return;
    }

    // For token-based auth
    if (token) {
      console.log(`Validating table token: ${token}`);
      localStorage.setItem('tableToken', token);

      fetch(`/api/tables/${token}`)
        .then(async (res) => {
          const text = await res.text();
          console.log('Raw API response:', text);

          if (!res.ok) {
            throw new Error(text || "Invalid table token");
          }

          const data = JSON.parse(text);
          console.log('Parsed table data:', data);
          setTableData(data);
          setIsValid(true);
        })
        .catch((error) => {
          console.error("Failed to verify table:", error);
          toast({
            title: "Error",
            description: error.message || "This table appears to be invalid or no longer exists.",
            variant: "destructive",
          });
          setIsValid(false);
        })
        .finally(() => {
          setIsValidating(false);
        });
    } 
    // For session-based auth
    else {
      const storedSession = localStorage.getItem(`table_session_${tableId}`);
      let existingSessionId = null;

      if (storedSession) {
        try {
          const session = JSON.parse(storedSession);
          if (new Date(session.expiry) > new Date()) {
            existingSessionId = session.id;
            // Store session ID globally for WebSocket
            localStorage.setItem('sessionId', session.id);
          } else {
            localStorage.removeItem(`table_session_${tableId}`);
            localStorage.removeItem('sessionId');
          }
        } catch (e) {
          localStorage.removeItem(`table_session_${tableId}`);
          localStorage.removeItem('sessionId');
        }
      }

      // Create or verify session
      apiRequest("POST", `/api/restaurants/${restaurantId}/tables/${tableId}/sessions`)
        .then(res => res.json())
        .then(session => {
          localStorage.setItem(`table_session_${tableId}`, JSON.stringify({
            id: session.sessionId,
            expiry: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          }));
          localStorage.setItem('sessionId', session.sessionId);
          setTableData(session);
          setIsValid(true);
        })
        .catch(error => {
          console.error("Failed to create/verify session:", error);
          toast({
            title: "Error",
            description: error.message || "Failed to initialize table session.",
            variant: "destructive",
          });
          setIsValid(false);
        })
        .finally(() => {
          setIsValidating(false);
        });
    }
  }, [token, restaurantId, tableId]);

  useEffect(() => {
    wsService.connect();
    console.log('Table page: Connecting to WebSocket service');

    const unsubscribe = wsService.subscribe((data) => {
      console.log('Table page: Received WebSocket event', data);

      if (!tableData) return;

      switch (data.type) {
        case 'new_request':
        case 'update_request':
          if (data.request.tableId === tableData.id) {
            console.log('Table page: Invalidating requests query due to WebSocket event', data);
            queryClient.invalidateQueries({ queryKey: ["/api/requests", token || `${restaurantId}/${tableId}`] });
          }
          break;
        case 'connection_status':
          console.log('Table page: WebSocket connection status:', data.status);
          if (data.status === 'connected') {
              queryClient.invalidateQueries({ queryKey: ["/api/requests", token || `${restaurantId}/${tableId}`] });
          }
          break;
        default:
          console.log('Table page: Unknown WebSocket event type:', data.type);
      }
    });

    return () => {
      console.log('Table page: Unsubscribing from WebSocket service');
      unsubscribe();
    };
  }, [token, queryClient, tableData, restaurantId, tableId]);

  const { data: requests = [] } = useQuery<Request[]>({
    queryKey: ["/api/requests", token || `${restaurantId}/${tableId}`],
    queryFn: async () => {
      if (!tableData) return [];

      const queryParams = token 
        ? `token=${token}`
        : `tableId=${tableId}&restaurantId=${restaurantId}&sessionId=${localStorage.getItem('sessionId')}`;

      const res = await fetch(`/api/requests?${queryParams}`);
      if (!res.ok) throw new Error("Failed to fetch requests");
      return res.json();
    },
    enabled: !!tableData && (!!token || (!!restaurantId && !!tableId)),
  });

  const handleWaterRequest = () => {
    console.log('Water request initiated:', {
      waterCount,
      token,
      tableId,
      restaurantId
    });

    createRequest({
      type: "water",
      notes: `${waterCount} water${waterCount > 1 ? "s" : ""}`,
    });
  };

  const handleWaiterRequest = () => {
    console.log('Waiter request initiated:', { token, tableId, restaurantId });
    createRequest({ type: "waiter" });
  };

  const { mutate: createRequest } = useMutation({
    mutationFn: async ({ type, notes }: { type: string; notes?: string }) => {
      console.log('Creating request: Starting mutation', { type, notes, token, tableId, restaurantId });

      if (!token && (!restaurantId || !tableId)) {
        throw new Error("Invalid table parameters");
      }

      const requestData = token
        ? { token, type, notes }
        : {
            tableId,
            restaurantId,
            sessionId: localStorage.getItem('sessionId'),
            type,
            notes,
          };

      console.log('Creating request: Sending request with data', requestData);

      try {
        const response = await apiRequest("POST", "/api/requests", requestData);
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || "Failed to create request");
        }
        return response.json();
      } catch (error) {
        console.error('Creating request: Request error', error);
        throw error;
      }
    },
    onSuccess: (data) => {
      console.log('Creating request: Mutation succeeded', data);
      queryClient.invalidateQueries({ queryKey: ["/api/requests", token || `${restaurantId}/${tableId}`] });
      setOtherRequestNote("");
      setIsDialogOpen(false);
      toast({
        title: "Request sent",
        description: "Staff has been notified of your request.",
      });

      // Send WebSocket notification with full request data
      const wsMessage = {
        type: "new_request" as const,
        token,
        request: data
      };
      console.log('Creating request: Sending WebSocket notification', wsMessage);
      wsService.send(wsMessage);
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

  const { mutate: cancelRequest } = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("PATCH", `/api/requests/${id}`, { status: "cleared" });
    },
    onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/requests", token || `${restaurantId}/${tableId}`] });
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

  if (!token && (!restaurantId || !tableId)) {
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

  if (!tableData) return <div>Loading table data...</div>;

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
        <Card className="max-w-md mx-auto shadow-lg border-0">
          <CardHeader className="pb-4">
            <CardTitle className="text-2xl font-bold text-center bg-gradient-to-r from-primary/90 to-primary bg-clip-text text-transparent">
              {tableData ? tableData.name : 'Loading...'}
            </CardTitle>
            <div className="text-center text-sm text-muted-foreground">
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
      </motion.div>
    </div>
  );
}