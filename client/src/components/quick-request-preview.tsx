import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { GlassWater, Bell, Receipt, Clock } from "lucide-react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Request, Table } from "@db/schema";

interface QuickRequestPreviewProps {
  table: Table | null;
  activeRequests: Request[];
  open: boolean;
  onClose: () => void;
}

const RequestIcon = ({ type }: { type: string }) => {
  const icons = {
    water: <GlassWater className="h-5 w-5 text-blue-500" />,
    waiter: <Bell className="h-5 w-5 text-purple-500" />,
    check: <Receipt className="h-5 w-5 text-emerald-500" />,
    other: <Clock className="h-5 w-5 text-gray-500" />
  };

  return icons[type as keyof typeof icons] || icons.other;
};

export function QuickRequestPreview({ table, activeRequests, open, onClose }: QuickRequestPreviewProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { mutate: updateRequest } = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      return apiRequest("PATCH", `/api/requests/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      toast({
        title: "Request updated",
        description: "The request status has been updated.",
      });
    },
  });

  if (!table) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{table.name} - Active Requests</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          {activeRequests.length === 0 ? (
            <p className="text-center text-gray-500">No active requests</p>
          ) : (
            activeRequests.map((request) => (
              <motion.div
                key={request.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className={`p-4 rounded-lg ${
                  request.type === "waiter" 
                    ? "bg-purple-100" 
                    : request.type === "water"
                    ? "bg-blue-100"
                    : request.type === "check"
                    ? "bg-emerald-100"
                    : "bg-gray-100"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <RequestIcon type={request.type} />
                    <div>
                      <div className="font-medium capitalize">{request.type}</div>
                      {request.notes && (
                        <div className="text-sm text-gray-600">{request.notes}</div>
                      )}
                      <div className="text-xs text-gray-500">
                        {new Date(request.createdAt).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {request.status === "pending" && (
                      <Button
                        size="sm"
                        onClick={() =>
                          updateRequest({ id: request.id, status: "in_progress" })
                        }
                      >
                        Start
                      </Button>
                    )}
                    {request.status === "in_progress" && (
                      <Button
                        size="sm"
                        onClick={() =>
                          updateRequest({ id: request.id, status: "completed" })
                        }
                      >
                        Complete
                      </Button>
                    )}
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
