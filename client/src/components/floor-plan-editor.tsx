import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Draggable from "react-draggable";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Input } from "./ui/input";
import { apiRequest } from "@/lib/queryClient";
import type { Table } from "@db/schema";

interface TablePosition {
  x: number;
  y: number;
  width: number;
  height: number;
  shape: "square" | "round";
}

interface TableWithPosition extends Table {
  position: TablePosition;
}

interface DraggableTableProps {
  table: TableWithPosition;
  onDragStop: (tableId: number, position: { x: number; y: number }) => void;
  selected: boolean;
  onClick: () => void;
  requestCount?: number;
}

const DraggableTable = ({
  table,
  onDragStop,
  selected,
  onClick,
  requestCount = 0,
}: DraggableTableProps) => {
  const intensity = Math.min(0.8, Math.max(0.1, requestCount / 10));

  return (
    <Draggable
      position={{ x: table.position.x, y: table.position.y }}
      onStop={(_e, data) => onDragStop(table.id, { x: data.x, y: data.y })}
      bounds="parent"
      grid={[20, 20]}
    >
      <div
        className={`absolute cursor-move select-none ${
          table.position.shape === "round" ? "rounded-full" : "rounded-lg"
        } ${
          selected ? "ring-2 ring-primary" : ""
        }`}
        style={{
          width: table.position.width,
          height: table.position.height,
          backgroundColor: `rgba(52, 211, 153, ${intensity})`,
        }}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-medium text-gray-800">{table.name}</span>
        </div>
      </div>
    </Draggable>
  );
};

export function FloorPlanEditor() {
  const queryClient = useQueryClient();
  const [selectedTable, setSelectedTable] = useState<number | null>(null);
  const [newTableName, setNewTableName] = useState("");
  const [selectedShape, setSelectedShape] = useState<"square" | "round">("square");
  const editorRef = useRef<HTMLDivElement>(null);

  const { data: tables = [] } = useQuery<TableWithPosition[]>({
    queryKey: ["/api/tables"],
  });

  const { data: heatMapData = [] } = useQuery<Array<{ table_id: number; request_count: number }>>({
    queryKey: ["/api/tables/heat-map"],
  });

  const { mutate: updateTablePosition } = useMutation({
    mutationFn: async ({ id, position }: { id: number; position: TablePosition }) => {
      return apiRequest("PATCH", `/api/tables/${id}`, { position });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
    },
  });

  const { mutate: createTable } = useMutation({
    mutationFn: async ({ name, position }: { name: string; position: TablePosition }) => {
      return apiRequest("POST", "/api/tables", { name, position });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      setNewTableName("");
    },
  });

  const handleTableDragStop = (tableId: number, { x, y }: { x: number; y: number }) => {
    const table = tables.find((t) => t.id === tableId);
    if (!table) return;

    const position: TablePosition = {
      ...table.position,
      x,
      y,
    };

    updateTablePosition({ id: tableId, position });
  };

  const handleAddTable = () => {
    if (!newTableName.trim()) return;

    const position: TablePosition = {
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      shape: selectedShape,
    };

    createTable({ name: newTableName, position });
  };

  const getRequestCount = (tableId: number) => {
    const data = heatMapData.find((d) => d.table_id === tableId);
    return data?.request_count || 0;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Floor Plan Editor</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex gap-4">
            <Input
              placeholder="New table name"
              value={newTableName}
              onChange={(e) => setNewTableName(e.target.value)}
            />
            <Select
              value={selectedShape}
              onValueChange={(value) => setSelectedShape(value as "square" | "round")}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Shape" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="square">Square</SelectItem>
                <SelectItem value="round">Round</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleAddTable}>Add Table</Button>
          </div>

          <div
            ref={editorRef}
            className="relative h-[600px] border rounded-lg bg-gray-50"
            onClick={() => setSelectedTable(null)}
          >
            {tables.map((table) => (
              <DraggableTable
                key={table.id}
                table={table}
                onDragStop={handleTableDragStop}
                selected={selectedTable === table.id}
                onClick={() => setSelectedTable(table.id)}
                requestCount={getRequestCount(table.id)}
              />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}