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

const RequestIndicator = ({ type }: { type: string }) => {
  const icons = {
    water: <GlassWater className="h-5 w-5 text-blue-500" />,
    waiter: <Bell className="h-5 w-5 text-purple-500" />,
    check: <Receipt className="h-5 w-5 text-emerald-500" />,
    other: <MessageSquare className="h-5 w-5 text-gray-500" />,
  };

  return icons[type as keyof typeof icons] || icons.other;
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
  const [size, setSize] = useState({
    width: table.position.width || 100,
    height: table.position.height || 100,
  });
  const [position, setPosition] = useState({
    x: table.position.x || 0,
    y: table.position.y || 0,
  });
  const [resizing, setResizing] = useState(false);
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);

  useEffect(() => {
    setSize({
      width: table.position.width || 100,
      height: table.position.height || 100,
    });
    setPosition({
      x: table.position.x || 0,
      y: table.position.y || 0,
    });
  }, [table.position]);

  const handleResizeStart = (e: React.MouseEvent, handle: string) => {
    if (!editMode) return;
    e.stopPropagation();
    e.preventDefault();

    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = size.width;
    const startHeight = size.height;
    const startPosition = { ...position };

    setResizing(true);
    setResizeHandle(handle);

    const handleMove = (e: MouseEvent) => {
      if (!resizing) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      let newWidth = startWidth;
      let newHeight = startHeight;
      let newX = startPosition.x;
      let newY = startPosition.y;

      // Handle resizing based on which corner is being dragged
      switch (handle) {
        case 'top-left':
          newWidth = Math.max(80, startWidth - deltaX);
          newHeight = Math.max(80, startHeight - deltaY);
          newX = startPosition.x + (startWidth - newWidth);
          newY = startPosition.y + (startHeight - newHeight);
          break;
        case 'top-right':
          newWidth = Math.max(80, startWidth + deltaX);
          newHeight = Math.max(80, startHeight - deltaY);
          newY = startPosition.y + (startHeight - newHeight);
          break;
        case 'bottom-left':
          newWidth = Math.max(80, startWidth - deltaX);
          newHeight = Math.max(80, startHeight + deltaY);
          newX = startPosition.x + (startWidth - newWidth);
          break;
        case 'bottom-right':
          newWidth = Math.max(80, startWidth + deltaX);
          newHeight = Math.max(80, startHeight + deltaY);
          break;
      }

      // Enforce maximum size
      newWidth = Math.min(300, newWidth);
      newHeight = Math.min(300, newHeight);

      setSize({ width: newWidth, height: newHeight });
      setPosition({ x: newX, y: newY });
    };

    const handleEnd = () => {
      setResizing(false);
      setResizeHandle(null);
      onResize(table.id, size);
      onDragStop(table.id, position);
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleEnd);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
  };

  return (
    <Draggable
      position={position}
      onDrag={(e, data) => setPosition({ x: data.x, y: data.y })}
      onStop={(e, data) => onDragStop(table.id, data)}
      disabled={!editMode || resizing}
      bounds="parent"
    >
      <div
        className={`absolute cursor-move ${
          table.position.shape === "round" ? "rounded-full" : "rounded-lg"
        } ${
          selected ? "ring-2 ring-primary" : ""
        } bg-green-100 hover:bg-green-200 transition-colors`}
        style={{
          width: size.width,
          height: size.height,
          touchAction: 'none',
          userSelect: 'none',
        }}
        onClick={(e) => {
          if (!resizing) {
            e.stopPropagation();
            onClick();
          }
        }}
      >
        {/* Table content */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-medium text-gray-800">{table.name}</span>
        </div>

        {/* Resize handles */}
        {editMode && (
          <>
            {/* Top-left resize handle */}
            <div
              className={`absolute -top-1 -left-1 w-3 h-3 cursor-nw-resize rounded-full bg-primary ${
                resizeHandle === 'top-left' ? 'opacity-100' : 'opacity-50'
              }`}
              onMouseDown={(e) => handleResizeStart(e, 'top-left')}
            />
            {/* Top-right resize handle */}
            <div
              className={`absolute -top-1 -right-1 w-3 h-3 cursor-ne-resize rounded-full bg-primary ${
                resizeHandle === 'top-right' ? 'opacity-100' : 'opacity-50'
              }`}
              onMouseDown={(e) => handleResizeStart(e, 'top-right')}
            />
            {/* Bottom-left resize handle */}
            <div
              className={`absolute -bottom-1 -left-1 w-3 h-3 cursor-sw-resize rounded-full bg-primary ${
                resizeHandle === 'bottom-left' ? 'opacity-100' : 'opacity-50'
              }`}
              onMouseDown={(e) => handleResizeStart(e, 'bottom-left')}
            />
            {/* Bottom-right resize handle */}
            <div
              className={`absolute -bottom-1 -right-1 w-3 h-3 cursor-se-resize rounded-full bg-primary ${
                resizeHandle === 'bottom-right' ? 'opacity-100' : 'opacity-50'
              }`}
              onMouseDown={(e) => handleResizeStart(e, 'bottom-right')}
            />
          </>
        )}

        {/* Delete button */}
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

        {/* Request indicators */}
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
      </div>
    </Draggable>
  );
};

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

    const defaultPosition: TablePosition = {
      x: 50,
      y: 50,
      width: 100,
      height: 100,
      shape: selectedShape,
    };

    createTable({ name: newTableName, position: defaultPosition });
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