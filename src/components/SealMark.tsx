/* 心灵法门 reading seal — the site's brand mark. Characters are placed in
   visual grid order (TL TR BL BR) so the seal reads top-right first
   (心 → 灵 → 法 → 门), as a traditional 2×2 seal does. */
export default function SealMark({
  size = 40,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  const charSize = Math.round(size * 0.38);
  return (
    <span
      aria-hidden
      className={`seal-grid shrink-0 ${className}`}
      style={{ width: size, height: size, fontSize: charSize }}
    >
      <span>法</span>
      <span>心</span>
      <span>门</span>
      <span>灵</span>
    </span>
  );
}
