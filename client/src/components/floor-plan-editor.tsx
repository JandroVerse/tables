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
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { GlassWater, Bell, Receipt, MessageSquare, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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

interface FloorPlanEditorProps {
  restaurantId: number;
}

export function FloorPlanEditor({ restaurantId }: FloorPlanEditorProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedTable, setSelectedTable] = useState<number | null>(null);
  const [newTableName, setNewTableName] = useState("");
  const [selectedShape, setSelectedShape] = useState<"square" | "round">("square");
  const [showRequestPreview, setShowRequestPreview] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  const { data: tables = [] } = useQuery<TableWithPosition[]>({
    queryKey: [`/api/restaurants/${restaurantId}/tables`],
  });

  const { data: requests = [] } = useQuery<Request[]>({
    queryKey: ["/api/requests"],
  });

  const { mutate: updateTablePosition } = useMutation({
    mutationFn: async ({ id, position }: { id: number; position: TablePosition }) => {
      return apiRequest("PATCH", `/api/restaurants/${restaurantId}/tables/${id}`, { position });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/restaurants/${restaurantId}/tables`] });
    },
  });

  const { mutate: createTable } = useMutation({
    mutationFn: async ({ name, position }: { name: string; position: TablePosition }) => {
      return apiRequest("POST", `/api/restaurants/${restaurantId}/tables`, { name, position });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/restaurants/${restaurantId}/tables`] });
      setNewTableName("");
      toast({
        title: "Success",
        description: "Table created successfully",
      });
    },
  });

  const { mutate: deleteTable } = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/restaurants/${restaurantId}/tables/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/restaurants/${restaurantId}/tables`] });
      toast({
        title: "Success",
        description: "Table deleted successfully",
      });
    },
  });

  const handleTableDragStop = (tableId: number, { x, y }: { x: number; y: number }) => {
    const table = tables.find((t) => t.id === tableId);
    if (!table) return;

    const updatedPosition = {
      ...table.position,
      x,
      y,
    };

    updateTablePosition({ id: tableId, position: updatedPosition });
  };

  const handleTableResize = (tableId: number, { width, height }: { width: number; height: number }) => {
    const table = tables.find((t) => t.id === tableId);
    if (!table) return;

    const updatedPosition = {
      ...table.position,
      width,
      height,
    };

    updateTablePosition({ id: tableId, position: updatedPosition });
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
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Floor Plan Editor</CardTitle>
        <div className="flex items-center gap-2">
          <Checkbox 
            id="edit-mode" 
            checked={editMode} 
            onCheckedChange={(checked) => setEditMode(checked as boolean)} 
          />
          <Label htmlFor="edit-mode" className="font-medium text-sm">
            Edit Mode
          </Label>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {editMode && (
            <div className="flex gap-4">
              <Input
                placeholder="Table name"
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
          )}

          <div className="relative">
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
                  onResize={handleTableResize}
                  onDelete={deleteTable}
                  selected={selectedTable === table.id}
                  onClick={() => handleTableClick(table.id)}
                  activeRequests={getActiveRequests(table.id)}
                  editMode={editMode}
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