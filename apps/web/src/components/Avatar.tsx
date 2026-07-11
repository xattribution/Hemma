import type { Member } from "@coord/shared";

export function Avatar({ member, size = "md" }: { member: Pick<Member, "avatar" | "color" | "name">; size?: "sm" | "md" | "lg" | "xl" }) {
  const px = { sm: "h-7 w-7 text-sm", md: "h-10 w-10 text-xl", lg: "h-14 w-14 text-3xl", xl: "h-20 w-20 text-4xl" }[size];
  return (
    <span
      className={`inline-flex ${px} shrink-0 items-center justify-center rounded-full border-[3px] bg-card shadow-card`}
      style={{ borderColor: member.color }}
      title={member.name}
    >
      {member.avatar}
    </span>
  );
}

export function MemberChip({ member, active, onClick }: { member: Member; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border-2 px-2.5 py-1 text-sm font-bold transition ${
        active ? "text-white" : "bg-card text-ink hover:opacity-80"
      }`}
      style={{ borderColor: member.color, backgroundColor: active ? member.color : undefined }}
    >
      <span>{member.avatar}</span>
      {member.name}
    </button>
  );
}
