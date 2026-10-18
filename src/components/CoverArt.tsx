import { useId } from "react";
import { coverSvg } from "../lib/cover";

/** A song's cover, drawn from its id and style (see lib/cover.ts). */
export default function CoverArt({
  id,
  style,
  size = "md",
}: {
  id: string;
  style: string;
  size?: "sm" | "md" | "lg";
}) {
  const key = useId();
  return (
    <span
      className={`cover cover-${size}`}
      aria-hidden="true"
      // Markup built only from numbers derived from the id and style; see coverSvg.
      dangerouslySetInnerHTML={{ __html: coverSvg(id, style, key) }}
    />
  );
}
