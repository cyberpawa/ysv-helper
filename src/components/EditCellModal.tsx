import React from "react";
import { EditingCellState } from "../types/timesheet";

interface EditCellModalProps {
  editingCell: EditingCellState | null;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}

export const EditCellModal: React.FC<EditCellModalProps> = ({
  editingCell,
  onChange,
  onCancel,
  onSave,
}) => {
  if (!editingCell) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[100] p-4 select-none">
      <div className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-2xl border border-gray-100 flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-150">
        <div>
          <h4 className="font-bold text-[#1C1C1E] text-base">
            {editingCell.title}
          </h4>
          <p className="text-xs text-gray-400 mt-1">Введіть нове значення</p>
        </div>

        <input
          type="text"
          value={editingCell.value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl font-medium text-sm text-[#1C1C1E] focus:outline-none focus:ring-2 focus:ring-[#007AFF] focus:border-transparent transition-all"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onSave();
            } else if (e.key === "Escape") {
              onCancel();
            }
          }}
        />

        <div className="flex gap-3 justify-end mt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl border border-neutral-200 hover:bg-neutral-50 text-[#1C1C1E] font-semibold text-sm transition-colors ios-touchable"
          >
            Скасувати
          </button>
          <button
            onClick={onSave}
            className="px-5 py-2.5 rounded-xl bg-[#007AFF] text-white hover:bg-blue-600 font-bold text-sm transition-colors shadow-md shadow-blue-500/10 ios-touchable"
          >
            Зберегти
          </button>
        </div>
      </div>
    </div>
  );
};
