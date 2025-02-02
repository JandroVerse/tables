import { motion } from "framer-motion";

export function AnimatedBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      {/* Ambient lighting effect */}
      <motion.div
        className="absolute inset-0 opacity-30"
        animate={{
          background: [
            "radial-gradient(circle at 20% 20%, rgba(255, 225, 180, 0.15) 0%, rgba(255, 225, 180, 0) 50%)",
            "radial-gradient(circle at 80% 80%, rgba(255, 225, 180, 0.15) 0%, rgba(255, 225, 180, 0) 50%)",
            "radial-gradient(circle at 50% 50%, rgba(255, 225, 180, 0.15) 0%, rgba(255, 225, 180, 0) 50%)",
          ],
        }}
        transition={{
          duration: 10,
          repeat: Infinity,
          repeatType: "reverse",
        }}
      />
      
      {/* Subtle pattern overlay */}
      <svg className="absolute inset-0 w-full h-full opacity-[0.015]">
        <pattern
          id="restaurant-pattern"
          x="0"
          y="0"
          width="50"
          height="50"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M25,0 L50,25 L25,50 L0,25 Z"
            fill="currentColor"
            className="text-primary"
          />
          <circle
            cx="25"
            cy="25"
            r="2"
            fill="currentColor"
            className="text-primary"
          />
        </pattern>
        <rect width="100%" height="100%" fill="url(#restaurant-pattern)" />
      </svg>

      {/* Floating particles effect */}
      <div className="absolute inset-0">
        {[...Array(20)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-1 h-1 bg-primary/10 rounded-full"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
            }}
            animate={{
              y: [0, -20, 0],
              opacity: [0, 0.5, 0],
            }}
            transition={{
              duration: Math.random() * 3 + 2,
              repeat: Infinity,
              delay: Math.random() * 2,
            }}
          />
        ))}
      </div>
    </div>
  );
}
