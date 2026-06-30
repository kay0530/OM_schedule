/**
 * Parse the standardized "作業報告" (post-work report) that an OM representative
 * fills into a calendar event body.
 *
 * Tolerates the real-world variations seen across members:
 *   - marker written as ■…■ or ■■…■■, and 代表1名 / 代表１名
 *   - full-width ： and half-width : colons
 *   - spaces (incl. full-width 　) inside 【】 brackets
 *   - worker names separated by full-width space / ・ / 、
 *   - "残タスク or 申し送り事項" vs "残タスクor申し送り事項"
 *
 * Returns null when the body has no report template at all. When a template is
 * present but blank (the unfilled boilerplate), `filled` is false.
 */

/** Value after the first ： or : on a line. */
function afterColon(line) {
  const idx = line.search(/[：:]/);
  return idx === -1 ? '' : line.slice(idx + 1);
}

/** Inner of the first 【…】 (spaces stripped), or the whole string if no bracket. */
function bracketInner(s) {
  const m = s.match(/【([^】]*)】/);
  const inner = m ? m[1] : s;
  return inner.replace(/[　\s]/g, '').trim();
}

/** Normalize time-ish values: full-width colon → half-width. */
function normTime(s) {
  return s.replace(/：/g, ':').trim();
}

/** Collapse name separators (space / ・ / 、) to a single 、. */
function normWorkers(s) {
  return s
    .replace(/[　\s・、]+/g, '、')
    .replace(/^、+|、+$/g, '')
    .trim();
}

/**
 * @param {string} bodyText - plain-text event body (request Graph body as text)
 * @returns {null | {filled:boolean, movingTime:string, workTime:string, workers:string, workContent:string, remaining:string, boxUrl:string, contact:string}}
 */
export function parseWorkReport(bodyText) {
  if (!bodyText) return null;
  const text = String(bodyText).replace(/\r\n?/g, '\n');
  const lines = text.split('\n').map((l) => l.trim());

  // Must carry the report marker line to be a report-bearing event.
  const hasMarker = lines.some((l) => /作業後に代表.{0,4}名が下記を記載/.test(l));
  if (!hasMarker) return null;

  const findLine = (re) => lines.find((l) => re.test(l)) || '';

  const movingLine = findLine(/移動時間\s*[：:]/);
  const workTimeLine = findLine(/作業時間\s*[：:]/);
  const workersLine = findLine(/作業者名/);
  const contentLine = findLine(/作業内容\s*[：:]/);
  const remainingLine = findLine(/残タスク/);
  const contactLine = findLine(/(?:先方)?窓口\s*[：:]/);

  const movingTime = movingLine ? normTime(bracketInner(afterColon(movingLine))) : '';
  const workTime = workTimeLine ? normTime(bracketInner(afterColon(workTimeLine))) : '';
  const workers = workersLine ? normWorkers(afterColon(workersLine)) : '';
  const workContent = contentLine ? afterColon(contentLine).trim() : '';
  const remaining = remainingLine ? afterColon(remainingLine).trim() : '';
  const contact = contactLine ? afterColon(contactLine).trim() : '';

  const boxMatch = text.match(/https?:\/\/[^\s]*box\.com\/[^\s）」】]+/);
  const boxUrl = boxMatch ? boxMatch[0] : '';

  // "Filled" = a representative actually entered times/workers, not the blank
  // boilerplate. The empty template has 【　】 (no digits) and no worker names.
  const hasDigit = (s) => /\d/.test(s);
  const filled = hasDigit(movingTime) || hasDigit(workTime) || workers.length > 0;

  return { filled, movingTime, workTime, workers, workContent, remaining, boxUrl, contact };
}
