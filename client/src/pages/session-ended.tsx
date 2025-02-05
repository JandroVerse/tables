import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEffect } from "react";

export default function SessionEndedPage() {
  useEffect(() => {
    // Replace the current history entry with session-ended
    // This removes the previous page from history
    window.history.replaceState(null, '', '/session-ended');

    // Push a new state to prevent going back
    window.history.pushState(null, '', '/session-ended');

    // Handle any attempts to go back
    const handlePopState = () => {
      window.history.pushState(null, '', '/session-ended');
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <Card className="w-[90%] max-w-md">
        <CardHeader>
          <CardTitle>Session Ended</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-6">
            This table's session has been ended. Please scan the QR code again to start a new session.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}