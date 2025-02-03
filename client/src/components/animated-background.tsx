import { motion } from "framer-motion";

export function AnimatedBackground() {
  return (
    <div className="fixed inset-0 z-0">
      {/* Warm ambient lighting effect */}
      <motion.div
        className="absolute inset-0 opacity-80"
        animate={{
          background: [
            "radial-gradient(circle at 20% 20%, rgba(255, 183, 77, 0.5) 0%, rgba(255, 183, 77, 0) 70%)",
            "radial-gradient(circle at 80% 80%, rgba(255, 183, 77, 0.5) 0%, rgba(255, 183, 77, 0) 70%)",
            "radial-gradient(circle at 50% 50%, rgba(255, 183, 77, 0.5) 0%, rgba(255, 183, 77, 0) 70%)",
          ],
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
          repeatType: "reverse",
        }}
      />

      {/* Restaurant-themed pattern overlay */}
      <svg className="absolute inset-0 w-full h-full opacity-[0.08]">
        <pattern
          id="restaurant-pattern"
          x="0"
          y="0"
          width="40"
          height="40"
          patternUnits="userSpaceOnUse"
        >
          {/* Plate-like circles */}
          <circle
            cx="20"
            cy="20"
            r="15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-primary"
          />
          <circle
            cx="20"
            cy="20"
            r="8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            className="text-primary"
          />
        </pattern>
        <rect width="100%" height="100%" fill="url(#restaurant-pattern)" />
      </svg>

      {/* Enhanced floating particles */}
      <div className="absolute inset-0">
        {[...Array(30)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-3 h-3 rounded-full bg-primary/40"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
            }}
            animate={{
              y: [0, -40, 0],
              opacity: [0, 1, 0],
              scale: [1, 1.5, 1],
            }}
            transition={{
              duration: Math.random() * 6 + 6,
              repeat: Infinity,
              delay: Math.random() * 4,
            }}
          />
        ))}
      </div>
    </div>
  );
}