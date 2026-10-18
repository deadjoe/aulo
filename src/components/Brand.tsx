export function Mark({ large = false }: { large?: boolean }) {
  return (
    <span className={`mark ${large ? "mark-large" : ""}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
export function Brand() {
  return (
    <span className="brand">
      <Mark />
      aulo<span className="brand-dot">.</span>
    </span>
  );
}
