/* Vertical section label (直排眉题) with a leading gold tick — the landing's
   recurring structural device, echoing sutra typesetting. Inline-level, so the
   parent's text alignment decides where it sits (left sections flush left,
   centered sections centered). */
export default function SectionEyebrow({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="inline-flex flex-col items-center gap-2">
      <span className="block w-px h-6 bg-gold-border" aria-hidden />
      <span className="eyebrow-v">{children}</span>
    </div>
  );
}
