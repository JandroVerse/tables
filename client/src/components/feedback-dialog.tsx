import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Request } from "@db/schema";

const emojis = ["😢", "😕", "😐", "🙂", "😄"];

interface FeedbackDialogProps {
  request: Request;
  open: boolean;
  onClose: () => void;
}

export function FeedbackDialog({ request, open, onClose }: FeedbackDialogProps) {
  const { toast } = useToast();
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");

  const { mutate: submitFeedback, isPending } = useMutation({
    mutationFn: async () => {
      if (!selectedRating) return;
      const response = await apiRequest("POST", "/api/feedback", {
        requestId: request.id,
        rating: selectedRating,
        comment: comment.trim() || undefined,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Thank you for your feedback!",
        description: "Your feedback helps us improve our service.",
      });
      onClose();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to submit feedback. Please try again.",
        variant: "destructive",
      });
      console.error("Failed to submit feedback:", error);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>How was your experience?</DialogTitle>
          <DialogDescription>
            Please rate the service you received
          </DialogDescription>
        </DialogHeader>
        <div className="py-6">
          <div className="flex justify-center gap-4 text-4xl mb-6">
            {emojis.map((emoji, index) => (
              <button
                key={index}
                onClick={() => setSelectedRating(index + 1)}
                className={`hover:scale-110 transition-transform ${
                  selectedRating === index + 1
                    ? "scale-125 shadow-lg rounded-full"
                    : ""
                }`}
                title={`Rate ${index + 1} out of 5`}
              >
                {emoji}
              </button>
            ))}
          </div>
          <Textarea
            placeholder="Additional comments (optional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="min-h-[100px]"
          />
        </div>
        <DialogFooter>
          <Button
            onClick={() => submitFeedback()}
            disabled={!selectedRating || isPending}
          >
            Submit Feedback
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
