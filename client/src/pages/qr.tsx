import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Table } from "@db/schema";

export default function QRPage() {
  const { data: tables = [] } = useQuery<Table[]>({
    queryKey: ["/api/tables"],
  });

  const downloadQR = (tableId: number, qrCode: string) => {
    const link = document.createElement("a");
    link.href = qrCode;
    link.download = `table-${tableId}-qr.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
              <Card key={table.id}>
                <CardContent className="p-4">
                  <h3 className="font-medium mb-2">{table.name}</h3>
                  <img
                    src={table.qrCode}
                    alt={`QR code for ${table.name}`}
                    className="w-full mb-4"
                  />
                  <Button
                    className="w-full"
                    onClick={() => downloadQR(table.id, table.qrCode)}
                  >
                    Download QR Code
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}