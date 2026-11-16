import React from "react";
import { Sparkles } from "lucide-react";
import { motion } from "motion/react";

export const AmbientTrainBg: React.FC = () => (
  <div className="absolute inset-0 w-full h-full pointer-events-none select-none z-0 overflow-hidden">
    <svg
      className="w-full h-full"
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient
          id="trainG1"
          gradientUnits="userSpaceOnUse"
          x1="-500"
          y1="0"
          x2="1500"
          y2="0"
        >
          <stop offset="0%" stopColor="rgba(0, 122, 255, 0.1)" />
          <stop offset="35%" stopColor="rgba(0, 122, 255, 0.45)" />
          <stop offset="75%" stopColor="rgba(0, 122, 255, 0.85)" />
          <stop offset="100%" stopColor="rgba(255, 255, 255, 0.95)" />
        </linearGradient>
        <linearGradient
          id="trainG2"
          gradientUnits="userSpaceOnUse"
          x1="-500"
          y1="0"
          x2="1500"
          y2="0"
        >
          <stop offset="0%" stopColor="rgba(0, 122, 255, 0.1)" />
          <stop offset="35%" stopColor="rgba(0, 122, 255, 0.45)" />
          <stop offset="75%" stopColor="rgba(0, 122, 255, 0.85)" />
          <stop offset="100%" stopColor="rgba(255, 255, 255, 0.95)" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="5" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <path
        d="M-500 150 Q 300 -100, 1500 150"
        stroke="rgba(0, 122, 255, 0.12)"
        strokeWidth="14"
        strokeDasharray="3,18"
        fill="none"
      />
      <path
        d="M-500 143 Q 300 -100, 1500 143"
        stroke="rgba(0, 122, 255, 0.25)"
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d="M-500 157 Q 300 -100, 1500 157"
        stroke="rgba(0, 122, 255, 0.25)"
        strokeWidth="1.5"
        fill="none"
      />

      <path
        d="M-500 700 L 1500 700"
        stroke="rgba(0, 122, 255, 0.14)"
        strokeWidth="14"
        strokeDasharray="3,12"
        fill="none"
      />
      <path
        d="M-500 693 L 1500 693"
        stroke="rgba(0, 122, 255, 0.28)"
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d="M-500 707 L 1500 707"
        stroke="rgba(0, 122, 255, 0.28)"
        strokeWidth="1.5"
        fill="none"
      />

      <path
        d="M-500 850 Q 500 1020, 1500 730"
        stroke="rgba(142, 142, 147, 0.09)"
        strokeWidth="18"
        strokeDasharray="4,24"
        fill="none"
      />
      <path
        d="M-500 841 Q 500 1020, 1500 721"
        stroke="rgba(142, 142, 147, 0.22)"
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d="M-500 859 Q 500 1020, 1500 739"
        stroke="rgba(142, 142, 147, 0.22)"
        strokeWidth="1.5"
        fill="none"
      />

      <path
        d="M40 250 L 300 280 L 260 310 Z"
        fill="rgba(0, 122, 255, 0.03)"
        filter="blur(12px)"
      />
      <path
        d="M600 700 L 920 620 L 880 670 Z"
        fill="rgba(142, 142, 147, 0.02)"
        filter="blur(16px)"
      />

      <g>
        <path
          d="M-500 150 Q 300 -100, 1500 150"
          stroke="rgba(0, 122, 255, 0.35)"
          strokeWidth="12"
          strokeLinecap="round"
          fill="none"
          pathLength="2000"
          strokeDasharray="75 9 75 9 75 9 75 9 75 2000"
          filter="url(#glow)"
        >
          <animate
            attributeName="stroke-dashoffset"
            values="0; 0; -2000; -2000"
            keyTimes="0; 0.5; 0.875; 1"
            dur="24s"
            repeatCount="indefinite"
            begin="0s"
          />
        </path>
        <path
          d="M-500 150 Q 300 -100, 1500 150"
          stroke="url(#trainG1)"
          strokeWidth="8"
          strokeLinecap="round"
          fill="none"
          pathLength="2000"
          strokeDasharray="75 9 75 9 75 9 75 9 75 2000"
        >
          <animate
            attributeName="stroke-dashoffset"
            values="0; 0; -2000; -2000"
            keyTimes="0; 0.5; 0.875; 1"
            dur="24s"
            repeatCount="indefinite"
            begin="0s"
          />
        </path>
      </g>

      <g>
        <path
          d="M-500 700 L 1500 700"
          stroke="rgba(0, 122, 255, 0.35)"
          strokeWidth="12"
          strokeLinecap="round"
          fill="none"
          pathLength="2000"
          strokeDasharray="75 9 75 9 75 9 75 9 75 2000"
          filter="url(#glow)"
        >
          <animate
            attributeName="stroke-dashoffset"
            values="0; -2000; -2000"
            keyTimes="0; 0.375; 1"
            dur="24s"
            repeatCount="indefinite"
            begin="0s"
          />
        </path>
        <path
          d="M-500 700 L 1500 700"
          stroke="url(#trainG2)"
          strokeWidth="8"
          strokeLinecap="round"
          fill="none"
          pathLength="2000"
          strokeDasharray="75 9 75 9 75 9 75 9 75 2000"
        >
          <animate
            attributeName="stroke-dashoffset"
            values="0; -2000; -2000"
            keyTimes="0; 0.375; 1"
            dur="24s"
            repeatCount="indefinite"
            begin="0s"
          />
        </path>
      </g>
    </svg>
  </div>
);

interface TrainLoaderProps {
  loadingText: string;
}

export const TrainLoader: React.FC<TrainLoaderProps> = ({ loadingText }) => (
  <motion.div
    key="train-loader"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    className="fixed inset-0 bg-white/78 backdrop-blur-2xl flex flex-col items-center justify-center z-50 select-none overflow-hidden"
  >
    <div className="relative w-screen h-[48px] flex items-end mb-8 overflow-hidden bg-transparent">
      <div className="absolute bottom-[2px] left-0 w-full h-[1.5px] bg-neutral-200">
        <div
          className="w-full h-full bg-repeat-x"
          style={{
            backgroundImage:
              "linear-gradient(to right, transparent 0px, transparent 12px, #ddd 12px, #ddd 14px)",
            backgroundSize: "16px 1px",
          }}
        />
      </div>

      <div className="absolute bottom-[3px] left-0 w-[160px] h-[28px] loading-train flex items-end">
        <svg
          width="160"
          height="28"
          viewBox="0 0 160 28"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full"
        >
          <path
            d="M 25 5 L 32 1 L 42 1 M 32 1 L 38 5"
            stroke="#71717A"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M 5 6 L 73 6 L 73 24 L 5 24 Z" fill="#1C1C1E" />
          <path
            d="M 77 6 L 125 6 C 135 6, 148 10, 154 18 C 158 22, 159 23.5, 160 24 L 77 24 Z"
            fill="#1C1C1E"
          />
          <rect x="73.5" y="7" width="3" height="16" fill="#71717A" rx="0.5" />
          <path
            d="M 5 19 H 73 M 77 19 H 135 C 140 19, 145 18, 149 16.5"
            stroke="#007AFF"
            strokeWidth="1.5"
            strokeLinecap="round"
          />

          <rect x="10" y="9" width="10" height="4" rx="1" fill="#E0F2FE" opacity="0.8" />
          <rect x="24" y="9" width="10" height="4" rx="1" fill="#E0F2FE" opacity="0.8" />
          <rect x="38" y="9" width="10" height="4" rx="1" fill="#E0F2FE" opacity="0.8" />
          <rect x="52" y="9" width="10" height="4" rx="1" fill="#E0F2FE" opacity="0.8" />

          <rect x="82" y="9" width="10" height="4" rx="1" fill="#E0F2FE" opacity="0.8" />
          <rect x="96" y="9" width="10" height="4" rx="1" fill="#E0F2FE" opacity="0.8" />
          <rect x="110" y="9" width="10" height="4" rx="1" fill="#E0F2FE" opacity="0.8" />

          <path
            d="M 129 8 L 138 8 C 142 8, 145 11, 147 14 L 137 14 Z"
            fill="#E0F2FE"
            opacity="0.9"
          />

          <circle cx="16" cy="24" r="3" fill="#1C1C1E" stroke="#71717A" strokeWidth="1" />
          <circle cx="16" cy="24" r="1" fill="#E0F2FE" />
          <circle cx="26" cy="24" r="3" fill="#1C1C1E" stroke="#71717A" strokeWidth="1" />
          <circle cx="26" cy="24" r="1" fill="#E0F2FE" />

          <circle cx="54" cy="24" r="3" fill="#1C1C1E" stroke="#71717A" strokeWidth="1" />
          <circle cx="54" cy="24" r="1" fill="#E0F2FE" />
          <circle cx="64" cy="24" r="3" fill="#1C1C1E" stroke="#71717A" strokeWidth="1" />
          <circle cx="64" cy="24" r="1" fill="#E0F2FE" />

          <circle cx="88" cy="24" r="3" fill="#1C1C1E" stroke="#71717A" strokeWidth="1" />
          <circle cx="88" cy="24" r="1" fill="#E0F2FE" />
          <circle cx="98" cy="24" r="3" fill="#1C1C1E" stroke="#71717A" strokeWidth="1" />
          <circle cx="98" cy="24" r="1" fill="#E0F2FE" />

          <circle cx="122" cy="24" r="3" fill="#1C1C1E" stroke="#71717A" strokeWidth="1" />
          <circle cx="122" cy="24" r="1" fill="#E0F2FE" />
          <circle cx="132" cy="24" r="3" fill="#1C1C1E" stroke="#71717A" strokeWidth="1" />
          <circle cx="132" cy="24" r="1" fill="#E0F2FE" />
        </svg>
      </div>
    </div>

    <div className="w-full max-w-sm flex flex-col items-center text-center px-6">
      <div className="flex items-center gap-2 text-[#1C1C1E]">
        <Sparkles
          className="w-5 h-5 text-[#007AFF] animate-spin"
          style={{ animationDuration: "3s" }}
        />
        <h2 className="text-xl font-bold tracking-tight">{loadingText}</h2>
      </div>
      <p className="text-xs text-gray-500 mt-1">
        ШІ обробляє дані. Будь ласка, зачекайте.
      </p>
    </div>
  </motion.div>
);
