import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import type { Table } from "@db/schema";

interface HeatMapData {
  table_id: number;
  table_name: string;
  request_count: number;
  requests: Array<{
    type: string;
    created_at: string;
  }>;
}

export function TableHeatmap() {
  const { data: heatMapData, isLoading } = useQuery<HeatMapData[]>({
    queryKey: ["/api/tables/heat-map"],
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Table Activity Heat Map</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const maxRequests = Math.max(...(heatMapData?.map(d => d.request_count) || [1]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Table Activity Heat Map</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4">
          {heatMapData?.map((data) => {
            const intensity = data.request_count / maxRequests;
            return (
              <div
                key={data.table_id}
                className="relative overflow-hidden rounded-lg border p-4 hover:shadow-md transition-shadow"
                style={{
                  backgroundColor: `rgba(52, 211, 153, ${Math.max(0.1, intensity)})`,
                }}
              >
                <div className="relative z-10">
                  <h3 className="font-semibold text-lg mb-1">{data.table_name}</h3>
                  <p className="text-sm text-gray-600">
                    {data.request_count} requests
                  </p>
                  <div className="text-xs text-gray-500 mt-1">
                    Last request:{" "}
                    {data.requests.length > 0
                      ? new Date(
                          data.requests[data.requests.length - 1].created_at
                        ).toLocaleTimeString()
                      : "No requests"}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
