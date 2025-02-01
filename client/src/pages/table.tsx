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
import { GlassWater, Bell, Receipt, Clock } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { wsService } from "@/lib/ws";
import { useEffect, useState } from "react";
import type { Request } from "@db/schema";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { motion, AnimatePresence } from "framer-motion";

const cardVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, x: -20 }
};

const buttonVariants = {
  idle: { scale: 1 },
  hover: { scale: 1.05 },
  tap: { scale: 0.95 }
};

const statusVariants = {
  pending: { color: "#71717a" },
  in_progress: { color: "#059669" },
  completed: { color: "#0284c7" }
};

export default function TablePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const tableId = Number(new URLSearchParams(window.location.search).get("id"));
  const [otherRequestNote, setOtherRequestNote] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [feedbackRequest, setFeedbackRequest] = useState<Request | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (tableId && !isNaN(tableId)) {
      apiRequest("POST", `/api/tables/${tableId}/sessions`)
        .then((res) => res.json())
        .then((session) => {
          setSessionId(session.sessionId);
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

  if (!tableId || isNaN(tableId)) return <div>Invalid table ID</div>;
  if (!sessionId) return <div>Initializing table session...</div>;

  const hasActiveRequest = (type: string) => {
    return requests.some(
      (request) => request.type === type &&
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
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Card className="max-w-md mx-auto shadow-lg border-0">
          <CardHeader className="pb-4">
            <CardTitle className="text-2xl font-bold text-center bg-gradient-to-r from-primary/90 to-primary bg-clip-text text-transparent">
              How can we help you?
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              {[
                { icon: Bell, label: "Call Waiter", type: "waiter" },
                { icon: GlassWater, label: "Water Refill", type: "water" },
                { icon: Receipt, label: "Get Check", type: "check" },
              ].map(({ icon: Icon, label, type }) => (
                <motion.div
                  key={type}
                  variants={buttonVariants}
                  initial="idle"
                  whileHover="hover"
                  whileTap="tap"
                >
                  <Button
                    size="lg"
                    className="h-28 w-full flex flex-col items-center justify-center space-y-3"
                    onClick={() => createRequest({ type })}
                    disabled={hasActiveRequest(type)}
                    title={hasActiveRequest(type) ? `${label} request is being processed` : ""}
                  >
                    <Icon className="h-8 w-8" />
                    <span className="font-medium">{label}</span>
                  </Button>
                </motion.div>
              ))}

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
                  <AnimatePresence mode="popLayout">
                    <div className="space-y-3">
                      {requests
                        .filter((r) => r.status !== "completed" && r.status !== "cleared")
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
                              opacity: { duration: 0.2 }
                            }}
                          >
                            <Card className="overflow-hidden transition-colors hover:bg-green-50/50">
                              <CardContent className="p-4">
                                <div className="font-medium text-primary">{request.type}</div>
                                {request.notes && (
                                  <div className="text-sm text-gray-600 mt-2">{request.notes}</div>
                                )}
                                <div className="flex justify-between items-center mt-2">
                                  <motion.div
                                    className="text-sm"
                                    variants={statusVariants}
                                    animate={request.status}
                                    transition={{ duration: 0.3 }}
                                  >
                                    Status: <span className="capitalize">{request.status.replace('_', ' ')}</span>
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
                                          <AlertDialogTitle>Cancel Request?</AlertDialogTitle>
                                          <AlertDialogDescription>
                                            Are you sure you want to cancel this request? This action cannot be undone.
                                          </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                          <AlertDialogCancel>No, keep it</AlertDialogCancel>
                                          <AlertDialogAction
                                            onClick={() => cancelRequest(request.id)}
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
                              opacity: { duration: 0.2 }
                            }}
                          >
                            <Card className="overflow-hidden transition-colors hover:bg-green-50/50">
                              <CardContent className="p-4">
                                <div className="font-medium text-primary">{request.type}</div>
                                {request.notes && (
                                  <div className="text-sm text-gray-600 mt-2">{request.notes}</div>
                                )}
                                <div className="flex justify-between items-center mt-3">
                                  <div className="text-sm text-gray-500">Completed</div>
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