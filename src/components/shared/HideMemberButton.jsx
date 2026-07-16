/**
 * Small ✕ button shown on member-header hover — Outlook-style "hide this
 * calendar". Hides the member's column via settings.hiddenMemberIds;
 * re-showing is done from the メンバー filter popover.
 * Parent element must have `relative group` classes.
 *
 * @param {{ member: object, onHide: (member) => void, size?: 'md'|'sm' }}
 */
export default function HideMemberButton({ member, onHide, size = 'md' }) {
  const sm = size === 'sm';
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onHide(member); }}
      className={`absolute top-1/2 -translate-y-1/2 hidden group-hover:flex items-center justify-center rounded hover:bg-black/25 ${
        sm ? 'right-0 w-3.5 h-3.5' : 'right-1 w-4 h-4'
      }`}
      title={`${member.nameJa}を非表示（再表示は「メンバー」フィルター）`}
    >
      <svg className={sm ? 'w-2.5 h-2.5' : 'w-3 h-3'} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}
