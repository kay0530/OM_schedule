import { MEMBERS } from '../../data/members';

/**
 * Modal that displays event details when clicking an event in the calendar.
 *
 * @param {{ isOpen: boolean, onClose: () => void, event: object|null, onDelete?: (id: string) => void }}
 */
export default function EventDetailModal({ isOpen, onClose, event, onDelete }) {
  if (!isOpen || !event) return null;

  // Determine event source and properties
  const isAssignment = !!event.opportunityName;
  const isOutlookEvent = !!event.isOutlookSynced || !!event.outlookEventId || (!isAssignment && !event.statusType);
  const isManualAssignment = isAssignment && !event.isOutlookSynced;

  // Find member info
  const member = MEMBERS.find(
    (m) => m.id === event.memberId || m.email === event.memberEmail
  );

  // Time display
  const startTime = event.startTime || event.start?.substring(11, 16);
  const endTime = event.endTime || event.end?.substring(11, 16);
  const eventDate = event.date || event.start?.substring(0, 10);

  // Source label
  let sourceLabel, sourceBadgeClass;
  if (isOutlookEvent && !isAssignment) {
    sourceLabel = 'Outlook';
    sourceBadgeClass = 'bg-blue-50 text-blue-700';
  } else if (isAssignment) {
    sourceLabel = '手動割当';
    sourceBadgeClass = 'bg-emerald-50 text-emerald-700';
  } else {
    sourceLabel = 'ステータス';
    sourceBadgeClass = 'bg-gray-100 text-gray-600';
  }

  function handleDelete() {
    if (onDelete && event.id) {
      onDelete(event.id);
      onClose();
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header with colored top bar */}
          <div
            className="h-2"
            style={{ backgroundColor: member?.color || '#6B7280' }}
          />

          <div className="px-6 py-4">
            {/* Title & close */}
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-800 leading-tight pr-4">
                {event.opportunityName || event.title || event.statusLabel || 'イベント詳細'}
              </h2>
              <button
                onClick={onClose}
                className="p-1 rounded-lg hover:bg-gray-100 transition flex-shrink-0"
              >
                <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Detail rows */}
            <div className="space-y-3">
              {/* Date & time */}
              {eventDate && (
                <DetailRow
                  icon={
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  }
                  label="日時"
                >
                  <span className="text-sm text-gray-800">
                    {eventDate}
                    {startTime && endTime && (
                      <span className="text-gray-500 ml-2">{startTime} - {endTime}</span>
                    )}
                  </span>
                </DetailRow>
              )}

              {/* Member */}
              {member && (
                <DetailRow
                  icon={
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  }
                  label="担当者"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: member.color }}
                    />
                    <span className="text-sm text-gray-800">{member.nameJa}</span>
                    <span className="text-xs text-gray-400">{member.email}</span>
                  </div>
                </DetailRow>
              )}

              {/* Location */}
              {(event.location || event.address) && (
                <DetailRow
                  icon={
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  }
                  label="場所"
                >
                  <span className="text-sm text-gray-800">{event.location || event.address}</span>
                </DetailRow>
              )}

              {/* Source */}
              <DetailRow
                icon={
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                }
                label="ソース"
              >
                <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${sourceBadgeClass}`}>
                  {sourceLabel}
                </span>
              </DetailRow>

              {/* Assignment-specific fields */}
              {isAssignment && (
                <>
                  {event.accountName && (
                    <DetailRow
                      icon={
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      }
                      label="取引先"
                    >
                      <span className="text-sm text-gray-800">{event.accountName}</span>
                    </DetailRow>
                  )}

                  {event.stage && (
                    <DetailRow
                      icon={
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      }
                      label="フェーズ"
                    >
                      <span className="text-sm text-gray-800">{event.stage}</span>
                    </DetailRow>
                  )}

                  {event.scheduleMemo && (
                    <DetailRow
                      icon={
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      }
                      label="メモ"
                    >
                      <span className="text-sm text-gray-800">{event.scheduleMemo}</span>
                    </DetailRow>
                  )}
                </>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
              >
                閉じる
              </button>
              {isManualAssignment && onDelete && (
                <button
                  onClick={handleDelete}
                  className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-700 rounded-lg transition font-medium"
                >
                  削除
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Reusable detail row with icon.
 */
function DetailRow({ icon, label, children }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 bg-gray-50 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {icon}
        </svg>
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 mb-0.5">{label}</p>
        {children}
      </div>
    </div>
  );
}
