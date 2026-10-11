import Link from "next/link";
import { IconArrow, IconChart, IconClock, IconDatabase, IconLoop } from "./icons";

const STEPS = [
  { title: "Past", sub: "Learn from history", href: "/history", c: "bg-pastel-blue", Icon: IconDatabase },
  { title: "Present", sub: "Analyse & predict", href: "/matches", c: "bg-pastel-green", Icon: IconChart },
  { title: "Future", sub: "Score the result", href: "/history", c: "bg-pastel-yellow", Icon: IconClock },
  { title: "Learn", sub: "Tested improvements", href: "/learning", c: "bg-pastel-pink", Icon: IconLoop },
];

export function LoopRibbon({ className = "" }: { className?: string }) {
  return (
    <nav aria-label="Past, present, future learning loop" className={`grid grid-cols-2 gap-3 md:grid-cols-4 ${className}`}>
      {STEPS.map((s, i) => (
        <Link key={s.title} href={s.href} className={`group relative flex items-center gap-3 rounded-2xl ${s.c} p-4 hover:-translate-y-0.5`}>
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/70">
            <s.Icon />
          </span>
          <span>
            <span className="block font-semibold">{s.title}</span>
            <span className="block text-xs text-muted">{s.sub}</span>
          </span>
          {i < STEPS.length - 1 && <IconArrow className="absolute -right-3 top-1/2 hidden -translate-y-1/2 text-muted md:block" size={16} />}
        </Link>
      ))}
    </nav>
  );
}
