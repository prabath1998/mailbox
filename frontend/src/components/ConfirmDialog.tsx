import { Dialog } from "./Dialog";

interface Props {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel }: Props) {
  return (
    <Dialog title={title} onClose={onCancel}>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{body}</p>
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onCancel} className="btn-outline">
          Cancel
        </button>
        <button onClick={onConfirm} autoFocus className="btn-danger">
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
