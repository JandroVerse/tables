import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useEffect } from "react";

export default function SessionEndedPage() {
  useEffect(() => {
    // Clear out the history stack
    window.history.replaceState(null, '', '/session-ended');

    // Force the page to stay on session-ended
    const preventNavigation = (e: PopStateEvent) => {
      window.history.pushState(null, '', '/session-ended');
    };

    const preventReload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chrome requires returnValue to be set
      e.returnValue = '';
    };

    // Periodically ensure we're on the session-ended page
    const interval = setInterval(() => {
      if (window.location.pathname !== '/session-ended') {
        window.history.replaceState(null, '', '/session-ended');
      }
    }, 100);

    // Handle both popstate and beforeunload events
    window.addEventListener('popstate', preventNavigation);
    window.addEventListener('beforeunload', preventReload);

    return () => {
      window.removeEventListener('popstate', preventNavigation);
      window.removeEventListener('beforeunload', preventReload);
      clearInterval(interval);
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