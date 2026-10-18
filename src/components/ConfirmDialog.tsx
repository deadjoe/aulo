import Dialog from "./Dialog";

/** Ask before anything is deleted. The safe choice is the default. */
export default function ConfirmDialog({
  title,
  body,
  confirm,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirm: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog onClose={onClose}>
      <div className="confirm">
        <h2 id="modal-title">{title}</h2>
        <p>{body}</p>
        <div className="dialog-actions">
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="danger-button"
            onClick={() => {
              onClose();
              onConfirm();
            }}
          >
            {confirm}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
