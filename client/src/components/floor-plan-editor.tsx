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
import { TablePreview } from "./table-3d-preview";

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
  onResize: (tableId: number, size: { width: number; height: number }) => void;
  onDelete: (tableId: number) => void;
  selected: boolean;
  onClick: () => void;
  activeRequests: Request[];
  editMode: boolean;
}

const ResizeHandle = ({ className, onDrag }: { className: string; onDrag: (delta: { x: number; y: number }) => void }) => {
  return (
    <div 
      className={`absolute w-3 h-3 bg-primary hover:bg-primary/80 active:scale-110 transition-all cursor-nwse-resize rounded-full ${className}`}
      onMouseDown={(e) => {
        e.stopPropagation();
        const startX = e.clientX;
        const startY = e.clientY;

        const handleMouseMove = (e: MouseEvent) => {
          const delta = {
            x: e.clientX - startX,
            y: e.clientY - startY,
          };
          onDrag(delta);
        };

        const handleMouseUp = () => {
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
      }}
    />
  );
};

const DraggableTable = ({
  table,
  onDragStop,
  onResize,
  onDelete,
  selected,
  onClick,
  activeRequests,
  editMode,
}: DraggableTableProps) => {
  const [currentSize, setCurrentSize] = useState({ 
    width: table.position.width, 
    height: table.position.height 
  });
  const [position, setPosition] = useState({ x: table.position.x, y: table.position.y });
  const isDragging = useRef(false);

  useEffect(() => {
    if (!isDragging.current) {
      setPosition({ x: table.position.x, y: table.position.y });
    }
  }, [table.position.x, table.position.y]);

  useEffect(() => {
    setCurrentSize({ 
      width: table.position.width, 
      height: table.position.height 
    });
  }, [table.position.width, table.position.height]);

  const handleDrag = (_e: any, data: { x: number; y: number }) => {
    isDragging.current = true;
    setPosition({ x: data.x, y: data.y });
  };

  const handleDragStop = (_e: any, data: { x: number; y: number }) => {
    isDragging.current = false;
    // Snap to grid only on drag stop
    const snappedX = Math.round(data.x / 20) * 20;
    const snappedY = Math.round(data.y / 20) * 20;
    setPosition({ x: snappedX, y: snappedY });
    onDragStop(table.id, { x: snappedX, y: snappedY });
  };

  const handleResize = (handle: 'se' | 'sw' | 'ne' | 'nw', delta: { x: number; y: number }) => {
    if (!editMode) return;

    let newWidth = currentSize.width;
    let newHeight = currentSize.height;
    let newX = position.x;
    let newY = position.y;

    switch (handle) {
      case 'se':
        newWidth = Math.max(60, currentSize.width + delta.x);
        newHeight = Math.max(60, currentSize.height + delta.y);
        break;
      case 'sw':
        newWidth = Math.max(60, currentSize.width - delta.x);
        newHeight = Math.max(60, currentSize.height + delta.y);
        newX = position.x + delta.x;
        break;
      case 'ne':
        newWidth = Math.max(60, currentSize.width + delta.x);
        newHeight = Math.max(60, currentSize.height - delta.y);
        newY = position.y + delta.y;
        break;
      case 'nw':
        newWidth = Math.max(60, currentSize.width - delta.x);
        newHeight = Math.max(60, currentSize.height - delta.y);
        newX = position.x + delta.x;
        newY = position.y + delta.y;
        break;
    }

    // Update the local state
    setCurrentSize({ width: newWidth, height: newHeight });
    setPosition({ x: newX, y: newY });

    // Call the parent handlers with the new position and size
    onDragStop(table.id, { x: newX, y: newY });
    onResize(table.id, { width: newWidth, height: newHeight });
  };

  return (
    <Draggable
      position={position}
      onDrag={handleDrag}
      onStop={handleDragStop}
      bounds="parent"
      disabled={!editMode}
    >
      <div
        className={`absolute cursor-move select-none ${
          table.position.shape === "round" ? "rounded-full" : "rounded-lg"
        } ${
          selected ? "ring-2 ring-primary" : ""
        } bg-green-300 hover:bg-green-400 transition-colors`}
        style={{
          width: currentSize.width,
          height: currentSize.height,
        }}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-medium text-gray-800">{table.name}</span>
        </div>
        {editMode && (
          <>
            <ResizeHandle
              className="bottom-0 right-0 -mb-1.5 -mr-1.5"
              onDrag={(delta) => handleResize('se', delta)}
            />
            <ResizeHandle
              className="bottom-0 left-0 -mb-1.5 -ml-1.5"
              onDrag={(delta) => handleResize('sw', delta)}
            />
            <ResizeHandle
              className="top-0 right-0 -mt-1.5 -mr-1.5"
              onDrag={(delta) => handleResize('ne', delta)}
            />
            <ResizeHandle
              className="top-0 left-0 -mt-1.5 -ml-1.5"
              onDrag={(delta) => handleResize('nw', delta)}
            />
          </>
        )}
        <div className="absolute -top-8 left-0 right-0 flex items-center justify-center">
          <div className="flex gap-2">
            <AnimatePresence>
              {activeRequests.map((request) => (
                <motion.div
                  key={request.id}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  className="bg-white rounded-full p-1 shadow-lg"
                >
                  <RequestIndicator type={request.type} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
        {editMode && (
          <div className="absolute -top-8 left-1/2 -translate-x-1/2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="icon" className="h-6 w-6">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {table.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete the
                    table and all its associated data.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => onDelete(table.id)}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>
    </Draggable>
  );
};

const RequestIndicator = ({ type }: { type: string }) => {
  const icons = {
    water: <GlassWater className="h-5 w-5 text-blue-500" />,
    waiter: <Bell className="h-5 w-5 text-purple-500" />,
    check: <Receipt className="h-5 w-5 text-emerald-500" />,
    other: <MessageSquare className="h-5 w-5 text-gray-500" />
  };

  return icons[type as keyof typeof icons] || icons.other;
};

export function FloorPlanEditor() {
  const { toast } = useToast();
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
      toast({
        title: "Success",
        description: "Table created successfully",
      });
    },
  });

  const { mutate: deleteTable } = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/tables/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
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

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
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
            </div>

            {editMode && selectedTableData && (
              <div className="lg:col-span-1">
                <TablePreview
                  shape={selectedTableData.position.shape}
                  width={selectedTableData.position.width}
                  height={selectedTableData.position.height}
                />
              </div>
            )}
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
      </CardContent>
    </Card>
  );
}