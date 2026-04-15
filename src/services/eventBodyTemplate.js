/**
 * Standard Outlook event body template appended to all events
 * created from the O&M schedule app.
 */
const WORK_REPORT_TEMPLATE = `窓口：

■■作業後に代表１名が下記を記載してください■■
・移動時間：【　　：　　】（往復）
・作業時間：【　　：　　〜　　　：　　】
・作業者名（全員）：
・作業内容：
・残タスクor申し送り事項：`;

/**
 * Build the full Outlook event body by combining existing memo/content
 * with the standard work-report template.
 * @param {string} [memo] - Optional existing memo/content (from SF or manual input)
 * @returns {string} Body text with the template appended
 */
export function buildEventBody(memo) {
  const trimmed = (memo || '').trim();
  if (!trimmed) return WORK_REPORT_TEMPLATE;
  return `${trimmed}\n\n---\n\n${WORK_REPORT_TEMPLATE}`;
}
