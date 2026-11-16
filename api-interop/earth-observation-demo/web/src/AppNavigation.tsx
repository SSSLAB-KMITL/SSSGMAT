import { ArrowUpRight, Globe2, Image, Layers, Satellite } from "lucide-react";

export default function AppNavigation({
  view,
  onNavigate,
}: {
  view: string;
  onNavigate: (view: string) => void;
}) {
  const items = [
    {
      view: "overview",
      label: "ดูภาพดาวเทียม",
      description: "ภาพเรดาร์และเครื่องมือวิเคราะห์",
      icon: Layers,
    },
    {
      view: "sites",
      label: "ภาพรวม 3 พื้นที่",
      description: "เปรียบเทียบทั้ง 3 พื้นที่",
      icon: Globe2,
    },
    {
      view: "geometry",
      label: "โลก 3D",
      description: "ดูตำแหน่งและแนวเล็ง",
      icon: Satellite,
    },
    {
      view: "samples",
      label: "ภาพสีละเอียดสูง",
      description: "ดูภาพสีและตรวจจับวัตถุ",
      icon: Image,
    },
  ];
  return (
    <nav className="workspace-nav" aria-label="Primary navigation">
      {items.map((item) => {
        const active =
          item.view === "overview"
            ? !["sites", "geometry", "samples"].includes(view)
            : view === item.view;
        const Icon = item.icon;
        return (
          <button
            key={item.view}
            aria-label={item.label}
            aria-pressed={active}
            className={`workspace-nav-item ${item.view === "samples" ? "highres-nav primary" : ""} ${active ? "active" : ""}`}
            onClick={() => onNavigate(item.view)}
          >
            <span className="nav-icon">
              <Icon size={21} aria-hidden="true" />
            </span>
            <span className="nav-copy">
              <strong>{item.label}</strong>
              <small>{item.description}</small>
            </span>
            {item.view === "samples" && (
              <ArrowUpRight
                size={18}
                className="nav-arrow"
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
