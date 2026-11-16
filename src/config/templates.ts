import {
  TemplateROICrop,
  TimesheetTemplateId,
  TimesheetTemplateOption,
} from "../types/timesheet";

export const TEMPLATE_OPTIONS: TimesheetTemplateOption[] = [
  { id: "auto", label: "Авто" },
  { id: "original", label: "Оригінал" },
  { id: "form_p5", label: "П-5" },
  { id: "form_p5_extended", label: "П-5 extended" },
];

export const STATIC_TEMPLATE_CROPS: Record<
  Exclude<TimesheetTemplateId, "auto">,
  TemplateROICrop
> = {
  original: { left: 0, top: 0, width: 1.0, height: 1.0 },
  form_p5: { left: 0.15, top: 0.15, width: 0.85, height: 0.70 },
  form_p5_extended: { left: 0.10, top: 0.10, width: 0.90, height: 0.80 },
};

const ABSENCE_COLUMN_MAP: Array<{ col: number; codes: string[] }> = [
  { col: 31, codes: ["В", "Щ", "Д", "8", "9", "10"] },
  { col: 32, codes: ["Н", "ВЧ", "11", "12", "13", "14", "15", "17", "22"] },
  { col: 33, codes: ["НА", "БЗ", "18", "19"] },
  { col: 34, codes: ["НД", "20"] },
  { col: 35, codes: ["П", "23"] },
  { col: 36, codes: ["ПР", "24"] },
  { col: 37, codes: ["С", "25"] },
  { col: 38, codes: ["ТН", "Л", "26", "27"] },
];

export const getCodesForCol = (col: number): string[] => {
  const entry = ABSENCE_COLUMN_MAP.find((item) => item.col === col);
  return entry ? entry.codes : [];
};

export const resolveAbsenceColumn = (code: string): number => {
  const normalized = code.trim().toUpperCase();
  const entry = ABSENCE_COLUMN_MAP.find((item) =>
    item.codes.includes(normalized)
  );
  return entry ? entry.col : 39;
};
