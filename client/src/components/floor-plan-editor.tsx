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
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { GlassWater, Bell, Receipt, Clock } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { Table, Request } from "@db/schema";
import { motion, AnimatePresence } from "framer-motion";
import { QuickRequestPreview } from "./quick-request-preview";

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
  activeRequests: Request[];
}

const RequestIndicator = ({ type }: { type: string }) => {
  const icons = {
    water: <GlassWater className="h-5 w-5 text-blue-500" />,
    waiter: <Bell className="h-5 w-5 text-purple-500" />,
    check: <Receipt className="h-5 w-5 text-emerald-500" />,
    other: <Clock className="h-5 w-5 text-gray-500" />
  };

  return (
    <motion.div
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      exit={{ scale: 0 }}
      className="bg-white rounded-full p-1 shadow-lg"
    >
      {icons[type as keyof typeof icons]}
    </motion.div>
  );
};

const DraggableTable = ({
  table,
  onDragStop,
  selected,
  onClick,
  activeRequests,
}: DraggableTableProps) => {
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
        } bg-green-300 hover:bg-green-400 transition-colors`}
        style={{
          width: table.position.width,
          height: table.position.height,
        }}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-medium text-gray-800">{table.name}</span>
        </div>
        <div className="absolute -top-8 left-0 right-0 flex items-center justify-center">
          <div className="flex gap-2">
            <AnimatePresence>
              {activeRequests.map((request) => (
                <RequestIndicator key={request.id} type={request.type} />
              ))}
            </AnimatePresence>
          </div>
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
  const [showRequestPreview, setShowRequestPreview] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  const { data: tables = [] } = useQuery<TableWithPosition[]>({
    queryKey: ["/api/tables"],
  });

  const { data: requests = [] } = useQuery<Request[]>({
    queryKey: ["/api/requests"],
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

  const getActiveRequests = (tableId: number) => {
    return requests.filter(
      (r) => r.tableId === tableId && 
      r.status !== "completed" && 
      r.status !== "cleared"
    );
  };

  const handleTableClick = (tableId: number) => {
    setSelectedTable(tableId);
    if (!editMode) {
      setShowRequestPreview(true);
    }
  };

  const selectedTableData = selectedTable ? tables.find(t => t.id === selectedTable) || null : null;

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

          <div className="relative">
            <div className="absolute -top-2 right-0 z-10 flex items-center gap-2">
              <Checkbox 
                id="edit-mode" 
                checked={editMode} 
                onCheckedChange={(checked) => setEditMode(checked as boolean)} 
              />
              <Label htmlFor="edit-mode" className="font-medium text-sm">
                Edit Mode
              </Label>
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
                  onClick={() => handleTableClick(table.id)}
                  activeRequests={getActiveRequests(table.id)}
                />
              ))}
            </div>

            <QuickRequestPreview
              table={selectedTableData}
              activeRequests={selectedTable ? getActiveRequests(selectedTable) : []}
              open={showRequestPreview}
              onClose={() => {
                setShowRequestPreview(false);
                setSelectedTable(null);
              }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}