import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function SessionEndedPage() {
  // Clear any session data when landing on this page
  useEffect(() => {
    // Clear all table sessions from localStorage
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('table_session_')) {
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
            This table's session has been ended. To start a new session, you must scan the QR code again.
          </p>
          <div className="flex justify-center">
            <Button
              variant="outline"
              onClick={() => window.close()}
              className="w-full"
            >
              Close Window
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}