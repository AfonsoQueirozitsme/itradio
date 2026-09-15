export default function Logo({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex items-center gap-3 font-[family-name:var(--font-logo)] font-semibold text-white sm:gap-4 ${className}`}
    >
      <span className="text-6xl leading-none tracking-tight sm:text-8xl">
        Radio
      </span>
      <span className="flex aspect-square items-center justify-center rounded-full bg-white px-5 text-5xl leading-none text-brand sm:text-7xl">
        IT
      </span>
    </div>
  );
}
