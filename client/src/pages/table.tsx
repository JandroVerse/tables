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

  const restaurantId = Number(params.restaurantId);
  const tableId = Number(params.tableId);

  const [otherRequestNote, setOtherRequestNote] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [feedbackRequest, setFeedbackRequest] = useState<Request | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(() => {
    const storedSession = localStorage.getItem(`table_session_${tableId}`);
    if (storedSession) {
      try {
        const session = JSON.parse(storedSession);
        if (new Date(session.expiry) > new Date()) {
          return session.id;
        } else {
          localStorage.removeItem(`table_session_${tableId}`);
        }
      } catch (e) {
        localStorage.removeItem(`table_session_${tableId}`);
      }
    }
    return null;
  });
  const [isWaterDialogOpen, setIsWaterDialogOpen] = useState(false);
  const [waterCount, setWaterCount] = useState(1);
  const [isValidating, setIsValidating] = useState(true);
  const [isValid, setIsValid] = useState(false);
  const [tableData, setTableData] = useState<any>(null);

  useEffect(() => {
    if (restaurantId && tableId && !isNaN(restaurantId) && !isNaN(tableId)) {
      console.log(`Attempting to fetch table ${tableId} for restaurant ${restaurantId}`);

      fetch(`/api/restaurants/${restaurantId}/tables/${tableId}`)
        .then(async (res) => {
          const text = await res.text();
          console.log('Raw API response:', text);

          if (!res.ok) {
            throw new Error(text || "Invalid table");
          }

          const data = JSON.parse(text);
          console.log('Parsed table data:', data);

          if (!data || data.restaurantId !== restaurantId) {
            throw new Error("Table does not belong to this restaurant");
          }

          setTableData(data);
          setIsValid(true);

          if (!sessionId) {
            return apiRequest("POST", `/api/restaurants/${restaurantId}/tables/${tableId}/sessions`);
          }
          return new Response(JSON.stringify({ sessionId }));
        })
        .then((res) => res.json())
        .then((session) => {
          console.log('Session data:', session);
          setSessionId(session.sessionId);
          localStorage.setItem(`table_session_${tableId}`, JSON.stringify({
            id: session.sessionId,
            expiry: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          }));
          queryClient.invalidateQueries({ queryKey: ["/api/requests", tableId, restaurantId] });
        })
        .catch((error) => {
          console.error("Failed to verify table or create session:", error);
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
  }, [restaurantId, tableId]);

  useEffect(() => {
    wsService.connect();
    const unsubscribe = wsService.subscribe((data) => {
      if (data.type === "new_request" || data.type === "update_request") {
        queryClient.invalidateQueries({ queryKey: ["/api/requests", tableId, restaurantId] });
      }
    });
    return () => unsubscribe();
  }, [tableId, queryClient, restaurantId]);

  const { data: requests = [] } = useQuery<Request[]>({
    queryKey: ["/api/requests", tableId, restaurantId],
    queryFn: async () => {
      if (!sessionId) return [];
      const res = await fetch(`/api/requests?tableId=${tableId}&restaurantId=${restaurantId}&sessionId=${sessionId}`);
      if (!res.ok) throw new Error("Failed to fetch requests");
      const data = await res.json();
      return data.map((request: any) => ({
        ...request,
        tableName: tableData?.name
      }));
    },
    enabled: !!tableId && !isNaN(tableId) && !!sessionId && !!tableData && !!restaurantId && !isNaN(restaurantId),
  });

  const { mutate: createRequest } = useMutation({
    mutationFn: async ({ type, notes }: { type: string; notes?: string }) => {
      if (!sessionId) throw new Error("No active session");
      if (!restaurantId || !tableId) {
        throw new Error("Invalid table or restaurant");
      }

      console.log('Attempting to create request:', {
        tableId,
        restaurantId,
        sessionId,
        type,
        notes
      });

      const response = await apiRequest("POST", "/api/requests", {
        tableId: Number(tableId),
        restaurantId: Number(restaurantId),
        sessionId,
        type,
        notes,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to create request:', errorText);
        throw new Error(errorText || "Failed to create request");
      }

      const data = await response.json();
      console.log('Successfully created request:', data);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests", tableId, restaurantId] });
      setOtherRequestNote("");
      setIsDialogOpen(false);
      toast({
        title: "Request sent",
        description: "Staff has been notified of your request.",
      });
      console.log('Request created successfully:', data);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send request. Please try again.",
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

  if (!sessionId) return <div>Initializing table session...</div>;

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
              {tableData ? `Table ${tableData.name}` : 'Loading...'}
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