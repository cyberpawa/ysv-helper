export type TimesheetTemplateId =
  | "auto"
  | "original"
  | "form_p5"
  | "form_p5_extended";

export interface TemplateROICrop {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TimesheetTemplateOption {
  id: TimesheetTemplateId;
  label: string;
}

export interface DocumentMeta {
  period_text?: string;
  year?: string;
  date_filled?: string;
  period_start?: string;
  period_end?: string;
  period_type?: string;
  template_type?: string;
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

export interface EditingCellState {
  empIndex: number;
  day?: string;
  type?:
    | "hours"
    | "code"
    | "totals_days"
    | "totals_hours"
    | "meta"
    | "absence_total"
    | "absence_reason";
  metaField?: keyof DocumentMeta;
  colIndex?: number;
  title: string;
  value: string;
}
