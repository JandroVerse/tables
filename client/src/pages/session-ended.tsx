import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useEffect } from "react";

export default function SessionEndedPage() {
  useEffect(() => {
    // Clear out any remaining session data for all tables
    for (let key of Object.keys(localStorage)) {
      if (key.startsWith('table_session_')) {
        localStorage.removeItem(key);
      }
    }
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <Card className="w-[90%] max-w-md">
        <CardHeader>
          <CardTitle>Session Ended</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-6">
            This table's session has been ended by staff. Please refresh the page or scan the QR code again to start a new session.
          </p>
          <div className="flex justify-center">
            <Button
              variant="outline"
              onClick={() => window.location.reload()}
            >
              Refresh Page
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}