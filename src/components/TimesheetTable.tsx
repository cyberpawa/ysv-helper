import React from "react";
import { resolveAbsenceColumn } from "../config/templates";
import { AbsenceReason, DocumentMeta, TimesheetData } from "../types/timesheet";

interface TimesheetTableProps {
  data: TimesheetData;
  isReadOnly: boolean;
  onToggleYellow: (day: string) => void;
  onEditMeta: (field: keyof DocumentMeta, currentValue: string) => void;
  onEditCell: (
    empIndex: number,
    day: string,
    type: "hours" | "code",
    currentValue: string
  ) => void;
  onEditTotals: (
    empIndex: number,
    type: "days" | "hours",
    currentValue: string
  ) => void;
  onEditAbsenceTotal: (empIndex: number) => void;
  onEditAbsenceReason: (
    empIndex: number,
    colIndex: number,
    currentValue: string
  ) => void;
}

const ABSENCE_HEADERS = [
  "відпустки",
  "навчання",
  "без збереження",
  "неповний день",
  "простої",
  "прогули",
  "страйки",
  "тимчасова непрацездатність",
  "інші",
];

const HOURS_SUBHEADERS = [
  "усього",
  "надурочних",
  "нічних",
  "вечірніх",
  "вихідних",
  "дистанційно",
  "відрядження",
];

const verticalTextStyle: React.CSSProperties = {
  writingMode: "vertical-rl",
  transform: "rotate(180deg)",
};

export const TimesheetTable: React.FC<TimesheetTableProps> = ({
  data,
  isReadOnly,
  onToggleYellow,
  onEditMeta,
  onEditCell,
  onEditTotals,
  onEditAbsenceTotal,
  onEditAbsenceReason,
}) => {
  const meta = data.document_meta || {};
  const crossed = meta.crossed_out_headers || [];
  const employees = data.employees || [];
  const cursorStyle = isReadOnly ? "default" : "pointer";

  const daysFirstHalf = Array.from({ length: 15 }, (_, i) =>
    (i + 1).toString().padStart(2, "0")
  );
  const daysSecondHalf = Array.from({ length: 16 }, (_, i) =>
    (i + 16).toString()
  );

  return (
    <div style={{ fontFamily: "'Times New Roman', serif", color: "black" }}>
      <div
        style={{
          textAlign: "left",
          marginBottom: "10px",
          fontSize: "13px",
        }}
      >
        <div style={{ textAlign: "right", fontStyle: "italic" }}>
          Затверджено Порядком обліку використання робочого часу...
        </div>
        <div style={{ fontWeight: "bold", marginTop: "5px" }}>
          АТ &quot;XXX&quot;, регіональна філія...
        </div>
        <div>
          Ідентифікаційний код ЄДРПОУ: <b>XXX</b>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginBottom: "15px",
        }}
      >
        <div style={{ flexGrow: 1, textAlign: "center" }}>
          <h2
            style={{
              margin: 0,
              fontSize: "18px",
              fontWeight: "bold",
              color: "black",
            }}
          >
            Табель обліку робочого часу за{" "}
            <u
              style={{ cursor: cursorStyle }}
              onClick={() =>
                onEditMeta("period_text", meta.period_text || "")
              }
            >
              {meta.period_text || "___________"}
            </u>{" "}
            <u
              style={{ cursor: cursorStyle }}
              onClick={() => onEditMeta("year", meta.year || "2026")}
            >
              {meta.year || "2026"}
            </u>{" "}
            року
          </h2>
        </div>

        <table
          style={{
            borderCollapse: "collapse",
            textAlign: "center",
            fontSize: "11px",
            border: "2px solid black",
            color: "black",
            marginLeft: "20px",
          }}
        >
          <tbody>
            <tr>
              <td
                rowSpan={2}
                style={{
                  border: "1px solid black",
                  padding: "3px 8px",
                  fontWeight: "bold",
                }}
              >
                Дата заповнення
              </td>
              <td
                colSpan={2}
                style={{
                  border: "1px solid black",
                  padding: "3px 8px",
                  fontWeight: "bold",
                }}
              >
                Звітний період
              </td>
            </tr>
            <tr>
              <td
                style={{
                  border: "1px solid black",
                  padding: "3px 8px",
                  fontWeight: "bold",
                }}
              >
                з
              </td>
              <td
                style={{
                  border: "1px solid black",
                  padding: "3px 8px",
                  fontWeight: "bold",
                }}
              >
                по
              </td>
            </tr>
            <tr>
              <td
                style={{
                  border: "1px solid black",
                  padding: "5px",
                  cursor: cursorStyle,
                }}
                onClick={() =>
                  onEditMeta("date_filled", meta.date_filled || "")
                }
              >
                {meta.date_filled || "__.__.____"}
              </td>
              <td
                style={{
                  border: "1px solid black",
                  padding: "5px",
                  cursor: cursorStyle,
                }}
                onClick={() =>
                  onEditMeta("period_start", meta.period_start || "")
                }
              >
                {meta.period_start || "__.__"}
              </td>
              <td
                style={{
                  border: "1px solid black",
                  padding: "5px",
                  cursor: cursorStyle,
                }}
                onClick={() =>
                  onEditMeta("period_end", meta.period_end || "")
                }
              >
                {meta.period_end || "__.__"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <table
        style={{
          borderCollapse: "collapse",
          textAlign: "center",
          fontSize: "11px",
          border: "2px solid black",
          background: "white",
          color: "black",
        }}
      >
        <thead>
          <tr style={{ fontWeight: "bold", background: "#fafafa" }}>
            <td
              rowSpan={3}
              style={{
                border: "1px solid black",
                padding: "5px",
                width: "35px",
                ...verticalTextStyle,
              }}
            >
              № п/п
            </td>
            <td
              colSpan={16}
              style={{ border: "1px solid black", padding: "5px" }}
            >
              Відмітки про явки та неявки за числами місяця
            </td>
            <td
              colSpan={8}
              style={{ border: "1px solid black", padding: "5px" }}
            >
              Відпрацьовано
            </td>
            <td
              colSpan={10}
              style={{ border: "1px solid black", padding: "5px" }}
            >
              Неявки з причин
            </td>
          </tr>

          <tr style={{ fontWeight: "bold", background: "#fafafa" }}>
            {daysFirstHalf.map((d) => (
              <td
                key={d}
                onClick={() => onToggleYellow(d)}
                style={{
                  border: "1px solid black",
                  width: "30px",
                  height: "105px",
                  verticalAlign: "middle",
                  cursor: cursorStyle,
                  background: crossed.includes(d) ? "#ffff00" : undefined,
                }}
              >
                {d}
              </td>
            ))}
            <td
              onClick={() => onToggleYellow("X")}
              style={{
                border: "1px solid black",
                width: "30px",
                height: "105px",
                verticalAlign: "middle",
                cursor: cursorStyle,
                background: crossed.includes("X") ? "#ffff00" : undefined,
              }}
            >
              X
            </td>
            <td
              rowSpan={2}
              style={{
                border: "1px solid black",
                padding: "5px",
                ...verticalTextStyle,
              }}
            >
              днів
            </td>
            <td
              colSpan={7}
              style={{ border: "1px solid black", padding: "5px" }}
            >
              годин
            </td>
            <td
              rowSpan={2}
              style={{
                border: "1px solid black",
                padding: "5px",
                ...verticalTextStyle,
              }}
            >
              Всього неявок
            </td>
            {ABSENCE_HEADERS.map((label) => (
              <td
                key={label}
                rowSpan={2}
                style={{
                  border: "1px solid black",
                  fontSize: "8px",
                  padding: "5px",
                  ...verticalTextStyle,
                }}
              >
                {label}
              </td>
            ))}
          </tr>

          <tr style={{ fontWeight: "bold", background: "#fafafa" }}>
            {daysSecondHalf.map((d) => (
              <td
                key={d}
                onClick={() => onToggleYellow(d)}
                style={{
                  border: "1px solid black",
                  width: "30px",
                  height: "35px",
                  verticalAlign: "middle",
                  cursor: cursorStyle,
                  background: crossed.includes(d) ? "#ffff00" : undefined,
                }}
              >
                {d}
              </td>
            ))}
            {HOURS_SUBHEADERS.map((label) => (
              <td
                key={label}
                style={{
                  border: "1px solid black",
                  fontSize: "9px",
                  padding: "4px",
                  ...verticalTextStyle,
                }}
              >
                {label}
              </td>
            ))}
          </tr>
        </thead>

        <tbody>
          {employees.map((emp, index) => {
            const days = emp.days || {};
            const totals = emp.totals || { days: "-", hours: "-" };
            const totalAbsDays = emp.absences?.total_days || "-";
            const totalAbsHours = emp.absences?.total_hours || "-";
            const tdStr = totalAbsDays === "-" ? "" : totalAbsDays;
            const thStr = totalAbsHours === "-" ? "" : totalAbsHours;

            const reasonCols: { [col: number]: AbsenceReason | null } = {};
            for (let c = 31; c <= 39; c++) reasonCols[c] = null;
            if (emp.absences?.reasons) {
              emp.absences.reasons.forEach((r) => {
                const targetCol = resolveAbsenceColumn(r.code || "");
                reasonCols[targetCol] = r;
              });
            }

            return (
              <React.Fragment key={emp.row_id ?? index}>
                <tr>
                  <td
                    rowSpan={4}
                    style={{
                      border: "1px solid black",
                      fontWeight: "bold",
                      fontSize: "14px",
                      background: "#fff",
                    }}
                  >
                    {index + 1}
                  </td>
                  {daysFirstHalf.map((d) => {
                    const val = days[d] ? days[d].hours : "-";
                    return (
                      <td
                        key={`h1-${d}`}
                        onClick={() => onEditCell(index, d, "hours", val)}
                        style={{
                          border: "1px solid black",
                          height: "22px",
                          cursor: cursorStyle,
                          fontWeight: "bold",
                        }}
                      >
                        {val}
                      </td>
                    );
                  })}
                  <td
                    style={{
                      border: "1px solid black",
                      background: "#fff",
                    }}
                  >
                    -
                  </td>
                  <td
                    rowSpan={4}
                    onClick={() =>
                      onEditTotals(index, "days", totals.days || "-")
                    }
                    style={{
                      border: "1px solid black",
                      fontWeight: "bold",
                      cursor: cursorStyle,
                    }}
                  >
                    {totals.days || "-"}
                  </td>
                  <td
                    rowSpan={4}
                    onClick={() =>
                      onEditTotals(index, "hours", totals.hours || "-")
                    }
                    style={{
                      border: "1px solid black",
                      fontWeight: "bold",
                      cursor: cursorStyle,
                    }}
                  >
                    {totals.hours || "-"}
                  </td>
                  {[24, 25, 26, 27, 28, 29].map((k) => (
                    <td
                      key={k}
                      rowSpan={4}
                      style={{
                        border: "1px solid black",
                        background: "#fff",
                      }}
                    />
                  ))}
                  <td
                    rowSpan={4}
                    onClick={() => onEditAbsenceTotal(index)}
                    style={{
                      border: "1px solid black",
                      cursor: cursorStyle,
                      verticalAlign: "top",
                    }}
                  >
                    {(tdStr || thStr) && (
                      <>
                        <div
                          style={{
                            fontWeight: "bold",
                            borderBottom: "1px dashed #ccc",
                          }}
                        >
                          {tdStr}
                        </div>
                        <div>{thStr}</div>
                      </>
                    )}
                  </td>
                  {[31, 32, 33, 34, 35, 36, 37, 38, 39].map((k) => {
                    const r = reasonCols[k];
                    if (r) {
                      const rd = r.days === "-" ? "" : r.days;
                      const rh = r.hours === "-" ? "" : r.hours;
                      const currentVal = `${r.code || ""} ${rd} ${rh}`
                        .replace(/\s+/g, " ")
                        .trim();
                      return (
                        <td
                          key={k}
                          rowSpan={4}
                          onClick={() =>
                            onEditAbsenceReason(index, k, currentVal)
                          }
                          style={{
                            border: "1px solid black",
                            cursor: cursorStyle,
                            fontSize: "10px",
                            verticalAlign: "top",
                          }}
                        >
                          <div style={{ fontWeight: "bold" }}>{r.code}</div>
                          <div>
                            {rd}/{rh}
                          </div>
                        </td>
                      );
                    }
                    return (
                      <td
                        key={k}
                        rowSpan={4}
                        onClick={() => onEditAbsenceReason(index, k, "")}
                        style={{
                          border: "1px solid black",
                          cursor: cursorStyle,
                        }}
                      />
                    );
                  })}
                </tr>

                <tr>
                  {daysFirstHalf.map((d) => {
                    const val = days[d] ? days[d].code : "-";
                    return (
                      <td
                        key={`c1-${d}`}
                        onClick={() => onEditCell(index, d, "code", val)}
                        style={{
                          border: "1px solid black",
                          height: "22px",
                          cursor: cursorStyle,
                          fontSize: "11px",
                        }}
                      >
                        {val}
                      </td>
                    );
                  })}
                  <td
                    style={{
                      border: "1px solid black",
                      background: "#fff",
                    }}
                  >
                    -
                  </td>
                </tr>

                <tr>
                  {daysSecondHalf.map((d) => {
                    const val = days[d] ? days[d].hours : "-";
                    return (
                      <td
                        key={`h2-${d}`}
                        onClick={() => onEditCell(index, d, "hours", val)}
                        style={{
                          border: "1px solid black",
                          height: "22px",
                          cursor: cursorStyle,
                          fontWeight: "bold",
                        }}
                      >
                        {val}
                      </td>
                    );
                  })}
                </tr>

                <tr>
                  {daysSecondHalf.map((d) => {
                    const val = days[d] ? days[d].code : "-";
                    return (
                      <td
                        key={`c2-${d}`}
                        onClick={() => onEditCell(index, d, "code", val)}
                        style={{
                          border: "1px solid black",
                          height: "22px",
                          cursor: cursorStyle,
                          fontSize: "11px",
                        }}
                      >
                        {val}
                      </td>
                    );
                  })}
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
