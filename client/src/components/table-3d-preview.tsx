import { useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

interface TablePreviewProps {
  shape: "square" | "round";
  width: number;
  height: number;
  color?: string;
}

function Table({ shape, width, height, color = "#4ade80" }: TablePreviewProps) {
  const scaledWidth = width / 100;
  const scaledHeight = height / 100;
  
  return (
    <group>
      {/* Table top */}
      {shape === "round" ? (
        <mesh position={[0, 0.05, 0]} castShadow>
          <cylinderGeometry args={[scaledWidth / 2, scaledWidth / 2, 0.1, 32]} />
          <meshStandardMaterial color={color} />
        </mesh>
      ) : (
        <mesh position={[0, 0.05, 0]} castShadow>
          <boxGeometry args={[scaledWidth, 0.1, scaledHeight]} />
          <meshStandardMaterial color={color} />
        </mesh>
      )}
      
      {/* Table legs */}
      {shape === "round" ? (
        <mesh position={[0, -0.5, 0]} castShadow>
          <cylinderGeometry args={[0.1, 0.15, 1, 8]} />
          <meshStandardMaterial color="#666666" />
        </mesh>
      ) : (
        <>
          {[
            [-scaledWidth / 2 + 0.1, -0.5, -scaledHeight / 2 + 0.1],
            [scaledWidth / 2 - 0.1, -0.5, -scaledHeight / 2 + 0.1],
            [-scaledWidth / 2 + 0.1, -0.5, scaledHeight / 2 - 0.1],
            [scaledWidth / 2 - 0.1, -0.5, scaledHeight / 2 - 0.1],
          ].map((position, index) => (
            <mesh key={index} position={position} castShadow>
              <boxGeometry args={[0.1, 1, 0.1]} />
              <meshStandardMaterial color="#666666" />
            </mesh>
          ))}
        </>
      )}
    </group>
  );
}

export function TablePreview({ shape, width, height, color }: TablePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Table Preview</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
          <Canvas shadows>
            <PerspectiveCamera makeDefault position={[4, 4, 4]} />
            <OrbitControls enableZoom={false} />
            <ambientLight intensity={0.5} />
            <pointLight position={[10, 10, 10]} intensity={0.8} castShadow />
            <pointLight position={[-10, -10, -10]} intensity={0.5} />
            <Table shape={shape} width={width} height={height} color={color} />
            <mesh 
              rotation={[-Math.PI / 2, 0, 0]} 
              position={[0, -1, 0]} 
              receiveShadow
            >
              <planeGeometry args={[10, 10]} />
              <meshStandardMaterial color="#f3f4f6" />
            </mesh>
          </Canvas>
        </div>
      </CardContent>
    </Card>
  );
}
