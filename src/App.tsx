import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { 
  Camera, 
  Upload, 
  Clock, 
  Mail, 
  Sparkles, 
  ChevronLeft, 
  RotateCw, 
  ZoomIn, 
  ZoomOut, 
  FileText,
  CheckCircle2,
  AlertCircle,
  Pencil
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import Cropper from "cropperjs";

// -------------------------------------------------------------
// ТИПИ ТА ІНТЕРФЕЙСИ (Для повної суворої типізації TypeScript)
// -------------------------------------------------------------
export interface DocumentMeta {
  period_text?: string;
  year?: string;
  date_filled?: string;
  period_start?: string;
  period_end?: string;
  period_type?: string;
  crossed_out_headers?: string[];
}

export interface DayRecord {
  hours: string;
  code: string;
}

export interface TotalsRecord {
  days: string;
  hours: string;
}

export interface AbsenceReason {
  col?: string;
  code: string;
  days: string;
  hours: string;
}

export interface AbsencesRecord {
  total_days: string;
  total_hours: string;
  reasons: AbsenceReason[];
}

export interface EmployeeRecord {
  row_id: number;
  days: { [day: string]: DayRecord };
  totals: TotalsRecord;
  absences: AbsencesRecord;
}

export interface TimesheetData {
  document_meta?: DocumentMeta;
  employees?: EmployeeRecord[];
}

export interface ArchiveItem {
  id: number;
  period_text: string;
  year: string;
  date_filled: string;
  created_at: string;
}

// Глобальні функції у вікні (window) для викликів з HTML-таблиці
declare global {
  interface Window {
    editCell?: (empIndex: number, day: string, type: "hours" | "code", td: HTMLElement) => void;
    toggleYellow?: (day: string, td: HTMLElement) => void;
    editTotals?: (empIndex: number, type: "days" | "hours", td: HTMLElement) => void;
    editMeta?: (field: keyof DocumentMeta, element: HTMLElement) => void;
    editAbsenceTotal?: (empIndex: number, td: HTMLElement) => void;
    editAbsenceReason?: (empIndex: number, colIndex: number, td: HTMLElement) => void;
  }
}

// Допоміжна функція для визначення кодів, які належать до колонок правої частини таблиці
const getCodesForCol = (col: number): string[] => {
  if (col === 31) return ["В", "Щ", "Д", "8", "9", "10"];
  if (col === 32) return ["Н", "ВЧ", "11", "12", "13", "14", "15", "17", "22"];
  if (col === 33) return ["НА", "БЗ", "18", "19"];
  if (col === 34) return ["НД", "20"];
  if (col === 35) return ["П", "23"];
  if (col === 36) return ["ПР", "24"];
  if (col === 37) return ["С", "25"];
  if (col === 38) return ["ТН", "Л", "26", "27"];
  return []; // 39-та колонка для решти кодів
};

export default function App() {
  // Екземпляр Telegram WebApp
  const tg = (window as any).Telegram?.WebApp;

  // Стани переключення екранів додатку
  const [screen, setScreen] = useState<"menu" | "camera" | "crop" | "review" | "archive">("menu");
  const [subScreen, setSubScreen] = useState<"preview" | "table">("preview");
  const [archiveMode, setArchiveMode] = useState<"view" | "email">("view");
  const [imageSource, setImageSource] = useState<"camera" | "upload">("camera");
  const [isReadOnly, setIsReadOnly] = useState<boolean>(false);

  // Основні стани для роботи з даними
  const [currentBase64Image, setCurrentBase64Image] = useState<string | null>(null);
  const [originalUploadedImage, setOriginalUploadedImage] = useState<string | null>(null);
  const [finalParsedData, setFinalParsedData] = useState<TimesheetData | null>(null);
  const [archiveList, setArchiveList] = useState<ArchiveItem[]>([]);
  const [archiveLoading, setArchiveLoading] = useState<boolean>(false);
  const [archiveMessage, setArchiveMessage] = useState<string>("");
  const [currentArchiveId, setCurrentArchiveId] = useState<number | null>(null);
  
  // Стан для кастомного діалогового вікна редагування комірок (обхід обмежень iframe на prompt)
  const [editingCell, setEditingCell] = useState<{
    empIndex: number;
    day?: string;
    type?: "hours" | "code" | "totals_days" | "totals_hours" | "meta" | "absence_total" | "absence_reason";
    metaField?: keyof DocumentMeta;
    colIndex?: number;
    title: string;
    value: string;
  } | null>(null);

  // Стани завантаження
  const [globalLoading, setGlobalLoading] = useState<boolean>(false);
  const [globalLoadingText, setGlobalLoadingText] = useState<string>("");
  const [captureLoading, setCaptureLoading] = useState<boolean>(false);
  
  // Елементи інтерфейсу та управління
  const [zoomScale, setZoomScale] = useState<number>(0.82);
  const [titleText, setTitleText] = useState<string>("Перевірте дані (Редагування)");
  const [confirmButtonVisible, setConfirmButtonVisible] = useState<boolean>(true);
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);

  // Референси для HTML5 API (Камера, Зображення, Обрізка)
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cropperImageRef = useRef<HTMLImageElement | null>(null);
  const cropperInstanceRef = useRef<Cropper | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const hiddenFileInputRef = useRef<HTMLInputElement | null>(null);

  // Динамічний вибір API URL (локальний проксі для CORS)
  const DEFAULT_BACKEND_URL = "/api";
  const BACKEND_URL = window.location.hostname.includes('run.app') || window.location.hostname.includes('localhost')
    ? ""
    : DEFAULT_BACKEND_URL;

  // Формування заголовків з автентифікацією Telegram
  const getAuthHeaders = (): HeadersInit => {
    const headers: { [key: string]: string } = {
      "Content-Type": "application/json",
    };
    if (tg?.initData) {
      headers["X-Telegram-Init-Data"] = tg.initData;
    }
    return headers;
  };

  // Механізм відновлення стану при перезавантаженні (відстеження процесу ШІ)
  useEffect(() => {
    let pollingInterval: any = null;

    const checkState = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/state`, {
          method: "GET",
          headers: getAuthHeaders()
        });
        const result = await res.json();
        if (result.status === "success" && result.state) {
          const s = result.state;
          if (s.status === "processing") {
            setGlobalLoadingText("ШІ аналізує табель...");
            setGlobalLoading(true);
            setScreen("review");
            setSubScreen("preview");
            
            if (!pollingInterval) {
              pollingInterval = setInterval(checkState, 3000);
            }
          } else if (s.status === "ready" && s.raw_json) {
            if (pollingInterval) {
              clearInterval(pollingInterval);
              pollingInterval = null;
            }
            const data = JSON.parse(s.raw_json);
            setFinalParsedData(data);
            setGlobalLoading(false);
            setScreen("review");
            setSubScreen("table");
            setIsReadOnly(false);
            setConfirmButtonVisible(true);
            setTitleText("Перевірте дані (Редагування)");
            setCurrentArchiveId(null);
          } else if (s.status === "error") {
            if (pollingInterval) {
              clearInterval(pollingInterval);
              pollingInterval = null;
            }
            setGlobalLoading(false);
            alert("❌ Помилка обробки: " + s.error_message);
            // Скидання помилкового статусу в базі
            await fetch(`${BACKEND_URL}/state/reset`, {
              method: "POST",
              headers: getAuthHeaders()
            });
          }
        }
      } catch (err) {
        console.error("Failed to recover user state:", err);
      }
    };

    checkState();

    return () => {
      if (pollingInterval) clearInterval(pollingInterval);
    };
  }, []);

  // Базові налаштування UI від Telegram
  useEffect(() => {
    if (tg) {
      tg.expand();
      if (typeof tg.disableVerticalSwipes === "function") tg.disableVerticalSwipes();
      if (typeof tg.disableClosingConfirmation === "function") tg.disableClosingConfirmation();
      tg.ready();
    }
  }, [tg]);

  // Керування видимістю кнопки "Назад" у Telegram
  useEffect(() => {
    if (tg && tg.BackButton) {
      // Кнопка ховається на головному меню та при активному завантаженні
      if (screen === "menu" || globalLoading) {
        tg.BackButton.hide();
      } else {
        tg.BackButton.show();
      }
    }
  }, [screen, globalLoading, tg]);

  // Логіка переходів по кнопці "Назад"
  useEffect(() => {
    if (tg && tg.BackButton) {
      const handleBack = () => {
        triggerHaptic();
        if (screen === "camera") {
          stopCamera();
          setScreen("menu");
        } else if (screen === "crop") {
          if (cropperInstanceRef.current) cropperInstanceRef.current.destroy();
          setScreen("menu");
        } else if (screen === "archive") {
          setScreen("menu");
        } else if (screen === "review") {
          if (subScreen === "preview") {
            if (imageSource === "camera") {
              setScreen("camera");
            } else {
              if (originalUploadedImage) {
                setCurrentBase64Image(originalUploadedImage);
              }
              setScreen("crop");
            }
          } else if (subScreen === "table") {
            if (isReadOnly) {
              setScreen("archive");
            } else {
              if (currentArchiveId !== null) {
                // Повернення до режиму перегляду архіву замість виходу
                setIsReadOnly(true);
                setTitleText("Перегляд архіву (Тільки читання)");
                setConfirmButtonVisible(false);
              } else {
                setSubScreen("preview");
                setConfirmButtonVisible(true);
                setTitleText("Перевірте дані (Редагування)");
              }
            }
          }
        }
      };

      tg.BackButton.onClick(handleBack);
      return () => {
        tg.BackButton.offClick(handleBack);
      };
    }
  }, [screen, subScreen, imageSource, isReadOnly, tg, originalUploadedImage, currentArchiveId]);

  // Включення/вимкнення камери в залежності від поточного екрану
  useEffect(() => {
    if (screen === "camera") {
      startCamera();
    }
    return () => {
      stopCamera();
    };
  }, [screen]);

  // Вібраційний відгук інтерфейсу Telegram
  const triggerHaptic = () => {
    if (tg && tg.HapticFeedback) {
      try {
        tg.HapticFeedback.impactOccurred("light");
      } catch (e) {
        console.error("Haptic feedback failed", e);
      }
    }
  };

  // -------------------------------------------------------------
  // ЛОГІКА КАМЕРИ ТА ЗАХОПЛЕННЯ ЗОБРАЖЕННЯ
  // -------------------------------------------------------------
  const startCamera = async () => {
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: "environment", 
          width: { ideal: 3840 }, 
          height: { ideal: 2160 } 
        }
      });
      localStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(e => console.error(e));
      }
      setTorchOn(false);
    } catch (err) {
      alert("Не вдалося запустити камеру. Спробуйте завантажити файл.");
    }
  };

  const stopCamera = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        try { track.stop(); } catch (e) {}
      });
      localStreamRef.current = null;
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => {
        try { track.stop(); } catch (e) {}
      });
      videoRef.current.srcObject = null;
    }
  };

  const toggleFlash = async () => {
    triggerHaptic();
    if (!localStreamRef.current) return;
    const track = localStreamRef.current.getVideoTracks()[0];
    const capabilities = (track as any).getCapabilities?.();
    if (capabilities && capabilities.torch) {
      try {
        const nextTorch = !torchOn;
        await (track as any).applyConstraints({ advanced: [{ torch: nextTorch }] });
        setTorchOn(nextTorch);
      } catch (e) {
        console.error(e);
      }
    } else {
      alert("Спалах не підтримується на вашому пристрої.");
    }
  };

  // Розрахунок позиції та збереження кадру відносно गाइड-рамки
  const captureFrame = () => {
    triggerHaptic();
    setCaptureLoading(true);
    
    setTimeout(() => {
      const video = videoRef.current;
      if (!video) {
        setCaptureLoading(false);
        return;
      }

      const videoW = video.videoWidth;
      const videoH = video.videoHeight;
      const videoRatio = videoW / videoH;
      const screenRatio = window.innerWidth / window.innerHeight;
      
      const guideBoxEl = document.getElementById("camera-guide-box");
      let guideRect;
      if (guideBoxEl) {
        const rect = guideBoxEl.getBoundingClientRect();
        guideRect = {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height
        };
      } else {
        let guideWidth, guideHeight;
        if (window.innerWidth >= window.innerHeight) {
          guideHeight = window.innerHeight * 0.85;
          guideWidth = guideHeight * 1.414;
        } else {
          guideWidth = window.innerWidth * 0.9;
          guideHeight = guideWidth / 1.414;
        }
        guideRect = {
          left: (window.innerWidth - guideWidth) / 2,
          top: (window.innerHeight - guideHeight) / 2,
          width: guideWidth,
          height: guideHeight
        };
      }

      let scale, sourceX, sourceY;

      if (screenRatio > videoRatio) {
        scale = videoW / window.innerWidth;
        sourceX = guideRect.left * scale; 
        sourceY = (guideRect.top + (((window.innerWidth / videoRatio) - window.innerHeight) / 2)) * scale;
      } else {
        scale = videoH / window.innerHeight;
        sourceX = (guideRect.left + (((window.innerHeight * videoRatio) - window.innerWidth) / 2)) * scale; 
        sourceY = guideRect.top * scale;
      }

      const sourceW = guideRect.width * scale; 
      const sourceH = guideRect.height * scale;
      
      const finalX = sourceX + (sourceW * 0.15); 
      const finalW = sourceW * 0.85;            
      const finalY = sourceY + (sourceH * 0.15); 
      const finalH = sourceH * 0.70;                  

      const MAX_SIZE = 3000;
      let targetW = finalW; 
      let targetH = finalH;
      if (finalW > MAX_SIZE || finalH > MAX_SIZE) {
        const ratio = Math.min(MAX_SIZE / finalW, MAX_SIZE / finalH);
        targetW = finalW * ratio; 
        targetH = finalH * ratio;
      }

      const captureCanvas = document.createElement("canvas");
      captureCanvas.width = targetW; 
      captureCanvas.height = targetH;
      const ctx = captureCanvas.getContext("2d");
      
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "medium"; 
        ctx.filter = "contrast(112%)";
        ctx.drawImage(video, finalX, finalY, finalW, finalH, 0, 0, targetW, targetH);
        ctx.filter = "none";

        const base64Img = captureCanvas.toDataURL("image/jpeg", 0.95);
        setCurrentBase64Image(base64Img);
        
        stopCamera();
        setScreen("review");
        setSubScreen("preview");
      }
      setCaptureLoading(false);
    }, 500);
  };

  // -------------------------------------------------------------
  // ЗАВАНТАЖЕННЯ ФАЙЛУ ТА НАЛАШТУВАННЯ CROPPER.JS
  // -------------------------------------------------------------
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      if (!event.target?.result) return;
      stopCamera();
      
      const base64Data = event.target.result as string;
      setCurrentBase64Image(base64Data);
      setOriginalUploadedImage(base64Data);
      setScreen("crop");
    };
    reader.readAsDataURL(file);
  };

  const videoRefCallback = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (node && localStreamRef.current) {
      node.srcObject = localStreamRef.current;
      node.play().catch(e => console.error("Playback on mount failed: ", e));
    }
  }, []);

  // Ініціалізація Cropper.js з фіксацією пропорцій
  const cropperRefCallback = useCallback((node: HTMLImageElement | null) => {
    if (node) {
      cropperImageRef.current = node;

      const init = () => {
        if (!cropperImageRef.current) return;
        if (cropperInstanceRef.current) {
          try {
            cropperInstanceRef.current.destroy();
          } catch (e) {}
          cropperInstanceRef.current = null;
        }
        cropperInstanceRef.current = new Cropper(cropperImageRef.current, {
          aspectRatio: 1.414,
          viewMode: 1, 
          autoCropArea: 0.9, 
          background: false,
          responsive: true,
          restore: false,
          modal: true,
          zoomable: false,       
          zoomOnTouch: false,    
          zoomOnWheel: false,    
          dragMode: "move",
          ready() {
            const cropper = cropperInstanceRef.current;
            if (!cropper) return;
            const containerData = cropper.getContainerData();
            const imageData = cropper.getImageData();
            if (containerData && imageData) {
              const containerWidth = containerData.width;
              const containerHeight = containerData.height;

              // Тимчасово зменшуємо зону обрізки
              cropper.setCropBoxData({
                left: containerWidth / 2 - 10,
                top: containerHeight / 2 - 10,
                width: 20,
                height: 20
              });

              // Масштабуємо зображення, щоб воно поміщалось в контейнер (object-fit: contain)
              const imgWidth = imageData.naturalWidth;
              const imgHeight = imageData.naturalHeight;
              const ratio = imgWidth / imgHeight;
              const containerRatio = containerWidth / containerHeight;

              let canvasWidth = containerWidth;
              let canvasHeight = containerHeight;
              if (ratio > containerRatio) {
                canvasWidth = containerWidth;
                canvasHeight = containerWidth / ratio;
              } else {
                canvasHeight = containerHeight;
                canvasWidth = containerHeight * ratio;
              }

              cropper.setCanvasData({
                left: (containerWidth - canvasWidth) / 2,
                top: (containerHeight - canvasHeight) / 2,
                width: canvasWidth,
                height: canvasHeight
              });

              // Розраховуємо ідеальну пропорцію 1.414 для рамки
              let boxWidth = canvasWidth * 0.9;
              let boxHeight = boxWidth / 1.414;
              if (boxHeight > canvasHeight * 0.9) {
                boxHeight = canvasHeight * 0.9;
                boxWidth = boxHeight * 1.414;
              }

              cropper.setCropBoxData({
                left: (containerWidth - boxWidth) / 2,
                top: (containerHeight - boxHeight) / 2,
                width: boxWidth,
                height: boxHeight
              });
            }
          }
        } as any);
      };

      if (node.complete && node.naturalWidth > 0) {
        init();
      } else {
        node.onload = () => {
          init();
        };
      }
    } else {
      cropperImageRef.current = null;
      if (cropperInstanceRef.current) {
        try {
          cropperInstanceRef.current.destroy();
        } catch (e) {}
        cropperInstanceRef.current = null;
      }
    }
  }, [currentBase64Image]);

  // Обертання зображення на 90 градусів із перерахунком рамок
  const rotateCropImage = () => {
    triggerHaptic();
    const cropper = cropperInstanceRef.current;
    if (cropper) {
      setIsTransitioning(true);
      
      cropper.rotate(90);
      
      const containerData = cropper.getContainerData();
      const imageData = cropper.getImageData();
      
      if (containerData && imageData) {
        const containerWidth = containerData.width;
        const containerHeight = containerData.height;

        cropper.setCropBoxData({
          left: containerWidth / 2 - 10,
          top: containerHeight / 2 - 10,
          width: 20,
          height: 20
        });

        const isRotated90or270 = Math.abs(imageData.rotate % 180) === 90;
        const rotatedWidth = isRotated90or270 ? imageData.naturalHeight : imageData.naturalWidth;
        const rotatedHeight = isRotated90or270 ? imageData.naturalWidth : imageData.naturalHeight;
        
        const ratio = rotatedWidth / rotatedHeight;
        const containerRatio = containerWidth / containerHeight;

        let canvasWidth = containerWidth;
        let canvasHeight = containerHeight;
        if (ratio > containerRatio) {
          canvasWidth = containerWidth;
          canvasHeight = containerWidth / ratio;
        } else {
          canvasHeight = containerHeight;
          canvasWidth = containerHeight * ratio;
        }
        
        cropper.setCanvasData({
          left: (containerWidth - canvasWidth) / 2,
          top: (containerHeight - canvasHeight) / 2,
          width: canvasWidth,
          height: canvasHeight
        });
        
        let boxWidth = canvasWidth * 0.9;
        let boxHeight = boxWidth / 1.414;
        if (boxHeight > canvasHeight * 0.9) {
          boxHeight = canvasHeight * 0.9;
          boxWidth = boxHeight * 1.414;
        }
        
        cropper.setCropBoxData({
          left: (containerWidth - boxWidth) / 2,
          top: (containerHeight - boxHeight) / 2,
          width: boxWidth,
          height: boxHeight
        });
      }

      setTimeout(() => {
        setIsTransitioning(false);
      }, 450);
    }
  };

  const applyCropAndContinue = () => {
    triggerHaptic();
    if (!cropperInstanceRef.current) return;

    const croppedCanvas = cropperInstanceRef.current.getCroppedCanvas();
    const origW = croppedCanvas.width;
    const origH = croppedCanvas.height;

    const cutX = 0; 
    const cutW = origW; 
    const cutY = 0; 
    const cutH = origH; 

    // Обмеження максимального розміру для оптимізації
    const MAX_SIZE = 3000;
    let targetW = cutW;
    let targetH = cutH;
    
    if (cutW > MAX_SIZE || cutH > MAX_SIZE) {
      const resizeRatio = Math.min(MAX_SIZE / cutW, MAX_SIZE / cutH);
      targetW = cutW * resizeRatio;
      targetH = cutH * resizeRatio;
    }

    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = targetW;
    outputCanvas.height = targetH;
    const ctx = outputCanvas.getContext("2d");
    
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "medium";
      ctx.filter = "contrast(112%)";
      ctx.drawImage(croppedCanvas, cutX, cutY, cutW, cutH, 0, 0, targetW, targetH);
      ctx.filter = "none";

      const finalBase64 = outputCanvas.toDataURL("image/jpeg", 0.95);
      setCurrentBase64Image(finalBase64);

      setConfirmButtonVisible(true);
      setTitleText("Перевірте дані (Редагування)");
      
      setScreen("review");
      setSubScreen("preview");
    }
  };

  // -------------------------------------------------------------
  // ВИКЛИК ШІ (GEMINI) ДЛЯ РОЗПІЗНАВАННЯ ТЕКСТУ
  // -------------------------------------------------------------
const analyzeTimesheetImage = async (useFallback: boolean = false) => {
    triggerHaptic();
    if (!currentBase64Image) return;
  
    // Зміна тексту завантаження залежно від активної моделі
    setGlobalLoadingText(useFallback ? "ШІ (модель v3.1 Lite) аналізує табель..." : "ШІ аналізує табель...");
    setGlobalLoading(true);
  
    try {
      const res = await fetch(`${BACKEND_URL}/upload`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ 
          image: currentBase64Image,
          use_fallback: useFallback // Передаем флаг на бэкенд
        })
      });
      
      const result = await res.json();
      
      // Обробка ситуації з високим навантаженням на сервери Google
      if (result.status === "high_demand") {
        setGlobalLoading(false);
        const userAgrees = confirm(
          "Модель Gemini 3.5 зараз перевантажена (високий попит на серверах Google).\n\n" +
          "Бажаєте спробувати розпізнати цей табель за допомогою резервної моделі (Gemini 3.1)?"
        );
        
        if (userAgrees) {
          // Повторний виклик функції з увімкненим прапорцем резервної моделі
          analyzeTimesheetImage(true);
        }
        return;
      }

      setGlobalLoading(false);
  
      if (result.status === "success") {
        setFinalParsedData(result.data);
        setSubScreen("table");
      } else {
        alert("Помилка розпізнавання: " + result.message);
      }
    } catch (err: any) {
      setGlobalLoading(false);
      alert("Помилка мережі: " + err.message);
    }
  };

  // -------------------------------------------------------------
  // ЛОГІКА РЕДАГУВАННЯ ДАНИХ ТАБЛИЦІ
  // -------------------------------------------------------------
  useEffect(() => {
    if (screen === "review" && subScreen === "table") {
      // Редагування робочих годин або кодів
      window.editCell = (empIndex: number, day: string, type: "hours" | "code", td: HTMLElement) => {
        if (isReadOnly) return;
        let currentVal = td.innerText.trim();
        setEditingCell({
          empIndex,
          day,
          type,
          title: `Змінити значення за ${day} число (${type === "hours" ? "години" : "код"})`,
          value: currentVal === "-" ? "" : currentVal
        });
        triggerHaptic();
      };

      // Перемикання вихідних днів (заливка жовтим)
      window.toggleYellow = (day: string, td: HTMLElement) => {
        if (isReadOnly) return;
        setFinalParsedData((prev) => {
          if (!prev) return prev;
          const updated = { ...prev };
          if (!updated.document_meta) updated.document_meta = {};
          let crossed = updated.document_meta.crossed_out_headers || [];
          let index = crossed.indexOf(day);
          if (index > -1) {
            crossed.splice(index, 1);
          } else {
            crossed.push(day);
          }
          updated.document_meta.crossed_out_headers = crossed;
          return updated;
        });
        triggerHaptic();
      };

      // Редагування загальних підсумків відпрацьованого часу
      window.editTotals = (empIndex: number, type: "days" | "hours", td: HTMLElement) => {
        if (isReadOnly) return;
        let currentVal = td.innerText.trim();
        setEditingCell({
          empIndex,
          type: type === "days" ? "totals_days" : "totals_hours",
          title: `Змінити підсумок (${type === "days" ? "відпрацьовано днів" : "відпрацьовано годин"})`,
          value: currentVal === "-" ? "" : currentVal
        });
        triggerHaptic();
      };

      // Редагування тексту шапки (період, рік, дати)
      window.editMeta = (field: keyof DocumentMeta, element: HTMLElement) => {
        if (isReadOnly) return;
        let currentVal = element.innerText.trim();
        setEditingCell({
          empIndex: -1,
          type: "meta",
          metaField: field,
          title: `Змінити поле метаданих`,
          value: currentVal.includes("_") || currentVal.includes(".") && currentVal.replace(/[\._]/g, "").trim() === "" ? "" : currentVal
        });
        triggerHaptic();
      };

      // Редагування колонки "Всього неявок"
      window.editAbsenceTotal = (empIndex: number, td: HTMLElement) => {
        if (isReadOnly) return;
        const emp = finalParsedData?.employees?.[empIndex];
        if (!emp) return;
        let defaultVal = `${emp.absences?.total_days || ""} ${emp.absences?.total_hours || ""}`.trim();
        setEditingCell({
          empIndex,
          type: "absence_total",
          title: "Введіть кількість неявок (ДНІ ГОДИНИ)",
          value: defaultVal === "- -" || defaultVal === "-" ? "" : defaultVal
        });
        triggerHaptic();
      };

      // Редагування причин неявок (коди, дні, години)
      window.editAbsenceReason = (empIndex: number, colIndex: number, td: HTMLElement) => {
        if (isReadOnly) return;
        let defaultVal = td.querySelector("div") 
          ? `${(td.children[0] as HTMLElement)?.innerText || ""} ${(td.children[1] as HTMLElement)?.innerText || ""}`.replace("/", " ").trim() 
          : "";
        setEditingCell({
          empIndex,
          type: "absence_reason",
          colIndex,
          title: "Деталі неявки: КОД ДНІ ГОДИНИ (через пробіл)",
          value: defaultVal
        });
        triggerHaptic();
      };
    }

    return () => {
      delete window.editCell;
      delete window.toggleYellow;
      delete window.editTotals;
      delete window.editMeta;
      delete window.editAbsenceTotal;
      delete window.editAbsenceReason;
    };
  }, [screen, subScreen, finalParsedData, isReadOnly]);

  const incrementZoom = () => {
    triggerHaptic();
    setZoomScale((z) => Math.min(z + 0.1, 2.0));
  };

  const decrementZoom = () => {
    triggerHaptic();
    setZoomScale((z) => Math.max(z - 0.1, 0.4));
  };

  // Збереження введених даних з діалогового вікна до головного стану
  const handleSaveEditingCell = () => {
    if (!editingCell) return;
    const { empIndex, day, type, metaField, colIndex, value } = editingCell;
    const trimmedVal = value.trim();

    setFinalParsedData((prev) => {
      if (!prev) return prev;
      const updated = { ...prev };

      if (type === "hours" || type === "code") {
        if (updated.employees && updated.employees[empIndex]) {
          let newValue = trimmedVal;
          if (type === "hours") {
            newValue = newValue.replace(".", ",");
            if (newValue === "0" || newValue === "") newValue = "-";
          } else {
            newValue = newValue.toUpperCase();
            if (newValue === "") newValue = "-";
          }
          if (!updated.employees[empIndex].days[day!]) {
            updated.employees[empIndex].days[day!] = { hours: "-", code: "-" };
          }
          updated.employees[empIndex].days[day!][type] = newValue;
        }
      } else if (type === "totals_days" || type === "totals_hours") {
        if (updated.employees && updated.employees[empIndex]) {
          const field = type === "totals_days" ? "days" : "hours";
          updated.employees[empIndex].totals[field] = trimmedVal.replace(".", ",");
        }
      } else if (type === "meta") {
        if (!updated.document_meta) updated.document_meta = {};
        updated.document_meta[metaField!] = trimmedVal as any;
      } else if (type === "absence_total") {
        if (updated.employees && updated.employees[empIndex]) {
          if (!updated.employees[empIndex].absences) {
            updated.employees[empIndex].absences = { total_days: "-", total_hours: "-", reasons: [] };
          }
          const parts = trimmedVal.split(/\s+/);
          updated.employees[empIndex].absences.total_days = parts[0] || "-";
          updated.employees[empIndex].absences.total_hours = parts[1] || "-";
        }
      } else if (type === "absence_reason") {
        if (updated.employees && updated.employees[empIndex]) {
          if (!updated.employees[empIndex].absences) {
            updated.employees[empIndex].absences = { total_days: "-", total_hours: "-", reasons: [] };
          }
          if (!updated.employees[empIndex].absences.reasons) {
            updated.employees[empIndex].absences.reasons = [];
          }
          
          const codes_to_clear = getCodesForCol(colIndex!);
          updated.employees[empIndex].absences.reasons = (updated.employees[empIndex].absences.reasons || []).filter(
            (r) => !codes_to_clear.includes(r.code)
          );

          if (trimmedVal !== "") {
            const parts = trimmedVal.split(/\s+/);
            const code = parts[0].toUpperCase();
            const r_days = parts[1] || "-";
            const r_hours = parts[2] || "-";
            updated.employees[empIndex].absences.reasons.push({ code, days: r_days, hours: r_hours });
          }
        }
      }

      return updated;
    });

    triggerHaptic();
    setEditingCell(null);
  };

  // -------------------------------------------------------------
  // РОБОТА З АРХІВОМ БАЗИ ДАНИХ
  // -------------------------------------------------------------
  const formatLocalDate = (utcString: string) => {
    try {
      const d = new Date(utcString);
      return d.toLocaleString("uk-UA", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (e) {
      return utcString;
    }
  };

  // Отримання списку архівних табелів
  const loadArchiveList = async (mode: "view" | "email") => {
    triggerHaptic();
    setArchiveMode(mode);
    setArchiveLoading(true);
    setArchiveMessage("Завантаження вашого архіву...");
    setScreen("archive");
  
    try {
      const res = await fetch(`${BACKEND_URL}/archive`, {
        method: "GET",
        headers: getAuthHeaders()
      });
      const result = await res.json();
      setArchiveLoading(false);
  
      if (result.status === "success" && result.archive.length > 0) {
        setArchiveList(result.archive);
        setArchiveMessage("");
      } else {
        setArchiveList([]);
        setArchiveMessage("Ваш архів табелів зараз порожній.");
      }
    } catch (err: any) {
      setArchiveLoading(false);
      setArchiveMessage("Помилка при завантаженні архіву: " + err.message);
    }
  };

  // Завантаження даних конкретного табеля з архіву
  const openArchivedItem = async (tabelId: number) => {
    triggerHaptic();
    setGlobalLoadingText("Завантажуємо деталі архіву...");
    setGlobalLoading(true);
  
    try {
      const res = await fetch(`${BACKEND_URL}/archive/detail/${tabelId}`, {
        method: "GET",
        headers: getAuthHeaders()
      });
      const result = await res.json();
      setGlobalLoading(false);
  
      if (result.status === "success") {
        setIsReadOnly(true);
        setFinalParsedData(result.data);
        setTitleText("Перегляд архіву (Тільки читання)");
        setConfirmButtonVisible(false);
        setCurrentArchiveId(tabelId);
        setScreen("review");
        setSubScreen("table");
      } else {
        alert("Помилка завантаження: " + result.message);
      }
    } catch (err: any) {
      setGlobalLoading(false);
      alert("Помилка мережі: " + err.message);
    }
  };

  // Дозвіл на зміну архівного документу
  const toggleEditArchiveMode = () => {
    triggerHaptic();
    setIsReadOnly(false);
    setTitleText("Редагування архівного табеля");
    setConfirmButtonVisible(true);
  };

  // Оновлення запису в базі даних після редагування архівного табеля
  const saveArchivedChanges = async () => {
    triggerHaptic();
    if (!finalParsedData || currentArchiveId === null) return;
  
    setGlobalLoadingText("Збереження змін в архіві...");
    setGlobalLoading(true);
  
    try {
      const res = await fetch(`${BACKEND_URL}/archive/update/${currentArchiveId}`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ data: finalParsedData })
      });
      const result = await res.json();
      setGlobalLoading(false);
  
      if (result.status === "success") {
        alert("✅ Зміни в архівному табелі успішно збережено!");
        setIsReadOnly(true);
        setConfirmButtonVisible(false);
        setTitleText("Перегляд архіву (Тільки читання)");
        loadArchiveList("view");
      } else {
        alert("❌ Помилка оновлення: " + result.message);
      }
    } catch (err: any) {
      setGlobalLoading(false);
      alert("❌ Помилка мережі: " + err.message);
    }
  };

  // -------------------------------------------------------------
  // ГЕНЕРАЦІЯ ЕКСПОРТНИХ ФАЙЛІВ ТА ВІДПРАВКА
  // -------------------------------------------------------------
  const sendTabelToEmailAddress = async (tabelId: number, periodStr: string, yearStr: string) => {
    triggerHaptic();
    const confirmed = confirm(`Надіслати табель за ${periodStr} ${yearStr} на пошту бухгалтерії?`);
    if (!confirmed) return;
  
    setGlobalLoadingText("Надсилання листа бухгалтеру...");
    setGlobalLoading(true);
  
    try {
      const res = await fetch(`${BACKEND_URL}/send-email`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ tabel_id: tabelId })
      });
      const result = await res.json();
      setGlobalLoading(false);
  
      if (result.status === "success") {
        alert("✅ Табель успішно надіслано на електронну пошту бухгалтерії!");
        setScreen("menu");
      } else {
        alert("❌ Помилка: " + result.message);
      }
    } catch (err: any) {
      setGlobalLoading(false);
      alert("❌ Помилка мережі: " + err.message);
    }
  };

  const generateExcelAndSubmit = async () => {
    triggerHaptic();
    if (!finalParsedData) return;
  
    // Якщо відкритий архівний файл, то просто зберігаємо зміни
    if (currentArchiveId !== null) {
      saveArchivedChanges();
      return;
    }

    setGlobalLoadingText("Формуємо професійний Excel...");
    setGlobalLoading(true);
  
    try {
      const res = await fetch(`${BACKEND_URL}/generate-excel`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ data: finalParsedData })
      });
      const result = await res.json();
      setGlobalLoading(false);
  
      if (result.status === "success") {
        alert("✅ Готово! Табель успішно збережено в архів та надіслано в чат.");
        setTimeout(() => {
          setFinalParsedData(null);
          setCurrentBase64Image(null);
          setScreen("menu");
        }, 1000);
      } else {
        alert("❌ Помилка сервера: " + result.message);
      }
    } catch (err: any) {
      setGlobalLoading(false);
      alert("❌ Помилка мережі під час формування Excel.");
    }
  };

  // -------------------------------------------------------------
  // ОБРОБНИКИ ДЛЯ КНОПОК ГОЛОВНОГО МЕНЮ
  // -------------------------------------------------------------
  const handleScanClick = () => {
    triggerHaptic();
    setIsReadOnly(false);
    setConfirmButtonVisible(true);
    setTitleText("Перевірте дані (Редагування)");
    setCurrentArchiveId(null);
    setImageSource("camera");
    setScreen("camera");
  };

  const handleUploadClick = () => {
    triggerHaptic();
    setIsReadOnly(false);
    setCurrentArchiveId(null);
    setImageSource("upload");
    if (hiddenFileInputRef.current) {
      hiddenFileInputRef.current.value = "";
      hiddenFileInputRef.current.click();
    }
  };

  const handleEmailClick = () => {
    loadArchiveList("email");
  };

  const handleArchiveClick = () => {
    loadArchiveList("view");
  };

  // -------------------------------------------------------------
  // ДИНАМІЧНИЙ HTML-РЕНДЕР ТАБЛИЦІ (СУВОРО ЗБЕРЕЖЕНО СТРУКТУРУ)
  // -------------------------------------------------------------
  const generatedTableHtml = useMemo(() => {
    if (!finalParsedData) return "";
    
    const meta = finalParsedData.document_meta || {};
    const crossed = meta.crossed_out_headers || [];

    let html = `
    <div style="font-family: 'Times New Roman', serif; color: black; text-align: left; margin-bottom: 10px; font-size: 13px;">
        <div style="text-align: right; font-style: italic;">Затверджено Порядком обліку використання робочого часу...</div>
        <div style="font-weight: bold; margin-top: 5px;">АТ "XXX", регіональна філія...</div>
        <div>Ідентифікаційний код ЄДРПОУ: <b>XXX</b></div>
    </div>
    <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 15px; font-family: 'Times New Roman', serif; color: black;">
        <div style="flex-grow: 1; text-align: center;">
            <h2 style="margin: 0; font-size: 18px; font-weight: bold; color: black;">Табель обліку робочого часу за <u style="cursor: pointer;" onclick="editMeta('period_text', this)">${meta.period_text || "___________"}</u> <u style="cursor: pointer;" onclick="editMeta('year', this)">${meta.year || "2026"}</u> року</h2>
        </div>
        <table style="border-collapse: collapse; text-align: center; font-size: 11px; border: 2px solid black; color: black; margin-left: 20px;">
            <tr><td rowspan="2" style="border: 1px solid black; padding: 3px 8px; font-weight: bold;">Дата заповнення</td><td colspan="2" style="border: 1px solid black; padding: 3px 8px; font-weight: bold;">Звітний період</td></tr>
            <tr><td style="border: 1px solid black; padding: 3px 8px; font-weight: bold;">з</td><td style="border: 1px solid black; padding: 3px 8px; font-weight: bold;">по</td></tr>
            <tr><td style="border: 1px solid black; padding: 5px; cursor: pointer;" onclick="editMeta('date_filled', this)">${meta.date_filled || "__.__.____"}</td><td style="border: 1px solid black; padding: 5px; cursor: pointer;" onclick="editMeta('period_start', this)">${meta.period_start || "__.__"}</td><td style="border: 1px solid black; padding: 5px; cursor: pointer;" onclick="editMeta('period_end', this)">${meta.period_end || "__.__"}</td></tr>
        </table>
    </div>`;

    html += `<table style="border-collapse: collapse; text-align: center; font-size: 11px; border: 2px solid black; font-family: 'Times New Roman', serif; background: white; color: black;">`;
    html += `<tr style="font-weight: bold; background: #fafafa;"><td rowspan="3" style="border: 1px solid black; padding: 5px; width: 35px; writing-mode: vertical-rl; transform: rotate(180deg);">№ п/п</td><td colspan="16" style="border: 1px solid black; padding: 5px;">Відмітки про явки та неявки за числами місяця</td><td colspan="8" style="border: 1px solid black; padding: 5px;">Відпрацьовано</td><td colspan="10" style="border: 1px solid black; padding: 5px;">Неявки з причин</td></tr><tr style="font-weight: bold; background: #fafafa;">`;
        
    for (let i = 1; i <= 15; i++) {
        let d = i.toString().padStart(2, "0"); 
        let bg = crossed.includes(d) ? "background: #ffff00;" : "";
        html += `<td style="border: 1px solid black; width: 30px; height: 105px; vertical-align: middle; cursor: pointer; ${bg}" onclick="toggleYellow('${d}', this)">${d}</td>`;
    }
    let bgX = crossed.includes("X") ? "background: #ffff00;" : "";
    html += `<td style="border: 1px solid black; width: 30px; height: 105px; vertical-align: middle; cursor: pointer; ${bgX}" onclick="toggleYellow('X', this)">X</td>`;

    html += `<td rowspan="2" style="border: 1px solid black; writing-mode: vertical-rl; transform: rotate(180deg); padding: 5px;">днів</td><td colspan="7" style="border: 1px solid black; padding: 5px;">годин</td><td rowspan="2" style="border: 1px solid black; writing-mode: vertical-rl; transform: rotate(180deg); padding: 5px;">Всього неявок</td><td rowspan="2" style="border: 1px solid black; font-size: 8px; writing-mode: vertical-rl; transform: rotate(180deg); padding: 5px;">відпустки</td><td rowspan="2" style="border: 1px solid black; font-size: 8px; writing-mode: vertical-rl; transform: rotate(180deg); padding: 5px;">навчання</td><td rowspan="2" style="border: 1px solid black; font-size: 8px; writing-mode: vertical-rl; transform: rotate(180deg); padding: 5px;">без збереження</td><td rowspan="2" style="border: 1px solid black; font-size: 8px; writing-mode: vertical-rl; transform: rotate(180deg); padding: 5px;">неповний день</td><td rowspan="2" style="border: 1px solid black; font-size: 8px; writing-mode: vertical-rl; transform: rotate(180deg); padding: 5px;">простої</td><td rowspan="2" style="border: 1px solid black; font-size: 8px; writing-mode: vertical-rl; transform: rotate(180deg); padding: 5px;">прогули</td><td rowspan="2" style="border: 1px solid black; font-size: 8px; writing-mode: vertical-rl; transform: rotate(180deg); padding: 5px;">страйки</td><td rowspan="2" style="border: 1px solid black; font-size: 8px; writing-mode: vertical-rl; transform: rotate(180deg); padding: 5px;">тимчасова непрацездатність</td><td rowspan="2" style="border: 1px solid black; font-size: 8px; writing-mode: vertical-rl; transform: rotate(180deg); padding: 5px;">інші</td></tr><tr style="font-weight: bold; background: #fafafa;">`;
        
    for (let i = 16; i <= 30; i++) {
        let d = i.toString(); 
        let bg = crossed.includes(d) ? "background: #ffff00;" : "";
        html += `<td style="border: 1px solid black; width: 30px; height: 35px; vertical-align: middle; cursor: pointer; ${bg}" onclick="toggleYellow('${d}', this)">${d}</td>`;
    }
    let bg31 = crossed.includes("31") ? "background: #ffff00;" : "";
    html += `<td style="border: 1px solid black; width: 30px; height: 35px; vertical-align: middle; cursor: pointer; ${bg31}" onclick="toggleYellow('31', this)">31</td><td style="border: 1px solid black; font-size: 9px; writing-mode: vertical-rl; transform: rotate(180deg); padding: 4px;">усього</td><td style="border: 1px solid black; font-size: 9px; writing-mode: vertical-rl; transform: rotate(180deg); padding: 4px;">надурочних</td><td style="border: 1px solid black; font-size: 9px; writing-mode: vertical-rl; transform: rotate(180deg); padding: 4px;">нічних</td><td style="border: 1px solid black; font-size: 9px; writing-mode: vertical-rl; transform: rotate(180deg); padding: 4px;">вечірніх</td><td style="border: 1px solid black; font-size: 9px; writing-mode: vertical-rl; transform: rotate(180deg); padding: 4px;">вихідних</td><td style="border: 1px solid black; font-size: 9px; writing-mode: vertical-rl; transform: rotate(180deg); padding: 4px;">дистанційно</td><td style="border: 1px solid black; font-size: 9px; writing-mode: vertical-rl; transform: rotate(180deg); padding: 4px;">відрядження</td></tr>`;

    if (finalParsedData.employees && finalParsedData.employees.length > 0) {
        finalParsedData.employees.forEach((emp, index) => {
            let days = emp.days || {}; 
            let totals = emp.totals || {};
            html += `<tr><td rowspan="4" style="border: 1px solid black; font-weight: bold; font-size: 14px; background: #fff;">${index + 1}</td>`;
            for (let i = 1; i <= 15; i++) {
                let d = i.toString().padStart(2, "0"); 
                let val = days[d] ? days[d].hours : "-";
                html += `<td style="border: 1px solid black; height: 22px; cursor: pointer; font-weight: bold;" onclick="editCell(${index}, '${d}', 'hours', this)">${val}</td>`;
            }
            html += `<td style="border: 1px solid black; background: #fff;">-</td><td rowspan="4" style="border: 1px solid black; font-weight: bold; cursor: pointer;" onclick="editTotals(${index}, 'days', this)">${totals.days || "-"}</td><td rowspan="4" style="border: 1px solid black; font-weight: bold; cursor: pointer;" onclick="editTotals(${index}, 'hours', this)">${totals.hours || "-"}</td>`;
            for (let k = 24; k <= 29; k++) {
              html += `<td rowspan="4" style="border: 1px solid black; background: #fff;"></td>`;
            }

            let totalAbsDays = emp.absences?.total_days || "-"; 
            let totalAbsHours = emp.absences?.total_hours || "-";
            let tdStr = totalAbsDays === "-" ? "" : totalAbsDays; 
            let thStr = totalAbsHours === "-" ? "" : totalAbsHours;
            let totalInner = (tdStr || thStr) ? `<div style="font-weight: bold; border-bottom: 1px dashed #ccc;">${tdStr}</div><div>${thStr}</div>` : "";
            html += `<td rowspan="4" style="border: 1px solid black; cursor: pointer; vertical-align: top;" onclick="editAbsenceTotal(${index}, this)">${totalInner}</td>`;

            let reasonCols: { [col: number]: any } = {}; 
            for (let i = 31; i <= 39; i++) reasonCols[i] = null;
            if (emp.absences?.reasons) {
                emp.absences.reasons.forEach(r => {
                    let c = r.code ? r.code.toString().toUpperCase() : ""; 
                    let targetCol = 39; 
                    if (["В", "Щ", "Д", "8", "9", "10"].includes(c)) targetCol = 31;
                    else if (["Н", "ВЧ", "11", "12", "13", "14", "15", "17", "22"].includes(c)) targetCol = 32;
                    else if (["НА", "БЗ", "18", "19"].includes(c)) targetCol = 33;
                    else if (["НД", "20"].includes(c)) targetCol = 34;
                    else if (["П", "23"].includes(c)) targetCol = 35;
                    else if (["ПР", "24"].includes(c)) targetCol = 36;
                    else if (["С", "25"].includes(c)) targetCol = 37;
                    else if (["ТН", "Л", "26", "27"].includes(c)) targetCol = 38;
                    reasonCols[targetCol] = r;
                });
            }
            for (let k = 31; k <= 39; k++) {
                if (reasonCols[k]) {
                    let r = reasonCols[k]; 
                    let rd = r.days === "-" ? "" : r.days; 
                    let rh = r.hours === "-" ? "" : r.hours;
                    html += `<td rowspan="4" style="border: 1px solid black; cursor: pointer; font-size: 10px; vertical-align: top;" onclick="editAbsenceReason(${index}, ${k}, this)"><div style="font-weight: bold;">${r.code}</div><div>${rd}/${rh}</div></td>`;
                } else { 
                  html += `<td rowspan="4" style="border: 1px solid black; cursor: pointer;" onclick="editAbsenceReason(${index}, ${k}, this)"></td>`; 
                }
            }
            html += `</tr><tr>`;
            for (let i = 1; i <= 15; i++) {
                let d = i.toString().padStart(2, "0"); 
                let val = days[d] ? days[d].code : "-";
                html += `<td style="border: 1px solid black; height: 22px; cursor: pointer; font-size: 11px;" onclick="editCell(${index}, '${d}', 'code', this)">${val}</td>`;
            }
            html += `<td style="border: 1px solid black; background: #fff;">-</td></tr><tr>`;
            for (let i = 16; i <= 30; i++) {
                let d = i.toString(); 
                let val = days[d] ? days[d].hours : "-";
                html += `<td style="border: 1px solid black; height: 22px; cursor: pointer; font-weight: bold;" onclick="editCell(${index}, '${d}', 'hours', this)">${val}</td>`;
            }
            let val31_h = days["31"] ? days["31"].hours : "-";
            html += `<td style="border: 1px solid black; height: 22px; cursor: pointer; font-weight: bold;" onclick="editCell(${index}, '31', 'hours', this)">${val31_h}</td></tr><tr>`;
            for (let i = 16; i <= 30; i++) {
                let d = i.toString(); 
                let val = days[d] ? days[d].code : "-";
                html += `<td style="border: 1px solid black; height: 22px; cursor: pointer; font-size: 11px;" onclick="editCell(${index}, '${d}', 'code', this)">${val}</td>`;
            }
            let val31_c = days["31"] ? days["31"].code : "-";
            html += `<td style="border: 1px solid black; height: 22px; cursor: pointer; font-size: 11px;" onclick="editCell(${index}, '31', 'code', this)">${val31_c}</td></tr>`;
        });
    }
    html += `</table>`; 
    return html;
  }, [finalParsedData, isReadOnly]);

  // -------------------------------------------------------------
  // ГОЛОВНИЙ РЕНДЕР ІНТЕРФЕЙСУ (ВІЗУАЛЬНА ЧАСТИНА)
  // -------------------------------------------------------------
  return (
    <div className="w-full h-full min-h-screen railway-ambient-bg flex flex-col items-center overflow-hidden relative">
      
      {/* Анімований фон з коліями поїздів */}
      <div className="absolute inset-0 w-full h-full pointer-events-none select-none z-0 overflow-hidden">
        <svg className="w-full h-full" viewBox="0 0 1000 1000" preserveAspectRatio="none">
          <defs>
            <linearGradient id="trainG1" gradientUnits="userSpaceOnUse" x1="-500" y1="0" x2="1500" y2="0">
              <stop offset="0%" stopColor="rgba(0, 122, 255, 0.1)" />
              <stop offset="35%" stopColor="rgba(0, 122, 255, 0.45)" />
              <stop offset="75%" stopColor="rgba(0, 122, 255, 0.85)" />
              <stop offset="100%" stopColor="rgba(255, 255, 255, 0.95)" />
            </linearGradient>
            <linearGradient id="trainG2" gradientUnits="userSpaceOnUse" x1="-500" y1="0" x2="1500" y2="0">
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

          {/* Лінії колій */}
          <path d="M-500 150 Q 300 -100, 1500 150" stroke="rgba(0, 122, 255, 0.12)" strokeWidth="14" strokeDasharray="3,18" fill="none" />
          <path d="M-500 143 Q 300 -100, 1500 143" stroke="rgba(0, 122, 255, 0.25)" strokeWidth="1.5" fill="none" />
          <path d="M-500 157 Q 300 -100, 1500 157" stroke="rgba(0, 122, 255, 0.25)" strokeWidth="1.5" fill="none" />

          {/* Центральна пряма колія */}
          <path d="M-500 700 L 1500 700" stroke="rgba(0, 122, 255, 0.14)" strokeWidth="14" strokeDasharray="3,12" fill="none" />
          <path d="M-500 693 L 1500 693" stroke="rgba(0, 122, 255, 0.28)" strokeWidth="1.5" fill="none" />
          <path d="M-500 707 L 1500 707" stroke="rgba(0, 122, 255, 0.28)" strokeWidth="1.5" fill="none" />

          {/* Нижня зігнута колія */}
          <path d="M-500 850 Q 500 1020, 1500 730" stroke="rgba(142, 142, 147, 0.09)" strokeWidth="18" strokeDasharray="4,24" fill="none" />
          <path d="M-500 841 Q 500 1020, 1500 721" stroke="rgba(142, 142, 147, 0.22)" strokeWidth="1.5" fill="none" />
          <path d="M-500 859 Q 500 1020, 1500 739" stroke="rgba(142, 142, 147, 0.22)" strokeWidth="1.5" fill="none" />

          {/* Декоративні відблиски світла */}
          <path d="M40 250 L 300 280 L 260 310 Z" fill="rgba(0, 122, 255, 0.03)" filter="blur(12px)" />
          <path d="M600 700 L 920 620 L 880 670 Z" fill="rgba(142, 142, 147, 0.02)" filter="blur(16px)" />

          {/* Анімація першого поїзда */}
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

          {/* Анімація другого поїзда */}
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

      {/* Прихований input для вибору файлів */}
      <input 
        type="file" 
        ref={hiddenFileInputRef} 
        onChange={handleFileChange} 
        accept="image/*" 
        className="hidden" 
      />

      {/* ========================================== */}
      {/* ЕКРАН ГОЛОВНОГО МЕНЮ                       */}
      {/* ========================================== */}
      <div 
        style={{ display: screen === "menu" ? "flex" : "none" }}
        className="w-full max-w-md px-5 py-6 flex flex-col h-full justify-between select-none"
      >
        <div className="text-center mt-3 mb-4 select-none">
          <span className="text-[11px] font-bold text-[#007AFF] bg-blue-50 px-3 py-1.5 rounded-full border border-blue-100 tracking-wider uppercase">Оцифрування табелів</span>
          <h1 className="text-2xl font-bold tracking-tight text-[#1C1C1E] mt-3">Особистий Помічник YSV</h1>
          <p className="text-xs text-gray-500 mt-1 max-w-[280px] mx-auto">Швидке сканування табелів обліку робочого часу на основі надійного ШІ</p>
        </div>

        <div className="flex-1 flex flex-col justify-center py-4">
          {/* Кнопка активації камери */}
          <button 
            onClick={handleScanClick}
            className="w-full ios-frosted-glass rounded-2xl p-6 flex flex-col items-center justify-center text-center shadow-lg cursor-pointer min-h-[160px] relative overflow-hidden group border border-white/60 ios-touchable"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-sky-200/20 rounded-full blur-3xl pointer-events-none transition-all"></div>
            <div className="w-16 h-16 rounded-full bg-sky-100/80 flex items-center justify-center mb-4 text-[#007AFF] shadow-inner">
              <Camera className="w-8 h-8" />
            </div>
            <span className="text-xl font-bold tracking-tight text-[#1C1C1E]">📸 Сканувати табель</span>
            <p className="text-xs text-gray-500 mt-1.5 max-w-[240px]">Оцифруйте паперовий табель за допомогою камери</p>
          </button>

          {/* Сітка додаткових кнопок меню */}
          <div className="grid grid-cols-2 gap-4 mt-4 select-none">
            <button 
              onClick={handleUploadClick}
              className="ios-frosted-glass rounded-2xl p-5 flex flex-col items-start text-left relative overflow-hidden cursor-pointer border border-white/60 ios-touchable"
            >
              <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center text-[#FF9500] mb-3">
                <Upload className="w-5 h-5" />
              </div>
              <span className="font-bold text-sm text-[#1C1C1E]">📁 Завантажити</span>
              <p className="text-[10px] leading-tight text-gray-500 mt-1">Оберіть файл з вашої фотогалереї</p>
            </button>

            <button 
              onClick={handleEmailClick}
              className="ios-frosted-glass rounded-2xl p-5 flex flex-col items-start text-left relative overflow-hidden cursor-pointer border border-white/60 ios-touchable"
            >
              <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-[#007AFF] mb-3">
                <Mail className="w-5 h-5" />
              </div>
              <span className="font-bold text-sm text-[#1C1C1E]">📧 Надіслати</span>
              <p className="text-[10px] leading-tight text-gray-500 mt-1">Надіслати прямо бухгалтерській службі</p>
            </button>

            <button 
              onClick={handleArchiveClick}
              className="col-span-2 ios-frosted-glass rounded-2xl p-5 flex flex-row items-center justify-between relative overflow-hidden cursor-pointer border border-white/60 ios-touchable"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-purple-50 flex items-center justify-center text-[#5856D6]">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <span className="font-bold text-sm text-[#1C1C1E] block">🗂 Архів табелів</span>
                  <p className="text-[10px] leading-tight text-gray-500 mt-0.5">Перегляньте заповнену історію своїх табелів</p>
                </div>
              </div>
              <ChevronLeft className="w-5 h-5 text-gray-400 rotate-180" />
            </button>
          </div>
        </div>

        <div className="text-center py-2 select-none pointer-events-none mt-auto">
          <span className="text-[10px] text-gray-400">YSV Помічник • 2026</span>
        </div>
      </div>

      <AnimatePresence mode="wait">

        {/* ========================================== */}
        {/* ЕКРАН КАМЕРИ                               */}
        {/* ========================================== */}
        {screen === "camera" && (
          <motion.div 
            key="camera-screen" 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black w-full h-full"
          >
            <video 
              ref={videoRefCallback} 
              autoPlay 
              playsInline 
              muted 
              className="absolute inset-0 w-full h-full object-cover z-0"
            />

            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 p-4">
              <div 
                id="camera-guide-box"
                className="w-[90vw] max-w-[450px] aspect-[1.414/1] landscape:w-auto landscape:h-[82vh] landscape:max-w-none border-2 border-white rounded-2xl relative shadow-[0_0_0_9999px_rgba(255,255,255,0.45)] bg-transparent"
              >
                <div className="absolute -top-[3px] -left-[3px] w-6 h-6 border-t-[4px] border-l-[4px] border-[#007AFF] rounded-tl-lg" />
                <div className="absolute -top-[3px] -right-[3px] w-6 h-6 border-t-[4px] border-r-[4px] border-[#007AFF] rounded-tr-lg" />
                <div className="absolute -bottom-[3px] -left-[3px] w-6 h-6 border-b-[4px] border-l-[4px] border-[#007AFF] rounded-bl-lg" />
                <div className="absolute -bottom-[3px] -right-[3px] w-6 h-6 border-b-[4px] border-r-[4px] border-[#007AFF] rounded-br-lg" />
              </div>
            </div>

            <div className="absolute top-10 left-0 w-full flex justify-center px-6 z-10 select-none">
              <div className="ios-frosted-glass border-white/60 px-5 py-2.5 rounded-full text-[#1C1C1E] text-xs font-bold tracking-tight shadow-md flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#007AFF] animate-pulse"></span>
                Помістіть табель у рамку
              </div>
            </div>

            <div className="absolute bottom-12 left-0 w-full flex items-center justify-center gap-4 z-10 px-6">
              <button 
                onClick={toggleFlash}
                className={`ios-touchable w-14 h-14 rounded-full backdrop-blur-md flex items-center justify-center border transition-all text-xl shadow-lg active:scale-95 ${
                  torchOn ? "bg-white text-black border-white" : "bg-black/40 text-white border-white/20"
                }`}
              >
                💡
              </button>

              <button 
                disabled={captureLoading}
                onClick={captureFrame}
                className="ios-touchable flex-1 max-w-[200px] bg-[#007AFF] text-white hover:bg-blue-600 active:scale-95 text-base font-bold tracking-tight py-4 rounded-full shadow-lg border border-blue-400/20 disabled:opacity-40"
              >
                {captureLoading ? "📸 Фокусування..." : "📸 Сканувати"}
              </button>
            </div>
          </motion.div>
        )}

        {/* ========================================== */}
        {/* ЕКРАН ОБРІЗКИ (CROPPER)                    */}
        {/* ========================================== */}
        {screen === "crop" && (
          <motion.div 
            key="crop-screen"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 railway-ambient-bg flex flex-col justify-between p-5"
          >
            <div className="text-center pt-8 select-none z-10">
              <h3 className="text-[#1C1C1E] font-bold text-lg">Виділіть межі табеля (А4)</h3>
              <p className="text-xs text-gray-500 mt-1">Орієнтуйте рамку по оригінальних лініях</p>
            </div>

            <div className="flex-1 flex items-center justify-center overflow-hidden py-4">
              <div className={`w-full h-[58vh] bg-white/40 border border-white/80 rounded-2xl overflow-hidden flex items-center justify-center relative shadow-xl backdrop-blur-md ${isTransitioning ? "cropper-transitioning" : ""}`}>
                <img 
                  ref={cropperRefCallback} 
                  src={currentBase64Image || ""} 
                  alt="Cropper master"
                  className="block max-w-full max-h-full"
                />
              </div>
            </div>

            <div className="w-full max-w-md mx-auto ios-frosted-glass rounded-2xl p-4 flex flex-col items-center gap-3 border border-white/60">
              <button 
                onClick={rotateCropImage}
                className="ios-touchable flex items-center gap-2 bg-white/80 border border-gray-200 text-[#1C1C1E] px-6 py-2.5 rounded-full font-semibold text-sm transition-colors hover:bg-white shadow-sm"
              >
                <RotateCw className="w-4 h-4 text-[#007AFF]" />
                Повернути на 90°
              </button>

              <div className="w-full flex mt-1">
                <button 
                  onClick={applyCropAndContinue}
                  className="ios-touchable w-full bg-[#007AFF] text-white font-bold py-4 rounded-xl text-center shadow-lg shadow-blue-500/25"
                >
                  ✅ Підтвердити та обрізати
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* ========================================== */}
        {/* ЕКРАН ПЕРЕВІРКИ ТАБЛИЦІ                    */}
        {/* ========================================== */}
        {screen === "review" && (
          <motion.div 
            key="review-screen"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="w-full h-screen max-h-screen overflow-hidden flex flex-col items-center justify-between p-4"
          >
            {/* Під-екран прев'ю фото перед надсиланням ШІ */}
            {subScreen === "preview" && (
              <div className="w-full max-w-md px-2 flex flex-col flex-1 justify-between py-6">
                <div className="text-center select-none pt-4">
                  <h3 className="text-[#1C1C1E] font-bold text-xl">Перевірте якість фото</h3>
                  <p className="text-xs text-gray-500 mt-1">Текст і заповнені клітинки повинні бути чіткими</p>
                </div>

                <div className="flex-1 flex items-center justify-center py-4">
                  {currentBase64Image && (
                    <img 
                      src={currentBase64Image} 
                      alt="Timesheet preview" 
                      className="max-w-[95%] max-h-[50vh] object-contain rounded-2xl border-2 border-white/80 shadow-2xl"
                    />
                  )}
                </div>

                <div className="ios-frosted-glass rounded-2xl p-4 flex flex-col items-center border border-white/60">
                  <button 
                    onClick={() => analyzeTimesheetImage(false)}
                    disabled={globalLoading}
                    className="ios-touchable w-full bg-[#007AFF] text-white font-bold py-4 rounded-xl text-center shadow-lg shadow-blue-500/25 disabled:opacity-50"
                  >
                    {globalLoading ? "⏳ Обробка..." : "🚀 Розпізнати з ШІ"}
                  </button>
                </div>
              </div>
            )}

            {/* Під-екран відображення та редагування таблиці */}
            {subScreen === "table" && (
              <div className="w-full flex-1 min-h-0 flex flex-col justify-between pt-1 pb-2">
                
                <div className="w-full ios-frosted-glass rounded-2xl p-4 flex flex-col gap-3 border border-white/60 mb-2 shrink-0">
                  <div className="flex justify-between items-center py-1 select-none">
                    <h3 className="text-[#1C1C1E] font-bold text-sm leading-tight flex-1 text-center">{titleText}</h3>
                    {isReadOnly && currentArchiveId !== null && (
                      <button 
                        onClick={toggleEditArchiveMode}
                        className="ios-touchable p-2.5 bg-[#007AFF]/10 border border-[#007AFF]/20 text-[#007AFF] rounded-full active:scale-95 shadow-sm ml-2 transition-transform"
                        title="Редагувати архівний табель"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {/* Блок управління масштабуванням */}
                  <div className="flex gap-4 items-center justify-center bg-white/45 py-2 px-4 rounded-xl shadow-inner-sm">
                    <button 
                      onClick={decrementZoom}
                      className="ios-touchable w-10 h-10 rounded-full bg-neutral-100/80 active:bg-neutral-200 border border-neutral-200/50 flex items-center justify-center font-bold"
                      title="Зменшити масштаб"
                    >
                      <ZoomOut className="w-5 h-5 text-neutral-600" />
                    </button>
                    <span className="text-xs font-mono font-bold text-neutral-600 select-none">{Math.round(zoomScale * 100)}%</span>
                    <button 
                      onClick={incrementZoom}
                      className="ios-touchable w-10 h-10 rounded-full bg-neutral-100/80 active:bg-neutral-200 border border-neutral-200/50 flex items-center justify-center font-bold"
                      title="Збільшити масштаб"
                    >
                      <ZoomIn className="w-5 h-5 text-neutral-600" />
                    </button>
                  </div>
                </div>

                <div className="w-full flex-1 min-h-0 overflow-auto rounded-2xl p-2 bg-white border border-gray-200 shadow-sm relative">
                  <div 
                    style={{ transform: `scale(${zoomScale})`, transformOrigin: "top left", width: "max-content" }}
                    dangerouslySetInnerHTML={{ __html: generatedTableHtml }}
                  />
                </div>

                {/* Кнопка генерації або збереження змін */}
                {confirmButtonVisible && (
                  <div className="w-full ios-frosted-glass rounded-2xl p-4 flex flex-col items-center border border-white/60 mt-2 select-none shrink-0">
                    <button 
                      onClick={generateExcelAndSubmit}
                      className="ios-touchable w-full bg-[#007AFF] text-white font-bold py-4 rounded-xl text-center shadow-lg shadow-blue-500/25"
                    >
                      {currentArchiveId !== null ? "💾 Зберегти зміни" : "✅ Сформувати Excel"}
                    </button>
                  </div>
                )}
              </div>
            )}

          </motion.div>
        )}

        {/* ========================================== */}
        {/* ЕКРАН АРХІВУ                               */}
        {/* ========================================== */}
        {screen === "archive" && (
          <motion.div 
            key="archive-screen"
            className="w-full max-w-md px-5 py-6 flex flex-col h-full justify-between"
          >
            <div className="flex justify-center select-none pt-4 mb-5">
              <h3 className="font-bold text-[#1C1C1E] text-base text-center">
                {archiveMode === "email" ? "📧 Виберіть табель для відправки" : "🗂 Архів згенерованих табелів"}
              </h3>
            </div>

            <div className="flex-1 overflow-y-auto max-h-[78vh] pr-1 py-1 flex flex-col gap-3">
              {archiveLoading && archiveList.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20">
                  <div className="w-8 h-8 rounded-full border-2 border-neutral-300 border-t-[#007AFF] animate-spin" />
                  <p className="text-xs text-gray-500 mt-4">{archiveMessage}</p>
                </div>
              ) : archiveList.length > 0 ? (
                archiveList.map((item) => (
                  <motion.div 
                    whileTap={{ scale: 0.98 }}
                    key={item.id}
                    onClick={() => {
                      if (archiveMode === "email") {
                        sendTabelToEmailAddress(item.id, item.period_text, item.year);
                      } else {
                        openArchivedItem(item.id);
                      }
                    }}
                    className="ios-frosted-glass rounded-xl p-4 border border-white/80 shadow-sm flex items-center justify-between cursor-pointer group hover:bg-white/60 transition-colors ios-touchable"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center text-[#007AFF]">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-[#1C1C1E] text-sm">{item.period_text} {item.year}</h4>
                        <p className="text-[10px] text-gray-500 mt-0.5">Заповнено: {item.date_filled || "Не вказано"}</p>
                      </div>
                    </div>
                    <div className="text-right flex flex-col items-end">
                      <span className="text-[9px] text-gray-400">{formatLocalDate(item.created_at)}</span>
                      <span className="text-[10px] text-[#007AFF] font-bold mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {archiveMode === "email" ? "Надіслати" : "Перегляд"}
                      </span>
                    </div>
                  </motion.div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-center select-none">
                  <div className="w-12 h-12 rounded-full bg-neutral-100 flex items-center justify-center text-gray-400 mb-4">
                    <Clock className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-semibold text-gray-600">{archiveMessage}</p>
                  <p className="text-xs text-gray-400 max-w-[200px] mt-2">Оцифруйте перший табель, щоб він з'явився тут!</p>
                </div>
              )}
            </div>
            
          </motion.div>
        )}

      </AnimatePresence>

      {/* ========================================================= */}
      {/* ГЛОБАЛЬНИЙ ЕКРАН ЗАВАНТАЖЕННЯ (Анімація поїзда)            */}
      {/* ========================================================= */}
      <AnimatePresence>
        {globalLoading && (
          <motion.div 
            key="train-loader"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-white/78 backdrop-blur-2xl flex flex-col items-center justify-center z-50 select-none overflow-hidden"
          >
            <div className="relative w-screen h-[48px] flex items-end mb-8 overflow-hidden bg-transparent">
              <div className="absolute bottom-[2px] left-0 w-full h-[1.5px] bg-neutral-200">
                <div className="w-full h-full bg-repeat-x" style={{ backgroundImage: "linear-gradient(to right, transparent 0px, transparent 12px, #ddd 12px, #ddd 14px)", backgroundSize: "16px 1px" }}></div>
              </div>

              <div className="absolute bottom-[3px] left-0 w-[160px] h-[28px] loading-train flex items-end">
                <svg width="160" height="28" viewBox="0 0 160 28" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                  <path d="M 25 5 L 32 1 L 42 1 M 32 1 L 38 5" stroke="#71717A" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M 5 6 L 73 6 L 73 24 L 5 24 Z" fill="#1C1C1E" />
                  <path d="M 77 6 L 125 6 C 135 6, 148 10, 154 18 C 158 22, 159 23.5, 160 24 L 77 24 Z" fill="#1C1C1E" />
                  <rect x="73.5" y="7" width="3" height="16" fill="#71717A" rx="0.5" />
                  <path d="M 5 19 H 73 M 77 19 H 135 C 140 19, 145 18, 149 16.5" stroke="#007AFF" strokeWidth="1.5" strokeLinecap="round" />
                  
                  <rect x="10" y="9" width="10" height="4" rx="1" fill="#E0F2FE" opacity="0.8" />
                  <rect x="24" y="9" width="10" height="4" rx="1" fill="#E0F2FE" opacity="0.8" />
                  <rect x="38" y="9" width="10" height="4" rx="1" fill="#E0F2FE" opacity="0.8" />
                  <rect x="52" y="9" width="10" height="4" rx="1" fill="#E0F2FE" opacity="0.8" />
                  
                  <rect x="82" y="9" width="10" height="4" rx="1" fill="#E0F2FE" opacity="0.8" />
                  <rect x="96" y="9" width="10" height="4" rx="1" fill="#E0F2FE" opacity="0.8" />
                  <rect x="110" y="9" width="10" height="4" rx="1" fill="#E0F2FE" opacity="0.8" />
                  
                  <path d="M 129 8 L 138 8 C 142 8, 145 11, 147 14 L 137 14 Z" fill="#E0F2FE" opacity="0.9" />
                  
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
                <Sparkles className="w-5 h-5 text-[#007AFF] animate-spin" style={{ animationDuration: "3s" }} />
                <h2 className="text-xl font-bold tracking-tight">{globalLoadingText}</h2>
              </div>
              <p className="text-xs text-gray-500 mt-1">ШІ обробляє дані. Будь ласка, зачекайте.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Модальне вікно для редагування комірки (уникає prompt) */}
      {editingCell && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[100] p-4 select-none">
          <div className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-2xl border border-gray-100 flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-150">
            <div>
              <h4 className="font-bold text-[#1C1C1E] text-base">{editingCell.title}</h4>
              <p className="text-xs text-gray-400 mt-1">Введіть нове значення</p>
            </div>
            
            <input 
              type="text"
              value={editingCell.value}
              onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
              className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl font-medium text-sm text-[#1C1C1E] focus:outline-none focus:ring-2 focus:ring-[#007AFF] focus:border-transparent transition-all"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSaveEditingCell();
                } else if (e.key === "Escape") {
                  setEditingCell(null);
                }
              }}
            />
            
            <div className="flex gap-3 justify-end mt-2">
              <button 
                onClick={() => setEditingCell(null)}
                className="px-4 py-2.5 rounded-xl border border-neutral-200 hover:bg-neutral-50 text-[#1C1C1E] font-semibold text-sm transition-colors ios-touchable"
              >
                Скасувати
              </button>
              <button 
                onClick={handleSaveEditingCell}
                className="px-5 py-2.5 rounded-xl bg-[#007AFF] text-white hover:bg-blue-600 font-bold text-sm transition-colors shadow-md shadow-blue-500/10 ios-touchable"
              >
                Зберегти
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}