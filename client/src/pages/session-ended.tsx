import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SessionEndedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Card className="w-[90%] max-w-md">
        <CardHeader>
          <CardTitle>Session Ended</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-6">
            This table's session has been ended by staff. Please scan the QR code again to start a new session.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
