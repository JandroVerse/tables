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
import { GlassWater, Bell, Receipt, MessageSquare, Trash2, Grid } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Table, Request } from "@db/schema";
import { motion, AnimatePresence } from "framer-motion";
import { QuickRequestPreview } from "./quick-request-preview";

const GRID_SIZE = 20;
const GRID_COLOR = "rgba(0, 0, 0, 0.1)";

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

const GridBackground = () => {
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage: `
          linear-gradient(to right, ${GRID_COLOR} 1px, transparent 1px),
          linear-gradient(to bottom, ${GRID_COLOR} 1px, transparent 1px)
        `,
        backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
      }}
    />
  );
};

const snapToGrid = (value: number): number => {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
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
    x: snapToGrid(table.position.x || 0),
    y: snapToGrid(table.position.y || 0),
  });
  const [resizing, setResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<string | null>(null);

  const handleResizeStart = (e: React.MouseEvent, direction: string) => {
    if (!editMode) return;
    e.stopPropagation();
    setResizing(true);
    setResizeDirection(direction);

    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = size.width;
    const startHeight = size.height;

    const handleMove = (e: MouseEvent) => {
      const dx = snapToGrid(e.clientX - startX);
      const dy = snapToGrid(e.clientY - startY);

      let newWidth = startWidth;
      let newHeight = startHeight;
      let newX = position.x;
      let newY = position.y;

      if (direction.includes('right')) {
        newWidth = Math.min(400, Math.max(80, startWidth + dx));
      } else if (direction.includes('left')) {
        const possibleWidth = Math.min(400, Math.max(80, startWidth - dx));
        if (possibleWidth !== startWidth) {
          newWidth = possibleWidth;
          newX = position.x + (startWidth - possibleWidth);
        }
      }

      if (direction.includes('bottom')) {
        newHeight = Math.min(400, Math.max(80, startHeight + dy));
      } else if (direction.includes('top')) {
        const possibleHeight = Math.min(400, Math.max(80, startHeight - dy));
        if (possibleHeight !== startHeight) {
          newHeight = possibleHeight;
          newY = position.y + (startHeight - possibleHeight);
        }
      }

      setSize({ width: newWidth, height: newHeight });
      setPosition({ x: newX, y: newY });
    };

    const handleEnd = () => {
      setResizing(false);
      setResizeDirection(null);
      onResize(table.id, size);
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
  };

  const resizeHandleClass = "absolute w-4 h-4 bg-primary rounded-full transform -translate-x-1/2 -translate-y-1/2 cursor-pointer hover:scale-110 transition-transform";

  return (
    <Draggable
      position={position}
      onDrag={(e, data) => {
        const snappedX = snapToGrid(data.x);
        const snappedY = snapToGrid(data.y);
        setPosition({ x: snappedX, y: snappedY });
      }}
      onStop={(e, data) => {
        const snappedX = snapToGrid(data.x);
        const snappedY = snapToGrid(data.y);
        onDragStop(table.id, { x: snappedX, y: snappedY });
      }}
      disabled={resizing || !editMode}
      grid={[GRID_SIZE, GRID_SIZE]}
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
        }}
        data-table-id={table.id}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        {/* Table content */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-medium text-gray-800">{table.name}</span>
        </div>

        {/* Resize handles with improved visual feedback */}
        {editMode && (
          <>
            {['top', 'right', 'bottom', 'left', 'topright', 'bottomright', 'bottomleft', 'topleft'].map((direction) => {
              const getPosition = () => {
                const positions = {
                  top: { left: '50%', top: '0%' },
                  right: { left: '100%', top: '50%' },
                  bottom: { left: '50%', top: '100%' },
                  left: { left: '0%', top: '50%' },
                  topright: { left: '100%', top: '0%' },
                  bottomright: { left: '100%', top: '100%' },
                  bottomleft: { left: '0%', top: '100%' },
                  topleft: { left: '0%', top: '0%' },
                };
                return positions[direction as keyof typeof positions];
              };

              const getCursor = () => {
                const cursors = {
                  top: 'n-resize',
                  right: 'e-resize',
                  bottom: 's-resize',
                  left: 'w-resize',
                  topright: 'ne-resize',
                  bottomright: 'se-resize',
                  bottomleft: 'sw-resize',
                  topleft: 'nw-resize',
                };
                return cursors[direction as keyof typeof cursors];
              };

              return (
                <div
                  key={direction}
                  className={`${resizeHandleClass} ${resizeDirection === direction ? 'scale-125 bg-primary-dark' : ''}`}
                  style={{
                    ...getPosition(),
                    cursor: getCursor(),
                  }}
                  onMouseDown={(e) => handleResizeStart(e, direction)}
                />
              );
            })}
          </>
        )}

        {/* Delete button - moved to bottom */}
        {editMode && (
          <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 z-10">
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
                    This will permanently delete the table and all its associated data.
                    This action cannot be undone.
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

interface TablePreviewCardProps {
  table: TableWithPosition;
  onClose: () => void;
}

function TablePreviewCard({ table, onClose }: TablePreviewCardProps) {
  return (
    <Card className="max-w-sm">
      <CardHeader>
        <CardTitle>{table.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="w-full" dangerouslySetInnerHTML={{ __html: table.qrCode }} />
        </div>
      </CardContent>
    </Card>
  );
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
    const [showGrid, setShowGrid] = useState(false);
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
      const res = await apiRequest("POST", `/api/restaurants/${restaurantId}/tables`, { name, position });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || "Failed to create table");
      }
      return res.json();
    },
    onSuccess: (newTable) => {
      queryClient.invalidateQueries({ queryKey: [`/api/restaurants/${restaurantId}/tables`] });
      toast({
        title: "Success",
        description: "Table created successfully",
      });
      setNewTableName("");
    },
    onError: (error: Error) => {
      console.error('Table creation error:', error);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
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
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="edit-mode"
              checked={editMode}
              onCheckedChange={(checked) => {
                setEditMode(checked as boolean);
                if (!checked && tables.length > 0) {
                  tables.forEach(table => {
                    const tableElement = document.querySelector(`[data-table-id="${table.id}"]`);
                    if (tableElement) {
                      const rect = tableElement.getBoundingClientRect();
                      updateTablePosition({
                        id: table.id,
                        position: {
                          ...table.position,
                          x: snapToGrid(parseFloat(tableElement.style.transform.split('translate(')[1])),
                          y: snapToGrid(parseFloat(tableElement.style.transform.split(', ')[1])),
                          width: snapToGrid(rect.width),
                          height: snapToGrid(rect.height)
                        }
                      });
                    }
                  });
                }
              }}
            />
            <Label htmlFor="edit-mode" className="font-medium text-sm">
              Edit Mode
            </Label>
          </div>
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-2"
              onClick={() => setShowGrid(!showGrid)}
            >
              <Grid className="h-4 w-4" />
              {showGrid ? "Hide Grid" : "Show Grid"}
            </Button>
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
                {showGrid && <GridBackground />}
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