# Construction Schedule (工事スケジュール管理)

## Project Overview
Excel ベースの施工スケジュール管理を置き換える React SPA。施工メンバーの予定を週次・月次カレンダーで可視化し、Salesforce 商談と Outlook 予定表を統合する。

## Tech Stack
- **Runtime**: React 19.2 + Vite 7.3.1
- **Styling**: Tailwind CSS 4.2 (via `@tailwindcss/vite`)
- **Auth**: MSAL Browser 5.3 + MSAL React 5.0 (Azure AD SPA)
- **Package Manager**: npm
- **Language**: JavaScript (JSX)

## Dev Server
```bash
npm run dev     # http://localhost:5191
npm run build   # dist/ に出力
npm run sync-sf # Salesforce 商談データ同期
```

## File Structure
```
src/
├── main.jsx                    # Entry point
├── App.jsx                     # Root component, view routing
├── index.css                   # Tailwind imports
├── context/
│   ├── AppContext.jsx          # Assignments + settings (localStorage)
│   ├── AuthContext.jsx         # MSAL auth state
│   └── CalendarContext.jsx     # Outlook calendar events
├── services/
│   ├── msalService.js          # MSAL instance factory, login/logout, config persistence
│   ├── graphCalendarService.js # Microsoft Graph API calendar calls
│   └── calendarService.js      # Calendar data transformation
├── hooks/
│   └── useCalendarSync.js      # Outlook sync hook
├── data/
│   ├── members.js              # 10 construction team members
│   ├── statusTypes.js          # Status types (不可, 休み, 移動, 現場)
│   ├── opportunities.json      # Synced Salesforce opportunities (レンタル)
│   └── maintenances.json       # Synced Salesforce maintenance records (点検／修繕)
├── utils/
│   └── dateUtils.js            # Date/time helpers
├── components/
│   ├── layout/
│   │   ├── MainLayout.jsx      # App shell (header + sidebar + content)
│   │   ├── Header.jsx          # Top bar with navigation and date controls
│   │   └── Sidebar.jsx         # Left panel (member list)
│   ├── schedule/
│   │   ├── MonthlyView.jsx     # Month calendar grid
│   │   ├── WeeklyView.jsx      # Week calendar with time grid
│   │   ├── EventBlock.jsx      # Single event rendered on time grid
│   │   ├── EventDetailModal.jsx # Event detail popup on click
│   │   ├── AssignModal.jsx     # Assign opportunity to member(s)
│   │   └── StatusOverlay.jsx   # Status overlay on calendar cells
│   ├── jobs/
│   │   ├── JobPanel.jsx        # Job list sidebar (tabs: レンタル商談 / 点検修繕)
│   │   └── JobCard.jsx         # Single job card (opportunity or maintenance)
│   ├── settings/
│   │   └── SettingsView.jsx    # Settings (Azure AD, working hours, SF sync, data mgmt)
│   └── shared/
│       └── Toast.jsx           # Toast notifications
scripts/
└── sync-sf.mjs                 # Salesforce CLI sync script
```

## Data Sources
1. **Salesforce (レンタル商談)** -- `Opportunity` の `ConstractType__c = 'レンタル'` を `sf data query` で取得し `src/data/opportunities.json` に保存 (586件)。
2. **Salesforce (点検／修繕)** -- `Maintenance__c` の未完了レコードを取得し `src/data/maintenances.json` に保存 (565件)。
3. **Outlook** -- Microsoft Graph API 経由で各メンバーの予定を取得。Azure AD SPA 認証 (MSAL popup flow)。

### Salesforce SOQL
```sql
-- レンタル商談
SELECT Id, Name, StageName2__c, ConstractType__c, Account.Name,
       LocationAddress__c, KojiSekouyoteibi__c, ...
FROM Opportunity
WHERE ConstractType__c = 'レンタル'
  AND StageName2__c NOT IN ('失注', 'ペンディング', '99_完了')

-- 点検／修繕
SELECT Id, Name, Status__c, Category__c, ScheduledDate__c, ...
FROM Maintenance__c
WHERE Status__c NOT IN ('完了')
```

## Members (10 名)
| ID | 名前 | メール | 色 |
|----|------|--------|-----|
| hiroki_n | 廣木 | norifumi.hiroki@altenergy.co.jp | #3B82F6 |
| yodogawa_t | 淀川 | taichi.yodogawa@altenergy.co.jp | #06B6D4 |
| tano_h | 田野 | hayato.tano@altenergy.co.jp | #10B981 |
| bold_j | BOLD | jigjidsuren.bold@altenergy.co.jp | #F97316 |
| sasanuma_k | 笹沼 | kazuhiro.sasanuma@altenergy.co.jp | #F59E0B |
| yamazaki_k | 山崎 | kaito.yamazaki@altenergy.co.jp | #EC4899 |
| ota_t | 太田 | takahiro.ota@altenergy.co.jp | #EF4444 |
| wano_t | 和埜 | tatsuto.wano@altenergy.co.jp | #8B5CF6 |
| seto_r | 瀬戸 | ryota.seto@altenergy.co.jp | #14B8A6 |
| tago_s | 田子 (資材準備) | shoichiro.tago@altenergy.co.jp | #A855F7 |

## State Management
- **AppContext** -- `useReducer` で割り当て (assignments) と設定 (settings) を管理。localStorage に自動永続化。
  - Actions: `ADD_ASSIGNMENT`, `UPDATE_ASSIGNMENT`, `DELETE_ASSIGNMENT`, `UPDATE_SETTINGS`
- **CalendarContext** -- Outlook から取得したカレンダーイベントを管理。`setEvents`, `mergeEvents`, `clearEvents` 等。
- **AuthContext** -- MSAL 認証状態。`login`, `logout`, `getToken`。

## Azure AD Config
- Default Client ID: `85420e2f-eb38-4a8e-931f-4be552f953b0`
- Default Tenant ID: `61b80e23-6dd9-4dc6-b355-d7f210b12ef5`
- Scopes: `Calendars.ReadWrite`, `Calendars.ReadWrite.Shared`, `User.Read`
- Config は localStorage に保存され、Settings 画面から変更可能

## Salesforce Sync
```bash
# 認証済みユーザー: new_keisuke.tanaka@altenergy.co.jp
npm run sync-sf
# → scripts/sync-sf.mjs が sf CLI でクエリ → src/data/opportunities.json に出力
```

## Conventions
- UI テキストは日本語、コード内コメント・変数名は英語
- Tailwind CSS でスタイリング (CSS ファイルは index.css のみ)
- コンポーネントは default export
- Conventional Commit 形式 (feat:, fix:, refactor:)
