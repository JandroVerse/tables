import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Table } from "@db/schema";

export default function QRPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: tables = [] } = useQuery<Table[]>({
    queryKey: ["/api/tables"],
  });

  const { mutate: deleteTable } = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/tables/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      toast({
        title: "Table deleted",
        description: "The table has been deleted successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to delete table. Please try again.",
        variant: "destructive",
      });
      console.error("Failed to delete table:", error);
    },
  });

  const downloadQR = (tableId: number, qrCode: string) => {
    const link = document.createElement("a");
    const blob = new Blob([qrCode], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `table-${tableId}-qr.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <Card className="max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">Table QR Codes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {tables.map((table) => (
              <Card key={table.id} className="overflow-hidden">
                <CardContent className="p-4">
                  <h3 className="font-medium mb-2">{table.name}</h3>
                  {table.qrCode && (
                    <div 
                      className="w-full mb-4 p-4 bg-white rounded-lg shadow-sm"
                      dangerouslySetInnerHTML={{ __html: table.qrCode }}
                    />
                  )}
                  <div className="space-y-2">
                    <Button
                      className="w-full"
                      onClick={() => downloadQR(table.id, table.qrCode)}
                    >
                      Download QR Code
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" className="w-full">
                          Delete Table
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently delete the table and all its associated service requests.
                            This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteTable(table.id)}
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}