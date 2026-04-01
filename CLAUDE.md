# Construction Schedule (パワまる工事予定表)

## Project Overview
Excel ベースの「パワまる工事仮組予定表」を置き換える React SPA。施工メンバーの予定を週次・月次カレンダーで可視化し、Salesforce 商談/点検修繕 + Outlook 予定表 + Firestore リアルタイム共有を統合する。

## Deployment
- **GitHub Pages**: https://kay0530.github.io/OM_schedule/
- **Repository**: https://github.com/kay0530/OM_schedule
- GitHub Actions で main push 時に自動デプロイ (`.github/workflows/deploy.yml`)
- Firebase 環境変数は GitHub Secrets に設定済み

## Tech Stack
- **Runtime**: React 19.2 + Vite 7.3.1
- **Styling**: Tailwind CSS 4.2 (via `@tailwindcss/vite`)
- **Auth**: MSAL Browser 5.3 + MSAL React 5.0 (Azure AD SPA)
- **Backend**: Firebase Firestore (リアルタイム共有)
- **Package Manager**: npm
- **Language**: JavaScript (JSX)

## Dev Server
```bash
npm run dev     # http://localhost:5191
npm run build   # dist/ に出力
npm run sync-sf # Salesforce 商談+点検修繕データ同期
```

## File Structure
```
src/
├── main.jsx                    # Entry point
├── App.jsx                     # Root component, view routing (default: weekly)
├── firebase.js                 # Firebase initialization (env-based config)
├── index.css                   # Tailwind imports
├── context/
│   ├── AppContext.jsx          # Assignments + settings (localStorage + Firestore sync)
│   ├── AuthContext.jsx         # MSAL auth state
│   └── CalendarContext.jsx     # Outlook calendar events
├── services/
│   ├── msalService.js          # MSAL instance factory, login/logout, config persistence
│   ├── graphCalendarService.js # Graph API: fetch/create/update/delete calendar events
│   ├── calendarService.js      # Calendar data transformation
│   └── firestoreService.js     # Firestore CRUD: assignments + filter presets (real-time sync)
├── hooks/
│   └── useCalendarSync.js      # Outlook sync hook
├── data/
│   ├── members.js              # 9 construction team members (瀬戸は skipOutlookSync)
│   ├── statusTypes.js          # Status types (不可, 休み, 移動, 現場)
│   ├── opportunities.json      # Synced SF opportunities (レンタル, 586件)
│   └── maintenances.json       # Synced SF maintenance records (点検／修繕, 565件)
├── utils/
│   └── dateUtils.js            # Date/time helpers
├── components/
│   ├── layout/
│   │   ├── MainLayout.jsx      # App shell (header + sidebar + job panel + content)
│   │   ├── Header.jsx          # Top bar: navigation, Outlook同期, MS365ログイン
│   │   └── Sidebar.jsx         # Left nav (月間/週間/設定)
│   ├── schedule/
│   │   ├── MonthlyView.jsx     # Excel風 月間グリッド (メンバーフィルター付き, 全幅)
│   │   ├── WeeklyView.jsx      # Outlook風 週間ビュー (日付軸/人軸切替, 0-24時)
│   │   ├── EventBlock.jsx      # イベントブロック (ドラッグ移動/リサイズ対応)
│   │   ├── EventDetailModal.jsx # イベント詳細/編集モーダル (Outlook反映対応)
│   │   ├── AssignModal.jsx     # SF案件→メンバー割当モーダル (Outlook登録対応)
│   │   ├── QuickAddModal.jsx   # ダブルクリック手動入力モーダル
│   │   └── StatusOverlay.jsx   # 不可/休み/移動オーバーレイ
│   ├── jobs/
│   │   ├── JobPanel.jsx        # 右サイドバー (レンタル商談/点検修繕タブ, フィルター保存)
│   │   └── JobCard.jsx         # 案件カード (ドラッグ対応)
│   ├── settings/
│   │   └── SettingsView.jsx    # Azure AD設定, SF同期, データ管理
│   └── shared/
│       └── Toast.jsx           # Toast notifications
scripts/
└── sync-sf.mjs                 # Salesforce CLI sync (レンタル商談 + 点検修繕)
```

## Key Features

### カレンダービュー
- **週間ビュー** (デフォルト): 0:00〜24:00全時間帯, 8:00に自動スクロール
  - **日付軸**: 曜日が主列、メンバーがサブ列 (localStorage保存)
  - **人軸**: メンバーが主列、曜日がサブ列 (Outlook風)
  - メンバーフィルターチップでオン/オフ切替
  - ビューポート高さに収まり、ヘッダー固定+グリッドスクロール
- **月間ビュー**: メンバー×週のグリッド、全幅使用、メンバーフィルター付き

### 予定の入力方法
1. **案件パネルからドラッグ&ドロップ** → AssignModal (ドラッグ中はEventBlock無効化)
2. **案件パネルでクリック選択** → スロットクリックで配置 (オレンジバナー表示)
3. **スロットをダブルクリック** → QuickAddModal (手動入力)
4. **案件パネルで案件を直接クリック** → AssignModal

### 予定の編集
- イベントクリック → EventDetailModal → 編集モード
- 手動割当: タイトル/日付/時間/担当者を変更、削除
- Outlookイベント: Graph API PATCH/DELETE で反映

### Outlook 連携
- Header の「Outlook同期」ボタンで Graph API 経由で全メンバーのカレンダーを取得
- 割当時「Outlookに登録」→ `/users/{email}/events` で各メンバーのカレンダーに直接作成
- 瀬戸 (Gmail) は `skipOutlookSync: true` で同期対象外

### Firestore リアルタイム共有
- **割当 (assignments)**: `om-schedule-assignments` コレクション → 全ユーザー間で即時同期
- **フィルタープリセット**: `om-schedule-filter-presets` コレクション → 共有
- localStorage フォールバック (Firebase未設定時)

### フィルタープリセット
- ステージ/ステータスの選択状態を名前付きで保存
- 保存済みプリセットをワンクリックで適用
- 最終フィルター状態を自動復元

## Data Sources

### Salesforce
```sql
-- レンタル商談
SELECT Id, Name, StageName2__c, ConstractType__c, Account.Name,
       LocationAddress__c, KojiSekouyoteibi__c, KojiSekoukiboubi__c,
       Kankobi__c, ConstructionCategory__c, ConstUser__c,
       AllSchaduleBikou__c, OwnerId
FROM Opportunity
WHERE ConstractType__c = 'レンタル'
  AND StageName2__c NOT IN ('失注', 'ペンディング', '99_完了')

-- 点検／修繕
SELECT Id, Name, Status__c, Category__c, Direction__c, Field2__c,
       Account__c, ScheduledDate__c, ExecEndDate__c, ExecDateKakutei__c,
       LocationAddress__c, Content__c, Result__c,
       Maintainer1__c, Maintainer2__c, Maintainer3__c,
       Opportunity__c, Gaiyou__c, OwnerId
FROM Maintenance__c
WHERE Status__c NOT IN ('完了')
```

## Members (9名 + 瀬戸)
| ID | 名前 | メール | 色 | 備考 |
|----|------|--------|-----|------|
| hiroki_n | 廣木 | norifumi.hiroki@altenergy.co.jp | #3B82F6 | |
| yodogawa_t | 淀川 | taichi.yodogawa@altenergy.co.jp | #06B6D4 | |
| tano_h | 田野 | hayato.tano@altenergy.co.jp | #10B981 | |
| bold_j | BOLD | jigjidsuren.bold@altenergy.co.jp | #F97316 | |
| sasanuma_k | 笹沼 | kazuhiro.sasanuma@altenergy.co.jp | #F59E0B | |
| yamazaki_k | 山崎 | kaito.yamazaki@altenergy.co.jp | #EC4899 | |
| ota_t | 太田 | takahiro.ota@altenergy.co.jp | #EF4444 | |
| wano_t | 和埜 | tatsuto.wano@altenergy.co.jp | #8B5CF6 | |
| seto_r | 瀬戸 | nstandard.info@gmail.com | #14B8A6 | Gmail, skipOutlookSync |
| tago_s | 田子 | shoichiro.tago@altenergy.co.jp | #A855F7 | 準備要員 |

## State Management
- **AppContext** -- `useReducer` + Firestore real-time sync
  - Actions: `ADD_ASSIGNMENT`, `UPDATE_ASSIGNMENT`, `DELETE_ASSIGNMENT`, `SET_ASSIGNMENTS`, `UPDATE_SETTINGS`
  - `fromFirestoreRef` でループ防止
- **CalendarContext** -- Outlook イベント管理 + localStorage 永続化
- **AuthContext** -- MSAL 認証状態

## Azure AD Config
- Client ID: `85420e2f-eb38-4a8e-931f-4be552f953b0`
- Tenant ID: `61b80e23-6dd9-4dc6-b355-d7f210b12ef5`
- Redirect URIs: `http://localhost:5191/`, `https://kay0530.github.io/OM_schedule/`
- Scopes: `Calendars.ReadWrite`, `Calendars.ReadWrite.Shared`, `User.Read`

## Firebase Config
- Project: `om-schedule`
- Firestore Location: `asia-northeast1` (Tokyo)
- Collections: `om-schedule-assignments`, `om-schedule-filter-presets`
- Config: `.env` (ローカル) / GitHub Secrets (デプロイ)
- Security Rules: テストモード (30日期限 → 本番ルール要設定)

## Known Issues / TODO
- ドラッグ&ドロップ: EventBlock overlay が drop target を遮る問題 → dragStart 時に pointer-events:none で回避中
- Outlook イベント作成: `/users/{email}/events` で他ユーザーカレンダーに書込 → Calendars.ReadWrite.Shared 権限が必要
- Firestore セキュリティルール: テストモード → 本番ルールへの移行が必要
- 瀬戸さん: Gmail ユーザーのため Outlook 同期不可、手動入力のみ

## Conventions
- UI テキストは日本語、コード内コメント・変数名は英語
- Tailwind CSS でスタイリング (CSS ファイルは index.css のみ)
- コンポーネントは default export
- Conventional Commit 形式 (feat:, fix:, refactor:)
