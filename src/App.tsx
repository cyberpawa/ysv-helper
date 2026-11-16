import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Camera,
  Upload,
  Clock,
  Mail,
  ChevronLeft,
  RotateCw,
  ZoomIn,
  ZoomOut,
  FileText,
  Pencil,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import Cropper from "cropperjs";

import {
  ArchiveItem,
  DocumentMeta,
  EditingCellState,
  TimesheetData,
  TimesheetTemplateId,
} from "./types/timesheet";
import { TEMPLATE_OPTIONS, getCodesForCol } from "./config/templates";
import {
  cropCanvasByTemplateROI,
  resolveTemplateROICrop,
} from "./utils/templateDetector";
import { TimesheetTable } from "./components/TimesheetTable";
import { AmbientTrainBg, TrainLoader } from "./components/AmbientTrainBg";
import { EditCellModal } from "./components/EditCellModal";

export default function App() {
  const tg = (window as any).Telegram?.WebApp;

  const [screen, setScreen] = useState<
    "menu" | "camera" | "crop" | "review" | "archive"
  >("menu");
  const [subScreen, setSubScreen] = useState<"preview" | "table">("preview");
  const [archiveMode, setArchiveMode] = useState<"view" | "email">("view");
  const [imageSource, setImageSource] = useState<"camera" | "upload">("camera");
  const [isReadOnly, setIsReadOnly] = useState<boolean>(false);

  const [selectedTemplateMode, setSelectedTemplateMode] =
    useState<TimesheetTemplateId>("auto");

  const [currentBase64Image, setCurrentBase64Image] = useState<string | null>(
    null
  );
  const [originalUploadedImage, setOriginalUploadedImage] = useState<
    string | null
  >(null);
  const [finalParsedData, setFinalParsedData] = useState<TimesheetData | null>(
    null
  );
  const [archiveList, setArchiveList] = useState<ArchiveItem[]>([]);
  const [archiveLoading, setArchiveLoading] = useState<boolean>(false);
  const [archiveMessage, setArchiveMessage] = useState<string>("");
  const [currentArchiveId, setCurrentArchiveId] = useState<number | null>(null);
  const [editingCell, setEditingCell] = useState<EditingCellState | null>(null);

  const [globalLoading, setGlobalLoading] = useState<boolean>(false);
  const [globalLoadingText, setGlobalLoadingText] = useState<string>("");
  const [captureLoading, setCaptureLoading] = useState<boolean>(false);

  const [zoomScale, setZoomScale] = useState<number>(0.82);
  const [titleText, setTitleText] = useState<string>(
    "Перевірте дані (Редагування)"
  );
  const [confirmButtonVisible, setConfirmButtonVisible] =
    useState<boolean>(true);
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cropperImageRef = useRef<HTMLImageElement | null>(null);
  const cropperInstanceRef = useRef<Cropper | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const hiddenFileInputRef = useRef<HTMLInputElement | null>(null);
  const sheetCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const BACKEND_URL =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
      ? ""
      : "/api";

  const getAuthHeaders = (): HeadersInit => {
    const headers: { [key: string]: string } = {
      "Content-Type": "application/json",
    };
    if (tg?.initData) {
      headers["X-Telegram-Init-Data"] = tg.initData;
    }
    return headers;
  };

  // Відновлення стану обробки при перезавантаженні
  useEffect(() => {
    let pollingInterval: ReturnType<typeof setInterval> | null = null;

    const checkState = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/state`, {
          method: "GET",
          headers: getAuthHeaders(),
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
            await fetch(`${BACKEND_URL}/state/reset`, {
              method: "POST",
              headers: getAuthHeaders(),
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

  useEffect(() => {
    if (tg) {
      tg.expand();
      if (typeof tg.disableVerticalSwipes === "function")
        tg.disableVerticalSwipes();
      if (typeof tg.disableClosingConfirmation === "function")
        tg.disableClosingConfirmation();
      tg.ready();
    }
  }, [tg]);

  useEffect(() => {
    if (tg && tg.BackButton) {
      if (screen === "menu" || globalLoading) {
        tg.BackButton.hide();
      } else {
        tg.BackButton.show();
      }
    }
  }, [screen, globalLoading, tg]);

  const triggerHaptic = () => {
    if (tg && tg.HapticFeedback) {
      try {
        tg.HapticFeedback.impactOccurred("light");
      } catch (e) {
        console.error("Haptic feedback failed", e);
      }
    }
  };

  const stopCamera = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {}
      });
      localStreamRef.current = null;
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {}
      });
      videoRef.current.srcObject = null;
    }
  }, []);

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
  }, [
    screen,
    subScreen,
    imageSource,
    isReadOnly,
    tg,
    originalUploadedImage,
    currentArchiveId,
    stopCamera,
  ]);

  const startCamera = useCallback(async () => {
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 3840 },
          height: { ideal: 2160 },
        },
      });
      localStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch((e) => console.error(e));
      }
      setTorchOn(false);
    } catch (err) {
      alert("Не вдалося запустити камеру. Спробуйте завантажити файл.");
    }
  }, [stopCamera]);

  // Включення/вимкнення камери в залежності від поточного екрану
  useEffect(() => {
    if (screen === "camera") {
      startCamera();
    }
    return () => {
      stopCamera();
    };
  }, [screen, startCamera, stopCamera]);

  const toggleFlash = async () => {
    triggerHaptic();
    if (!localStreamRef.current) return;
    const track = localStreamRef.current.getVideoTracks()[0];
    const capabilities = (track as any).getCapabilities?.();
    if (capabilities && capabilities.torch) {
      try {
        const nextTorch = !torchOn;
        await (track as any).applyConstraints({
          advanced: [{ torch: nextTorch }],
        });
        setTorchOn(nextTorch);
      } catch (e) {
        console.error(e);
      }
    } else {
      alert("Спалах не підтримується на вашому пристрої.");
    }
  };

  // Застосування визначення меж таблиці та ROI-обрізки до підготовленого A4-листа
  const applyTemplatePipeline = useCallback(
    (sheetCanvas: HTMLCanvasElement, mode: TimesheetTemplateId) => {
      sheetCanvasRef.current = sheetCanvas;
      const roiCrop = resolveTemplateROICrop(sheetCanvas, mode);
      const croppedDataUrl = cropCanvasByTemplateROI(
        sheetCanvas,
        { x: 0, y: 0, w: sheetCanvas.width, h: sheetCanvas.height },
        roiCrop
      );
      if (croppedDataUrl) {
        setCurrentBase64Image(croppedDataUrl);
      }
    },
    []
  );

  const handleTemplateModeChange = (mode: TimesheetTemplateId) => {
    triggerHaptic();
    setSelectedTemplateMode(mode);
    if (sheetCanvasRef.current) {
      applyTemplatePipeline(sheetCanvasRef.current, mode);
    }
  };

  // Розрахунок позиції рамки камери та збереження A4-листа для класифікації й ROI-обрізки
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
          height: rect.height,
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
          height: guideHeight,
        };
      }

      let scale, sourceX, sourceY;

      if (screenRatio > videoRatio) {
        scale = videoW / window.innerWidth;
        sourceX = guideRect.left * scale;
        sourceY =
          (guideRect.top +
            (window.innerWidth / videoRatio - window.innerHeight) / 2) *
          scale;
      } else {
        scale = videoH / window.innerHeight;
        sourceX =
          (guideRect.left +
            (window.innerHeight * videoRatio - window.innerWidth) / 2) *
          scale;
        sourceY = guideRect.top * scale;
      }

      const sourceW = guideRect.width * scale;
      const sourceH = guideRect.height * scale;

      const sheetCanvas = document.createElement("canvas");
      sheetCanvas.width = Math.max(1, Math.round(sourceW));
      sheetCanvas.height = Math.max(1, Math.round(sourceH));
      const sheetCtx = sheetCanvas.getContext("2d");

      if (sheetCtx) {
        sheetCtx.drawImage(
          video,
          sourceX,
          sourceY,
          sourceW,
          sourceH,
          0,
          0,
          sheetCanvas.width,
          sheetCanvas.height
        );

        applyTemplatePipeline(sheetCanvas, selectedTemplateMode);
        stopCamera();
        setScreen("review");
        setSubScreen("preview");
      }
      setCaptureLoading(false);
    }, 500);
  };

  // Завантаження файлу та налаштування Cropper.js
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
      node.play().catch((e) => console.error("Playback on mount failed: ", e));
    }
  }, []);

  const fitCropperCanvasAndBox = (
    cropper: Cropper,
    sourceWidth: number,
    sourceHeight: number
  ) => {
    const containerData = cropper.getContainerData();
    if (!containerData || sourceWidth <= 0 || sourceHeight <= 0) return;

    const containerWidth = containerData.width;
    const containerHeight = containerData.height;

    cropper.setCropBoxData({
      left: containerWidth / 2 - 10,
      top: containerHeight / 2 - 10,
      width: 20,
      height: 20,
    });

    const ratio = sourceWidth / sourceHeight;
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

    const boxLeft = (containerWidth - canvasWidth) / 2;
    const boxTop = (containerHeight - canvasHeight) / 2;

    cropper.setCanvasData({
      left: boxLeft,
      top: boxTop,
      width: canvasWidth,
      height: canvasHeight,
    });

    cropper.setCropBoxData({
      left: boxLeft,
      top: boxTop,
      width: canvasWidth,
      height: canvasHeight,
    });
  };

  const cropperRefCallback = useCallback(
    (node: HTMLImageElement | null) => {
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
            aspectRatio: NaN,
            viewMode: 1,
            autoCropArea: 1,
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
              const imageData = cropper.getImageData();
              if (imageData) {
                fitCropperCanvasAndBox(
                  cropper,
                  imageData.naturalWidth,
                  imageData.naturalHeight
                );
              }
            },
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
    },
    [currentBase64Image]
  );

  const rotateCropImage = () => {
    triggerHaptic();
    const cropper = cropperInstanceRef.current;
    if (cropper) {
      setIsTransitioning(true);
      cropper.rotate(90);

      const imageData = cropper.getImageData();
      if (imageData) {
        const isRotated90or270 = Math.abs(imageData.rotate % 180) === 90;
        const rotatedWidth = isRotated90or270
          ? imageData.naturalHeight
          : imageData.naturalWidth;
        const rotatedHeight = isRotated90or270
          ? imageData.naturalWidth
          : imageData.naturalHeight;

        fitCropperCanvasAndBox(cropper, rotatedWidth, rotatedHeight);
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
    applyTemplatePipeline(croppedCanvas, selectedTemplateMode);

    setConfirmButtonVisible(true);
    setTitleText("Перевірте дані (Редагування)");
    setScreen("review");
    setSubScreen("preview");
  };

  const analyzeTimesheetImage = async (useFallback: boolean = false) => {
    triggerHaptic();
    if (!currentBase64Image) return;

    setGlobalLoadingText(
      useFallback
        ? "ШІ (Gemini 3.8 Flash) аналізує табель..."
        : "ШІ (Gemini 4 Hydrogen) аналізує табель..."
    );
    setGlobalLoading(true);

    try {
      const res = await fetch(`${BACKEND_URL}/upload`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          image: currentBase64Image,
          use_fallback: useFallback,
          template_id: selectedTemplateMode,
        }),
      });

      const result = await res.json();

      if (result.status === "high_demand") {
        setGlobalLoading(false);
        const userAgrees = confirm(
          "Модель Gemini 4 Hydrogen зараз перевантажена (високий попит на серверах Google).\n\n" +
            "Бажаєте спробувати розпізнати цей табель за допомогою резервної моделі (Gemini 3.8 Flash)?"
        );

        if (userAgrees) {
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

  const handleToggleYellow = (day: string) => {
    if (isReadOnly) return;
    setFinalParsedData((prev) => {
      if (!prev) return prev;
      const updated = structuredClone(prev);
      if (!updated.document_meta) updated.document_meta = {};
      const crossed = updated.document_meta.crossed_out_headers || [];
      const idx = crossed.indexOf(day);
      if (idx > -1) {
        crossed.splice(idx, 1);
      } else {
        crossed.push(day);
      }
      updated.document_meta.crossed_out_headers = crossed;
      return updated;
    });
    triggerHaptic();
  };

  const handleEditMeta = (field: keyof DocumentMeta, currentVal: string) => {
    if (isReadOnly) return;
    const isEmptyPlaceholder =
      currentVal.includes("_") ||
      (currentVal.includes(".") &&
        currentVal.replace(/[._]/g, "").trim() === "");
    setEditingCell({
      empIndex: -1,
      type: "meta",
      metaField: field,
      title: "Змінити поле метаданих",
      value: isEmptyPlaceholder ? "" : currentVal,
    });
    triggerHaptic();
  };

  const handleEditCell = (
    empIndex: number,
    day: string,
    type: "hours" | "code",
    currentVal: string
  ) => {
    if (isReadOnly) return;
    setEditingCell({
      empIndex,
      day,
      type,
      title: `Змінити значення за ${day} число (${type === "hours" ? "години" : "код"})`,
      value: currentVal === "-" ? "" : currentVal,
    });
    triggerHaptic();
  };

  const handleEditTotals = (
    empIndex: number,
    type: "days" | "hours",
    currentVal: string
  ) => {
    if (isReadOnly) return;
    setEditingCell({
      empIndex,
      type: type === "days" ? "totals_days" : "totals_hours",
      title: `Змінити підсумок (${type === "days" ? "відпрацьовано днів" : "відпрацьовано годин"})`,
      value: currentVal === "-" ? "" : currentVal,
    });
    triggerHaptic();
  };

  const handleEditAbsenceTotal = (empIndex: number) => {
    if (isReadOnly) return;
    const emp = finalParsedData?.employees?.[empIndex];
    if (!emp) return;
    const defaultVal =
      `${emp.absences?.total_days || ""} ${emp.absences?.total_hours || ""}`.trim();
    setEditingCell({
      empIndex,
      type: "absence_total",
      title: "Введіть кількість неявок (ДНІ ГОДИНИ)",
      value: defaultVal === "- -" || defaultVal === "-" ? "" : defaultVal,
    });
    triggerHaptic();
  };

  const handleEditAbsenceReason = (
    empIndex: number,
    colIndex: number,
    currentVal: string
  ) => {
    if (isReadOnly) return;
    setEditingCell({
      empIndex,
      type: "absence_reason",
      colIndex,
      title: "Деталі неявки: КОД ДНІ ГОДИНИ (через пробіл)",
      value: currentVal,
    });
    triggerHaptic();
  };

  const incrementZoom = () => {
    triggerHaptic();
    setZoomScale((z) => Math.min(z + 0.1, 2.0));
  };

  const decrementZoom = () => {
    triggerHaptic();
    setZoomScale((z) => Math.max(z - 0.1, 0.4));
  };

  const handleSaveEditingCell = () => {
    if (!editingCell) return;
    const { empIndex, day, type, metaField, colIndex, value } = editingCell;
    const trimmedVal = value.trim();

    setFinalParsedData((prev) => {
      if (!prev) return prev;
      const updated = structuredClone(prev);

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
          updated.employees[empIndex].totals[field] = trimmedVal.replace(
            ".",
            ","
          );
        }
      } else if (type === "meta") {
        if (!updated.document_meta) updated.document_meta = {};
        (updated.document_meta as any)[metaField!] = trimmedVal;
      } else if (type === "absence_total") {
        if (updated.employees && updated.employees[empIndex]) {
          if (!updated.employees[empIndex].absences) {
            updated.employees[empIndex].absences = {
              total_days: "-",
              total_hours: "-",
              reasons: [],
            };
          }
          const parts = trimmedVal.split(/\s+/);
          updated.employees[empIndex].absences.total_days = parts[0] || "-";
          updated.employees[empIndex].absences.total_hours = parts[1] || "-";
        }
      } else if (type === "absence_reason") {
        if (updated.employees && updated.employees[empIndex]) {
          if (!updated.employees[empIndex].absences) {
            updated.employees[empIndex].absences = {
              total_days: "-",
              total_hours: "-",
              reasons: [],
            };
          }
          if (!updated.employees[empIndex].absences.reasons) {
            updated.employees[empIndex].absences.reasons = [];
          }

          const codesToClear = getCodesForCol(colIndex!);
          updated.employees[empIndex].absences.reasons = (
            updated.employees[empIndex].absences.reasons || []
          ).filter((r) => !codesToClear.includes(r.code));

          if (trimmedVal !== "") {
            const parts = trimmedVal.split(/\s+/);
            const code = parts[0].toUpperCase();
            const rDays = parts[1] || "-";
            const rHours = parts[2] || "-";
            updated.employees[empIndex].absences.reasons.push({
              code,
              days: rDays,
              hours: rHours,
            });
          }
        }
      }

      return updated;
    });

    triggerHaptic();
    setEditingCell(null);
  };

  // Робота з архівом бази даних
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

  const loadArchiveList = async (mode: "view" | "email") => {
    triggerHaptic();
    setArchiveMode(mode);
    setArchiveLoading(true);
    setArchiveMessage("Завантаження вашого архіву...");
    setScreen("archive");

    try {
      const res = await fetch(`${BACKEND_URL}/archive`, {
        method: "GET",
        headers: getAuthHeaders(),
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

  const openArchivedItem = async (tabelId: number) => {
    triggerHaptic();
    setGlobalLoadingText("Завантажуємо деталі архіву...");
    setGlobalLoading(true);

    try {
      const res = await fetch(`${BACKEND_URL}/archive/detail/${tabelId}`, {
        method: "GET",
        headers: getAuthHeaders(),
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

  const toggleEditArchiveMode = () => {
    triggerHaptic();
    setIsReadOnly(false);
    setTitleText("Редагування архівного табеля");
    setConfirmButtonVisible(true);
  };

  const saveArchivedChanges = async () => {
    triggerHaptic();
    if (!finalParsedData || currentArchiveId === null) return;

    setGlobalLoadingText("Збереження змін в архіві...");
    setGlobalLoading(true);

    try {
      const res = await fetch(
        `${BACKEND_URL}/archive/update/${currentArchiveId}`,
        {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({ data: finalParsedData }),
        }
      );
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

  const sendTabelToEmailAddress = async (
    tabelId: number,
    periodStr: string,
    yearStr: string
  ) => {
    triggerHaptic();
    const confirmed = confirm(
      `Надіслати табель за ${periodStr} ${yearStr} на пошту бухгалтерії?`
    );
    if (!confirmed) return;

    setGlobalLoadingText("Надсилання листа бухгалтеру...");
    setGlobalLoading(true);

    try {
      const res = await fetch(`${BACKEND_URL}/send-email`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ tabel_id: tabelId }),
      });
      const result = await res.json();
      setGlobalLoading(false);

      if (result.status === "success") {
        alert(
          "✅ Табель успішно надіслано на електронну пошту бухгалтерії!"
        );
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
        body: JSON.stringify({ data: finalParsedData }),
      });
      const result = await res.json();
      setGlobalLoading(false);

      if (result.status === "success") {
        alert(
          "✅ Готово! Табель успішно збережено в архів та надіслано в чат."
        );
        setTimeout(() => {
          setFinalParsedData(null);
          setCurrentBase64Image(null);
          sheetCanvasRef.current = null;
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

  const handleScanClick = () => {
    triggerHaptic();
    setIsReadOnly(false);
    setConfirmButtonVisible(true);
    setTitleText("Перевірте дані (Редагування)");
    setCurrentArchiveId(null);
    setImageSource("camera");
    setScreen("camera");
  };

  const handleEmailClick = () => {
    loadArchiveList("email");
  };

  const handleArchiveClick = () => {
    loadArchiveList("view");
  };

  return (
    <div className="w-full h-full min-h-screen railway-ambient-bg flex flex-col items-center overflow-hidden relative">
      <AmbientTrainBg />

      {/* ЕКРАН ГОЛОВНОГО МЕНЮ */}
      <div
        style={{ display: screen === "menu" ? "flex" : "none" }}
        className="w-full max-w-md px-5 py-6 flex flex-col h-full justify-between select-none relative z-10"
      >
        <div className="text-center mt-3 mb-4 select-none">
          <span className="text-[11px] font-bold text-[#007AFF] bg-blue-50 px-3 py-1.5 rounded-full border border-blue-100 tracking-wider uppercase">
            Оцифрування табелів
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-[#1C1C1E] mt-3">
            Особистий Помічник YSV
          </h1>
          <p className="text-xs text-gray-500 mt-1 max-w-[280px] mx-auto">
            Швидке сканування табелів обліку робочого часу на основі надійного
            ШІ
          </p>
        </div>

        <div className="flex-1 flex flex-col justify-center py-4">
          <button
            onClick={handleScanClick}
            className="w-full ios-frosted-glass rounded-2xl p-6 flex flex-col items-center justify-center text-center shadow-lg cursor-pointer min-h-[160px] relative overflow-hidden group border border-white/60 ios-touchable"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-sky-200/20 rounded-full blur-3xl pointer-events-none transition-all" />
            <div className="w-16 h-16 rounded-full bg-sky-100/80 flex items-center justify-center mb-4 text-[#007AFF] shadow-inner">
              <Camera className="w-8 h-8" />
            </div>
            <span className="text-xl font-bold tracking-tight text-[#1C1C1E]">
              📸 Сканувати табель
            </span>
            <p className="text-xs text-gray-500 mt-1.5 max-w-[240px]">
              Оцифруйте паперовий табель за допомогою камери
            </p>
          </button>

          <div className="grid grid-cols-2 gap-4 mt-4 select-none">
            <label
              className="ios-frosted-glass rounded-2xl p-5 flex flex-col items-start text-left relative overflow-hidden cursor-pointer border border-white/60 ios-touchable"
            >
              <input
                type="file"
                ref={hiddenFileInputRef}
                accept="image/*"
                onClick={(e) => {
                  triggerHaptic();
                  setIsReadOnly(false);
                  setCurrentArchiveId(null);
                  setImageSource("upload");
                  e.currentTarget.value = "";
                }}
                onChange={handleFileChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
              />
              <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center text-[#FF9500] mb-3">
                <Upload className="w-5 h-5" />
              </div>
              <span className="font-bold text-sm text-[#1C1C1E]">
                📁 Завантажити
              </span>
              <p className="text-[10px] leading-tight text-gray-500 mt-1">
                Оберіть файл з вашої фотогалереї
              </p>
            </label>

            <button
              onClick={handleEmailClick}
              className="ios-frosted-glass rounded-2xl p-5 flex flex-col items-start text-left relative overflow-hidden cursor-pointer border border-white/60 ios-touchable"
            >
              <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-[#007AFF] mb-3">
                <Mail className="w-5 h-5" />
              </div>
              <span className="font-bold text-sm text-[#1C1C1E]">
                📧 Надіслати
              </span>
              <p className="text-[10px] leading-tight text-gray-500 mt-1">
                Надіслати прямо бухгалтерській службі
              </p>
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
                  <span className="font-bold text-sm text-[#1C1C1E] block">
                    🗂 Архів табелів
                  </span>
                  <p className="text-[10px] leading-tight text-gray-500 mt-0.5">
                    Перегляньте заповнену історію своїх табелів
                  </p>
                </div>
              </div>
              <ChevronLeft className="w-5 h-5 text-gray-400 rotate-180" />
            </button>
          </div>
        </div>

        <div className="text-center py-2 select-none pointer-events-none mt-auto">
          <span className="text-[10px] text-gray-400">
            YSV Помічник • 2026
          </span>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {/* ЕКРАН КАМЕРИ */}
        {screen === "camera" && (
          <motion.div
            key="camera-screen"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black w-full h-full z-10"
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
                <span className="w-1.5 h-1.5 rounded-full bg-[#007AFF] animate-pulse" />
                Помістіть табель у рамку
              </div>
            </div>

            <div className="absolute bottom-12 left-0 w-full flex items-center justify-center gap-4 z-10 px-6">
              <button
                onClick={toggleFlash}
                className={`ios-touchable w-14 h-14 rounded-full backdrop-blur-md flex items-center justify-center border transition-all text-xl shadow-lg active:scale-95 ${
                  torchOn
                    ? "bg-white text-black border-white"
                    : "bg-black/40 text-white border-white/20"
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

        {/* ЕКРАН ОБРІЗКИ (CROPPER) */}
        {screen === "crop" && (
          <motion.div
            key="crop-screen"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 railway-ambient-bg flex flex-col justify-between p-5 z-10"
          >
            <div className="text-center pt-8 select-none z-10">
              <h3 className="text-[#1C1C1E] font-bold text-lg">
                Виділіть межі табеля (А4)
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                Орієнтуйте рамку по оригінальних лініях
              </p>
            </div>

            <div className="flex-1 flex items-center justify-center overflow-hidden py-4">
              <div
                className={`w-full h-[58vh] bg-white/40 border border-white/80 rounded-2xl overflow-hidden flex items-center justify-center relative shadow-xl backdrop-blur-md ${isTransitioning ? "cropper-transitioning" : ""}`}
              >
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

        {/* ЕКРАН ПЕРЕВІРКИ ТАБЛИЦІ */}
        {screen === "review" && (
          <motion.div
            key="review-screen"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="w-full h-screen max-h-screen overflow-hidden flex flex-col items-center justify-between p-4 relative z-10"
          >
            {/* Під-екран прев'ю фото перед надсиланням ШІ */}
            {subScreen === "preview" && (
              <div className="w-full max-w-md px-2 flex flex-col flex-1 justify-between py-3 min-h-0">
                <div className="text-center select-none pt-2 shrink-0">
                  <h3 className="text-[#1C1C1E] font-bold text-lg">
                    Перевірте якість та ROI-обрізку
                  </h3>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    ПІБ працівників та реквізити організації приховано до
                    відправки в ШІ
                  </p>
                </div>

                <div className="flex-1 min-h-0 flex items-center justify-center py-2">
                  {currentBase64Image && (
                    <img
                      src={currentBase64Image}
                      alt="Timesheet preview"
                      className="max-w-[95%] max-h-[40vh] object-contain rounded-2xl border-2 border-white/80 shadow-2xl"
                    />
                  )}
                </div>

                <div className="flex flex-col gap-2.5 shrink-0">
                  <div className="ios-frosted-glass rounded-2xl p-2.5 border border-white/60">
                    <div className="grid grid-cols-4 gap-1.5">
                      {TEMPLATE_OPTIONS.map((opt) => {
                        const isActive = selectedTemplateMode === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => handleTemplateModeChange(opt.id)}
                            className={`py-2 px-2 rounded-xl text-xs font-semibold border transition-colors ios-touchable truncate ${
                              isActive
                                ? "bg-[#007AFF] text-white border-[#007AFF] shadow-sm"
                                : "bg-white/75 text-[#1C1C1E] border-gray-200"
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="ios-frosted-glass rounded-2xl p-3.5 flex flex-col items-center border border-white/60">
                    <button
                      onClick={() => analyzeTimesheetImage(false)}
                      disabled={globalLoading}
                      className="ios-touchable w-full bg-[#007AFF] text-white font-bold py-3.5 rounded-xl text-center shadow-lg shadow-blue-500/25 disabled:opacity-50"
                    >
                      {globalLoading ? "⏳ Обробка..." : "🚀 Розпізнати з ШІ"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Під-екран відображення та редагування таблиці */}
            {subScreen === "table" && finalParsedData && (
              <div className="w-full flex-1 min-h-0 flex flex-col justify-between pt-1 pb-2">
                <div className="w-full ios-frosted-glass rounded-2xl p-4 flex flex-col gap-3 border border-white/60 mb-2 shrink-0">
                  <div className="flex justify-between items-center py-1 select-none">
                    <h3 className="text-[#1C1C1E] font-bold text-sm leading-tight flex-1 text-center">
                      {titleText}
                    </h3>
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

                  <div className="flex gap-4 items-center justify-center bg-white/45 py-2 px-4 rounded-xl shadow-inner-sm">
                    <button
                      onClick={decrementZoom}
                      className="ios-touchable w-10 h-10 rounded-full bg-neutral-100/80 active:bg-neutral-200 border border-neutral-200/50 flex items-center justify-center font-bold"
                      title="Зменшити масштаб"
                    >
                      <ZoomOut className="w-5 h-5 text-neutral-600" />
                    </button>
                    <span className="text-xs font-mono font-bold text-neutral-600 select-none">
                      {Math.round(zoomScale * 100)}%
                    </span>
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
                    style={{
                      transform: `scale(${zoomScale})`,
                      transformOrigin: "top left",
                      width: "max-content",
                    }}
                  >
                    <TimesheetTable
                      data={finalParsedData}
                      isReadOnly={isReadOnly}
                      onToggleYellow={handleToggleYellow}
                      onEditMeta={handleEditMeta}
                      onEditCell={handleEditCell}
                      onEditTotals={handleEditTotals}
                      onEditAbsenceTotal={handleEditAbsenceTotal}
                      onEditAbsenceReason={handleEditAbsenceReason}
                    />
                  </div>
                </div>

                {confirmButtonVisible && (
                  <div className="w-full ios-frosted-glass rounded-2xl p-4 flex flex-col items-center border border-white/60 mt-2 select-none shrink-0">
                    <button
                      onClick={generateExcelAndSubmit}
                      className="ios-touchable w-full bg-[#007AFF] text-white font-bold py-4 rounded-xl text-center shadow-lg shadow-blue-500/25"
                    >
                      {currentArchiveId !== null
                        ? "💾 Зберегти зміни"
                        : "✅ Сформувати Excel"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}

        {/* ЕКРАН АРХІВУ */}
        {screen === "archive" && (
          <motion.div
            key="archive-screen"
            className="w-full max-w-md px-5 py-6 flex flex-col h-full justify-between relative z-10"
          >
            <div className="flex justify-center select-none pt-4 mb-5">
              <h3 className="font-bold text-[#1C1C1E] text-base text-center">
                {archiveMode === "email"
                  ? "📧 Виберіть табель для відправки"
                  : "🗂 Архів згенерованих табелів"}
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
                        sendTabelToEmailAddress(
                          item.id,
                          item.period_text,
                          item.year
                        );
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
                        <h4 className="font-semibold text-[#1C1C1E] text-sm">
                          {item.period_text} {item.year}
                        </h4>
                        <p className="text-[10px] text-gray-500 mt-0.5">
                          Заповнено: {item.date_filled || "Не вказано"}
                        </p>
                      </div>
                    </div>
                    <div className="text-right flex flex-col items-end">
                      <span className="text-[9px] text-gray-400">
                        {formatLocalDate(item.created_at)}
                      </span>
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
                  <p className="text-sm font-semibold text-gray-600">
                    {archiveMessage}
                  </p>
                  <p className="text-xs text-gray-400 max-w-[200px] mt-2">
                    Оцифруйте перший табель, щоб він з&apos;явився тут!
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {globalLoading && <TrainLoader loadingText={globalLoadingText} />}
      </AnimatePresence>

      <EditCellModal
        editingCell={editingCell}
        onChange={(value) =>
          setEditingCell((prev) => (prev ? { ...prev, value } : null))
        }
        onCancel={() => setEditingCell(null)}
        onSave={handleSaveEditingCell}
      />
    </div>
  );
}
