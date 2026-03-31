import { STATUS_TYPES } from '../../data/statusTypes';

/**
 * Full-column overlay for days when a member has a status (不可/休み/移動).
 * Renders a semi-transparent background spanning the entire day column
 * with the status label centered.
 *
 * @param {{ statusType: string, totalHeight: number }}
 */
export default function StatusOverlay({ statusType, totalHeight }) {
  const status = STATUS_TYPES.find((s) => s.id === statusType);
  if (!status) return null;

  return (
    <div
      className="absolute inset-x-0 top-0 z-5 flex items-center justify-center pointer-events-none"
      style={{
        height: `${totalHeight}px`,
        backgroundColor: `${status.color}15`,
      }}
    >
      {/* Diagonal hatching pattern */}
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage: `repeating-linear-gradient(
            45deg,
            ${status.color},
            ${status.color} 1px,
            transparent 1px,
            transparent 8px
          )`,
        }}
      />
      {/* Status label badge */}
      <span
        className="relative text-sm font-bold px-3 py-1.5 rounded-lg border"
        style={{
          color: status.color,
          backgroundColor: `${status.bgColor}CC`,
          borderColor: `${status.color}40`,
        }}
      >
        {status.labelJa}
      </span>
    </div>
  );
}
